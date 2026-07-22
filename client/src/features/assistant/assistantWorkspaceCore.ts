import type { AssistantCapability, AssistantContextEnvelope } from "@shared/assistantContracts";
import type { AssistantPresentation } from "./types";

const SAFE_IDENTIFIER = /^[A-Za-z0-9:_-]{1,128}$/;
const ROUTE_ENTITIES: Record<string, AssistantContextEnvelope["entityType"]> = {
  customers: "customer",
  quotes: "quote",
  orders: "order",
  products: "product",
  invoices: "invoice",
  materials: "unknown",
  vendors: "unknown",
  contacts: "unknown",
  "purchase-orders": "unknown",
  production: "production_job",
};

export function shouldEnableAssistantForRoute(isAuthenticated: boolean, isPortalCustomer: boolean, pathname: string) {
  return isAuthenticated && !isPortalCustomer && !pathname.startsWith("/portal");
}

export function getAssistantPreferenceKey(capability?: AssistantCapability) {
  const actorScope = capability?.actorScope;
  return actorScope ? `printershero:assistant:layout:${actorScope.userId}:${actorScope.organizationId}` : null;
}

export function resolveAssistantPresentation(isMobile: boolean, requested: AssistantPresentation): AssistantPresentation {
  return isMobile && ["floating", "dock_left", "dock_right"].includes(requested) ? "fullscreen" : requested;
}

export function isAssistantShortcut(event: Pick<KeyboardEvent, "ctrlKey" | "metaKey" | "key" | "target">) {
  const target = event.target;
  const editable = target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));
  return (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "j" && !editable;
}

export function buildSafeAssistantContext(pathname: string, pageTitle: string): AssistantContextEnvelope {
  const segments = pathname.split("/").filter(Boolean);
  const entityType = segments[0] ? ROUTE_ENTITIES[segments[0]] : undefined;
  const candidateId = entityType && entityType !== "unknown" && segments.length > 1 && !["new", "edit"].includes(segments[1]) && SAFE_IDENTIFIER.test(segments[1]) ? segments[1] : undefined;
  return {
    contextVersion: "v1",
    route: pathname.slice(0, 512),
    pageTitle: (pageTitle || "PrintersHero").slice(0, 240),
    ...(entityType ? { entityType } : {}),
    ...(candidateId ? { entityId: candidateId } : {}),
    selectedRecordIds: [],
    activeFilters: [],
    capturedAt: new Date().toISOString(),
    unsavedChanges: false,
  };
}

export type AssistantWorkspaceDraftState = { activeConversationId: string | null; draft: string };

type AssistantConversationListItem = {
  id: string;
  title: string;
  lastMessagePreview?: string | null;
};

/** Empty conversations are kept for retention, but only the active one is
 * shown. This prevents abandoned drafts from reading like duplicate chats. */
export function visibleAssistantConversations<T extends AssistantConversationListItem>(conversations: readonly T[] | undefined, activeConversationId: string | null): T[] {
  return (conversations ?? []).filter((conversation) => conversation.id === activeConversationId || Boolean(conversation.lastMessagePreview?.trim()));
}

export function assistantConversationLabel(title: string | null | undefined): string {
  return !title?.trim() || title.trim() === "New conversation" ? "New chat" : title.trim();
}

export function assistantComposerHelper(fullText: string, presentation: AssistantPresentation) {
  const compact = presentation === "dock_left" || presentation === "dock_right";
  return {
    text: compact ? "Lookups + confirmed actions" : fullText,
    fullText,
    compact,
  };
}

/** Presentation-independent state used by the provider for all workspace renderers. */
export function preserveConversationState(current: AssistantWorkspaceDraftState, update: Partial<AssistantWorkspaceDraftState>) {
  return { ...current, ...update };
}
