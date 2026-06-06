import { LazyStore } from "@tauri-apps/plugin-store";

export type McpTransport = "stdio" | "http";

export type McpServer = {
  id: string;
  name: string;
  transport: McpTransport;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  enabled: boolean;
};

const STORE_PATH = "terax-mcp-servers.json";
const KEY_LIST = "servers";

const store = new LazyStore(STORE_PATH, { defaults: {}, autoSave: 200 });

export async function loadMcpServers(): Promise<McpServer[]> {
  return (await store.get<McpServer[]>(KEY_LIST)) ?? [];
}

export async function saveMcpServers(list: McpServer[]): Promise<void> {
  await store.set(KEY_LIST, list);
  await store.save();
}

export function newMcpServerId(): string {
  return `mcp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}
