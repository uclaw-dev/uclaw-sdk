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
  /** App ID to connect to. Defaults to "default". */
  appId?: string;
}

export class Run {
  constructor(
    private url: string,
    private apiKey: string | undefined,
    private id: string,
    private prompt: string,
    private appId: string = "default",
  ) {}

  async *stream() {
    const url = `${this.url}/app/${this.appId}/sub/${this.id}/rpc/send`;
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
    private appId: string = "default",
  ) {}

  async rpcCall(method: string, args: any[] = []): Promise<any> {
    const response = await fetch(`${this.url}/app/${this.appId}/sub/${this.id}/rpc/${method}`, {
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
    return new Run(this.url, this.apiKey, this.id, prompt, this.appId);
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
  private appId: string;

  constructor(options: AppClientOptions = {}) {
    this.url = options.url || "https://agents.uclaw.dev";
    this.apiKey = options.apiKey;
    this.appId = options.appId || "default";
  }

  async rpcCall(method: string, args: any[] = []): Promise<any> {
    const response = await fetch(`${this.url}/app/${this.appId}/rpc/${method}`, {
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
      "createAgent",
      opts ? [opts] : [],
    )) as unknown as AgentSummary;
    return new AgentInstance(this.url, this.apiKey, summary.id, this.appId);
  }

  async listAgents(): Promise<AgentSummary[]> {
    const summaries = (await this.rpcCall("listAgents")) as unknown as AgentSummary[];
    return summaries;
  }

  async deleteAgent(id: string): Promise<void> {
    await this.rpcCall("deleteAgent", [id]);
  }

  async generateText(
    prompt: string,
    opts?: { model?: string; systemPrompt?: string; modelTier?: "fast" | "capable" },
  ): Promise<string> {
    return (await this.rpcCall("generateText", [prompt, opts])) as string;
  }

  async *streamText(
    prompt: string,
    opts?: { model?: string; systemPrompt?: string; modelTier?: "fast" | "capable" },
  ): AsyncGenerator<string> {
    const url = `${this.url}/app/${this.appId}/rpc/streamText`;
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {}),
      },
      body: JSON.stringify([prompt, opts]),
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
              const parsed = JSON.parse(data);
              if (parsed.type === "text-delta" && parsed.delta) {
                yield parsed.delta;
              } else if (parsed.type === "error" && parsed.errorText) {
                throw new Error(parsed.errorText);
              }
            } catch (e) {
              if (e instanceof Error) throw e;
            }
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }
}
