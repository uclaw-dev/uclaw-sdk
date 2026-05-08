/**
 * Shared types between uclaw-sdk and uclaw-runtime.
 * Duplicated here so the SDK has no dependency on the runtime.
 */

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
