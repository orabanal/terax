// Claude Code CLI detection for SSH sessions -- port of Netcatty's ClaudeCliParser.
//
// Two complementary strategies exist in Terax:
//   Local: transcript watcher (Rust) reads ~/.claude/projects/*.jsonl
//   SSH:   this module processes raw terminal bytes for visual markers

// ─── ANSI stripping ──────────────────────────────────────────────────────────

// biome-ignore lint/complexity/useRegexLiterals: control chars cannot be expressed as literals
// biome-ignore lint/suspicious/noControlCharactersInRegex: intentional ANSI escape matching
const OSC_RE = new RegExp("\\u001B\\][^\\u0007\\u001B]*(?:\\u0007|\\u001B\\\\)", "g");
// biome-ignore lint/complexity/useRegexLiterals: control chars cannot be expressed as literals
// biome-ignore lint/suspicious/noControlCharactersInRegex: intentional ANSI escape matching
const ESC_RE = new RegExp("\\u001B(?:[@-Z\\\\-_]|\\[[0-?]*[ -/]*[@-~])", "g");
// biome-ignore lint/complexity/useRegexLiterals: control chars cannot be expressed as literals
// biome-ignore lint/suspicious/noControlCharactersInRegex: intentional ANSI escape matching
const CTRL_RE = new RegExp("[\\u0000-\\u0008\\u000B-\\u001F\\u007F]", "g");
// Matches an incomplete OSC or CSI sequence at the end of a chunk so it can be
// buffered and re-processed once the next chunk arrives.
// biome-ignore lint/complexity/useRegexLiterals: control chars cannot be expressed as literals
// biome-ignore lint/suspicious/noControlCharactersInRegex: intentional ANSI escape matching
const TAIL_RE = new RegExp(
  "\\u001B(?:\\][^\\u0007\\u001B]*(?:\\u001B)?|\\[[0-?]*[ -/]*)?$",
);

function stripEscapes(data: string): string {
  return data.replace(OSC_RE, "").replace(ESC_RE, "").replace(CTRL_RE, "");
}

// Buffers incomplete escape sequences between chunks so patterns that span
// chunk boundaries are not left half-stripped.
class ChunkedEscapeFilter {
  private pending = "";

  feed(chunk: string): string {
    const data = this.pending + chunk;
    const tail = TAIL_RE.exec(data);
    if (tail) {
      this.pending = tail[0];
      return stripEscapes(data.slice(0, tail.index));
    }
    this.pending = "";
    return stripEscapes(data);
  }
}

// ─── Detection patterns ───────────────────────────────────────────────────────

const PERMISSION_KEYWORDS =
  /(?:allow|approve|permission|authorize|yes,?\s*allow|do you want to|ask-confirmation)/i;

// Claude Code's tool-separator marker rendered in the terminal.
const TOOL_MARKER = "⏺"; // U+23FA BLACK CIRCLE FOR RECORD

// Spinner chars Claude Code uses while processing.
const SPINNER_RE = /[✢✶◆●○◐◑◒◓◎◉⦿⦾⊙⊚⊛⊜⊝]/u;

// ─── State machine ────────────────────────────────────────────────────────────

export type ClaudeCliState = "idle" | "active" | "permission-wait";

export type ClaudeCliStateChange = {
  state: ClaudeCliState;
  previousState: ClaudeCliState;
};

export class ClaudeCliTracker {
  private _state: ClaudeCliState = "idle";
  private timer: ReturnType<typeof setTimeout> | null = null;
  private readonly onChange: (e: ClaudeCliStateChange) => void;

  static readonly INACTIVITY_MS = 10_000;
  static readonly PERMISSION_MS = 15_000;

  constructor(onChange: (e: ClaudeCliStateChange) => void) {
    this.onChange = onChange;
  }

  get state(): ClaudeCliState {
    return this._state;
  }

  private transition(next: ClaudeCliState): void {
    if (next === this._state) return;
    const prev = this._state;
    this._state = next;
    this.onChange({ state: next, previousState: prev });
  }

  private resetTimer(ms: number): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      this.transition("idle");
    }, ms);
  }

  processText(cleanText: string): void {
    if (cleanText.includes(TOOL_MARKER) || SPINNER_RE.test(cleanText)) {
      this.transition("active");
      this.resetTimer(ClaudeCliTracker.INACTIVITY_MS);
      return;
    }
    if (PERMISSION_KEYWORDS.test(cleanText) && this._state === "active") {
      this.transition("permission-wait");
      this.resetTimer(ClaudeCliTracker.PERMISSION_MS);
    }
  }

  reset(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this._state = "idle";
  }
}

// ─── Byte-level adapter ───────────────────────────────────────────────────────

const decoder = new TextDecoder("utf-8", { fatal: false });

// Wraps ClaudeCliTracker to accept raw Uint8Array chunks from the PTY stream.
export class PtyClaudeTracker {
  private readonly tracker: ClaudeCliTracker;
  private readonly filter: ChunkedEscapeFilter;

  constructor(onChange: (e: ClaudeCliStateChange) => void) {
    this.tracker = new ClaudeCliTracker(onChange);
    this.filter = new ChunkedEscapeFilter();
  }

  get state(): ClaudeCliState {
    return this.tracker.state;
  }

  processBytes(bytes: Uint8Array): void {
    const text = decoder.decode(bytes);
    const clean = this.filter.feed(text);
    if (clean.trim().length > 0) this.tracker.processText(clean);
  }

  reset(): void {
    this.tracker.reset();
  }
}
