# NitroStack SDK Agent Skills

This repository is the official registry for **NitroStack Agent Skills**. These skills provide instructions, guidelines, and domain knowledge for AI coding assistants (like Cursor, Claude Code, Gemini CLI, etc.) to help developers build and manage production-ready Model Context Protocol (MCP) servers using the NitroStack SDK.

## Repository Structure

All agent skills are stored within the `skills/` directory:

- [mcp-app-architecture](skills/mcp-app-architecture/SKILL.md): App initialization, modules, dependency injection, and lifecycles.
- [tools-resources-prompts](skills/tools-resources-prompts/SKILL.md): Defining type-safe `@Tool`, `@Resource`, and `@Prompt` annotations.
- [middleware-pipeline](skills/middleware-pipeline/SKILL.md): Custom and built-in guards, interceptors, pipes, and filters.
- [ui-widgets](skills/ui-widgets/SKILL.md): Rendering React components inside tool outputs via `@Widget`.
- [auth-security](skills/auth-security/SKILL.md): Caching, JWT, OAuth 2.1, and API key authentication.
