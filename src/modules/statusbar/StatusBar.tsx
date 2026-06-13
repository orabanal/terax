import { AgentStatusPill } from "@/modules/ai/components/AgentStatusPill";
import { AiOpenButton } from "@/modules/ai/components/AiStatusBarControls";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { IncognitoIcon } from "@hugeicons/core-free-icons";
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
}: Props) {
  const { summary: gitSummary, sshCwd } = useGitSummary(cwd, leafId, isSSH);

  return (
    <footer className="flex h-8 shrink-0 items-center justify-between gap-3 border-t border-border/60 bg-card/60 px-3 text-[11px]">
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <WorkspaceEnvSelector onSelect={onWorkspaceChange} />
        <CwdBreadcrumb cwd={cwd} filePath={filePath} home={home} onCd={onCd} />
        {gitSummary && (
          <GitStatusChip
            summary={gitSummary}
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
              <span className="flex shrink-0 cursor-default items-center gap-1 rounded-full bg-amber-500/15 px-2 py-0.5 text-[10.5px] font-medium text-amber-700 dark:text-amber-400">
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
        <AgentStatusPill onClick={onOpenMini} />
        <AiOpenButton onOpen={onOpenMini} />
      </div>
    </footer>
  );
}
