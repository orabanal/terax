import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { captureTerminalScreen } from "@/modules/terminal/lib/rendererPool";
import { useChat, type UIMessage } from "@ai-sdk/react";
import {
  Add01Icon,
  AddCircleIcon,
  ArrowDown01Icon,
  Cancel01Icon,
  ClockIcon,
  Delete02Icon,
  EyeIcon,
  File01Icon,
  Image01Icon,
  TerminalIcon,
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
import {
  findActiveForScope,
  scopeKey as makeScopeKey,
  type SessionScope,
  type SessionScopeType,
} from "../lib/sessions";
import {
  getSkillCompletions,
  tryRunSlashCommand,
} from "../lib/slashCommands";
import { useSkillsStore } from "../store/skillsStore";
import { useChatStore, type PermissionMode } from "../store/chatStore";
import { getOrCreateChat, sendMessage } from "../store/chatRuntime";
import { AgentSwitcher } from "./AgentSwitcher";
import { AiChatView } from "./AiChat";
import { AiModelPicker } from "./AiModelPicker";

const MIN_WIDTH = 360;
const DEFAULT_WIDTH = 400;

type Attachment = {
  id: string;
  name: string;
  kind: "file" | "image" | "terminal";
  text?: string;
  url?: string;
  mediaType?: string;
};

export type AiSidebarProps = {
  open: boolean;
  onToggle: () => void;
  hasComposer: boolean;
  scopeType: SessionScopeType;
  scopeTargetId: string | null;
  activeLeafId: number | null;
};

export const AiSidebar = memo(function AiSidebar({
  open,
  onToggle,
  hasComposer,
  scopeType,
  scopeTargetId,
  activeLeafId,
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
      className="relative flex h-full shrink-0 flex-col bg-background border-l border-border/40 shadow-[-4px_0_24px_-4px_rgba(0,0,0,0.2)] dark:shadow-[-4px_0_24px_-4px_rgba(0,0,0,0.5)]"
      style={{ width }}
    >
      {/* Drag handle */}
      <div
        className="absolute -left-px top-0 z-10 h-full w-1 cursor-ew-resize"
        onPointerDown={handleDragStart}
        onPointerMove={handleDragMove}
        onPointerUp={handleDragEnd}
        onPointerCancel={handleDragEnd}
      />

      <AiSidebarInner
        key={`${scopeType}:${scopeTargetId ?? ""}`}
        hasComposer={hasComposer}
        scopeType={scopeType}
        scopeTargetId={scopeTargetId}
        onToggle={onToggle}
        activeLeafId={activeLeafId}
      />
    </div>
  );
});

function AiSidebarInner({
  hasComposer,
  scopeType,
  scopeTargetId,
  onToggle,
  activeLeafId,
}: {
  hasComposer: boolean;
  scopeType: SessionScopeType;
  scopeTargetId: string | null;
  onToggle: () => void;
  activeLeafId: number | null;
}) {
  const scopeReady = scopeTargetId != null && scopeTargetId.length > 0;
  const scope = useMemo<SessionScope>(
    () => ({ type: scopeType, targetId: scopeTargetId ?? "" }),
    [scopeType, scopeTargetId],
  );

  const sessions = useChatStore((s) => s.sessions);
  const sessionsHydrated = useChatStore((s) => s.sessionsHydrated);
  const activeByScope = useChatStore((s) => s.activeByScope);
  const newSession = useChatStore((s) => s.newSession);
  const deleteSession = useChatStore((s) => s.deleteSession);
  const switchSessionForScope = useChatStore((s) => s.switchSessionForScope);
  const ensureSessionForScope = useChatStore((s) => s.ensureSessionForScope);

  const sk = makeScopeKey(scope);
  const selectedModelId = useChatStore((s) => s.getSelectedModelForScope(sk));
  const setSelectedModelId = useChatStore((s) => s.setSelectedModelForScope);
  const permissionMode = useChatStore((s) => s.getPermissionModeForScope(sk));
  const setPermissionMode = useChatStore((s) => s.setPermissionModeForScope);

  const [showHistory, setShowHistory] = useState(false);
  const [input, setInput] = useState("");

  const sessionId = findActiveForScope(sessions, activeByScope, scope);

  useEffect(() => {
    if (!sessionId && hasComposer && sessionsHydrated && scopeReady) {
      ensureSessionForScope(scope);
    }
  }, [
    sessionId,
    hasComposer,
    sessionsHydrated,
    scopeReady,
    ensureSessionForScope,
    scope,
  ]);

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
      scopeKey={sk}
      input={input}
      setInput={setInput}
      showHistory={showHistory}
      setShowHistory={setShowHistory}
      onToggle={onToggle}
      permissionMode={permissionMode}
      setPermissionMode={(mode) => setPermissionMode(sk, mode)}
      selectedModelId={selectedModelId}
      setSelectedModelId={(id) => setSelectedModelId(sk, id)}
      deleteSession={deleteSession}
      sessions={sessions}
      switchSessionForScope={switchSessionForScope}
      newSession={newSession}
      activeLeafId={activeLeafId}
    />
  );
}

