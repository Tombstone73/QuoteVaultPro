import { describe, expect, test } from "@jest/globals";

import {
  buildFormulaSaveConfig,
  hydrateFormulaOutputMeaning,
  setFormulaOutputMeaningInConfig,
} from "../pricingFormulaOutputMeaning";

describe("pricing formula output meaning hydration", () => {
  test("missing output meaning hydrates as final dollars", () => {
    expect(hydrateFormulaOutputMeaning(null)).toMatchObject({
      outputMeaning: "final_price",
      hasSavedOutputMeaning: false,
    });
    expect(hydrateFormulaOutputMeaning({ variables: { sheet_width: 48 } })).toMatchObject({
      outputMeaning: "final_price",
      hasSavedOutputMeaning: false,
    });
  });

  test("missing output meaning does not hydrate as billable", () => {
    expect(hydrateFormulaOutputMeaning({}).outputMeaning).not.toBe("billable");
  });

  test("saving without changing selector persists final dollars", () => {
    expect(buildFormulaSaveConfig({ variables: { sheet_width: 48 } })).toMatchObject({
      variables: { sheet_width: 48 },
      formulaOutputMeaning: "final_price",
      outputMeaning: "final_price",
    });
  });

  test("existing billable formula hydrates as billable", () => {
    expect(hydrateFormulaOutputMeaning({ formulaOutputMeaning: "billable" })).toMatchObject({
      outputMeaning: "billable",
      hasSavedOutputMeaning: true,
      rawValue: "billable",
    });
  });

  test("existing final-dollar formula hydrates as final dollars", () => {
    expect(hydrateFormulaOutputMeaning({ outputMeaning: "final_dollars" })).toMatchObject({
      outputMeaning: "final_price",
      hasSavedOutputMeaning: true,
      rawValue: "final_dollars",
    });
  });

  test("explicit selector changes persist the selected value", () => {
    expect(setFormulaOutputMeaningInConfig(null, "billable")).toEqual({
      formulaOutputMeaning: "billable",
      outputMeaning: "billable",
    });
  });
});
