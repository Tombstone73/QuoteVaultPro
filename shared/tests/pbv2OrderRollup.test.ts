import { describe, expect, test } from "@jest/globals";
import { buildOrderPbv2Rollup } from "../pbv2/pbv2OrderRollup";
import { computePbv2InputSignature } from "../pbv2/pbv2InputSignature";

describe("buildOrderPbv2Rollup", () => {
  test("aggregates materials by (skuRef,uom) and skips stale signature line items", async () => {
    const snapshot1 = {
      treeVersionId: "tv_1",
      explicitSelections: { a: 1 },
      env: { widthIn: 10, heightIn: 10, quantity: 1 },
      materials: [
        { skuRef: "MAT-A", uom: "EA", qty: 1.1, sourceNodeId: "n1" },
        { skuRef: "MAT-A", uom: "EA", qty: 2.2, sourceNodeId: "n2" },
        { skuRef: "MAT-B", uom: "FT", qty: 3, sourceNodeId: "n3" },
      ],
    };
    (snapshot1 as any).pbv2InputSignature = await computePbv2InputSignature({
      treeVersionId: snapshot1.treeVersionId,
      explicitSelections: snapshot1.explicitSelections,
      env: snapshot1.env,
    });

    const snapshot2 = {
      treeVersionId: "tv_1",
      explicitSelections: { a: 1 },
      env: { widthIn: 10, heightIn: 10, quantity: 1 },
      materials: [{ skuRef: "MAT-A", uom: "EA", qty: 10, sourceNodeId: "n9" }],
      pbv2InputSignature: "not-a-real-sig",
    };

    const result = await buildOrderPbv2Rollup({
      orderId: "ord_1",
      lineItems: [
        { id: "li_1", pbv2SnapshotJson: snapshot1 },
        { id: "li_2", pbv2SnapshotJson: snapshot2 },
      ],
      acceptedComponents: [],
    });

    expect(result.orderId).toBe("ord_1");
    // snapshot2 should be skipped
    expect(result.warnings.some((w: any) => w.code === "PBV2_SNAPSHOT_SIGNATURE_MISMATCH" && w.lineItemId === "li_2")).toBe(true);

    // MAT-A EA total = 1.1 + 2.2 = 3.3
    const matA = result.materials.find((m: any) => m.skuRef === "MAT-A" && m.uom === "EA");
    expect(matA?.qty).toBe("3.3");

    // Deterministic ordering by skuRef then uom
    expect(result.materials.map((m: any) => `${m.skuRef}:${m.uom}`)).toEqual(["MAT-A:EA", "MAT-B:FT"]);
  });

  test("components are sorted by lineItemId then title and qty normalized", async () => {
    const result = await buildOrderPbv2Rollup({
      orderId: "ord_1",
      lineItems: [],
      acceptedComponents: [
        {
          orderLineItemId: "li_2",
          kind: "inlineSku",
          title: "B Title",
          skuRef: "SKU-2",
          qty: "1",
          invoiceVisibility: "rollup",
          unitPriceCents: 100,
          amountCents: 100,
        },
        {
          orderLineItemId: "li_1",
          kind: "inlineSku",
          title: "A Title",
          skuRef: "SKU-1",
          qty: 2,
          invoiceVisibility: "rollup",
          unitPriceCents: 100,
          amountCents: 200,
        },
      ],
    });

    expect(result.components.map((c: any) => `${c.lineItemId}:${c.title}:${c.qty}`)).toEqual([
      "li_1:A Title:2.00",
      "li_2:B Title:1.00",
    ]);
  });
});
