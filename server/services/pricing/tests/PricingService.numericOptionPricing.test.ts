import { describe, expect, test } from "@jest/globals";
import { evaluatePricingPreviewFromTree } from "../PricingService";

function makeCustomGrommetTree() {
  return {
    schemaVersion: 2 as const,
    rootNodeIds: ["grommets", "custom_grommet_qty", "custom_grommet_notes"],
    nodes: {
      grommets: {
        id: "grommets",
        kind: "question" as const,
        label: "Grommets",
        input: { type: "select" as const, selectionKey: "grommets", required: true },
        choices: [
          { value: "none", label: "No" },
          {
            value: "all_4",
            label: "All 4 corners",
            pricingImpact: [{ mode: "addPerUnit" as const, centsPerUnit: 100, unit: "perQty" as const }],
          },
          { value: "custom", label: "Custom" },
        ],
      },
      custom_grommet_qty: {
        id: "custom_grommet_qty",
        kind: "question" as const,
        label: "Custom Grommet Quantity",
        input: {
          type: "number" as const,
          selectionKey: "custom_grommet_qty",
          required: true,
          constraints: { number: { min: 0, step: 1 } },
        },
        visibility: {
          rules: [{ type: "equals" as const, selectionKey: "grommets", value: "custom" }],
        },
        pricingImpact: [{ mode: "addFormula" as const, formula: "custom_grommet_qty * 0.25 * q" }],
      },
      custom_grommet_notes: {
        id: "custom_grommet_notes",
        kind: "question" as const,
        label: "Placement Notes",
        input: { type: "textarea" as const, selectionKey: "custom_grommet_notes" },
        visibility: {
          rules: [{ type: "equals" as const, selectionKey: "grommets", value: "custom" }],
        },
      },
    },
    meta: {
      pricingV2: {
        base: { perSqftCents: 1 },
      },
    },
  };
}

function runPreview(selections: Record<string, any>) {
  return evaluatePricingPreviewFromTree({
    treeJson: makeCustomGrommetTree(),
    widthIn: 24,
    heightIn: 36,
    quantity: 10,
    pbv2ExplicitSelections: selections,
    pricingProfileKey: "default",
    debug: true,
  });
}

describe("PBV2 numeric option pricing", () => {
  test("numeric option values enter formula scope and price addFormula impacts", () => {
    const result = runPreview({
      grommets: { value: "custom" },
      custom_grommet_qty: { value: 6 },
      custom_grommet_notes: { value: "one in each corner plus two centered across top" },
    });

    expect(result.breakdown.optionsPrice).toBe(15);
    expect(result.debug?.variables.custom_grommet_qty).toBe(6);
  });

  test("hidden numeric fields do not affect pricing", () => {
    const result = runPreview({
      grommets: { value: "none" },
      custom_grommet_qty: { value: 6 },
      custom_grommet_notes: { value: "should be ignored" },
    });

    expect(result.breakdown.optionsPrice).toBe(0);
    expect(result.debug?.runtimeSelectionContext?.hiddenSelectionWarnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ selectionKey: "custom_grommet_qty", reason: "hidden_node" }),
      ])
    );
  });

  test("blank visible numeric fields settle to zero instead of producing invalid preview output", () => {
    const result = runPreview({
      grommets: { value: "custom" },
      custom_grommet_qty: { value: "" },
    });

    expect(result.breakdown.optionsPrice).toBe(0);
    expect(result.debug?.variables.custom_grommet_qty).toBe(0);
  });

  test("text placement notes do not affect pricing", () => {
    const base = runPreview({
      grommets: { value: "custom" },
      custom_grommet_qty: { value: 6 },
      custom_grommet_notes: { value: "A" },
    });
    const withDifferentNotes = runPreview({
      grommets: { value: "custom" },
      custom_grommet_qty: { value: 6 },
      custom_grommet_notes: { value: "B" },
    });

    expect(withDifferentNotes.totalPrice).toBe(base.totalPrice);
  });

  test("fixed choice pricing still works", () => {
    const result = runPreview({
      grommets: { value: "all_4" },
    });

    expect(result.breakdown.optionsPrice).toBe(10);
  });

  test("flat fee formula variable prices fee-style option impacts", () => {
    const tree = {
      schemaVersion: 2 as const,
      rootNodeIds: ["rush_fee"],
      nodes: {
        rush_fee: {
          id: "rush_fee",
          kind: "question" as const,
          label: "Rush Fee",
          input: { type: "select" as const, selectionKey: "rush_fee" },
          choices: [
            { value: "none", label: "No" },
            {
              value: "rush",
              label: "Yes",
              pricingImpact: [{ mode: "addFormula" as const, formula: "flatFee" }],
            },
          ],
        },
      },
      meta: {
        pricingProfileKey: "fee",
        pricingFormula: "flatFee",
        formulaVariables: { flatFee: 25 },
        pricingV2: { base: { minimumChargeCents: 1 } },
      },
    };

    const result = evaluatePricingPreviewFromTree({
      treeJson: tree,
      widthIn: 1,
      heightIn: 1,
      quantity: 1,
      pbv2ExplicitSelections: { rush_fee: { value: "rush" } },
      pricingProfileKey: "fee",
      debug: true,
    });

    expect(result.breakdown.optionsPrice).toBe(25);
    expect(result.debug?.variables.flatFee).toBe(25);
  });

  test("missing flatFee in option formula reports option name and symbol", () => {
    const tree = {
      schemaVersion: 2 as const,
      rootNodeIds: ["rush_fee"],
      nodes: {
        rush_fee: {
          id: "rush_fee",
          kind: "question" as const,
          label: "Rush Fee",
          input: { type: "select" as const, selectionKey: "rush_fee" },
          choices: [
            {
              value: "rush",
              label: "Yes",
              pricingImpact: [{ mode: "addFormula" as const, formula: "flatFee" }],
            },
          ],
        },
      },
      meta: {
        pricingProfileKey: "fee",
        pricingFormula: "1",
        pricingV2: { base: { minimumChargeCents: 1 } },
      },
    };

    expect(() =>
      evaluatePricingPreviewFromTree({
        treeJson: tree,
        widthIn: 1,
        heightIn: 1,
        quantity: 1,
        pbv2ExplicitSelections: { rush_fee: { value: "rush" } },
        pricingProfileKey: "fee",
        debug: true,
      }),
    ).toThrow(/Rush Fee.*flatFee/);
  });
});
