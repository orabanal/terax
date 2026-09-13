import { invoke } from "@tauri-apps/api/core";

export const OPENCODE_EVENTS_FILENAME = ".terax-opencode-events.jsonl";
export const OPENCODE_PLUGIN_VERSION = 1;

export type OpencodeSignalKind = "finished" | "attention" | "error";

export type OpencodeSignal = {
  kind: OpencodeSignalKind;
  sessionId?: string | null;
  directory?: string | null;
  project?: string | null;
  detail?: string | null;
  origin: "local" | "ssh";
  /** SSH session id for remote signals (matches ptyIdForLeaf). */
  sshId?: number | null;
};

export type TailChunk = { tailId: number; sshId: number; chunk: string };

function isSignalKind(k: unknown): k is OpencodeSignalKind {
  return k === "finished" || k === "attention" || k === "error";
}

/** Parse one plugin JSONL line. Returns null for foreign/malformed lines. */
export function parseOpencodeLine(
  line: string,
  origin: "local" | "ssh",
  sshId?: number | null,
): OpencodeSignal | null {
  let v: unknown;
  try {
    v = JSON.parse(line);
  } catch {
    return null;
  }
  if (typeof v !== "object" || v === null) return null;
  const o = v as Record<string, unknown>;
  if (o.v !== 1 || o.agent !== "opencode" || !isSignalKind(o.kind)) {
    return null;
  }
  const str = (k: string) =>
    typeof o[k] === "string" ? (o[k] as string) : null;
  return {
    kind: o.kind,
    sessionId: str("sessionId"),
    directory: str("directory"),
    project: str("project"),
    detail: str("detail"),
    origin,
    sshId: sshId ?? null,
  };
}

/** Reassemble streamed tail chunks into complete lines. One buffer per
 *  SSH session; `push` returns the newly completed signals. */
export class OpencodeTailBuffer {
  private pending = new Map<number, string>();

  push(sshId: number, chunk: string): OpencodeSignal[] {
    const out: OpencodeSignal[] = [];
    const text = (this.pending.get(sshId) ?? "") + chunk;
    const parts = text.split("\n");
    this.pending.set(sshId, parts.pop() ?? "");
    for (const line of parts) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const sig = parseOpencodeLine(trimmed, "ssh", sshId);
      if (sig) out.push(sig);
    }
    return out;
  }

  clear(sshId?: number): void {
    if (sshId === undefined) this.pending.clear();
    else this.pending.delete(sshId);
  }
}

export type NotifyStatus = {
  installed: boolean;
  version: number;
  path?: string | null;
};

export async function opencodeLocalStatus(): Promise<NotifyStatus | null> {
  try {
    return await invoke<NotifyStatus>("opencode_notify_local_status");
  } catch {
    return null;
  }
}

export async function ensureLocalPlugin(): Promise<NotifyStatus | null> {
  try {
    const status = await invoke<NotifyStatus>(
      "opencode_notify_install_local",
    );
    return status;
  } catch {
    return null;
  }
}

export async function opencodePluginSource(): Promise<string | null> {
  try {
    return await invoke<string>("opencode_notify_plugin_source");
  } catch {
    return null;
  }
}

type SshExecResult = {
  stdout: string;
  stderr: string;
  exitCode: number | null;
};

async function sshExec(
  sshId: number,
  command: string,
): Promise<SshExecResult | null> {
  try {
    return await invoke<SshExecResult>("ssh_exec", { id: sshId, command });
  } catch {
    return null;
  }
}

const MARKER = `terax-notify v${OPENCODE_PLUGIN_VERSION}`;

/** True when the remote host already has the current plugin version. */
export async function remotePluginCurrent(
  sshId: number,
): Promise<boolean> {
  const res = await sshExec(
    sshId,
    "cat ~/.config/opencode/plugins/terax-notify.js 2>/dev/null | grep -m1 terax-notify",
  );
  if (!res) return false;
  return res.stdout.includes(MARKER);
}

/** Write the plugin to the remote host (idempotent; overwrites stale). */
export async function installRemotePlugin(
  sshId: number,
): Promise<boolean> {
  const source = await opencodePluginSource();
  if (!source) return false;
  // Marker first line so version checks stay a one-line grep.
  const body = `// ${MARKER}\n${source}`;
  const res = await sshExec(
    sshId,
    `mkdir -p ~/.config/opencode/plugins && cat > ~/.config/opencode/plugins/terax-notify.js <<'TERAX_EOF'\n${body}\nTERAX_EOF`,
  );
  return !!res && res.exitCode === 0;
}

/** Start streaming the remote events file. Returns the tail id. */
export async function startRemoteTail(
  sshId: number,
): Promise<number | null> {
  try {
    return await invoke<number>("ssh_tail_start", {
      id: sshId,
      path: `~/${OPENCODE_EVENTS_FILENAME}`,
    });
  } catch {
    return null;
  }
}

export async function stopRemoteTail(tailId: number): Promise<void> {
  try {
    await invoke("ssh_tail_stop", { tailId });
  } catch {
    /* ignore */
  }
}
