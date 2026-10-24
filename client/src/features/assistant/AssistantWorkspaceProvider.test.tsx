import React from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { jest, test, expect } from "@jest/globals";

const mockSendTurn = jest.fn<(input: { signal: AbortSignal; clientRequestId: string; message: string }) => Promise<unknown>>();
let mockCapabilitiesData: Record<string, unknown> | undefined;
jest.mock("react-router-dom", () => ({ useLocation: () => ({ pathname: "/products" }) }));
jest.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ isAuthenticated: true, isPortalCustomer: false }) }));
jest.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => false }));
jest.mock("@/lib/apiConfig", () => ({ apiUrl: (path: string) => path, resolveCanonicalApiRequestUrl: (path: string) => path }));
jest.mock("@/lib/queryClient", () => ({ ApiRequestError: class ApiRequestError extends Error { code?: string; constructor(message: string, code?: string) { super(message); this.code = code; } } }));
jest.mock("@/hooks/useAssistantApi", () => ({
  assistantTurnFailureMessage: () => "Turn failed",
  useAssistantCapabilities: () => ({ data: mockCapabilitiesData, error: null, isLoading: false }),
  useCreateAssistantConversation: () => ({ mutateAsync: async () => ({ id: "conversation_1" }) }),
  useSendAssistantTurn: () => ({ mutateAsync: mockSendTurn }),
}));

import { AssistantWorkspaceProvider, useAssistantWorkspace } from "./AssistantWorkspaceProvider";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

test("latest floating bounds persist immediately and remain reachable after viewport resize", async () => {
  mockCapabilitiesData = { enabled: true, conversationsEnabled: true, actorScope: { userId: "layout_user", organizationId: "layout_org" } };
  const key = "printershero:assistant:layout:layout_user:layout_org";
  window.localStorage.removeItem(key);
  const originalWidth = window.innerWidth;
  const originalHeight = window.innerHeight;
  Object.defineProperty(window, "innerWidth", { configurable: true, value: 1200 });
  Object.defineProperty(window, "innerHeight", { configurable: true, value: 900 });
  let workspace!: ReturnType<typeof useAssistantWorkspace>;
  function Harness() { workspace = useAssistantWorkspace(); return null; }
  const container = document.createElement("div");
  const root = createRoot(container);
  try {
    await act(async () => root.render(<AssistantWorkspaceProvider><Harness /></AssistantWorkspaceProvider>));
    await act(async () => {
      workspace.setFloatingBounds({ x: 300, y: 200, width: 500, height: 400 });
      workspace.persistLayout();
    });
    expect(JSON.parse(window.localStorage.getItem(key) || "null").floatingBounds).toEqual({ x: 300, y: 200, width: 500, height: 400 });
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 420 });
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 480 });
    await act(async () => window.dispatchEvent(new Event("resize")));
    expect(workspace.layout.floatingBounds).toEqual({ x: 12, y: 68, width: 396, height: 400 });
    mockCapabilitiesData = { ...mockCapabilitiesData, actorScope: { userId: "another_user", organizationId: "layout_org" } };
    await act(async () => root.render(<AssistantWorkspaceProvider><Harness /></AssistantWorkspaceProvider>));
    expect(workspace.layout.floatingBounds).toEqual({ x: 12, y: 12, width: 396, height: 456 });
  } finally {
    await act(async () => root.unmount());
    window.localStorage.removeItem(key);
    mockCapabilitiesData = undefined;
    Object.defineProperty(window, "innerWidth", { configurable: true, value: originalWidth });
    Object.defineProperty(window, "innerHeight", { configurable: true, value: originalHeight });
  }
});

function deferred() {
  let resolve!: (value: unknown) => void;
  const promise = new Promise<unknown>((done) => { resolve = done; });
  return { promise, resolve };
}

