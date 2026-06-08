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
