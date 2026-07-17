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
  /**
   * AI SDK `useChat`-compatible chat controller for the active agent.
   *
   * Use this object to read chat state (`messages`, `status`, `error`) and
   * drive the conversation (`sendMessage`, `regenerate`, `stop`, `setMessages`,
   * and related helpers). See the AI SDK `useChat` return-value reference:
   * https://ai-sdk.dev/docs/reference/ai-sdk-ui/use-chat#returns
   */
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
  /** Upload a file directly to the agent's storage. */
  uploadFile: (file: File | FileList) => Promise<string | string[]>;
}

export function useAgent(options: UseAgentOptions): UseAgentReturn {
  const {
    getToken: customGetToken,
    token,
    url = DEFAULT_URL,
    agentId,
    onToolCall,
    appId,
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
  const query = useMemo(() => {
    const getQueryObj = async () => {
      const q: Record<string, string> = {};
      if (appId) {
        q.appId = appId;
      }
      if (getToken) {
        q.token = await getToken();
      } else if (token) {
        q.token = token;
      }
      return q;
    };
    if (getToken) {
      return getQueryObj;
    }
    const q: Record<string, string> = {};
    if (appId) {
      q.appId = appId;
    }
    if (token) {
      q.token = token;
    }
    return Object.keys(q).length > 0 ? q : undefined;
  }, [getToken, token, appId]);

  const runtimeAgent = useRuntimeAgent({
    host: url,
    agent: AGENT_CLASS,
    name: agentId,
    basePath: `_/sub/${agentId}`,
    query,
    enabled: !!agentId,
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

  const uploadFile = useCallback(
    async (file: File | FileList) => {
      const uploadSingle = async (f: File) => {
        let activeToken = token;
        if (!activeToken && getToken) {
          activeToken = await getToken();
        }

        const baseUrl = typeof window !== "undefined" ? window.location.origin : undefined;
        const uploadUrl = new URL(`${url}/_/sub/${agentId}/upload`, baseUrl);
        if (appId) {
          uploadUrl.searchParams.set("appId", appId);
        }

        const headers: Record<string, string> = {
          ...(activeToken ? { Authorization: `Bearer ${activeToken}` } : {}),
        };

        const formData = new FormData();
        formData.append("file", f);

        const response = await fetch(uploadUrl.toString(), {
          method: "POST",
          headers,
          body: formData,
        });

        if (!response.ok) {
          throw new Error(await response.text());
        }

        const data = (await response.json()) as { key: string };
        return data.key;
      };

      if (typeof FileList !== "undefined" && file instanceof FileList) {
        const promises = Array.from(file).map((f) => uploadSingle(f));
        return Promise.all(promises);
      }

      return uploadSingle(file as File);
    },
    [token, getToken, url, agentId, appId],
  );

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
    uploadFile,
  };
}
