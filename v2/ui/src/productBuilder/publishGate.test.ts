import assert from "node:assert/strict";
import { publishGateForDraft, stageProductBuilderDraft, type DirtySection } from "../ProductBuilderReference";

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

const initialMatrix = { rows: [{ tiers: [{ min: 1 }, { min: 1 }, { min: 1 }] }] };
const afterSecondTier = stageProductBuilderDraft(initialMatrix, (current) => ({
  ...current,
  rows: current.rows.map((row) => ({ ...row, tiers: row.tiers.map((tier, index) => index === 1 ? { ...tier, min: 10 } : tier) })),
}));
const afterThirdTier = stageProductBuilderDraft(afterSecondTier, (current) => ({
  ...current,
  rows: current.rows.map((row) => ({ ...row, tiers: row.tiers.map((tier, index) => index === 2 ? { ...tier, min: 51 } : tier) })),
}));
assert.deepEqual(afterThirdTier.rows[0].tiers.map((tier) => tier.min), [1, 10, 51], "successive edits compose from the latest staged draft");
assert.deepEqual(initialMatrix.rows[0].tiers.map((tier) => tier.min), [1, 1, 1], "staging must not mutate the rendered snapshot");

console.log("Product Builder publish-gate state tests passed.");
