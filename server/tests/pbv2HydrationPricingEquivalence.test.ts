import { describe, expect, test } from "@jest/globals";
import { evaluateOptionTreeV2 } from "../services/optionTreeV2Evaluator";

describe("equivalent PBV2 percentage basis formatting", () => {
  const tree = (explicitBasis: boolean) => ({
    schemaVersion: 2,
    status: "DRAFT",
    nodes: {
      contour: {
        id: "contour", kind: "question", type: "INPUT", status: "ENABLED", label: "Contour Cutting",
        input: { type: "select", selectionKey: "contour", defaultValue: "no" },
        choices: [
          { value: "no", label: "No" },
          { value: "yes", label: "Yes", pricingImpact: [{ mode: "addPercent", percent: 10, ...(explicitBasis ? { basis: "base" } : {}) }] },
        ],
      },
    },
    edges: [],
    rootNodeIds: ["contour"],
  });

  test.each([[1, 4.40, 0.44], [10, 3.50, 0.35]])(
    "quantity %i: adding the evaluator's default base basis preserves prices",
    (quantity, basePrice, expectedSurcharge) => {
      for (const choice of ["no", "yes"]) {
        const selections = { schemaVersion: 2, selected: { contour: { value: choice } } };
        const input = { selections, width: 24, height: 18, quantity, basePrice };
        const before = evaluateOptionTreeV2({ ...input, tree: tree(false) });
        const after = evaluateOptionTreeV2({ ...input, tree: tree(true) });
        expect(after.optionsPrice).toBe(before.optionsPrice);
        expect(before.optionsPrice).toBe(choice === "yes" ? expectedSurcharge : 0);
      }
    },
  );
});
