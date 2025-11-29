import * as React from "react";

// Supported app themes
export type ThemeId = "light" | "dark" | "command" | "high-contrast";
const LOCAL_KEY = "themeId";

type ThemeMeta = {
  id: ThemeId;
  label: string;
  isDark: boolean;
};

const THEMES: Record<ThemeId, ThemeMeta> = {
  light: { id: "light", label: "Light", isDark: false },
  dark: { id: "dark", label: "Dark", isDark: true },
  command: { id: "command", label: "Command Station", isDark: true },
  "high-contrast": { id: "high-contrast", label: "High Contrast", isDark: true },
};

interface ThemeContextValue {
  theme: ThemeId;
  setTheme: (t: ThemeId) => void;
  availableThemes: ThemeId[];
  getMeta: (id: ThemeId) => ThemeMeta | undefined;
}

const ThemeContext = React.createContext<ThemeContextValue | undefined>(undefined);

function applyThemeClass(id: ThemeId) {
  const meta = THEMES[id];
  const el = document.documentElement;
  // Remove all known theme classes first
  el.classList.remove("dark", "theme-command", "theme-high-contrast");
  // Apply corresponding class
  switch (id) {
    case "dark":
      el.classList.add("dark");
      break;
    case "command":
      el.classList.add("theme-command");
      break;
    case "high-contrast":
      el.classList.add("theme-high-contrast");
      break;
    case "light":
    default:
      // No class needed for light (uses :root)
      break;
  }
  // Maintain Tailwind dark compatibility flag
  if (meta?.isDark && id !== "command" && id !== "high-contrast") {
    // Only add dark here if theme is explicitly dark mode
    // For other dark-like themes, we rely on their explicit classes above
  }
}

export function ThemeProvider({ children }: React.PropsWithChildren<{}>) {
  const [theme, setThemeState] = React.useState<ThemeId>(() => {
    const stored = typeof window !== "undefined" ? (localStorage.getItem(LOCAL_KEY) as string | null) : null;
    // Back-compat mapping from legacy ids
    if (stored === "dark-knight") return "dark";
    if (stored === "theme-command") return "command";
    if (stored === "theme-high-contrast") return "high-contrast";
    if (stored === "light" || stored === "dark" || stored === "command" || stored === "high-contrast") return stored as ThemeId;
    return "light";
  });

  const setTheme = React.useCallback((t: ThemeId) => {
    setThemeState(t);
    try { localStorage.setItem(LOCAL_KEY, t); } catch {}
    try { applyThemeClass(t); } catch {}
  }, []);

  React.useEffect(() => {
    try { applyThemeClass(theme); } catch {}
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