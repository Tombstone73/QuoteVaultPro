import { describe, expect, test } from "@jest/globals";
import { groupReservationsByMaterial, sumManualReservedForOrder } from "../rollups/inventoryReservationRollups";

describe("inventoryReservationRollups (DB-free)", () => {
  test("sums MANUAL separately from AUTO", () => {
    const grouped = groupReservationsByMaterial([
      { sourceType: "PBV2_MATERIAL", sourceKey: "MAT-001", uom: "sqft", qty: "2.50", status: "RESERVED" },
      { sourceType: "MANUAL", sourceKey: "MAT-001", uom: "sqft", qty: "1.25", status: "RESERVED" },
      { sourceType: "PBV2_COMPONENT", sourceKey: "MAT-001", uom: "sqft", qty: "0.25", status: "RESERVED" },
    ]);

    expect(grouped).toEqual([
      {
        materialId: "MAT-001",
        uom: "sqft",
        totalQty: "4.00",
        bySourceType: {
          AUTO: "2.75",
          MANUAL: "1.25",
        },
      },
    ]);

    expect(sumManualReservedForOrder([
      { sourceType: "MANUAL", sourceKey: "MAT-001", uom: "sqft", qty: "1.25", status: "RESERVED" },
      { sourceType: "PBV2_MATERIAL", sourceKey: "MAT-001", uom: "sqft", qty: "2.50", status: "RESERVED" },
    ])).toBe(1.25);
  });

  test("ignores negative/zero quantities defensively", () => {
    const grouped = groupReservationsByMaterial([
      { sourceType: "MANUAL", sourceKey: "MAT-001", uom: "sqft", qty: 0, status: "RESERVED" },
      { sourceType: "MANUAL", sourceKey: "MAT-001", uom: "sqft", qty: -1, status: "RESERVED" },
      { sourceType: "MANUAL", sourceKey: "MAT-001", uom: "sqft", qty: "not-a-number", status: "RESERVED" },
      { sourceType: "MANUAL", sourceKey: "MAT-001", uom: "sqft", qty: "1.00", status: "RELEASED" },
      { sourceType: "MANUAL", sourceKey: "MAT-001", uom: "sqft", qty: "1.00", status: "RESERVED" },
    ]);

    expect(grouped).toEqual([
      {
        materialId: "MAT-001",
        uom: "sqft",
        totalQty: "1.00",
        bySourceType: {
          AUTO: "0.00",
          MANUAL: "1.00",
        },
      },
    ]);

    expect(sumManualReservedForOrder([
      { sourceType: "MANUAL", sourceKey: "MAT-001", uom: "sqft", qty: 0, status: "RESERVED" },
      { sourceType: "MANUAL", sourceKey: "MAT-001", uom: "sqft", qty: -1, status: "RESERVED" },
      { sourceType: "MANUAL", sourceKey: "MAT-001", uom: "sqft", qty: "1.00", status: "RELEASED" },
      { sourceType: "MANUAL", sourceKey: "MAT-001", uom: "sqft", qty: "1.00", status: "RESERVED" },
    ])).toBe(1);
  });

  test("grouping stable with mixed materials", () => {
    const grouped = groupReservationsByMaterial([
      { sourceType: "MANUAL", sourceKey: "B", uom: "EA", qty: "1", status: "RESERVED" },
      { sourceType: "PBV2_MATERIAL", sourceKey: "A", uom: "EA", qty: "2", status: "RESERVED" },
      { sourceType: "MANUAL", sourceKey: "A", uom: "EA", qty: "0.5", status: "RESERVED" },
      { sourceType: "PBV2_COMPONENT", sourceKey: "B", uom: "EA", qty: "3", status: "RESERVED" },
    ]);

    expect(grouped).toEqual([
      {
        materialId: "A",
        uom: "EA",
        totalQty: "2.50",
        bySourceType: { AUTO: "2.00", MANUAL: "0.50" },
      },
      {
        materialId: "B",
        uom: "EA",
        totalQty: "4.00",
        bySourceType: { AUTO: "3.00", MANUAL: "1.00" },
      },
    ]);
  });
});
