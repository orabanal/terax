import type { SftpEntry } from "./types";

export type SftpSortColumn = "name" | "size" | "mtime" | "permissions";
export type SftpSortDirection = "asc" | "desc";

export type SftpSortState = {
  column: SftpSortColumn;
  direction: SftpSortDirection;
};

export const DEFAULT_SFTP_SORT: SftpSortState = {
  column: "name",
  direction: "asc",
};

const INITIAL_DIRECTION_BY_COLUMN: Record<SftpSortColumn, SftpSortDirection> = {
  name: "asc",
  size: "desc",
  mtime: "desc",
  permissions: "asc",
};

export function nextSftpSort(
  current: SftpSortState,
  column: SftpSortColumn,
): SftpSortState {
  if (current.column !== column) {
    return { column, direction: INITIAL_DIRECTION_BY_COLUMN[column] };
  }

  return {
    column,
    direction: current.direction === "asc" ? "desc" : "asc",
  };
}

export function sortSftpEntries(
  entries: readonly SftpEntry[],
  sort: SftpSortState,
): SftpEntry[] {
  return [...entries].sort((a, b) => compareEntries(a, b, sort));
}

function compareEntries(a: SftpEntry, b: SftpEntry, sort: SftpSortState): number {
  const ak = a.kind === "dir" ? 0 : 1;
  const bk = b.kind === "dir" ? 0 : 1;
  if (ak !== bk) return ak - bk;

  const value = compareByColumn(a, b, sort.column);
  if (value !== 0) return sort.direction === "asc" ? value : -value;

  return compareNames(a.name, b.name);
}

function compareByColumn(
  a: SftpEntry,
  b: SftpEntry,
  column: SftpSortColumn,
): number {
  if (column === "name") return compareNames(a.name, b.name);
  if (column === "size") {
    if (a.kind === "dir" && b.kind === "dir") return 0;
    return a.size - b.size;
  }
  if (column === "mtime") return a.mtime - b.mtime;
  return (a.mode ?? -1) - (b.mode ?? -1);
}

function compareNames(a: string, b: string): number {
  return a.localeCompare(b);
}
