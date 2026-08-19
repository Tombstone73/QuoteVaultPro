import assert from "node:assert/strict";
import { productionRequirementSnapshot, resolveProductionRequirementSnapshot, validateProductionUnitSpecification } from "../../src/modules/shared/productionRequirements.js";

const specification={schemaVersion:1 as const,rules:[
  {key:"front",side:"front" as const},
  {key:"back",side:"back" as const,when:{selectionKey:"print_sides",equals:"double_sided"}},
  {key:"front.white",side:"front" as const,layerKey:"white",layerOrder:0,when:{selectionKey:"white_ink",equals:true}},
  {key:"front.page_1",side:"front" as const,sourcePageIndex:1,when:{selectionKey:"booklet",equals:true}},
]};
const single=resolveProductionRequirementSnapshot(specification,{print_sides:"single_sided",white_ink:false,booklet:false});
assert.deepEqual(single.state==="configured"?single.units.map((x)=>x.key):[],["front"],"single-sided configuration requires only Front.");
const double=resolveProductionRequirementSnapshot(specification,{print_sides:"double_sided",white_ink:true,booklet:true});
assert.deepEqual(double.state==="configured"?double.units.map((x)=>x.key):[],["back","front","front.page_1","front.white"],"configured PBV2 selections, not product capability, determine requirements.");
assert.deepEqual(resolveProductionRequirementSnapshot(undefined,{}),{state:"unconfigured",reason:"product_specification_absent"});
assert.notEqual(single.state==="configured"&&double.state==="configured"?single.specificationFingerprint:undefined,double.state==="configured"?double.specificationFingerprint:undefined,"selection-driven effective requirements receive a new frozen fingerprint.");
assert.throws(()=>resolveProductionRequirementSnapshot({schemaVersion:1,rules:[{key:"front"},{key:"front"}]},{}),/duplicate/i);
assert.throws(()=>resolveProductionRequirementSnapshot({schemaVersion:1,rules:[{key:"Both"}]},{}),/key/i);
assert.deepEqual(validateProductionUnitSpecification({schemaVersion:1,rules:[{key:"front",side:"front"}]}),{schemaVersion:1,rules:[{key:"front",side:"front"}]},"Draft authoring accepts the existing front-unit shape.");
assert.equal(productionRequirementSnapshot(double).state,"configured","frozen configured snapshot remains configured.");
assert.equal(productionRequirementSnapshot(undefined).state,"unconfigured","historical absent configuration is unknown, not zero requirements.");
console.log("[m2.2.1] Production requirement contract tests passed (9 assertions).");
