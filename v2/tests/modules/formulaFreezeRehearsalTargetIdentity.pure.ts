import assert from "node:assert/strict";
import { selectFormulaFreezeRehearsalConnection } from "../../src/modules/pricing/formulaFreezeRehearsalTargetIdentity.js";

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
process.stdout.write("Formula freeze rehearsal target-identity pure tests passed.\n");
