import { describe, expect, test } from "@jest/globals";
import {
  applyReleaseToReservations,
  buildInventoryReservationsFromRollup,
  buildInventoryRollup,
  diffReservationsForInsert,
} from "../lib/pbv2InventoryReservations";

describe("PBV2 -> inventory reservations (DB-free)", () => {
  test("buildInventoryReservationsFromRollup aggregates & sorts deterministically", () => {
    const rollup: any = {
      materials: [
        // intentionally out of order
        { skuRef: "MAT-B", uom: "FT", qty: 3 },
        { skuRef: "MAT-A", uom: "EA", qty: 2.2 },
        { skuRef: "MAT-A", uom: "EA", qty: 1.1 },
      ],
      components: [
        // intentionally out of order
        { kind: "inlineSku", skuRef: "LAM-001", qty: 2 },
        { kind: "childProduct", childProductId: "prod_123", qty: 1 },
      ],
      warnings: [],
    };

    const rows = buildInventoryReservationsFromRollup({
      organizationId: "org_1",
      orderId: "ord_1",
      rollup,
      createdByUserId: "user_1",
    });

    // Deterministic ordering: sourceKey then uom then sourceType
    const keys = rows.map((r) => `${r.sourceKey}::${r.uom}::${r.sourceType}`);
    expect(keys).toEqual([...keys].sort());

    // Aggregation + normalization (2dp)
    const matA = rows.find((r) => r.sourceType === "PBV2_MATERIAL" && r.sourceKey === "MAT-A" && r.uom === "EA");
    expect(matA).toEqual(
      expect.objectContaining({
        organizationId: "org_1",
        orderId: "ord_1",
        orderLineItemId: null,
        sourceType: "PBV2_MATERIAL",
        sourceKey: "MAT-A",
        uom: "EA",
        qty: "3.30",
        status: "RESERVED",
        createdByUserId: "user_1",
      }),
    );

    const lam = rows.find((r) => r.sourceType === "PBV2_COMPONENT" && r.sourceKey === "LAM-001" && r.uom === "EA");
    expect(lam?.qty).toBe("2.00");
  });

  test("diffReservationsForInsert is idempotent by (sourceType, sourceKey, uom) for RESERVED", () => {
    const desired = [
      {
        organizationId: "org_1",
        orderId: "ord_1",
        orderLineItemId: null,
        sourceType: "PBV2_MATERIAL" as const,
        sourceKey: "MAT-A",
        uom: "EA",
        qty: "3.30",
        status: "RESERVED" as const,
      },
      {
        organizationId: "org_1",
        orderId: "ord_1",
        orderLineItemId: null,
        sourceType: "PBV2_COMPONENT" as const,
        sourceKey: "LAM-001",
        uom: "EA",
        qty: "2.00",
        status: "RESERVED" as const,
      },
    ];

    const existingReserved = [
      { sourceType: "PBV2_COMPONENT" as const, sourceKey: "LAM-001", uom: "EA", status: "RESERVED" as const },
      // RELEASED should not block new inserts
      { sourceType: "PBV2_MATERIAL" as const, sourceKey: "MAT-A", uom: "EA", status: "RELEASED" as const },
    ];

    const toInsert = diffReservationsForInsert({ desired, existingReserved });
    expect(toInsert).toHaveLength(1);
    expect(toInsert[0]).toEqual(expect.objectContaining({ sourceType: "PBV2_MATERIAL", sourceKey: "MAT-A", uom: "EA" }));
  });

  test("applyReleaseToReservations flips status to RELEASED", () => {
    const released = applyReleaseToReservations([
      { id: "r1", status: "RESERVED" },
      { id: "r2", status: "RESERVED" },
    ]);

    expect(released).toEqual([
      { id: "r1", status: "RELEASED" },
      { id: "r2", status: "RELEASED" },
    ]);
  });

  test("buildInventoryRollup groups by (sourceKey,uom) and breaks down by sourceType", () => {
    const { items } = buildInventoryRollup({
      reservations: [
        { sourceType: "PBV2_MATERIAL", sourceKey: "MAT-A", uom: "EA", qty: "3.30", status: "RESERVED" },
        { sourceType: "PBV2_COMPONENT", sourceKey: "MAT-A", uom: "EA", qty: "2.00", status: "RESERVED" },
        { sourceType: "MANUAL", sourceKey: "MAT-A", uom: "EA", qty: "1.00", status: "RESERVED" },
        { sourceType: "PBV2_MATERIAL", sourceKey: "MAT-B", uom: "FT", qty: "3.00", status: "RESERVED" },
        { sourceType: "PBV2_MATERIAL", sourceKey: "MAT-A", uom: "EA", qty: "999.00", status: "RELEASED" },
      ],
      status: "RESERVED",
    });

    expect(items).toEqual([
      {
        sourceKey: "MAT-A",
        uom: "EA",
        qty: "6.30",
        bySourceType: {
          PBV2_MATERIAL: "3.30",
          PBV2_COMPONENT: "2.00",
          MANUAL: "1.00",
        },
      },
      {
        sourceKey: "MAT-B",
        uom: "FT",
        qty: "3.00",
        bySourceType: {
          PBV2_MATERIAL: "3.00",
          PBV2_COMPONENT: "0.00",
          MANUAL: "0.00",
        },
      },
    ]);
  });
});
