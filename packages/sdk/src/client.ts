import type {
  AgentConfig,
  AgentSummary,
  AppClientOptions,
  CreateAgentInput,
  RunEvent,
  RunState,
  RunStatus,
  RunStreamOptions,
  RunWaitOptions,
  SecretInfo,
  TextGenerationOptions,
  UClawErrorShape,
} from "./types";

const DEFAULT_URL = "https://agents.uclaw.dev";
const TERMINAL_STATUSES = new Set<RunStatus>(["succeeded", "failed", "cancelled"]);

type RpcArgs = unknown[];

export class UClawError extends Error implements UClawErrorShape {
  code: string;
  status?: number;
  responseText?: string;

  constructor(input: UClawErrorShape & { responseText?: string }) {
    super(input.message);
    this.name = "UClawError";
    this.code = input.code;
    this.status = input.status;
    this.responseText = input.responseText;
  }
}

export class AppClient {
  readonly agents: AgentsResource;
  readonly secrets: SecretsResource;
  private transport: RuntimeTransport;

  constructor(options: AppClientOptions = {}) {
    this.transport = new RuntimeTransport(options);
    this.agents = new AgentsResource(this.transport);
    this.secrets = new SecretsResource(this.transport);
  }

  async generateText(prompt: string, opts?: TextGenerationOptions): Promise<string> {
    return await this.transport.appRpc<string>("generateText", [prompt, opts]);
  }

  async *streamText(prompt: string, opts?: TextGenerationOptions): AsyncGenerator<string> {
    const response = await this.transport.appStream("streamText", [prompt, opts]);

    for await (const data of readSse(response)) {
      const parsed = parseJson(data);
      if (isErrorEvent(parsed)) {
        throw new UClawError({ code: "stream_error", message: parsed.errorText });
      }
      if (isTextDeltaEvent(parsed)) {
        yield parsed.delta;
      }
    }
  }

  async handler(request: Request): Promise<Response> {
    return await this.transport.handleRequest(request);
  }
}

export class AgentsResource {
  constructor(private transport: RuntimeTransport) {}

  async create(input: CreateAgentInput = {}): Promise<AgentClient> {
    const summary = await this.transport.appRpc<AgentSummary>("createAgent", [input]);
    return new AgentClient(this.transport, this, summary.id);
  }

  async list(): Promise<AgentSummary[]> {
    return await this.transport.appRpc<AgentSummary[]>("listAgents");
  }

  get(agentId: string): AgentClient {
    return new AgentClient(this.transport, this, agentId);
  }

  async rename(agentId: string, title: string): Promise<void> {
    await this.transport.appRpc("renameAgent", [agentId, title]);
  }

  async delete(agentId: string): Promise<void> {
    await this.transport.appRpc("deleteAgent", [agentId]);
  }
}

export class SecretsResource {
  constructor(private transport: RuntimeTransport) {}

  async add(key: string, value: string, options?: { allowedHosts?: string[] }): Promise<void> {
    await this.transport.appRpc("addSecret", [key, value, options]);
  }

  async list(): Promise<SecretInfo[]> {
    return await this.transport.appRpc<SecretInfo[]>("listSecrets");
  }

  async remove(key: string): Promise<void> {
    await this.transport.appRpc("removeSecret", [key]);
  }
}

export class AgentClient {
  constructor(
    private transport: RuntimeTransport,
    private agents: AgentsResource,
    readonly id: string,
  ) {}

  async run(input: string): Promise<Run> {
    const run = new Run(this.transport, this.id, input);
    run.start();
    return run;
  }

  async updateConfig(patch: AgentConfig): Promise<AgentConfig> {
    return await this.transport.agentRpc<AgentConfig>(this.id, "updateConfig", [patch]);
  }

  async currentConfig(): Promise<AgentConfig> {
    return await this.transport.agentRpc<AgentConfig>(this.id, "currentConfig");
  }

  async rename(title: string): Promise<void> {
    await this.agents.rename(this.id, title);
  }
}

export class Run {
  readonly id = crypto.randomUUID();
  private state: RunState;
  private waiters = new Set<() => void>();
  private streamClosed = false;

  constructor(
    private transport: RuntimeTransport,
    agentId: string,
    private input: string,
  ) {
    const now = Date.now();
    this.state = {
      id: this.id,
      agentId,
      status: "queued",
      createdAt: now,
      updatedAt: now,
      events: [],
    };
  }

  start(): void {
    void this.consume();
  }

  async getStatus(): Promise<RunState> {
    return this.snapshot();
  }

