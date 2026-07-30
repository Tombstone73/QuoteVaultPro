import { validatePrepressCombinedRunSelection, type PrepressCombinedRunItem } from "./prepressCombinedRuns";

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

  test("blocks mixed-order selection", () => {
    const result = validatePrepressCombinedRunSelection(
      [baseItem(), baseItem({ lineItemId: "line-2", orderId: "order-2", activeOwnerJobId: "prepress-job-2" })],
      {},
      "",
    );

    expect(result.canCreate).toBe(false);
    expect(result.reason).toBe("Combined runs must use items from one order.");
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

  test("requires finalized prepress artwork before run creation", () => {
    const result = validatePrepressCombinedRunSelection(
      [
        baseItem({ finalFileCount: 0 }),
        baseItem({ lineItemId: "line-2", activeOwnerJobId: "prepress-job-2" }),
      ],
      {},
      "",
    );

    expect(result.canCreate).toBe(false);
    expect(result.reason).toBe("Complete prepress final artwork before creating a combined run.");
  });
});
