import { describe, expect, it } from "@jest/globals";
import { readFile } from "node:fs/promises";
import path from "node:path";

async function source(file: string) {
  return readFile(path.resolve(process.cwd(), file), "utf8");
}

describe("Order mutation UI contract", () => {
  it("uses the shared Order update mutation for customer and contact changes", async () => {
    const [orderDetail, orderHooks] = await Promise.all([
      source("client/src/pages/order-detail.tsx"),
      source("client/src/hooks/useOrders.ts"),
    ]);

    expect(orderDetail).toContain("const saveOrderOwner");
    expect(orderDetail).toContain("updateOrder.mutate(changes");
    expect(orderDetail).not.toContain("changeCustomerMutation");
    expect(orderHooks).toContain("orderDetailQueryKey(orderId)");
    expect(orderHooks).toContain("invalidateOrderOperationalQueries(queryClient, orderId)");
  });

  it("keeps customer navigation and inspection separate from changing the customer", async () => {
    const orderDetail = await source("client/src/pages/order-detail.tsx");

    expect(orderDetail).toContain("to={`/customers/${order.customer.id}`}");
    expect(orderDetail).toContain("state={{ referrer: buildReferrer(location) }}");
    expect(orderDetail).toContain("aria-label=\"Change customer\"");
    expect(orderDetail).toContain("formatCustomerPaymentTerms(order.customer.paymentTerms)");
    expect(orderDetail).toContain('order.customer.isTaxExempt ? "Exempt" : "Taxable"');
  });

  it("offers direct customer-scoped contact selection without staging an order edit", async () => {
    const orderDetail = await source("client/src/pages/order-detail.tsx");

    expect(orderDetail).toContain('aria-label="Select order contact"');
    expect(orderDetail).toContain("disabled={!canEditSafeOrderMetadata || !order?.customerId || updateOrder.isPending}");
    expect(orderDetail).toContain("onSelect={() => saveOrderOwner({ contactId: contact.id })}");
    expect(orderDetail).toContain("onSelect={() => saveOrderOwner({ contactId: null })}");
    expect(orderDetail).toContain("Unable to load contacts. Retry");
    expect(orderDetail).toContain("to={`/contacts/${order.contact.id}`}");
    expect(orderDetail).not.toContain("isEditingContact");
    expect(orderDetail).not.toContain("enterContactEdit");
  });

  it("keeps notes and safe metadata available after completion without unlocking commercial controls", async () => {
    const orderDetail = await source("client/src/pages/order-detail.tsx");

    expect(orderDetail).toContain("const canEditSafeOrderMetadata = Boolean(order && !orderIsCanceled);");
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
