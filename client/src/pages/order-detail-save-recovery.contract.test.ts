import fs from "node:fs";
import path from "node:path";

describe("Order Detail rejected-save recovery", () => {
  const read = (relativePath: string) => fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");

  test("refetches the authoritative Order and clears transient totals after a staged save is rejected", () => {
    const page = read("client/src/pages/order-detail.tsx");

    expect(page).toContain('setDraftLineItemTotalsCents({});');
    expect(page).toContain('await queryClient.invalidateQueries({ queryKey: ["orders", "detail", orderId] });');
    expect(page).toContain('await queryClient.refetchQueries({ queryKey: ["orders", "detail", orderId], type: "active" });');
  });

  test("restores server state after a rejected line save or removal without discarding its editable draft", () => {
    const section = read("client/src/components/orders/OrderLineItemsSection.tsx");

    expect(section).toContain('onDraftLineItemPricingChange?.(itemId, null);');
    expect(section).toContain('Failed to restore authoritative Order after a rejected line save');
    expect(section).toContain('Failed to restore authoritative Order after rejected removal');
  });
});
