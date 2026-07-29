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
      replacementRequired: false,
      files: [
        {
          id: "file-1",
          productionRunId: "run-1",
          lineItemId: "line-1",
          fileRecordId: "record-1",
          fileName: "nested-final.pdf",
          originalFilename: "nested-final.pdf",
          role: "final",
          status: "active",
          tag: "nested_run",
          mimeType: "application/pdf",
          sizeBytes: 1200,
          thumbnailUrl: null,
          previewUrl: null,
          downloadUrl: "/api/production/runs/run-1/files/file-1/download",
          openUrl: "/api/production/runs/run-1/files/file-1/download?inline=1",
          uploadedByUserId: "user-1",
          uploadedByName: "Prepress User",
          createdAt: "2026-07-29T00:00:00.000Z",
          localBridge: { status: "pending", unsafeToRetire: false, jobCount: 1, lastError: null, updatedAt: "2026-07-29T00:00:00.000Z" },
          supersedesFileId: null,
        },
      ],
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
    expect(boardItem.productionFiles).toHaveLength(1);
    expect(boardItem.order.productionFiles[0].fileName).toBe("nested-final.pdf");
  });
});
