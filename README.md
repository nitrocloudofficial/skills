# NitroStack Agent Skills

This repository is the official registry for **NitroStack Agent Skills** (`@nitrostack/skills`). These skills provide instructions, guidelines, and domain knowledge for AI coding assistants (Cursor, Claude Code, Gemini CLI, Google Antigravity, GitHub Copilot, OpenCode, Codex) building production Model Context Protocol (MCP) servers with the NitroStack SDK.

---

## Multi-Agent Distribution

```text
┌────────────────────────────────────────────────────────────────────────┐
│                   Multi-Agent Distribution Matrix                      │
├────────────────────────────────────────────────────────────────────────┤
│  Cloned Source: https://github.com/nitrocloudofficial/skills.git       │
│  Registry Package: @nitrostack/skills v2.0.0 (12 Skills Total)         │
│                                │                                       │
│                                ▼                                       │
│  [ NitroStack CLI Installer / Upgrader ]                               │
│  - Automatically discovers all subdirectories in skills/               │
│  - Maps and copies skills into agent-specific config directories:      │
│                                                                        │
│  ┌───────────────────────┬───────────────────────┬──────────────────┐  │
│  │ Agent                 │ Scope                 │ Target Directory │  │
│  ├───────────────────────┼───────────────────────┼──────────────────┤  │
│  │ Cursor Agent          │ Project & Global      │ .cursor/skills   │  │
│  │ Claude Code           │ Project & Global      │ .claude/skills   │  │
│  │ Gemini CLI            │ Project & Global      │ .gemini/skills   │  │
│  │ Google Antigravity    │ Project & Global      │ .antigravity/... │  │
│  │ GitHub Copilot Agent  │ Project & Global      │ .copilot/skills  │  │
│  │ OpenCode Agent        │ Project & Global      │ .opencode/skills │  │
│  │ Codex                 │ Project & Global      │ .codex/skills    │  │
│  │ Workspace Agents      │ Project               │ .agents/skills   │  │
│  └───────────────────────┴───────────────────────┴──────────────────┘  │
└────────────────────────────────────────────────────────────────────────┘
```

---

## Installation

### Via NitroStack CLI (Recommended)
Skills are installed automatically when initializing or upgrading a project:

```bash
# Scaffold new project with skills auto-installed
npx @nitrostack/cli init my-server

# Upgrade existing project skills to the latest registry version
nitrostack upgrade
```

### Via Skills CLI
```bash
npx skills add nitrocloudofficial/skills
```

---

## Skills Catalog

| Skill | Description |
| :--- | :--- |
| [mcp-app-architecture](skills/mcp-app-architecture/SKILL.md) | App initialization, DI container, factory bootstrap, lifecycles, and events. |
| [tools-resources-prompts](skills/tools-resources-prompts/SKILL.md) | Tools, Resources, Prompts, Examples, Tasks, and Multi Round-Trip Requests (SEP-2322). |
| [middleware-pipeline](skills/middleware-pipeline/SKILL.md) | Guards, Interceptors, Pipes, Filters, and ExecutionContext reference. |
| [ui-widgets](skills/ui-widgets/SKILL.md) | Interactive Next.js React widgets, state sync, and manifest schema. |
| [auth-security](skills/auth-security/SKILL.md) | JWT, API Keys, OAuth 2.1 (PKCE & CIMD), and Role-Based Access Control. |
| [transforms-pipeline](skills/transforms-pipeline/SKILL.md) | BM25 progressive search, sandboxed QuickJS WASM Code Mode, and visibility. |
| [data-spillover](skills/data-spillover/SKILL.md) | Large payload spillover to disk/memory and context window protection. |
| [cli-workflow-generators](skills/cli-workflow-generators/SKILL.md) | CLI commands, preset templates, 12 code generators, and dev servers. |
| [testing-quality](skills/testing-quality/SKILL.md) | Unit and integration testing via @nitrostack/core/testing, mock contexts, and spies. |
| [health-monitoring](skills/health-monitoring/SKILL.md) | Application health monitoring via @HealthCheck, health://checks resource, and /health probe. |
| [deployment-transports](skills/deployment-transports/SKILL.md) | Modern Streamable HTTP (/mcp), legacy SSE (/sse), Docker, and Cloud. |
| [nitro-studio](skills/nitro-studio/SKILL.md) | Interactive visual testing, widget preview, and AI chat in NitroStudio. |
