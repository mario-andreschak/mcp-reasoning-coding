#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';
import { OpenAI } from "openai";
import dotenv from "dotenv";
import * as os from "os";
import * as path from "path";
import * as fs from "fs/promises";
import { v4 as uuidv4 } from "uuid";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { VertexAI } from '@google-cloud/vertexai';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

// console.error(import.meta.url)
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
console.error(path.join(__dirname, "../src/providers.json"))

// Load environment variables and providers
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const providers = JSON.parse(await fs.readFile(path.join(__dirname, "../src/providers.json"), "utf-8"));

// Constants, read from environment variables with defaults
const DEFAULT_REASONING_PROVIDER = "openrouter";
const DEFAULT_REASONING_MODEL = "deepseek/deepseek-r1";
const DEFAULT_CODING_PROVIDER = "openrouter";
const DEFAULT_CODING_MODEL = "deepseek/deepseek-chat";

const REASONING_PROVIDER =
  process.env.REASONING_PROVIDER || DEFAULT_REASONING_PROVIDER;
const REASONING_MODEL = process.env.REASONING_MODEL || DEFAULT_REASONING_MODEL;
const CODING_PROVIDER = process.env.CODING_PROVIDER || DEFAULT_CODING_PROVIDER;
const CODING_MODEL = process.env.CODING_MODEL || DEFAULT_CODING_MODEL;

interface ConversationEntry {
  timestamp: number;
  prompt: string;
  reasoning: string;
  response: string;
  model: string;
}

interface ConversationContext {
  entries: ConversationEntry[];
  maxEntries: number;
}

interface GenerateResponseArgs {
  prompt: string;
  showReasoning?: boolean;
  clearContext?: boolean;
  includeHistory?: boolean;
}

interface CheckResponseStatusArgs {
  taskId: string;
}

interface TaskStatus {
  status: 'pending' | 'reasoning' | 'responding' | 'complete' | 'error';
  prompt: string;
  showReasoning?: boolean;
  reasoning?: string;
  response?: string;
  error?: string;
  timestamp: number;
}

const isValidCheckResponseStatusArgs = (args: any): args is CheckResponseStatusArgs =>
  typeof args === 'object' &&
  args !== null &&
  typeof args.taskId === 'string';

interface ClaudeMessage {
  role: 'user' | 'assistant';
  content: string | { type: string; text: string }[];
}

interface UiMessage {
  ts: number;
  type: string;
  say?: string;
  ask?: string;
  text: string;
  conversationHistoryIndex: number;
}

const isValidGenerateResponseArgs = (args: any): args is GenerateResponseArgs =>
  typeof args === 'object' &&
  args !== null &&
  typeof args.prompt === 'string' &&
  (args.showReasoning === undefined || typeof args.showReasoning === 'boolean') &&
  (args.clearContext === undefined || typeof args.clearContext === 'boolean') &&
  (args.includeHistory === undefined || typeof args.includeHistory === 'boolean');

function getClaudePath(): string {
  const homeDir = os.homedir();
  switch (process.platform) {
    case 'win32':
      return path.join(homeDir, 'AppData', 'Roaming', 'Code', 'User', 'globalStorage', 'saoudrizwan.claude-dev', 'tasks');
    case 'darwin':
      return path.join(homeDir, 'Library', 'Application Support', 'Code', 'User', 'globalStorage', 'saoudrizwan.claude-dev', 'tasks');
    default: // linux
      return path.join(homeDir, '.config', 'Code', 'User', 'globalStorage', 'saoudrizwan.claude-dev', 'tasks');
  }
}

