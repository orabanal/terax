import { currentWorkspaceEnv } from "@/modules/workspace";
import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useRef, useState } from "react";
import type { DirMutations, SftpEntry } from "./types";

/** Mirror of the backend `DirEntry` returned by `fs_read_dir`. */
type FsDirEntry = {
  name: string;
  kind: "file" | "dir" | "symlink";
  size: number;
  mtime: number;
};

export type LocalDirStatus = "idle" | "loading" | "loaded" | "error";

export type LocalDir = {
  path: string;
  entries: SftpEntry[];
  status: LocalDirStatus;
  error: string | null;
  canGoBack: boolean;
  canGoForward: boolean;
  navigate: (path: string) => void;
  enterDir: (name: string) => void;
  goUp: () => void;
  goBack: () => void;
  goForward: () => void;
  goHome: () => void;
  refresh: () => void;
  /** Whether dot-prefixed entries are shown. Pane-local, independent of the
   *  global explorer preference. */
  showHidden: boolean;
  toggleHidden: () => void;
} & DirMutations;

/** Joins a POSIX path segment, tolerating a trailing slash on the parent. */
function joinPath(parent: string, name: string): string {
  if (parent.endsWith("/")) return `${parent}${name}`;
  return `${parent}/${name}`;
}

/** Parent of an absolute POSIX path; root stays root. */
function parentOf(path: string): string {
  const i = path.lastIndexOf("/");
  if (i <= 0) return "/";
  return path.slice(0, i);
}

/**
 * Real local-filesystem navigation for the SFTP left pane. Owns the current
 * path, directory listing, and a back/forward history stack. Listing reuses
 * the existing `fs_read_dir` command (dirs-first, sorted, hidden-file aware).
 */
export function useLocalDir(initialPath: string | null): LocalDir {
  // Pane-local hidden-files toggle — independent of the global explorer pref,
  // driven by the eye button in the SFTP toolbar.
  const [showHidden, setShowHidden] = useState(false);
  const toggleHidden = useCallback(() => setShowHidden((v) => !v), []);

  const [path, setPath] = useState(initialPath ?? "");
  const [entries, setEntries] = useState<SftpEntry[]>([]);
  const [status, setStatus] = useState<LocalDirStatus>("idle");
  const [error, setError] = useState<string | null>(null);

  // Back/forward history. `history[index]` is always the current path.
  const [history, setHistory] = useState<string[]>(
    initialPath ? [initialPath] : [],
  );
  const [index, setIndex] = useState(initialPath ? 0 : -1);

  // Guards against a slow listing overwriting a newer one (last-write-wins).
  const reqIdRef = useRef(0);

  const load = useCallback(
    async (target: string) => {
      const reqId = ++reqIdRef.current;
      setStatus("loading");
      setError(null);
      try {
        const list = await invoke<FsDirEntry[]>("fs_read_dir", {
          path: target,
          showHidden,
          workspace: currentWorkspaceEnv(),
        });
        if (reqId !== reqIdRef.current) return;
        setEntries(list as SftpEntry[]);
        setStatus("loaded");
      } catch (e) {
        if (reqId !== reqIdRef.current) return;
        setError(typeof e === "string" ? e : String(e));
        setStatus("error");
      }
    },
    [showHidden],
  );

  // Seed once the initial path is known (it arrives async from homeDir()).
  useEffect(() => {
    if (!initialPath || path) return;
    setPath(initialPath);
    setHistory([initialPath]);
    setIndex(0);
  }, [initialPath, path]);

  // Reload whenever the path or the hidden-files preference changes.
  useEffect(() => {
    if (path) void load(path);
  }, [path, load]);

  const navigate = useCallback(
    (target: string) => {
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
    },
    [],
  );

  // Mirror `index` into a ref so `navigate` can read it without re-creating.
  const indexRef = useRef(index);
  indexRef.current = index;

  const enterDir = useCallback(
    (name: string) => navigate(joinPath(path, name)),
    [navigate, path],
  );
  const goUp = useCallback(() => navigate(parentOf(path)), [navigate, path]);
  const goHome = useCallback(() => {
    if (initialPath) navigate(initialPath);
  }, [navigate, initialPath]);
  const refresh = useCallback(() => {
    if (path) void load(path);
  }, [load, path]);

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

  const mkdir = useCallback(
    async (name: string) => {
      await invoke("fs_create_dir", {
        path: joinPath(path, name),
        workspace: currentWorkspaceEnv(),
      });
      refresh();
    },
    [path, refresh],
  );

  const createFile = useCallback(
    async (name: string) => {
      await invoke("fs_create_file", {
        path: joinPath(path, name),
        workspace: currentWorkspaceEnv(),
      });
      refresh();
    },
    [path, refresh],
  );

  const rename = useCallback(
    async (oldName: string, newName: string) => {
      await invoke("fs_rename", {
        from: joinPath(path, oldName),
        to: joinPath(path, newName),
        workspace: currentWorkspaceEnv(),
      });
      refresh();
    },
    [path, refresh],
  );

  const remove = useCallback(
    async (entries: SftpEntry[]) => {
      for (const entry of entries) {
        await invoke("fs_delete", {
          path: joinPath(path, entry.name),
          workspace: currentWorkspaceEnv(),
        });
      }
      refresh();
    },
    [path, refresh],
  );

  const chmod = useCallback(
    async (name: string, mode: number) => {
      await invoke("fs_chmod", {
        path: joinPath(path, name),
        mode,
        workspace: currentWorkspaceEnv(),
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
    canGoBack: index > 0,
    canGoForward: index >= 0 && index < history.length - 1,
    navigate,
    enterDir,
    goUp,
    goBack,
    goForward,
    goHome,
    refresh,
    showHidden,
    toggleHidden,
    mkdir,
    createFile,
    rename,
    remove,
    chmod,
  };
}
