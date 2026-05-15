import { AppClient } from "@uclaw/sdk";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

const CONFIG_PATH = join(homedir(), ".uclaw", "config");

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  if (command === "login") {
    const keyFlagIndex = args.indexOf("--api-key");
    const apiKey = keyFlagIndex >= 0 ? args[keyFlagIndex + 1] : undefined;
    if (!apiKey) {
      console.error("Usage: uclaw login --api-key <uc_live_...>");
      process.exit(1);
    }
    mkdirSync(dirname(CONFIG_PATH), { recursive: true });
    writeFileSync(CONFIG_PATH, `${apiKey}\n`, "utf8");
    console.log(`Saved API key to ${CONFIG_PATH}`);
  } else if (command === "run") {
    const prompt = args.slice(1).join(" ");
    if (!prompt) {
      console.error("Usage: uclaw run <prompt>");
      process.exit(1);
    }

    const apiKey = process.env.UCLAW_API_KEY || readApiKey();
    if (!apiKey) {
      console.error(
        "Missing API key. Set UCLAW_API_KEY or run: uclaw login --api-key <uc_live_...>",
      );
      process.exit(1);
    }

    console.log(`> Initializing AppClient...`);
    const app = new AppClient({ url: process.env.UCLAW_URL, apiKey });

    console.log(`> Creating agent...`);
    const agent = await app.createAgent({ name: "CLI Run" });

    console.log(`> Sending prompt: "${prompt}"\n`);
    const run = agent.send(prompt);

    try {
      for await (const event of run.stream()) {
        if (event && event.type === "text-delta" && event.delta) {
          process.stdout.write(event.delta);
        }
        if (event && event.type === "error") {
          console.error(event.errorText);
          process.exit(1);
        }
      }
      console.log("\n");
    } catch (err) {
      console.error("\nRun failed:", err);
      process.exit(1);
    } finally {
      await app.deleteAgent(agent.id);
    }
  } else {
    console.error("Unknown command. Usage: uclaw login --api-key <key> | uclaw run <prompt>");
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

function readApiKey(): string | undefined {
  try {
    return readFileSync(CONFIG_PATH, "utf8").trim() || undefined;
  } catch {
    return undefined;
  }
}
