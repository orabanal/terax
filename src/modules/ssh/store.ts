import { invoke } from "@tauri-apps/api/core";
import { create } from "zustand";
import { LazyStore } from "@tauri-apps/plugin-store";

const SSH_KEYRING_SERVICE = "terax-ssh";

function sshPasswordAccount(hostId: string): string {
  return `ssh-password-${hostId}`;
}

export async function getSshPassword(hostId: string): Promise<string | null> {
  try {
    const v = await invoke<string | null>("secrets_get", {
      service: SSH_KEYRING_SERVICE,
      account: sshPasswordAccount(hostId),
    });
    return v && v.length > 0 ? v : null;
  } catch {
    return null;
  }
}

export async function setSshPassword(hostId: string, password: string): Promise<void> {
  await invoke("secrets_set", {
    service: SSH_KEYRING_SERVICE,
    account: sshPasswordAccount(hostId),
    password,
  });
}

export async function clearSshPassword(hostId: string): Promise<void> {
  try {
    await invoke("secrets_delete", {
      service: SSH_KEYRING_SERVICE,
      account: sshPasswordAccount(hostId),
    });
  } catch {
    // already absent
  }
}

export type SshAuthType = "password" | "key";

export type SshHost = {
  id: string;
  name: string;
  host: string;
  port: number;
  username: string;
  authType: SshAuthType;
  keyPath?: string;
  initialCommand?: string;
  keepAliveInterval?: number;
  keepAliveMax?: number;
  connectTimeout?: number;
  strictHostKeyChecking?: "yes" | "no" | "accept-new";
  compression?: boolean;
};

const STORE_PATH = "terax-ssh-hosts.json";
const KEY_HOSTS = "hosts";

const store = new LazyStore(STORE_PATH, { defaults: {}, autoSave: 200 });

export async function loadSshHosts(): Promise<SshHost[]> {
  const hosts = await store.get<SshHost[]>(KEY_HOSTS);
  return hosts ?? [];
}

export async function saveSshHosts(hosts: SshHost[]): Promise<void> {
  await store.set(KEY_HOSTS, hosts);
  await store.save();
}

export function buildSshCommand(host: SshHost): string[] {
  const cmd = ["ssh"];
  if (host.port !== 22) cmd.push("-p", String(host.port));
  if (host.authType === "key" && host.keyPath) cmd.push("-i", host.keyPath);
  if (host.connectTimeout != null) cmd.push("-o", `ConnectTimeout=${host.connectTimeout}`);
  if (host.keepAliveInterval != null) {
    cmd.push("-o", `ServerAliveInterval=${host.keepAliveInterval}`);
    cmd.push("-o", "ServerAliveCountMax=3");
  }
  if (host.strictHostKeyChecking != null) cmd.push("-o", `StrictHostKeyChecking=${host.strictHostKeyChecking}`);
  if (host.compression) cmd.push("-C");
  cmd.push(`${host.username}@${host.host}`);
  if (host.initialCommand) cmd.push(host.initialCommand);
  return cmd;
}

type SshHostsState = {
  hosts: SshHost[];
  hydrated: boolean;
  init: () => Promise<void>;
  reload: () => Promise<void>;
  addHost: (host: Omit<SshHost, "id">) => Promise<string>;
  updateHost: (id: string, patch: Partial<Omit<SshHost, "id">>) => Promise<void>;
  deleteHost: (id: string) => Promise<void>;
};

export const useSshHostsStore = create<SshHostsState>((set, get) => ({
  hosts: [],
  hydrated: false,
  init: async () => {
    if (get().hydrated) return;
    const hosts = await loadSshHosts();
    set({ hosts, hydrated: true });
  },
  reload: async () => {
    const hosts = await loadSshHosts();
    set({ hosts, hydrated: true });
  },
  addHost: async (data) => {
    const id = crypto.randomUUID();
    const host: SshHost = { ...data, id };
    const hosts = [...get().hosts, host];
    set({ hosts });
    await saveSshHosts(hosts);
    return id;
  },
  updateHost: async (id, patch) => {
    const hosts = get().hosts.map((h) => (h.id === id ? { ...h, ...patch } : h));
    set({ hosts });
    await saveSshHosts(hosts);
  },
  deleteHost: async (id) => {
    const hosts = get().hosts.filter((h) => h.id !== id);
    set({ hosts });
    await saveSshHosts(hosts);
  },
}));
