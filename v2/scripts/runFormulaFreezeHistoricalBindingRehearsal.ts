/**
 * Explicit, single-binding rehearsal for the historical Formula freeze.
 *
 * Default mode is BEGIN READ ONLY and can never write.  --apply additionally
 * requires FORMULA_FREEZE_REHEARSAL_WRITE_CONFIRMATION, an exact target, and
 * one explicit ProductVersion / FormulaRevision tuple.  It never uses
 * DATABASE_URL, MIGRATION_DATABASE_URL, DIRECT_DATABASE_URL, or TEST_DATABASE_URL.
 *
 * Usage (dry-run):
 *   FORMULA_FREEZE_REHEARSAL_DATABASE_URL=... npm run v2:formula:freeze:rehearsal -- \
 *     --organization-id ... --product-id ... --product-version-id ... --formula-id ... \
 *     --formula-revision-id ... --input-values-json '{}'
 *
 * Add --apply only after an approved disposable-clone rehearsal. This script
 * does not create Formulas or revisions; it can only bind an existing pair.
 */
import { createHash } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import type { OperationContext } from "../src/application/operation.js";
import type { Principal } from "../src/authorization/principals.js";
import { PermissionSetPrincipalIssuer } from "../src/authorization/permissionSets.js";
import { validateFormulaRevisionInputValues, type FormulaDeclaredInput } from "../src/modules/pricing/formulaDomain.js";
import { canonicalJson } from "../src/modules/shared/commercialValues.js";
import { PostgresPermissionAuthorityReader } from "../infrastructure/authorization/postgresPermissionAuthorityRead.js";
import { FormulaDomainApplicationService } from "../src/modules/pricing/formulaDomain.js";
import { selectFormulaFreezeRehearsalConnection } from "../src/modules/pricing/formulaFreezeRehearsalTargetIdentity.js";
import { PostgresFormulaDomainTransactionRunner } from "../infrastructure/pricing/postgresFormulaDomain.js";

type Lifecycle = "ACTIVE" | "DEPRECATED" | "DRAFT";
type Binding = Readonly<{ formulaId: string; formulaRevisionId: string; inputValues: unknown }>;
type State = Readonly<{ organizationId: string; productId: string; productVersionId: string; lifecycle: Lifecycle; treeHash: string; revisionHash: string; binding?: Binding }>;
const required = (value: string | undefined, name: string): string => { const value1 = value?.trim(); if (!value1) throw new Error(`${name} is required.`); return value1; };
const arg = (name: string): string => { const index = process.argv.indexOf(name); return required(index < 0 ? undefined : process.argv[index + 1], name); };
const exactFlag = (name: string) => process.argv.filter((value) => value === name).length === 1;
// ProductVersion JSON is semantically unordered.  The immutable-state proof
// must not depend on the key order returned by a particular PostgreSQL driver.
const digest = (value: unknown) => createHash("sha256").update(canonicalJson(value)).digest("hex");
const parseInputValues = (): Readonly<Record<string, unknown>> => {
  const raw = arg("--input-values-json");
  let value: unknown;
  try { value = JSON.parse(raw); } catch { throw new Error("--input-values-json must be valid JSON."); }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("--input-values-json must be a JSON object.");
  return value as Record<string, unknown>;
};

