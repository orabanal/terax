import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  DEFAULT_THEME_ID,
  EDITOR_THEMES,
  loadPreferences,
  onPreferencesChange,
  setEditorTheme as persistEditorTheme,
  setTheme as persistTheme,
  setThemeId as persistThemeId,
  type EditorThemeId,
  type ThemePref,
} from "@/modules/settings/store";
import { applyTheme, clearTheme } from "./applyTheme";
import {
  listCustomThemes,
  onCustomThemesChange,
} from "./customThemes";
import { SurfaceLayer } from "./SurfaceLayer";
import { applyTheme as applyPoolTheme } from "@/modules/terminal/lib/rendererPool";
import { getBuiltinTheme, getDefaultTheme } from "./themes";
import type { Theme } from "./types";

export type { Theme };
export type ThemeModePref = ThemePref;

type ThemeProviderProps = {
  children: React.ReactNode;
  defaultMode?: ThemePref;
};

type ThemeProviderState = {
  mode: ThemePref;
  resolvedMode: "dark" | "light";
  themeId: string;
  customThemes: Theme[];
  setMode: (mode: ThemePref) => void;
  setThemeId: (id: string) => void;
};

const ThemeProviderContext = createContext<ThemeProviderState | null>(null);

const FAST_PATH_KEY = "terax-ui-theme-shadow";
const FAST_PATH_THEME_ID = "terax-ui-theme-id-shadow";

function readFastMode(fallback: ThemePref): ThemePref {
  if (typeof window === "undefined") return fallback;
  const v = window.localStorage.getItem(FAST_PATH_KEY);
  return v === "dark" || v === "light" || v === "system" ? v : fallback;
}

function writeFastMode(t: ThemePref): void {
  try { window.localStorage.setItem(FAST_PATH_KEY, t); } catch { /* ignore */ }
}

function readFastThemeId(): string {
  if (typeof window === "undefined") return DEFAULT_THEME_ID;
  return window.localStorage.getItem(FAST_PATH_THEME_ID) ?? DEFAULT_THEME_ID;
}

function writeFastThemeId(id: string): void {
  try { window.localStorage.setItem(FAST_PATH_THEME_ID, id); } catch { /* ignore */ }
}

function resolveTheme(id: string, custom: Theme[]): Theme {
  return custom.find((t) => t.id === id) ?? getBuiltinTheme(id) ?? getDefaultTheme();
}

export function ThemeProvider({ children, defaultMode = "system" }: ThemeProviderProps) {
  const [mode, setModeState] = useState<ThemePref>(() => readFastMode(defaultMode));
  const [themeId, setThemeIdState] = useState<string>(() => readFastThemeId());
  const [customThemes, setCustomThemes] = useState<Theme[]>([]);
  const [systemDark, setSystemDark] = useState<boolean>(() =>
    typeof window === "undefined"
      ? true
      : window.matchMedia("(prefers-color-scheme: dark)").matches,
  );

  useEffect(() => {
    let alive = true;
    void loadPreferences().then((p) => {
      if (!alive) return;
      setModeState(p.theme);
      setThemeIdState(p.themeId);
      writeFastMode(p.theme);
      writeFastThemeId(p.themeId);
    });
    const unlistenP = onPreferencesChange((key, value) => {
      if (key === "theme" && (value === "system" || value === "light" || value === "dark")) {
        setModeState(value);
        writeFastMode(value);
      } else if (key === "themeId" && typeof value === "string") {
        setThemeIdState(value);
        writeFastThemeId(value);
      }
    });
    return () => {
      alive = false;
      void unlistenP.then((fn) => fn());
    };
  }, []);

  useEffect(() => {
    let alive = true;
    void listCustomThemes().then((list) => { if (alive) setCustomThemes(list); });
    const unlisten = onCustomThemesChange(() => {
      void listCustomThemes().then((list) => setCustomThemes(list));
    });
    return () => {
      alive = false;
      void unlisten.then((fn) => fn());
    };
  }, []);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = (e: MediaQueryListEvent) => setSystemDark(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  const resolvedMode: "dark" | "light" =
    mode === "system" ? (systemDark ? "dark" : "light") : mode;

  // Layout effect (not passive): the .dark/.light class must land before
  // first paint, otherwise both windows flash light-then-dark on open.
  // Passive effects run after paint; with today's heavier startup bundle
  // that gap became visible.
  useLayoutEffect(() => {
    const root = document.documentElement;
    root.classList.remove("light", "dark");
    root.classList.add(resolvedMode);
  }, [resolvedMode]);

  const lastEditorPairRef = useRef<string | null>(null);
  useEffect(() => {
    if (themeId === DEFAULT_THEME_ID) {
      clearTheme();
      lastEditorPairRef.current = null;
      return;
    }    const theme = resolveTheme(themeId, customThemes);
    applyTheme(theme, resolvedMode);
    const editorPair = theme.editorTheme?.[resolvedMode];
    if (
      editorPair &&
      lastEditorPairRef.current !== editorPair &&
      (EDITOR_THEMES as readonly string[]).includes(editorPair)
    ) {
      lastEditorPairRef.current = editorPair;
      void persistEditorTheme(editorPair as EditorThemeId);
    }
  }, [themeId, resolvedMode, customThemes]);

  // xterm slots snapshot CSS tokens at creation (and once per panel mount).
  // Prefs, custom themes and mode all arrive async after first paint, so a
  // first-paint terminal can keep stale (light) tokens forever — until
  // another terminal mounts and re-syncs the pool. Re-sync here whenever
  // the inputs settle: getComputedStyle forces a sync recalc, so this is
  // safe to run in the same commit right after the vars above land.
  // Deps are the trigger (re-sync on theme input change), not values used
  // in the body, hence the suppression below.
  // biome-ignore lint/correctness/useExhaustiveDependencies: trigger-only deps
  useEffect(() => {
    applyPoolTheme();
  }, [themeId, resolvedMode, customThemes]);

  const setMode = useCallback((next: ThemePref) => {
    setModeState(next);
    writeFastMode(next);
    void persistTheme(next);
  }, []);

  const setThemeId = useCallback((id: string) => {
    setThemeIdState(id);
    writeFastThemeId(id);
    void persistThemeId(id);
  }, []);

  const value = useMemo<ThemeProviderState>(
    () => ({ mode, resolvedMode, themeId, customThemes, setMode, setThemeId }),
    [mode, resolvedMode, themeId, customThemes, setMode, setThemeId],
  );

  return (
    <ThemeProviderContext.Provider value={value}>
      <SurfaceLayer />
      {children}
    </ThemeProviderContext.Provider>
  );
}

export function useTheme(): ThemeProviderState {
  const ctx = useContext(ThemeProviderContext);
  if (!ctx) throw new Error("useTheme must be used within a <ThemeProvider>");
  return ctx;
}
