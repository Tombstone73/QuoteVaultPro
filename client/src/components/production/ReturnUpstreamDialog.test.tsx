import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ReturnUpstreamDialog } from "./ReturnUpstreamDialog";
import { apiFetch } from "@/lib/queryClient";
import type { ReturnUpstreamTarget } from "@/lib/returnUpstream";

jest.mock("@/lib/queryClient", () => ({ apiFetch: jest.fn() }));
jest.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: jest.fn() }) }));
jest.mock("@/components/ui/dialog", () => ({
  Dialog: ({ open, children }: any) => open ? <div>{children}</div> : null,
  DialogContent: ({ children }: any) => <div>{children}</div>,
  DialogDescription: ({ children }: any) => <p>{children}</p>,
  DialogFooter: ({ children }: any) => <div>{children}</div>,
  DialogHeader: ({ children }: any) => <div>{children}</div>,
  DialogTitle: ({ children }: any) => <h2>{children}</h2>,
}));

const target: ReturnUpstreamTarget = {
  lineItemId: "line-1", orderId: "order-1", workflowState: "ready_for_prepress",
  activeOwnerJobId: "job-1", lineItemUpdatedAt: "2026-09-30T12:00:00.000Z",
  isActivelyOwnedByPrepress: true,
};

let element: HTMLDivElement;
let root: Root;
let client: QueryClient;

beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  element = document.createElement("div");
  document.body.appendChild(element);
  root = createRoot(element);
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  jest.mocked(apiFetch).mockReset();
});
afterEach(async () => { await act(async () => root.unmount()); element.remove(); client.clear(); });

async function render(onClose = jest.fn()) {
  await act(async () => root.render(<QueryClientProvider client={client}><ReturnUpstreamDialog target={target} destination="proofing" onClose={onClose} /></QueryClientProvider>));
  return onClose;
}

async function enterReason(value: string) {
  const textarea = element.querySelector("textarea")!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(textarea, value);
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

test("requires a reason before Return to Proofing can submit", async () => {
  await render();
  const button = Array.from(element.querySelectorAll("button")).find((item) => item.textContent === "Return to Proofing")!;
  expect(button.disabled).toBe(true);
  expect(apiFetch).not.toHaveBeenCalled();
  await enterReason("Artwork needs review");
  expect(button.disabled).toBe(false);
});

test("stale state refreshes canonical data and cannot resubmit stale values", async () => {
  jest.mocked(apiFetch).mockResolvedValue({ ok: false, status: 409, json: async () => ({ code: "UPSTREAM_STALE_STATE", message: "Stale" }) } as Response);
  const invalidate = jest.spyOn(client, "invalidateQueries");
  await render();
  await enterReason("Artwork needs review");
  const button = Array.from(element.querySelectorAll("button")).find((item) => item.textContent === "Return to Proofing")!;
  await act(async () => { button.click(); await Promise.resolve(); });
  expect(apiFetch).toHaveBeenCalledTimes(1);
  expect(element.textContent).toContain("The latest state has been refreshed");
  expect(button.disabled).toBe(true);
  expect(invalidate).toHaveBeenCalledWith({ queryKey: ["/api/prepress/queue"] });
  expect(invalidate).toHaveBeenCalledWith({ queryKey: ["orders", "detail", "order-1"] });
});

test("success refreshes canonical queues and closes the dialog", async () => {
  jest.mocked(apiFetch).mockResolvedValue({ ok: true } as Response);
  const invalidate = jest.spyOn(client, "invalidateQueries");
  const onClose = await render();
  await enterReason("Return for correction");
  const button = Array.from(element.querySelectorAll("button")).find((item) => item.textContent === "Return to Proofing")!;
  await act(async () => { button.click(); await Promise.resolve(); });
  expect(invalidate).toHaveBeenCalledWith({ queryKey: ["/api/prepress/queue"] });
  expect(invalidate).toHaveBeenCalledWith({ queryKey: ["/api/proofing/queue"] });
  expect(invalidate).toHaveBeenCalledWith({ queryKey: ["/api/design/queue"] });
  expect(onClose).toHaveBeenCalledTimes(1);
});

test("combined-Proof conflict is shown without a client-side workaround", async () => {
  jest.mocked(apiFetch).mockResolvedValue({ ok: false, status: 409, json: async () => ({ code: "UPSTREAM_SHARED_PROOF", message: "Resolve the combined Proof first." }) } as Response);
  await render();
  await enterReason("Return for correction");
  const button = Array.from(element.querySelectorAll("button")).find((item) => item.textContent === "Return to Proofing")!;
  await act(async () => { button.click(); await Promise.resolve(); });
  expect(element.textContent).toContain("Resolve the combined Proof first.");
  expect(apiFetch).toHaveBeenCalledTimes(1);
});
