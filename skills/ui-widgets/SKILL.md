---
name: nitrostack-ui-widgets
description: Best practices for linking tools to interactive frontend widgets using @Widget and @nitrostack/widgets React hook.
---

## When to Use
Use this skill when designing, building, or modifying interactive user interface widgets that display custom React content inside AI clients or NitroStudio.

---

## 1. Backend Definition (`@Widget`)
To display a React-based widget for a tool's output, decorate the tool method with `@Widget`.

### Options:
* **String Route**: A simple string representing the route identifier in the frontend React app (e.g. `'product-card'`).
* **Object Route**: Object including:
  * `route` (required): The route path.
  * `domain` (optional): Allowed sandbox domain.
  * `csp` (optional): Content Security Policy guidelines.

### Example:
```typescript
import { Tool, Widget, z } from '@nitrostack/core';

export class CatalogTools {
  @Tool({
    name: 'fetch_product',
    description: 'Get product information by barcode.',
    inputSchema: z.object({ barcode: z.string() }),
  })
  @Widget('product-details') // Maps to the "product-details" frontend component
  async fetchProduct(input: { barcode: string }) {
    return {
      name: 'Super Nitro Energy Drink',
      price: 2.99,
      sku: input.barcode,
    };
  }
}
```

---

## 2. Frontend React Widget (`@nitrostack/widgets`)
In your React widget frontend application (typically a Next.js client component), use the `useWidgetSDK` hook to receive input data from the client host.

### React Component Example:
```tsx
'use client';

import React from 'react';
import { useWidgetSDK } from '@nitrostack/widgets';

interface ProductData {
  name: string;
  price: number;
  sku: string;
}

export default function ProductDetailsWidget() {
  const { isReady, getToolOutput, theme } = useWidgetSDK();
  const data = getToolOutput<ProductData>();

  if (!isReady) {
    return <div className="loading">Connecting to host...</div>;
  }

  if (!data) {
    return <div className="error">No product data received.</div>;
  }

  return (
    <div className={`product-card ${theme === 'dark' ? 'dark' : 'light'}`}>
      <h3>{data.name}</h3>
      <p className="price">${data.price.toFixed(2)}</p>
      <span className="sku">SKU: {data.sku}</span>
    </div>
  );
}
```

---

## 3. Testing Widgets
* Open your project in **NitroStudio** for visual preview.
* Invoke the tool from the AI chat or testing pane to verify the widget updates instantly with the returned JSON structure.
