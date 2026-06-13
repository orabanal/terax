import { GitBranchIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { GitQuickSummary } from "./lib/useGitSummary";

type Props = {
  summary: GitQuickSummary;
  onClick?: () => void;
};

export function GitStatusChip({ summary, onClick }: Props) {
  const { branch, files, added, removed } = summary;
  const clean = files === 0 && added === 0 && removed === 0;

  const inner = (
    <>
      <HugeiconsIcon icon={GitBranchIcon} size={12} strokeWidth={1.75} className="shrink-0" />
      <span className="max-w-32 truncate">{branch}</span>
      {clean ? (
        <span className="text-emerald-500">&#x25cf;</span>
      ) : (
        <>
          {files > 0 && (
            <span className="opacity-70">{files}</span>
          )}
          {files > 0 && (added > 0 || removed > 0) && (
            <span className="opacity-40">&#x2022;</span>
          )}
          {added > 0 && (
            <span className="font-medium text-emerald-500">+{added}</span>
          )}
          {removed > 0 && (
            <span className="font-medium text-red-500">-{removed}</span>
          )}
        </>
      )}
    </>
  );

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        className="flex shrink-0 items-center gap-1 text-[11px] text-muted-foreground select-none cursor-pointer hover:text-foreground transition-colors"
      >
        {inner}
      </button>
    );
  }

  return (
    <span className="flex shrink-0 items-center gap-1 text-[11px] text-muted-foreground select-none">
      {inner}
    </span>
  );
}
