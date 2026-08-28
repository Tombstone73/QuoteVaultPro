import { describe, expect, test } from "@jest/globals";
import { presentPbv2FindingForOperator } from "../validationPresentation";
import type { Finding } from "../findings";

describe("presentPbv2FindingForOperator", () => {
  test("turns a material conflict into operator-facing copy with material names", () => {
    const finding: Finding = {
      code: "PBV2_E_CHOICE_MATERIAL_OVERRIDE_CONFLICT",
      severity: "ERROR",
      message: "materialOverride conflicts with inventoryConsumption material references",
      path: "tree.nodes.thickness.choices[0].materialOverride",
      context: {
        optionGroupLabel: "Thickness",
        choiceLabel: "2mm",
        materialOverrideId: "oppbogga-2mm",
        conflictingInventoryMaterialIds: ["foam-board"],
      },
    };

    expect(presentPbv2FindingForOperator(finding, (id) => ({
      "oppbogga-2mm": "OppBogga Recycled Board 2mm",
      "foam-board": "Foam Board 3/16",
    })[id])).toEqual({
      title: "Material configuration conflict",
      message: expect.stringContaining("Thickness — 2mm selects OppBogga Recycled Board 2mm, but its inventory consumption uses Foam Board 3/16."),
    });
  });

  test("keeps missing weight as a warning with action-oriented copy", () => {
    const finding: Finding = {
      code: "PBV2_W_WEIGHT_MISSING",
      severity: "WARNING",
      message: "Product has no weight defined",
      path: "tree",
    };

    expect(presentPbv2FindingForOperator(finding)).toEqual({
      title: "Shipping weight not configured",
      message: "No shipping weight is configured. Calculated shipping weight will be 0 until a base or option weight is added.",
    });
  });
});
