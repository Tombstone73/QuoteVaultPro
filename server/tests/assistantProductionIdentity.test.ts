import { describe, expect, test } from "@jest/globals";
import { normalizeAssistantProductionJobRows } from "../storage/assistantProductionReporting.repo";

const baseRow = {
  jobId: "job-1",
  orderId: "order-1",
  orderNumber: "ORD-20002",
  fallbackOrderNumber: null,
  customerName: "T3 Signs",
  lineItemId: "line-1",
  lineItemSequence: 1,
  lineItemDescription: "ACM sign · 96 × 48",
  orderedQuantity: 2,
  stationKey: "flatbed",
  stepKey: "print",
  status: "queued",
  dueDate: "2026-07-16T12:00:00.000Z",
  createdAt: "2026-07-10T12:00:00.000Z",
  updatedAt: "2026-07-10T12:00:00.000Z",
};

describe("assistant production job identity normalization", () => {
  test("deduplicates only a repeated canonical production job caused by enrichment fan-out", () => {
    const rows = normalizeAssistantProductionJobRows([
      baseRow,
      { ...baseRow, lineItemDescription: "ACM sign · 96 × 48 (option join duplicate)" },
    ]);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ jobId: "job-1", lineItemId: "line-1", lineItemSequence: 1 });
  });

  test("does not merge distinct jobs or line items sharing an order, product label, and station", () => {
    const rows = normalizeAssistantProductionJobRows([
      baseRow,
      { ...baseRow, jobId: "job-2", lineItemId: "line-2", lineItemSequence: 2, orderedQuantity: 4 },
      { ...baseRow, jobId: "job-3", lineItemId: "line-1", lineItemSequence: 1, stepKey: "finish" },
    ]);

    expect(rows.map((row) => row.jobId)).toEqual(["job-1", "job-2", "job-3"]);
    expect(rows.map((row) => row.lineItemId)).toEqual(["line-1", "line-2", "line-1"]);
  });

  test("retains only the authoritative ordered quantity and labels print progress as unavailable", () => {
    const [row] = normalizeAssistantProductionJobRows([baseRow]);

    expect(row).toMatchObject({
      orderedQuantity: 2,
      productionRequiredQuantity: null,
      completedQuantity: null,
      remainingQuantity: null,
      quantityUnit: null,
      progressAvailable: false,
      progressSource: "unavailable",
    });
    expect(row.progressWarning).toMatch(/do not store authoritative quantity progress/i);
  });

  test("uses the persisted order-line description rather than product metadata", () => {
    const [row] = normalizeAssistantProductionJobRows([{ ...baseRow, lineItemDescription: "Sold snapshot · 48 × 24" }]);
    expect(row.lineItemLabel).toBe("Sold snapshot · 48 × 24");
    expect(row.label).toBe("Sold snapshot · 48 × 24");
  });
});
