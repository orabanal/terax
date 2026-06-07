/** Shared SFTP view types. Milestone 1 is visual-only — these describe the
 *  shape the real bridge will produce so the UI is built against it from day one. */

export type SftpEntryKind = "file" | "dir" | "symlink";

export type SftpEntry = {
  name: string;
  kind: SftpEntryKind;
  /** Byte size for files; 0 for directories. */
  size: number;
  /** Milliseconds since the UNIX epoch. */
  mtime: number;
  /** Unix permission bits (e.g. 0o644). Absent for local entries, where
   *  `fs_read_dir` does not report mode. */
  mode?: number;
};

/** Which side of the dual-pane a pane represents. */
export type SftpSide = "local" | "remote";

export type SftpTransferDirection = "upload" | "download";

export type SftpTransferStatus =
  | "pending"
  | "transferring"
  | "completed"
  | "failed"
  | "cancelled";

export type SftpTransfer = {
  id: string;
  fileName: string;
  direction: SftpTransferDirection;
  status: SftpTransferStatus;
  totalBytes: number;
  transferredBytes: number;
  /** Bytes per second. */
  speed: number;
};

/** A pane's connection target. Local is always present; remote is chosen from a host. */
export type SftpPaneTarget =
  | { side: "local" }
  | { side: "remote"; hostId: string; hostName: string };
