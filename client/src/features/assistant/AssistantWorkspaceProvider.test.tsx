import React from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { jest, test, expect } from "@jest/globals";

const mockSendTurn = jest.fn<(input: { signal: AbortSignal }) => Promise<unknown>>();
jest.mock("react-router-dom", () => ({ useLocation: () => ({ pathname: "/products" }) }));
jest.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ isAuthenticated: true, isPortalCustomer: false }) }));
jest.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => false }));
jest.mock("@/hooks/useAssistantApi", () => ({
  assistantTurnFailureMessage: () => "Turn failed",
  useAssistantCapabilities: () => ({ data: undefined, error: null, isLoading: false }),
  useCreateAssistantConversation: () => ({ mutateAsync: async () => ({ id: "conversation_1" }) }),
  useSendAssistantTurn: () => ({ mutateAsync: mockSendTurn }),
}));

import { AssistantWorkspaceProvider, useAssistantWorkspace } from "./AssistantWorkspaceProvider";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

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