test("minimizing preserves a turn, Stop recovers immediately, and a late old reply cannot clear the next turn", async () => {
  Object.defineProperty(globalThis.crypto, "randomUUID", { configurable: true, value: jest.fn(() => `request_${Math.random()}`) });
  const first = deferred();
  const second = deferred();
  mockSendTurn.mockReset().mockImplementationOnce(() => first.promise).mockImplementationOnce(() => second.promise);
  let workspace!: ReturnType<typeof useAssistantWorkspace>;
  function Harness() {
    workspace = useAssistantWorkspace();
    return workspace.presentation === "minimized" ? null : <div data-testid="assistant-panel" />;
  }
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => { root.render(<AssistantWorkspaceProvider><Harness /></AssistantWorkspaceProvider>); });
  await act(async () => { workspace.setPresentation("floating"); });
  await act(async () => { void workspace.sendOrdinaryTurn("first", false); });
  const firstSignal = mockSendTurn.mock.calls[0]?.[0].signal;
  expect(firstSignal?.aborted).toBe(false);
  await act(async () => { workspace.minimize(); });
  expect(container.querySelector('[data-testid="assistant-panel"]')).toBeNull();
  expect(firstSignal?.aborted).toBe(false);
  await act(async () => { workspace.setPresentation("floating"); workspace.stopTurn(); });
  expect(firstSignal?.aborted).toBe(true);
  expect(workspace.activeTurn).toBeNull();
  await act(async () => { void workspace.sendOrdinaryTurn("second", false); });
  const secondId = workspace.activeTurn?.id;
  expect(mockSendTurn).toHaveBeenCalledTimes(2);
  await act(async () => { first.resolve({ data: { correlationId: "old_corr" } }); });
  expect(workspace.activeTurn?.id).toBe(secondId);
  await act(async () => { second.resolve({ data: { correlationId: "new_corr" } }); });
  expect(workspace.activeTurn).toBeNull();
  await act(async () => root.unmount());
  container.remove();
});

test("failed persistence preserves the draft and explicit retry reuses the request ID", async () => {
  Object.defineProperty(globalThis.crypto, "randomUUID", { configurable: true, value: jest.fn(() => "request_retry") });
  mockSendTurn.mockReset().mockRejectedValueOnce(new Error("write failed"))
    .mockResolvedValueOnce({ data: { correlationId: "saved_ref" } });
  let workspace!: ReturnType<typeof useAssistantWorkspace>;
  function Harness() { workspace = useAssistantWorkspace(); return null; }
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => { root.render(<AssistantWorkspaceProvider><Harness /></AssistantWorkspaceProvider>); });
  await act(async () => { workspace.setDraft("Keep this message"); });
  await act(async () => { await workspace.sendOrdinaryTurn("Keep this message", true); });
  expect(workspace.draft).toBe("Keep this message");
  expect(workspace.turnNotice?.message).toBe("Turn failed");
  await act(async () => { await workspace.sendOrdinaryTurn("Keep this message", true); });
  expect(mockSendTurn).toHaveBeenCalledTimes(2);
  expect(mockSendTurn.mock.calls[1][0].clientRequestId).toBe(mockSendTurn.mock.calls[0][0].clientRequestId);
  expect(workspace.draft).toBe("");
  await act(async () => root.unmount());
  container.remove();
});


test("a persisted assistant failure keeps the saved message in history without prompting duplicate upload", async () => {
  Object.defineProperty(globalThis.crypto, "randomUUID", { configurable: true, value: jest.fn(() => "request_failed_response") });
  mockSendTurn.mockReset().mockResolvedValue({ data: { status: "failed", correlationId: "failed_ref" } });
  let workspace!: ReturnType<typeof useAssistantWorkspace>;
  function Harness() { workspace = useAssistantWorkspace(); return null; }
  const container = document.createElement("div");
  const root = createRoot(container);
  await act(async () => root.render(<AssistantWorkspaceProvider><Harness /></AssistantWorkspaceProvider>));
  await act(async () => workspace.setDraft("Describe my photo"));
  await act(async () => workspace.sendOrdinaryTurn("Describe my photo", true));
  expect(workspace.draft).toBe("");
  expect(workspace.turnNotice?.message).toContain("message was saved");
  expect(workspace.turnNotice?.message).toContain("without resending it");
  await act(async () => root.unmount());
});
