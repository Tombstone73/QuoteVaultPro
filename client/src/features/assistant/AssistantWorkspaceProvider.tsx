import * as React from "react";
import { useLocation } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { useIsMobile } from "@/hooks/use-mobile";
import { useAssistantCapabilities } from "@/hooks/useAssistantApi";
import type { AssistantCapabilities, AssistantContextEnvelope, AssistantLayoutPreferences, AssistantPresentation } from "./types";
import { buildSafeAssistantContext, getAssistantPreferenceKey, isAssistantShortcut, resolveAssistantPresentation, shouldEnableAssistantForRoute } from "./assistantWorkspaceCore";

const DEFAULT_LAYOUT: AssistantLayoutPreferences = {
  presentation: "floating",
  floatingBounds: { x: 48, y: 88, width: 440, height: 620 },
  dockSize: 420,
};

export function buildAssistantContext(pathname: string, pageTitle = document.title): AssistantContextEnvelope {
  return buildSafeAssistantContext(pathname, pageTitle);
}

function clampBounds(bounds: AssistantLayoutPreferences["floatingBounds"]) {
  if (typeof window === "undefined") return bounds;
  const width = Math.min(Math.max(bounds.width, 320), Math.max(320, window.innerWidth - 24));
  const height = Math.min(Math.max(bounds.height, 360), Math.max(360, window.innerHeight - 24));
  return {
    width,
    height,
    x: Math.min(Math.max(bounds.x, 12), Math.max(12, window.innerWidth - width - 12)),
    y: Math.min(Math.max(bounds.y, 12), Math.max(12, window.innerHeight - height - 12)),
  };
}

type WorkspaceContextValue = {
  capabilities?: AssistantCapabilities;
  capabilityError?: string;
  capabilityLoading: boolean;
  presentation: AssistantPresentation;
  priorPresentation: Exclude<AssistantPresentation, "minimized" | "fullscreen">;
  layout: AssistantLayoutPreferences;
  context: AssistantContextEnvelope;
  isMobile: boolean;
  setPresentation: (presentation: AssistantPresentation) => void;
  minimize: () => void;
  toggle: () => void;
  setFloatingBounds: (bounds: AssistantLayoutPreferences["floatingBounds"]) => void;
  setDockSize: (size: number) => void;
  persistLayout: () => void;
  refreshContext: () => void;
  activeConversationId: string | null;
  setActiveConversationId: React.Dispatch<React.SetStateAction<string | null>>;
  draft: string;
  setDraft: React.Dispatch<React.SetStateAction<string>>;
};

const AssistantWorkspaceContext = React.createContext<WorkspaceContextValue | null>(null);

export function useAssistantWorkspace() {
  const value = React.useContext(AssistantWorkspaceContext);
  if (!value) throw new Error("useAssistantWorkspace must be used inside AssistantWorkspaceProvider");
  return value;
}

export function AssistantWorkspaceProvider({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  const { isAuthenticated, isPortalCustomer } = useAuth();
  const isMobile = useIsMobile();
  const isInternal = shouldEnableAssistantForRoute(isAuthenticated, isPortalCustomer, location.pathname);
  const capabilityQuery = useAssistantCapabilities(isInternal);
  const storageKey = getAssistantPreferenceKey(capabilityQuery.data);
  const [layout, setLayout] = React.useState<AssistantLayoutPreferences>(DEFAULT_LAYOUT);
  const [presentation, setPresentationState] = React.useState<AssistantPresentation>("minimized");
  const [priorPresentation, setPriorPresentation] = React.useState<Exclude<AssistantPresentation, "minimized" | "fullscreen">>("floating");
  const [context, setContext] = React.useState(() => buildAssistantContext(location.pathname));
  // These intentionally live above each presentation renderer. Floating,
  // docked, and fullscreen views may unmount while the conversation and draft
  // remain part of the single workspace engine.
  const [activeConversationId, setActiveConversationId] = React.useState<string | null>(null);
  const [draft, setDraft] = React.useState("");

  React.useEffect(() => {
    setContext(buildAssistantContext(location.pathname));
  }, [location.pathname]);

  React.useEffect(() => {
    if (!storageKey || typeof window === "undefined") return;
    try {
      const stored = JSON.parse(window.localStorage.getItem(storageKey) || "null") as Partial<AssistantLayoutPreferences> | null;
      if (!stored) return;
      const savedPresentation = stored.presentation || DEFAULT_LAYOUT.presentation;
      setLayout({
        presentation: savedPresentation,
        floatingBounds: clampBounds({ ...DEFAULT_LAYOUT.floatingBounds, ...stored.floatingBounds }),
        dockSize: Math.min(Math.max(Number(stored.dockSize) || DEFAULT_LAYOUT.dockSize, 300), 760),
      });
      setPriorPresentation(savedPresentation);
    } catch {
      // Invalid local preference data must never prevent the app shell from rendering.
    }
  }, [storageKey]);

  const persistLayout = React.useCallback(() => {
    if (!storageKey || typeof window === "undefined") return;
    try {
      window.localStorage.setItem(storageKey, JSON.stringify({ ...layout, floatingBounds: clampBounds(layout.floatingBounds) }));
    } catch {
      // Local storage is optional for Stage 1.
    }
  }, [layout, storageKey]);

  const setPresentation = React.useCallback((next: AssistantPresentation) => {
    const normalized = resolveAssistantPresentation(isMobile, next);
    setPresentationState(normalized);
    if (normalized !== "minimized" && normalized !== "fullscreen") {
      setPriorPresentation(normalized as Exclude<AssistantPresentation, "minimized" | "fullscreen">);
      setLayout((current) => ({ ...current, presentation: normalized as AssistantLayoutPreferences["presentation"] }));
    }
  }, [isMobile]);

  const minimize = React.useCallback(() => setPresentationState("minimized"), []);
  const toggle = React.useCallback(() => {
    setPresentationState((current) => current === "minimized" ? (isMobile ? "fullscreen" : priorPresentation) : "minimized");
  }, [isMobile, priorPresentation]);

  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isAssistantShortcut(event)) {
        event.preventDefault();
        toggle();
      }
      if (event.key === "Escape" && presentation !== "minimized") minimize();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [minimize, presentation, toggle]);

  const value = React.useMemo<WorkspaceContextValue>(() => ({
    capabilities: capabilityQuery.data,
    capabilityError: capabilityQuery.error instanceof Error ? capabilityQuery.error.message : undefined,
    capabilityLoading: capabilityQuery.isLoading,
    presentation,
    priorPresentation,
    layout,
    context,
    isMobile,
    setPresentation,
    minimize,
    toggle,
    setFloatingBounds: (bounds) => setLayout((current) => ({ ...current, floatingBounds: clampBounds(bounds) })),
    setDockSize: (dockSize) => setLayout((current) => ({ ...current, dockSize: Math.min(Math.max(dockSize, 300), 760) })),
    persistLayout,
    refreshContext: () => setContext(buildAssistantContext(location.pathname)),
    activeConversationId,
    setActiveConversationId,
    draft,
    setDraft,
  }), [activeConversationId, capabilityQuery.data, capabilityQuery.error, capabilityQuery.isLoading, context, draft, isMobile, layout, minimize, persistLayout, presentation, priorPresentation, setPresentation, toggle, location.pathname]);

  return <AssistantWorkspaceContext.Provider value={value}>{children}</AssistantWorkspaceContext.Provider>;
}
