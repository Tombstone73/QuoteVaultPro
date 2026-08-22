import { describe, expect, test } from "@jest/globals";
import { formulaFromTree } from "../../infrastructure/products/postgresProductVersionLifecycle";

describe("legacy Product Formula Draft reader",()=>{
  test("exposes the exact compatibility expression and adoption availability without making ordinary Formula edits writable",()=>{
    const value=formulaFromTree({
      product_id:"product-a",measurement_mode:"dimensions_required",product_formula_id:null,pricing_profile_config:{},pricing_engine:null,product_formula:"ceil((w * h) / 144) * q * p",draft_id:"draft-a",draft_updated_at:new Date("2026-08-18T01:00:00.000Z"),draft_tree_json:{nodes:{},rootNodeIds:[],meta:{}},formula_id:null,formula_name:null,formula_expression:null,formula_config:null,
    } as any);
    expect(value).toMatchObject({source:"unsupported_legacy",expression:"",legacyExpression:"ceil((w * h) / 144) * q * p",canAdoptLegacyFormula:true,editable:false,expressionEditable:false,variablesEditable:false});
  });

  test("does not advertise adoption for an unsupported legacy expression",()=>{
    const value=formulaFromTree({
      product_id:"product-a",measurement_mode:"dimensions_required",product_formula_id:null,pricing_profile_config:{},pricing_engine:null,product_formula:"unknown_legacy_function(q)",draft_id:"draft-a",draft_updated_at:new Date("2026-08-18T01:00:00.000Z"),draft_tree_json:{nodes:{},rootNodeIds:[],meta:{}},formula_id:null,formula_name:null,formula_expression:null,formula_config:null,
    } as any);
    expect(value).toMatchObject({source:"unsupported_legacy",legacyExpression:"unknown_legacy_function(q)",canAdoptLegacyFormula:false});
  });
});
