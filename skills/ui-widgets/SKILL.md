---
name: nitrostack-ui-widgets
description: Best practices for linking tools to interactive Next.js React frontend widgets using @Widget and @nitrostack/widgets SDK (including widget-manifest.json, CSP sandboxing, state sync, bidirectional tool calling, layout controls, and strongly-typed props).
---

## When to Use
Use this skill whenever you are creating, modifying, or testing interactive Next.js React UI widgets that render custom visual cards, maps, charts, or forms inside MCP clients (like NitroStudio or AI chat panes) linked to NitroStack tools.

---

## 1. Interactive Widget Architecture

NitroStack bridges backend Node.js MCP tools to sandboxed Next.js React components via a structured `postMessage` protocol:

```text
┌────────────────────────────────────────────────────────────────────────┐
│                   NitroStack Interactive Widget Architecture           │
├────────────────────────────────────────────────────────────────────────┤
│  Client Host (Desktop Studio / AI Chat Pane)                           │
│                                │                                       │
│                                ▼                                       │
│  [ Backend Tool Method ]       ──> Decorated with @Widget({ route })   │
│  - Returns structured JSON     ──> Emits tool output to MCP Client     │
│                                │                                       │
│                                ▼                                       │
│  [ Sandboxed Iframe Runtime ]  ──> Next.js Static Export / Dev Server  │
│  - CSP & Domain Sandboxing     ──> Enforces connect/resource domains   │
│  - @nitrostack/widgets SDK     ──> Bi-directional postMessage bridge   │
│                                │                                       │
│  ┌─────────────────────────────┼─────────────────────────────┐         │
│  ▼                             ▼                             ▼         │
│  useWidgetSDK()               useWidgetState()              callTool() │
│  - Extract tool output JSON   - Synchronize UI state        - Actions  │
│  - Theme & layout metrics     - Persist across re-renders   - Links    │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Backend Tool Binding (`@Widget`)

To associate a React component with a tool, decorate the tool method with `@Widget`. You can pass either a simple route string or a comprehensive configuration object.

### Decorator Options (Object Form)

| Option | Type | Description |
| :--- | :--- | :--- |
| `route` | `string` | The route identifier matching the Next.js page (`src/widgets/app/<route>/page.tsx`). |
| `prefersBorder` | `boolean` | (Optional) Whether host client should draw a border around the widget iframe. |
| `domain` | `string` | (Optional) Allowed host domain for iframe origin restriction. |
| `csp` | `WidgetCsp` | Content Security Policy rules (`resourceDomains`, `connectDomains`, `frameDomains`). |

### Backend Controller Example with CSP Rules

```typescript
// src/catalog/catalog.tools.ts
import { ToolDecorator as Tool, Widget, ExecutionContext, z } from '@nitrostack/core';

