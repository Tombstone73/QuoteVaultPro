import fs from "node:fs";
import path from "node:path";

describe("Order Detail rejected-save recovery", () => {
  const read = (relativePath: string) => fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");

  test("refetches the authoritative Order and clears transient totals after a staged save is rejected", () => {
    const page = read("client/src/pages/order-detail.tsx");

    expect(page).toContain('setDraftLineItemTotalsCents({});');
    expect(page).toContain('await queryClient.invalidateQueries({ queryKey: ["orders", "detail", orderId] });');
    expect(page).toContain('await queryClient.refetchQueries({ queryKey: ["orders", "detail", orderId], type: "active" });');
    expect(page).not.toContain('body: JSON.stringify({ subtotal: subtotal.toFixed(2), total: total.toFixed(2) })');
  });

  test("restores server state after a rejected line save or removal without discarding its editable draft", () => {
    const section = read("client/src/components/orders/OrderLineItemsSection.tsx");

    expect(section).toContain('onDraftLineItemPricingChange?.(itemId, null);');
    expect(section).toContain('Failed to restore authoritative Order after a rejected line save');
    expect(section).toContain('Failed to restore authoritative Order after rejected removal');
  });

  test("projects legacy fulfillment methods canonically and never stages a visually unchanged method", () => {
    const page = read("client/src/pages/order-detail.tsx");

    expect(page).toContain('effectiveOrderFulfillmentMethod(order?.shippingMethod)');
    expect(page).toContain('!fulfillmentMethodSemanticallyChanged(persistedShippingMethod, value)');
    expect(page).toContain('const { shippingMethod: _ignored, ...withoutMethod } = previous;');
  });
});
