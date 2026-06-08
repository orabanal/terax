import { useCallback, useMemo, useRef, useState } from "react";
import { currentWorkspaceEnv } from "@/modules/workspace";
import {
  fsCopy,
  fsCopyCancel,
  fsCopyRecursive,
  newTransferId,
  sftpCancel,
  sftpDownload,
  sftpDownloadRecursive,
  sftpUpload,
  sftpUploadRecursive,
  type TransferProgress,
} from "./transferBackend";
import {
  isDestinationConflict,
  renamedPath,
  type SftpConflictAction,
} from "./transferConflicts";
import { directionFor, joinPath } from "./transferRouting";
import type { SftpEntry, SftpPaneRef, SftpTransfer } from "./types";

type TransferRecord = SftpTransfer & {
  kind: "file" | "dir";
  source: SftpPaneRef;
  dest: SftpPaneRef;
  srcPath: string;
  dstPath: string;
  baseDstPath: string;
  overwrite: boolean;
  renameAttempt: number;
  lastBytes: number;
  lastTime: number;
  onComplete?: () => void;
};

export type SftpConflict = {
  id: string;
  fileName: string;
  dstPath: string;
};

const MAX_ACTIVE = 3;
const MAX_RENAME_ATTEMPTS = 99;

export type TransferQueue = {
  transfers: SftpTransfer[];
  currentConflict: SftpConflict | null;
  enqueue: (
    source: SftpPaneRef,
    entries: SftpEntry[],
    dest: SftpPaneRef,
  ) => void;
  cancel: (id: string) => void;
  retry: (id: string) => void;
  enqueueRemoteEditUpload: (args: {
    sessionId: number;
    localPath: string;
    remotePath: string;
    onComplete?: () => void;
  }) => void;
  resolveConflict: (
    id: string,
    action: SftpConflictAction,
    applyToAll: boolean,
  ) => void;
  clearFinished: () => void;
  onDidComplete: (cb: (dest: SftpPaneRef) => void) => () => void;
};

