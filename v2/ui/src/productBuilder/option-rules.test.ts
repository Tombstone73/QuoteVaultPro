import assert from "node:assert/strict";
import { createProductDraftOptionRule, initialRuleValue, optionRuleOptions } from "./option-rules";

const options: any = [
  {
    optionId: "opt_pole_pockets",
    selectionKey: "pole_pockets",
    label: "Pole Pockets",
    inputType: "select",
    required: false,
    defaultValue: "no",
    choices: [{ choiceValue: "no", label: "No" }, { choiceValue: "yes", label: "Yes" }],
    canRemove: true,
  },
];

const references = optionRuleOptions(options);
assert.deepEqual(references[0], {
  selectionKey: "pole_pockets",
  label: "Pole Pockets",
  inputType: "select",
  choices: options[0].choices,
});

const rule = createProductDraftOptionRule(options);
assert.match(rule.id, /^rule_/);
assert.deepEqual(rule.when, { all: [{ optionGroup: "pole_pockets", operator: "equals", value: "no" }] });
assert.deepEqual(rule.then, [{ action: "show", targetOptionGroup: "pole_pockets" }]);

assert.equal(initialRuleValue({ selectionKey: "proof", label: "Proof", inputType: "boolean", choices: [] }, false), false);
assert.equal(initialRuleValue({ selectionKey: "copies", label: "Copies", inputType: "number", choices: [] }, false), 0);
assert.deepEqual(initialRuleValue({ selectionKey: "finishes", label: "Finishes", inputType: "multiselect", choices: [{ choiceValue: "matte", label: "Matte" }] }, false), ["matte"]);
assert.deepEqual(initialRuleValue({ selectionKey: "finish", label: "Finish", inputType: "select", choices: [{ choiceValue: "matte", label: "Matte" }, { choiceValue: "gloss", label: "Gloss" }] }, true), ["matte"]);

console.log("Product Builder conditional Option rule authoring tests passed.");
