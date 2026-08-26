import { describe, expect, test } from "@jest/globals";
import { readFileSync } from "node:fs";
import path from "node:path";

const orderRoutesSource = () => readFileSync(
  path.join(process.cwd(), "server/routes/orders.routes.ts"),
  "utf8",
);

describe("order traveler identification projection", () => {
  test("projects canonical order PO and job label into the traveler payload", () => {
    const source = orderRoutesSource();
    const travelerRouteStart = source.indexOf('app.get("/api/orders/:orderId/traveler"');
    const travelerRouteEnd = source.indexOf('app.post("/api/orders/:orderId/traveler-print"');
    const travelerRoute = source.slice(travelerRouteStart, travelerRouteEnd);

    expect(travelerRouteStart).toBeGreaterThan(-1);
    expect(travelerRouteEnd).toBeGreaterThan(travelerRouteStart);
    expect(travelerRoute).toContain("poNumber: orders.poNumber");
    expect(travelerRoute).toContain("jobLabel: orders.label");
    expect(travelerRoute).toContain("poNumber: order.poNumber ?? null");
    expect(travelerRoute).toContain("jobLabel: order.jobLabel ?? null");
  });
});