export class CatalogTools {
  @Tool({
    name: 'get_product',
    description: 'Fetch detailed product catalog information with rich interactive card',
    inputSchema: z.object({
      id: z.string().describe('Unique product ID or SKU'),
    }),
    outputSchema: z.object({
      id: z.string(),
      name: z.string(),
      price: z.number(),
      imageUrl: z.string(),
      inStock: z.boolean(),
    }),
    examples: {
      request: { id: 'prod-100' },
      response: {
        id: 'prod-100',
        name: 'Pro Espresso Machine',
        price: 599.00,
        imageUrl: 'https://images.unsplash.com/photo-1517668808822-9ebb02f2a0e6',
        inStock: true,
      },
    },
  })
  @Widget({
    route: 'product-card',
    prefersBorder: true,
    domain: 'https://app.company.com',
    csp: {
      resourceDomains: ['https://images.unsplash.com', 'https://cdn.company.com'],
      connectDomains: ['https://api.company.com'],
      frameDomains: ['https://embed.company.com'],
    },
  })
  async getProduct(input: { id: string }, ctx: ExecutionContext) {
    ctx.logger.info(`Fetching product details: ${input.id}`);
    return {
      id: input.id,
      name: 'Pro Espresso Machine',
      price: 599.00,
      imageUrl: 'https://images.unsplash.com/photo-1517668808822-9ebb02f2a0e6',
      inStock: true,
    };
  }
}
```

---

## 3. Widget Manifest Registration (`widget-manifest.json`)

To enable Studio and host clients to discover, preview, and test widgets offline without running live tool queries, declare all widgets in `src/widgets/widget-manifest.json`:

```json
{
  "widgets": [
    {
      "uri": "product-card",
      "name": "Product Card",
      "description": "Displays rich product image, pricing details, and quick order button",
      "toolName": "get_product",
      "examples": {
        "request": {
          "id": "prod-100"
        },
        "response": {
          "id": "prod-100",
          "name": "Pro Espresso Machine",
          "price": 599.00,
          "imageUrl": "https://images.unsplash.com/photo-1517668808822-9ebb02f2a0e6",
          "inStock": true
        }
      }
    }
  ]
}
```

---

## 4. Next.js Widget Component (`src/widgets/app/<route>/page.tsx`)

Every widget is a Next.js App Router client component marked with `'use client'`.

### Complete Component Example

```tsx
// src/widgets/app/product-card/page.tsx
'use client';

import React from 'react';
import { useWidgetSDK, useWidgetState } from '@nitrostack/widgets';

interface ProductToolOutput {
  id: string;
  name: string;
  price: number;
  imageUrl: string;
  inStock: boolean;
}

interface WidgetPersistentState {
  quantity: number;
  orderStatus: 'idle' | 'ordering' | 'ordered';
}

export default function ProductCardWidget() {
  const { isReady, getToolOutput, callTool, theme } = useWidgetSDK();
  const data = getToolOutput<ProductToolOutput>();

  // Persists UI state across iframe re-renders and host page navigation
  const [state, setState] = useWidgetState<WidgetPersistentState>(() => ({
    quantity: 1,
    orderStatus: 'idle',
  }));

  if (!isReady || !data) {
    return (
      <div className="flex items-center justify-center p-6 text-sm text-zinc-500">
        Connecting to NitroStack Host...
      </div>
    );
  }

  const handleOrder = async () => {
    setState((prev) => ({ ...prev, orderStatus: 'ordering' }));
    try {
      // Invoke another backend MCP tool directly from the widget
      await callTool('add_to_cart', {
        productId: data.id,
        quantity: state.quantity,
      });
      setState((prev) => ({ ...prev, orderStatus: 'ordered' }));
    } catch {
      setState((prev) => ({ ...prev, orderStatus: 'idle' }));
    }
  };

  const isDark = theme === 'dark';

  return (
    <div
      className={`rounded-xl border p-4 transition-colors ${
        isDark
          ? 'border-zinc-800 bg-zinc-950 text-white'
          : 'border-zinc-200 bg-white text-zinc-900'
      }`}
    >
      <img
        src={data.imageUrl}
        alt={data.name}
        className="h-44 w-full rounded-lg object-cover"
      />
      <div className="mt-3 flex items-start justify-between">
        <div>
          <h2 className="text-base font-semibold">{data.name}</h2>
          <p className="text-sm font-medium text-emerald-500">${data.price.toFixed(2)}</p>
        </div>
        <span
          className={`rounded-full px-2 py-0.5 text-xs font-medium ${
            data.inStock
              ? 'bg-emerald-500/10 text-emerald-400'
              : 'bg-rose-500/10 text-rose-400'
          }`}
        >
          {data.inStock ? 'In Stock' : 'Out of Stock'}
        </span>
      </div>

      <div className="mt-4 flex items-center justify-between border-t border-zinc-200/50 pt-3 dark:border-zinc-800">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setState((s) => ({ ...s, quantity: Math.max(1, s.quantity - 1) }))}
            className="rounded border border-zinc-300 px-2 py-0.5 text-xs hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
          >
            -
          </button>
          <span className="text-xs font-semibold">{state.quantity}</span>
          <button
            onClick={() => setState((s) => ({ ...s, quantity: s.quantity + 1 }))}
            className="rounded border border-zinc-300 px-2 py-0.5 text-xs hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
          >
            +
          </button>
        </div>

        <button
          onClick={handleOrder}
          disabled={!data.inStock || state.orderStatus !== 'idle'}
          className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
        >
          {state.orderStatus === 'ordering'
            ? 'Processing...'
            : state.orderStatus === 'ordered'
              ? 'Ordered!'
              : 'Order Now'}
        </button>
      </div>
    </div>
  );
}
```

---

## 5. Strongly-Typed Widget Props (`nitrostack generate types`)

To avoid manual TypeScript interface duplication between backend Zod schemas and frontend React props:

1. Run the CLI type generation command:
   ```bash
   nitrostack generate types
   ```
2. The CLI automatically scans all `*.tools.ts` files, inspects `inputSchema` and `outputSchema` Zod definitions, and writes typed interfaces to:
   ```text
   src/widgets/types/tool-data.ts
   ```
3. Import the generated type in your widget component:
   ```tsx
   import { GetProductOutput } from '../../types/tool-data';

   const data = getToolOutput<GetProductOutput>();
   ```

---

## 6. Layout, Display Modes & SafeArea Controls

Widgets can adapt their presentation mode dynamically based on user interaction or data volume:

* `requestFullscreen()`: Expands widget across the full host viewport.
* `requestInline()`: Restores widget to standard conversational flow.
* `requestPip()`: Floats widget in Picture-in-Picture mode.
* `requestClose()`: Dismisses the widget card.
* `getSafeArea()`: Returns inset padding (`{ top, right, bottom, left }`) for notches/mobile devices.
* `maxHeight`: Maximum pixel height allocated by the host container.

```tsx
const { displayMode, maxHeight, requestFullscreen, requestInline } = useWidgetSDK();

