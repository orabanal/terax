import type { SftpEntry } from "./types";

/** Static fixtures for Milestone 1 — visual shell only, no backend. */

const DAY = 86_400_000;
// Fixed epoch base so the shell renders deterministically (no Date.now()).
const BASE_MTIME = 1_717_200_000_000;

export const MOCK_LOCAL_PATH = "/Users/me/projects";

export const MOCK_LOCAL_ENTRIES: SftpEntry[] = [
  { name: "src", kind: "dir", size: 0, mtime: BASE_MTIME - 2 * DAY, mode: 0o755 },
  { name: "node_modules", kind: "dir", size: 0, mtime: BASE_MTIME - 9 * DAY, mode: 0o755 },
  { name: "dist", kind: "dir", size: 0, mtime: BASE_MTIME - 1 * DAY, mode: 0o755 },
  { name: "package.json", kind: "file", size: 2_148, mtime: BASE_MTIME - 1 * DAY, mode: 0o644 },
  { name: "pnpm-lock.yaml", kind: "file", size: 184_320, mtime: BASE_MTIME - 3 * DAY, mode: 0o644 },
  { name: "tsconfig.json", kind: "file", size: 612, mtime: BASE_MTIME - 7 * DAY, mode: 0o644 },
  { name: "README.md", kind: "file", size: 4_096, mtime: BASE_MTIME - 5 * DAY, mode: 0o644 },
  { name: ".env.local", kind: "file", size: 320, mtime: BASE_MTIME - 4 * DAY, mode: 0o600 },
  { name: "latest.log", kind: "symlink", size: 12, mtime: BASE_MTIME - 6 * DAY, mode: 0o777 },
];

export const MOCK_REMOTE_PATH = "/home/deploy/app";

export const MOCK_REMOTE_ENTRIES: SftpEntry[] = [
  { name: "releases", kind: "dir", size: 0, mtime: BASE_MTIME - 1 * DAY, mode: 0o755 },
  { name: "shared", kind: "dir", size: 0, mtime: BASE_MTIME - 14 * DAY, mode: 0o755 },
  { name: "current", kind: "symlink", size: 28, mtime: BASE_MTIME - 1 * DAY, mode: 0o777 },
  { name: "deploy.yml", kind: "file", size: 1_536, mtime: BASE_MTIME - 2 * DAY, mode: 0o644 },
  { name: "nginx.conf", kind: "file", size: 3_872, mtime: BASE_MTIME - 10 * DAY, mode: 0o644 },
  { name: "app.service", kind: "file", size: 742, mtime: BASE_MTIME - 12 * DAY, mode: 0o644 },
  { name: "backup.tar.gz", kind: "file", size: 48_234_496, mtime: BASE_MTIME - 1 * DAY, mode: 0o640 },
];

export const MOCK_HOSTS = [
  { id: "h1", name: "production (deploy@1.2.3.4)" },
  { id: "h2", name: "staging (deploy@staging.internal)" },
  { id: "h3", name: "db-primary (admin@10.0.0.5)" },
];
