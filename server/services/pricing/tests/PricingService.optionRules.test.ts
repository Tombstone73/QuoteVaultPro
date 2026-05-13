import { describe, expect, test } from "@jest/globals";
import { evaluatePricingPreviewFromTree, type Pbv2OptionRuleValidationError } from "../PricingService";

function makeBannerTree(optionRules: any[] = []) {
  return {
    schemaVersion: 2 as const,
    rootNodeIds: ["finishing", "welded_hems", "pole_pocket_size"],
    optionRules,
    nodes: {
      finishing: {
        id: "finishing",
        kind: "question" as const,
        label: "Finishing",
        input: {
          type: "select" as const,
          selectionKey: "finishing",
        },
        choices: [
          { value: "none", label: "None" },
          { value: "pole_pockets", label: "Pole Pockets" },
          { value: "welded_hems", label: "Welded Hems" },
        ],
      },
      welded_hems: {
        id: "welded_hems",
        kind: "question" as const,
        label: "Welded Hems",
        input: {
          type: "boolean" as const,
          selectionKey: "welded_hems",
        },
        pricingImpact: [{ mode: "addFlat" as const, amountCents: 500 }],
      },
      pole_pocket_size: {
        id: "pole_pocket_size",
        kind: "question" as const,
        label: "Pole Pocket Size",
        input: {
          type: "select" as const,
          selectionKey: "pole_pocket_size",
        },
        choices: [
          {
            value: "3in",
            label: "3 in",
            pricingImpact: [{ mode: "addCents" as const, cents: 300 }],
          },
          {
            value: "4in",
            label: "4 in",
            pricingImpact: [{ mode: "addCents" as const, cents: 400 }],
          },
        ],
      },
    },
    meta: {
      pricingV2: {
        base: { perSqftCents: 100 },
      },
    },
  };
}

const polePocketRules = [
  {
    id: "rule_pole_pockets",
    when: {
      all: [{ optionGroup: "finishing", operator: "equals", value: "pole_pockets" }],
    },
    then: [
      { action: "hide", targetOptionGroup: "welded_hems" },
      { action: "clear", targetOptionGroup: "welded_hems" },
      { action: "show", targetOptionGroup: "pole_pocket_size" },
      { action: "require", targetOptionGroup: "pole_pocket_size" },
    ],
    else: [
      { action: "show", targetOptionGroup: "welded_hems" },
      { action: "hide", targetOptionGroup: "pole_pocket_size" },
      { action: "optional", targetOptionGroup: "pole_pocket_size" },
      { action: "clear", targetOptionGroup: "pole_pocket_size" },
    ],
  },
];

function runPreview(treeJson: any, selections: Record<string, any>) {
  return evaluatePricingPreviewFromTree({
    treeJson,
    widthIn: 24,
    heightIn: 36,
    quantity: 1,
    pbv2ExplicitSelections: selections,
    debug: true,
  });
}

function expectOptionRuleError(fn: () => unknown): Pbv2OptionRuleValidationError {
  try {
    fn();
  } catch (error: any) {
    expect(error.code).toBe("PBV2_OPTION_RULE_VALIDATION_FAILED");
    return error as Pbv2OptionRuleValidationError;
  }
  throw new Error("Expected PBV2 option rule validation error");
}

describe("PricingService option rule validation gate", () => {
  test("backend rejects a hidden option selection before pricing", () => {
    const error = expectOptionRuleError(() =>
      runPreview(makeBannerTree(polePocketRules), {
        finishing: { value: "pole_pockets" },
        welded_hems: { value: true },
        pole_pocket_size: { value: "3in" },
      })
    );

    expect(error.details).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          optionGroup: "welded_hems",
          code: "PBV2_OPTION_SELECTION_CLEARED_BY_RULE",
        }),
      ])
    );
  });

  test("backend rejects missing required option selection before pricing", () => {
    const error = expectOptionRuleError(() =>
      runPreview(makeBannerTree(polePocketRules), {
        finishing: { value: "pole_pockets" },
      })
    );

    expect(error.details).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          optionGroup: "pole_pocket_size",
          code: "OPTION_RULE_REQUIRED_MISSING",
        }),
      ])
    );
  });

  test("backend applies rule defaults before pricing", () => {
    const tree = makeBannerTree([
      {
        id: "rule_default_pocket_size",
        when: {
          all: [{ optionGroup: "finishing", operator: "equals", value: "pole_pockets" }],
        },
        then: [
          { action: "show", targetOptionGroup: "pole_pocket_size" },
          { action: "set_default", targetOptionGroup: "pole_pocket_size", value: "3in" },
          { action: "require", targetOptionGroup: "pole_pocket_size" },
        ],
      },
    ]);

    const result = runPreview(tree, {
      finishing: { value: "pole_pockets" },
    });

    expect(result.breakdown.optionsPrice).toBe(3);
  });

  test("existing products without option rules still price normally", () => {
    const result = runPreview(makeBannerTree(), {
      welded_hems: { value: true },
    });

    expect(result.breakdown.optionsPrice).toBe(5);
  });
});
