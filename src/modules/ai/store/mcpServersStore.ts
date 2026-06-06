import { emit, listen } from "@tauri-apps/api/event";
import { create } from "zustand";
import {
  loadMcpServers,
  newMcpServerId,
  saveMcpServers,
  type McpServer,
} from "../lib/mcpServers";

const CHANGED_EVENT = "terax://ai-mcp-servers-changed";

type State = {
  hydrated: boolean;
  servers: McpServer[];
  hydrate: () => Promise<void>;
  upsert: (server: McpServer) => void;
  remove: (id: string) => void;
};

let initialized = false;

export const useMcpServersStore = create<State>((set, get) => ({
  hydrated: false,
  servers: [],
  hydrate: async () => {
    if (initialized) return;
    initialized = true;
    set({ servers: await loadMcpServers(), hydrated: true });
    void listen(CHANGED_EVENT, async () => {
      set({ servers: await loadMcpServers() });
    });
  },
  upsert: (server) => {
    const list = get().servers;
    const idx = list.findIndex((s) => s.id === server.id);
    const next =
      idx === -1
        ? [...list, server]
        : list.map((s) => (s.id === server.id ? server : s));
    set({ servers: next });
    void saveMcpServers(next).then(() => emit(CHANGED_EVENT));
  },
  remove: (id) => {
    const next = get().servers.filter((s) => s.id !== id);
    set({ servers: next });
    void saveMcpServers(next).then(() => emit(CHANGED_EVENT));
  },
}));

export { newMcpServerId };
