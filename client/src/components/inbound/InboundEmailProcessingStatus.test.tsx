import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { InboundEmailProcessingStatus } from "./InboundEmailProcessingStatus";
import { inboundEmailProcessingLabels, type InboundEmailProcessingStatus } from "@shared/inboundEmailProcessing";

jest.mock("@/lib/queryClient", () => ({ apiRequest: jest.fn() }));
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
const mockedRequest = apiRequest as jest.Mock;
let container: HTMLDivElement, root: Root, client: QueryClient;
beforeEach(() => {
  mockedRequest.mockReset(); container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
});
afterEach(() => { act(() => root.unmount()); client.clear(); container.remove(); });
async function render(status: InboundEmailProcessingStatus, enabled = true) {
  mockedRequest.mockResolvedValue({ json: async () => ({ success: true, data: { enabled, job: { id: "job", status, attempts: 1, nextAttemptAt: "2026-11-01T00:00:00Z", message: "Source evidence is retained.", errorCode: null, canRetry: status === "failed" } } }) });
  await act(async () => {
    root.render(<QueryClientProvider client={client}><InboundEmailProcessingStatus recordId="email-1" /></QueryClientProvider>);
  });
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });
}
test.each(["waiting", "processing", "review_ready", "needs_attention", "failed"] as const)("shows %s without claiming an Order was created", async status => {
  await render(status);
  expect(container.textContent).toContain(inboundEmailProcessingLabels[status]);
  expect(container.textContent).toContain("Staff approval is required");
  expect(mockedRequest).toHaveBeenCalledWith("GET", "/api/inbound-orders/email-1/processing");
});
test("disabled rollout explains the pause and disables retry", async () => {
  await render("failed", false);
  expect(container.textContent).toContain("paused for this organization");
  expect((container.querySelector("button") as HTMLButtonElement).disabled).toBe(true);
  expect(mockedRequest.mock.calls.every(call => call[0] === "GET")).toBe(true);
});
test("safe retry queues existing work once and refreshes processing visibility", async () => {
  await render("failed");
  await act(async () => {
    (container.querySelector("button") as HTMLButtonElement).click();
    await new Promise(resolve => setTimeout(resolve, 20));
  });
  expect(mockedRequest.mock.calls.filter(call => call[0] === "POST")).toEqual([["POST", "/api/inbound-orders/email-1/processing/retry", {}]]);
});
test("background completion refreshes evidence without invalidating an editable staff draft", async () => {
  const key = ["/api/inbound-orders", "email-1", "review-draft"];
  const edits = { staffNotes: "Keep my unsaved edits" }; client.setQueryData(key, edits);
  const invalidate = jest.spyOn(client, "invalidateQueries");
  await render("review_ready");
  expect(invalidate).toHaveBeenCalledWith({ queryKey: ["/api/inbound-orders", "email-1", "draft-preview"], exact: true });
  expect(invalidate.mock.calls.some(([input]) => JSON.stringify(input?.queryKey) === JSON.stringify(key))).toBe(false);
  expect(client.getQueryData(key)).toEqual(edits);
});
