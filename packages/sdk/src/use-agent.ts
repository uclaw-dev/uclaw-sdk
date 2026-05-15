import type { OnToolCallCallback } from "@cloudflare/ai-chat/react";

import { useAgentChat } from "@cloudflare/ai-chat/react";
import { useAgent as useRuntimeAgent } from "agents/react";
import { useCallback, useState, useMemo, useRef } from "react";

import type { AgentSpec } from "./types";

const DEFAULT_URL = "https://agents.uclaw.dev";
const APP_CLASS = "UClawApp";
const AGENT_CLASS = "UClawAgent";

export interface UseAgentOptions {
  /** Runtime API URL. Defaults to "https://agents.uclaw.dev". */
  url?: string;
  /** Active chat id. */
  chatId: string;
  /** Short-lived client token issued by a trusted backend. */
  token?: string;
  /** Fetches a short-lived client token from the host app backend. */
  getToken?: () => Promise<string>;
  /** Client-side tool handlers for the active chat. */
  onToolCall?: OnToolCallCallback;
}

export interface UseAgentReturn {
  // ── Active chat (messages + streaming) ──
  chat: ReturnType<typeof useAgentChat>;

  // ── Connection status ──
  /** Active chat WebSocket status. */
  agentStatus: "connecting" | "connected" | "disconnected";
  /** Update agent configuration. */
  updateConfig: (config: AgentSpec) => Promise<void>;
  /** Get current agent configuration. */
  currentConfig: () => Promise<AgentSpec>;
}

export function useAgent(options: UseAgentOptions): UseAgentReturn {
  const { getToken, token, url = DEFAULT_URL, chatId, onToolCall } = options;

  const [agentStatus, setAgentStatus] = useState<"connecting" | "connected" | "disconnected">(
    "connecting",
  );

  // ── Active chat connection ────────────────────────────────────────
  const chatSub = useMemo(() => [{ agent: AGENT_CLASS, name: chatId }], [chatId]);
  const query = useMemo(
    () => (getToken ? async () => ({ token: await getToken() }) : token ? { token } : undefined),
    [getToken, token],
  );

  const chatAgent = useRuntimeAgent({
    host: url,
    agent: APP_CLASS,
    basePath: "aaas",
    query,
    sub: chatSub,
    onOpen: useCallback(() => setAgentStatus("connected"), []),
    onClose: useCallback(() => {
      setAgentStatus("disconnected");
      const error = new Error("Connection closed");
      for (const pending of pendingCallsRef.current.values()) {
        pending.reject(error);
      }
      pendingCallsRef.current.clear();
    }, []),
    onMessage: useCallback((event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === "rpc-response") {
          const pending = pendingCallsRef.current.get(data.id);
          if (pending) {
            if (data.error) {
              pending.reject(new Error(data.error));
            } else {
              pending.resolve(data.result);
            }
            pendingCallsRef.current.delete(data.id);
          }
        }
      } catch {
        // Ignore non-JSON messages
      }
    }, []),
  });

  const pendingCallsRef = useRef(
    new Map<
      string,
      {
        resolve: (value: any) => void;
        reject: (error: Error) => void;
      }
    >(),
  );

  const rpcCall = useCallback(
    async (method: string, args: any[] = []) => {
      return new Promise((resolve, reject) => {
        const id = crypto.randomUUID();
        pendingCallsRef.current.set(id, { resolve, reject });
        chatAgent.send(
          JSON.stringify({
            type: "rpc-request",
            id,
            method,
            args,
          }),
        );
      });
    },
    [chatAgent],
  );

  const updateConfig = useCallback(
    async (config: AgentSpec) => {
      await rpcCall("updateConfig", [config]);
    },
    [rpcCall],
  );

  const currentConfig = useCallback(async () => {
    return (await rpcCall("currentConfig", [])) as AgentSpec;
  }, [rpcCall]);

  const chat = useAgentChat({
    agent: chatAgent,
    onToolCall,
    experimental_throttle: 200,
  });

  return {
    chat,
    agentStatus,
    updateConfig,
    currentConfig,
  };
}
