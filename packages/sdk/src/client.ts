import type { AgentSummary, AgentSpec } from "./types";

export interface AppClientOptions {
  /** Runtime API URL. Defaults to "https://agents.uclaw.dev". */
  url?: string;
  /**
   * UClaw API key generated from the developer dashboard.
   *
   * Server-side only: never pass this from browser code or expose it in a
   * public bundle. Browser apps should use @uclaw/sdk/react hooks with a
   * short-lived client token instead.
   */
  apiKey?: string;
}

export class Run {
  constructor(
    private url: string,
    private apiKey: string | undefined,
    private id: string,
    private prompt: string,
  ) {}

  async *stream() {
    const url = `${this.url}/aaas/sub/u-claw-agent/${this.id}/rpc/send`;
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {}),
      },
      body: JSON.stringify([this.prompt]),
    });

    if (!response.ok) {
      throw new Error(await response.text());
    }

    const reader = response.body?.getReader();
    if (!reader) return;

    const decoder = new TextDecoder();
    let buffer = "";

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            const data = line.slice(6);
            if (data === "[DONE]") break;
            try {
              yield JSON.parse(data);
            } catch (e) {
              console.error("Error parsing SSE data:", e);
            }
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }
}

export class AgentInstance {
  constructor(
    private url: string,
    private apiKey: string | undefined,
    public id: string,
  ) {}

  async rpcCall(method: string, args: any[] = []): Promise<any> {
    const response = await fetch(`${this.url}/aaas/sub/UClawAgent/${this.id}/rpc/${method}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {}),
      },
      body: JSON.stringify(args),
    });
    if (!response.ok) {
      throw new Error(await response.text());
    }
    return response.json();
  }

  run(prompt: string) {
    return new Run(this.url, this.apiKey, this.id, prompt);
  }

  send(prompt: string) {
    return this.run(prompt);
  }

  async updateConfig(config: AgentSpec): Promise<void> {
    await this.rpcCall("updateConfig", [config]);
  }

  async currentConfig(): Promise<AgentSpec> {
    return (await this.rpcCall("currentConfig", [])) as AgentSpec;
  }
}

export class AppClient {
  private url: string;
  private apiKey?: string;

  constructor(options: AppClientOptions = {}) {
    this.url = options.url || "https://agents.uclaw.dev";
    this.apiKey = options.apiKey;
  }

  async rpcCall(method: string, args: any[] = []): Promise<any> {
    const response = await fetch(`${this.url}/aaas/rpc/${method}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {}),
      },
      body: JSON.stringify(args),
    });
    if (!response.ok) {
      throw new Error(await response.text());
    }
    try {
      return await response.json();
    } catch {
      return null;
    }
  }

  async createAgent(opts?: AgentSpec): Promise<AgentInstance> {
    const summary = (await this.rpcCall(
      "createChat",
      opts ? [opts] : [],
    )) as unknown as AgentSummary;
    return new AgentInstance(this.url, this.apiKey, summary.id);
  }

  async listAgents(): Promise<AgentSummary[]> {
    const summaries = (await this.rpcCall("listChats")) as unknown as AgentSummary[];
    return summaries;
  }

  async deleteAgent(id: string): Promise<void> {
    await this.rpcCall("deleteChat", [id]);
  }
}
