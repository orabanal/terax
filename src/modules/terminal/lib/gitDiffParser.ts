export type DiffLine = { type: "add" | "remove" | "context"; content: string };
export type DiffHunk = { header: string; lines: DiffLine[] };
export type DiffFile = {
  path: string;
  added: number;
  removed: number;
  hunks: DiffHunk[];
  isBinary: boolean;
};
export type ParsedGitDiff = {
  files: DiffFile[];
  totalAdded: number;
  totalRemoved: number;
};

export function parseGitDiff(raw: string): ParsedGitDiff {
  const files: DiffFile[] = [];
  if (!raw.trim()) return { files, totalAdded: 0, totalRemoved: 0 };

  for (const chunk of raw.split(/(?=^diff --git )/m).filter(Boolean)) {
    const lines = chunk.split("\n");
    const match = lines[0].match(/^diff --git a\/.+ b\/(.+)$/);
    if (!match) continue;
    const filePath = match[1].trim();
    const isBinary = lines.some((l) => /^Binary files/.test(l));
    const hunks: DiffHunk[] = [];
    let cur: DiffHunk | null = null;
    let fileAdded = 0;
    let fileRemoved = 0;
    for (const line of lines) {
      if (line.startsWith("@@ ")) {
        if (cur) hunks.push(cur);
        cur = { header: line, lines: [] };
      } else if (cur) {
        if (line.startsWith("+") && !line.startsWith("+++")) {
          cur.lines.push({ type: "add", content: line.slice(1) });
          fileAdded++;
        } else if (line.startsWith("-") && !line.startsWith("---")) {
          cur.lines.push({ type: "remove", content: line.slice(1) });
          fileRemoved++;
        } else if (line.startsWith(" ")) {
          cur.lines.push({ type: "context", content: line.slice(1) });
        }
      }
    }
    if (cur) hunks.push(cur);
    files.push({ path: filePath, added: fileAdded, removed: fileRemoved, hunks, isBinary });
  }

  const totalAdded = files.reduce((s, f) => s + f.added, 0);
  const totalRemoved = files.reduce((s, f) => s + f.removed, 0);
  return { files, totalAdded, totalRemoved };
}
