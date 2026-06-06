import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { useChat, type UIMessage } from "@ai-sdk/react";
import {
  Add01Icon,
  ArrowDown01Icon,
  Cancel01Icon,
  ClockIcon,
  Delete02Icon,
  EyeIcon,
  TimeScheduleIcon,
  ZapIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  type KeyboardEvent,
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { SessionScope, SessionScopeType } from "../lib/sessions";
import { useChatStore, type PermissionMode } from "../store/chatStore";
import { getOrCreateChat, sendMessage } from "../store/chatRuntime";
import { AgentSwitcher } from "./AgentSwitcher";
import { AiChatView } from "./AiChat";
import { AiModelPicker } from "./AiModelPicker";

const MIN_WIDTH = 360;
const DEFAULT_WIDTH = 400;

export type AiSidebarProps = {
  open: boolean;
  onToggle: () => void;
  hasComposer: boolean;
  scopeType: SessionScopeType;
  scopeTargetId: string | null;
};

export const AiSidebar = memo(function AiSidebar({
  open,
  onToggle,
  hasComposer,
  scopeType,
  scopeTargetId,
}: AiSidebarProps) {
  const [width, setWidth] = useState(DEFAULT_WIDTH);
  const dragRef = useRef<{ startX: number; startW: number } | null>(null);
  const widthRef = useRef(DEFAULT_WIDTH);

  const handleDragStart = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      dragRef.current = { startX: e.clientX, startW: widthRef.current };
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
    },
    [],
  );

  const handleDragMove = useCallback(
    (e: React.PointerEvent) => {
      if (!dragRef.current) return;
      const delta = dragRef.current.startX - e.clientX;
      const newW = Math.max(MIN_WIDTH, dragRef.current.startW + delta);
      widthRef.current = newW;
      setWidth(newW);
    },
    [],
  );

  const handleDragEnd = useCallback(() => {
    dragRef.current = null;
  }, []);

  if (!open) return null;

  return (
    <div
      className="relative flex h-full shrink-0 flex-col border-l border-border/60 bg-card"
      style={{ width }}
    >
      {/* Drag handle */}
      <div
        className="absolute left-0 top-0 z-10 h-full w-1.5 cursor-ew-resize hover:bg-primary/30 transition-colors"
        onPointerDown={handleDragStart}
        onPointerMove={handleDragMove}
        onPointerUp={handleDragEnd}
        onPointerCancel={handleDragEnd}
      />

      <AiSidebarInner
        hasComposer={hasComposer}
        scopeType={scopeType}
        scopeTargetId={scopeTargetId}
        onToggle={onToggle}
      />
    </div>
  );
});

function AiSidebarInner({
  hasComposer,
  scopeType,
  scopeTargetId,
  onToggle,
}: {
  hasComposer: boolean;
  scopeType: SessionScopeType;
  scopeTargetId: string | null;
  onToggle: () => void;
}) {
  const scope: SessionScope = { type: scopeType, targetId: scopeTargetId ?? "" };

  const sessions = useChatStore((s) => s.sessions);
  const activeSessionId = useChatStore((s) => s.activeSessionId);
  const newSession = useChatStore((s) => s.newSession);
  const deleteSession = useChatStore((s) => s.deleteSession);
  const switchSession = useChatStore((s) => s.switchSession);
  const getActiveSessionForScope = useChatStore((s) => s.getActiveSessionForScope);
  const selectedModelId = useChatStore((s) => s.selectedModelId);
  const setSelectedModelId = useChatStore((s) => s.setSelectedModelId);
  const permissionMode = useChatStore((s) => s.permissionMode);
  const setPermissionMode = useChatStore((s) => s.setPermissionMode);

  const [showHistory, setShowHistory] = useState(false);
  const [input, setInput] = useState("");

  const scopedSessionId = getActiveSessionForScope(scope);
  const sessionId = activeSessionId ?? scopedSessionId;

  useEffect(() => {
    if (!sessionId && hasComposer) {
      const s: SessionScope = { type: scopeType, targetId: scopeTargetId ?? "" };
      const id = newSession(s);
      switchSession(id);
    }
  }, [sessionId, hasComposer, newSession, switchSession, scopeType, scopeTargetId]);

  if (!hasComposer) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 px-4 text-center">
        <p className="text-xs text-muted-foreground">
          Add an API key to start using the AI agent.
        </p>
        <Button
          size="sm"
          variant="outline"
          className="text-[11px]"
          onClick={() => {
            import("@/modules/settings/openSettingsWindow").then((m) =>
              m.openSettingsWindow("models"),
            );
          }}
        >
          Open settings
        </Button>
      </div>
    );
  }

  if (!sessionId) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Spinner />
      </div>
    );
  }

  return (
    <AiSidebarSession
      sessionId={sessionId}
      scope={scope}
      input={input}
      setInput={setInput}
      showHistory={showHistory}
      setShowHistory={setShowHistory}
      onToggle={onToggle}
      permissionMode={permissionMode}
      setPermissionMode={setPermissionMode}
      selectedModelId={selectedModelId}
      setSelectedModelId={setSelectedModelId}
      deleteSession={deleteSession}
      sessions={sessions}
      switchSession={switchSession}
      newSession={newSession}
    />
  );
}

