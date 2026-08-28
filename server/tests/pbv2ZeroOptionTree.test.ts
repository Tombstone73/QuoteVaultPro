import { describe, expect, test } from "@jest/globals";
import { validateOptionTreeV2 } from "@shared/optionTreeV2";
import { DEFAULT_VALIDATE_OPTS, validateTreeForPublish } from "@shared/pbv2/validator";
import { buildPbv2DefaultSelections, getRenderablePbv2QuestionNodeIds } from "@shared/pbv2OrderEntryRuntime";
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
});
