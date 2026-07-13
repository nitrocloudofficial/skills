---
name: nitrostack-tools-resources-prompts
description: Guidelines and patterns for defining Tools, Resources, and Prompts in a NitroStack application with schema validation via Zod.
---

## When to Use
Use this skill whenever you are defining, editing, or validating tools, resources, or prompts on a NitroStack MCP server.

## Defining Tools with `@Tool`
An MCP tool exposes a function that an AI client can invoke. Decorate a service or controller method with `@Tool`.

### Key Tool Options:
* `name`: Kebab-case or snake_case unique identifier.
* `description`: Detailed description explaining when and how the client should use it.
* `inputSchema`: A Zod object schema for strict validation of inputs.
* `outputSchema` (optional): Zod schema validating the output structure.

```typescript
import { Tool, z, ExecutionContext } from '@nitrostack/core';

export class WeatherService {
  @Tool({
    name: 'get_current_weather',
    description: 'Get the current weather forecast for a specific city.',
    inputSchema: z.object({
      city: z.string().describe('The name of the city, e.g., San Francisco'),
      unit: z.enum(['celsius', 'fahrenheit']).default('celsius'),
    }),
  })
  async getWeather(
    input: { city: string; unit: 'celsius' | 'fahrenheit' },
    ctx: ExecutionContext
  ) {
    ctx.logger.info(`Fetching weather for ${input.city}`);
    // implementation
    return {
      city: input.city,
      temp: 22,
      condition: 'Sunny',
    };
  }
}
```

## Defining Resources with `@Resource`
An MCP resource exposes static or dynamic data files/URIs that the AI client can read.

### Key Resource Options:
* `uri`: URI pattern (e.g., `git://{owner}/{repo}/file` or static `app://config`).
* `name`: Unique name of the resource.
* `description`: Explanation of what data this resource provides.
* `mimeType`: Mime type of the response (e.g., `text/plain`, `application/json`).

```typescript
import { Resource, ExecutionContext } from '@nitrostack/core';

export class ConfigResources {
  @Resource({
    uri: 'app://settings',
    name: 'Application Settings',
    description: 'System-wide configuration settings and parameters.',
    mimeType: 'application/json',
  })
  async getSettings(ctx: ExecutionContext) {
    return {
      environment: 'development',
      debugMode: true,
    };
  }
}
```

## Defining Prompts with `@Prompt`
An MCP prompt exposes reusable templates or instruction sets that guide LLMs.

### Key Prompt Options:
* `name`: Name of the prompt.
* `description`: Describes what task this prompt helps accomplish.
* `arguments`: Declares parameters the client can supply to customize the prompt template.

```typescript
import { Prompt, ExecutionContext } from '@nitrostack/core';

export class PromptTemplates {
  @Prompt({
    name: 'code_review',
    description: 'Provide an intensive code review for a given code snippet.',
    arguments: [
      { name: 'language', description: 'The programming language, e.g., TypeScript', required: true },
      { name: 'code', description: 'The code snippet to review', required: true },
    ],
  })
  async getCodeReviewPrompt(
    args: { language: string; code: string },
    ctx: ExecutionContext
  ) {
    return {
      messages: [
        {
          role: 'user',
          content: `You are an expert software engineer. Review this ${args.language} code:\n\n${args.code}`,
        },
      ],
    };
  }
}
```
