import { invoke, Channel } from "@tauri-apps/api/core";

/** Mirror of the Rust `SftpTransferProgress` / `FsCopyProgress` events. */
export type TransferProgress = {
  transferId: string;
  bytesDone: number;
  totalBytes: number;
  currentFile: string;
};

/** Generates an opaque transfer id shared between frontend and backend. */
let nextTransferSeq = 1;
export function newTransferId(): string {
  return `xfer-${Date.now()}-${nextTransferSeq++}`;
}

type ProgressCb = (p: TransferProgress) => void;

function channel(onProgress?: ProgressCb): Channel<TransferProgress> {
  const ch = new Channel<TransferProgress>();
  if (onProgress) ch.onmessage = onProgress;
  return ch;
}

/** Local → local file copy with streamed progress. */
export function fsCopy(args: {
  transferId: string;
  src: string;
  dst: string;
  overwrite: boolean;
  workspace?: unknown;
  onProgress?: ProgressCb;
}): Promise<void> {
  return invoke("fs_copy", {
    transferId: args.transferId,
    src: args.src,
    dst: args.dst,
    overwrite: args.overwrite,
    workspace: args.workspace,
    onProgress: channel(args.onProgress),
  });
}

/** Local → local recursive directory copy. */
export function fsCopyRecursive(args: {
  transferId: string;
  src: string;
  dst: string;
  overwrite: boolean;
  workspace?: unknown;
  onProgress?: ProgressCb;
}): Promise<void> {
  return invoke("fs_copy_recursive", {
    transferId: args.transferId,
    src: args.src,
    dst: args.dst,
    overwrite: args.overwrite,
    workspace: args.workspace,
    onProgress: channel(args.onProgress),
  });
}

export function fsCopyCancel(transferId: string): Promise<void> {
  return invoke("fs_copy_cancel", { transferId });
}

/** Local → remote upload (single file). */
export function sftpUpload(args: {
  id: number;
  transferId: string;
  localPath: string;
  remotePath: string;
  overwrite: boolean;
  onProgress?: ProgressCb;
}): Promise<void> {
  return invoke("sftp_upload", {
    id: args.id,
    transferId: args.transferId,
    localPath: args.localPath,
    remotePath: args.remotePath,
    overwrite: args.overwrite,
    onProgress: channel(args.onProgress),
  });
}

/** Remote → local download (single file). */
export function sftpDownload(args: {
  id: number;
  transferId: string;
  remotePath: string;
  localPath: string;
  overwrite: boolean;
  onProgress?: ProgressCb;
}): Promise<void> {
  return invoke("sftp_download", {
    id: args.id,
    transferId: args.transferId,
    remotePath: args.remotePath,
    localPath: args.localPath,
    overwrite: args.overwrite,
    onProgress: channel(args.onProgress),
  });
}

/** Local → remote recursive upload. */
export function sftpUploadRecursive(args: {
  id: number;
  transferId: string;
  localPath: string;
  remotePath: string;
  overwrite: boolean;
  onProgress?: ProgressCb;
}): Promise<void> {
  return invoke("sftp_upload_recursive", {
    id: args.id,
    transferId: args.transferId,
    localPath: args.localPath,
    remotePath: args.remotePath,
    overwrite: args.overwrite,
    onProgress: channel(args.onProgress),
  });
}

/** Remote → local recursive download. */
export function sftpDownloadRecursive(args: {
  id: number;
  transferId: string;
  remotePath: string;
  localPath: string;
  overwrite: boolean;
  onProgress?: ProgressCb;
}): Promise<void> {
  return invoke("sftp_download_recursive", {
    id: args.id,
    transferId: args.transferId,
    remotePath: args.remotePath,
    localPath: args.localPath,
    overwrite: args.overwrite,
    onProgress: channel(args.onProgress),
  });
}

export function sftpCancel(transferId: string): Promise<void> {
  return invoke("sftp_cancel", { transferId });
}

type SftpExecResult = {
  stdout: string;
  stderr: string;
  exitCode: number | null;
};

/** Server-side file/dir copy via sftp_exec + `cp -rp`. Used for remote duplicate. */
export async function sftpCopyRemote(args: {
  sessionId: number;
  srcPath: string;
  dstPath: string;
}): Promise<void> {
  const esc = (p: string) => p.replace(/'/g, "'\\''");
  const cmd = `test -e '${esc(args.dstPath)}' && printf 'destination exists\\n' && exit 1; cp -rp '${esc(args.srcPath)}' '${esc(args.dstPath)}'`;
  const result = await invoke<SftpExecResult>("sftp_exec", {
    id: args.sessionId,
    command: cmd,
  });
  const failed = result.exitCode !== null && result.exitCode !== 0;
  if (failed || (result.exitCode === null && (result.stdout.trim() || result.stderr.trim()))) {
    throw result.stdout.trim() || result.stderr.trim() || "server-side copy failed";
  }
}
