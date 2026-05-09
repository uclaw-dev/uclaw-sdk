import { useCallback, useState, useMemo } from "react";
import { useAgent as useRuntimeAgent } from "agents/react";
import { useAgentChat } from "@cloudflare/ai-chat/react";
import type { OnToolCallCallback } from "@cloudflare/ai-chat/react";

const DEFAULT_URL = "https://agents.uclaw.dev";
const APP_CLASS = "UClawApp";
const AGENT_CLASS = "UClawAgent";

export interface UseAgentOptions {
  /** Runtime API URL. Defaults to "https://agents.uclaw.dev". */
  url?: string;
  /** Active chat id. */
  chatId: string;
  /** Client-side tool handlers for the active chat. */
  onToolCall?: OnToolCallCallback;
}

export interface UseAgentReturn {
  // ── Active chat (messages + streaming) ──
  chat: ReturnType<typeof useAgentChat>;

  // ── Connection status ──
  /** Active chat WebSocket status. */
  agentStatus: "connecting" | "connected" | "disconnected";
}

export function useAgent(options: UseAgentOptions): UseAgentReturn {
  const { url = DEFAULT_URL, chatId, onToolCall } = options;

  const [agentStatus, setAgentStatus] = useState<
    "connecting" | "connected" | "disconnected"
  >("connecting");

  // ── Active chat connection ────────────────────────────────────────
  const chatSub = useMemo(() => [{ agent: AGENT_CLASS, name: chatId }], [chatId]);

  const chatAgent = useRuntimeAgent({
    host: url,
    agent: APP_CLASS,
    sub: chatSub,
    onOpen: useCallback(() => setAgentStatus("connected"), []),
    onClose: useCallback(() => setAgentStatus("disconnected"), []),
  });

  const chat = useAgentChat({
    agent: chatAgent,
    onToolCall,
    experimental_throttle: 200,
  });

  return {
    chat,
    agentStatus,
  };
}
