import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { selectFormulaFreezeRehearsalConnection } from "../../src/modules/pricing/formulaFreezeRehearsalTargetIdentity.js";
import { canonicalJson } from "../../src/modules/shared/commercialValues.js";

const base = {
  FORMULA_FREEZE_REHEARSAL_DATABASE_URL: "postgresql://secret-user:secret-password@clone.example.internal/clone_db?schema=public&sslmode=require",
  FORMULA_FREEZE_REHEARSAL_EXPECTED_HOST: "clone.example.internal",
  FORMULA_FREEZE_REHEARSAL_EXPECTED_DATABASE: "clone_db",
  FORMULA_FREEZE_REHEARSAL_EXPECTED_SCHEMA: "public",
  FORMULA_FREEZE_REHEARSAL_EXPECTED_ENVIRONMENT: "DISPOSABLE_VALIDATION_CLONE",
};
const selected = selectFormulaFreezeRehearsalConnection(base);
assert.deepEqual(selected.target, { host: "clone.example.internal", database: "clone_db", schema: "public", environment: "DISPOSABLE_VALIDATION_CLONE", sslExpected: true, credentialsRedacted: true });
assert(!JSON.stringify(selected.target).includes("secret"));
assert.throws(() => selectFormulaFreezeRehearsalConnection({ ...base, FORMULA_FREEZE_REHEARSAL_EXPECTED_ENVIRONMENT: "DEV" }), /DISPOSABLE_VALIDATION_CLONE/);
assert.throws(() => selectFormulaFreezeRehearsalConnection({ ...base, TEST_DATABASE_URL: base.FORMULA_FREEZE_REHEARSAL_DATABASE_URL }), /TEST database URL/);
assert.throws(() => selectFormulaFreezeRehearsalConnection({ ...base, FORMULA_FREEZE_REHEARSAL_EXPECTED_HOST: "other.example.internal" }), /target mismatch/);
// The rehearsal's ProductVersion immutability proof compares canonical JSON
// hashes, never a driver-specific object-key order.
const hash = (value: unknown) => createHash("sha256").update(canonicalJson(value)).digest("hex");
assert.equal(hash({ pricing: { minimum: 500, rate: 300 }, meta: { rotation: true } }), hash({ meta: { rotation: true }, pricing: { rate: 300, minimum: 500 } }));
process.stdout.write("Formula freeze rehearsal target-identity pure tests passed.\n");