type SessionProps = {
  sessionId: string;
  scope: SessionScope;
  scopeKey: string;
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
  switchSessionForScope: (scope: SessionScope, id: string) => void;
  newSession: (scope?: SessionScope) => string;
  activeLeafId: number | null;
};

function AiSidebarSession({
  sessionId,
  scope,
  scopeKey: sk,
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
  switchSessionForScope,
  newSession,
  activeLeafId,
}: SessionProps) {
  const chat = useMemo(() => getOrCreateChat(sessionId), [sessionId]);
  const helpers = useChat<UIMessage>({ chat });
  const isBusy = helpers.status === "submitted" || helpers.status === "streaming";
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const skills = useSkillsStore((s) => s.skills);
  const hydrateSkills = useSkillsStore((s) => s.hydrate);
  useEffect(() => { void hydrateSkills(); }, [hydrateSkills]);

  const skillCompletions = useMemo(
    () => getSkillCompletions(input, skills),
    [input, skills],
  );
  const showSkillPicker = skillCompletions.length > 0 && input.startsWith("/");
  const [pickerIndex, setPickerIndex] = useState(0);

  const prevShowRef = useRef(showSkillPicker);
  if (prevShowRef.current !== showSkillPicker) {
    prevShowRef.current = showSkillPicker;
    if (showSkillPicker) setPickerIndex(0);
  }

  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);

  const removeAttachment = useCallback((id: string) => {
    setAttachments((prev) => prev.filter((a) => a.id !== id));
  }, []);

  const handleFilePick = useCallback(async (files: FileList | null) => {
    if (!files) return;
    const next: Attachment[] = [];
    for (const f of Array.from(files)) {
      if (f.type.startsWith("image/")) {
        const url = await readAsDataURL(f);
        next.push({ id: `img-${f.name}-${f.size}`, name: f.name, kind: "image", url, mediaType: f.type });
      } else if (f.size <= 200_000) {
        const text = await f.text();
        next.push({ id: `file-${f.name}-${f.size}`, name: f.name, kind: "file", text, mediaType: f.type || "text/plain" });
      }
    }
    if (next.length) setAttachments((prev) => [...prev, ...next]);
  }, []);

  const handleTerminalCapture = useCallback(() => {
    if (activeLeafId == null) return;
    const dataUrl = captureTerminalScreen(activeLeafId);
    if (!dataUrl) return;
    setAttachments((prev) => [
      ...prev,
      { id: `term-${Date.now()}`, name: "Terminal screenshot", kind: "terminal", url: dataUrl, mediaType: "image/png" },
    ]);
  }, [activeLeafId]);

  const handleSend = useCallback(async () => {
    const text = input.trim();
    if ((!text && attachments.length === 0) || isBusy) return;
    const outcome = tryRunSlashCommand(text, skills);
    if (outcome.kind === "handled") {
      setInput("");
      setAttachments([]);
      return;
    }
    const effectiveText = outcome.kind === "send-prompt" ? outcome.prompt : text;

    const textParts: string[] = [];
    for (const a of attachments) {
      if (a.kind === "file" && a.text) {
        textParts.push(`<file name="${a.name}" mediaType="${a.mediaType ?? "text/plain"}">\n${a.text}\n</file>`);
      }
    }
    if (effectiveText) textParts.push(effectiveText);
    const composed = textParts.filter(Boolean).join("\n\n");

    setInput("");
    setAttachments([]);

    const imageAttachments = attachments.filter((a) => a.kind === "image" || (a.kind === "terminal" && a.url));
    if (imageAttachments.length > 0) {
      const parts: Array<{ type: "text"; text: string } | { type: "file"; mediaType: string; url: string; filename?: string }> = [];
      if (composed) parts.push({ type: "text", text: composed });
      for (const a of imageAttachments) {
        if (a.url) parts.push({ type: "file", mediaType: a.mediaType ?? "image/png", url: a.url, filename: a.name });
      }
      void chat.sendMessage({ role: "user", parts } as Parameters<typeof chat.sendMessage>[0]);
    } else if (composed) {
      await sendMessage(sessionId, composed);
    }
  }, [input, attachments, isBusy, sessionId, setInput, skills, chat]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if (showSkillPicker) {
        if (e.key === "ArrowDown") {
          e.preventDefault();
          setPickerIndex((i) => (i + 1) % skillCompletions.length);
          return;
        }
        if (e.key === "ArrowUp") {
          e.preventDefault();
          setPickerIndex((i) => (i - 1 + skillCompletions.length) % skillCompletions.length);
          return;
        }
        if (e.key === "Tab" || (e.key === "Enter" && skillCompletions.length > 0 && !e.shiftKey)) {
          e.preventDefault();
          const chosen = skillCompletions[pickerIndex];
          if (chosen) setInput(`/${chosen.name} `);
          return;
        }
        if (e.key === "Escape") {
          setInput("");
          return;
        }
      }
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        void handleSend();
      }
    },
    [handleSend, showSkillPicker, skillCompletions, pickerIndex, setInput],
  );

  const handleNewChat = useCallback(() => {
    newSession(scope);
    setShowHistory(false);
  }, [newSession, scope, setShowHistory]);

  const scopedSessions = useMemo(() => {
    return sessions
      .filter((s) => s.scope?.type === scope.type && s.scope?.targetId === scope.targetId)
      .map((s) => ({ id: s.id, title: s.title, updatedAt: s.updatedAt }));
  }, [sessions, scope]);

  const meta = useChatStore((s) => s.getAgentMetaForSession(sessionId));

  return (
    <>
      {/* Header */}
      <div className="flex shrink-0 items-center justify-between px-2.5 py-1.5 border-b border-border/50">
        <div className="flex min-w-0 items-center gap-1.5">
          <AgentSwitcher isMiniWindow scopeKey={sk} />
        </div>
        <div className="flex items-center gap-0.5">
          <Button
            size="icon"
            variant="ghost"
            className="h-7 w-7 rounded-md text-muted-foreground/62 hover:text-foreground"
            title="Session history"
            onClick={() => setShowHistory(!showHistory)}
          >
            <HugeiconsIcon icon={TimeScheduleIcon} size={13} strokeWidth={1.75} />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="h-7 w-7 rounded-md text-muted-foreground/62 hover:text-foreground"
            title="New chat"
            onClick={handleNewChat}
          >
            <HugeiconsIcon icon={Add01Icon} size={13} strokeWidth={1.75} />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="h-7 w-7 rounded-md text-muted-foreground/62 hover:text-foreground"
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
            switchSessionForScope(scope, id);
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
                sessionId={sessionId}
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
          {isBusy && meta.step && (
            <div className="flex shrink-0 items-center gap-2 border-t border-border/30 px-3 py-1.5">
              <Spinner />
              <span className="truncate text-[10.5px] text-muted-foreground">
                {meta.step}
              </span>
            </div>
          )}

          {/* Input area */}
          <div className="shrink-0 px-4 pb-4">
            {showSkillPicker && (
              <div className="mb-1.5 rounded-lg border border-border/50 bg-popover shadow-lg overflow-hidden">
                {skillCompletions.map((c, i) => (
                  <button
                    key={c.name}
                    type="button"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      setInput(`/${c.name} `);
                      textareaRef.current?.focus();
                    }}
                    className={cn(
                      "flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] transition-colors",
                      i === pickerIndex
                        ? "bg-accent text-accent-foreground"
                        : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
                    )}
                  >
                    <span className="font-mono text-[11px] text-primary">/{c.name}</span>
                    {c.description && (
                      <span className="truncate text-[10.5px]">{c.description}</span>
                    )}
                  </button>
                ))}
              </div>
            )}
            <div className="flex flex-col rounded-[22px] border border-border/65 bg-background/92 shadow-[0_18px_42px_rgba(0,0,0,0.34),inset_0_1px_0_rgba(255,255,255,0.04)] supports-[backdrop-filter]:backdrop-blur-sm overflow-hidden transition-[border-color,background-color,box-shadow] focus-within:border-primary/45 focus-within:bg-background focus-within:ring-1 focus-within:ring-primary/20">
              {attachments.length > 0 && (
                <AttachmentChips attachments={attachments} onRemove={removeAttachment} />
              )}
              <Textarea
                ref={textareaRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Ask anything..."
                className="min-h-[82px] max-h-52 resize-none rounded-none border-0 bg-transparent px-4 pt-3.5 pb-0 text-[13px] leading-[20px] text-foreground/92 placeholder:text-muted-foreground/62 placeholder:font-medium focus-visible:ring-0 focus-visible:outline-none shadow-none"
                rows={4}
              />
              <div className="flex items-center gap-1 px-3 pb-2 pt-0">
                <AttachMenu
                  disabled={isBusy}
                  hasTerminal={activeLeafId != null}
                  onPickFile={() => fileInputRef.current?.click()}
                  onPickImage={() => imageInputRef.current?.click()}
                  onTerminalCapture={handleTerminalCapture}
                />
                <AiModelPicker
                  selectedModelId={selectedModelId}
                  onSelect={setSelectedModelId}
                />
                <PermissionChip
                  mode={permissionMode}
                  onCycle={cyclePermissionMode(permissionMode, setPermissionMode)}
                />
                <div className="flex-1" />
                {isBusy ? (
                  <Button
                    size="icon"
                    variant="destructive"
                    className="h-8 w-8 rounded-full border border-destructive/60 bg-destructive/85 p-0 shadow-sm hover:bg-destructive"
                    onClick={() => void helpers.stop()}
                  >
                    <HugeiconsIcon icon={Cancel01Icon} size={14} strokeWidth={2} />
                  </Button>
                ) : (
                  <Button
                    size="icon"
                    className="h-8 w-8 rounded-full border border-foreground/20 bg-foreground p-0 shadow-sm hover:bg-foreground/90 disabled:border-border/80 disabled:bg-muted/52 disabled:text-foreground/72"
                    disabled={!input.trim() && attachments.length === 0}
                    onClick={() => void handleSend()}
                  >
                    <HugeiconsIcon icon={ArrowDown01Icon} size={14} strokeWidth={2} className="rotate-[-90deg] text-background" />
                  </Button>
                )}
              </div>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              className="hidden"
              multiple
              accept=".txt,.md,.json,.yaml,.yml,.toml,.sh,.zsh,.bash,.py,.js,.jsx,.ts,.tsx,.rs,.go,.java,.c,.cpp,.h,.hpp,.html,.css,.csv,.log,.env,.config,.conf,.ini,Dockerfile"
              onChange={(e) => {
                void handleFilePick(e.target.files);
                e.target.value = "";
              }}
            />
            <input
              ref={imageInputRef}
              type="file"
              className="hidden"
              accept="image/*"
              onChange={(e) => {
                void handleFilePick(e.target.files);
                e.target.value = "";
              }}
            />
          </div>
        </>
      )}
    </>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center px-6 text-center">
      <p className="text-[13px] text-muted-foreground/40">
        Ask anything. The agent has access to your terminal, files, and shell.
      </p>
    </div>
  );
}

