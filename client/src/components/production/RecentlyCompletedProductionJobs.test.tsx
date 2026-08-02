import React from "react";
import { describe, expect, jest, test } from "@jest/globals";
import { TextDecoder, TextEncoder } from "util";

(globalThis as any).TextEncoder = TextEncoder;
(globalThis as any).TextDecoder = TextDecoder;

jest.mock("@/hooks/useProduction", () => ({
  useRecentlyCompletedProductionJobs: jest.fn(),
  useUndoCompleteProductionJob: jest.fn(),
  useRecoverLegacyProductionCompletion: jest.fn(),
  useReopenCompletedProductionRun: jest.fn(),
}));

const { MemoryRouter } = require("react-router-dom") as typeof import("react-router-dom");
const { RecentlyCompletedProductionJobs } = require("./RecentlyCompletedProductionJobs") as typeof import("./RecentlyCompletedProductionJobs");
const { useRecentlyCompletedProductionJobs, useUndoCompleteProductionJob, useRecoverLegacyProductionCompletion, useReopenCompletedProductionRun } = require("@/hooks/useProduction") as typeof import("@/hooks/useProduction");

const completedQuery = useRecentlyCompletedProductionJobs as jest.MockedFunction<typeof useRecentlyCompletedProductionJobs>;
const undoMutation = useUndoCompleteProductionJob as jest.MockedFunction<typeof useUndoCompleteProductionJob>;
const legacyRecoveryMutation = useRecoverLegacyProductionCompletion as jest.MockedFunction<typeof useRecoverLegacyProductionCompletion>;
const runRecoveryMutation = useReopenCompletedProductionRun as jest.MockedFunction<typeof useReopenCompletedProductionRun>;
const { renderToStaticMarkup } = require("react-dom/server") as typeof import("react-dom/server");

const completedJob = (overrides: Record<string, unknown> = {}) => ({
  id: "job-20009-a",
  orderId: "order-20009",
  lineItemId: "line-20009-a",
  orderNumber: "SO-20009",
  customerName: "Acme Signs",
  itemName: "Coroplast Yard Signs",
  productName: "Coroplast Yard Signs",
  lineItemSequence: 2,
  dimensions: "24 × 18",
  mediaName: "4mm Coroplast",
  totalQuantity: 6,
  artworkCount: 2,
  artworkQuantityMode: "one_each_per_file",
  artworkSummary: "Quantity 6 • 2 artwork files",
  allocationIssue: "Allocation expects 1 each across 2 artwork files, but the ordered quantity is 6.",
  artwork: [
    { id: "art-a", fileRecordId: "file-a", fileName: "design-a.pdf", mimeType: "application/pdf", thumbnailUrl: "/api/objects/art-a-thumb", previewUrl: "/api/objects/art-a-preview", previewStatus: "available", previewReason: null, side: "front", isPrimary: true, sourceKind: "line_item_artwork", allocatedQuantity: null },
    { id: "art-b", fileRecordId: "file-b", fileName: "design-b.pdf", mimeType: "application/pdf", thumbnailUrl: null, previewUrl: null, previewStatus: "pending", previewReason: "Preview has not been generated yet.", side: "back", isPrimary: false, sourceKind: "line_item_artwork", allocatedQuantity: null },
  ],
  stationKey: "flatbed",
  stationLabel: "Flatbed",
  previousStatus: "in_progress",
  previousStation: "flatbed",
  previousStationLabel: "Flatbed",
  restoreStatusLabel: "Flatbed • In Progress",
  completedAt: "2026-07-27T12:00:00.000Z",
  completedByUserId: "user-1",
  completedBy: "Production User",
  restoreUntil: "2026-07-28T12:00:00.000Z",
  restoredAt: null,
  restoreReason: null,
  undoAllowed: true,
  undoUnavailableReason: null,
  ...overrides,
});

function renderCompleted() {
  return renderToStaticMarkup(<MemoryRouter><RecentlyCompletedProductionJobs station="flatbed" /></MemoryRouter>);
}

describe("RecentlyCompletedProductionJobs", () => {
  test("defaults to seven days and shows exact artwork identity with a missing-preview placeholder", () => {
    completedQuery.mockReturnValue({ data: [completedJob()], isLoading: false, error: null } as any);
    undoMutation.mockReturnValue({ mutate: jest.fn(), isPending: false } as any);
    legacyRecoveryMutation.mockReturnValue({ mutate: jest.fn(), isPending: false } as any);
    runRecoveryMutation.mockReturnValue({ mutate: jest.fn(), isPending: false } as any);

    const html = renderCompleted();

    expect(completedQuery).toHaveBeenCalledWith({ station: "flatbed", range: "7d", search: "" });
    expect(html).toContain("Coroplast Yard Signs");
    expect(html).toContain("Item 2 • 24 × 18 • 4mm Coroplast");
    expect(html).toContain("design-a.pdf");
    expect(html).toContain("No preview");
    expect(html).toContain("Undo available");
    expect(html).toContain("Allocation expects 1 each");
  });

  test("keeps completed records visible when Undo is unavailable", () => {
    completedQuery.mockReturnValue({ data: [completedJob({ undoAllowed: false, undoUnavailableReason: "Undo is no longer available for this completed job." })], isLoading: false, error: null } as any);
    undoMutation.mockReturnValue({ mutate: jest.fn(), isPending: false } as any);
    legacyRecoveryMutation.mockReturnValue({ mutate: jest.fn(), isPending: false } as any);
    runRecoveryMutation.mockReturnValue({ mutate: jest.fn(), isPending: false } as any);

    const html = renderCompleted();

    expect(html).toContain("Recovery unavailable");
    expect(html).toContain("Undo is no longer available for this completed job.");
    expect(html).toContain("design-b.pdf");
  });

  test("replaces a dead Undo control with the appropriate legacy recovery action", () => {
    completedQuery.mockReturnValue({ data: [completedJob({ undoAllowed: false, productionRunId: "run-1", productionRunDisplayNumber: "PR-0001", productionRunStatus: "completed", legacyRecoveryAction: "reopen_combined_run" })], isLoading: false, error: null } as any);
    undoMutation.mockReturnValue({ mutate: jest.fn(), isPending: false } as any);
    legacyRecoveryMutation.mockReturnValue({ mutate: jest.fn(), isPending: false } as any);
    runRecoveryMutation.mockReturnValue({ mutate: jest.fn(), isPending: false } as any);
    const html = renderCompleted();
    expect(html).toContain("Part of Combined Run PR-0001");
    expect(html).toContain("Reopen Combined Run");
  });
});
