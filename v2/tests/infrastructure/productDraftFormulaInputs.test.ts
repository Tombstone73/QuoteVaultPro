import { describe, expect, test } from "@jest/globals";
import { draftMeasurementMode, formulaFromTree } from "../../infrastructure/products/postgresProductVersionLifecycle";
import { productFormulaInputsFromLibraryConfig, validateProductFormulaInput } from "../../src/modules/products/productFormulaInputs";

const libraryRow = {
  product_id: "product-a",
  measurement_mode: "dimensions_required",
  product_formula_id: "formula-a",
  pricing_engine: "matrix_formula",
  product_formula: null,
  formula_id: "formula-a",
  formula_name: "4x8 Sheets with rounding",
  formula_expression: "sheet_consumption_sqft(w,h,q,sheet_width,sheet_length,usable_drop_min,billable_length_increment,minimum_billable_sqft) * base_price",
  formula_config: { variables: { sheet_width: 48, sheet_length: 96, usable_drop_min: 24, billable_length_increment: 12, minimum_billable_sqft: 3, unsupported: 99 } },
  draft_id: "draft-a",
  draft_updated_at: new Date("2026-08-21T00:00:00.000Z"),
  draft_tree_json: { meta: { pricingFormula: "copied expression", formulaVariables: { sheet_width: 48, sheet_length: 96, usable_drop_min: 24, billable_length_increment: 12, minimum_billable_sqft: 3 }, pricingV2: { allowRotation: true } } },
};

describe("ProductVersion Formula Library inputs", () => {
  test("uses only declared supported library inputs with their canonical validation", () => {
    const inputs = productFormulaInputsFromLibraryConfig(libraryRow.formula_config);
    expect(inputs.map((input) => input.key)).toEqual(["sheet_width", "sheet_length", "usable_drop_min", "billable_length_increment", "minimum_billable_sqft"]);
    expect(validateProductFormulaInput(inputs[0]!, 0)).toBeNull();
    expect(validateProductFormulaInput(inputs[2]!, 0)).toBe(0);
  });

  test("keeps the shared expression read only while exposing ProductVersion inputs", () => {
    const value = formulaFromTree(libraryRow as any)!;
    expect(value).toMatchObject({
      source: "library_product_inputs_editable",
      editable: true,
      expressionEditable: false,
      variablesEditable: true,
      rotationEditable: true,
      expression: libraryRow.formula_expression,
      allowRotation: true,
    });
    expect(value.inputs.map((input) => input.key)).toEqual(["sheet_width", "sheet_length", "usable_drop_min", "billable_length_increment", "minimum_billable_sqft"]);
  });

  test("uses the saved Draft measurement mode before the Product identity fallback", () => {
    expect(draftMeasurementMode({ meta: { general: { measurementMode: "quantity_only" } } }, "dimensions_required")).toBe("quantity_only");
    expect(draftMeasurementMode({ meta: { general: { measurementMode: "invalid" } } }, "dimensions_required")).toBe("dimensions_required");
  });
});
