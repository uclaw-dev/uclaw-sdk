# UClaw SDK

The official TypeScript SDK monorepo for [UClaw](https://uclaw.dev), a managed runtime for durable AI agents.

## Packages

- [`@uclaw/sdk`](./packages/sdk): production SDK for server-side `AppClient` usage and browser-safe React hooks.

## Quick Start

```bash
npm install @uclaw/sdk
```

```ts
import { AppClient } from "@uclaw/sdk";

const app = new AppClient({
  apiKey: process.env.UCLAW_API_KEY,
});

const agent = await app.agents.create({
  config: {
    instructions: "You are a helpful assistant.",
    modelTier: "fast",
  },
});

const run = await agent.run("Draft a launch checklist.");

for await (const event of run.stream()) {
  if (event.type === "text-delta") {
    process.stdout.write(event.delta);
  }
}
```

## Development

```bash
bun install
bun run build
bun run tc
```

## Links

- Documentation: <https://uclaw.dev/docs>
- Quickstart: <https://uclaw.dev/docs/quickstart>
- API reference: <https://api.uclaw.dev/reference>
- Community: <https://discord.gg/jWbnM2Fs5>
