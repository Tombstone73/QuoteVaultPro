import { describe, expect, test } from "@jest/globals";
import { hasEnabledRuntimeOptionNodesV2, validateOptionTreeV2 } from "@shared/optionTreeV2";
import { DEFAULT_VALIDATE_OPTS, validateTreeForPublish } from "@shared/pbv2/validator";
import { buildPbv2DefaultSelections, getRenderablePbv2QuestionNodeIds } from "@shared/pbv2OrderEntryRuntime";
import { pbv2ToRuntimeSelectionContext } from "@shared/pbv2/pricingAdapter";
import { evaluateOptionTreeV2 } from "../services/optionTreeV2Evaluator";

const zeroOptionTree = {
  schemaVersion: 2 as const,
  status: "DRAFT" as const,
  rootNodeIds: [],
  nodes: {},
  edges: [],
  meta: { pricingV2: { base: { perPieceCents: 6000 } } },
};

describe("PBV2 canonical zero-option tree", () => {
  test("is valid for publish, preview, and quote/order option entry without selections", () => {
    expect(validateOptionTreeV2(zeroOptionTree).ok).toBe(true);
    expect(validateTreeForPublish(zeroOptionTree as any, DEFAULT_VALIDATE_OPTS).errors).toEqual([]);
    expect(getRenderablePbv2QuestionNodeIds(zeroOptionTree)).toEqual([]);
    expect(buildPbv2DefaultSelections(zeroOptionTree)).toBeNull();

    expect(evaluateOptionTreeV2({
      tree: zeroOptionTree,
      selections: { schemaVersion: 2, selected: {} },
      width: 0,
      height: 0,
      quantity: 1,
      basePrice: 60,
    })).toMatchObject({ optionsPrice: 0, selectedOptions: [], optionPriceContributions: [], visibleNodeIds: [] });
  });

  test("a configurable tree with nodes but no roots remains invalid", () => {
    const malformed = {
      ...zeroOptionTree,
      nodes: { design_type: { id: "design_type", type: "INPUT", status: "ENABLED", input: { selectionKey: "design_type", valueType: "TEXT" } } },
    };
    expect(validateOptionTreeV2(malformed).ok).toBe(false);
    expect(validateTreeForPublish(malformed as any, DEFAULT_VALIDATE_OPTS).errors).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "PBV2_E_TREE_NO_ROOTS" }),
    ]));
  });

  test("groups and retained disabled options are valid without runtime roots", () => {
    const allDisabledTree = {
      schemaVersion: 2 as const,
      status: "DRAFT" as const,
      rootNodeIds: [],
      nodes: {
        banner_options: { id: "banner_options", type: "GROUP", kind: "group", status: "ENABLED", label: "Banner options" },
        grommets: {
          id: "grommets",
          type: "INPUT",
          kind: "question",
          status: "DISABLED",
          key: "grommets",
          label: "Grommets",
          input: { type: "select", selectionKey: "grommets", valueType: "TEXT", required: true, defaultValue: "yes" },
          choices: [{
            value: "yes",
            label: "Grommets",
            pricingImpact: [{ mode: "addPerUnit", centsPerUnit: 200, unit: "perPiece" }],
            materialOverride: { materialId: "grommet_material" },
            inventoryConsumption: [{ materialId: "grommet_material", quantityBasis: "each", multiplier: 4 }],
          }],
          weightImpact: [{ mode: "addFlat", oz: 12 }],
        },
      },
      edges: [{ id: "banner_options_grommets", status: "DISABLED", fromNodeId: "banner_options", toNodeId: "grommets", condition: { op: "EXISTS", value: { op: "literal", value: true } } }],
      meta: { pricingV2: { base: { perSqftCents: 150, minimumChargeCents: 1200 } } },
    };

    expect(hasEnabledRuntimeOptionNodesV2(allDisabledTree)).toBe(false);
    expect(validateOptionTreeV2(allDisabledTree).ok).toBe(true);
    expect(validateTreeForPublish(allDisabledTree as any, DEFAULT_VALIDATE_OPTS).errors).toEqual([]);
    expect(getRenderablePbv2QuestionNodeIds(allDisabledTree as any)).toEqual([]);
    expect(buildPbv2DefaultSelections(allDisabledTree as any)).toBeNull();

    const evaluated = evaluateOptionTreeV2({
      tree: allDisabledTree as any,
      selections: { schemaVersion: 2, selected: { grommets: { value: "yes" } } },
      width: 36,
      height: 24,
      quantity: 1,
      basePrice: 12,
    });
    expect(evaluated).toMatchObject({ optionsPrice: 0, selectedOptions: [], optionPriceContributions: [], visibleNodeIds: [] });
    expect(pbv2ToRuntimeSelectionContext(allDisabledTree as any, { grommets: { value: "yes" } })).toMatchObject({
      selectedChoices: {}, resolvedChoices: {}, visibleNodeIds: [],
    });

    // The options evaluator leaves the existing base-price result unchanged;
    // preview pricing can therefore retain its configured per-square-foot
    // rate and minimum-charge behavior with no option add-ons.
    expect(12 + evaluated.optionsPrice).toBe(12);
  });
});
