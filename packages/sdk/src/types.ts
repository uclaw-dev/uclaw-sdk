import type { JSONSchema7, UIMessageChunk } from "ai";

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

export interface AgentSummary {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  lastMessagePreview?: string;
}

export interface AppState {
  agents: AgentSummary[];
}

export interface CreateAgentInput {
  title?: string;
  config?: AgentConfig;
}

export interface AgentConfig {
  modelProvider?: string;
  modelTier?: "fast" | "balanced" | "capable";
  model?: string;
  instructions?: string;
  maxSteps?: number;
  extensions?: ExtensionDefinition[];
  capabilities?: CapabilityDefinition[];
}

export type Environment = "agent" | "app";

export interface ExtensionDefinition {
  environment?: Environment;
  name: string;
  description?: string;
  parameters?: JsonSchema;
  code?: string;
}

export type Capability =
  | "read"
  | "write"
  | "execute"
  | "database"
  | "network"
  | "secret"
  | "browser";

export type CapabilityDefinition =
  | Capability
  | {
      environment?: Environment;
      capabilities: Capability[];
    };

export type RunStatus =
  | "queued"
  | "running"
  | "requires_action"
  | "succeeded"
  | "failed"
  | "cancelled";

export type RunEvent = UIMessageChunk;

export interface RunState {
  id: string;
  agentId: string;
  status: RunStatus;
  createdAt: number;
  updatedAt: number;
  completedAt?: number;
  events: RunEvent[];
  output?: unknown;
  error?: UClawErrorShape;
}

export interface RunWaitOptions {
  until?: RunStatus | RunStatus[];
  timeoutMs?: number;
  pollIntervalMs?: number;
}

export interface RunStreamOptions {
  after?: number | string;
  signal?: AbortSignal;
}

export type JsonSchema = JSONSchema7;

export interface UClawErrorShape {
  code: string;
  message: string;
  status?: number;
}

export interface TextGenerationOptions {
  model?: string;
  modelProvider?: string;
  instructions?: string;
  modelTier?: "fast" | "balanced" | "capable";
  reasoning?: ReasoningOptions;
}

export type ReasoningOptions =
  | "none"
  | "provider-default"
  | "minimal"
  | "low"
  | "medium"
  | "high"
  | "xhigh";

export interface SecretInfo {
  name: string;
  options?: {
    allowedHosts?: string[];
  };
}
