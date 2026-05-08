import { AgentClient } from "agents/client";
import type { AgentSummary } from "./types";

export interface AppClientOptions {
  /** Runtime API URL. Defaults to "https://agents.uclaw.dev". */
  url?: string;
}

export class Run {
  constructor(private client: AgentClient, private prompt: string) { }

  async *stream() {
    let resolveChunk: (() => void) | null = null;
    let error: Error | null = null;
    const queue: any[] = [];

    this.client.call("send", [this.prompt], {
      stream: {
        onChunk: (chunk: any) => {
          queue.push(chunk);
          if (resolveChunk) {
            resolveChunk();
            resolveChunk = null;
          }
        },
        onDone: () => {
          queue.push(null)
          if (resolveChunk) {
            resolveChunk();
            resolveChunk = null;
          }
        },
        onError: (err: any) => {
          error = err;
          if (resolveChunk) {
            resolveChunk();
            resolveChunk = null;
          }
        },
      }
    }).catch((err) => {
      error = err;
      if (resolveChunk) {
        resolveChunk();
        resolveChunk = null;
      }
    });

    while (true) {
      if (queue.length > 0) {
        const chunk = queue.shift();
        if (chunk === null) {
          return;
        }
        yield chunk;
      } else if (error) {
        throw error;
      } else {
        await new Promise<void>((resolve) => {
          resolveChunk = resolve;
        });
      }
    }
  }
}

export class AgentInstance {
  private client: AgentClient;

  constructor(url: string, public id: string) {
    const host = url.replace(/^https?:\/\//, "");
    this.client = new AgentClient({
      agent: "MyAssistant",
      name: id,
      host: host,
    });
  }

  send(prompt: string) {
    return new Run(this.client, prompt);
  }

  close() {
    this.client.close();
  }
}

export class AppClient {
  private url: string;
  private directory: AgentClient;

  constructor(options: AppClientOptions = {}) {
    this.url = options.url || "https://agents.uclaw.dev";
    const host = this.url.replace(/^https?:\/\//, "");

    this.directory = new AgentClient({
      agent: "AssistantDirectory",
      host: host,
    });
  }

  async createAgent(opts?: { title?: string }): Promise<AgentInstance> {
    const summary = (await this.directory.call("createChat", opts ? [opts] : [])) as unknown as AgentSummary;
    return new AgentInstance(this.url, summary.id);
  }

  async listAgents(): Promise<AgentSummary[]> {
    const summaries = (await this.directory.call("listChats")) as unknown as AgentSummary[];
    return summaries;
  }

  async deleteAgent(id: string): Promise<void> {
    await this.directory.call("deleteChat", [id]);
  }

  close() {
    this.directory.close();
  }
}
