import { useEffect, useRef } from "react";
import { AgentStatusPill } from "@/modules/ai/components/AgentStatusPill";
import { AiOpenButton } from "@/modules/ai/components/AiStatusBarControls";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Edit02Icon, IncognitoIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { CwdBreadcrumb } from "./CwdBreadcrumb";
import { WorkspaceEnvSelector } from "./WorkspaceEnvSelector";
import { GitStatusChip } from "./GitStatusChip";
import { useGitSummary } from "./lib/useGitSummary";
import type { WorkspaceEnv } from "@/modules/workspace";

export type GitClickInfo = {
  repoRoot: string | null;
  sshCwd: string | null;
  leafId: number | null;
  isSSH: boolean;
  branch: string | null;
};

type Props = {
  cwd: string | null;
  filePath?: string | null;
  home: string | null;
  onCd: (path: string) => void;
  onWorkspaceChange: (env: WorkspaceEnv) => void;
  onOpenMini: () => void;
  privateActive: boolean;
  leafId: number | null;
  isSSH: boolean;
  onGitClick?: (info: GitClickInfo) => void;
  isComposeBarOpen?: boolean;
  onToggleComposeBar?: () => void;
  onSshCwdChange?: (sshCwd: string | null) => void;
};

export function StatusBar({
  cwd,
  filePath,
  home,
  onCd,
  onWorkspaceChange,
  onOpenMini,
  privateActive,
  leafId,
  isSSH,
  onGitClick,
  isComposeBarOpen,
  onToggleComposeBar,
  onSshCwdChange,
}: Props) {
  const { summary: gitSummary, sshCwd, loading: gitLoading } = useGitSummary(cwd, leafId, isSSH);

  const onSshCwdChangeRef = useRef(onSshCwdChange);
  onSshCwdChangeRef.current = onSshCwdChange;
  useEffect(() => {
    onSshCwdChangeRef.current?.(sshCwd);
  }, [sshCwd]);

  return (
    <footer className="flex h-7 shrink-0 items-center justify-between gap-3 border-t border-border/60 bg-card/60 px-3 text-[10.5px]">
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <WorkspaceEnvSelector onSelect={onWorkspaceChange} />
        <CwdBreadcrumb cwd={cwd} filePath={filePath} home={home} onCd={onCd} />
        {gitSummary && (
          <GitStatusChip
            summary={gitSummary}
            loading={gitLoading}
            onClick={onGitClick ? () => onGitClick({
              repoRoot: gitSummary.repoRoot || null,
              sshCwd,
              leafId,
              isSSH,
              branch: gitSummary.branch,
            }) : undefined}
          />
        )}
        {privateActive ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="flex shrink-0 cursor-default items-center gap-1 rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-medium text-amber-700 transition-all duration-200 dark:text-amber-400 animate-in fade-in-0 slide-in-from-left-2">
                <HugeiconsIcon icon={IncognitoIcon} size={11} strokeWidth={2} />
                <span>Private: hidden from AI</span>
              </span>
            </TooltipTrigger>
            <TooltipContent side="top" className="max-w-64 text-[11px] leading-relaxed">
              AI can't see this terminal's output. Use it for secrets, SSH, or
              anything you don't want sent to the model.
            </TooltipContent>
          </Tooltip>
        ) : null}
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        {leafId !== null && onToggleComposeBar && (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={onToggleComposeBar}
                aria-label={isComposeBarOpen ? "Close compose bar" : "Open compose bar"}
                className={`flex h-5 w-5 items-center justify-center rounded-md transition-all duration-200 ${
                  isComposeBarOpen
                    ? "bg-primary/15 text-primary scale-105"
                    : "text-muted-foreground/70 hover:bg-muted/30 hover:text-foreground hover:scale-105"
                }`}
              >
                <HugeiconsIcon icon={Edit02Icon} size={12} strokeWidth={2} />
              </button>
            </TooltipTrigger>
            <TooltipContent side="top" className="text-[11px]">
              {isComposeBarOpen ? "Close compose bar" : "Open compose bar"}
            </TooltipContent>
          </Tooltip>
        )}
        <AgentStatusPill onClick={onOpenMini} />
        <AiOpenButton onOpen={onOpenMini} />
      </div>
    </footer>
  );
}