function AttachMenu({
  disabled,
  hasTerminal,
  onPickFile,
  onPickImage,
  onTerminalCapture,
}: {
  disabled: boolean;
  hasTerminal: boolean;
  onPickFile: () => void;
  onPickImage: () => void;
  onTerminalCapture: () => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          size="icon"
          variant="ghost"
          className="h-6 w-6 shrink-0 rounded-full bg-transparent text-foreground/62 hover:bg-muted/24 hover:text-foreground"
          disabled={disabled}
          title="Attach"
        >
          <HugeiconsIcon icon={AddCircleIcon} size={13} strokeWidth={1.75} />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="start" sideOffset={6} className="w-48">
        <DropdownMenuItem onSelect={onPickFile}>
          <HugeiconsIcon icon={File01Icon} size={14} strokeWidth={1.75} className="mr-2 text-muted-foreground" />
          Attach file
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={onPickImage}>
          <HugeiconsIcon icon={Image01Icon} size={14} strokeWidth={1.75} className="mr-2 text-muted-foreground" />
          Attach image
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={onTerminalCapture} disabled={!hasTerminal}>
          <HugeiconsIcon icon={TerminalIcon} size={14} strokeWidth={1.75} className="mr-2 text-muted-foreground" />
          Terminal screenshot
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

const AttachmentChips = memo(function AttachmentChips({
  attachments,
  onRemove,
}: {
  attachments: Attachment[];
  onRemove: (id: string) => void;
}) {
  if (attachments.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1 px-3.5 pt-3 pb-0">
      {attachments.map((a) => (
        <span
          key={a.id}
          className="inline-flex h-6 items-center gap-1 rounded-md bg-muted/30 border border-border/30 pl-1.5 pr-1 text-[11px] text-foreground/70"
        >
          {a.kind === "image" || a.kind === "terminal" ? (
            <HugeiconsIcon icon={Image01Icon} size={11} strokeWidth={1.75} className="shrink-0 text-muted-foreground/60" />
          ) : (
            <HugeiconsIcon icon={File01Icon} size={11} strokeWidth={1.75} className="shrink-0 text-muted-foreground/60" />
          )}
          <span className="max-w-[120px] truncate">{a.name}</span>
          <button
            type="button"
            onClick={() => onRemove(a.id)}
            className="ml-0.5 h-3.5 w-3.5 rounded-sm opacity-50 hover:opacity-100 hover:bg-muted/50 transition-opacity flex items-center justify-center"
          >
            <HugeiconsIcon icon={Cancel01Icon} size={8} strokeWidth={2} />
          </button>
        </span>
      ))}
    </div>
  );
});

function readAsDataURL(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
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
        "inline-flex h-6 items-center gap-1 rounded-full px-1.5 text-[10.5px] transition-colors cursor-pointer hover:bg-muted/24",
        meta.className,
      )}
      title={meta.description}
    >
      <HugeiconsIcon icon={meta.icon} size={11} strokeWidth={1.75} />
      <span className="max-w-[72px] truncate">{meta.label}</span>
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
    className: "text-blue-400/70",
    description: "Read-only. No mutations allowed.",
  },
  confirm: {
    label: "Confirm",
    icon: ArrowDown01Icon,
    className: "text-amber-400/70",
    description: "Approve each mutation before it runs.",
  },
  autonomous: {
    label: "Auto",
    icon: ZapIcon,
    className: "text-green-400/70",
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
