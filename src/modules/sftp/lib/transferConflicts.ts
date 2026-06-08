export type SftpConflictAction = "overwrite" | "rename" | "skip";

const CONFLICT_PATTERNS = [
  "destination exists",
  "already exists",
  "file exists",
];

export function isDestinationConflict(error: unknown): boolean {
  const message = typeof error === "string" ? error : String(error);
  const lower = message.toLowerCase();
  return CONFLICT_PATTERNS.some((pattern) => lower.includes(pattern));
}

export function renamedPath(path: string, attempt = 1): string {
  const normalizedAttempt = Math.max(1, attempt);
  const sepIndex = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  const dir = sepIndex >= 0 ? path.slice(0, sepIndex + 1) : "";
  const name = sepIndex >= 0 ? path.slice(sepIndex + 1) : path;
  const dotIndex = name.lastIndexOf(".");
  const hasExtension = dotIndex > 0;
  const base = hasExtension ? name.slice(0, dotIndex) : name;
  const ext = hasExtension ? name.slice(dotIndex) : "";
  return `${dir}${base} (${normalizedAttempt})${ext}`;
}