async function findActiveConversation(): Promise<ClaudeMessage[] | null> {
  try {
    const tasksPath = getClaudePath();
    const dirs = await fs.readdir(tasksPath);
    
    // Get modification time for each api_conversation_history.json
    const dirStats = await Promise.all(
      dirs.map(async (dir) => {
        try {
          const historyPath = path.join(tasksPath, dir, "api_conversation_history.json");
          const stats = await fs.stat(historyPath);
          const uiPath = path.join(tasksPath, dir, "ui_messages.json");
          const uiContent = await fs.readFile(uiPath, "utf8");
          const uiMessages: UiMessage[] = JSON.parse(uiContent);
          const hasEnded = uiMessages.some((m) => m.type === "conversation_ended");

          return {
            dir,
            mtime: stats.mtime.getTime(),
            hasEnded,
          };
        } catch (error) {
          console.error("Error checking folder:", dir, error);
          return null;
        }
      })
    );

    // Filter out errors and ended conversations, then sort by modification time
    const sortedDirs = dirStats
      .filter((stat): stat is NonNullable<typeof stat> => stat !== null && !stat.hasEnded)
      .sort((a, b) => b.mtime - a.mtime);

    // Use most recently modified active conversation
    const latest = sortedDirs[0]?.dir;
    if (!latest) {
      console.error("No active conversations found");
      return null;
    }

    const historyPath = path.join(tasksPath, latest, "api_conversation_history.json");
    const history = await fs.readFile(historyPath, "utf8");
    return JSON.parse(history);
  } catch (error) {
    console.error("Error finding active conversation:", error);
    return null;
  }
}

function formatHistoryForModel(history: ClaudeMessage[], isDeepSeek: boolean): string {
  const maxLength = isDeepSeek ? 50000 : 600000; // 50k chars for DeepSeek, 600k for Claude
  const formattedMessages = [];
  let totalLength = 0;
  
  // Process messages in reverse chronological order to get most recent first
  for (let i = history.length - 1; i >= 0; i--) {
    const msg = history[i];
    const content = Array.isArray(msg.content)
      ? msg.content.map(c => c.text).join('\n')
      : msg.content;
    
    const formattedMsg = `${msg.role === 'user' ? 'Human' : 'Assistant'}: ${content}`;
    const msgLength = formattedMsg.length;
    
    // Stop adding messages if we'd exceed the limit
    if (totalLength + msgLength > maxLength) {
      break;
    }
    
    formattedMessages.push(formattedMsg); // Add most recent messages first
    totalLength += msgLength;
  }
  
  // Reverse to get chronological order
  return formattedMessages.reverse().join('\n\n');
}

class ReasoningCodingServer {
  private server: Server;
    private clients: Record<string, any> = {};
  private context: ConversationContext = {
    entries: [],
    maxEntries: 10
  };
  private activeTasks: Map<string, TaskStatus> = new Map();

