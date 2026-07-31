import { canSelectPrepressCombinedRunItem, getPrepressCombinedRunItemBlocker, validatePrepressCombinedRunSelection, type PrepressCombinedRunItem } from "./prepressCombinedRuns";

const baseItem = (overrides: Partial<PrepressCombinedRunItem> = {}): PrepressCombinedRunItem => ({
  lineItemId: "line-1",
  orderId: "order-1",
  productName: "Panel A",
  activeOwnerJobId: "prepress-job-1",
  selectedProductionDestination: "flatbed",
  materialId: "mat-1",
  materialName: "Foam Board",
  finalFileCount: 1,
  quantity: 10,
  status: "active",
  workflowState: "in_prepress",
  ...overrides,
});

describe("prepress combined run selection", () => {
  test("allows same-order prepress-owned items with valid allocations", () => {
    const result = validatePrepressCombinedRunSelection(
      [
        baseItem(),
        baseItem({ lineItemId: "line-2", productName: "Panel B", activeOwnerJobId: "prepress-job-2", quantity: 6 }),
      ],
      { "line-1": "5", "line-2": "6" },
      "",
    );

    expect(result).toMatchObject({
      canCreate: true,
      orderId: "order-1",
      stationKey: "flatbed",
      hasStationConflict: false,
      hasMaterialConflict: false,
      totalAllocatedQuantity: 11,
    });
  });

  test("allows compatible mixed-order selection", () => {
    const result = validatePrepressCombinedRunSelection(
      [baseItem(), baseItem({ lineItemId: "line-2", orderId: "order-2", activeOwnerJobId: "prepress-job-2" })],
      {},
      "",
    );

    expect(result.canCreate).toBe(true);
    expect(result.orderId).toBeNull();
    expect(result.orderIds).toEqual(["order-1", "order-2"]);
  });

  test("requires allocations within remaining quantity", () => {
    const result = validatePrepressCombinedRunSelection(
      [baseItem(), baseItem({ lineItemId: "line-2", activeOwnerJobId: "prepress-job-2", quantity: 3 })],
      { "line-1": "11", "line-2": "3" },
      "",
    );

    expect(result.canCreate).toBe(false);
    expect(result.reason).toContain("between 1 and 10");
  });

  test("requires override reason for mixed destination or material", () => {
    const items = [
      baseItem(),
      baseItem({ lineItemId: "line-2", activeOwnerJobId: "prepress-job-2", selectedProductionDestination: "roll", materialId: "mat-2" }),
    ];

    expect(validatePrepressCombinedRunSelection(items, {}, "").canCreate).toBe(false);
    expect(validatePrepressCombinedRunSelection(items, {}, "Approved nested same-order run").canCreate).toBe(true);
  });

  test("blocks non-production and proof-blocked selections", () => {
    expect(validatePrepressCombinedRunSelection([
      baseItem({ activeOwnerJobId: null }),
      baseItem({ lineItemId: "line-2", activeOwnerJobId: "prepress-job-2" }),
    ], {}, "").reason).toBe("Selected items must have an active Prepress production job.");

    expect(validatePrepressCombinedRunSelection([
      baseItem({ productionReleaseBlockedReason: "Cannot release to production until proof approved" }),
      baseItem({ lineItemId: "line-2", activeOwnerJobId: "prepress-job-2" }),
    ], {}, "").reason).toBe("Cannot release to production until proof approved");
  });

  test("allows selection with missing production artwork but blocks final run creation", () => {
    const missingArtwork = baseItem({ finalFileCount: 0 });
    expect(canSelectPrepressCombinedRunItem(missingArtwork)).toBe(true);
    expect(getPrepressCombinedRunItemBlocker(missingArtwork)).toMatchObject({
      code: "resolvable_missing_production_artwork",
      resolvable: true,
    });

    const result = validatePrepressCombinedRunSelection(
      [
        missingArtwork,
        baseItem({ lineItemId: "line-2", activeOwnerJobId: "prepress-job-2" }),
      ],
      {},
      "",
    );

    expect(result.canCreate).toBe(false);
    expect(result.requiresArtworkResolution).toBe(true);
    expect(result.resolvableBlockers).toEqual([
      expect.objectContaining({ lineItemId: "line-1", code: "resolvable_missing_production_artwork" }),
    ]);
    expect(result.reason).toBe("1 selected job needs production artwork or a valid artwork allocation before the run can be created.");
  });

  test("keeps an allocation-incomplete final file selectable but blocks run creation until it is corrected", () => {
    const incompleteAllocation = baseItem({
      artworkProductionBreakdown: {
        source: "final_production",
        valid: false,
        issue: "Allocated 1 of 5. Assign 4 more before production.",
      },
    });

    expect(canSelectPrepressCombinedRunItem(incompleteAllocation)).toBe(true);
    expect(getPrepressCombinedRunItemBlocker(incompleteAllocation)).toMatchObject({
      code: "resolvable_production_artwork_allocation",
      resolvable: true,
    });
    expect(validatePrepressCombinedRunSelection([
      incompleteAllocation,
      baseItem({ lineItemId: "line-2", activeOwnerJobId: "prepress-job-2" }),
    ], {}, "").canCreate).toBe(false);
  });

  test("blocks final run creation when production artwork quantity is unresolved", () => {
    const unresolved = baseItem({
      artworkProductionBreakdown: {
        source: "final_production",
        productionArtStatus: "Production art",
        allocatedTotal: 0,
        requiredQuantity: 10,
        valid: false,
        issue: "Quantity allocation unresolved.",
      },
    });

    expect(canSelectPrepressCombinedRunItem(unresolved)).toBe(true);
    expect(getPrepressCombinedRunItemBlocker(unresolved)).toMatchObject({
      code: "resolvable_production_artwork_allocation",
      message: "Quantity allocation unresolved.",
      resolvable: true,
    });

    const result = validatePrepressCombinedRunSelection(
      [
        unresolved,
        baseItem({ lineItemId: "line-2", activeOwnerJobId: "prepress-job-2" }),
      ],
      {},
      "",
    );

    expect(result.canCreate).toBe(false);
    expect(result.requiresArtworkResolution).toBe(true);
    expect(result.resolvableBlockers).toEqual([
      expect.objectContaining({ lineItemId: "line-1", code: "resolvable_production_artwork_allocation" }),
    ]);
    expect(result.reason).toBe("1 selected job has unresolved production artwork quantities.");
  });

  test("does not report ready and unresolved for the same final artwork state", () => {
    const resolved = baseItem({
      artworkProductionBreakdown: {
        source: "final_production",
        productionArtStatus: "Production art",
        allocatedTotal: 10,
        requiredQuantity: 10,
        valid: true,
        issue: null,
      },
    });

    expect(getPrepressCombinedRunItemBlocker(resolved)).toBeNull();
    expect(validatePrepressCombinedRunSelection(
      [resolved, baseItem({ lineItemId: "line-2", activeOwnerJobId: "prepress-job-2" })],
      {},
      "",
    ).canCreate).toBe(true);
  });

  test("hard blockers remain non-selectable and stop run creation", () => {
    const blocked = baseItem({ activeOwnerJobId: null });
    expect(canSelectPrepressCombinedRunItem(blocked)).toBe(false);
    expect(getPrepressCombinedRunItemBlocker(blocked)).toMatchObject({
      code: "hard_missing_prepress_job",
      resolvable: false,
    });

    const result = validatePrepressCombinedRunSelection(
      [blocked, baseItem({ lineItemId: "line-2", activeOwnerJobId: "prepress-job-2" })],
      {},
      "",
    );

    expect(result.canCreate).toBe(false);
    expect(result.hardBlockers).toEqual([
      expect.objectContaining({ lineItemId: "line-1", code: "hard_missing_prepress_job" }),
    ]);
  });
});
