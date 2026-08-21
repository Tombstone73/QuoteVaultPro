import { describe, expect, test } from "@jest/globals";
import { evaluateOptionTreeV2 } from "../services/optionTreeV2Evaluator";
import { evaluatePricingPreviewFromTree } from "../services/pricing/PricingService";

describe("PBV2 option price contributions", () => {
  test("attributes the options total to the backend-resolved default choice", () => {
    const result = evaluateOptionTreeV2({
      tree: {
        schemaVersion: 2,
        rootNodeIds: ["group_print"],
        nodes: {
          group_print: { id: "group_print", kind: "group", label: "Print" },
          printSides: {
            id: "printSides",
            kind: "question",
            label: "Print Sides",
            input: { type: "select", selectionKey: "printSides", defaultValue: "double" },
            choices: [
              { value: "single", label: "Single-sided" },
              { value: "double", label: "Double-sided", pricingImpact: [{ mode: "addCents", cents: 550 }] },
            ],
          },
        },
        edges: [{ id: "e1", status: "DISABLED", fromNodeId: "group_print", toNodeId: "printSides" }],
      },
      selections: { schemaVersion: 2, selected: {} },
      width: 24,
      height: 36,
      quantity: 1,
      basePrice: 9,
    });

    expect(result.optionsPrice).toBe(5.5);
    expect(result.optionPriceContributions).toEqual([
      expect.objectContaining({
        selectionKey: "printSides",
        choiceValue: "double",
        choiceLabel: "Double-sided",
        amountCents: 550,
      }),
    ]);
    expect(result.optionPriceContributions.reduce((total, entry) => total + entry.amountCents, 0)).toBe(550);
  });

  test("reconciles the preview formula, resolved default, and ceil diagnostics", () => {
    const treeJson = {
      schemaVersion: 2,
      rootNodeIds: ["group_print"],
      nodes: {
        group_print: { id: "group_print", kind: "group", label: "Print" },
        printSides: {
          id: "printSides",
          kind: "question",
          label: "Print Sides",
          input: { type: "select", selectionKey: "printSides", defaultValue: "double" },
          choices: [
            { value: "single", label: "Single-sided" },
            { value: "double", label: "Double-sided", pricingImpact: [{ mode: "addCents", cents: 550 }] },
          ],
        },
      },
      edges: [{ id: "e1", status: "DISABLED", fromNodeId: "group_print", toNodeId: "printSides" }],
      meta: { pricingV2: { base: { perSqftCents: 150 } } },
    };

    const result = evaluatePricingPreviewFromTree({
      treeJson,
      widthIn: 24,
      heightIn: 36,
      quantity: 1,
      pricingFormulaOverride: "ceil(w) * ceil(h) / 144 * q * p",
      formulaSourceMode: "manual",
      debug: true,
    });

    expect(result.derived).toMatchObject({ sqft: 6, totalSqft: 6 });
    expect(result.breakdown).toMatchObject({ basePrice: 9, optionsPrice: 5.5, total: 14.5 });
    expect(result.totalPrice).toBe(14.5);
    expect(result.debug).toMatchObject({ lastCeilInput: 36, lastCeilResult: 36 });
    expect(result.debug?.optionPriceContributions).toEqual([
      expect.objectContaining({ selectionKey: "printSides", amountCents: 550 }),
    ]);
  });
});
