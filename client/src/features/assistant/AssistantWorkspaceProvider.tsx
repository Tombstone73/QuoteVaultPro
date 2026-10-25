import * as React from "react";
import { useLocation } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { useIsMobile } from "@/hooks/use-mobile";
import { assistantTurnFailureMessage, useAssistantCapabilities, useCreateAssistantConversation, useSendAssistantTurn } from "@/hooks/useAssistantApi";
import { ApiRequestError } from "@/lib/queryClient";
import type { AssistantMessage } from "@shared/assistantContracts";
import { useAssistantDraftImages, type AssistantDraftImage } from "./useAssistantDraftImages";
import type { AssistantCapabilities, AssistantContextEnvelope, AssistantLayoutPreferences, AssistantPresentation } from "./types";
import { buildSafeAssistantContext, getAssistantPreferenceKey, isAssistantShortcut, resolveAssistantPresentation, shouldEnableAssistantForRoute } from "./assistantWorkspaceCore";
import { clampFloatingBounds, floatingViewport } from "./assistantFloatingBounds";

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
  return clampFloatingBounds(bounds, floatingViewport());
}

type ActiveAssistantTurn = { id: string; controller: AbortController; conversationId: string };

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
  setInvoicePageContext: (activeFilters: AssistantContextEnvelope['activeFilters'], selectedRecordIds: string[]) => void;
  activeConversationId: string | null;
  setActiveConversationId: React.Dispatch<React.SetStateAction<string | null>>;
  draft: string;
  setDraft: React.Dispatch<React.SetStateAction<string>>;
  activeTurn: ActiveAssistantTurn | null;
  optimisticUserMessage: AssistantMessage | null;
  optimisticConversationId: string | null;
  turnNotice: { conversationId: string | null; message: string } | null;
  draftImages: AssistantDraftImage[];
  addDraftImages: (files: FileList | readonly File[]) => string | null;
  removeDraftImage: (key: string) => Promise<void>;
  retryDraftImage: (key: string) => Promise<void>;
  clearDraftImages: () => void;
  sendOrdinaryTurn: (message: string, clearDraftOnSuccess: boolean, attachmentIds?: string[]) => Promise<void>;
  stopTurn: (visibleTurn?: ActiveAssistantTurn | null) => void;
  clearOptimisticMessage: () => void;
  executionPlans: Record<string, { turnId: string; plan: unknown; confirmationToken: string | null }>;
  saveExecutionPlan: (entry: { turnId: string; plan: unknown; confirmationToken: string | null }) => void;
  updateExecutionPlan: (planId: string, plan: unknown) => void;
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
  const layoutRef = React.useRef(layout);
  layoutRef.current = layout;
  const [presentation, setPresentationState] = React.useState<AssistantPresentation>("minimized");
  const [priorPresentation, setPriorPresentation] = React.useState<Exclude<AssistantPresentation, "minimized" | "fullscreen">>("floating");
  const [context, setContext] = React.useState(() => buildAssistantContext(location.pathname));
  // These intentionally live above each presentation renderer. Floating,
  // docked, and fullscreen views may unmount while the conversation and draft
  // remain part of the single workspace engine.
  const [activeConversationId, setActiveConversationId] = React.useState<string | null>(null);
  const [draft, setDraft] = React.useState("");
  const sendTurn = useSendAssistantTurn();
  const createConversationForTurn = useCreateAssistantConversation();
  const creatingConversationRef = React.useRef<Promise<string> | null>(null);
  const ensureConversation = React.useCallback(async () => {
    if (activeConversationId) return activeConversationId;
    if (!creatingConversationRef.current) {
      creatingConversationRef.current = createConversationForTurn.mutateAsync().then(conversation => {
        setActiveConversationId(conversation.id);
        return conversation.id;
      }).finally(() => { creatingConversationRef.current = null; });
    }
    return creatingConversationRef.current;
  }, [activeConversationId, createConversationForTurn]);
  const { images: draftImages, add: addDraftImages, remove: removeDraftImage, retry: retryDraftImage, clear: clearDraftImages } = useAssistantDraftImages(ensureConversation);
  React.useEffect(() => { if (!isAuthenticated) clearDraftImages(); }, [isAuthenticated, clearDraftImages]);
  React.useEffect(() => {
    if (draftImages.some(image => image.conversationId && image.conversationId !== activeConversationId)) clearDraftImages();
  }, [activeConversationId, draftImages, clearDraftImages]);
  const [optimisticUserMessage, setOptimisticUserMessage] = React.useState<AssistantMessage | null>(null);
  const [optimisticConversationId, setOptimisticConversationId] = React.useState<string | null>(null);
  const activeTurnRef = React.useRef<ActiveAssistantTurn | null>(null);
  const startingTurnRef = React.useRef(false);
  const retryTurnRef = React.useRef<{ conversationId: string; message: string; imageIds: string; clientRequestId: string } | null>(null);
  const [activeTurn, setActiveTurn] = React.useState<ActiveAssistantTurn | null>(null);
  const [turnNotice, setTurnNotice] = React.useState<{ conversationId: string | null; message: string } | null>(null);
  React.useEffect(() => () => { activeTurnRef.current?.controller.abort(); }, []);

  const clearOptimisticMessage = React.useCallback(() => {
    setOptimisticUserMessage(null);
    setOptimisticConversationId(null);
  }, []);

  const sendOrdinaryTurn = async (message: string, clearDraftOnSuccess: boolean, attachmentIds: string[] = []) => {
    if (activeTurnRef.current || startingTurnRef.current) return;
    startingTurnRef.current = true;
    let conversationId = activeConversationId;
    let turnId: string | null = null;
    let completed = false;
    try {
      if (!conversationId) {
        conversationId = await ensureConversation();
      }
      const prior = retryTurnRef.current;
      const imageIds = [...attachmentIds].sort().join(",");
      const id = prior?.conversationId === conversationId && prior.message === message && prior.imageIds === imageIds
        ? prior.clientRequestId : crypto.randomUUID();
      retryTurnRef.current = { conversationId, message, imageIds, clientRequestId: id };
      turnId = id;
      const controller = new AbortController();
      const turn = { id, controller, conversationId };
      activeTurnRef.current = turn;
      setActiveTurn(turn);
      setTurnNotice(null);
      setOptimisticConversationId(conversationId);
      setOptimisticUserMessage({ id: `pending-${id}`, role: "user", content: message, structuredCards: [], attachments: draftImages.filter(image => image.attachment && attachmentIds.includes(image.attachment.id)).map(image => image.attachment!), provider: null, model: null, correlationId: null, createdAt: new Date().toISOString() });
      const response = await sendTurn.mutateAsync({ conversationId, message, context, signal: controller.signal, clientRequestId: id, attachmentIds });
      completed = true;
      retryTurnRef.current = null;
      if (response.data.status === "failed") {
        if (clearDraftOnSuccess) {
          setDraft("");
          if (attachmentIds.length) clearDraftImages();
        }
        setTurnNotice({ conversationId, message: attachmentIds.length
          ? "The message and files were saved, but the assistant could not answer. You can ask a follow-up about the saved files without uploading them again."
          : "The message was saved, but the assistant could not answer. You can ask a follow-up without resending it." });
        return;
      }
      const persistedCorrelationId = typeof response?.data?.correlationId === "string" ? response.data.correlationId : null;
      if (persistedCorrelationId) setOptimisticUserMessage((current) => current?.id === `pending-${id}` ? { ...current, correlationId: persistedCorrelationId } : current);
      if (activeTurnRef.current?.id === id) {
        if (clearDraftOnSuccess) { setDraft(""); if (attachmentIds.length) clearDraftImages(); }
        setTurnNotice(null);
      }
    } catch (error) {
      setDraft(current => current || message);
      if (error instanceof ApiRequestError && error.code === "conversation_not_found") {
        setActiveConversationId(null);
        retryTurnRef.current = null;
      }
      if (error instanceof ApiRequestError && error.code === "request_id_conflict") retryTurnRef.current = null;
      if (!turnId || (activeTurnRef.current?.id === turnId && !activeTurnRef.current.controller.signal.aborted)) {
        setTurnNotice({ conversationId, message: assistantTurnFailureMessage(error) });
      }
    } finally {
      startingTurnRef.current = false;
      if (activeTurnRef.current?.id === turnId) {
        activeTurnRef.current = null;
        setActiveTurn(null);
        if (!completed) clearOptimisticMessage();
      }
    }
  };

  const stopTurn = (visibleTurn?: ActiveAssistantTurn | null) => {
    // The rendered Stop control is driven by activeTurn. Use that same turn
    // if the mutable request ref has already been cleared while the UI still
    // shows it, so a visible Stop control can never become a no-op.
    const currentTurn = activeTurnRef.current;
    if (visibleTurn && currentTurn && visibleTurn.id !== currentTurn.id) return;
    const turn = currentTurn ?? visibleTurn ?? activeTurn;
    if (!turn || turn.controller.signal.aborted) return;
    activeTurnRef.current = null;
    startingTurnRef.current = false;
    setActiveTurn(null);
    clearOptimisticMessage();
    setTurnNotice({ conversationId: turn.conversationId, message: "Generation stopped. Check the conversation before retrying if the turn had nearly completed." });
    turn.controller.abort();
  };
  // Plan state is intentionally owned above floating/docked/fullscreen
  // renderers. Confirmation tokens are ephemeral and never persisted to local
  // storage or the assistant message history.
  const [executionPlans, setExecutionPlans] = React.useState<WorkspaceContextValue["executionPlans"]>({});

  React.useEffect(() => {
    setContext(current => current.route === location.pathname ? current : buildAssistantContext(location.pathname));
  }, [location.pathname]);

  const setInvoicePageContext = React.useCallback((activeFilters: AssistantContextEnvelope['activeFilters'], selectedRecordIds: string[]) => {
    if (location.pathname !== '/invoices') return;
    setContext(current => {
      const next = { ...current, route: '/invoices', entityType: 'invoice' as const,
        pageTitle: 'Invoices', activeFilters, selectedRecordIds, capturedAt: new Date().toISOString() };
      return JSON.stringify([current.activeFilters, current.selectedRecordIds, current.route]) ===
        JSON.stringify([next.activeFilters, next.selectedRecordIds, next.route]) ? current : next;
    });
  }, [location.pathname]);

  React.useEffect(() => {
    if (!storageKey || typeof window === "undefined") return;
    try {
      const stored = JSON.parse(window.localStorage.getItem(storageKey) || "null") as Partial<AssistantLayoutPreferences> | null;
      if (!stored) {
        const defaults = { ...DEFAULT_LAYOUT, floatingBounds: clampBounds(DEFAULT_LAYOUT.floatingBounds) };
        layoutRef.current = defaults;
        setLayout(defaults);
        setPriorPresentation(DEFAULT_LAYOUT.presentation);
        return;
      }
      const savedPresentation = stored.presentation || DEFAULT_LAYOUT.presentation;
      const restored = {
        presentation: savedPresentation,
        floatingBounds: clampBounds({ ...DEFAULT_LAYOUT.floatingBounds, ...stored.floatingBounds }),
        dockSize: Math.min(Math.max(Number(stored.dockSize) || DEFAULT_LAYOUT.dockSize, 300), 760),
      };
      layoutRef.current = restored;
      setLayout(restored);
      setPriorPresentation(savedPresentation);
    } catch {
      // Invalid local preference data must never prevent the app shell from rendering.
    }
  }, [storageKey]);

  const persistLayout = React.useCallback(() => {
    if (!storageKey || typeof window === "undefined") return;
    try {
      const latest = layoutRef.current;
      window.localStorage.setItem(storageKey, JSON.stringify({ ...latest, floatingBounds: clampBounds(latest.floatingBounds) }));
    } catch {
      // Local storage is optional for Stage 1.
    }
  }, [storageKey]);

  const setFloatingBounds = React.useCallback((bounds: AssistantLayoutPreferences["floatingBounds"]) => {
    const next = clampBounds(bounds);
    layoutRef.current = { ...layoutRef.current, floatingBounds: next };
    setLayout(current => ({ ...current, floatingBounds: next }));
  }, []);

  React.useEffect(() => {
    const keepReachable = () => setFloatingBounds(layoutRef.current.floatingBounds);
    window.addEventListener("resize", keepReachable);
    return () => window.removeEventListener("resize", keepReachable);
  }, [setFloatingBounds]);

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

  const saveExecutionPlan = React.useCallback((entry: { turnId: string; plan: unknown; confirmationToken: string | null }) => {
    setExecutionPlans((current) => ({ ...current, [entry.turnId]: entry }));
  }, []);
  const updateExecutionPlan = React.useCallback((planId: string, plan: unknown) => {
    setExecutionPlans((current) => Object.fromEntries(Object.entries(current).map(([turnId, entry]) => {
      const candidate = entry.plan && typeof entry.plan === "object" ? entry.plan as { id?: unknown } : null;
      return candidate?.id === planId ? [turnId, { ...entry, plan, confirmationToken: null }] : [turnId, entry];
    })));
  }, []);

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
    setFloatingBounds,
    setDockSize: (dockSize) => setLayout((current) => ({ ...current, dockSize: Math.min(Math.max(dockSize, 300), 760) })),
    persistLayout,
    refreshContext: () => setContext(current => current.route === location.pathname ? current : buildAssistantContext(location.pathname)),
    setInvoicePageContext,
    activeConversationId,
    setActiveConversationId,
    draft,
    setDraft,
    draftImages,
    addDraftImages,
    removeDraftImage,
    retryDraftImage,
    clearDraftImages,
    activeTurn,
    optimisticUserMessage,
    optimisticConversationId,
    turnNotice,
    sendOrdinaryTurn,
    stopTurn,
    clearOptimisticMessage,
    executionPlans,
    saveExecutionPlan,
    updateExecutionPlan,
  }), [activeConversationId, activeTurn, capabilityQuery.data, capabilityQuery.error, capabilityQuery.isLoading, clearOptimisticMessage, context, draft, draftImages, addDraftImages, removeDraftImage, retryDraftImage, clearDraftImages, executionPlans, isMobile, layout, minimize, optimisticConversationId, optimisticUserMessage, persistLayout, presentation, priorPresentation, saveExecutionPlan, sendOrdinaryTurn, setFloatingBounds, setInvoicePageContext, setPresentation, stopTurn, toggle, turnNotice, updateExecutionPlan, location.pathname]);

  return <AssistantWorkspaceContext.Provider value={value}>{children}</AssistantWorkspaceContext.Provider>;
}
