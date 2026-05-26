import { useAgent } from "agents/react";
import { useCallback, useMemo, useState, useRef } from "react";

import type { AgentSpec, AgentSummary, AppState } from "./types";

const DEFAULT_URL = "https://agents.uclaw.dev";
const APP_CLASS = "UClawApp";

export interface UseAppOptions {
  /** Runtime API URL. Defaults to "https://agents.uclaw.dev". */
  url?: string;
  /** Short-lived client token issued by a trusted backend. */
  token?: string;
  /** Fetches a short-lived client token from the host app backend. */
  getToken?: () => Promise<string>;
  /** App name to connect to. Defaults to "default". */
  appName?: string;
}

export interface UseAppReturn {
  // ── Directory (chat management) ──
  /** Ordered chat list from directory state broadcasts. */
  agents: AgentSummary[];
  /** Create a new chat. Returns the created summary. */
  createAgent: (opts?: AgentSpec) => Promise<AgentSummary>;
  /** Delete a chat by id. */
  deleteAgent: (id: string) => Promise<void>;
  /** Rename a chat. */
  renameAgent: (id: string, title: string) => Promise<void>;

  // ── Connection status ──
  /** Directory WebSocket readyState. */
  appStatus: "connecting" | "connected" | "disconnected";
}

export function useApp(options: UseAppOptions): UseAppReturn {
  const { getToken: customGetToken, token, url = DEFAULT_URL, appName = "default" } = options;

  const getToken = useMemo(() => {
    if (customGetToken) return customGetToken;
    if (token) return undefined;
    return async () => {
      const res = await fetch("https://api.uclaw.dev/v1/client-tokens", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ appId: appName }),
        credentials: "include",
      });
      if (!res.ok) {
        throw new Error(`Failed to fetch client token: ${res.statusText}`);
      }
      const data = (await res.json()) as { token: string };
      return data.token;
    };
  }, [customGetToken, token, appName]);

  const [appStatus, setAppStatus] = useState<"connecting" | "connected" | "disconnected">(
    "connecting",
  );
  const query = useMemo(
    () => (getToken ? async () => ({ token: await getToken() }) : token ? { token } : undefined),
    [getToken, token],
  );

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
    basePath: "app/" + appName,
    query,
    onOpen: useCallback(() => setAppStatus("connected"), []),
    onClose: useCallback(() => {
      setAppStatus("disconnected");
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
    async (opts?: AgentSpec) => (await rpcCall("createChat", opts ? [opts] : [])) as AgentSummary,
    [rpcCall],
  );

  const renameAgent = useCallback(
    async (id: string, title: string) => {
      await rpcCall("renameChat", [id, title]);
    },
    [rpcCall],
  );

  const deleteAgent = useCallback(
    async (id: string) => {
      await rpcCall("deleteChat", [id]);
    },
    [rpcCall],
  );

  return {
    appStatus,
    agents,
    createAgent,
    deleteAgent,
    renameAgent,
  };
}