<div style={{ maxHeight: maxHeight || 500 }}>
  <p>Current View: {displayMode}</p>
  {displayMode === 'inline' ? (
    <button onClick={requestFullscreen}>Expand Fullscreen</button>
  ) : (
    <button onClick={requestInline}>Collapse</button>
  )}
</div>
```

---

## 7. Chat Integration & Media Queries

Widgets can interact with the surrounding conversational host:

* `sendFollowUpMessage(prompt: string)`: Injects a user message directly into the active AI conversation, causing the agent to execute follow-up tasks.
* `openExternal(url: string)`: Safely opens links in the user's primary operating system browser.

### Accessibility & Device Capability Helpers
* `prefersReducedMotion()`: Returns `true` if OS prefers disabled animations.
* `isPrimarilyTouchDevice()`: Returns `true` on touchscreens (increase button hit targets to min 44px).
* `isHoverAvailable()`: Returns `true` if a pointer supports CSS hover states.
* `prefersDarkColorScheme()`: Returns `true` if host OS is set to dark theme.

```tsx
import { isPrimarilyTouchDevice, prefersReducedMotion } from '@nitrostack/widgets';

export function ActionButton({ label, onClick }: { label: string; onClick: () => void }) {
  const isTouch = isPrimarilyTouchDevice();
  const noMotion = prefersReducedMotion();

  return (
    <button
      onClick={onClick}
      style={{ minHeight: isTouch ? 44 : 32 }}
      className={`rounded bg-blue-600 px-3 text-white ${noMotion ? '' : 'transition-transform active:scale-95'}`}
    >
      {label}
    </button>
  );
}
```

---

## 8. Build & Packaging Verification

During production build (`nitrostack build`):
1. Next.js statically renders and bundles widgets into:
   ```text
   src/widgets/out/
   ```
2. NitroStack's runtime resolves `@Widget({ route: 'name' })` by reading `src/widgets/out/name.html`.
3. In Docker or standalone deployments, always ensure `src/widgets/out/` is copied alongside `dist/`.
