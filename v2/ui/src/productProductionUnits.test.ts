import assert from "node:assert/strict";
import {
  conditionalProductionUnitSpecification,
  conditionLabel,
  conditionToken,
  presetProductionUnitSpecification,
  productionUnitAuthoringMode,
} from "./productProductionUnits";

const options = [{ optionId: "opt_sides", selectionKey: "print_sides", label: "Print Sides", nodeImpact: null, choices: [{ choiceValue: "single_sided", label: "Single sided", impact: null, editable: true }, { choiceValue: "double_sided", label: "Double sided", impact: null, editable: true }] }];
assert.deepEqual(presetProductionUnitSpecification("front"), { schemaVersion: 1, rules: [{ key: "front", side: "front" }] });
assert.deepEqual(presetProductionUnitSpecification("front-back"), { schemaVersion: 1, rules: [{ key: "front", side: "front" }, { key: "back", side: "back" }] });
const conditional = conditionalProductionUnitSpecification("always", conditionToken("print_sides", "double_sided"), options);
assert.equal(productionUnitAuthoringMode(conditional), "conditional");
assert.deepEqual(conditional.rules, [{ key: "front", side: "front" }, { key: "back", side: "back", when: { selectionKey: "print_sides", equals: "double_sided" } }]);
assert.equal(conditionLabel(conditional.rules[1]?.when, options), "When Print Sides = Double sided");
assert.throws(() => conditionalProductionUnitSpecification("always", conditionToken("other", "double_sided"), options), /valid Product Option/i);
console.log("Conditional production-unit authoring tests passed.");
