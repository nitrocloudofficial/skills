---
name: nitrostack-nitro-studio
description: Guide for utilizing NitroStack Studio to test MCP tools, preview React UI widgets, inspect prompts and resources, run AI Chat playgrounds, and verify OAuth 2.1 flows.
---

## When to Use
Use this skill when visually inspecting and interactively testing MCP tools, debugging Next.js React widgets in real time, interacting with tools via multi-turn LLM chat dialogues, monitoring system health telemetry, or testing OAuth 2.1 PKCE authorization flows.

---

## 1. Visual Testing Architecture

NitroStack Studio is a purpose-built developer desktop and web IDE (hosted at `https://nitrostack.ai/studio` and bundled locally at `http://localhost:3000`). It attaches to running MCP servers over standard I/O (stdio) or HTTP:

```text
┌────────────────────────────────────────────────────────────────────────┐
│                   NitroStack Studio Visual Workspace                   │
├────────────────────────────────────────────────────────────────────────┤
│  Studio Connection: STDIO (Desktop App) or HTTP :3000 (Web UI)         │
│                                │                                       │
│  ┌─────────────────────────────┼─────────────────────────────┐         │
│  ▼                             ▼                             ▼         │
│  [ Tools & Widgets Tab ]       [ AI Chat Playground ]        [ Hub ]   │
│  - Form generation from Zod    - Multi-turn LLM reasoning    - Health  │
│  - Real-time tool execution    - Gemini / OpenAI integration - OAuth   │
│  - Live React widget preview   - In-stream widget rendering  - Prompts │
│  - Example request/response    - Inspect tool call arguments - Data    │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Connecting Studio to Your MCP Server

Studio supports two connection modes depending on your operating workflow:

### Mode 1: STDIO Connection (Desktop App & Local CLI)
When developing locally using `nitrostack dev`, the MCP server runs on standard I/O.
1. In Studio, select **Connection Type**: `STDIO`.
2. Provide the absolute path to your project root or start script:
   * **Command**: `node`
   * **Arguments**: `dist/index.js`
   * **Working Directory**: `/path/to/my-mcp-server`
3. Click **Connect**. Studio launches the server process, negotiates capabilities via MCP handshake, and indexes all tools, resources, and prompts.

### Mode 2: HTTP / SSE Connection (Web UI & Cloud Containers)
When testing containerized servers or servers started with HTTP transport:
1. In Studio, select **Connection Type**: `HTTP` or `Server-Sent Events (SSE)`.
2. Provide the server endpoint:
   * Modern Streamable HTTP: `http://localhost:3000/mcp`
   * Legacy SSE: `http://localhost:3000/sse`
3. Click **Connect**.

---

## 3. Tools & Widgets Testing Tab

The **Tools Tab** is the primary workbench for inspecting and executing tools:

### Automated Input Form Generation
* Studio parses the Zod `inputSchema` declared on each `@Tool`.
* Generates interactive form fields with type validation, default values, enums, and parameter descriptions.

### Example Previews
* If `@Tool({ examples: { request, response } })` is defined, clicking **Load Example** populates the input form with the sample payload.

### Real-Time Widget Rendering
* When a tool decorated with `@Widget({ route })` is executed:
  1. Studio executes the tool and displays the raw JSON output in the response inspector.
  2. Studio concurrently mounts the mapped Next.js component from `http://localhost:3001/<route>` in a sandboxed iframe.
  3. Establishes the `postMessage` bridge: the widget renders with tool data, theme matching, and live state synchronization.

---

## 4. AI Chat Playground Tab

The **AI Chat Tab** allows you to test how frontier LLMs discover, reason about, and invoke your tools in natural conversation.

### Configuring Model Providers
1. Open the settings drawer in the chat interface.
2. Select your model provider:
   * **Google Gemini**: Gemini 2.5 Pro / Flash. Enter your Google AI API key.
   * **OpenAI**: GPT-4o / GPT-4o mini. Enter your OpenAI API key.
3. API keys are stored exclusively in your browser's encrypted local storage and are never transmitted to external telemetry servers.

### Autonomous Tool Execution & In-Stream Widgets
* Converse with the model naturally (e.g. *"Show me sales data for region CA"*).
* The model evaluates your prompt, issues tool calls against your MCP server, and receives the structured results.
* If a returned tool has a mapped `@Widget`, Studio renders the interactive React component directly inside the conversational chat stream.
* You can interact with buttons and sliders inside the rendered widget; if the widget triggers `sendFollowUpMessage()`, the message immediately appends to the conversation.

---

## 5. Resources & Prompts Inspection

### Resources Tab
* Browse all registered static URIs (e.g. `system://metrics`) and parameterized URI templates (e.g. `file://{path}`).
* Click any resource to issue a standard `resources/read` request.
* Inspect returned MIME types (`application/json`, `text/plain`, `text/markdown`) and raw content bodies.
* Inspect offloaded spillover datasets stored at `resource://data-spillover/{id}`.

### Prompts Tab
* Browse all reusable prompt templates decorated with `@Prompt`.
* Enter argument values into the parameter inputs.
* Preview the generated system and user messages rendered for LLM context injection.

---

## 6. Health & Telemetry Dashboard

The **Health Tab** monitors application health and dependency telemetry in real time:
* Connects to the auto-exposed `health://checks` MCP resource and `/health` HTTP probe.
* Displays status indicators (`up` / `down`) for all registered `@HealthCheck` providers.
* Aggregates process uptime, memory consumption, active spillover caches, and transform metrics.

---

## 7. OAuth 2.1 Verification Tab

For servers configured with `OAuthModule`:
1. Navigate to the **OAuth 2.1 Tab**.
2. Click **Discover Endpoints** (connects to port `3005` or your server's HTTP port).
3. Studio auto-populates authorization endpoints from `/.well-known/oauth-protected-resource`.
4. Enter Client ID and redirect URI.
5. Click **Start OAuth Flow**: Studio opens the provider login dialog, performs the PKCE authorization code exchange, captures the access token, and attaches the `Authorization: Bearer <token>` header to all subsequent tool executions.