  async wait(options: RunWaitOptions = {}): Promise<RunState> {
    const until = normalizeUntil(options.until);
    const deadline = options.timeoutMs === undefined ? undefined : Date.now() + options.timeoutMs;

    while (!until.has(this.state.status)) {
      if (this.state.status === "failed") {
        throw toError(this.state.error);
      }
      if (TERMINAL_STATUSES.has(this.state.status) && !until.has(this.state.status)) {
        return this.snapshot();
      }
      if (deadline !== undefined && Date.now() >= deadline) {
        throw new UClawError({
          code: "timeout",
          message: `Run ${this.id} did not reach the requested status before timeout.`,
        });
      }

      await this.nextChange(deadline);
    }

    return this.snapshot();
  }

  async *stream(options: RunStreamOptions = {}): AsyncGenerator<RunEvent> {
    let index = this.indexAfter(options.after);

    while (true) {
      while (index < this.state.events.length) {
        if (options.signal?.aborted) return;
        yield this.state.events[index]!;
        index += 1;
      }

      if (this.streamClosed || TERMINAL_STATUSES.has(this.state.status)) {
        return;
      }

      await this.nextChange(undefined, options.signal);
    }
  }

  private async consume(): Promise<void> {
    try {
      const response = await this.transport.agentStream(this.state.agentId, "send", [this.input]);
      this.setStatus("running");

      for await (const data of readSse(response)) {
        const event = parseJson(data);
        this.pushEvent(event as RunEvent);
        if (isErrorEvent(event)) {
          throw new UClawError({ code: "stream_error", message: event.errorText });
        }
      }

      this.streamClosed = true;
      this.setStatus("succeeded");
    } catch (error) {
      this.streamClosed = true;
      const uclawError = toError(error);
      this.state.error = {
        code: uclawError.code,
        message: uclawError.message,
        status: uclawError.status,
      };
      this.setStatus("failed");
    }
  }

  private pushEvent(event: RunEvent): void {
    this.state.events.push(event);
    this.touch();
  }

  private setStatus(status: RunStatus): void {
    this.state.status = status;
    if (TERMINAL_STATUSES.has(status)) {
      this.state.completedAt = Date.now();
    }
    this.touch();
  }

  private touch(): void {
    this.state.updatedAt = Date.now();
    for (const notify of this.waiters) notify();
  }

  private snapshot(): RunState {
    return {
      ...this.state,
      events: [...this.state.events],
      error: this.state.error ? { ...this.state.error } : undefined,
    };
  }

  private nextChange(deadline?: number, signal?: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
      if (signal?.aborted) {
        resolve();
        return;
      }

      let timeout: ReturnType<typeof setTimeout> | undefined;
      const cleanup = () => {
        this.waiters.delete(done);
        if (timeout) clearTimeout(timeout);
        signal?.removeEventListener("abort", done);
      };
      const done = () => {
        cleanup();
        resolve();
      };

      this.waiters.add(done);
      signal?.addEventListener("abort", done, { once: true });

      if (deadline !== undefined) {
        const remaining = Math.max(0, deadline - Date.now());
        timeout = setTimeout(() => {
          cleanup();
          reject(
            new UClawError({
              code: "timeout",
              message: `Run ${this.id} did not change before timeout.`,
            }),
          );
        }, remaining);
      }
    });
  }

  private indexAfter(after: RunStreamOptions["after"]): number {
    if (after === undefined) return 0;
    if (typeof after === "number") return Math.max(0, after);
    const index = this.state.events.findIndex((event) => getEventId(event) === after);
    return index === -1 ? 0 : index + 1;
  }
}

class RuntimeTransport {
  readonly url: string;
  readonly appId: string;
  private apiKey?: string;

  constructor(options: AppClientOptions = {}) {
    this.url = trimTrailingSlash(options.url || DEFAULT_URL);
    this.apiKey = options.apiKey;
    this.appId = options.appId || "default";
  }

  async appRpc<T = unknown>(method: string, args: RpcArgs = []): Promise<T> {
    const response = await this.rpcResponse(`${this.appPath()}/rpc/${method}`, args);
    return await parseRpcJson<T>(response);
  }

  async agentRpc<T = unknown>(agentId: string, method: string, args: RpcArgs = []): Promise<T> {
    const response = await this.rpcResponse(`${this.agentPath(agentId)}/rpc/${method}`, args);
    return await parseRpcJson<T>(response);
  }

  async appStream(method: string, args: RpcArgs): Promise<Response> {
    return await this.rpcResponse(`${this.appPath()}/rpc/${method}`, args);
  }

