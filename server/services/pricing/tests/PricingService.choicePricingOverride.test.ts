import { describe, expect, test } from "@jest/globals";
import { pbv2ToRuntimeSelectionContext } from "../../../../shared/pbv2/pricingAdapter";
import { evaluatePricingPreviewFromTree } from "../PricingService";

function makeAcmTree() {
  return {
    schemaVersion: 2 as const,
    rootNodeIds: ["thickness", "printSides", "finish"],
    nodes: {
      thickness: {
        id: "thickness",
        type: "INPUT",
        kind: "question" as const,
        label: "Thickness",
        input: {
          type: "select" as const,
          selectionKey: "thickness",
          required: true,
        },
        choices: [
          {
            value: "3mm",
            label: "3mm ACM",
            pricingOverride: {
              mode: "set_base_rate" as const,
              amount: 250,
              unit: "perSqft" as const,
              appliesTo: "area" as const,
              label: "ACM 3mm base rate",
            },
          },
          {
            value: "6mm",
            label: "6mm ACM",
            pricingOverride: {
              mode: "set_base_rate" as const,
              amount: 400,
              unit: "perSqft" as const,
              appliesTo: "area" as const,
              label: "ACM 6mm base rate",
            },
          },
        ],
      },
      printSides: {
        id: "printSides",
        type: "INPUT",
        kind: "question" as const,
        label: "Print Sides",
        input: {
          type: "select" as const,
          selectionKey: "printSides",
        },
        choices: [
          {
            value: "single",
            label: "Single Sided",
          },
          {
            value: "double",
            label: "Double Sided",
            pricingImpact: [
              {
                mode: "addPerSqft" as const,
                amountCents: 50,
                label: "Double-sided print",
              },
            ],
          },
        ],
      },
      finish: {
        id: "finish",
        type: "INPUT",
        kind: "question" as const,
        label: "Finish",
        input: {
          type: "select" as const,
          selectionKey: "finish",
        },
        choices: [
          {
            value: "standard",
            label: "Standard",
          },
          {
            value: "contour",
            label: "Contour Cut",
            pricingImpact: [
              {
                mode: "addFlat" as const,
                amountCents: 200,
                label: "Contour cutting",
              },
            ],
          },
        ],
      },
    },
    meta: {
      pricingV2: {
        base: {
          // A nominal configured rate lets the legacy evaluator reach the
          // selected set_base_rate override; the override supplies the
          // commercial rate asserted below.
          perSqftCents: 1,
          perPieceCents: 0,
          minimumChargeCents: 0,
        },
      },
    },
  };
}

