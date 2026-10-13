import React from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { jest, test, expect } from "@jest/globals";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const mockFetch = jest.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>();
const mockConversations = [
  { id: "conversation_1", title: "First chat", lastMessagePreview: "Earlier message", status: "active", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" },
  { id: "conversation_2", title: "Second chat", lastMessagePreview: "Earlier message", status: "active", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" },
];
const mockMutation = () => ({ mutateAsync: jest.fn(async () => undefined), isPending: false, variables: undefined });
jest.mock("@/lib/apiConfig", () => ({ apiUrl: (path: string) => path, resolveCanonicalApiRequestUrl: (path: string) => path }));
jest.mock("react-router-dom", () => ({ useLocation: () => ({ pathname: "/products" }) }));
jest.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ isAuthenticated: true, isPortalCustomer: false }) }));
jest.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => false }));
jest.mock("@/hooks/useAssistantApi", () => ({
  ...jest.requireActual<typeof import("@/hooks/useAssistantApi")>("@/hooks/useAssistantApi"),
  assistantTurnFailureMessage: () => "Turn failed",
  useAssistantCapabilities: () => ({ data: { enabled: true, conversationsEnabled: true, toolsEnabled: true }, error: null, isLoading: false }),
  useAssistantConversations: (_enabled: boolean, status?: string) => ({ data: status === "archived" ? [] : mockConversations, isLoading: false }),
  useAssistantConversation: () => ({ data: { messages: [] }, isLoading: false }),
  useCreateAssistantConversation: () => ({ ...mockMutation(), mutateAsync: jest.fn(async () => ({ id: "conversation_1" })) }),
  useUpdateAssistantConversation: mockMutation,
  useArchiveAssistantConversations: mockMutation,
  useCancelAssistantPlan: mockMutation,
  useConfirmAssistantQuoteInternalNote: mockMutation,
  useCreateAssistantExecutionPlan: mockMutation,
  useCanonicalProductIntentInteraction: mockMutation,
  useCancelAssistantReportResolution: mockMutation,
  useSelectAssistantReportResolution: mockMutation,
  useSubmitAssistantOrderOptionSelections: mockMutation,
}));

import { AssistantWorkspaceProvider, useAssistantWorkspace } from "./AssistantWorkspaceProvider";
import { AssistantOverlay } from "./AssistantWorkspace";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function deferred() {
  let resolve!: (value: unknown) => void;
  const promise = new Promise<unknown>((done) => { resolve = done; });
  return { promise, resolve };
}

function response(correlationId: string): Response {
  return { ok: true, json: async () => ({ data: { correlationId } }) } as Response;
}

test("the rendered Stop button aborts the active request and keeps a new turn isolated", async () => {
  Object.defineProperty(globalThis.crypto, "randomUUID", { configurable: true, value: jest.fn(() => `request_${Math.random()}`) });
  const first = deferred();
  const second = deferred();
  const third = deferred();
  mockFetch.mockReset().mockImplementationOnce(() => first.promise as Promise<Response>).mockImplementationOnce(() => second.promise as Promise<Response>).mockImplementationOnce(() => third.promise as Promise<Response>);
  globalThis.fetch = mockFetch;
  let workspace!: ReturnType<typeof useAssistantWorkspace>;
  function Harness() {
    workspace = useAssistantWorkspace();
    return <AssistantOverlay />;
  }
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  await act(async () => { root.render(<QueryClientProvider client={queryClient}><AssistantWorkspaceProvider><Harness /></AssistantWorkspaceProvider></QueryClientProvider>); });
  await act(async () => { workspace.setPresentation("floating"); });

  const textarea = () => container.querySelector<HTMLTextAreaElement>('textarea[aria-label="Message the assistant"]')!;
  const send = () => container.querySelector<HTMLButtonElement>('button[aria-label="Send message"]');
  const stop = () => container.querySelector<HTMLButtonElement>('button[aria-label="Stop generating"]');
  expect(send()).not.toBeNull();
  await act(async () => {
    const input = textarea();
    Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")!.set!.call(input, "first");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => { send()!.click(); });
  expect(stop()).not.toBeNull();
  expect(container.querySelector('[data-testid="assistant-working-indicator"]')).not.toBeNull();
  const firstSignal = mockFetch.mock.calls[0][1]?.signal as AbortSignal;
  expect(firstSignal.aborted).toBe(false);

  await act(async () => { container.querySelector<HTMLButtonElement>('button[aria-label="Minimize assistant"]')!.click(); });
  expect(stop()).toBeNull();
  expect(firstSignal.aborted).toBe(false);
  await act(async () => { workspace.setPresentation("floating"); });
  expect(stop()).not.toBeNull();
  await act(async () => { Array.from(container.querySelectorAll<HTMLButtonElement>('aside[aria-label="Assistant conversations"] button')).find((button) => button.textContent?.includes("Second chat"))!.click(); });
  expect(workspace.activeConversationId).toBe("conversation_2");

  await act(async () => { stop()!.click(); });
  expect(firstSignal.aborted).toBe(true);
  expect(stop()).toBeNull();
  expect(send()).not.toBeNull();
  expect(textarea().disabled).toBe(false);
  expect(container.querySelector('[data-testid="assistant-working-indicator"]')).toBeNull();

  await act(async () => {
    const input = textarea();
    Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")!.set!.call(input, "second");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => { send()!.click(); });
  expect(mockFetch).toHaveBeenCalledTimes(2);
  const secondSignal = mockFetch.mock.calls[1][1]?.signal as AbortSignal;
  expect(secondSignal.aborted).toBe(false);
  await act(async () => { first.resolve(response("late-old")); });
  expect(stop()).not.toBeNull();
  expect(secondSignal.aborted).toBe(false);

  const pressedStop = stop()!;
  await act(async () => { pressedStop.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, button: 0 })); });
  expect(secondSignal.aborted).toBe(true);
  expect(stop()).toBeNull();
  expect(send()).not.toBeNull();
  expect(container.querySelector('[data-testid="assistant-working-indicator"]')).toBeNull();

  await act(async () => {
    const input = textarea();
    Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")!.set!.call(input, "third");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => { send()!.click(); });
  expect(mockFetch).toHaveBeenCalledTimes(3);
  const thirdSignal = mockFetch.mock.calls[2][1]?.signal as AbortSignal;
  await act(async () => { pressedStop.click(); second.resolve(response("late-second")); });
  expect(thirdSignal.aborted).toBe(false);
  expect(stop()).not.toBeNull();
  await act(async () => { third.resolve(response("new")); });
  expect(stop()).toBeNull();
  await act(async () => root.unmount());
  container.remove();
});
