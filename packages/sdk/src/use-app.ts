"use client";

import { useAgent } from "agents/react";
import { useCallback, useMemo, useState, useRef } from "react";

import type {
  AgentSummary,
  AppState,
  CreateAgentInput,
  TextGenerationOptions,
  AppManifest,
} from "./types";

import { getDefaultGetToken } from "./utils";

const DEFAULT_URL = "https://agents.uclaw.dev";
const APP_CLASS = "UClawApp";

export interface UseAppOptions {
  /** Runtime API URL. Defaults to "https://agents.uclaw.dev". */
  url?: string;
  /** Short-lived client token issued by a trusted backend. */
  token?: string;
  /** Fetches a short-lived client token from the host app backend. */
  getToken?: () => Promise<string>;
  /** App ID to connect to. Defaults to "default". */
  appId?: string;
}

export interface UseAppReturn {
  // ── Directory (agent management) ──
  /** Ordered agent list from directory state broadcasts. */
  agents: AgentSummary[];
  /** Create a new agent. Returns the created summary. */
  createAgent: (opts?: CreateAgentInput) => Promise<AgentSummary>;
  /** Delete an agent by id. */
  deleteAgent: (id: string) => Promise<void>;
  /** Rename an agent. */
  renameAgent: (id: string, title: string) => Promise<void>;

  // ── Connection status ──
  /** Directory WebSocket readyState. */
  status: "connecting" | "connected" | "disconnected";
  /** Generate text directly using a prompt. */
  generateText: (prompt: string, opts?: TextGenerationOptions) => Promise<string>;
  /** Stream text generation chunks using SSE. */
  streamText: (prompt: string, opts?: TextGenerationOptions) => AsyncGenerator<string>;
  /** Connection or setup error, if any. */
  error: Error | null;
  /** Fetch the application manifest metadata. */
  getManifest: () => Promise<AppManifest | null>;
}

export function useApp(options: UseAppOptions = {}): UseAppReturn {
  const { getToken: customGetToken, token, url = DEFAULT_URL, appId } = options;

  const getToken = useMemo(() => {
    if (customGetToken) return customGetToken;
    if (token) return undefined;
    return getDefaultGetToken(appId);
  }, [customGetToken, token, appId]);

  const [status, setStatus] = useState<"connecting" | "connected" | "disconnected">("connecting");
  const [error, setError] = useState<Error | null>(null);
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

  const pendingCallsRef = useRef(
    new Map<
      string,
      {
        resolve: (value: any) => void;
        reject: (error: Error) => void;
      }
    >(),
  );

  const directory = useAgent<AppState>({
    host: url,
    agent: APP_CLASS,
    basePath: "_",
    query,
    onOpen: useCallback(() => {
      setStatus("connected");
      setError(null);
    }, []),
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
      console.error("UClaw app socket connection error:", event);
      setError(new Error("Socket connection error"));
    }, []),
    onStateUpdateError: useCallback((err: string) => {
      console.error("UClaw app state update error:", err);
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

  const agents: AgentSummary[] = directory.state?.agents ?? [];

  const rpcCall = useCallback(
    async (method: string, args: any[] = []) => {
      return new Promise((resolve, reject) => {
        const id = crypto.randomUUID();
        pendingCallsRef.current.set(id, { resolve, reject });
        directory.send(
          JSON.stringify({
            type: "rpc-request",
            id,
            method,
            args,
          }),
        );
      });
    },
    [directory],
  );

  const createAgent = useCallback(
    async (opts?: CreateAgentInput) =>
      (await rpcCall("createAgent", opts ? [opts] : [])) as AgentSummary,
    [rpcCall],
  );

  const renameAgent = useCallback(
    async (id: string, title: string) => {
      await rpcCall("renameAgent", [id, title]);
    },
    [rpcCall],
  );

  const deleteAgent = useCallback(
    async (id: string) => {
      await rpcCall("deleteAgent", [id]);
    },
    [rpcCall],
  );

  const generateText = useCallback(
    async (prompt: string, opts?: TextGenerationOptions): Promise<string> => {
      return (await rpcCall("generateText", [prompt, opts])) as string;
    },
    [rpcCall],
  );

  const streamText = useCallback(
    async function* (prompt: string, opts?: TextGenerationOptions): AsyncGenerator<string> {
      let activeToken = token;
      if (!activeToken && getToken) {
        activeToken = await getToken();
      }

      const baseUrl = typeof window !== "undefined" ? window.location.origin : undefined;
      const streamUrl = new URL(`${url}/_/rpc/streamText`, baseUrl);
      if (appId) {
        streamUrl.searchParams.set("appId", appId);
      }
      const response = await fetch(streamUrl.toString(), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(activeToken ? { Authorization: `Bearer ${activeToken}` } : {}),
        },
        body: JSON.stringify([prompt, opts]),
      });

      if (!response.ok) {
        throw new Error(await response.text());
      }

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
            if (line.startsWith("data: ")) {
              const data = line.slice(6);
              if (data === "[DONE]") break;
              try {
                const parsed = JSON.parse(data);
                if (parsed.type === "text-delta" && parsed.delta) {
                  yield parsed.delta;
                } else if (parsed.type === "error" && parsed.errorText) {
                  throw new Error(parsed.errorText);
                }
              } catch (e) {
                if (e instanceof Error) throw e;
              }
            }
          }
        }
      } finally {
        reader.releaseLock();
      }
    },
    [token, getToken, url, appId],
  );

  const getManifest = useCallback(
    async () => (await rpcCall("getManifest")) as AppManifest | null,
    [rpcCall],
  );

  return {
    status,
    error,
    agents,
    createAgent,
    deleteAgent,
    renameAgent,
    generateText,
    streamText,
    getManifest,
  };
}
