import { buildSafeAssistantContext, getAssistantPreferenceKey, isAssistantShortcut, preserveConversationState, resolveAssistantPresentation, shouldEnableAssistantForRoute } from "./assistantWorkspaceCore";

describe("assistant workspace core", () => {
  const capability = {
    enabled: true,
    conversationsEnabled: true,
    toolsEnabled: false as const,
    writeActionsEnabled: false as const,
    externalResearchEnabled: false as const,
    assistantVersion: "stage-1",
    unavailableReason: null,
    actorScope: { userId: "user-1", organizationId: "org-1" },
  };

  it("uses the server-provided actor scope for layout preferences", () => {
    expect(getAssistantPreferenceKey(capability)).toBe("printershero:assistant:layout:user-1:org-1");
    expect(getAssistantPreferenceKey()).toBeNull();
  });

  it("keeps portal routes out of the assistant feature", () => {
    expect(shouldEnableAssistantForRoute(true, false, "/orders")).toBe(true);
    expect(shouldEnableAssistantForRoute(true, true, "/portal/orders")).toBe(false);
    expect(shouldEnableAssistantForRoute(false, false, "/orders")).toBe(false);
  });

  it("uses fullscreen rather than an unusable floating or side dock on mobile", () => {
    expect(resolveAssistantPresentation(true, "floating")).toBe("fullscreen");
    expect(resolveAssistantPresentation(true, "dock_left")).toBe("fullscreen");
    expect(resolveAssistantPresentation(true, "dock_bottom")).toBe("dock_bottom");
  });

  it("preserves the draft and selected conversation while presentation changes", () => {
    expect(preserveConversationState({ activeConversationId: "conversation-1", draft: "Keep this draft" }, {})).toEqual({ activeConversationId: "conversation-1", draft: "Keep this draft" });
  });

  it("only handles Ctrl/Cmd+J outside editable controls, leaving global search untouched", () => {
    const input = document.createElement("input");
    expect(isAssistantShortcut({ ctrlKey: true, metaKey: false, key: "j", target: input })).toBe(false);
    expect(isAssistantShortcut({ ctrlKey: true, metaKey: false, key: "k", target: document.body })).toBe(false);
    expect(isAssistantShortcut({ ctrlKey: false, metaKey: true, key: "J", target: document.body })).toBe(true);
  });

  it("collects only validated route context and never infers unsupported entities", () => {
    expect(buildSafeAssistantContext("/orders/order_1", "Order")).toMatchObject({ contextVersion: "v1", entityType: "order", entityId: "order_1", selectedRecordIds: [], activeFilters: [], unsavedChanges: false });
    expect(buildSafeAssistantContext("/materials/unsafe value", "Materials")).toMatchObject({ entityType: "unknown" });
    expect(buildSafeAssistantContext("/portal/orders/1", "Portal").entityId).toBeUndefined();
  });
});
