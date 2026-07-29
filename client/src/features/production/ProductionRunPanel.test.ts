import { productionRunToBoardItem } from "@/lib/productionRuns";
import type { ProductionRunListItem } from "@/hooks/useProduction";

describe("productionRunToBoardItem", () => {
  test("maps a combined production run into the existing board shape", () => {
    const run: ProductionRunListItem = {
      kind: "production_run",
      id: "run-1",
      runId: "run-1",
      runNumber: 12,
      displayNumber: "PR-0012",
      orderId: "order-1",
      orderNumber: "20004",
      customerId: "customer-1",
      customerName: "Acme Signs",
      stationKey: "flatbed",
      status: "queued",
      runStatus: "draft",
      plannedSheetCount: 12,
      nominalPiecesPerSheet: 6,
      sheetWidth: "48.00",
      sheetHeight: "96.00",
      notes: "Nested together",
      memberCount: 2,
      totalAllocatedQuantity: 72,
      fileCount: 1,
      members: [
        {
          id: "member-1",
          productionJobId: "job-1",
          orderLineItemId: "line-1",
          lineNumber: 1,
          description: "Yard sign",
          orderedQuantity: 40,
          allocatedQuantity: 40,
          completedQuantity: 0,
          previouslyCompletedQuantity: 0,
          remainingAfterRun: 0,
        },
        {
          id: "member-2",
          productionJobId: "job-2",
          orderLineItemId: "line-2",
          lineNumber: 2,
          description: "Window decal",
          orderedQuantity: 32,
          allocatedQuantity: 32,
          completedQuantity: 0,
          previouslyCompletedQuantity: 0,
          remainingAfterRun: 0,
        },
      ],
      createdAt: "2026-07-29T00:00:00.000Z",
      updatedAt: "2026-07-29T00:00:00.000Z",
    };

    const boardItem = productionRunToBoardItem(run);

    expect(boardItem.kind).toBe("production_run");
    expect(boardItem.jobDescription).toBe("PR-0012 combined production run");
    expect(boardItem.qty).toBe(72);
    expect(boardItem.order.lineItems.count).toBe(2);
    expect(boardItem.order.lineItems.items).toHaveLength(2);
    expect(boardItem.media).toBe("2 line items");
  });
});
