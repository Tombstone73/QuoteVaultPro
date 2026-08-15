import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createRoot } from "react-dom/client";
import { useEffect, useMemo, useState } from "react";
import { App } from "./App";
import {
  resolveTheme,
  type AppearancePreference,
  type AppearancePreferenceProvider,
  type OrganizationBrandingProvider,
  type ThemeId,
} from "./theme";
import "./styles.css";

const client = new QueryClient({
  defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
});
const browserAppearancePreferences: AppearancePreferenceProvider = {
  read: () => {
    try {
      return {
        theme: (localStorage.getItem("ph.v2.theme") as ThemeId | null) ??
          "printershero",
        appearance:
          (localStorage.getItem("ph.v2.appearance") as AppearancePreference | null) ??
          "system",
      };
    } catch {
      return { theme: "printershero", appearance: "system" };
    }
  },
  write: ({ theme, appearance }) => {
    try {
      localStorage.setItem("ph.v2.theme", theme);
      localStorage.setItem("ph.v2.appearance", appearance);
    } catch {
      // Preferences are non-authoritative; failure does not affect the workspace.
    }
  },
};
const currentOrganizationBranding: OrganizationBrandingProvider = {
  current: () => undefined,
};
const Root = () => {
  const [initial] = useState(() => browserAppearancePreferences.read());
  const [theme, setTheme] = useState<ThemeId>(initial.theme);
  const [appearance, setAppearance] = useState<AppearancePreference>(
    initial.appearance,
  );
  const [systemDark, setSystemDark] = useState(() =>
    matchMedia("(prefers-color-scheme: dark)").matches,
  );
  const resolved = useMemo(
    () =>
      resolveTheme(
        theme,
        appearance,
        currentOrganizationBranding.current(),
        systemDark,
      ),
    [theme, appearance, systemDark],
  );
  useEffect(() => {
    browserAppearancePreferences.write({ theme, appearance });
  }, [theme, appearance]);
  useEffect(() => {
    const media = matchMedia("(prefers-color-scheme: dark)");
    const onChange = (event: MediaQueryListEvent) => setSystemDark(event.matches);
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);
  useEffect(() => {
    const root = document.documentElement;
    Object.entries(resolved.tokens).forEach(([key, value]) =>
      root.style.setProperty(
        `--ph-${key.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)}`,
        value,
      ),
    );
    root.style.setProperty("--ph-success-bg", `${resolved.tokens.success}20`);
    root.style.setProperty("--ph-warning-bg", `${resolved.tokens.warning}20`);
    root.style.setProperty(
      "--ph-info-bg",
      `${resolved.tokens.informational}20`,
    );
    root.style.setProperty(
      "--ph-destructive-bg",
      `${resolved.tokens.destructive}20`,
    );
  }, [resolved]);
  return (
    <App
      theme={theme}
      setTheme={setTheme}
      appearance={appearance}
      setAppearance={setAppearance}
    />
  );
};
createRoot(document.getElementById("root")!).render(
  <QueryClientProvider client={client}>
    <Root />
  </QueryClientProvider>,
);
