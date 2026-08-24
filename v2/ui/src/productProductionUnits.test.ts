import assert from "node:assert/strict";
import {
  conditionalProductionUnitSpecification,
  conditionLabel,
  conditionToken,
  presetProductionUnitSpecification,
  productionUnitDisplayPage,
  productionUnitAuthoringMode,
  withProductionUnitDisplayPage,
  withProductionUnitLayer,
  withProductionUnitSide,
} from "./productProductionUnits";

const options = [{ optionId: "opt_sides", selectionKey: "print_sides", label: "Print Sides", nodeImpact: null, nodeImpacts: [], choices: [{ choiceValue: "single_sided", label: "Single sided", impact: null, impacts: [], override: null, editable: true }, { choiceValue: "double_sided", label: "Double sided", impact: null, impacts: [], override: null, editable: true }] }];
assert.deepEqual(presetProductionUnitSpecification("front"), { schemaVersion: 1, rules: [{ key: "front", side: "front" }] });
assert.deepEqual(presetProductionUnitSpecification("front-back"), { schemaVersion: 1, rules: [{ key: "front", side: "front" }, { key: "back", side: "back" }] });
const conditional = conditionalProductionUnitSpecification("always", conditionToken("print_sides", "double_sided"), options);
assert.equal(productionUnitAuthoringMode(conditional), "conditional");
assert.deepEqual(conditional.rules, [{ key: "front", side: "front" }, { key: "back", side: "back", when: { selectionKey: "print_sides", equals: "double_sided" } }]);
assert.equal(conditionLabel(conditional.rules[1]?.when, options), "When Print Sides = Double sided");
assert.throws(() => conditionalProductionUnitSpecification("always", conditionToken("other", "double_sided"), options), /valid Product Option/i);

const advancedUnit = { key: "front.white", side: "front" as const, sourcePageIndex: 0, layerKey: "white", layerOrder: 0, when: { selectionKey: "print_sides", equals: "double_sided" } };
assert.equal(productionUnitDisplayPage(advancedUnit), "1", "The UI must display source pages one-based.");
assert.deepEqual(withProductionUnitDisplayPage(advancedUnit, 3), { ...advancedUnit, sourcePageIndex: 2 }, "The UI must persist source pages zero-based.");
assert.throws(() => withProductionUnitDisplayPage(advancedUnit, 0), /positive integers/i);
assert.deepEqual(withProductionUnitDisplayPage(advancedUnit, null), { key: "front.white", side: "front", layerKey: "white", layerOrder: 0, when: advancedUnit.when }, "Clearing a source page must remove only its optional field.");
assert.deepEqual(withProductionUnitSide(advancedUnit, "back"), { ...advancedUnit, side: "back" });
assert.deepEqual(withProductionUnitSide(advancedUnit, ""), { key: "front.white", sourcePageIndex: 0, layerKey: "white", layerOrder: 0, when: advancedUnit.when }, "A unit may intentionally be side-agnostic.");
assert.deepEqual(withProductionUnitLayer(advancedUnit, "ink", 2), { ...advancedUnit, layerKey: "ink", layerOrder: 1 }, "The UI must persist layer order zero-based.");
assert.throws(() => withProductionUnitLayer(advancedUnit, "ink", 0), /positive integer/i);
assert.deepEqual(withProductionUnitLayer(advancedUnit, "", 2), { key: "front.white", side: "front", sourcePageIndex: 0, when: advancedUnit.when }, "Layer key and order are removed together.");
assert.deepEqual(withProductionUnitLayer(advancedUnit, "white", null), { key: "front.white", side: "front", sourcePageIndex: 0, when: advancedUnit.when }, "A partial layer cannot be persisted.");
console.log("Conditional production-unit authoring tests passed.");
