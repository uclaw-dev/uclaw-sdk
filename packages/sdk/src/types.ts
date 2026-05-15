export interface AgentSummary {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  lastMessagePreview?: string;
}

export interface AgentSpec {
  name?: string;
  title?: string;
  persona?: string;
  systemPrompt?: string;
  model?: string;
  modelTier?: "fast" | "capable";
  tools?: string[];
}

export interface AppState {
  agents: AgentSummary[];
}
