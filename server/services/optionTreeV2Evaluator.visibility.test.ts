import { describe, expect, test } from "@jest/globals";
import { evaluateOptionTreeV2 } from "./optionTreeV2Evaluator";

function makePricingVisibilityTree() {
  return {
    schemaVersion: 2 as const,
    rootNodeIds: ["group_material", "group_print", "group_finish"],
    nodes: {
      group_material: {
        id: "group_material",
        kind: "group" as const,
        label: "Material",
      },
      materialFamily: {
        id: "materialFamily",
        kind: "question" as const,
        label: "Material Family",
        input: {
          type: "select" as const,
          selectionKey: "materialFamily",
        },
        choices: [
          { value: "ACM", label: "ACM" },
          { value: "Acrylic", label: "Acrylic" },
        ],
      },
      group_print: {
        id: "group_print",
        kind: "group" as const,
        label: "Print Sides",
        visibility: {
          rules: [{ type: "equals" as const, selectionKey: "materialFamily", value: "ACM" }],
        },
      },
      printSides: {
        id: "printSides",
        kind: "question" as const,
        label: "Print Sides",
        input: {
          type: "select" as const,
          selectionKey: "printSides",
        },
        choices: [
          { value: "single", label: "Single" },
          {
            value: "double",
            label: "Double",
            pricingImpact: [{ mode: "addCents" as const, cents: 500 }],
          },
        ],
      },
      group_finish: {
        id: "group_finish",
        kind: "group" as const,
        label: "Contour Cut",
      },
      contourCut: {
        id: "contourCut",
        kind: "question" as const,
        label: "Contour Cut",
        input: {
          type: "boolean" as const,
          selectionKey: "contourCut",
        },
        pricingImpact: [{ mode: "addFlat" as const, amountCents: 200 }],
      },
    },
    edges: [
      { id: "e1", status: "DISABLED" as const, fromNodeId: "group_material", toNodeId: "materialFamily" },
      { id: "e2", status: "DISABLED" as const, fromNodeId: "group_print", toNodeId: "printSides" },
      { id: "e3", status: "DISABLED" as const, fromNodeId: "group_finish", toNodeId: "contourCut" },
    ],
  };
}

describe("optionTreeV2Evaluator visibility-aware pricing", () => {
  test("hidden groups do not contribute pricing from stale selections", () => {
    const result = evaluateOptionTreeV2({
      tree: makePricingVisibilityTree(),
      selections: {
        schemaVersion: 2,
        selected: {
          materialFamily: { value: "Acrylic" },
          printSides: { value: "double" },
        },
      },
      width: 24,
      height: 36,
      quantity: 1,
      basePrice: 0,
    });

    expect(result.optionsPrice).toBe(0);
    expect(result.visibleNodeIds).not.toContain("printSides");
  });

  test("active selections still price correctly when the group is visible", () => {
    const result = evaluateOptionTreeV2({
      tree: makePricingVisibilityTree(),
      selections: {
        schemaVersion: 2,
        selected: {
          materialFamily: { value: "ACM" },
          printSides: { value: "double" },
          contourCut: { value: true },
        },
      },
      width: 24,
      height: 36,
      quantity: 1,
      basePrice: 0,
    });

    expect(result.visibleNodeIds).toContain("printSides");
    expect(result.optionsPrice).toBe(7);
    expect(result.optionPriceContributions).toEqual(expect.arrayContaining([
      expect.objectContaining({ selectionKey: "printSides", choiceValue: "double", amountCents: 500 }),
      expect.objectContaining({ selectionKey: "contourCut", amountCents: 200 }),
    ]));
    expect(result.optionPriceContributions.reduce((total, entry) => total + entry.amountCents, 0)).toBe(700);
  });
});
