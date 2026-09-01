import { GitBranchIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Spinner } from "@/components/ui/spinner";
import type { GitQuickSummary } from "./lib/useGitSummary";

type Props = {
  summary: GitQuickSummary;
  loading?: boolean;
  onClick?: () => void;
};

export function GitStatusChip({ summary, loading = false, onClick }: Props) {
  const { branch, files, added, removed } = summary;
  const clean = files === 0 && added === 0 && removed === 0;

  const inner = (
    <>
      {loading ? (
        <Spinner className="size-3 shrink-0" />
      ) : (
        <HugeiconsIcon icon={GitBranchIcon} size={11} strokeWidth={1.75} className="shrink-0" />
      )}
      <span className="max-w-32 truncate">{branch}</span>
      {!loading && (clean ? (
        <span className="text-emerald-500 transition-all duration-300 animate-in fade-in-0 scale-in-0">&#x25cf;</span>
      ) : (
        <span className="flex items-center gap-1 animate-in fade-in-0 slide-in-from-right-1 duration-200">
          {files > 0 && (
            <span className="opacity-70">{files}</span>
          )}
          {files > 0 && (added > 0 || removed > 0) && (
            <span className="opacity-40">&#x2022;</span>
          )}
          {added > 0 && (
            <span className="font-medium text-emerald-500 transition-colors duration-200">+{added}</span>
          )}
          {removed > 0 && (
            <span className="font-medium text-red-500 transition-colors duration-200">-{removed}</span>
          )}
        </span>
      ))}
    </>
  );

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        aria-label={`Git status: ${branch}, ${clean ? 'clean' : `${files} changed files`}`}
        className="flex shrink-0 items-center gap-1 text-[10.5px] text-muted-foreground select-none cursor-pointer hover:text-foreground transition-all duration-200 hover:scale-105 active:scale-95"
      >
        {inner}
      </button>
    );
  }

  return (
    <span className="flex shrink-0 items-center gap-1 text-[10.5px] text-muted-foreground select-none" role="status" aria-label={`Git status: ${branch}, ${clean ? 'clean' : `${files} changed files`}`}>
      {inner}
    </span>
  );
}
