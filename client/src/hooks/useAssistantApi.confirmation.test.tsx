import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { jest } from "@jest/globals";
import { apiRequest } from "@/lib/queryClient";
import { buildSafeAssistantContext } from "@/features/assistant/assistantWorkspaceCore";
import { useConfirmAssistantQuoteInternalNote } from "./useAssistantApi";

jest.mock("@/lib/queryClient", () => ({ apiRequest: jest.fn() }));
jest.mock("@/lib/apiConfig", () => ({ getApiUrl: jest.fn() }));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

it.each([
  ["fulfillment.adjust_physical_readiness", "succeeded", true],
  ["fulfillment.adjust_physical_readiness", "failed", true],
  ["fulfillment.add_note", "succeeded", false],
] as const)("invalidates native order queries for %s / %s: %s", async (action, status, expected) => {
  const queries = new QueryClient();
  const root = createRoot(document.createElement("div"));
  const keys = [["fulfillment", "order", "order-1"], ["orders", "detail", "order-1"], ["orders", "timeline", "order-1"], ["fulfillment", "queue"], ["orders", "list"]];
  const other = ["orders", "detail", "order-2"];
  for (const key of [...keys, other]) queries.setQueryData(key, {});
  let confirm!: ReturnType<typeof useConfirmAssistantQuoteInternalNote>["mutateAsync"];
  function Probe() { confirm = useConfirmAssistantQuoteInternalNote().mutateAsync; return null; }
  jest.mocked(apiRequest).mockResolvedValueOnce({ json: async () => ({ data: { plan: { action, status }, result: { status, summary: status === "failed" ? "Adjustment outcome unknown." : "Recorded." } } }) } as Response);
  try {
    act(() => root.render(<QueryClientProvider client={queries}><Probe /></QueryClientProvider>));
    await act(async () => { await confirm({ planId: "plan-1", expectedPlanVersion: 1, confirmationToken: "test-token", context: buildSafeAssistantContext("/orders/order-1", "Order") }); });
    for (const key of keys) expect(queries.getQueryState(key)?.isInvalidated).toBe(expected);
    expect(queries.getQueryState(other)?.isInvalidated).toBe(false);
  } finally { act(() => root.unmount()); queries.clear(); }
});
