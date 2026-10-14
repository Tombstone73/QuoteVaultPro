import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, jest, test } from "@jest/globals";
import { OrderCreateActions } from "./OrderCreateActions";
import { OrderEntryWorkspace } from "./OrderEntryWorkspace";

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

test("New Order actions follow both utility cards without a duplicate total or sticky position", () => {
  const onSave = jest.fn();
  const onDiscard = jest.fn();
  act(() => root.render(
    <OrderEntryWorkspace
      identity={<section data-testid="identity">Customer</section>}
      lineItems={<div>Line Items</div>}
      summary={<div>Grand Total $4.40</div>}
      fulfillment={<div>Fulfillment</div>}
      actions={<>
        <label htmlFor="route">After creating the order</label>
        <select id="route"><option>Keep line items on Order</option></select>
        <OrderCreateActions inline canSaveQuote isSaving={false} onSave={onSave} onDiscard={onDiscard} />
      </>}
    />,
  ));

  const workspace = host.querySelector('[data-testid="order-entry-workspace"]')!;
  expect(Array.from(workspace.children).map((child) => child.getAttribute("data-testid") || child.getAttribute("aria-label"))).toEqual([
    "identity", "Order line items", "order-utilities", "order-create-actions",
  ]);
  const actions = host.querySelector('[data-testid="order-create-actions"]')!;
  expect(actions.className).not.toContain("sticky");
  expect(actions.textContent).toContain("After creating the order");
  expect(actions.textContent).toContain("Create Order");
  expect(actions.textContent).toContain("Discard draft");
  expect(actions.textContent).not.toContain("Order Total");
  expect(host.querySelector('[aria-label="Order totals"]')?.textContent).toContain("Grand Total $4.40");
  act(() => {
    (actions.querySelectorAll("button")[0] as HTMLButtonElement).click();
    (actions.querySelectorAll("button")[1] as HTMLButtonElement).click();
  });
  expect(onSave).toHaveBeenCalledTimes(1);
  expect(onDiscard).toHaveBeenCalledTimes(1);
});
