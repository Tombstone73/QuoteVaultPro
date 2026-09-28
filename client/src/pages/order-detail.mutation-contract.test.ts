import { describe, expect, it } from "@jest/globals";
import { readFile } from "node:fs/promises";
import path from "node:path";

async function source(file: string) {
  return readFile(path.resolve(process.cwd(), file), "utf8");
}

describe("Order mutation UI contract", () => {
  // Ownership save/query behavior is exercised on the real page in
  // order-detail.cancel-action.render.test.tsx with a real picker QueryClient.

  it("keeps customer navigation and inspection separate from changing the customer", async () => {
    const orderDetail = await source("client/src/pages/order-detail.tsx");

    expect(orderDetail).toContain("to={`/customers/${order.customer.id}`}");
    expect(orderDetail).toContain("state={{ referrer: buildReferrer(location) }}");
    expect(orderDetail).toContain("aria-label=\"Change customer\"");
    expect(orderDetail).toContain("formatCustomerPaymentTerms(order.customer.paymentTerms)");
    expect(orderDetail).toContain('order.customer.isTaxExempt ? "Exempt" : "Taxable"');
  });

  it("keeps notes and safe metadata available after completion without unlocking commercial controls", async () => {
    const orderDetail = await source("client/src/pages/order-detail.tsx");

    expect(orderDetail).toContain("const canEditSafeOrderMetadata = Boolean(order);");
    expect(orderDetail).toContain("const canAppendOrderInternalNote = Boolean(order);");
    expect(orderDetail).toContain("{canAppendOrderInternalNote && !isAddingOrderInternalNote ? (");
    expect(orderDetail).toContain("disabled={!canEditSafeOrderMetadata || updateOrder.isPending}");
    expect(orderDetail).toContain("{isOrderEditRoute && orderIsCanceled && (");
  });

  it("does not misreport a completed deletion when only the post-mutation refresh fails", async () => {
    const section = await source("client/src/components/orders/OrderLineItemsSection.tsx");

    expect(section).toContain("let deleted = false");
    expect(section).toContain("if (deleted) return;");
    expect(section).toContain("The change was saved, but the Order could not be refreshed");
  });
});
