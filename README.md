# DeepSeek-Claude MCP Server

This is a simple MCP (Model Context Protocol) server that integrates with various language models, including DeepSeek and Claude (via OpenRouter), as well as OpenAI, Gemini, and Vertex AI. It provides a basic interface for generating responses using these models.

## Installation

1.  Clone this repository:

    ```bash
    git clone https://github.com/your-repo/deepseek-thinking-claude-mcp.git
    cd deepseek-thinking-claude-mcp
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
    *   `VERTEX_CLIENT_EMAIL`: Client email for Vertex AI authentication.
    *   `VERTEX_PRIVATE_KEY`: Private key for Vertex AI authentication.
3.  Configure the `REASONING_PROVIDER`, `REASONING_MODEL`, `CODING_PROVIDER`, and `CODING_MODEL` environment variables in your `.env` file to specify the default models for reasoning and coding tasks. Refer to `src/providers.json` for available providers and models.

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

**Example `generate_response` request (JSON):**

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "callTool",
  "params": {
    "name": "generate_response",
    "arguments": {
      "prompt": "Write a short story about a cat."
    }
  }
}
```

**Example `check_response_status` request (JSON):**

```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "method": "callTool",
  "params": {
    "name": "check_response_status",
    "arguments": {
      "taskId": "some-task-id"
    }
  }
}
```

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
