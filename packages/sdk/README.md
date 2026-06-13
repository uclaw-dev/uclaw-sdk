# @uclaw/sdk

The official TypeScript SDK for UClaw — a managed runtime for stateful AI agents. Build production-ready agentic applications without managing WebSocket connections, SQLite session states, or sandbox execution environment.

## Installation

```bash
npm install @uclaw/sdk
```

---

## Usage

### 1. Server-Side Execution (`AppClient`)

Use `AppClient` in server-side scripts, APIs, or background jobs. It authenticates using your UClaw API Key.

```typescript
import { AppClient } from "@uclaw/sdk";

const app = new AppClient({
  apiKey: process.env.UCLAW_API_KEY, // Default fallback is process.env.UCLAW_API_KEY
  appId: "default",
});

// 1. Create a stateful agent session
const agent = await app.agents.create({
  title: "Travel Researcher",
  config: {
    modelTier: "fast",
    instructions: "You are a travel researcher. Suggest top spots.",
  },
});

// 2. Run a prompt and stream the response
const run = await agent.run("Plan a 3-day itinerary for Tokyo.");
for await (const event of run.stream()) {
  if (event.type === "text-delta" && event.delta) {
    process.stdout.write(event.delta);
  }
}
```

### 2. Next.js / Server Route Handler (Client Token Exchange)

To allow browser-side React hooks to connect to the runtime securely, you must expose an endpoint on your server to exchange your master API key for short-lived client tokens.

In Next.js App Router, create a catch-all route at `app/api/uclaw/[...all]/route.ts`:

```typescript
import { AppClient } from "@uclaw/sdk";

const app = new AppClient({
  apiKey: process.env.UCLAW_API_KEY,
});

// Automatically serves POST /api/uclaw/client-tokens
export const POST = (request: Request) => app.handler(request);
```

### 3. React Hooks (`@uclaw/sdk/react`)

Use React hooks in the browser to interact with agents in real-time. By default, the hooks will fetch client tokens automatically from your local `/api/uclaw/client-tokens` endpoint.

```tsx
import { useApp, useAgent } from "@uclaw/sdk/react";
import { useState } from "react";

export function ChatApp() {
  const [activeAgentId, setActiveAgentId] = useState<string | null>(null);

  // Manage agent directories (create, delete, list)
  const { agents, createAgent, status } = useApp({ appId: "default" });

  const handleCreate = async () => {
    const agent = await createAgent({ title: "New Assistant" });
    setActiveAgentId(agent.id);
  };

  return (
    <div>
      <button onClick={handleCreate} disabled={status !== "connected"}>
        New Chat
      </button>

      {agents.map((a) => (
        <button key={a.id} onClick={() => setActiveAgentId(a.id)}>
          {a.title}
        </button>
      ))}

      {activeAgentId && <ChatPane agentId={activeAgentId} />}
    </div>
  );
}

function ChatPane({ agentId }: { agentId: string }) {
  const [input, setInput] = useState("");
  const { chat, status } = useAgent({ agentId });

  const handleSend = (e: React.FormEvent) => {
    e.preventDefault();
    chat.sendMessage({
      role: "user",
      parts: [{ type: "text", text: input }],
    });
    setInput("");
  };

  return (
    <div>
      <p>Connection: {status}</p>
      <div className="messages">
        {chat.messages.map((m) => (
          <p key={m.id}>
            {m.role}: {m.parts.map((p) => p.text).join("")}
          </p>
        ))}
      </div>
      <form onSubmit={handleSend}>
        <input value={input} onChange={(e) => setInput(e.target.value)} />
        <button type="submit">Send</button>
      </form>
    </div>
  );
}
```

---

## Documentation & Resources

- **Console & Keys**: [https://uclaw.dev](https://uclaw.dev)
- **Documentation**: [https://uclaw.dev/docs](https://uclaw.dev/docs)
- **Examples & Cookbooks**: Check out the `@uclaw/sdk` examples in the [`uclaw-cookbook`](https://github.com/uclaw-dev/uclaw-cookbook) repo.
