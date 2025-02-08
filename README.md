# Reasoning-Coder MCP Server

This is a simple MCP (Model Context Protocol) server that integrates with various language models, including DeepSeek and Claude (via OpenRouter), as well as OpenAI, Gemini, and Vertex AI. It provides a basic interface for generating responses using these models.

forked from newideas99/Deepseek-Thinking-Claude-3.5-Sonnet-CLINE-MCP


## Features

- **Two-Stage Processing**:
  - Uses DeepSeek R1 for initial reasoning (50k character context)
  - Uses Claude 3.5 Sonnet for final response (600k character context)
  - Both models accessed through OpenRouter's unified API
  - Injects DeepSeek's reasoning tokens into Claude's context

- **Smart Conversation Management**:
  - Detects active conversations using file modification times
  - Handles multiple concurrent conversations
  - Filters out ended conversations automatically
  - Supports context clearing when needed

- **Optimized Parameters**:
  - Model-specific context limits:
    * DeepSeek: 50,000 characters for focused reasoning
    * Claude: 600,000 characters for comprehensive responses
  - Recommended settings:
    * temperature: 0.7 for balanced creativity
    * top_p: 1.0 for full probability distribution
    * repetition_penalty: 1.0 to prevent repetition

## Installation

1.  Clone this repository:

    ```bash
    git clone https://github.com/your-repo/mcp-reasoning-coding.git
    cd mcp-reasoning-coding
    ```

2.  Install dependencies:

    ```bash
    npm install
    ```

## Configuration

1.  Create a `.env` file in the root directory of the project, based on the provided `.env.example` file.
2.  Fill in the required API keys for the providers you want to use:
    *   `OPENROUTER_API_KEY`: API key for OpenRouter.
    *   `ANTHROPIC_API_KEY`: API key for Anthropic.
    *   `DEEPSEEK_API_KEY`: API key for DeepSeek.
    *   `OPENAI_API_KEY`: API key for OpenAI.
    *   `OPENAI_API_BASE_URL`: Base URL for the OpenAI API (if different from the default).
    *   `GEMINI_API_KEY`: API key for Google Gemini..
    *   `VERTEX_PROJECT_ID`: Vertex Project ID.
    *   `VERTEX_REGION`: Vertext Region
3.  Configure the `REASONING_PROVIDER`, `REASONING_MODEL`, `CODING_PROVIDER`, and `CODING_MODEL` environment variables in your `.env` file to specify the default models for reasoning and coding tasks. Refer to `src/providers.json` for available providers and models.


## Usage with Cline

Add to your Cline MCP settings (usually in `~/.vscode/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json`):

```json
{
  "mcpServers": {
    "deepseek-claude": {
      "command": "/path/to/node",
      "args": ["/path/to/mcp-reasoning-coding/build/index.js"],
      "env": {
        "OPENROUTER_API_KEY": "your_key_here"
        # ... more env variables here!
      },
      "disabled": false,
      "autoApprove": []
    }
  }
}
```

## Tool Usage

The server provides two tools for generating and monitoring responses:

### generate_response

Main tool for generating responses with the following parameters:

```typescript
{
  "prompt": string,           // Required: The question or prompt
  "showReasoning"?: boolean, // Optional: Show DeepSeek's reasoning process
  "clearContext"?: boolean,  // Optional: Clear conversation history
  "includeHistory"?: boolean // Optional: Include Cline conversation history
}
```

### check_response_status

Tool for checking the status of a response generation task:

```typescript
{
  "taskId": string  // Required: The task ID from generate_response
}
```

### Response Polling

The server uses a polling mechanism to handle long-running requests:

1. Initial Request:
   - `generate_response` returns immediately with a task ID
   - Response format: `{"taskId": "uuid-here"}`

2. Status Checking:
   - Use `check_response_status` to poll the task status
   - **Note:** Responses can take up to 60 seconds to complete
   - Status progresses through: pending → reasoning → responding → complete

Example usage in Cline:
```typescript
// Initial request
const result = await use_mcp_tool({
  server_name: "deepseek-claude",
  tool_name: "generate_response",
  arguments: {
    prompt: "What is quantum computing?",
    showReasoning: true
  }
});

// Get taskId from result
const taskId = JSON.parse(result.content[0].text).taskId;

// Poll for status (may need multiple checks over ~60 seconds)
const status = await use_mcp_tool({
  server_name: "deepseek-claude",
  tool_name: "check_response_status",
  arguments: { taskId }
});

// Example status response when complete:
{
  "status": "complete",
  "reasoning": "...",  // If showReasoning was true
  "response": "..."    // The final response
}
```

## Development

For development with auto-rebuild:
```bash
npm run watch
```

## How It Works

1. **Reasoning Stage (DeepSeek R1)**:
   - Uses OpenRouter's reasoning tokens feature
   - Prompt is modified to output 'done' while capturing reasoning
   - Reasoning is extracted from response metadata

2. **Response Stage (Claude 3.5 Sonnet)**:
   - Receives the original prompt and DeepSeek's reasoning
   - Generates final response incorporating the reasoning
   - Maintains conversation context and history

# TODO: Implement client initialization for missing providers

The following providers are listed in `providers.json` but do not have corresponding client initialization logic in `src/index.ts`:
Do not use them yet, or contribute!

-   bedrock
-   openai-native
-   qwen
-   mistral
-   litellm
-   ollama
-   lmstudio
-   requesty
-   together
-   vscode-lm

These providers should be implemented to ensure full functionality.
## Usage

1.  Start the server:

    ```bash
    npm start
    ```

2.  The server will listen for incoming requests on stdin. You can interact with it using the MCP protocol.

### Supported Tools

The server currently supports the following tools:

*   `generate_response`: Generates a response based on the provided prompt.
    *   `prompt`: (string, required) The user's input prompt.
    *   `showReasoning`: (boolean, optional) Whether to include reasoning in the response (default: false).
    *   `clearContext`: (boolean, optional) Whether to clear the conversation history before this request (default: false).
    *   `includeHistory`: (boolean, optional) Whether to include Cline conversation history for context (default: true).
    *   `check_response_status`: Checks the status of a response generation task.
    *   `taskId`: (string, required) The task ID returned by `generate_response`.

## Supported Providers and Models

The server supports the following providers and models (configured in `src/providers.json`):

*   OpenRouter
*   Anthropic
*   DeepSeek
*   OpenAI
*   Gemini
*   Vertex AI

See `src/providers.json` for the complete list of models and their capabilities.

## Error Handling

The server will return error responses in the MCP format if there are any issues with the request or the API calls.

## Contributing

Contributions are welcome! Please feel free to submit pull requests or open issues.

## License

This project is licensed under the MIT License - see the `LICENSE` file for details.
