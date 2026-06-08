import { AppClient } from "@uclaw/sdk";

const app = new AppClient({
  apiKey: process.env.UCLAW_API_KEY,
});

const agent = await app.agents.create({
  title: "Research agent",
  config: {
    instructions: "Be concise.",
    extensions: [
      {
        environment: "agent",
        name: "summarize_input",
        description: "Summarize a text input.",
        parameters: {
          type: "object",
          properties: {
            text: { type: "string" },
          },
          required: ["text"],
        },
        code: `
export default async function ({ text }) {
  return String(text).slice(0, 500);
}
`,
      },
    ],
  },
});

const agents = await app.agents.list();
console.log("agents", agents);

const run = await agent.run("Write a short launch checklist for this SDK.");
await run.wait({ until: "running", timeoutMs: 60_000 });

for await (const event of run.stream()) {
  console.log(event);
}

console.log(await run.getStatus());
