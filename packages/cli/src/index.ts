import { AppClient } from "@uclaw/sdk";

async function main() {
    const args = process.argv.slice(2);
    const command = args[0];

    if (command === "run") {
        const prompt = args.slice(1).join(" ");
        if (!prompt) {
            console.error("Usage: uclaw run <prompt>");
            process.exit(1);
        }

        console.log(`> Initializing AppClient...`);
        const app = new AppClient({ url: process.env.UCLAW_URL });

        console.log(`> Creating agent...`);
        const agent = await app.createAgent({ title: "CLI Run" });

        console.log(`> Sending prompt: "${prompt}"\n`);
        const run = agent.send(prompt);

        try {
            for await (const event of run.stream()) {
                if (event && event.type === "text-delta" && event.delta) {
                    process.stdout.write(event.delta);
                }
            }
            console.log();
        } catch (err) {
            console.error("\nRun failed:", err);
            process.exit(1);
        }

        agent.close();

        await app.deleteAgent(agent.id)
        app.close();
    } else {
        console.error("Unknown command. Usage: uclaw run <prompt>");
        process.exit(1);
    }
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
})
