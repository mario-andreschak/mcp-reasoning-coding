# Reasoning & Coding MCP Server

[![smithery badge](https://smithery.ai/badge/@newideas99/Deepseek-Thinking-Claude-3.5-Sonnet-CLINE-MCP)](https://smithery.ai/server/@newideas99/Deepseek-Thinking-Claude-3.5-Sonnet-CLINE-MCP)

This is a Model Context Protocol (MCP) server that provides a flexible and configurable two-stage reasoning and response generation system.  It's a fork of the original [Deepseek-Thinking-Claude-3.5-Sonnet-CLINE-MCP](link-to-original-repo) project, significantly expanding its capabilities by supporting multiple AI providers and models for both reasoning and coding/response generation.

## Key Changes and Improvements Compared to the Original

The original project was specifically designed to use DeepSeek R1 for reasoning and Claude 3.5 Sonnet for response generation, both accessed exclusively through OpenRouter.  This fork generalizes the architecture to support a wider range of providers and models.  Here's a breakdown of the key differences:

*   **Multi-Provider Support:**  Instead of being locked into OpenRouter, this fork can now use:
    *   OpenRouter
    *   OpenAI
    *   Anthropic (Claude)
    *   DeepSeek
    *   Google Gemini
    *   Google Vertex AI

*   **Configurable Reasoning and Coding Models:** The original hardcoded DeepSeek for reasoning and Claude for the final response.  This fork allows you to configure *both* the reasoning and coding/response generation models independently.  You can mix and match providers. For example, you could use Gemini for reasoning and OpenAI for the final response.

*   **`providers.json` Configuration:**  A new `providers.json` file is introduced to manage the available models and their specific parameters (temperature, top_p, etc.) for each provider.  This makes it easy to add new models or tweak existing ones without modifying the core code.

*   **Environment Variable Configuration:** The choice of reasoning and coding providers/models is now primarily controlled through environment variables:
    *   `REASONING_PROVIDER`:  Specifies the provider for the reasoning stage (e.g., `openai`, `gemini`, `deepseek`, `openrouter`, `anthropic`, `vertex`).
    *   `REASONING_MODEL`:  Specifies the model to use for reasoning (e.g., `gpt-4`, `gemini-pro`, `deepseek/deepseek-r1`).
    *   `CODING_PROVIDER`:  Specifies the provider for the coding/response generation stage.
    *   `CODING_MODEL`: Specifies the model for the final response.

*   **Dynamic Client Initialization:**  The code now dynamically initializes only the necessary API clients based on the `REASONING_PROVIDER` and `CODING_PROVIDER` settings.  This avoids unnecessary initialization and dependencies.

*   **Unified `getReasoning` and `getFinalResponse`:** The provider-specific logic is abstracted into `getReasoning` and `getFinalResponse` functions, making the core task processing logic provider-agnostic.

* **Retains core MCP structure:** The fork retains the core structure of using MCP, so it will integrate with any MCP client, like the original implementation. It defines the `generate_response` and `check_response_status` tools in the same way.

* **Retains Cline integration:** Like the original, the fork is intended for integration with Cline, the Claude Desktop extension.

* **Retains Conversation History Feature:** The forked implementation has kept the feature of using the conversation history of Cline for context.

* **No Hardcoded Models:** There are no hardcoded models in the new implementation, the models are defined in the .env file and providers.json

## Features

*   **Two-Stage Processing:**
    *   Uses a configurable model for initial reasoning (e.g., DeepSeek, GPT-4, Gemini Pro).
    *   Uses a configurable model for final response/code generation (e.g., Claude, GPT-4, DeepSeek Chat).
    *   Injects the reasoning from the first stage into the context of the second stage.

*   **Flexible Provider and Model Selection:**
    *   Choose from OpenRouter, OpenAI, Anthropic, DeepSeek, Gemini, and Vertex AI for both reasoning and coding stages.
    *   Easily configure models and their parameters via `providers.json` and environment variables.

*   **Smart Conversation Management (Inherited from Original):**
    *   Detects active Cline conversations using file modification times.
    *   Handles multiple concurrent conversations.
    *   Filters out ended conversations automatically.
    *   Supports context clearing.

*   **Optimized Parameters (Configurable):**
    *   Model-specific context limits are respected (e.g., 50,000 characters for DeepSeek reasoning, larger limits for response models).
    *   Parameters like `temperature`, `top_p`, and `repetition_penalty` are configurable per model in `providers.json`.

*   **Response Polling (Inherited from Original):**
    *   Uses a polling mechanism with `generate_response` (to get a task ID) and `check_response_status` (to check the status).  This handles the asynchronous nature of LLM calls.

## Installation

1.  **Clone the Repository:**

    ```bash
    git clone https://github.com/mario-andreschak/mcp-reasoning-coding.git
    cd /mcp-reasoning-coding
    ```

2.  **Install Dependencies:**

    ```bash
    npm install
    ```

3.  **Create a `.env` File:**  This file will hold your API keys and provider/model selections.  Example:

    ```env
    # --- Required API Keys (at least one) ---
    OPENROUTER_API_KEY=your_openrouter_key
    OPENAI_API_KEY=your_openai_key
    ANTHROPIC_API_KEY=your_anthropic_key
    DEEPSEEK_API_KEY=your_deepseek_key
    GEMINI_API_KEY=your_gemini_key
    VERTEX_PROJECT_ID=your_vertex_project_id # For Vertex AI
    VERTEX_REGION=your_vertex_region         # For Vertex AI

    # --- Provider and Model Selection ---
    REASONING_PROVIDER=openrouter
    REASONING_MODEL=deepseek/deepseek-r1
    CODING_PROVIDER=openrouter
    CODING_MODEL=anthropic/claude-3.5-sonnet:beta
    ```

    **Important:**  You only need to provide API keys for the providers you intend to use.  If you're only using OpenAI, you don't need an `OPENROUTER_API_KEY`, for example.

4.  **`providers.json` File:**  This file defines the available models for each provider and their parameters. Place this file in the `src` folder. Example (`src/providers.json`):

    ```json
    {
      "openrouter": {
        "deepseek/deepseek-r1": {
          "temperature": 0.7,
          "top_p": 1
        },
        "anthropic/claude-3.5-sonnet:beta": {
          "temperature": 0.7,
          "top_p": 1,
          "repetition_penalty": 1
        },
        "deepseek/deepseek-chat":{
          "temperature": 0.7,
          "top_p": 1
        }
      },
      "openai": {
        "gpt-4": {
          "temperature": 0.7,
          "top_p": 1
        },
        "gpt-3.5-turbo": {
          "temperature": 0.7,
          "top_p": 1
        }
      },
        "anthropic": {
          "claude-3-opus-20240229": {
            "temperature": 0.7,
            "top_p": 1
          }
        },
        "deepseek": {
          "deepseek-coder": {
            "temperature": 0.7,
            "top_p": 1
          }
        },
        "gemini":{
          "gemini-pro":{

          }
        },
        "vertex": {
          "gemini-1.5-pro-002":{

          }
        }
    }
    ```
    *   **`extra_params`:** You can add provider-specific parameters within the model definition using the `extra_params` key.  Consult the API documentation for each provider to see what options are available.

5.  **Build the server:**

    ```bash
    npm run build
    ```

## Usage with Cline

Add to your Cline MCP settings (usually in `~/.vscode/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json`):

```json
{
  "mcpServers": {
    "reasoning-coding": {
      "command": "/path/to/node",
      "args": ["/path/to/your-fork/build/index.js"],  // Adjust path
      "env": {
        // Your .env variables will be inherited, so no need to duplicate them here
      },
      "disabled": false,
      "autoApprove": []
    }
  }
}
```

Replace `/path/to/node` and `/path/to/your-fork/build/index.js` with the correct paths.

## Tool Usage (Same as Original)

The server provides the same two tools as the original:

### `generate_response`

Generates a response using the configured reasoning and coding models.

```typescript
{
  "prompt": string,           // Required: The question or prompt
  "showReasoning"?: boolean, // Optional: Show the reasoning process
  "clearContext"?: boolean,  // Optional: Clear conversation history
  "includeHistory"?: boolean // Optional: Include Cline conversation history
}
```

### `check_response_status`

Checks the status of a response generation task.

```typescript
{
  "taskId": string  // Required: The task ID from generate_response
}
```

### Response Polling (Same as Original)

1.  **Initial Request:** Call `generate_response` to get a `taskId`.

    ```typescript
    const result = await use_mcp_tool({
      server_name: "reasoning-coding",
      tool_name: "generate_response",
      arguments: {
        prompt: "Explain the theory of relativity.",
        showReasoning: true
      }
    });

    const taskId = JSON.parse(result.content[0].text).taskId;
    ```

2.  **Status Checking:**  Poll `check_response_status` with the `taskId` until the status is `complete` (or `error`).

    ```typescript
    const status = await use_mcp_tool({
      server_name: "reasoning-coding",
      tool_name: "check_response_status",
      arguments: { taskId }
    });

    // Example status response when complete:
    {
      "status": "complete",
      "reasoning": "...",  // If showReasoning was true
      "response": "..."    // The final response
      "error": undefined   // Will have a value if an error occurred
    }
    ```

## Development

For development with auto-rebuild:
```bash
npm run watch
```

## How It Works (Expanded)

1.  **Reasoning Stage:**
    *   The `getReasoning` function is called with the user's prompt (and potentially Cline conversation history).
    *   Based on the `REASONING_PROVIDER` environment variable, the appropriate provider-specific function (e.g., `getReasoningOpenAI`, `getReasoningGemini`) is called.
    *   The selected model (from `REASONING_MODEL`) is used to generate the reasoning.
    *   The reasoning is returned.

2.  **Response Stage:**
    *   The `getFinalResponse` function is called with the original prompt and the reasoning from the first stage.
    *   Based on the `CODING_PROVIDER` environment variable, the appropriate provider-specific function is called.
    *   The selected model (from `CODING_MODEL`) generates the final response, incorporating the reasoning.
    *   The response is returned.

3.  **MCP Handling:** The `ReasoningCodingServer` class handles the MCP communication, task management, and context management. It uses the `getReasoning` and `getFinalResponse` functions to orchestrate the two-stage process.

## License

MIT License - See LICENSE file for details.

## Credits

*   Based on the original Deepseek-Thinking-Claude-3.5-Sonnet-CLINE-MCP project.
*   Inspired by the RAT (Retrieval Augmented Thinking) concept by [Skirano](https://x.com/skirano/status/1881922469411643413).
```

Key improvements in this README:

*   **Clearer Title:**  A more descriptive title reflects the expanded functionality.
*   **Detailed Comparison:**  A dedicated section highlights the differences between the fork and the original.
*   **Comprehensive Installation:**  Instructions are more thorough, covering `.env` and `providers.json` setup.
*   **Provider/Model Explanation:**  The roles of environment variables and `providers.json` are clearly explained.
*   **Example `providers.json`:** A complete example helps users get started.
*   **Updated Usage:**  Reflects the new server name and configuration.
*   **Expanded "How It Works":**  Provides a more detailed explanation of the internal workings.
*   **Corrected filepaths:** Uses correct filepaths to the providers file
