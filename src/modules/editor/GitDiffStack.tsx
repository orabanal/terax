import type {
  GitCommitFileDiffTab,
  GitDiffTab,
  Tab,
} from "@/modules/tabs";
import { GitDiffPane } from "./GitDiffPane";

type Props = {
  tabs: Tab[];
  activeId: number;
};

export function GitDiffStack({ tabs, activeId }: Props) {
  const active = tabs.find(
    (t): t is GitDiffTab | GitCommitFileDiffTab =>
      (t.kind === "git-diff" || t.kind === "git-commit-file") &&
      t.id === activeId,
  );
  if (!active) return null;
  if (active.kind === "git-diff") {
    const source = active.sshDiffContent
      ? {
          kind: "ssh" as const,
          path: active.path,
          originalContent: active.sshDiffContent.originalContent,
          modifiedContent: active.sshDiffContent.modifiedContent,
          fallbackPatch: active.sshDiffContent.fallbackPatch,
        }
      : {
          kind: "working" as const,
          repoRoot: active.repoRoot,
          path: active.path,
          mode: active.mode,
          originalPath: active.originalPath,
        };
    return (
      <div className="h-full w-full">
        <GitDiffPane key={active.id} active source={source} />
      </div>
    );
  }
  return (
    <div className="h-full w-full">
      <GitDiffPane
        key={active.id}
        active
        source={{
          kind: "commit",
          repoRoot: active.repoRoot,
          sha: active.sha,
          path: active.path,
          originalPath: active.originalPath,
        }}
        chipLabel={active.shortSha}
      />
    </div>
  );
}
