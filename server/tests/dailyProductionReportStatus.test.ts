import { qualifiesForDailyProductionReport } from "../services/dailyProductionReportStatus";
import { buildDailyProductionReport } from "@shared/dailyProductionReportProjection";

const status = (input: Partial<Parameters<typeof qualifiesForDailyProductionReport>[0]>) => qualifiesForDailyProductionReport({
  statusPillId: null,
  statusPillKey: null,
  statusPillValue: null,
  status: null,
  ...input,
});

describe("Daily Production Report current status qualification", () => {
  test("includes the current New and In Production pill keys", () => {
    expect(status({ statusPillId: "new-pill", statusPillKey: "new" })).toBe(true);
    expect(status({ statusPillId: "production-pill", statusPillKey: "in_production" })).toBe(true);
  });

  test("never lets a legacy status override an explicit Complete pill", () => {
    expect(status({ statusPillId: "complete-pill", statusPillKey: "complete", statusPillValue: "Complete", status: "in_production" })).toBe(false);
  });

  test("excludes an explicit Complete pill even when lifecycle state remains open", () => {
    expect(status({ statusPillId: "complete-pill", statusPillKey: "complete", state: "open", status: "new" })).toBe(false);
  });

  test("keeps an explicit New pill authoritative over a completed legacy status", () => {
    expect(status({ statusPillId: "new-pill", statusPillKey: "new", status: "completed" })).toBe(true);
  });

  test("uses only recognized no-ID pill labels as a narrow fallback", () => {
    expect(status({ statusPillValue: " New " })).toBe(true);
    expect(status({ statusPillValue: "In-Production" })).toBe(true);
    expect(status({ statusPillValue: "Complete", status: "in_production" })).toBe(false);
  });

  test("uses deprecated status only when there is no pill identity or value", () => {
    expect(status({ status: "new" })).toBe(true);
    expect(status({ status: "in_production" })).toBe(true);
    expect(status({ status: "completed" })).toBe(false);
    expect(status({ status: "complete" })).toBe(false);
  });

  test("feeds summaries and both production breakdowns from the same qualified population", () => {
    const sourceRows = [
      { orderId: "new", statusPillId: "new-pill", statusPillKey: "new", statusPillValue: "New", status: "completed", dueDate: "2026-09-14", station: "roll" },
      { orderId: "production", statusPillId: "production-pill", statusPillKey: "in_production", statusPillValue: "In Production", status: "new", dueDate: null, station: "flatbed" },
      { orderId: "complete", statusPillId: "complete-pill", statusPillKey: "complete", statusPillValue: "Complete", status: "in_production", dueDate: "2026-09-13", station: "roll" },
    ].filter(status);

    const report = buildDailyProductionReport({
      organizationName: "Titan Graphics",
      asOf: "2026-09-14",
      timezone: "America/Indiana/Indianapolis",
      rows: sourceRows.map((row) => ({
        orderId: row.orderId,
        orderNumber: row.orderId,
        displayNumber: null,
        jobNumber: null,
        label: null,
        poNumber: null,
        customerName: "Acme",
        dueDate: row.dueDate,
        shippingMethod: "ship",
        lineItemId: `${row.orderId}-line`,
        quantity: 1,
        productionBypassed: false,
        isService: false,
        workflowIntent: "standard_production",
        defaultStationKey: row.station,
        jobStationKey: null,
      })),
    });

    expect(report.summary).toMatchObject({ open: 2, dueToday: 1, overdue: 0, noDueDate: 1 });
    expect(report.overview.map((row) => row.orderId).sort()).toEqual(["new", "production"]);
    expect(report.roll.map((row) => row.orderId)).toEqual(["new"]);
    expect(report.flatbed.map((row) => row.orderId)).toEqual(["production"]);
  });
});
