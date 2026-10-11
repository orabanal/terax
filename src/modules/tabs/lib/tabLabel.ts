import type { Tab } from "./useTabs";

export type LabelOpts = {
  workspace?: boolean;
  /**
   * Follow the cwd (default true = historical behavior). When false the
   * stored title is used verbatim, so tab names never change on `cd`
   * (SSH tabs keep their host name). Driven by the
   * `terminalDynamicTabTitle` preference; callers pass it explicitly to
   * keep this function pure and testable.
   */
  dynamic?: boolean;
};

/**
 * The label shown on a tab. Non-terminal tabs use their stored title; terminal
 * tabs prefer a user-set custom name, then a mixed-connection "Workspace"
 * marker (computed by the caller via `isWorkspaceTree`, keeping this pure),
 * then — only when `dynamic` is on — fall back to the last segment of the
 * cwd. Keeping this pure makes the "custom name survives a cd" invariant
 * testable without rendering the bar.
 */
export function labelFor(t: Tab, opts?: LabelOpts): string {
  if (t.kind === "editor") return t.title;
  if (t.kind === "preview") return t.title;
  if (t.kind === "markdown") return t.title;
  if (t.kind === "ai-diff") return t.title;
  if (t.kind === "git-diff") return t.title;
  if (t.kind === "git-history") return t.title;
  if (t.kind === "git-commit-file") return t.title;
  if (t.kind === "sftp") return t.title;
  if (t.customTitle) return t.customTitle;
  if (opts?.workspace) return "Workspace";
  if (opts?.dynamic === false) return t.title;
  if (!t.cwd) return t.title;
  const parts = t.cwd.split(/[\\/]/).filter(Boolean);
  return parts.length ? parts[parts.length - 1] : "/";
}
