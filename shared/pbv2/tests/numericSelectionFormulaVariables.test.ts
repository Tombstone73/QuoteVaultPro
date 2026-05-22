import { describe, expect, test } from "@jest/globals";

import { buildNumericSelectionFormulaVariables } from "../numericSelectionFormulaVariables";

describe("buildNumericSelectionFormulaVariables", () => {
  test("exposes a numeric option label as a formula variable alias", () => {
    const treeJson = {
      nodes: {
        "opt_765a1b45-7eb5-4b78-972a-0ba612b814d6": {
          id: "opt_765a1b45-7eb5-4b78-972a-0ba612b814d6",
          type: "INPUT",
          status: "ENABLED",
          key: "opt_opt_765a1b45-7eb5-4b78-972a-0ba612b814d6",
          label: "Custom Grommet Quantity",
          input: {
            type: "numeric",
            selectionKey: "opt_opt_765a1b45-7eb5-4b78-972a-0ba612b814d6",
            valueType: "NUMBER",
          },
        },
      },
      edges: [],
    };

    const variables = buildNumericSelectionFormulaVariables({
      treeJson,
      selections: {
        "opt_opt_765a1b45-7eb5-4b78-972a-0ba612b814d6": 6,
      },
    });

    expect(variables.custom_grommet_quantity).toBe(6);
    expect(variables.opt_opt_765a1b45_7eb5_4b78_972a_0ba612b814d6).toBe(6);
  });

  test("does not let a label alias overwrite an existing variable", () => {
    const treeJson = {
      nodes: {
        qty: {
          id: "qty",
          type: "INPUT",
          status: "ENABLED",
          label: "Quantity",
          input: {
            type: "numeric",
            selectionKey: "custom_grommet_quantity",
            valueType: "NUMBER",
          },
        },
        generated: {
          id: "generated",
          type: "INPUT",
          status: "ENABLED",
          label: "Custom Grommet Quantity",
          input: {
            type: "numeric",
            selectionKey: "generated-key",
            valueType: "NUMBER",
          },
        },
      },
      edges: [],
    };

    const variables = buildNumericSelectionFormulaVariables({
      treeJson,
      selections: {
        custom_grommet_quantity: 9,
        "generated-key": 6,
      },
    });

    expect(variables.custom_grommet_quantity).toBe(9);
    expect(variables.generated_key).toBe(6);
  });
});
