import assert from "node:assert/strict";
import { appendNewProductDraftOption, normalizeOptionDefaultForInputType } from "./optionGroups";

const persisted = {
  optionId: "opt_persisted_finish",
  selectionKey: "opt_persisted_finish",
  label: "Finish",
  inputType: "select" as const,
  required: true,
  defaultValue: "matte",
  choices: [{ choiceValue: "matte", label: "Matte" }],
  canRemove: true,
};

const next = appendNewProductDraftOption([persisted]);

assert.equal(next.length, 2);
assert.strictEqual(next[0], persisted, "adding an Option must not replace persisted Option entries");
assert.equal(next[0]?.optionId, "opt_persisted_finish");
assert.match(next[1]?.optionId ?? "", /^new:[0-9a-f-]+$/i, "new Options must use the canonical temporary ID prefix");

assert.equal(normalizeOptionDefaultForInputType("boolean", false), false);
assert.equal(normalizeOptionDefaultForInputType("boolean", "false" as any), null, "boolean defaults must never serialize as UI text");
assert.equal(normalizeOptionDefaultForInputType("number", 12), 12);
assert.equal(normalizeOptionDefaultForInputType("number", "12" as any), null, "number defaults must remain numeric");
assert.deepEqual(normalizeOptionDefaultForInputType("multiselect", "matte"), ["matte"]);

console.log("Product Builder option temporary-ID tests passed.");
