import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useRef, useState } from "react";
import { getSshPassword, type SshHost } from "@/modules/ssh/store";
import type { DirMutations, SftpEntry } from "./types";

type SftpDirEntry = {
  name: string;
  kind: "file" | "dir" | "symlink";
  size: number;
  mtime: number;
  mode?: number;
};

type SftpOpenResult = {
  id: number;
  home: string;
};

export type RemoteDirStatus =
  | "idle"
  | "connecting"
  | "loading"
  | "loaded"
  | "error";

export type RemoteDir = {
  path: string;
  entries: SftpEntry[];
  status: RemoteDirStatus;
  error: string | null;
  connected: boolean;
  hostName: string | null;
  sessionId: number | null;
  canGoBack: boolean;
  canGoForward: boolean;
  navigate: (path: string) => void;
  enterDir: (name: string) => void;
  goUp: () => void;
  goBack: () => void;
  goForward: () => void;
  goHome: () => void;
  refresh: () => void;
  connect: (host: SshHost) => void;
  reconnect: () => void;
  disconnect: () => void;
  showHidden: boolean;
  toggleHidden: () => void;
} & DirMutations;

function joinPath(parent: string, name: string): string {
  const base = parent.endsWith("/") ? parent.slice(0, -1) : parent;
  return `${base}/${name}`;
}

function parentOf(path: string): string {
  const clean = path.endsWith("/") ? path.slice(0, -1) : path;
  const i = clean.lastIndexOf("/");
  if (i <= 0) return "/";
  return clean.slice(0, i);
}

/** Normalize a path: remove trailing slashes (except root), collapse doubles. */
function normalizePath(p: string): string {
  if (!p || p === "/") return "/";
  let n = p.replace(/\/+/g, "/");
  if (n.length > 1 && n.endsWith("/")) n = n.slice(0, -1);
  return n;
}