const loadState = async (client: PoolClient, input: Readonly<{ organizationId: string; productId: string; productVersionId: string; formulaId: string; formulaRevisionId: string }>): Promise<Readonly<{ state: State; declaredInputs: readonly FormulaDeclaredInput[] }>> => {
  const result = await client.query<{
    organization_id: string; product_id: string; product_version_id: string; status: Lifecycle; tree_json: unknown;
    formula_id: string; formula_revision_id: string; expression: string; declared_inputs: unknown;
    bound_formula_id: string | null; bound_formula_revision_id: string | null; bound_input_values: unknown;
  }>(`SELECT version.organization_id,version.product_id,version.id product_version_id,version.status,version.tree_json,
      revision.formula_id,revision.id formula_revision_id,revision.expression,revision.declared_inputs,
      binding.formula_id bound_formula_id,binding.formula_revision_id bound_formula_revision_id,binding.input_values bound_input_values
    FROM pbv2_tree_versions version
    JOIN formula_revisions revision ON revision.organization_id=version.organization_id AND revision.formula_id=$4 AND revision.id=$5
    LEFT JOIN v2_product_version_formula_revision_bindings binding ON binding.organization_id=version.organization_id AND binding.product_id=version.product_id AND binding.product_version_id=version.id
    WHERE version.organization_id=$1 AND version.product_id=$2 AND version.id=$3`,
    [input.organizationId, input.productId, input.productVersionId, input.formulaId, input.formulaRevisionId]);
  const row = result.rows[0];
  if (!row) throw new Error("The explicit ProductVersion and FormulaRevision must exist in the same tenant and product scope.");
  if (row.status === "DRAFT") throw new Error("Historical freeze rehearsal accepts ACTIVE or DEPRECATED ProductVersions only; use the Draft lifecycle for Draft bindings.");
  if (row.status !== "ACTIVE" && row.status !== "DEPRECATED") throw new Error("The target ProductVersion has an unsupported lifecycle state.");
  if (!Array.isArray(row.declared_inputs)) throw new Error("FormulaRevision declared_inputs is malformed.");
  return {
    state: { organizationId: row.organization_id, productId: row.product_id, productVersionId: row.product_version_id, lifecycle: row.status,
      treeHash: digest(row.tree_json), revisionHash: digest({ expression: row.expression, declaredInputs: row.declared_inputs }),
      ...(row.bound_formula_id ? { binding: { formulaId: row.bound_formula_id, formulaRevisionId: row.bound_formula_revision_id!, inputValues: row.bound_input_values } } : {}) },
    declaredInputs: row.declared_inputs as FormulaDeclaredInput[],
  };
};
const sameBinding = (actual: Binding | undefined, expected: Binding) => Boolean(actual && actual.formulaId === expected.formulaId && actual.formulaRevisionId === expected.formulaRevisionId && canonicalJson(actual.inputValues ?? {}) === canonicalJson(expected.inputValues));
const output = (value: unknown) => process.stdout.write(`${JSON.stringify(value)}\n`);
const context = (organizationId: string, principal: Principal, businessRequestId: string): OperationContext => ({
  organizationId,
  operationId: businessRequestId,
  businessRequest: { id: businessRequestId, payloadFingerprint: businessRequestId },
  principal,
});