export function useTransferQueue(): TransferQueue {
  const [transfers, setTransfers] = useState<TransferRecord[]>([]);
  const recordsRef = useRef<Map<string, TransferRecord>>(new Map());
  const activeRef = useRef(0);
  const applyToAllRef = useRef<SftpConflictAction | null>(null);
  const completeCbs = useRef<Set<(dest: SftpPaneRef) => void>>(new Set());

  const sync = useCallback(() => {
    setTransfers(Array.from(recordsRef.current.values()));
  }, []);

  const patch = useCallback(
    (id: string, p: Partial<TransferRecord>) => {
      const rec = recordsRef.current.get(id);
      if (!rec) return;
      Object.assign(rec, p);
      sync();
    },
    [sync],
  );

  const onProgress = useCallback(
    (id: string) => (ev: TransferProgress) => {
      const rec = recordsRef.current.get(id);
      if (!rec) return;
      const now = performance.now();
      const dt = (now - rec.lastTime) / 1000;
      const speed =
        dt > 0 ? Math.max(0, (ev.bytesDone - rec.lastBytes) / dt) : rec.speed;
      rec.lastBytes = ev.bytesDone;
      rec.lastTime = now;
      const status = rec.status === "completed" ? "completed" : "transferring";
      Object.assign(rec, {
        transferredBytes: ev.bytesDone,
        totalBytes: ev.totalBytes || rec.totalBytes,
        speed,
        status,
      });
      sync();
    },
    [sync],
  );

  const pumpRef = useRef<() => void>(() => {});

  const resolveRecord = useCallback(
    (rec: TransferRecord, action: SftpConflictAction) => {
      if (action === "skip") {
        patch(rec.id, {
          status: "skipped",
          speed: 0,
          errorMessage: undefined,
        });
        return;
      }

      if (action === "rename") {
        const nextAttempt = rec.renameAttempt + 1;
        if (nextAttempt > MAX_RENAME_ATTEMPTS) {
          patch(rec.id, {
            status: "failed",
            speed: 0,
            errorMessage: "No available renamed destination found",
          });
          return;
        }
        patch(rec.id, {
          status: "pending",
          dstPath: renamedPath(rec.baseDstPath, nextAttempt),
          overwrite: false,
          renameAttempt: nextAttempt,
          transferredBytes: 0,
          speed: 0,
          errorMessage: undefined,
        });
        return;
      }

      patch(rec.id, {
        status: "pending",
        overwrite: true,
        transferredBytes: 0,
        speed: 0,
        errorMessage: undefined,
      });
    },
    [patch],
  );

  const runTransfer = useCallback(
    async (rec: TransferRecord) => {
      activeRef.current++;
      patch(rec.id, { status: "transferring", speed: 0 });
      rec.lastBytes = 0;
      rec.lastTime = performance.now();

      try {
        await dispatch(rec, onProgress(rec.id));
        patch(rec.id, {
          status: "completed",
          transferredBytes: rec.totalBytes,
          speed: 0,
        });
        rec.onComplete?.();
        for (const cb of completeCbs.current) cb(rec.dest);
      } catch (e) {
        const msg = typeof e === "string" ? e : String(e);
        const policy = applyToAllRef.current;
        if (isDestinationConflict(msg) && policy) {
          resolveRecord(rec, policy);
        } else if (isDestinationConflict(msg)) {
          patch(rec.id, {
            status: "conflict",
            speed: 0,
            errorMessage: msg,
          });
        } else {
          patch(rec.id, {
            status: msg === "cancelled" ? "cancelled" : "failed",
            speed: 0,
            errorMessage: msg === "cancelled" ? undefined : msg,
          });
        }
      } finally {
        activeRef.current--;
        pumpRef.current();
      }
    },
    [patch, onProgress, resolveRecord],
  );

  const pump = useCallback(() => {
    if (activeRef.current >= MAX_ACTIVE) return;
    for (const rec of recordsRef.current.values()) {
      if (activeRef.current >= MAX_ACTIVE) break;
      if (rec.status === "pending") {
        void runTransfer(rec);
      }
    }
  }, [runTransfer]);
  pumpRef.current = pump;

  const enqueue = useCallback(
    (source: SftpPaneRef, entries: SftpEntry[], dest: SftpPaneRef) => {
      applyToAllRef.current = null;
      for (const entry of entries) {
        if (entry.name === ".." || entry.name === "") continue;
        const id = newTransferId();
        const dstPath = joinPath(dest.path, entry.name);
        const rec: TransferRecord = {
          id,
          fileName: entry.name,
          direction: directionFor(source, dest),
          status: "pending",
          totalBytes: entry.size,
          transferredBytes: 0,
          speed: 0,
          kind: entry.kind === "dir" ? "dir" : "file",
          source,
          dest,
          srcPath: joinPath(source.path, entry.name),
          dstPath,
          baseDstPath: dstPath,
          overwrite: false,
          renameAttempt: 0,
          lastBytes: 0,
          lastTime: 0,
        };
        recordsRef.current.set(id, rec);
      }
      sync();
      pump();
    },
    [sync, pump],
  );

  const enqueueRemoteEditUpload = useCallback(
    ({
      sessionId,
      localPath,
      remotePath,
      onComplete,
    }: {
      sessionId: number;
      localPath: string;
      remotePath: string;
      onComplete?: () => void;
    }) => {
      const id = newTransferId();
      const fileName = remotePath.split(/[\\/]/).pop() || remotePath;
      const rec: TransferRecord = {
        id,
        fileName,
        direction: "upload",
        status: "pending",
        totalBytes: 0,
        transferredBytes: 0,
        speed: 0,
        kind: "file",
        source: {
          side: "left",
          connKey: `remote-edit-local:${id}`,
          mode: "local",
          path: localPath.substring(0, localPath.lastIndexOf("/")) || "/",
          sessionId: null,
        },
        dest: {
          side: "right",
          connKey: `remote-edit:${sessionId}`,
          mode: "remote",
          path: remotePath.substring(0, remotePath.lastIndexOf("/")) || "/",
          sessionId,
        },
        srcPath: localPath,
        dstPath: remotePath,
        baseDstPath: remotePath,
        overwrite: true,
        renameAttempt: 0,
        lastBytes: 0,
        lastTime: 0,
        onComplete,
      };
      recordsRef.current.set(id, rec);
      sync();
      pump();
    },
    [sync, pump],
  );

  const cancel = useCallback(
    (id: string) => {
      const rec = recordsRef.current.get(id);
      if (!rec) return;
      if (rec.status === "transferring") {
        if (rec.source.mode === "remote" || rec.dest.mode === "remote") {
          void sftpCancel(id);
        } else {
          void fsCopyCancel(id);
        }
      } else {
        recordsRef.current.delete(id);
        sync();
      }
    },
    [sync],
  );

  const retry = useCallback(
    (id: string) => {
      const rec = recordsRef.current.get(id);
      if (!rec || rec.status === "transferring") return;
      patch(id, {
        status: "pending",
        transferredBytes: 0,
        errorMessage: undefined,
        overwrite: true,
      });
      pump();
    },
    [patch, pump],
  );

  const resolveConflict = useCallback(
    (id: string, action: SftpConflictAction, applyToAll: boolean) => {
      const rec = recordsRef.current.get(id);
      if (!rec || rec.status !== "conflict") return;
      if (applyToAll) {
        applyToAllRef.current = action;
        for (const conflict of recordsRef.current.values()) {
          if (conflict.status === "conflict") {
            resolveRecord(conflict, action);
          }
        }
      } else {
        resolveRecord(rec, action);
      }
      pump();
    },
    [resolveRecord, pump],
  );

  const clearFinished = useCallback(() => {
    for (const [id, rec] of recordsRef.current) {
      if (
        rec.status === "completed" ||
        rec.status === "failed" ||
        rec.status === "cancelled" ||
        rec.status === "skipped"
      ) {
        recordsRef.current.delete(id);
      }
    }
    sync();
  }, [sync]);

  const onDidComplete = useCallback((cb: (dest: SftpPaneRef) => void) => {
    completeCbs.current.add(cb);
    return () => completeCbs.current.delete(cb);
  }, []);

  const currentConflict =
    transfers.find((t) => t.status === "conflict") ?? null;

  return useMemo(
    () => ({
      transfers,
      currentConflict: currentConflict
        ? {
            id: currentConflict.id,
            fileName: currentConflict.fileName,
            dstPath: currentConflict.dstPath,
          }
        : null,
      enqueue,
      cancel,
      retry,
      enqueueRemoteEditUpload,
      resolveConflict,
      clearFinished,
      onDidComplete,
    }),
    [
      transfers,
      currentConflict,
      enqueue,
      cancel,
      retry,
      enqueueRemoteEditUpload,
      resolveConflict,
      clearFinished,
      onDidComplete,
    ],
  );
}

