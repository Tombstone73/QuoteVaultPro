import { buildDuplicateFormulaInput } from "../formulaUtils";

const BASE_SOURCE = {
  name: "Sheet Vinyl",
  code: "SHEET_VINYL",
  description: "Sheet vinyl pricing formula",
  pricingProfileKey: "flat_goods",
  expression: "sheet_consumption_sqft(w,h,q,sheet_width,sheet_length,24,12,3) * base_price",
  config: {
    variables: { sheet_width: 48, sheet_length: 96 },
    someOtherKey: "value",
  },
};

describe("buildDuplicateFormulaInput", () => {
  it("appends ' Copy' to name", () => {
    const result = buildDuplicateFormulaInput(BASE_SOURCE);
    expect(result.name).toBe("Sheet Vinyl Copy");
  });

  it("appends _COPY to code", () => {
    const result = buildDuplicateFormulaInput(BASE_SOURCE);
    expect(result.code).toBe("SHEET_VINYL_COPY");
  });

  it("sets isActive to false", () => {
    const result = buildDuplicateFormulaInput(BASE_SOURCE);
    expect(result.isActive).toBe(false);
  });

  it("preserves expression", () => {
    const result = buildDuplicateFormulaInput(BASE_SOURCE);
    expect(result.expression).toBe(BASE_SOURCE.expression);
  });

  it("preserves description", () => {
    const result = buildDuplicateFormulaInput(BASE_SOURCE);
    expect(result.description).toBe(BASE_SOURCE.description);
  });

  it("preserves pricingProfileKey", () => {
    const result = buildDuplicateFormulaInput(BASE_SOURCE);
    expect(result.pricingProfileKey).toBe("flat_goods");
  });

  it("deep-clones config.variables so mutations don't affect source", () => {
    const result = buildDuplicateFormulaInput(BASE_SOURCE);
    const vars = result.config!.variables as Record<string, number>;
    vars.sheet_width = 999;
    expect((BASE_SOURCE.config.variables as Record<string, number>).sheet_width).toBe(48);
  });

  it("does not include an id field", () => {
    const result = buildDuplicateFormulaInput(BASE_SOURCE);
    expect("id" in result).toBe(false);
  });

  it("handles null config gracefully", () => {
    const result = buildDuplicateFormulaInput({ ...BASE_SOURCE, config: null });
    expect(result.config).toBeNull();
  });

  it("handles null code — falls back to 'COPY'", () => {
    const result = buildDuplicateFormulaInput({ ...BASE_SOURCE, code: null });
    expect(result.code).toBe("COPY");
  });

  it("handles null description — falls back to empty string", () => {
    const result = buildDuplicateFormulaInput({ ...BASE_SOURCE, description: null });
    expect(result.description).toBe("");
  });

  it("handles null expression — falls back to empty string", () => {
    const result = buildDuplicateFormulaInput({ ...BASE_SOURCE, expression: null });
    expect(result.expression).toBe("");
  });
});
