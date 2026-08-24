import assert from "node:assert/strict";
import {
  optionIdMappingFromSaved,
  remapProductBuilderDraftOptionReferences,
} from "../ProductBuilderReference";

const before: any = {
  general: { productionUnitSpecification: { schemaVersion: 1, rules: [{ key: "front", when: { selectionKey: "new:finish", equals: "matte" } }] } },
  options: [{ optionId: "new:finish", label: "Finish", inputType: "select", required: false, defaultValue: "matte", choices: [{ choiceValue: "matte", label: "Matte" }], canRemove: true }],
  optionRules: [{
    id: "rule-finish",
    when: { all: [{ optionGroup: "new:finish", operator: "equals", value: "matte" }] },
    then: [{ type: "show", targetOptionGroup: "new:finish" }],
    else: [{ type: "clear", targetOptionGroup: "new:finish" }],
  }],
  pricing: {},
  formula: { expression: "", variables: {}, allowRotation: true, rotationControl: { optionId: "new:finish", allowWhenChoiceValues: ["matte"] } },
  matrix: { dimensions: [{ selectionKey: "new:finish" }], rows: [{ combination: { "new:finish": "matte" } }] },
  impacts: [{ optionId: "new:finish", selectionKey: "new:finish", choices: [] }],
  recipe: [{ condition: { type: "selected", optionId: "new:finish", choiceValue: "matte" } }],
  routing: { kind: "unconfigured" },
};

const saved: any = [{ ...before.options[0], optionId: "opt_finish" }];
const mapping = optionIdMappingFromSaved(before.options, saved);
assert.deepEqual(mapping, { "new:finish": "opt_finish" });

const after: any = remapProductBuilderDraftOptionReferences(before, mapping);
assert.equal(after.options[0].optionId, "opt_finish");
assert.equal(after.formula.rotationControl.optionId, "opt_finish");
assert.equal(after.matrix.dimensions[0].selectionKey, "opt_finish");
assert.equal(after.matrix.rows[0].combination.opt_finish, "matte");
assert.equal(after.impacts[0].optionId, "opt_finish");
assert.equal(after.impacts[0].selectionKey, "opt_finish");
assert.equal(after.recipe[0].condition.optionId, "opt_finish");
assert.equal(after.general.productionUnitSpecification.rules[0].when.selectionKey, "opt_finish");
assert.equal(after.optionRules[0].when.all[0].optionGroup, "opt_finish");
assert.equal(after.optionRules[0].then[0].targetOptionGroup, "opt_finish");
assert.equal(after.optionRules[0].else[0].targetOptionGroup, "opt_finish");
assert.equal(after.formula.rotationControl.allowWhenChoiceValues[0], "matte", "choice values are already canonical and must not be remapped");

console.log("Product Builder option identity remapping tests passed.");
