import { describe, expect, test } from "@jest/globals";
import {
  groupReservationsByMaterial,
  sumManualReservedForOrder,
} from "../inventoryReservationsRollups";

describe("inventoryReservationsRollups (DB-free)", () => {
  test("MANUAL is summed separately from non-MANUAL", () => {
    const rows = groupReservationsByMaterial([
      { sourceType: "PBV2_MATERIAL", sourceKey: "MAT-001", uom: "EA", qty: "2.00", status: "RESERVED" },
      { sourceType: "MANUAL", sourceKey: "MAT-001", uom: "EA", qty: 1, status: "RESERVED" },
      { sourceType: "MANUAL", sourceKey: "MAT-001", uom: "EA", qty: "1.25", status: "RESERVED" },
    ]);

    expect(rows).toEqual([
      {
        sourceKey: "MAT-001",
        uom: "EA",
        totalQty: "4.25",
        manualQty: "2.25",
        nonManualQty: "2.00",
      },
    ]);
  });

  test("mixed materials are grouped independently", () => {
    const rows = groupReservationsByMaterial([
      { sourceType: "MANUAL", sourceKey: "MAT-A", uom: "EA", qty: 1, status: "RESERVED" },
      { sourceType: "MANUAL", sourceKey: "MAT-B", uom: "EA", qty: 2, status: "RESERVED" },
      { sourceType: "PBV2_COMPONENT", sourceKey: "MAT-A", uom: "EA", qty: 3, status: "RESERVED" },
    ]);

    expect(rows).toEqual([
      { sourceKey: "MAT-A", uom: "EA", totalQty: "4.00", manualQty: "1.00", nonManualQty: "3.00" },
      { sourceKey: "MAT-B", uom: "EA", totalQty: "2.00", manualQty: "2.00", nonManualQty: "0.00" },
    ]);
  });

  test("ignores non-positive qty defensively", () => {
    const rows = groupReservationsByMaterial([
      { sourceType: "MANUAL", sourceKey: "MAT-001", uom: "EA", qty: 0, status: "RESERVED" },
      { sourceType: "MANUAL", sourceKey: "MAT-001", uom: "EA", qty: -5, status: "RESERVED" },
      { sourceType: "MANUAL", sourceKey: "MAT-001", uom: "EA", qty: "1.00", status: "RESERVED" },
    ]);

    expect(rows).toEqual([
      {
        sourceKey: "MAT-001",
        uom: "EA",
        totalQty: "1.00",
        manualQty: "1.00",
        nonManualQty: "0.00",
      },
    ]);
  });

  test("non-MANUAL does not affect sumManualReservedForOrder", () => {
    const reservations = [
      { sourceType: "PBV2_MATERIAL", sourceKey: "MAT-001", uom: "EA", qty: 100, status: "RESERVED" },
      { sourceType: "MANUAL", sourceKey: "MAT-001", uom: "EA", qty: 1.5, status: "RESERVED" },
      { sourceType: "MANUAL", sourceKey: "MAT-001", uom: "EA", qty: "0", status: "RESERVED" },
      { sourceType: "MANUAL", sourceKey: "MAT-002", uom: "EA", qty: 9, status: "RESERVED" },
      { sourceType: "MANUAL", sourceKey: "MAT-001", uom: "EA", qty: 1, status: "RELEASED" },
    ];

    expect(sumManualReservedForOrder(reservations as any, "MAT-001", "EA")).toBe("1.50");
  });
});
