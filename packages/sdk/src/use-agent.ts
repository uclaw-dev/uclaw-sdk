"use client";

import type { OnToolCallCallback } from "@cloudflare/ai-chat/react";

import { useAgentChat } from "@cloudflare/ai-chat/react";
import { useAgent as useRuntimeAgent } from "agents/react";
import { useCallback, useState, useMemo, useRef } from "react";

import type { AgentConfig } from "./types";

import { getDefaultGetToken } from "./utils";

const DEFAULT_URL = "https://agents.uclaw.dev";
const AGENT_CLASS = "UClawAgent";

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
  status: "connecting" | "connected" | "disconnected";
  /** Connection or setup error, if any. */
  error: Error | null;
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
    return getDefaultGetToken(appId);
  }, [customGetToken, token, appId]);

  const [status, setStatus] = useState<"connecting" | "connected" | "disconnected">("connecting");
  const [error, setError] = useState<Error | null>(null);

  const rpcCallRef = useRef<((method: string, args?: any[]) => Promise<any>) | null>(null);

  // ── Active agent connection ────────────────────────────────────────
  const query = useMemo(
    () => (getToken ? async () => ({ token: await getToken() }) : token ? { token } : undefined),
    [getToken, token],
  );

  const runtimeAgent = useRuntimeAgent({
    host: url,
    agent: AGENT_CLASS,
    name: agentId,
    basePath: `app/${appId}/sub/${agentId}`,
    query,
    enabled: !!(appId && agentId),
    onOpen: useCallback(() => {
      setStatus("connected");
      setError(null);
      if (config) {
        rpcCallRef.current?.("updateConfig", [config]).catch((err) => {
          console.error("Failed to update agent config on connect:", err);
        });
      }
    }, [config]),
    onClose: useCallback((event?: any) => {
      setStatus("disconnected");
      if (event && event.code !== 1000 && event.code !== 1001) {
        setError(new Error(event.reason || `Connection closed abnormally (code ${event.code})`));
      }
      const error = new Error("Connection closed");
      for (const pending of pendingCallsRef.current.values()) {
        pending.reject(error);
      }
      pendingCallsRef.current.clear();
    }, []),
    onError: useCallback((event: any) => {
      console.error("UClaw agent socket connection error:", event);
      setError(new Error("Socket connection error"));
    }, []),
    onStateUpdateError: useCallback((err: string) => {
      console.error("UClaw agent state update error:", err);
      setError(new Error(err));
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
    status,
    error,
    updateConfig,
    currentConfig,
  };
}