async function main(): Promise<void> {
  const apply = exactFlag("--apply");
  if (process.argv.filter((value) => value === "--dry-run").length > 1 || (apply && exactFlag("--dry-run"))) throw new Error("Choose at most one mode; dry-run is the default.");
  if (apply && process.env.FORMULA_FREEZE_REHEARSAL_WRITE_CONFIRMATION !== "APPLY_DISPOSABLE_FORMULA_FREEZE_REHEARSAL") {
    throw new Error("--apply requires FORMULA_FREEZE_REHEARSAL_WRITE_CONFIRMATION=APPLY_DISPOSABLE_FORMULA_FREEZE_REHEARSAL.");
  }
  const input = { organizationId: arg("--organization-id"), productId: arg("--product-id"), productVersionId: arg("--product-version-id"), formulaId: arg("--formula-id"), formulaRevisionId: arg("--formula-revision-id") };
  const actorUserId = apply ? arg("--actor-user-id") : undefined;
  const businessRequestId = apply ? arg("--business-request-id") : undefined;
  const rawInputValues = parseInputValues();
  const connection = selectFormulaFreezeRehearsalConnection(process.env);
  output({ mode: apply ? "apply" : "dry_run", target: connection.target, connectionSource: "FORMULA_FREEZE_REHEARSAL_DATABASE_URL", connection: "not_opened", targetProductVersionId: input.productVersionId, targetFormulaRevisionId: input.formulaRevisionId });
  const pool = new Pool({ connectionString: connection.connectionString, max: 1 });
  try {
    const client = await pool.connect();
    let transactionOpen = false;
    let clientReleased = false;
    try {
      await client.query("BEGIN READ ONLY"); transactionOpen = true;
      // Rehearsals remain clone-only, but their write path must exercise the
      // same fresh permission-set issuance as the deployed Formula runtime.
      const principal = apply
        ? await new PermissionSetPrincipalIssuer(new PostgresPermissionAuthorityReader(client)).issue(
          { subjectId: actorUserId!, authenticationMethod: "session", authenticatedAt: new Date() },
          { organizationId: input.organizationId },
        )
        : undefined;
      const before = await loadState(client, input);
      const normalizedValues = validateFormulaRevisionInputValues(before.declaredInputs, rawInputValues);
      const expected: Binding = { formulaId: input.formulaId, formulaRevisionId: input.formulaRevisionId, inputValues: normalizedValues };
      if (!apply) {
        await client.query("ROLLBACK"); transactionOpen = false;
        output({ mode: "dry_run", lifecycle: before.state.lifecycle, outcome: sameBinding(before.state.binding, expected) ? "replay" : before.state.binding ? "conflict" : "would_bind", bindingRequired: !before.state.binding, inputValues: normalizedValues, before: before.state });
        return;
      }
      if (before.state.binding && !sameBinding(before.state.binding, expected)) throw new Error("Conflict: ProductVersion already has a different immutable FormulaRevision binding.");
      await client.query("ROLLBACK"); transactionOpen = false;
      client.release();
      clientReleased = true;
      const service = new FormulaDomainApplicationService(new PostgresFormulaDomainTransactionRunner(pool));
      const saved = await service.freezeHistoricalProductVersion(context(input.organizationId, principal!, businessRequestId!), {
        businessRequestId: businessRequestId!, productVersionId: input.productVersionId, formulaRevisionId: input.formulaRevisionId,
        inputValues: normalizedValues, expectedLifecycle: before.state.lifecycle,
      });
      if (!saved.ok) throw new Error(`${saved.error.code}: ${saved.error.publicMessage}`);
      if (saved.value.formulaId !== input.formulaId || saved.value.formulaRevisionId !== input.formulaRevisionId) throw new Error("Safety check failed: canonical service returned a different FormulaRevision binding.");
      const verify = await pool.connect();
      let verifyTransactionOpen = false;
      try {
        await verify.query("BEGIN READ ONLY"); verifyTransactionOpen = true;
        const after = await loadState(verify, input);
        if (!sameBinding(after.state.binding, expected)) throw new Error("Conflict: canonical service did not persist the exact FormulaRevision binding.");
        if (before.state.treeHash !== after.state.treeHash || before.state.revisionHash !== after.state.revisionHash) throw new Error("Safety check failed: historical ProductVersion tree or FormulaRevision changed.");
        await verify.query("ROLLBACK"); verifyTransactionOpen = false;
        output({ mode: "apply", lifecycle: after.state.lifecycle, outcome: before.state.binding ? "replay" : "inserted", bindingRequired: false, inputValues: normalizedValues, before: before.state, after: after.state, canonicalOperation: "pricing.formula.historical_freeze.v1" });
      } finally { if (verifyTransactionOpen) await verify.query("ROLLBACK").catch(() => undefined); verify.release(); }
      return;
    } finally { if (transactionOpen) await client.query("ROLLBACK").catch(() => undefined); if (!clientReleased) client.release(); }
  } finally { await pool.end(); }
}
void main().catch((error) => { process.stderr.write(`[formula-freeze-historical-binding-rehearsal] ${error instanceof Error ? error.message : String(error)}\n`); process.exitCode = 1; });
