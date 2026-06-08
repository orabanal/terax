import { describe, expect, it } from "vitest";
import {
  DEFAULT_SFTP_SORT,
  nextSftpSort,
  sortSftpEntries,
  type SftpSortState,
} from "./sortEntries";
import type { SftpEntry } from "./types";

const entries: SftpEntry[] = [
  { name: "zeta.txt", kind: "file", size: 10, mtime: 100, mode: 0o644 },
  { name: "src", kind: "dir", size: 0, mtime: 300, mode: 0o755 },
  { name: "alpha.txt", kind: "file", size: 30, mtime: 200, mode: 0o600 },
  { name: "docs", kind: "dir", size: 0, mtime: 200, mode: 0o755 },
];

function names(list: SftpEntry[]): string[] {
  return list.map((entry) => entry.name);
}

describe("sortSftpEntries", () => {
  it("sorts by name ascending with directories first by default", () => {
    expect(names(sortSftpEntries(entries, DEFAULT_SFTP_SORT))).toEqual([
      "docs",
      "src",
      "alpha.txt",
      "zeta.txt",
    ]);
  });

  it("sorts by name descending while keeping directories first", () => {
    expect(
      names(sortSftpEntries(entries, { column: "name", direction: "desc" })),
    ).toEqual(["src", "docs", "zeta.txt", "alpha.txt"]);
  });

  it("sorts files by size descending", () => {
    expect(
      names(sortSftpEntries(entries, { column: "size", direction: "desc" })),
    ).toEqual(["docs", "src", "alpha.txt", "zeta.txt"]);
  });

  it("sorts by modified time descending", () => {
    expect(
      names(sortSftpEntries(entries, { column: "mtime", direction: "desc" })),
    ).toEqual(["src", "docs", "alpha.txt", "zeta.txt"]);
  });

  it("sorts permissions when some entries do not have a mode", () => {
    const withoutModes: SftpEntry[] = [
      { name: "b.txt", kind: "file", size: 1, mtime: 1 },
      { name: "a.txt", kind: "file", size: 1, mtime: 1, mode: 0o600 },
    ];

    expect(
      names(
        sortSftpEntries(withoutModes, {
          column: "permissions",
          direction: "asc",
        }),
      ),
    ).toEqual(["b.txt", "a.txt"]);
  });

  it("uses name as a deterministic tie breaker", () => {
    const tied: SftpEntry[] = [
      { name: "b.txt", kind: "file", size: 1, mtime: 1, mode: 0o644 },
      { name: "a.txt", kind: "file", size: 1, mtime: 1, mode: 0o644 },
    ];

    expect(
      names(sortSftpEntries(tied, { column: "size", direction: "desc" })),
    ).toEqual(["a.txt", "b.txt"]);
  });
});

describe("nextSftpSort", () => {
  it("toggles the active column", () => {
    expect(nextSftpSort(DEFAULT_SFTP_SORT, "name")).toEqual({
      column: "name",
      direction: "desc",
    } satisfies SftpSortState);
  });

  it("uses the initial direction for a new column", () => {
    expect(nextSftpSort(DEFAULT_SFTP_SORT, "size")).toEqual({
      column: "size",
      direction: "desc",
    } satisfies SftpSortState);
    expect(nextSftpSort(DEFAULT_SFTP_SORT, "permissions")).toEqual({
      column: "permissions",
      direction: "asc",
    } satisfies SftpSortState);
  });
});
