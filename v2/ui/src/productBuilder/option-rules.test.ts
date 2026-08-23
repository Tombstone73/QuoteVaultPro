import assert from "node:assert/strict";
import { createProductDraftOptionRule, optionRuleOptions } from "./option-rules";

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
  choices: options[0].choices,
});

const rule = createProductDraftOptionRule(options);
assert.match(rule.id, /^rule_/);
assert.deepEqual(rule.when, { all: [{ optionGroup: "pole_pockets", operator: "equals", value: "no" }] });
assert.deepEqual(rule.then, [{ action: "show", targetOptionGroup: "pole_pockets" }]);

console.log("Product Builder conditional Option rule authoring tests passed.");
