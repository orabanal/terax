import { useCallback, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

type SftpReadResult =
  | { kind: "text"; content: string; size: number }
  | { kind: "binary"; size: number };

type FsReadResult =
  | { kind: "text"; content: string; size: number }
  | { kind: "binary"; size: number }
  | { kind: "toolarge"; size: number; limit: number };

const TMP_PREFIX = "terax-sftp";

function tmpPath(sessionId: number, remotePath: string): string {
  const safeName = remotePath.replace(/[^a-zA-Z0-9._-]/g, "_");
  return `/tmp/${TMP_PREFIX}/${sessionId}/${safeName}`;
}

export function useSftpEdit(
  onOpenFile: (path: string) => void,
  onRefresh?: () => void,
  enqueueUpload?: (args: {
    sessionId: number;
    localPath: string;
    remotePath: string;
    onComplete?: () => void;
  }) => void,
) {
  const remoteMapRef = useRef<
    Map<string, { sessionId: number; remotePath: string }>
  >(new Map());

  useEffect(() => {
    const unlisten = listen<{ path: string; source?: string }>(
      "fs:file-written",
      (event) => {
        const localPath = event.payload.path;
        const entry = remoteMapRef.current.get(localPath);
        if (!entry) return;

        if (enqueueUpload) {
          enqueueUpload({
            sessionId: entry.sessionId,
            localPath,
            remotePath: entry.remotePath,
          });
          return;
        }

        void invoke<FsReadResult>("fs_read_file", {
          path: localPath,
        }).then((result) => {
          if (result.kind !== "text") return;
          void invoke("sftp_write_file", {
            id: entry.sessionId,
            path: entry.remotePath,
            content: result.content,
          })
            .then(() => onRefresh?.())
            .catch((e) => {
              console.error("SFTP upload failed:", e);
            });
        });
      },
    );
    return () => {
      void unlisten.then((fn) => fn());
    };
  }, [enqueueUpload, onRefresh]);

  const editRemoteFile = useCallback(
    async (sessionId: number, remotePath: string) => {
      const result = await invoke<SftpReadResult>("sftp_read_file", {
        id: sessionId,
        path: remotePath,
      });

      if (result.kind === "binary") return;

      const localPath = tmpPath(sessionId, remotePath);
      const dir = localPath.substring(0, localPath.lastIndexOf("/"));

      await invoke("fs_create_dir", { path: dir }).catch(() => {});
      await invoke("fs_write_file", {
        path: localPath,
        content: result.content,
      });

      remoteMapRef.current.set(localPath, {
        sessionId,
        remotePath,
      });

      onOpenFile(localPath);
    },
    [onOpenFile],
  );

  const openRemoteFile = useCallback(
    async (sessionId: number, remotePath: string) => {
      const localPath = tmpPath(sessionId, remotePath);
      const dir = localPath.substring(0, localPath.lastIndexOf("/"));

      await invoke("fs_create_dir", { path: dir }).catch(() => {});
      await invoke("sftp_download_file", {
        id: sessionId,
        remotePath,
        localPath,
      });

      await invoke("fs_open", { path: localPath }).catch(() => {});
    },
    [],
  );

  return { editRemoteFile, openRemoteFile };
}
