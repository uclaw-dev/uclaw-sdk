import { useCallback, useState } from "react";
import { useAgent } from "agents/react";
import type { AgentSummary, AppState } from "./types";

const DEFAULT_URL = "https://agents.uclaw.dev";
const DIRECTORY_AGENT = "UClawApp";

export interface UseAppOptions {
  /** Runtime API URL. Defaults to "https://agents.uclaw.dev". */
  url?: string;
}

export interface UseAppReturn {
  // ── Directory (chat management) ──
  /** Ordered chat list from directory state broadcasts. */
  agents: AgentSummary[];
  /** Create a new chat. Returns the created summary. */
  createAgent: (opts?: { title?: string }) => Promise<AgentSummary>;
  /** Delete a chat by id. */
  deleteAgent: (id: string) => Promise<void>;
  /** Rename a chat. */
  renameAgent: (id: string, title: string) => Promise<void>;

  // ── Connection status ──
  /** Directory WebSocket readyState. */
  appStatus: "connecting" | "connected" | "disconnected";
}

export function useApp(options: UseAppOptions = {}): UseAppReturn {
  const { url = DEFAULT_URL } = options;

  const [appStatus, setAppStatus] = useState<
    "connecting" | "connected" | "disconnected"
  >("connecting");

  const directory = useAgent<AppState>({
    host: url,
    agent: DIRECTORY_AGENT,
    onOpen: useCallback(() => setAppStatus("connected"), []),
    onClose: useCallback(() => setAppStatus("disconnected"), []),
  });

  const agents: AgentSummary[] = directory.state?.agents ?? [];

  const createAgent = useCallback(
    async (opts?: { title?: string }) =>
      (await directory.call("createChat", opts ? [opts] : [])) as AgentSummary,
    [directory]
  );

  const renameAgent = useCallback(
    async (id: string, title: string) => {
      await directory.call("renameChat", [id, title]);
    },
    [directory]
  );

  const deleteAgent = useCallback(
    async (id: string) => {
      await directory.call("deleteChat", [id]);
    },
    [directory]
  );

  return {
    appStatus,
    agents,
    createAgent,
    deleteAgent,
    renameAgent,
  };
}
