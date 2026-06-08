import type { SftpPaneRef, SftpTransferDirection } from "./types";

/** Joins a directory and a name with a single slash. Pure. */
export function joinPath(dir: string, name: string): string {
  return dir.endsWith("/") ? `${dir}${name}` : `${dir}/${name}`;
}

/** Picks the arrow direction shown in the transfer queue. Pure. */
export function directionFor(
  source: SftpPaneRef,
  dest: SftpPaneRef,
): SftpTransferDirection {
  // Upload = bytes leaving the local machine; download = arriving.
  if (source.mode === "local" && dest.mode === "remote") return "upload";
  if (source.mode === "remote" && dest.mode === "local") return "download";
  // local→local and remote→remote: label by dest for the arrow direction.
  return dest.mode === "remote" ? "upload" : "download";
}

/** True when a drop target is a valid destination for a drag from `sourceKey`. */
export function isValidDrop(sourceConnKey: string, targetConnKey: string): boolean {
  return sourceConnKey !== targetConnKey;
}
