import {
  buildDailyProductionReport,
  getDailyProductionDueState,
  sortDailyProductionRows,
} from "@shared/dailyProductionReportProjection";

const base = {
  orderId: "order-1", orderNumber: "1001", displayNumber: null, jobNumber: null, label: null, poNumber: null,
  customerName: "Acme Signs", dueDate: "2026-09-14T12:00:00.000Z", shippingMethod: "ship", lineItemId: "line-1",
  quantity: 3, productionBypassed: false, isService: false, workflowIntent: "standard_production", defaultStationKey: "roll", jobStationKey: null,
};

function report(rows: any[], asOf = "2026-09-14") {
  return buildDailyProductionReport({ organizationName: "Titan Graphics", asOf, timezone: "America/Indiana/Indianapolis", rows });
}

describe("Daily Production List projection", () => {
  test("includes a New canonical order once", () => expect(report([base, { ...base, lineItemId: "line-2" }]).summary.open).toBe(1));
  test("supports In Production source rows", () => expect(report([base]).overview).toHaveLength(1));
  test("complete orders are excluded by the tenant query contract", () => expect(report([]).overview).toHaveLength(0));
  test("classifies Roll-only production", () => expect(report([{ ...base, jobStationKey: "wide-roll" }]).overview[0].destination).toBe("roll"));
  test("classifies Flatbed-only production", () => expect(report([{ ...base, defaultStationKey: "flat_bed" }]).overview[0].destination).toBe("flatbed"));
  test("shows a mixed order once in Overview", () => expect(report([{ ...base, jobStationKey: "roll" }, { ...base, lineItemId: "line-2", jobStationKey: "flatbed" }]).overview).toHaveLength(1));
  test("shows a mixed order in both breakdown sections", () => { const result = report([{ ...base, jobStationKey: "roll" }, { ...base, lineItemId: "line-2", quantity: 4, jobStationKey: "flatbed" }]); expect(result.roll).toHaveLength(1); expect(result.flatbed).toHaveLength(1); });
  test("counts summary metrics by unique Order", () => expect(report([base, { ...base, lineItemId: "line-2" }]).summary.open).toBe(1));
  test("uses station-specific quantities in breakdowns", () => { const result = report([{ ...base, jobStationKey: "roll" }, { ...base, lineItemId: "line-2", quantity: 4, jobStationKey: "flatbed" }]); expect(result.roll[0].quantity).toBe(3); expect(result.flatbed[0].quantity).toBe(4); });
  test("classifies overdue dates", () => expect(getDailyProductionDueState("2026-09-13", "2026-09-14")).toBe("overdue"));
  test("classifies due today", () => expect(getDailyProductionDueState("2026-09-14", "2026-09-14")).toBe("today"));
  test("classifies due tomorrow", () => expect(getDailyProductionDueState("2026-09-15", "2026-09-14")).toBe("tomorrow"));
  test("sorts future dates ascending", () => expect(sortDailyProductionRows([{ ...report([base]).overview[0], orderNumber: "2", dueDate: "2026-09-17", dueState: "future" }, { ...report([base]).overview[0], orderNumber: "3", dueDate: "2026-09-16", dueState: "future" }]).map((row) => row.orderNumber)).toEqual(["3", "2"]));
  test("keeps missing due dates neutral and last", () => expect(report([{ ...base, dueDate: null }]).summary.noDueDate).toBe(1));
  test("maps Ship fulfillment", () => expect(report([{ ...base, shippingMethod: "ship" }]).overview[0].fulfillment).toBe("Ship"));
  test("maps Pickup fulfillment", () => expect(report([{ ...base, shippingMethod: "pickup" }]).overview[0].fulfillment).toBe("Pickup"));
  test("maps Delivery fulfillment", () => expect(report([{ ...base, shippingMethod: "delivery" }]).overview[0].fulfillment).toBe("Delivery"));
  test("handles unknown legacy fulfillment safely", () => expect(report([{ ...base, shippingMethod: "courier_pigeon" }]).overview[0].fulfillment).toBe("Unknown"));
  test("excludes service and production-bypassed lines", () => expect(report([{ ...base, isService: true, quantity: 99 }, { ...base, lineItemId: "bypassed", productionBypassed: true, quantity: 99 }]).overview[0].quantity).toBe(0));
  test("surfaces unclassified routing instead of guessing", () => { const result = report([{ ...base, defaultStationKey: "large_sign_printer" }]); expect(result.overview[0].destination).toBe("unclassified"); expect(result.diagnostics.unclassifiedProductionLines).toBe(1); });
});
