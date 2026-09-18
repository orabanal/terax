/** Bytes/sec with binary-ish K/M units, matching the stats bar. */
export function fmtSpeed(bytes: number): string {
  if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(1)}M/s`;
  if (bytes >= 1_000) return `${(bytes / 1_000).toFixed(1)}K/s`;
  return `${bytes}B/s`;
}

/** Whole megabytes as gigabytes with one decimal ("42/111G" style). */
export function fmtGigabytes(mb: number): string {
  return `${(mb / 1024).toFixed(1)}G`;
}
