import * as React from "react";

// New theme id contract
export type ThemeId = "dark-knight" | string;
const LOCAL_KEY = "themeId";

type ThemeMeta = {
  id: ThemeId;
  label: string;
  isDark: boolean;
  implemented: boolean;
  tokens: Record<string, string>;
};

// Theme registry. Fully implement only dark-knight.
export const THEMES: Record<string, ThemeMeta> = {
  "dark-knight": {
    id: "dark-knight",
    label: "Dark Knight",
    isDark: true,
    implemented: true,
    tokens: {
      // Core surfaces & text
      "--bg-app": "#0C1116",
      "--bg-surface": "#0F1520",
      "--bg-surface-soft": "rgba(255,255,255,0.06)",
        "--bg-surface-hover": "rgba(255,255,255,0.10)",
      "--text-primary": "#E6EDF3",
      "--text-muted": "rgba(230,237,243,0.60)",

      // Accents
      "--accent-primary": "#2F81F7",
      "--accent-success": "#2EA043",
      "--accent-warning": "#D29922",
      "--accent-danger": "#F85149",
      // Additional accents
      "--accent-purple": "#7A5CFF",
      "--accent-teal": "#14B8A6",

      // Borders & shadows
      "--border-subtle": "rgba(255,255,255,0.12)",
      "--border-strong": "rgba(255,255,255,0.20)",
      "--shadow-card": "0 12px 30px rgba(0,0,0,0.35)",

        // Tables
        "--table-header-bg": "rgba(255,255,255,0.04)",
        "--table-header-text": "rgba(230,237,243,0.70)",
        "--table-row-bg": "transparent",
        "--table-row-hover-bg": "rgba(255,255,255,0.05)",
        "--table-border-color": "rgba(255,255,255,0.12)",

        // Tabs
        "--tab-active-bg": "rgba(255,255,255,0.10)",
        "--tab-active-text": "#E6EDF3",
        "--tab-inactive-text": "rgba(230,237,243,0.70)",

        // Buttons (secondary)
        "--button-secondary-bg": "rgba(255,255,255,0.06)",
        "--button-secondary-hover-bg": "rgba(255,255,255,0.12)",
        "--button-secondary-text": "#E6EDF3",

        // Badges (status tints)
        "--badge-success-bg": "rgba(46,160,67,0.12)",
        "--badge-success-text": "#2EA043",
        "--badge-success-border": "rgba(46,160,67,0.25)",
        "--badge-warning-bg": "rgba(210,153,34,0.12)",
        "--badge-warning-text": "#D29922",
        "--badge-warning-border": "rgba(210,153,34,0.25)",
        "--badge-danger-bg": "rgba(248,81,73,0.12)",
        "--badge-danger-text": "#F85149",
        "--badge-danger-border": "rgba(248,81,73,0.25)",
        "--badge-muted-bg": "rgba(230,237,243,0.08)",
        "--badge-muted-text": "rgba(230,237,243,0.70)",
        "--badge-muted-border": "rgba(230,237,243,0.18)",

      // Component-specific tokens (TitanCard, PageShell, Sidebar)
      "--app-shell-bg": "var(--bg-app)",
      "--app-card-gradient-start": "#0F1520",
      "--app-card-gradient-end": "#0C1118",
      "--app-card-border-color": "var(--border-subtle)",
      "--app-card-shadow": "var(--shadow-card)",
      "--app-sidebar-bg": "#0D131B",
      "--app-sidebar-border-color": "var(--border-strong)",
    }
  },
  // Placeholders (not implemented yet)
  "comic-titan": {
    id: "comic-titan",
    label: "Comic Titan (Coming Soon)",
    isDark: false,
    implemented: false,
    tokens: {}
  },
  "hybrid-titan": {
    id: "hybrid-titan",
    label: "Hybrid Titan (Coming Soon)",
    isDark: true,
    implemented: false,
    tokens: {}
  }
};

interface ThemeContextValue {
  theme: ThemeId;
  setTheme: (t: ThemeId) => void;
  availableThemes: ThemeId[];
  getMeta: (id: ThemeId) => ThemeMeta | undefined;
}

const ThemeContext = React.createContext<ThemeContextValue | undefined>(undefined);

function applyThemeTokens(id: ThemeId) {
  const meta = THEMES[id];
  const el = document.documentElement;
  // Clear theme classes
  Object.values(THEMES).forEach(t => {
    el.classList.remove(`theme-${t.id}`);
  });
  // Apply class and dark mode compatibility for Tailwind
  el.classList.add(`theme-${id}`);
  if (meta?.isDark) el.classList.add("dark"); else el.classList.remove("dark");
  // Inject tokens
  if (meta?.tokens) {
    Object.entries(meta.tokens).forEach(([k, v]) => {
      el.style.setProperty(k, v);
    });
  }
}

export function ThemeProvider({ children }: React.PropsWithChildren<{}>) {
  const [theme, setThemeState] = React.useState<ThemeId>(() => {
    const stored = typeof window !== "undefined" ? (localStorage.getItem(LOCAL_KEY) as ThemeId | null) : null;
    return stored || "dark-knight";
  });

  const setTheme = React.useCallback((t: ThemeId) => {
    setThemeState(t);
    try { localStorage.setItem(LOCAL_KEY, t); } catch {}
    try { applyThemeTokens(t); } catch {}
  }, []);

  React.useEffect(() => {
    try { applyThemeTokens(theme); } catch {}
  }, [theme]);

  const value: ThemeContextValue = React.useMemo(
    () => ({
      theme,
      setTheme,
      availableThemes: Object.keys(THEMES) as ThemeId[],
      getMeta: (id: ThemeId) => THEMES[id]
    }),
    [theme, setTheme]
  );
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const ctx = React.useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within ThemeProvider");
  return ctx;
}