export function useRemoteDir(): RemoteDir {
  const [showHidden, setShowHidden] = useState(false);
  const toggleHidden = useCallback(() => setShowHidden((v) => !v), []);

  const [sessionId, setSessionId] = useState<number | null>(null);
  const sessionIdRef = useRef<number | null>(null);
  const lastHostRef = useRef<SshHost | null>(null);
  const [home, setHome] = useState<string | null>(null);
  const [hostName, setHostName] = useState<string | null>(null);
  const [path, setPath] = useState("");
  const [entries, setEntries] = useState<SftpEntry[]>([]);
  const [allEntries, setAllEntries] = useState<SftpEntry[]>([]);
  const [status, setStatus] = useState<RemoteDirStatus>("idle");
  const [error, setError] = useState<string | null>(null);

  const [history, setHistory] = useState<string[]>([]);
  const [index, setIndex] = useState(-1);
  const indexRef = useRef(index);
  indexRef.current = index;

  const reqIdRef = useRef(0);

  // Client-side hidden file filtering (SFTP has no showHidden parameter).
  useEffect(() => {
    if (showHidden) {
      setEntries(allEntries);
    } else {
      setEntries(allEntries.filter((e) => !e.name.startsWith(".")));
    }
  }, [allEntries, showHidden]);

  const load = useCallback(
    async (target: string, sid: number) => {
      const reqId = ++reqIdRef.current;
      setStatus("loading");
      setError(null);
      try {
        const list = await invoke<SftpDirEntry[]>("sftp_list_dir", {
          id: sid,
          path: target,
        });
        if (reqId !== reqIdRef.current) return;
        setAllEntries(list as SftpEntry[]);
        setStatus("loaded");
      } catch (e) {
        if (reqId !== reqIdRef.current) return;
        setError(typeof e === "string" ? e : String(e));
        setAllEntries([]);
        setStatus("error");
      }
    },
    [],
  );

  // Reload when path changes and we have a session.
  useEffect(() => {
    if (path && sessionId != null) void load(path, sessionId);
  }, [path, sessionId, load]);

  const navigate = useCallback((target: string) => {
    setPath((curr) => {
      if (target === curr) return curr;
      setHistory((h) => {
        const trimmed = h.slice(0, indexRef.current + 1);
        trimmed.push(target);
        setIndex(trimmed.length - 1);
        return trimmed;
      });
      return target;
    });
  }, []);

  const enterDir = useCallback(
    (name: string) => navigate(joinPath(path, name)),
    [navigate, path],
  );
  const goUp = useCallback(() => navigate(parentOf(path)), [navigate, path]);
  const goHome = useCallback(() => {
    if (home) navigate(home);
  }, [navigate, home]);
  const refresh = useCallback(() => {
    if (path && sessionId != null) void load(path, sessionId);
  }, [load, path, sessionId]);

  const goBack = useCallback(() => {
    if (index <= 0) return;
    const next = index - 1;
    setIndex(next);
    setPath(history[next]);
  }, [index, history]);

  const goForward = useCallback(() => {
    if (index >= history.length - 1) return;
    const next = index + 1;
    setIndex(next);
    setPath(history[next]);
  }, [index, history]);

  const openSession = useCallback(
    async (host: SshHost, initialPath: string | null) => {
      lastHostRef.current = host;

      // Close previous session if any (use ref for latest value).
      const prevId = sessionIdRef.current;
      if (prevId != null) {
        sessionIdRef.current = null;
        try {
          await invoke("sftp_close", { id: prevId });
        } catch {
          // ignore
        }
      }

      // Reset session-bound state for the new connection.
      setSessionId(null);
      setStatus("connecting");
      setError(null);
      setHostName(host.name);
      setEntries([]);
      setAllEntries([]);

      try {
        const password = await getSshPassword(host.id);
        const result = await invoke<SftpOpenResult>("sftp_open", {
          opts: {
            host: host.host,
            port: host.port,
            username: host.username,
            authType: host.authType,
            password,
            keyPath: host.keyPath,
            cols: 80,
            rows: 24,
            connectTimeout: host.connectTimeout,
            keepAliveInterval: host.keepAliveInterval,
            keepAliveMax: host.keepAliveMax,
          },
        });

        const normalizedHome = normalizePath(result.home);
         // Restore the path the user was browsing. SFTP paths are absolute, so
         // use it directly; fall back to home for a relative or empty path.
         const target = initialPath && initialPath.startsWith("/")
            ? normalizePath(initialPath)
            : normalizedHome;

        sessionIdRef.current = result.id;
        setSessionId(result.id);
        setHome(normalizedHome);
        setHistory(target === normalizedHome ? [normalizedHome] : [normalizedHome, target]);
        setIndex(target === normalizedHome ? 0 : 1);
        setPath(target);
      } catch (e) {
        setError(typeof e === "string" ? e : String(e));
        setStatus("error");
        setHostName(null);
      }
    },
    [],
  );

  const connect = useCallback(
    (host: SshHost) => void openSession(host, null),
    [openSession],
  );

  // Reconnect with the last host, restoring the path the user was browsing
  // before the connection dropped. The previous session id is stale, so a
  // fresh sftp_open is required; refresh() alone can only re-list against a
  // dead session.
  const reconnect = useCallback(() => {
    const host = lastHostRef.current;
    if (host == null) return;
    void openSession(host, path);
  }, [openSession, path]);

   const disconnect = useCallback(async () => {
     const sid = sessionIdRef.current;
     sessionIdRef.current = null;
     lastHostRef.current = null;
     if (sid != null) {
      try {
        await invoke("sftp_close", { id: sid });
      } catch {
        // ignore
      }
    }
    setSessionId(null);
    setHome(null);
    setHostName(null);
    setPath("");
    setEntries([]);
    setAllEntries([]);
    setStatus("idle");
    setError(null);
    setHistory([]);
    setIndex(-1);
  }, []);

  const mkdir = useCallback(
    async (name: string) => {
      const sid = sessionIdRef.current;
      if (sid == null) return;
      await invoke("sftp_mkdir", { id: sid, path: joinPath(path, name) });
      refresh();
    },
    [path, refresh],
  );

  // Creating empty files over SFTP is not supported (no backend command).
  const createFile = useCallback(async (_name: string) => {}, []);

  const rename = useCallback(
    async (oldName: string, newName: string) => {
      const sid = sessionIdRef.current;
      if (sid == null) return;
      await invoke("sftp_rename", {
        id: sid,
        from: joinPath(path, oldName),
        to: joinPath(path, newName),
      });
      refresh();
    },
    [path, refresh],
  );

  const remove = useCallback(
    async (entries: SftpEntry[]) => {
      const sid = sessionIdRef.current;
      if (sid == null) return;
      for (const entry of entries) {
        await invoke("sftp_remove", {
          id: sid,
          path: joinPath(path, entry.name),
          isDir: entry.kind === "dir",
        });
      }
      refresh();
    },
    [path, refresh],
  );

  const chmod = useCallback(
    async (name: string, mode: number) => {
      const sid = sessionIdRef.current;
      if (sid == null) return;
      await invoke("sftp_chmod", {
        id: sid,
        path: joinPath(path, name),
        mode,
      });
      refresh();
    },
    [path, refresh],
  );

  return {
    path,
    entries,
    status,
    error,
    connected: sessionId != null,
    hostName,
    sessionId,
    canGoBack: index > 0,
    canGoForward: index >= 0 && index < history.length - 1,
    navigate,
    enterDir,
    goUp,
    goBack,
    goForward,
    goHome,
  refresh,
  connect,
  reconnect,
  disconnect,
    showHidden,
    toggleHidden,
    mkdir,
    createFile,
    rename,
    remove,
    chmod,
  };
}
