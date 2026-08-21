import assert from "node:assert/strict";
import { validateProductionUnitConditions } from "../../infrastructure/products/postgresProductVersionLifecycle.js";

const tree = {
  nodes: {
    "opt-sides": {
      id: "opt-sides",
      kind: "question",
      input: { selectionKey: "print_sides" },
      choices: [
        { value: "single_sided", label: "Single sided" },
        { value: "double_sided", label: "Double sided" },
      ],
    },
  },
};
const valid = { schemaVersion: 1 as const, rules: [{ key: "front", side: "front" as const }, { key: "back", side: "back" as const, when: { selectionKey: "print_sides", equals: "double_sided" } }] };
assert.doesNotThrow(() => validateProductionUnitConditions(valid, tree));
assert.throws(() => validateProductionUnitConditions({ ...valid, rules: [{ key: "back", side: "back", when: { selectionKey: "other", equals: "double_sided" } }] }, tree), /Product Draft/i);
assert.throws(() => validateProductionUnitConditions({ ...valid, rules: [{ key: "back", side: "back", when: { selectionKey: "print_sides", equals: "not-a-choice" } }] }, tree), /Product Draft/i);
console.log("Product production-unit condition validation tests passed.");