describe("PBV2 choice pricing overrides", () => {
  test("formula product choice addPercent impacts price from base and option rules clear hidden selections", () => {
    const tree = {
      schemaVersion: 2 as const,
      rootNodeIds: ["contour_cutting", "weed_and_tape"],
      rules: [{
        id: "rule_contour_cutting_weed_and_tape",
        enabled: true,
        when: { all: [{ optionGroup: "contour_cutting", operator: "equals", value: "yes" }] },
        then: [{ action: "show", targetOptionGroup: "weed_and_tape" }],
        else: [
          { action: "hide", targetOptionGroup: "weed_and_tape" },
          { action: "clear", targetOptionGroup: "weed_and_tape" },
        ],
      }],
      nodes: {
        contour_cutting: {
          id: "contour_cutting",
          type: "INPUT",
          kind: "question" as const,
          label: "Contour Cutting",
          input: { type: "select" as const, selectionKey: "contour_cutting" },
          choices: [
            { value: "no", label: "No" },
            { value: "yes", label: "Yes", pricingImpact: [{ mode: "addPercent" as const, percent: 10, basis: "base" as const }] },
          ],
        },
        weed_and_tape: {
          id: "weed_and_tape",
          type: "INPUT",
          kind: "question" as const,
          label: "Weed and Tape",
          input: { type: "select" as const, selectionKey: "weed_and_tape" },
          choices: [
            { value: "no", label: "No" },
            { value: "yes", label: "Yes", pricingImpact: [{ mode: "addPercent" as const, percent: 25, basis: "base" as const }] },
          ],
        },
      },
      meta: {
        pricingV2: { base: { perSqftCents: 10000 } },
      },
    };

    const noImpacts = evaluatePricingPreviewFromTree({
      treeJson: tree,
      widthIn: 12,
      heightIn: 12,
      quantity: 1,
      pbv2ExplicitSelections: {
        contour_cutting: { value: "no" },
        weed_and_tape: { value: "no" },
      },
      debug: true,
    });

    expect(noImpacts.breakdown.basePrice).toBeCloseTo(100, 2);
    expect(noImpacts.breakdown.optionsPrice).toBeCloseTo(0, 2);
    expect(noImpacts.totalPrice).toBeCloseTo(100, 2);

    const contourOnly = evaluatePricingPreviewFromTree({
      treeJson: tree,
      widthIn: 12,
      heightIn: 12,
      quantity: 1,
      pbv2ExplicitSelections: {
        contour_cutting: { value: "yes" },
        weed_and_tape: { value: "no" },
      },
      debug: true,
    });

    expect(contourOnly.breakdown.basePrice).toBeCloseTo(100, 2);
    expect(contourOnly.breakdown.optionsPrice).toBeCloseTo(10, 2);
    expect(contourOnly.totalPrice).toBeCloseTo(110, 2);

    const bothSelected = evaluatePricingPreviewFromTree({
      treeJson: tree,
      widthIn: 12,
      heightIn: 12,
      quantity: 1,
      pbv2ExplicitSelections: {
        contour_cutting: { value: "yes" },
        weed_and_tape: { value: "yes" },
      },
      debug: true,
    });

    expect(bothSelected.breakdown.basePrice).toBeCloseTo(100, 2);
    expect(bothSelected.breakdown.optionsPrice).toBeCloseTo(35, 2);
    expect(bothSelected.totalPrice).toBeCloseTo(135, 2);

    const hiddenWeed = evaluatePricingPreviewFromTree({
      treeJson: tree,
      widthIn: 12,
      heightIn: 12,
      quantity: 1,
      pbv2ExplicitSelections: {
        contour_cutting: { value: "no" },
        weed_and_tape: { value: "yes" },
      },
      debug: true,
    });

    expect(hiddenWeed.debug?.runtimeSelectionContext?.selectedChoices.weed_and_tape).toBeUndefined();
    expect(hiddenWeed.breakdown.optionsPrice).toBeCloseTo(0, 2);
    expect(hiddenWeed.totalPrice).toBeCloseTo(100, 2);
  });

  test("ACM thickness can set base sqft pricing while print sides and contour cutting remain additive", () => {
    const tree = makeAcmTree();
    const selections = {
      thickness: { value: "3mm" },
      printSides: { value: "double" },
      finish: { value: "contour" },
    };

    const result = evaluatePricingPreviewFromTree({
      treeJson: tree,
      widthIn: 24,
      heightIn: 36,
      quantity: 1,
      pbv2ExplicitSelections: selections,
      debug: true,
    });

    expect(result.breakdown.basePrice).toBeCloseTo(15, 2);
    expect(result.breakdown.optionsPrice).toBeCloseTo(5, 2);
    expect(result.breakdown.total).toBeCloseTo(20, 2);

    const runtimeSelectionContext = pbv2ToRuntimeSelectionContext(tree, selections, {
      widthIn: 24,
      heightIn: 36,
      quantity: 1,
    });

    expect(runtimeSelectionContext.appliedPricingOverrides).toEqual([
      {
        selectionKey: "thickness",
        optionLabel: "Thickness",
        choiceValue: "3mm",
        choiceLabel: "3mm ACM",
        mode: "set_base_rate",
        amount: 250,
        unit: "perSqft",
        appliesTo: "area",
        label: "ACM 3mm base rate",
      },
    ]);
  });

  test("conflicting active set_base_rate overrides for the same unit throw instead of guessing", () => {
    const tree = {
      ...makeAcmTree(),
      rootNodeIds: ["thickness", "materialGrade"],
      nodes: {
        ...makeAcmTree().nodes,
        materialGrade: {
          id: "materialGrade",
          type: "INPUT",
          kind: "question" as const,
          label: "Material Grade",
          input: {
            type: "select" as const,
            selectionKey: "materialGrade",
          },
          choices: [
            {
              value: "premium",
              label: "Premium Grade",
              pricingOverride: {
                mode: "set_base_rate" as const,
                amount: 325,
                unit: "perSqft" as const,
                appliesTo: "area" as const,
              },
            },
          ],
        },
      },
    };

    expect(() =>
      evaluatePricingPreviewFromTree({
        treeJson: tree,
        widthIn: 24,
        heightIn: 36,
        quantity: 1,
        pbv2ExplicitSelections: {
          thickness: { value: "3mm" },
          materialGrade: { value: "premium" },
        },
      })
    ).toThrow(/Conflicting PBV2 pricing overrides/i);
  });
});
