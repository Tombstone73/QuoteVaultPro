import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { InvoiceBulkActions } from "./InvoiceBulkActions";
import { invoiceBulkActionPermissions } from "@shared/invoiceBulkActionPermissions";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let host: HTMLDivElement;
const onAddPayment = jest.fn();
const noop = jest.fn();

async function render(role: string, capabilities: string[], count: number) {
  await act(async () => root.render(<InvoiceBulkActions selectedCount={count}
    permissions={invoiceBulkActionPermissions(role, capabilities)} sending={false} markingSent={false} approving={false}
    onSend={noop} onMarkSent={noop} onApprove={noop} onAddPayment={onAddPayment} />));
  return host.textContent ?? "";
}

beforeEach(() => { host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host); jest.clearAllMocks(); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });

test("Owner and tenant Admin both see the four bulk actions and a live count", async () => {
  for (const role of ["owner", "admin"]) {
    const text = await render(role, [], 2);
    expect(text).toContain("2 selected");
    for (const label of ["Send Selected", "Mark as Sent", "Approve Selected", "Add Payment"]) expect(text).toContain(label);
    expect((await render(role, [], 3))).toContain("3 selected");
  }
});

test("Accounting and a custom staff permission set with payment.record can open Add Payment", async () => {
  for (const permissionSet of ["accounting", "custom"]) {
    const text = await render("member", ["payment.record"], 2);
    expect(text).toContain("2 selected");
    expect(text).toContain("Add Payment");
    expect(text).not.toContain("Approve Selected");
    await act(async () => (Array.from(host.querySelectorAll("button")).find((button) => button.textContent === "Add Payment") as HTMLButtonElement).click());
    expect(onAddPayment).toHaveBeenCalledTimes(permissionSet === "accounting" ? 1 : 2);
  }
});

test("unprivileged staff see selection feedback but no restricted action", async () => {
  const text = await render("member", [], 2);
  expect(text).toContain("2 selected");
  expect(text).toContain("No bulk actions available");
  expect(host.querySelectorAll("button")).toHaveLength(0);
  expect(await render("member", [], 0)).toBe("");
});
