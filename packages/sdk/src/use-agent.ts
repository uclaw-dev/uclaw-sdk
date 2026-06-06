import type { OnToolCallCallback } from "@cloudflare/ai-chat/react";

import { useAgentChat } from "@cloudflare/ai-chat/react";
import { useAgent as useRuntimeAgent } from "agents/react";
import { useCallback, useState, useMemo, useRef } from "react";

import type { AgentConfig } from "./types";

const DEFAULT_URL = "https://agents.uclaw.dev";
const APP_CLASS = "UClawApp";

export interface UseAgentOptions {
  /** Runtime API URL. Defaults to "https://agents.uclaw.dev". */
  url?: string;
  /** Active agent id. */
  agentId: string;
  /** Short-lived client token issued by a trusted backend. */
  token?: string;
  /** Fetches a short-lived client token from the host app backend. */
  getToken?: () => Promise<string>;
  /** Client-side tool handlers for the active agent. */
  onToolCall?: OnToolCallCallback;
  /** App ID to connect to. Defaults to "default". */
  appId?: string;
  /** Agent configuration to apply on connect if specified. */
  config?: AgentConfig;
}

export interface UseAgentReturn {
  // ── Active agent (messages + streaming) ──
  chat: ReturnType<typeof useAgentChat>;

  // ── Connection status ──
  /** Active agent WebSocket status. */
  agentStatus: "connecting" | "connected" | "disconnected";
  /** Update agent configuration. */
  updateConfig: (config: AgentConfig) => Promise<void>;
  /** Get current agent configuration. */
  currentConfig: () => Promise<AgentConfig>;
}

export function useAgent(options: UseAgentOptions): UseAgentReturn {
  const {
    getToken: customGetToken,
    token,
    url = DEFAULT_URL,
    agentId,
    onToolCall,
    appId = "default",
    config,
  } = options;

  const getToken = useMemo(() => {
    if (customGetToken) return customGetToken;
    if (token) return undefined;
    return async () => {
      const res = await fetch("https://api.uclaw.dev/v1/client-tokens", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ appId }),
        credentials: "include",
      });
      if (!res.ok) {
        throw new Error(`Failed to fetch client token: ${res.statusText}`);
      }
      const data = (await res.json()) as { token: string };
      return data.token;
    };
  }, [customGetToken, token, appId]);

  const [agentStatus, setAgentStatus] = useState<"connecting" | "connected" | "disconnected">(
    "connecting",
  );

  const rpcCallRef = useRef<((method: string, args?: any[]) => Promise<any>) | null>(null);

  // ── Active agent connection ────────────────────────────────────────
  const query = useMemo(
    () => (getToken ? async () => ({ token: await getToken() }) : token ? { token } : undefined),
    [getToken, token],
  );

  const runtimeAgent = useRuntimeAgent({
    host: url,
    agent: APP_CLASS,
    basePath: "app/" + appId,
    path: "sub/" + agentId,
    query,
    enabled: !!(appId && agentId),
    onOpen: useCallback(() => {
      setAgentStatus("connected");
      if (config) {
        rpcCallRef.current?.("updateConfig", [config]).catch((err) => {
          console.error("Failed to update agent config on connect:", err);
        });
      }
    }, [config]),
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
        runtimeAgent.send(
          JSON.stringify({
            type: "rpc-request",
            id,
            method,
            args,
          }),
        );
      });
    },
    [runtimeAgent],
  );
  rpcCallRef.current = rpcCall;

  const updateConfig = useCallback(
    async (config: AgentConfig) => {
      await rpcCall("updateConfig", [config]);
    },
    [rpcCall],
  );

  const currentConfig = useCallback(async () => {
    return (await rpcCall("currentConfig", [])) as AgentConfig;
  }, [rpcCall]);

  const chat = useAgentChat({
    agent: runtimeAgent,
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
