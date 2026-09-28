import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Simulate } from "react-dom/test-utils";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, afterEach, expect, jest, test } from "@jest/globals";

let mockRows: any[] = [], mockActiveOnly = false;
const mockRequests: any[] = [];
const mockApiFetch = jest.fn(async (url: string, options?: any) => {
  if (options?.method === "POST") {
    const input = JSON.parse(options.body); mockRequests.push(input);
    const canceled: string[] = [], skipped: any[] = [];
    for (const id of input.jobIds) {
      const row = mockRows.find(row => row.id === id);
      if (["queued", "retrying", "needs_review"].includes(row.status)) { row.status = "canceled"; canceled.push(id); }
      else skipped.push({ id, status: row.status });
    }
    return { ok: true, json: async () => ({ success: true, data: { canceled, alreadyCanceled: [], skipped } }) };
  }
  return { ok: true, json: async () => ({ data: {
    items: mockRows.filter(row => !mockActiveOnly || ["queued", "processing", "retrying"].includes(row.status)),
    pagination: { page: 1, totalPages: 1 }, counts: { active: mockRows.filter(row => ["queued", "processing", "retrying"].includes(row.status)).length, failed: 1, needsReview: 1 }, claimSeconds: 60,
  } }) };
});
jest.mock("@/lib/queryClient", () => ({ apiFetch: mockApiFetch, apiRequest: jest.fn() }));
import { InvoiceEmailQueueDialog } from "./InvoiceEmailQueueDialog";
let root: Root, container: HTMLDivElement;
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  mockRequests.length = 0; mockActiveOnly = false;
  mockRows = ["queued", "retrying", "needs_review", "sent", "processing", "failed", "superseded"].map(status => ({ id: status, status,
    invoiceId: "invoice", invoiceNumber: "20395", recipientEmail: "billing@example.test", queuedAt: "2026-09-20T23:19:00Z", availableAt: "2026-09-20T23:25:00Z", attemptCount: 1, maxAttempts: 3, metadata: {} }));
});
afterEach(() => { act(() => root.unmount()); container.remove(); });
async function renderDialog() {
  await act(async () => root.render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><InvoiceEmailQueueDialog open view="active" setView={() => {}} page={1} setPage={() => {}} onOpenChange={() => {}} onOpenInvoice={() => {}} onReview={() => {}} /></QueryClientProvider>));
  for (let i=0; i<15 && !document.querySelector('[data-testid="email-queue-job-queued"]'); i++) await act(async () => new Promise(resolve => setTimeout(resolve, 0)));
}
const findButton = (text: string) => Array.from(document.querySelectorAll("button")).find(button => button.textContent === text)!;
test("only eligible rows offer Cancel; processing is explicit and superseded renders", async () => {
  await renderDialog();
  for (const status of ["queued", "retrying", "needs_review"]) expect(document.querySelector(`[data-testid="email-queue-job-${status}"]`)?.textContent).toContain("Cancel");
  for (const status of ["sent", "processing", "failed", "superseded"]) expect(document.querySelector(`[data-testid="email-queue-job-${status}"]`)?.textContent).not.toContain("Cancel");
  expect(document.body.textContent).toContain("Processing — cannot safely cancel");
  expect(document.body.textContent).toContain("Superseded");
});
test("confirmation and optional reason cancel a waiting row and refresh active counts", async () => {
  mockActiveOnly = true; await renderDialog();
  const row = document.querySelector('[data-testid="email-queue-job-queued"]')!;
  await act(async () => Simulate.click(Array.from(row.querySelectorAll("button")).find(button => button.textContent === "Cancel")!));
  expect(mockRequests).toHaveLength(0); expect(document.body.textContent).toContain("1 of 1 selected jobs");
  const input = document.querySelector('input[maxlength="500"]')!;
  await act(async () => Simulate.change(input, { target: { value: "Duplicate" } } as any));
  await act(async () => Simulate.click(findButton("Confirm cancellation")));
  for (let i=0; i<10 && document.querySelector('[data-testid="email-queue-job-queued"]'); i++) await act(async () => new Promise(resolve => setTimeout(resolve,0)));
  expect(mockRequests[0]).toEqual({ jobIds: ["queued"], reason: "Duplicate" });
  expect(document.querySelector('[data-testid="email-queue-job-queued"]')).toBeNull();
  expect(document.body.textContent).toContain("2 waiting or sending");
});
test("mixed bulk selection reports eligibility and skipped states", async () => {
  await renderDialog();
  await act(async () => (document.querySelector('[aria-label="Select visible queue jobs"]') as HTMLButtonElement).click());
  await act(async () => Simulate.click(findButton("Cancel selected (3 eligible)")));
  expect(document.body.textContent).toContain("3 of 7 selected jobs");
  expect(document.body.textContent).toContain("cannot recall a submitted email");
  await act(async () => Simulate.click(findButton("Confirm cancellation")));
  expect(document.body.textContent).toContain("3 canceled, 4 skipped");
  expect(mockRows.find(row => row.id === "sent").status).toBe("sent");
});
