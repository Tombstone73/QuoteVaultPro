import fs from "node:fs";
import path from "node:path";

const service = fs.readFileSync(path.join(process.cwd(), "server/services/portal.service.ts"), "utf8");

describe("portal job context projection", () => {
  test("uses canonical quote/order labels and PO fields without adding a quote PO model", () => {
    expect(service).toContain("jobLabel: order.label?.trim() || null");
    expect(service).toContain("jobLabel: quote.label?.trim() || null");
    expect(service).toContain("customerPoNumber: order.poNumber ?? null");
    expect(service).toContain("loadConvertedQuotePurchaseOrders");
  });

  test("scopes converted-order PO resolution to the authenticated tenant and customer", () => {
    const helperStart = service.indexOf("async function loadConvertedQuotePurchaseOrders");
    const helperEnd = service.indexOf("\nasync function", helperStart + 1);
    const helper = service.slice(helperStart, helperEnd);

    expect(helper).toContain("eq(orders.organizationId, scope.organizationId)");
    expect(helper).toContain("eq(orders.customerId, scope.customerId)");
    expect(helper).toContain("inArray(orders.id, convertedOrderIds)");
  });
});
