import { describe, expect, test } from "@jest/globals";
import { evaluateOptionTreeV2 } from "../services/optionTreeV2Evaluator";
import { evaluatePricingPreviewFromTree } from "../services/pricing/PricingService";

const baseCents = 27_000; // 18in × 24in × 60 × $1.50/sqft

function postersLaminateTree() {
  return {
    schemaVersion: 2 as const,
    rootNodeIds: ["group_finish"],
    nodes: {
      group_finish: { id: "group_finish", kind: "group" as const, label: "Finish" },
      laminate: {
        id: "laminate",
        kind: "question" as const,
        label: "Laminate",
        input: { type: "select" as const, selectionKey: "laminate", defaultValue: "none" },
        choices: [
          { value: "none", label: "NONE" },
          { value: "gloss", label: "Gloss", pricingImpact: [{ mode: "addPerUnit" as const, centsPerUnit: 100, unit: "perSqft" as const }] },
          { value: "matte", label: "Matte", pricingImpact: [{ mode: "addPerUnit" as const, centsPerUnit: 100, unit: "perSqft" as const }] },
        ],
      },
    },
    edges: [{ id: "e1", status: "DISABLED" as const, fromNodeId: "group_finish", toNodeId: "laminate" }],
  };
}

function evaluateLaminate(value?: "gloss" | "matte") {
  return evaluateOptionTreeV2({
    tree: postersLaminateTree(),
    selections: { schemaVersion: 2, selected: value ? { laminate: { value } } : {} },
    width: 18,
    height: 24,
    quantity: 60,
    basePrice: baseCents / 100,
  });
}

function repairedPostersTree() {
  return {
    schemaVersion: 2 as const,
    rootNodeIds: ["group_finish"],
    nodes: {
      group_finish: { id: "group_finish", kind: "group" as const, label: "Finish" },
      laminate: {
        id: "laminate",
        kind: "question" as const,
        label: "Laminate",
        input: { type: "select" as const, selectionKey: "laminate", defaultValue: "choice_3" },
        choices: [
          { value: "choice_1", label: "Glossy", pricingImpact: [{ mode: "addPerUnit" as const, centsPerUnit: 100, unit: "perSqft" as const }] },
          { value: "choice_2", label: "Matte", pricingImpact: [{ mode: "addPerUnit" as const, centsPerUnit: 100, unit: "perSqft" as const }] },
          { value: "choice_3", label: "NONE" },
        ],
      },
    },
    edges: [{ id: "e1", status: "DISABLED" as const, fromNodeId: "group_finish", toNodeId: "laminate" }],
    meta: {
      pricingFormula: "ceil(w) * ceil(h) / 144 * q * p",
      pricingV2: { base: { perSqftCents: 150, perPieceCents: 0, minimumChargeCents: 0 } },
    },
  };
}

function previewPosters(input: { widthIn: number; heightIn: number; quantity: number; laminate?: "choice_1" | "choice_2" }) {
  return evaluatePricingPreviewFromTree({
    treeJson: repairedPostersTree(),
    widthIn: input.widthIn,
    heightIn: input.heightIn,
    quantity: input.quantity,
    pbv2ExplicitSelections: input.laminate ? { laminate: { value: input.laminate } } : {},
    debug: true,
  });
}

describe("PBV2 laminate choice pricing", () => {
  test("prices the NONE default from its own zero impact: $270 total / $4.50 each", () => {
    const result = evaluateLaminate();
    expect(result.optionsPrice).toBe(0);
    expect(baseCents / 100 + result.optionsPrice).toBe(270);
    expect((baseCents / 100 + result.optionsPrice) / 60).toBe(4.5);
    expect(result.optionPriceContributions).toEqual([
      expect.objectContaining({ selectionKey: "laminate", choiceValue: "none", choiceLabel: "NONE", amountCents: 0 }),
    ]);
  });

  test.each(["gloss", "matte"] as const)("uses only the selected %s laminate's $1/sqft impact", (value) => {
    const result = evaluateLaminate(value);
    expect(result.optionsPrice).toBe(180);
    expect(baseCents / 100 + result.optionsPrice).toBe(450);
    expect((baseCents / 100 + result.optionsPrice) / 60).toBe(7.5);
    expect(result.optionPriceContributions).toEqual([
      expect.objectContaining({ selectionKey: "laminate", choiceValue: value, amountCents: 18_000 }),
    ]);
  });

  test("honors a conditional node impact against the resolved NONE default", () => {
    const tree = postersLaminateTree();
    (tree.nodes.laminate as any).pricingImpact = [{ mode: "addPerSqft", amountCents: 100, applyWhen: { op: "notEquals", ref: "laminate", value: "none" } }];
    (tree.nodes.laminate as any).choices = (tree.nodes.laminate as any).choices.map((choice: any) => ({ ...choice, pricingImpact: undefined }));

    const none = evaluateOptionTreeV2({ tree, selections: { schemaVersion: 2, selected: {} }, width: 18, height: 24, quantity: 60, basePrice: 270 });
    const gloss = evaluateOptionTreeV2({ tree, selections: { schemaVersion: 2, selected: { laminate: { value: "gloss" } } }, width: 18, height: 24, quantity: 60, basePrice: 270 });

    expect(none.optionsPrice).toBe(0);
    expect(gloss.optionsPrice).toBe(180);
  });

  test("prices the repaired active Posters NONE default as $4.50 with p = $1.50 and no minimum", () => {
    const result = previewPosters({ widthIn: 24, heightIn: 18, quantity: 1 });

    expect(result.unitPrice).toBe(4.5);
    expect(result.totalPrice).toBe(4.5);
    expect(result.breakdown).toEqual(expect.objectContaining({ basePrice: 4.5, optionsPrice: 0, total: 4.5 }));
    expect(result.debug?.variables).toEqual(expect.objectContaining({ p: 1.5, base_price: 1.5 }));
    expect(result.debug?.optionPriceContributions).toEqual([
      expect.objectContaining({ choiceValue: "choice_3", choiceLabel: "NONE", amountCents: 0 }),
    ]);
  });

  test("keeps Posters NONE linear at $4.50 each for 60 three-square-foot items", () => {
    const result = previewPosters({ widthIn: 18, heightIn: 24, quantity: 60 });

    expect(result.unitPrice).toBe(4.5);
    expect(result.totalPrice).toBe(270);
    expect(result.breakdown).toEqual(expect.objectContaining({ basePrice: 270, optionsPrice: 0, total: 270 }));
  });

  test.each(["choice_1", "choice_2"] as const)("adds the intended $1/sqft only for selected laminate %s", (laminate) => {
    const result = previewPosters({ widthIn: 24, heightIn: 18, quantity: 1, laminate });

    expect(result.totalPrice).toBe(7.5);
    expect(result.breakdown).toEqual(expect.objectContaining({ basePrice: 4.5, optionsPrice: 3, total: 7.5 }));
  });
});
