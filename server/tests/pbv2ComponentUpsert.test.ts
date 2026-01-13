import { assignEffectIndexFallback, buildOrderLineItemComponentUpsertValues } from "../lib/pbv2ComponentUpsert";
import { describe, expect, test } from "@jest/globals";

describe("PBV2 order line item component helpers", () => {
  test("buildOrderLineItemComponentUpsertValues sets idempotency key deterministically and preserves qty precision", () => {
    const now = new Date("2026-01-13T12:00:00.000Z");

    const values = buildOrderLineItemComponentUpsertValues({
      organizationId: "org_1",
      orderId: "order_1",
      orderLineItemId: "oli_1",
      treeVersionId: "tv_1",
      now,
      createdByUserId: "user_1",
      proposal: {
        kind: "inlineSku",
        title: "Laminate",
        // Intentionally missing skuRef (mapping must not invent one)
        qty: 1.5,
        unitPriceCents: 123,
        // amountCents intentionally missing
        invoiceVisibility: "separateLine",
        sourceNodeId: "node_abc",
        effectIndex: 7,
      },
    });

    expect(values.organizationId).toBe("org_1");
    expect(values.orderId).toBe("order_1");
    expect(values.orderLineItemId).toBe("oli_1");

    expect(values.pbv2SourceNodeId).toBe("node_abc");
    expect(values.pbv2EffectIndex).toBe(7);
    expect(values.pbv2TreeVersionId).toBe("tv_1");

    expect(values.invoiceVisibility).toBe("separateLine");

    // qty is stored as numeric(10,2) so we format to 2 decimals; do not coerce to int.
    expect(values.qty).toBe("1.50");

    // inlineSku with missing skuRef should remain null (mapping doesn't invent a SKU)
    expect(values.skuRef).toBeNull();

    // amountCents should be omitted when missing
    expect(Object.prototype.hasOwnProperty.call(values, "amountCents")).toBe(false);

    // updatedAt should be deterministic
    expect(values.updatedAt?.toISOString()).toBe(now.toISOString());
  });

  test("buildOrderLineItemComponentUpsertValues includes amountCents only when present", () => {
    const values = buildOrderLineItemComponentUpsertValues({
      organizationId: "org_1",
      orderId: "order_1",
      orderLineItemId: "oli_1",
      treeVersionId: "tv_1",
      proposal: {
        kind: "productRef",
        title: "Service",
        childProductId: "prod_child_1",
        qty: 2,
        amountCents: 500,
        invoiceVisibility: "rollup",
        sourceNodeId: "node_xyz",
        effectIndex: 0,
      },
    });

    expect(values.childProductId).toBe("prod_child_1");
    expect(values.amountCents).toBe(500);
  });

  test("buildOrderLineItemComponentUpsertValues enforces qty >= 0", () => {
    expect(() =>
      buildOrderLineItemComponentUpsertValues({
        organizationId: "org_1",
        orderId: "order_1",
        orderLineItemId: "oli_1",
        treeVersionId: "tv_1",
        proposal: {
          kind: "inlineSku",
          title: "Bad",
          qty: -1,
          invoiceVisibility: "rollup",
          sourceNodeId: "node_bad",
          effectIndex: 0,
        },
      }),
    ).toThrow(/qty must be >= 0/i);
  });

  test("assignEffectIndexFallback assigns deterministic per-node effectIndex when missing", () => {
    const input = [
      {
        kind: "inlineSku" as const,
        title: "B1",
        qty: 1,
        invoiceVisibility: "rollup" as const,
        sourceNodeId: "node_b",
      },
      {
        kind: "inlineSku" as const,
        title: "A1",
        qty: 1,
        invoiceVisibility: "rollup" as const,
        sourceNodeId: "node_a",
      },
      {
        kind: "inlineSku" as const,
        title: "B2",
        qty: 1,
        invoiceVisibility: "rollup" as const,
        sourceNodeId: "node_b",
      },
      {
        kind: "inlineSku" as const,
        title: "A2",
        qty: 1,
        invoiceVisibility: "rollup" as const,
        sourceNodeId: "node_a",
      },
    ];

    const out = assignEffectIndexFallback(input);

    // Per-node effectIndex is assigned by stable sort (sourceNodeId, originalIndex) then index within each node.
    // Returned in original array order.
    expect(out.map((x) => ({ sourceNodeId: x.sourceNodeId, effectIndex: x.effectIndex }))).toEqual([
      { sourceNodeId: "node_b", effectIndex: 0 },
      { sourceNodeId: "node_a", effectIndex: 0 },
      { sourceNodeId: "node_b", effectIndex: 1 },
      { sourceNodeId: "node_a", effectIndex: 1 },
    ]);
  });

  test("assignEffectIndexFallback preserves effectIndex when already present for all items", () => {
    const input = [
      {
        kind: "inlineSku" as const,
        title: "A",
        qty: 1,
        invoiceVisibility: "rollup" as const,
        sourceNodeId: "node_a",
        effectIndex: 5,
      },
      {
        kind: "inlineSku" as const,
        title: "A2",
        qty: 1,
        invoiceVisibility: "rollup" as const,
        sourceNodeId: "node_a",
        effectIndex: 9,
      },
    ];

    const out = assignEffectIndexFallback(input);
    expect(out.map((x) => x.effectIndex)).toEqual([5, 9]);
  });
});
