import assert from "node:assert/strict";
import { publishGateForDraft, type DirtySection } from "../ProductBuilderReference";

const gate = (overrides: Partial<Parameters<typeof publishGateForDraft>[0]> = {}) => publishGateForDraft({
  canEdit: true,
  persisted: true,
  dirty: new Set<DirtySection>(),
  saving: false,
  publishing: false,
  localErrors: 0,
  saveError: null,
  requiresReconciliation: false,
  ...overrides,
});

assert.deepEqual(gate(), { allowed: true });

for (const section of ["general", "options", "pricing", "formula", "matrix", "impacts", "recipe", "routing"] as const) {
  const result = gate({ dirty: new Set([section]) });
  assert.equal(result.allowed, false, `${section} must block publishing until saved`);
  assert.match(result.reason ?? "", /Save Changes before publishing/);
}

assert.equal(gate({ dirty: new Set(["general", "options", "pricing"]) }).allowed, false);
assert.equal(gate({ saving: true }).allowed, false);
assert.equal(gate({ publishing: true }).allowed, false);
assert.equal(gate({ saveError: "Save stopped after options." }).allowed, false);
assert.equal(gate({ requiresReconciliation: true }).allowed, false);
assert.equal(gate({ localErrors: 1 }).allowed, false);
assert.equal(gate({ persisted: false }).allowed, false);
assert.equal(gate({ canEdit: false }).allowed, false);

console.log("Product Builder publish-gate state tests passed.");
