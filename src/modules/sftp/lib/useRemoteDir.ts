import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useRef, useState } from "react";
import { getSshPassword, type SshHost } from "@/modules/ssh/store";
import type { SftpEntry } from "./types";

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
  disconnect: () => void;
  showHidden: boolean;
  toggleHidden: () => void;
};

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

  const connect = useCallback(async (host: SshHost) => {
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

    // Reset state for new connection.
    setSessionId(null);
    setStatus("connecting");
    setError(null);
    setHostName(host.name);
    setPath("");
    setEntries([]);
    setAllEntries([]);
    setHistory([]);
    setIndex(-1);

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
      sessionIdRef.current = result.id;
      setSessionId(result.id);
      setHome(normalizedHome);
      setHistory([normalizedHome]);
      setIndex(0);
      setPath(normalizedHome);
    } catch (e) {
      setError(typeof e === "string" ? e : String(e));
      setStatus("error");
      setHostName(null);
    }
  }, []);

  const disconnect = useCallback(async () => {
    const sid = sessionIdRef.current;
    sessionIdRef.current = null;
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

  return {
    path,
    entries,
    status,
    error,
    connected: sessionId != null,
    hostName,
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
    disconnect,
    showHidden,
    toggleHidden,
  };
}
