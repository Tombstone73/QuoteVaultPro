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

  it("does not misreport a completed deletion when only the post-mutation refresh fails", async () => {
    const section = await source("client/src/components/orders/OrderLineItemsSection.tsx");

    expect(section).toContain("let deleted = false");
    expect(section).toContain("if (deleted) return;");
    expect(section).toContain("The change was saved, but the Order could not be refreshed");
  });
});
