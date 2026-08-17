import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createRoot } from "react-dom/client";
import { useEffect, useMemo, useState } from "react";
import { App } from "./App";
import { AuthGate } from "./AuthGate";
import {
  applyVisualAppearance,
  browserVisualAppearancePreferences,
  type VisualAppearance,
} from "./appearance";
import {
  resolveTheme,
  type AppearancePreference,
  type OrganizationBrandingProvider,
} from "./theme";
import "./styles.css";

const client = new QueryClient({
  defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
});
const currentOrganizationBranding: OrganizationBrandingProvider = {
  current: () => undefined,
};
const Root = () => {
  const [initial] = useState(() => browserVisualAppearancePreferences.read());
  const [appearance, setAppearance] = useState<VisualAppearance>(initial);
  const legacyTheme = appearance.theme === "dark" || appearance.theme === "command" || appearance.theme === "lowglare"
    ? "industrial"
    : "printershero";
  const legacyAppearance: AppearancePreference = legacyTheme === "industrial" ? "dark" : "light";
  const resolved = useMemo(
    () =>
      resolveTheme(
        legacyTheme,
        legacyAppearance,
        currentOrganizationBranding.current(),
      ),
    [legacyTheme, legacyAppearance],
  );
  useEffect(() => {
    browserVisualAppearancePreferences.write(appearance);
    applyVisualAppearance(appearance);
  }, [appearance]);
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
    <AuthGate><App
      appearance={appearance}
      setAppearance={(patch) =>
        setAppearance((current) => ({ ...current, ...patch }))
      }
    /></AuthGate>
  );
};
createRoot(document.getElementById("root")!).render(
  <QueryClientProvider client={client}>
    <Root />
  </QueryClientProvider>,
);