type SessionProps = {
  sessionId: string;
  scope: SessionScope;
  input: string;
  setInput: (v: string) => void;
  showHistory: boolean;
  setShowHistory: (v: boolean) => void;
  onToggle: () => void;
  permissionMode: PermissionMode;
  setPermissionMode: (mode: PermissionMode) => void;
  selectedModelId: string;
  setSelectedModelId: (id: string) => void;
  deleteSession: (id: string) => void;
  sessions: Array<{ id: string; title: string; scope?: SessionScope; updatedAt: number }>;
  switchSession: (id: string) => void;
  newSession: (scope?: SessionScope) => string;
};

function AiSidebarSession({
  sessionId,
  scope,
  input,
  setInput,
  showHistory,
  setShowHistory,
  onToggle,
  permissionMode,
  setPermissionMode,
  selectedModelId,
  setSelectedModelId,
  deleteSession,
  sessions,
  switchSession,
  newSession,
}: SessionProps) {
  const chat = useMemo(() => getOrCreateChat(sessionId), [sessionId]);
  const helpers = useChat<UIMessage>({ chat });
  const isBusy = helpers.status === "submitted" || helpers.status === "streaming";
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleSend = useCallback(async () => {
    const text = input.trim();
    if (!text || isBusy) return;
    setInput("");
    await sendMessage(text);
  }, [input, isBusy, setInput]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        void handleSend();
      }
    },
    [handleSend],
  );

  const handleNewChat = useCallback(() => {
    const id = newSession(scope);
    switchSession(id);
    setShowHistory(false);
  }, [newSession, scope, switchSession, setShowHistory]);

  const scopedSessions = useMemo(() => {
    return sessions
      .filter((s) => s.scope?.type === scope.type && s.scope?.targetId === scope.targetId)
      .map((s) => ({ id: s.id, title: s.title, updatedAt: s.updatedAt }));
  }, [sessions, scope]);

  const step = useChatStore((s) => s.agentMeta.step);

  return (
    <>
      {/* Header */}
      <div className="flex h-10 shrink-0 items-center justify-between gap-1.5 border-b border-border/60 px-2">
        <div className="flex min-w-0 items-center gap-1.5">
          <AgentSwitcher isMiniWindow />
        </div>
        <div className="flex items-center gap-0.5">
          <Button
            size="xs"
            variant="ghost"
            className="size-6 p-0 text-muted-foreground hover:text-foreground"
            title="Session history"
            onClick={() => setShowHistory(!showHistory)}
          >
            <HugeiconsIcon icon={TimeScheduleIcon} size={13} strokeWidth={1.75} />
          </Button>
          <Button
            size="xs"
            variant="ghost"
            className="size-6 p-0 text-muted-foreground hover:text-foreground"
            title="New chat"
            onClick={handleNewChat}
          >
            <HugeiconsIcon icon={Add01Icon} size={13} strokeWidth={1.75} />
          </Button>
          <Button
            size="xs"
            variant="ghost"
            className="size-6 p-0 text-muted-foreground hover:text-foreground"
            title="Close sidebar"
            onClick={onToggle}
          >
            <HugeiconsIcon icon={Cancel01Icon} size={13} strokeWidth={1.75} />
          </Button>
        </div>
      </div>

      {showHistory ? (
        <SessionHistory
          sessions={scopedSessions}
          activeId={sessionId}
          onSelect={(id) => {
            switchSession(id);
            setShowHistory(false);
          }}
          onDelete={(id) => {
            deleteSession(id);
          }}
          onBack={() => setShowHistory(false)}
        />
      ) : (
        <>
          {/* Messages */}
          <div className="flex min-h-0 flex-1 flex-col [&_.text-sm]:text-[11px] [&_p]:leading-relaxed">
            {helpers.messages.length === 0 ? (
              <EmptyState />
            ) : (
              <AiChatView
                messages={helpers.messages}
                status={helpers.status}
                error={helpers.error}
                clearError={helpers.clearError}
                addToolApprovalResponse={helpers.addToolApprovalResponse}
                stop={helpers.stop}
              />
            )}
          </div>

          {/* Step indicator */}
          {isBusy && step && (
            <div className="flex shrink-0 items-center gap-2 border-t border-border/30 px-3 py-1.5">
              <Spinner />
              <span className="truncate text-[10.5px] text-muted-foreground">
                {step}
              </span>
            </div>
          )}

          {/* Input area */}
          <div className="shrink-0 border-t border-border/60">
            <div className="flex items-center gap-1 px-2 pt-2">
              <AiModelPicker
                selectedModelId={selectedModelId}
                onSelect={setSelectedModelId}
              />
              <PermissionChip
                mode={permissionMode}
                onCycle={cyclePermissionMode(permissionMode, setPermissionMode)}
              />
            </div>
            <div className="flex items-end gap-1.5 p-2">
              <Textarea
                ref={textareaRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Ask anything..."
                className="min-h-[36px] max-h-32 resize-none rounded-lg border-border/60 bg-background text-xs"
                rows={1}
              />
              {isBusy ? (
                <Button
                  size="sm"
                  variant="destructive"
                  className="h-9 shrink-0 px-2.5"
                  onClick={() => void helpers.stop()}
                >
                  <HugeiconsIcon icon={Cancel01Icon} size={14} strokeWidth={2} />
                </Button>
              ) : (
                <Button
                  size="sm"
                  className="h-9 shrink-0 px-2.5"
                  disabled={!input.trim()}
                  onClick={() => void handleSend()}
                >
                  <HugeiconsIcon icon={ArrowDown01Icon} size={14} strokeWidth={2} className="rotate-[-90deg]" />
                </Button>
              )}
            </div>
          </div>
        </>
      )}
    </>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 px-4 text-center">
      <p className="text-[11px] text-muted-foreground">
        Ask anything. The agent has access to your terminal, files, and shell.
      </p>
    </div>
  );
}