function dispatch(
  rec: TransferRecord,
  onProgress: (p: TransferProgress) => void,
): Promise<void> {
  const { source, dest, srcPath, dstPath, kind, id, overwrite } = rec;
  const recursive = kind === "dir";

  if (source.mode === "local" && dest.mode === "local") {
    const workspace = currentWorkspaceEnv();
    return recursive
      ? fsCopyRecursive({
          transferId: id,
          src: srcPath,
          dst: dstPath,
          overwrite,
          workspace,
          onProgress,
        })
      : fsCopy({
          transferId: id,
          src: srcPath,
          dst: dstPath,
          overwrite,
          workspace,
          onProgress,
        });
  }

  if (source.mode === "local" && dest.mode === "remote" && dest.sessionId != null) {
    return recursive
      ? sftpUploadRecursive({
          id: dest.sessionId,
          transferId: id,
          localPath: srcPath,
          remotePath: dstPath,
          overwrite,
          onProgress,
        })
      : sftpUpload({
          id: dest.sessionId,
          transferId: id,
          localPath: srcPath,
          remotePath: dstPath,
          overwrite,
          onProgress,
        });
  }

  if (source.mode === "remote" && dest.mode === "local" && source.sessionId != null) {
    return recursive
      ? sftpDownloadRecursive({
          id: source.sessionId,
          transferId: id,
          remotePath: srcPath,
          localPath: dstPath,
          overwrite,
          onProgress,
        })
      : sftpDownload({
          id: source.sessionId,
          transferId: id,
          remotePath: srcPath,
          localPath: dstPath,
          overwrite,
          onProgress,
        });
  }

  return Promise.reject("unsupported transfer route");
}
