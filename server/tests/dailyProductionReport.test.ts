import {
  buildDailyProductionReport,
  getDailyProductionDueState,
  sortDailyProductionRows,
} from "@shared/dailyProductionReportProjection";

const base = {
  orderId: "order-1",
  orderNumber: "1001",
  displayNumber: null,
  jobNumber: null,
  label: null,
  poNumber: null,
  customerName: "Acme Signs",
  dueDate: "2026-09-14T12:00:00.000Z",
  shippingMethod: "ship",
  lineItemId: "line-1",
  quantity: 3,
  productionBypassed: false,
  isService: false,
  workflowIntent: "standard_production",
  defaultStationKey: "roll",
  jobStationKey: null,
};

function report(rows: any[], asOf = "2026-09-14") {
  return buildDailyProductionReport({ organizationName: "Titan Graphics", asOf, timezone: "America/Indiana/Indianapolis", rows });
}

describe("Daily Production List projection", () => {
  test("1. counts each qualifying order once in the summary", () => expect(report([base, { ...base, lineItemId: "line-2", quantity: 2 }]).summary.open).toBe(1));
  test("2. classifies overdue dates", () => expect(getDailyProductionDueState("2026-09-13", "2026-09-14")).toBe("overdue"));
  test("3. classifies due-today dates", () => expect(getDailyProductionDueState("2026-09-14", "2026-09-14")).toBe("today"));
  test("4. classifies due-tomorrow dates", () => expect(getDailyProductionDueState("2026-09-15", "2026-09-14")).toBe("tomorrow"));
  test("5. classifies future dates", () => expect(getDailyProductionDueState("2026-09-16", "2026-09-14")).toBe("future"));
  test("6. retains no-due-date orders", () => expect(report([{ ...base, dueDate: null }]).summary.noDueDate).toBe(1));
  test("7. totals only relevant production quantities", () => expect(report([{ ...base, quantity: 5 }, { ...base, lineItemId: "fee", quantity: 99, isService: true }]).overview[0].quantity).toBe(5));
  test("8. excludes fulfillment-only lines from production quantity", () => expect(report([{ ...base, workflowIntent: "fulfillment_only", quantity: 7 }]).overview[0].quantity).toBe(0));
  test("9. excludes service-fee lines from production quantity", () => expect(report([{ ...base, workflowIntent: "service_fee", quantity: 7 }]).overview[0].quantity).toBe(0));
  test("10. excludes explicitly bypassed lines from production quantity", () => expect(report([{ ...base, productionBypassed: true, quantity: 7 }]).overview[0].quantity).toBe(0));
  test("11. uses a canonical production-job Roll route", () => expect(report([{ ...base, jobStationKey: "wide-roll", defaultStationKey: "flatbed" }]).overview[0].destination).toBe("roll"));
  test("12. uses a canonical product-type Flatbed fallback", () => expect(report([{ ...base, defaultStationKey: "flat_bed" }]).overview[0].destination).toBe("flatbed"));
  test("13. does not guess an unknown routing value", () => {
    const result = report([{ ...base, defaultStationKey: "large_sign_printer" }]);
    expect(result.overview[0].destination).toBe("unclassified");
    expect(result.diagnostics.unclassifiedProductionLines).toBe(1);
  });
  test("14. shows mixed orders once in overview", () => {
    const result = report([{ ...base, jobStationKey: "roll" }, { ...base, lineItemId: "line-2", quantity: 4, jobStationKey: "flatbed" }]);
    expect(result.overview).toHaveLength(1); expect(result.overview[0].destination).toBe("mixed");
  });
  test("15. includes mixed orders in both production sections", () => {
    const result = report([{ ...base, jobStationKey: "roll" }, { ...base, lineItemId: "line-2", quantity: 4, jobStationKey: "flatbed" }]);
    expect(result.roll[0].quantity).toBe(3); expect(result.flatbed[0].quantity).toBe(4);
  });
  test("16. avoids double-counting a line with duplicate station jobs", () => expect(report([{ ...base, jobStationKey: "roll" }, { ...base, jobStationKey: "roll" }]).roll[0].quantity).toBe(3));
  test("17. maps canonical fulfillment labels", () => expect(report([{ ...base, shippingMethod: "pickup" }]).overview[0].fulfillment).toBe("Pickup"));
  test("18. safely neutralizes unexpected fulfillment values", () => expect(report([{ ...base, shippingMethod: "courier_pigeon" }]).overview[0].fulfillment).toBe("Unknown"));
  test("19. preserves job labels and PO numbers", () => {
    const row = report([{ ...base, label: "Lobby graphics", poNumber: "PO-42" }]).overview[0];
    expect(row.jobLabel).toBe("Lobby graphics"); expect(row.poNumber).toBe("PO-42");
  });
  test("20. sorts urgency, due dates, then order number deterministically", () => {
    const sorted = sortDailyProductionRows([
      { ...report([base]).overview[0], orderNumber: "20", dueDate: null, dueState: "none" },
      { ...report([base]).overview[0], orderNumber: "10", dueDate: "2026-09-13", dueState: "overdue" },
      { ...report([base]).overview[0], orderNumber: "2", dueDate: "2026-09-13", dueState: "overdue" },
    ]);
    expect(sorted.map((row) => row.orderNumber)).toEqual(["2", "10", "20"]);
  });
});
