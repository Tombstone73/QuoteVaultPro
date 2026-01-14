import { describe, expect, test } from "@jest/globals";
import { buildPbv2OrderRollupResponse } from "../lib/pbv2OrderRollupResponse";
import { buildOrderPbv2Rollup } from "../../shared/pbv2/pbv2OrderRollup";
import { computePbv2InputSignature } from "../../shared/pbv2/pbv2InputSignature";

describe("GET /api/orders/:orderId/pbv2/rollup contract", () => {
  test("pins response keys, entry shapes, deterministic ordering, and stale-snapshot omission", async () => {
    const snapshotGood: any = {
      treeVersionId: "tv_1",
      explicitSelections: { a: 1 },
      env: { widthIn: 10, heightIn: 10, quantity: 1 },
      materials: [
        { skuRef: "MAT-B", uom: "FT", qty: 3, sourceNodeId: "n3" },
        { skuRef: "MAT-A", uom: "EA", qty: 2.2, sourceNodeId: "n2" },
        { skuRef: "MAT-A", uom: "EA", qty: 1.1, sourceNodeId: "n1" },
      ],
    };

    snapshotGood.pbv2InputSignature = await computePbv2InputSignature({
      treeVersionId: snapshotGood.treeVersionId,
      explicitSelections: snapshotGood.explicitSelections,
      env: snapshotGood.env,
    });

    const snapshotStale: any = {
      treeVersionId: "tv_1",
      explicitSelections: { a: 1 },
      env: { widthIn: 10, heightIn: 10, quantity: 1 },
      materials: [{ skuRef: "MAT-A", uom: "EA", qty: 100, sourceNodeId: "n9" }],
      pbv2InputSignature: "not-a-real-sig",
    };

    const rollup = await buildOrderPbv2Rollup({
      orderId: "ord_1",
      lineItems: [
        { id: "li_1", pbv2SnapshotJson: snapshotGood },
        { id: "li_2", pbv2SnapshotJson: snapshotStale },
      ],
      acceptedComponents: [
        {
          orderLineItemId: "li_2",
          kind: "inlineSku",
          title: "Z Title",
          skuRef: "SKU-Z",
          qty: 1,
          unitPriceCents: 0,
          amountCents: 0,
          invoiceVisibility: "rollup",
        },
        {
          orderLineItemId: "li_1",
          kind: "inlineSku",
          title: "Laminate",
          skuRef: "LAM-001",
          qty: 2,
          unitPriceCents: 100,
          amountCents: 200,
          invoiceVisibility: "rollup",
        },
      ],
    });

    const response = buildPbv2OrderRollupResponse(rollup);

    // Top-level contract
    expect(Object.keys(response).sort()).toEqual(["components", "materials", "orderId", "warnings"].sort());
    expect(response.orderId).toBe("ord_1");
    expect(Array.isArray(response.materials)).toBe(true);
    expect(Array.isArray(response.components)).toBe(true);
    expect(Array.isArray(response.warnings)).toBe(true);

    // warnings contract + stale snapshot omission
    expect(response.warnings.some((w: any) => w.code === "PBV2_SNAPSHOT_SIGNATURE_MISMATCH" && w.lineItemId === "li_2")).toBe(true);
    expect(response.warnings[0]).toEqual(expect.objectContaining({ code: expect.any(String), message: expect.any(String) }));

    // materials are aggregated, sorted by skuRef then uom, and do NOT include stale snapshot qty
    expect(response.materials.map((m: any) => `${m.skuRef}:${m.uom}`)).toEqual(["MAT-A:EA", "MAT-B:FT"]);
    const matA = response.materials.find((m: any) => m.skuRef === "MAT-A" && m.uom === "EA");
    expect(matA).toEqual(expect.objectContaining({ skuRef: "MAT-A", uom: "EA", qty: "3.3", sources: expect.any(Array) }));
    expect((matA?.sources ?? []).some((s: any) => s.lineItemId === "li_2")).toBe(false);

    // material entry shape
    expect(Object.keys(response.materials[0]).sort()).toEqual(["qty", "skuRef", "sources", "uom"].sort());
    if (response.materials[0].sources.length > 0) {
      expect(Object.keys(response.materials[0].sources[0]).sort()).toEqual(
        ["effectIndex", "lineItemId", "qty", "sourceNodeId"].sort(),
      );
    }

    // components deterministic ordering: by lineItemId then title
    expect(response.components.map((c: any) => `${c.lineItemId}:${c.title}`)).toEqual(["li_1:Laminate", "li_2:Z Title"]);

    // component entry shape
    expect(Object.keys(response.components[0]).sort()).toEqual(
      ["amountCents", "childProductId", "invoiceVisibility", "kind", "lineItemId", "qty", "skuRef", "title", "unitPriceCents"].sort(),
    );
  });
});