const PERMISSION_MODES: PermissionMode[] = ["observer", "confirm", "autonomous"];

function cyclePermissionMode(
  current: PermissionMode,
  set: (mode: PermissionMode) => void,
): () => void {
  return () => {
    const idx = PERMISSION_MODES.indexOf(current);
    set(PERMISSION_MODES[(idx + 1) % PERMISSION_MODES.length]);
  };
}

const PermissionChip = memo(function PermissionChip({
  mode,
  onCycle,
}: {
  mode: PermissionMode;
  onCycle: () => void;
}) {
  const meta = PERMISSION_META[mode];
  return (
    <button
      type="button"
      onClick={onCycle}
      className={cn(
        "flex h-5 items-center gap-1 rounded-md px-1.5 text-[10px] font-medium transition-colors",
        meta.className,
      )}
      title={meta.description}
    >
      <HugeiconsIcon icon={meta.icon} size={10} strokeWidth={2} />
      {meta.label}
    </button>
  );
});

const PERMISSION_META: Record<
  PermissionMode,
  { label: string; icon: typeof EyeIcon; className: string; description: string }
> = {
  observer: {
    label: "Observe",
    icon: EyeIcon,
    className: "bg-blue-500/10 text-blue-400 hover:bg-blue-500/20",
    description: "Read-only. No mutations allowed.",
  },
  confirm: {
    label: "Confirm",
    icon: ArrowDown01Icon,
    className: "bg-amber-500/10 text-amber-400 hover:bg-amber-500/20",
    description: "Approve each mutation before it runs.",
  },
  autonomous: {
    label: "Auto",
    icon: ZapIcon,
    className: "bg-green-500/10 text-green-400 hover:bg-green-500/20",
    description: "Execute all tools without approval.",
  },
};

const SessionHistory = memo(function SessionHistory({
  sessions,
  activeId,
  onSelect,
  onDelete,
  onBack,
}: {
  sessions: Array<{ id: string; title: string; updatedAt: number }>;
  activeId: string;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  onBack: () => void;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-8 shrink-0 items-center gap-1.5 border-b border-border/30 px-2">
        <button
          type="button"
          onClick={onBack}
          className="text-[10.5px] text-muted-foreground hover:text-foreground"
        >
          Back
        </button>
        <span className="text-[10.5px] text-muted-foreground">/</span>
        <span className="text-[10.5px] font-medium text-foreground">History</span>
      </div>
      <div className="flex-1 overflow-y-auto">
        {sessions.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-1 py-8 text-[11px] text-muted-foreground">
            No sessions yet
          </div>
        ) : (
          <div className="flex flex-col gap-0.5 p-1.5">
            {sessions.map((s) => (
              <button
                key={s.id}
                type="button"
                className={cn(
                  "group flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[11px] transition-colors hover:bg-accent/50 cursor-pointer",
                  s.id === activeId && "bg-accent/30",
                )}
                onClick={() => onSelect(s.id)}
              >
                <HugeiconsIcon
                  icon={ClockIcon}
                  size={11}
                  strokeWidth={1.75}
                  className="shrink-0 text-muted-foreground"
                />
                <span className="min-w-0 flex-1 truncate text-foreground">
                  {s.title || "Untitled session"}
                </span>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onDelete(s.id);
                  }}
                  className="hidden shrink-0 rounded p-0.5 text-muted-foreground transition-colors hover:bg-destructive/20 hover:text-destructive group-hover:block"
                  title="Delete session"
                >
                  <HugeiconsIcon icon={Delete02Icon} size={11} strokeWidth={1.75} />
                </button>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
});
