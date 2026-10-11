import { cn } from "@/lib/utils";
import {
  Cancel01Icon,
  ComputerIcon,
  ServerStack01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

/** Connection state shown as a dot on each sub-tab. */
export type SftpConnStatus =
  | "idle"
  | "connecting"
  | "loading"
  | "loaded"
  | "error";

export type SftpSubTab = {
  id: string;
  label: string;
  /** e.g. "user@host:22" for remotes; undefined for local. */
  detail?: string;
  mode: "local" | "remote";
  status: SftpConnStatus;
};

type Props = {
  tabs: SftpSubTab[];
  activeIndex: number;
  onSelect: (index: number) => void;
  onClose: (index: number) => void;
  canClose: boolean;
  /** Right-aligned actions (e.g. the host picker) sharing the tab bar row. */
  actions?: React.ReactNode;
};

// No dot for steady states (loaded/idle): a permanent bright dot reads as
// decoration. Only transient states that need attention get a marker.
const STATUS_DOT: Partial<Record<SftpConnStatus, string>> = {
  connecting: "bg-amber-500 animate-pulse",
  loading: "bg-amber-500 animate-pulse",
  error: "bg-red-500",
};

const STATUS_LABEL: Record<SftpConnStatus, string> = {
  loaded: "Connected",
  connecting: "Connecting…",
  loading: "Loading…",
  error: "Connection error",
  idle: "Not connected",
};

/** Sub-tab bar rendered inside each SFTP pane: one regular-size tab per
 *  connection with mode icon and `user@host` detail. Only transient states
 *  (connecting / error) get a marker; steady states stay clean. */
export function SftpSubTabs({
  tabs,
  activeIndex,
  onSelect,
  onClose,
  canClose,
  actions,
}: Props) {
  return (
    <div
      role="tablist"
      aria-label="Connections"
      className="flex h-10 shrink-0 items-center gap-1.5 border-b border-border/60 bg-card px-2"
    >
      <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto">
      {tabs.map((tab, i) => {
        const active = i === activeIndex;
        const tooltip = `${tab.label}${tab.detail ? ` — ${tab.detail}` : ""} · ${STATUS_LABEL[tab.status]}`;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={active}
            title={tooltip}
            onClick={() => onSelect(i)}
            className={cn(
              "group flex h-7 max-w-64 shrink-0 items-center gap-2 rounded-lg px-2.5 text-xs transition-colors",
              active
                ? "bg-accent font-medium text-foreground ring-1 ring-inset ring-border"
                : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
            )}
          >
            <span className="relative shrink-0">
              <HugeiconsIcon
                icon={tab.mode === "local" ? ComputerIcon : ServerStack01Icon}
                size={15}
                strokeWidth={1.75}
                className={active ? "text-foreground" : "text-muted-foreground"}
              />
              {STATUS_DOT[tab.status] ? (
                <span
                  aria-hidden
                  title={STATUS_LABEL[tab.status]}
                  className={cn(
                    "absolute -bottom-0.5 -right-0.5 size-2 rounded-full ring-2 ring-card",
                    STATUS_DOT[tab.status],
                  )}
                />
              ) : null}
            </span>
            <span className="min-w-0 flex-1 truncate text-left">
              {tab.label}
            </span>
            {canClose && (
              <span
                role="button"
                tabIndex={-1}
                aria-label={`Close ${tab.label}`}
                onClick={(e) => {
                  e.stopPropagation();
                  onClose(i);
                }}
                // visibility (not display) so the hit area is always
                // reserved and hover never shifts the tab width.
                className={cn(
                  "flex size-5 shrink-0 items-center justify-center rounded-md hover:bg-muted",
                  active ? "visible" : "invisible group-hover:visible",
                )}
              >
                <HugeiconsIcon icon={Cancel01Icon} size={12} strokeWidth={2} />
              </span>
            )}
          </button>
        );
      })}
      </div>
      {actions ? (
        <div className="flex shrink-0 items-center border-l border-border/60 pl-2">
          {actions}
        </div>
      ) : null}
    </div>
  );
}