  constructor() {
    console.error('Initializing API clients...');
    console.error('Reasoning Provider:');
    console.error(REASONING_PROVIDER);
    console.error('Reasoning Model:');
    console.error(REASONING_MODEL);
    console.error('Coding Provider:');
    console.error(CODING_PROVIDER);
    console.error('Coding Model:');
    console.error(CODING_MODEL);
    
    
    // Initialize API clients for supported providers, ONLY if they are selected
    if (REASONING_PROVIDER === "openrouter" || CODING_PROVIDER === "openrouter") {
        if (providers.openrouter) {
            console.error('Initializing OpenRouter client');
            this.clients.openrouter = new OpenAI({
                baseURL: "https://openrouter.ai/api/v1",
                apiKey: process.env.OPENROUTER_API_KEY
            });
            console.error('OpenRouter client initialized');
        } else {
            console.error("OpenRouter selected as provider, but configuration not found in providers.json");
        }
    }

    if (REASONING_PROVIDER === "anthropic" || CODING_PROVIDER === "anthropic") {
        if (providers.anthropic) {
            console.error('Initializing Anthropic client');
            this.clients.anthropic = new OpenAI({
                baseURL: "https://api.anthropic.com/v1",
                apiKey: process.env.ANTHROPIC_API_KEY
            });
            console.error('Anthropic client initialized');
        } else {
             console.error("Anthropic selected as provider, but configuration not found in providers.json");
        }
    }

    if (REASONING_PROVIDER === "deepseek" || CODING_PROVIDER === "deepseek") {
        if (providers.deepseek) {
            console.error('Initializing Deepseek client');
            this.clients.deepseek = new OpenAI({
                baseURL: "https://api.deepseek.com/v1",
                apiKey: process.env.DEEPSEEK_API_KEY
            });
            console.error('Deepseek client initialized');
        } else {
            console.error("Deepseek selected as provider, but configuration not found in providers.json");
        }
    }
    
    if (REASONING_PROVIDER === "openai" || CODING_PROVIDER === "openai") {
        console.error("Checking OpenAI client initialization:", { REASONING_PROVIDER, CODING_PROVIDER, providers_openai: providers.openai });
        if (providers.openai) {
            console.error("Initializing OpenAI client with config:", { baseURL: process.env.OPENAI_API_BASE_URL, apiKey: process.env.OPENAI_API_KEY });
            this.clients.openai = new OpenAI({
              baseURL: process.env.OPENAI_API_BASE_URL,
              apiKey: process.env.OPENAI_API_KEY,
            });
            console.error("OpenAI client initialized");
        } else {
            console.error("OpenAI provider configuration not found in providers.json, but REASONING_PROVIDER or CODING_PROVIDER is set to openai. Please check your configuration.");
        }
    }

    if (REASONING_PROVIDER === "gemini" || CODING_PROVIDER === "gemini") {
        if (providers.gemini) {
            console.error('Initializing Gemini client');
            this.clients.gemini = new GoogleGenerativeAI(process.env.GEMINI_API_KEY ?? "");
            console.error("Gemini client initialized");
        } else {
            console.error("Gemini selected as provider, but configuration not found in providers.json");
        }
    }

    if (REASONING_PROVIDER === "vertex" || CODING_PROVIDER === "vertex") {
        if (providers.vertex) {
            console.error('Initializing Vertex client');
            this.clients.vertex = new VertexAI({project: process.env.VERTEX_PROJECT_ID, location: process.env.VERTEX_REGION});
            console.error("Vertex client initialized");
        } else {
            console.error("Vertex selected as provider, but configuration not found in providers.json");
        }
    }


    // TODO: Add clients for other providers as needed

    // Initialize MCP server
    this.server = new Server(
      {
        name: 'deepseek-thinking-claude-mcp',
        version: '0.1.0',
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    this.setupToolHandlers();
    
    // Error handling
    this.server.onerror = (error) => console.error('[MCP Error]', error);
    process.on('SIGINT', async () => {
      await this.server.close();
      process.exit(0);
    });
  }

  private addToContext(entry: ConversationEntry) {
    this.context.entries.push(entry);
    if (this.context.entries.length > this.context.maxEntries) {
      this.context.entries.shift();  // Remove oldest
    }
  }

  private formatContextForPrompt(): string {
    return this.context.entries
      .map(entry => `Question: ${entry.prompt}\nReasoning: ${entry.reasoning}\nAnswer: ${entry.response}`)
      .join('\n\n');
  }

  private setupToolHandlers() {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        {
          name: 'generate_response',
          description: 'Generate a response using DeepSeek\'s reasoning and Claude\'s response generation through OpenRouter.',
          inputSchema: {
            type: 'object',
            properties: {
              prompt: {
                type: 'string',
                description: 'The user\'s input prompt'
              },
              showReasoning: {
                type: 'boolean',
                description: 'Whether to include reasoning in response',
                default: false
              },
              clearContext: {
                type: 'boolean',
                description: 'Clear conversation history before this request',
                default: false
              },
              includeHistory: {
                type: 'boolean',
                description: 'Include Cline conversation history for context',
                default: true
              }
            },
            required: ['prompt']
          }
        },
        {
          name: 'check_response_status',
          description: 'Check the status of a response generation task',
          inputSchema: {
            type: 'object',
            properties: {
              taskId: {
                type: 'string',
                description: 'The task ID returned by generate_response'
              }
            },
            required: ['taskId']
          }
        }
      ]
    }));

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      if (request.params.name === 'generate_response') {
        if (!isValidGenerateResponseArgs(request.params.arguments)) {
          throw new McpError(
            ErrorCode.InvalidParams,
            'Invalid generate_response arguments'
          );
        }

        const taskId = uuidv4();
        const { prompt, showReasoning, clearContext, includeHistory } = request.params.arguments;

        // Initialize task status
        this.activeTasks.set(taskId, {
          status: 'pending',
          prompt,
          showReasoning,
          timestamp: Date.now()
        });

        // Start processing in background
        this.processTask(taskId, clearContext, includeHistory).catch(error => {
          console.error('Error processing task:', error);
          this.activeTasks.set(taskId, {
            ...this.activeTasks.get(taskId)!,
            status: 'error',
            error: error.message
          });
        });

        // Return task ID immediately
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({ taskId })
            }
          ]
        };
      } else if (request.params.name === 'check_response_status') {
        if (!isValidCheckResponseStatusArgs(request.params.arguments)) {
          throw new McpError(
            ErrorCode.InvalidParams,
            'Invalid check_response_status arguments'
          );
        }

        const taskId = request.params.arguments.taskId;
        const task = this.activeTasks.get(taskId);

        if (!task) {
          throw new McpError(
            ErrorCode.InvalidRequest,
            `No task found with ID: ${taskId}`
          );
        }

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                status: task.status,
                reasoning: task.showReasoning ? task.reasoning : undefined,
                response: task.status === 'complete' ? task.response : undefined,
                error: task.error
              })
            }
          ]
        };
      } else {
        throw new McpError(
          ErrorCode.MethodNotFound,
          `Unknown tool: ${request.params.name}`
        );
      }
    });
  }

  private async processTask(taskId: string, clearContext?: boolean, includeHistory?: boolean): Promise<void> {
    const task = this.activeTasks.get(taskId);
    if (!task) {
      throw new Error(`No task found with ID: ${taskId}`);
    }
    
    try {
      if (clearContext) {
        this.context.entries = [];
      }

      // Update status to reasoning
      this.activeTasks.set(taskId, {
        ...task,
        status: 'reasoning'
      });

      // Get Cline conversation history if requested
      let history: ClaudeMessage[] | null = null;
      if (includeHistory !== false) {
        history = await findActiveConversation();
      }

      // Get reasoning with limited history
      const reasoningHistory = history ? formatHistoryForModel(history, true) : '';
      const reasoningPrompt = reasoningHistory
        ? `${reasoningHistory}\n\nNew question: ${task.prompt}`
        : task.prompt;
      const reasoning = await this.getReasoning(reasoningPrompt);

      // Update status with reasoning
      this.activeTasks.set(taskId, {
        ...task,
        status: 'responding',
        reasoning,
      });

      // Get final response with full history
      const responseHistory = history ? formatHistoryForModel(history, false) : '';
      const fullPrompt = responseHistory
        ? `${responseHistory}\n\nCurrent task: ${task.prompt}`
        : task.prompt;
      const response = await this.getFinalResponse(fullPrompt, reasoning);

      // Add to context after successful response
      this.addToContext({
        timestamp: Date.now(),
        prompt: task.prompt,
        reasoning,
        response,
        model: CODING_MODEL, // Use CODING_MODEL here
      });

      // Update status to complete
      this.activeTasks.set(taskId, {
        ...task,
        status: "complete",
        reasoning,
        response,
        timestamp: Date.now(),
      });
    } catch (error) {
      // Update status to error
      this.activeTasks.set(taskId, {
        ...task,
        status: "error",
        error: error instanceof Error ? error.message : "Unknown error",
        timestamp: Date.now(),
      });
      throw error;
    }
  }

    private async getReasoningDeepseek(prompt: string): Promise<string> {
        const modelInfo = providers.deepseek[REASONING_MODEL];
        if (!modelInfo) {
            throw new Error(`Model ${REASONING_MODEL} for provider deepseek not found in providers.json`);
        }
        if (!this.clients.deepseek) {
            throw new Error(`Client not initialized for provider: deepseek`);
        }

        const response = await this.clients.deepseek.chat.completions.create({
            model: REASONING_MODEL,
            messages: [{ role: "user", content: prompt }],
            temperature: modelInfo.temperature ?? 0.7,
            top_p: modelInfo.top_p ?? 1,
            ...(modelInfo.extra_params || {})
        } as any);

        if (!response.choices?.[0]?.message?.content) {
            throw new Error("No reasoning received from DeepSeek");
        }
        return response.choices[0].message.content;
    }

    private async getFinalResponseDeepseek(prompt: string, reasoning: string): Promise<string> {
        const modelInfo = providers.deepseek[CODING_MODEL];
        if (!modelInfo) {
            throw new Error(`Model ${CODING_MODEL} for provider deepseek not found in providers.json`);
        }
        if (!this.clients.deepseek) {
            throw new Error(`Client not initialized for provider: deepseek`);
        }
        const messages = [
            {
                role: "user" as const,
                content: prompt
            },
            {
                role: "assistant" as const,
                content: `<thinking>${reasoning}</thinking>`
            }
        ];
        const response = await this.clients.deepseek.chat.completions.create({
            model: CODING_MODEL,
            messages,
            temperature: modelInfo.temperature ?? 0.7,
            top_p: modelInfo.top_p ?? 1,
            repetition_penalty: modelInfo.repetition_penalty ?? 1,
            ...(modelInfo.extra_params || {})
        } as any);

        return response.choices[0].message.content || "Error: No response content";
    }

    private async getReasoningGemini(prompt: string): Promise<string> {
        const modelInfo = providers.gemini[REASONING_MODEL];
        if (!modelInfo) {
            throw new Error(`Model ${REASONING_MODEL} for provider gemini not found in providers.json`);
        }
        if (!this.clients.gemini) {
            throw new Error(`Client not initialized for provider: gemini`);
        }
        const geminiPrompt = [{ role: "user", parts: [{ text: prompt }] }];
        const result = await this.clients.gemini.getGenerativeModel({ model: REASONING_MODEL }).generateContentStream(geminiPrompt);
        let response = "";
        for await (const chunk of result.stream) {
            response += chunk.text();
        }
        if (!response) {
            throw new Error("No reasoning received from Gemini");
        }
        return response;
    }

    private async getFinalResponseGemini(prompt: string, reasoning: string): Promise<string> {
        const modelInfo = providers.gemini[CODING_MODEL];
        if (!modelInfo) {
            throw new Error(`Model ${CODING_MODEL} for provider gemini not found in providers.json`);
        }
        if (!this.clients.gemini) {
            throw new Error(`Client not initialized for provider: gemini`);
        }
        const geminiPrompt = [{ role: "user", parts: [{ text: prompt }] }, { role: 'model', parts: [{ text: reasoning }] }];
        const result = await this.clients.gemini.getGenerativeModel({ model: CODING_MODEL }).generateContentStream(geminiPrompt);
        let response = "";
        for await (const chunk of result.stream) {
            response += chunk.text();
        }
        if (!response) {
            throw new Error("No reasoning received from Gemini");
        }
        return response;
    }
    
    private async getReasoningAnthropic(prompt: string): Promise<string> {
        const modelInfo = providers.anthropic[REASONING_MODEL];
        if (!modelInfo) {
            throw new Error(`Model ${REASONING_MODEL} for provider anthropic not found in providers.json`);
        }
        if (!this.clients.anthropic) {
            throw new Error(`Client not initialized for provider: anthropic`);
        }

        const response = await this.clients.anthropic.chat.completions.create({
            model: REASONING_MODEL,
            messages: [{ role: "user", content: prompt }],
            temperature: modelInfo.temperature ?? 0.7,
            top_p: modelInfo.top_p ?? 1,
            ...(modelInfo.extra_params || {})
        } as any);

        if (!response.choices?.[0]?.message?.content) {
            throw new Error("No reasoning received from Anthropic");
        }
        return response.choices[0].message.content;
    }

    private async getFinalResponseAnthropic(prompt: string, reasoning: string): Promise<string> {
        const modelInfo = providers.anthropic[CODING_MODEL];
        if (!modelInfo) {
            throw new Error(`Model ${CODING_MODEL} for provider anthropic not found in providers.json`);
        }
        if (!this.clients.anthropic) {
            throw new Error(`Client not initialized for provider: anthropic`);
        }
        const messages = [
            {
                role: "user" as const,
                content: prompt
            },
            {
                role: "assistant" as const,
                content: `<thinking>${reasoning}</thinking>`
            }
        ];
        const response = await this.clients.anthropic.chat.completions.create({
            model: CODING_MODEL,
            messages,
            temperature: modelInfo.temperature ?? 0.7,
            top_p: modelInfo.top_p ?? 1,
            repetition_penalty: modelInfo.repetition_penalty ?? 1,
            ...(modelInfo.extra_params || {})
        } as any);

        return response.choices[0].message.content || "Error: No response content";
    }

  private async getReasoningVertex(prompt: string): Promise<string> {
    const modelInfo = providers.vertex[REASONING_MODEL];
    if (!modelInfo) {
      throw new Error(`Model ${REASONING_MODEL} for provider vertex not found in providers.json`);
    }
    if (!this.clients.vertex) {
      throw new Error(`Client not initialized for provider: vertex`);
    }
    const vertexModel = this.clients.vertex.getGenerativeModel({ model: REASONING_MODEL });
    const vertexPrompt = [{ role: "user", parts: [{ text: prompt }] }];
    const result = await vertexModel.generateContentStream(vertexPrompt);
    let response = "";
    for await (const chunk of result.stream) {
      response += chunk.text();
    }
    if (!response) {
      throw new Error("No reasoning received from Vertex");
    }
    return response;
  }

  private async getFinalResponseVertex(prompt: string, reasoning: string): Promise<string> {
    const modelInfo = providers.vertex[CODING_MODEL];
    if (!modelInfo) {
      throw new Error(`Model ${CODING_MODEL} for provider vertex not found in providers.json`);
    }
    if (!this.clients.vertex) {
      throw new Error(`Client not initialized for provider: vertex`);
    }
    const vertexModel = this.clients.vertex.getGenerativeModel({ model: CODING_MODEL });
    const vertexPrompt = [
      { role: "user", parts: [{ text: prompt }] },
      { role: "model", parts: [{ text: reasoning }] },
    ];
    const result = await vertexModel.generateContentStream(vertexPrompt);
    let response = "";
    for await (const chunk of result.stream) {
      response += chunk.text();
    }
    if (!response) {
      throw new Error("No reasoning received from Vertex");
    }
    return response;
  }

    private async getReasoningOpenAI(prompt: string): Promise<string> {
        const modelInfo = providers.openai[REASONING_MODEL];

        if (!modelInfo) {
            throw new Error(`Model ${REASONING_MODEL} for provider openai not found in providers.json`);
        }

        if (!this.clients.openai) {
            throw new Error(`Client not initialized for provider: openai`);
        }

        const response = await this.clients.openai.chat.completions.create({
            model: REASONING_MODEL,
            messages: [
                {
                    role: "user",
                    content: prompt,
                },
            ],
            temperature: modelInfo.temperature ?? 0.7,
            top_p: modelInfo.top_p ?? 1,
            ...(modelInfo.extra_params || {})
        } as any);

        if (!response.choices?.[0]?.message?.content) {
            throw new Error("No reasoning received from OpenAI");
        }
        return response.choices[0].message.content;
    }

  private async getFinalResponseOpenAI(prompt: string, reasoning: string): Promise<string> {
        const modelInfo = providers.openai[CODING_MODEL];
        if (!modelInfo) {
            throw new Error(`Model ${CODING_MODEL} for provider openai not found in providers.json`);
        }
        if (!this.clients.openai) {
            throw new Error(`Client not initialized for provider: openai`);
        }
        const messages = [
            {
                role: "user" as const,
                content: prompt
            },
            {
                role: "assistant" as const,
                content: `<thinking>${reasoning}</thinking>`
            }
        ];
        const response = await this.clients.openai.chat.completions.create({
            model: CODING_MODEL,
            messages,
            temperature: modelInfo.temperature ?? 0.7,
            top_p: modelInfo.top_p ?? 1,
            repetition_penalty: modelInfo.repetition_penalty ?? 1,
            ...(modelInfo.extra_params || {})
        } as any);

        return response.choices[0].message.content || "Error: No response content";
    }

    private async getReasoningOpenRouter(prompt: string): Promise<string> {
        const modelInfo = providers.openrouter[REASONING_MODEL];

        if (!modelInfo) {
            throw new Error(`Model ${REASONING_MODEL} for provider openrouter not found in providers.json`);
        }

        if (!this.clients.openrouter) {
            throw new Error(`Client not initialized for provider: openrouter`);
        }

        const response = await this.clients.openrouter.chat.completions.create({
            model: REASONING_MODEL,
            messages: [
                {
                    role: "user",
                    content: prompt,
                },
            ],
            temperature: modelInfo.temperature ?? 0.7,
            top_p: modelInfo.top_p ?? 1,
            ...(modelInfo.extra_params || {})
        } as any);

        if (!response.choices?.[0]?.message?.content) {
            throw new Error("No reasoning received from OpenRouter");
        }
        return response.choices[0].message.content;
    }

    private async getFinalResponseOpenRouter(prompt: string, reasoning: string): Promise<string> {
        const modelInfo = providers.openrouter[CODING_MODEL];
        if (!modelInfo) {
            throw new Error(`Model ${CODING_MODEL} for provider openrouter not found in providers.json`);
        }
        if (!this.clients.openrouter) {
            throw new Error(`Client not initialized for provider: openrouter`);
        }
        const messages = [
            {
                role: "user" as const,
                content: prompt
            },
            {
                role: "assistant" as const,
                content: `<thinking>${reasoning}</thinking>`
            }
        ];
        const response = await this.clients.openrouter.chat.completions.create({
            model: CODING_MODEL,
            messages,
            temperature: modelInfo.temperature ?? 0.7,
            top_p: modelInfo.top_p ?? 1,
            repetition_penalty: modelInfo.repetition_penalty ?? 1,
            ...(modelInfo.extra_params || {})
        } as any);

        return response.choices[0].message.content || "Error: No response content";
    }

  private async getReasoning(prompt: string): Promise<string> {
    const contextPrompt =
      this.context.entries.length > 0
        ? `Previous conversation:\n${this.formatContextForPrompt()}\n\nNew question: ${prompt}`
        : prompt;

    try {
        switch (REASONING_PROVIDER) {
            case "anthropic":
                return this.getReasoningAnthropic(contextPrompt);
            case "deepseek":
                return this.getReasoningDeepseek(contextPrompt);
            case "gemini":
                return this.getReasoningGemini(contextPrompt);
            case "vertex":
                return this.getReasoningVertex(contextPrompt);
            case "openai":
                return this.getReasoningOpenAI(contextPrompt);
            case "openrouter":
                return this.getReasoningOpenRouter(contextPrompt);
            default:
                throw new Error(`Unsupported reasoning provider: ${REASONING_PROVIDER}`);
        }
    }
    catch (error) {
      console.error("Error in getReasoning:", error);
      throw error;
    }
  }

  private async getFinalResponse(prompt: string, reasoning: string): Promise<string> {
    try {
        switch (CODING_PROVIDER) {
            case "anthropic":
                return this.getFinalResponseAnthropic(prompt, reasoning);
            case "deepseek":
                return this.getFinalResponseDeepseek(prompt, reasoning);
            case "gemini":
                return this.getFinalResponseGemini(prompt, reasoning);
            case "vertex":
                return this.getFinalResponseVertex(prompt, reasoning);
            case "openai":
                return this.getFinalResponseOpenAI(prompt, reasoning);
            case "openrouter":
                return this.getFinalResponseOpenRouter(prompt, reasoning);
            default:
                throw new Error(`Unsupported coding provider: ${CODING_PROVIDER}`);
        }
    } catch (error) {
        console.error('Error in getFinalResponse:', error);
        throw error;
    }
}

    getModel(provider: string, model: string): {id: string, info: any} {
        const providerInfo = providers[provider];
        if (!providerInfo) {
            throw new Error(`Provider not found: ${provider}`);
        }
        const modelInfo = providerInfo[model];

        if (!modelInfo) {
            throw new Error(`Model not found: ${provider}/${model}`);
        }
        return {id: model, info: modelInfo}
    }

  async run(): Promise<void> {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error('DeepSeek-Claude MCP server running on stdio');
  }
}

const server = new ReasoningCodingServer();
server.run()
