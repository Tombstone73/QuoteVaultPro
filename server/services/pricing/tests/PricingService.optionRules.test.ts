import { describe, expect, test } from "@jest/globals";
import {
  evaluatePricingPreviewFromTree,
  type Pbv2DefinitionValidationError,
  type Pbv2OptionRuleValidationError,
} from "../PricingService";

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

function expectDefinitionError(fn: () => unknown): Pbv2DefinitionValidationError {
  try {
    fn();
  } catch (error: any) {
    expect(error.code).toBe("PBV2_DEFINITION_VALIDATION_FAILED");
    return error as Pbv2DefinitionValidationError;
  }
  throw new Error("Expected PBV2 definition validation error");
}

describe("PricingService option rule validation gate", () => {
  test("backend clears hidden option selections before pricing", () => {
    const result = runPreview(makeBannerTree(polePocketRules), {
      finishing: { value: "pole_pockets" },
      welded_hems: { value: true },
      pole_pocket_size: { value: "3in" },
    });

    expect(result.debug?.runtimeSelectionContext?.selectedChoices.welded_hems).toBeUndefined();
    expect(result.totalPrice).toBeGreaterThan(0);
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

  test("runtime pricing rejects invalid rule definitions before evaluation", () => {
    const error = expectDefinitionError(() =>
      runPreview(makeBannerTree([
        {
          ...polePocketRules[0],
          when: {
            all: [{ optionGroup: "finishing", operator: "bad_operator", value: "pole_pockets" }],
          },
        },
      ]), {
        finishing: { value: "pole_pockets" },
      })
    );

    expect(error.details).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "PBV2_E_OPTION_RULE_OPERATOR_INVALID" }),
      ])
    );
  });
});

describe("PricingService — text input type safety", () => {
  function makeTreeWithTextOption() {
    return {
      schemaVersion: 2 as const,
      rootNodeIds: ["imprint"],
      nodes: {
        imprint: {
          id: "imprint",
          kind: "question" as const,
          label: "Custom Imprint Text",
          input: {
            type: "text" as const,
            selectionKey: "imprint",
          },
        },
      },
      meta: {
        pricingV2: {
          base: { perSqftCents: 100 },
        },
      },
    };
  }

  test("pricing does not crash when a text option has a string value", () => {
    const result = runPreview(makeTreeWithTextOption(), {
      imprint: { value: "Hello World" },
    });
    expect(typeof result.unitPrice).toBe("number");
    expect(Number.isFinite(result.unitPrice)).toBe(true);
  });

  test("pricing does not crash when an optional text option has no selection", () => {
    const result = runPreview(makeTreeWithTextOption(), {});
    expect(typeof result.unitPrice).toBe("number");
    expect(Number.isFinite(result.unitPrice)).toBe(true);
  });

  test("text option value does not add to options price", () => {
    const withText = runPreview(makeTreeWithTextOption(), { imprint: { value: "Custom text" } });
    const withoutText = runPreview(makeTreeWithTextOption(), {});
    expect(withText.breakdown.optionsPrice).toBe(withoutText.breakdown.optionsPrice);
  });
});
