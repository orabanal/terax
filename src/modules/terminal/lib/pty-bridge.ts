import { invoke, Channel } from "@tauri-apps/api/core";
import { currentWorkspaceEnv } from "@/modules/workspace";
import type { SshHost } from "@/modules/ssh/store";

export type PtyHandlers = {
  onData: (bytes: Uint8Array) => void;
  onExit?: (code: number) => void;
};

export type SshHandlers = PtyHandlers & {
  onStatus?: (msg: string) => void;
};

export type PtySession = {
  id: number;
  write: (data: string) => Promise<void>;
  resize: (cols: number, rows: number) => Promise<void>;
  close: () => Promise<void>;
};

export async function openPty(
  cols: number,
  rows: number,
  handlers: PtyHandlers,
  cwd?: string,
  blocks?: boolean,
  command?: string[],
): Promise<PtySession> {
  const onData = new Channel<ArrayBuffer>();
  const onExit = new Channel<number>();

  let released = false;
  const noop = () => {};
  const releaseHandlers = () => {
    if (released) return;
    released = true;
    onData.onmessage = noop;
    onExit.onmessage = noop;
  };

  onData.onmessage = (buf) => handlers.onData(new Uint8Array(buf));
  onExit.onmessage = (code) => {
    handlers.onExit?.(code);
    releaseHandlers();
  };

  const id = await invoke<number>("pty_open", {
    cols,
    rows,
    cwd: cwd ?? null,
    workspace: currentWorkspaceEnv(),
    blocks: blocks ?? false,
    command: command ?? null,
    onData,
    onExit,
  });

  let closed = false;

  return {
    id,
    write: (data) => invoke("pty_write", { id, data }),
    resize: (c, r) => invoke("pty_resize", { id, cols: c, rows: r }),
    close: async () => {
      if (closed) return;
      closed = true;
      try {
        await invoke("pty_close", { id });
      } finally {
        releaseHandlers();
      }
    },
  };
}

export async function openSshPty(
  cols: number,
  rows: number,
  host: SshHost,
  password: string | undefined,
  handlers: SshHandlers,
): Promise<PtySession> {
  const onData = new Channel<ArrayBuffer>();
  const onExit = new Channel<number>();
  const onStatus = new Channel<string>();

  let released = false;
  const noop = () => {};
  const releaseHandlers = () => {
    if (released) return;
    released = true;
    onData.onmessage = noop;
    onExit.onmessage = noop;
    onStatus.onmessage = noop;
  };

  onData.onmessage = (buf) => handlers.onData(new Uint8Array(buf));
  onExit.onmessage = (code) => {
    handlers.onExit?.(code);
    releaseHandlers();
  };
  onStatus.onmessage = (msg) => handlers.onStatus?.(msg);

  const id = await invoke<number>("ssh_open", {
    opts: {
      host: host.host,
      port: host.port,
      username: host.username,
      authType: host.authType,
      password: password ?? null,
      keyPath: host.keyPath ?? null,
      cols,
      rows,
      connectTimeout: host.connectTimeout ?? null,
      keepAliveInterval: host.keepAliveInterval ?? null,
      keepAliveMax: host.keepAliveMax ?? null,
    },
    onData,
    onExit,
    onStatus,
  });

  let closed = false;

  return {
    id,
    write: (data) => invoke<void>("ssh_write", { id, data }),
    resize: (c, r) => invoke<void>("ssh_resize", { id, cols: c, rows: r }),
    close: async () => {
      if (closed) return;
      closed = true;
      try {
        await invoke("ssh_close", { id });
      } finally {
        releaseHandlers();
      }
    },
  };
}

