import { readFileSync } from "node:fs";

const source = readFileSync("client/src/components/orders/OrderNumberLink.tsx", "utf8");

describe("OrderNumberLink contract", () => {
  it("constructs Order Detail navigation exclusively from the stable Order ID", () => {
    expect(source).toContain("to={`/orders/${orderId}`}");
    expect(source).not.toContain("to={`/orders/${orderNumber}`}");
    expect(source).toContain("event.stopPropagation()");
  });

  it("renders a safe empty state instead of a broken link without an Order", () => {
    expect(source).toContain("if (!orderId || !displayNumber)");
    expect(source).toContain('displayNumber || "—"');
  });
});
