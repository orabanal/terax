/** Pure display formatters for the SFTP view. No side effects, no clock reads. */

const UNITS = ["B", "KB", "MB", "GB", "TB"];

/** Human-readable byte size, e.g. 48_234_496 -> "46.0 MB". */
export function formatSize(bytes: number): string {
  if (bytes <= 0) return "—";
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024;
    unit++;
  }
  const rounded = unit === 0 ? value : value.toFixed(1);
  return `${rounded} ${UNITS[unit]}`;
}

/** Formats an epoch-ms timestamp as a compact local date-time. `now` is passed
 *  in so callers control the clock (keeps this pure and testable). */
export function formatMtime(mtime: number, now: number): string {
  if (!mtime) return "—";
  const date = new Date(mtime);
  const sameYear = new Date(now).getFullYear() === date.getFullYear();
  const month = date.toLocaleString(undefined, { month: "short" });
  const day = String(date.getDate()).padStart(2, "0");
  if (!sameYear) return `${month} ${day} ${date.getFullYear()}`;
  const hh = String(date.getHours()).padStart(2, "0");
  const mm = String(date.getMinutes()).padStart(2, "0");
  return `${month} ${day} ${hh}:${mm}`;
}

/** Unix mode bits -> rwx string, e.g. 0o755 -> "rwxr-xr-x". */
export function formatPermissions(mode: number): string {
  const bits = mode & 0o777;
  const triplet = (n: number) =>
    `${n & 4 ? "r" : "-"}${n & 2 ? "w" : "-"}${n & 1 ? "x" : "-"}`;
  return `${triplet((bits >> 6) & 7)}${triplet((bits >> 3) & 7)}${triplet(bits & 7)}`;
}

/** Octal string for the permissions dialog, e.g. 0o644 -> "644". */
export function formatOctal(mode: number): string {
  return (mode & 0o777).toString(8).padStart(3, "0");
}
