import { cn } from "@/lib/utils";
import {
  Clock01Icon,
  Message01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { SessionMeta } from "../lib/sessions";

type Props = {
  recentSessions: SessionMeta[];
  onSelectSession: (id: string) => void;
};

function timeAgo(ts: number): string {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function AiSidebarDraft({ recentSessions, onSelectSession }: Props) {
  return (
    <div className="flex h-full flex-col">
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-6 px-4">
        <div className="flex flex-col items-center gap-2 text-center">
          <div className="flex size-10 items-center justify-center rounded-full bg-muted/50">
            <HugeiconsIcon
              icon={Message01Icon}
              size={20}
              strokeWidth={1.5}
              className="text-muted-foreground"
            />
          </div>
          <h3 className="text-sm font-medium text-foreground">
            AI Assistant
          </h3>
          <p className="max-w-[240px] text-xs text-muted-foreground">
            Ask anything about your terminal, code, or workspace.
          </p>
        </div>

        {recentSessions.length > 0 && (
          <div className="w-full max-w-[320px]">
            <p className="mb-2 text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60">
              Recent sessions
            </p>
            <div className="flex flex-col gap-0.5">
              {recentSessions.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => onSelectSession(s.id)}
                  className={cn(
                    "flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors",
                    "hover:bg-accent/50",
                  )}
                >
                  <HugeiconsIcon
                    icon={Clock01Icon}
                    size={12}
                    strokeWidth={1.75}
                    className="shrink-0 text-muted-foreground/50"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs text-foreground/80">
                      {s.title}
                    </p>
                  </div>
                  <span className="shrink-0 text-[10px] text-muted-foreground/40">
                    {timeAgo(s.updatedAt)}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
