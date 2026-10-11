import { IS_WINDOWS } from "./platform";

// Safe to leave bare: alphanumerics plus conservative punctuation. Anything
// else (spaces, $, backticks, quotes, globs, ...) gets single-quoted, so
// plain paths like /ruta/rutab travel without apostrophes while odd ones
// stay correct. Empty and leading-dash values are always quoted (they
// would vanish or parse as flags); on PowerShell a leading @ is quoted too
// (splat operator).
const BARE_SAFE = /^[A-Za-z0-9_@%+=:,./~-]+$/;

function needsQuoting(value: string, windows: boolean): boolean {
  if (value === "") return true;
  if (value.startsWith("-")) return true;
  if (windows && value.startsWith("@")) return true;
  return !BARE_SAFE.test(value);
}

export function quoteShellArg(value: string, windows = IS_WINDOWS): string {
  if (!needsQuoting(value, windows)) return value;
  if (windows) {
    return `'${value.replace(/'/g, "''")}'`;
  }
  return `'${value.replace(/'/g, "'\\''")}'`;
}
