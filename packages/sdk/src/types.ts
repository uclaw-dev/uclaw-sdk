export interface AgentSummary {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  lastMessagePreview?: string;
}

export interface ClientToolSchema {
  name: string;
  description?: string;
  parameters?: Record<string, any>;
}

export type ToolDefinition =
  | { type: "builtin"; id: string }
  | {
      type: "http";
      name: string;
      description: string;
      endpoint: string;
      parameters: any;
      headers?: Record<string, string>;
    }
  | {
      type: "code";
      name: string;
      description: string;
      handler: string;
      parameters: any;
      source?: string;
    };

export interface AgentSpec {
  name?: string;
  title?: string;
  instructions?: string;
  model?: string;
  modelTier?: "fast" | "capable";
  tools?: ToolDefinition[];
  clientTools?: ClientToolSchema[];
  maxSteps?: number;
}

export interface AppState {
  agents: AgentSummary[];
}
