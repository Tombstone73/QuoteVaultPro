import { describe, expect, test } from "@jest/globals";
import { normalizePbv2DiffComponent, pbv2DiffComponents } from "../pbv2/pbv2ComponentDiff";

function n(x: Parameters<typeof normalizePbv2DiffComponent>[0]) {
  const out = normalizePbv2DiffComponent(x);
  if (!out) throw new Error("normalize returned null");
  return out;
}

describe("pbv2DiffComponents", () => {
  test("identical -> unchanged", () => {
    const accepted = [
      n({
        pbv2SourceNodeId: "node_a",
        pbv2EffectIndex: 0,
        kind: "inlineSku",
        title: "Laminate",
        skuRef: "LAM-001",
        qty: 2,
        unitPriceCents: 100,
        amountCents: 200,
        invoiceVisibility: "rollup",
      }),
    ];

    const proposed = [
      n({
        pbv2SourceNodeId: "node_a",
        pbv2EffectIndex: 0,
        kind: "inlineSku",
        title: "Laminate",
        skuRef: "LAM-001",
        qty: 2,
        unitPriceCents: 100,
        amountCents: 200,
        invoiceVisibility: "rollup",
      }),
    ];

    const diff = pbv2DiffComponents(accepted, proposed);
    expect(diff.unchanged).toHaveLength(1);
    expect(diff.added).toHaveLength(0);
    expect(diff.removed).toHaveLength(0);
    expect(diff.modified).toHaveLength(0);
  });

  test("qty change -> modified", () => {
    const accepted = [
      n({
        pbv2SourceNodeId: "node_a",
        pbv2EffectIndex: 0,
        kind: "inlineSku",
        title: "Laminate",
        skuRef: "LAM-001",
        qty: 2,
        unitPriceCents: 100,
        amountCents: 200,
        invoiceVisibility: "rollup",
      }),
    ];

    const proposed = [
      n({
        pbv2SourceNodeId: "node_a",
        pbv2EffectIndex: 0,
        kind: "inlineSku",
        title: "Laminate",
        skuRef: "LAM-001",
        qty: 3,
        unitPriceCents: 100,
        amountCents: 300,
        invoiceVisibility: "rollup",
      }),
    ];

    const diff = pbv2DiffComponents(accepted, proposed);
    expect(diff.modified).toHaveLength(1);
    expect(diff.modified[0].changedFields).toContain("qty");
  });

  test("sku change -> modified", () => {
    const accepted = [
      n({
        pbv2SourceNodeId: "node_a",
        pbv2EffectIndex: 0,
        kind: "inlineSku",
        title: "Laminate",
        skuRef: "LAM-001",
        qty: 2,
        unitPriceCents: 100,
        amountCents: 200,
        invoiceVisibility: "rollup",
      }),
    ];

    const proposed = [
      n({
        pbv2SourceNodeId: "node_a",
        pbv2EffectIndex: 0,
        kind: "inlineSku",
        title: "Laminate",
        skuRef: "LAM-002",
        qty: 2,
        unitPriceCents: 100,
        amountCents: 200,
        invoiceVisibility: "rollup",
      }),
    ];

    const diff = pbv2DiffComponents(accepted, proposed);
    expect(diff.modified).toHaveLength(1);
    expect(diff.modified[0].changedFields).toContain("skuRef");
  });

  test("disappearance -> removed", () => {
    const accepted = [
      n({
        pbv2SourceNodeId: "node_a",
        pbv2EffectIndex: 0,
        kind: "inlineSku",
        title: "Laminate",
        skuRef: "LAM-001",
        qty: 2,
        unitPriceCents: 100,
        amountCents: 200,
        invoiceVisibility: "rollup",
      }),
    ];

    const proposed: any[] = [];

    const diff = pbv2DiffComponents(accepted, proposed);
    expect(diff.removed).toHaveLength(1);
    expect(diff.added).toHaveLength(0);
    expect(diff.modified).toHaveLength(0);
  });

  test("new proposal -> added", () => {
    const accepted: any[] = [];

    const proposed = [
      n({
        pbv2SourceNodeId: "node_a",
        pbv2EffectIndex: 0,
        kind: "inlineSku",
        title: "Laminate",
        skuRef: "LAM-001",
        qty: 2,
        unitPriceCents: 100,
        amountCents: 200,
        invoiceVisibility: "rollup",
      }),
    ];

    const diff = pbv2DiffComponents(accepted, proposed);
    expect(diff.added).toHaveLength(1);
    expect(diff.removed).toHaveLength(0);
    expect(diff.modified).toHaveLength(0);
  });
});
