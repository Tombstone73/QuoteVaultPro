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
    const travelerSource = readFileSync(
      path.join(process.cwd(), "server/services/orderTravelerSourceService.ts"),
      "utf8",
    );

    expect(travelerRouteStart).toBeGreaterThan(-1);
    expect(travelerRouteEnd).toBeGreaterThan(travelerRouteStart);
    expect(travelerRoute).toContain("getOrderTravelerSource(organizationId, orderId)");
    expect(travelerSource).toContain("poNumber: orders.poNumber");
    expect(travelerSource).toContain("jobLabel: orders.label");
    expect(travelerSource).toContain("poNumber: order.poNumber ?? null");
    expect(travelerSource).toContain("jobLabel: order.jobLabel ?? null");
  });
});