  async agentStream(agentId: string, method: string, args: RpcArgs): Promise<Response> {
    return await this.rpcResponse(`${this.agentPath(agentId)}/rpc/${method}`, args);
  }

  async handleRequest(request: Request): Promise<Response> {
    if (request.method !== "POST") {
      return new Response(JSON.stringify({ error: "Method Not Allowed" }), {
        status: 405,
        headers: { "Content-Type": "application/json" },
      });
    }

    const url = new URL(request.url);
    if (!url.pathname.endsWith("/client-tokens")) {
      return new Response(JSON.stringify({ error: "Not Found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }

    const apiKey =
      this.apiKey ?? (typeof process !== "undefined" ? process.env.UCLAW_API_KEY : undefined);
    if (!apiKey) {
      return new Response(JSON.stringify({ error: "UCLAW_API_KEY is not configured" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }

    let targetAppId = this.appId;
    try {
      const body = await request.clone().json();
      if (body && typeof body === "object" && "appId" in body && typeof body.appId === "string") {
        targetAppId = body.appId;
      }
    } catch {
      // ignore parsing errors
    }

    try {
      const response = await fetch("https://api.uclaw.dev/v1/client-tokens", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ appId: targetAppId }),
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        return new Response(
          JSON.stringify({ error: data.error ?? "Failed to create UClaw client token" }),
          {
            status: response.status,
            headers: { "Content-Type": "application/json" },
          },
        );
      }

      return new Response(
        JSON.stringify({
          token: data.token,
          expiresAt: data.expiresAt,
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );
    } catch (err: any) {
      return new Response(JSON.stringify({ error: err.message || "Internal Server Error" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }
  }

  private async rpcResponse(path: string, args: RpcArgs): Promise<Response> {
    const response = await fetch(`${this.url}${path}`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(args),
    });

    if (!response.ok) {
      throw await responseError(response);
    }

    return response;
  }

  private headers(): Record<string, string> {
    return {
      "Content-Type": "application/json",
      ...(this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {}),
    };
  }

  private appPath(): string {
    return `/app/${this.appId}`;
  }

  private agentPath(agentId: string): string {
    return `${this.appPath()}/sub/${agentId}`;
  }
}

async function parseRpcJson<T>(response: Response): Promise<T> {
  const text = await response.text();
  if (!text) return null as T;
  return JSON.parse(text) as T;
}

async function responseError(response: Response): Promise<UClawError> {
  const responseText = await response.text();
  const parsed = parseJson(responseText);
  if (isGatewayError(parsed)) {
    return new UClawError({
      code: parsed.error.code,
      message: parsed.error.message,
      status: response.status,
      responseText,
    });
  }
  return new UClawError({
    code: `http_${response.status}`,
    message: responseText || response.statusText,
    status: response.status,
    responseText,
  });
}

async function* readSse(response: Response): AsyncGenerator<string> {
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
        if (!line.startsWith("data: ")) continue;
        const data = line.slice(6);
        if (data === "[DONE]") return;
        yield data;
      }
    }
  } finally {
    reader.releaseLock();
  }
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

function isGatewayError(value: unknown): value is { error: { code: string; message: string } } {
  return (
    typeof value === "object" &&
    value !== null &&
    "error" in value &&
    typeof (value as { error?: unknown }).error === "object" &&
    (value as { error: { code?: unknown; message?: unknown } }).error !== null &&
    typeof (value as { error: { code?: unknown } }).error.code === "string" &&
    typeof (value as { error: { message?: unknown } }).error.message === "string"
  );
}

function isErrorEvent(value: unknown): value is { type: "error"; errorText: string } {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { type?: unknown }).type === "error" &&
    typeof (value as { errorText?: unknown }).errorText === "string"
  );
}

function isTextDeltaEvent(value: unknown): value is { type: "text-delta"; delta: string } {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { type?: unknown }).type === "text-delta" &&
    typeof (value as { delta?: unknown }).delta === "string"
  );
}

function normalizeUntil(until: RunWaitOptions["until"]): Set<RunStatus> {
  if (until === undefined) return new Set(TERMINAL_STATUSES);
  return new Set(Array.isArray(until) ? until : [until]);
}

function toError(error: unknown): UClawError {
  if (error instanceof UClawError) return error;
  if (error instanceof Error) {
    return new UClawError({ code: "unknown", message: error.message });
  }
  return new UClawError({ code: "unknown", message: String(error) });
}

function getEventId(event: RunEvent): string | undefined {
  if (typeof event !== "object" || event === null || !("id" in event)) return undefined;
  const id = (event as { id?: unknown }).id;
  return typeof id === "string" ? id : undefined;
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}
