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
  | "conflict"
  | "completed"
  | "failed"
  | "cancelled"
  | "skipped";

export type SftpTransfer = {
  id: string;
  fileName: string;
  direction: SftpTransferDirection;
  status: SftpTransferStatus;
  totalBytes: number;
  transferredBytes: number;
  /** Bytes per second. */
  speed: number;
  /** Present when status needs a message in the queue row. */
  errorMessage?: string;
};

/** Which pane a drag started in. The two top-level panes of the dual view. */
export type SftpPaneSide = "left" | "right";

/** Identifies one mounted pane (a sub-tab connection within a side). */
export type SftpPaneRef = {
  side: SftpPaneSide;
  /** Connection key — distinguishes sub-tabs and local vs remote. */
  connKey: string;
  /** "local" reads/writes the filesystem; "remote" uses an SFTP session. */
  mode: "local" | "remote";
  /** Current directory shown in the pane. */
  path: string;
  /** SFTP session id when mode === "remote". */
  sessionId: number | null;
};

/** What the user picked up: the source pane plus the dragged entries. */
export type SftpDragPayload = {
  source: SftpPaneRef;
  entries: SftpEntry[];
};

/** Where a drop landed. `intoDir` is the resolved destination directory. */
export type SftpDropTarget = {
  pane: SftpPaneRef;
  /** Destination directory: the pane's path, or a folder row under the cursor. */
  intoDir: string;
};

/** A pane's connection target. Local is always present; remote is chosen from a host. */
export type SftpPaneTarget =
  | { side: "local" }
  | { side: "remote"; hostId: string; hostName: string };

/** Pixel widths for the resizable fixed columns in the SFTP list view. */
export type ColWidths = { size: number; mtime: number; permissions: number };

/** Layout mode for a pane: row-based list, icon grid, or expandable tree. */
export type SftpViewMode = "list" | "icons" | "tree";

/** Filesystem mutation operations shared by local and remote hooks. */
export type DirMutations = {
  mkdir: (name: string) => Promise<void>;
  createFile: (name: string) => Promise<void>;
  rename: (oldName: string, newName: string) => Promise<void>;
  remove: (entries: SftpEntry[]) => Promise<void>;
  chmod: (name: string, mode: number) => Promise<void>;
};
