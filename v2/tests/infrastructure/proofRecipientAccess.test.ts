import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { Pool, PoolClient } from "pg";
import { PostgresProofRecipientAccess } from "../../infrastructure/authorization/postgresProofRecipientAccess.js";
import { PostgresProofingTransactionRunner } from "../../infrastructure/proofing/postgresProofingTransaction.js";
import { ProofingApplicationService, type ProofingMutationResult, type ProofingTransactionRunner } from "../../src/modules/proofing/proofingApplication.js";
import type { OperationContext } from "../../src/application/operation.js";
import { brandedId } from "../../src/modules/shared/commercialValues.js";

const input = { organizationId: "org", proofVersionId: "version", recipientContactId: "contact", staffActorUserId: "staff" };
type Access = { id: string; customer_id: string; status: string };
function fixture(options: { access?: Access; template?: boolean; eligible?: boolean; fail?: string; afterIssue?: boolean; afterAudit?: boolean } = {}) {
  const calls: { sql: string; values: readonly unknown[] }[] = [];
  let state = { access: options.access, assignments: [] as string[], revision: 7, issued: false, deliveries: [] as readonly unknown[][], audits: [] as readonly unknown[][], result: undefined as ProofingMutationResult | undefined };
  let snapshot: typeof state;
  let released = 0;
  const version = () => ({ id: "version", organization_id: "org", proof_work_id: "work", sequence: 1, created_at: new Date("2026-09-01"), created_principal_kind: "staff", created_principal_subject: "staff", created_staff_actor_user_id: "staff", issued_at: state.issued ? new Date("2026-09-02") : null, issued_principal_kind: "staff", issued_principal_subject: "staff", issued_staff_actor_user_id: "staff" });
  const client = {
    async query(sql: string, values: readonly unknown[] = []) {
      calls.push({ sql, values });
      if (options.fail && sql.includes(options.fail)) throw new Error("injected persistence failure");
      let rows: unknown[] = [];
      if (sql === "BEGIN") snapshot = structuredClone(state);
      else if (sql === "ROLLBACK") state = snapshot;
      else if (sql === "COMMIT") { /* Caller owns transaction completion. */ }
      else if (sql.startsWith("SELECT v2_authority_entry") || sql.startsWith("SELECT v2_assert_authority_entry")) { /* Lock protocol is proved separately on native PostgreSQL. */ }
      else if (sql.startsWith("SELECT v2_staff_login_ready")) rows=[{ready:true}];
      else if (sql.includes("SELECT s.authority_revision")) rows=[{authority_revision:state.revision,status:"active",delete_state:"active",is_archived:false}];
      else if (sql.includes("SELECT m.user_id")) rows=[{user_id:"staff",is_active:true,role:"member",is_platform_developer:false}];
      else if (sql.includes("SELECT ps.id")) rows=[{id:"set",name:"Proof",active:true,revision:1,capability_id:"proof.issue"}];
      else if (sql.startsWith("SELECT c.id contact_id")) {
        assert.match(sql, /lower\(btrim\(c.email\)\)/);
        assert.match(sql, /c.organization_id=d.organization_id/);
        assert.match(sql, /c.status='active'/);
        assert.match(sql, /d.contact_id=c.id OR c.customer_id=d.customer_id OR EXISTS/);
        assert.match(sql, /l.organization_id=d.organization_id AND l.customer_id=d.customer_id AND l.contact_id=c.id AND l.status='active'/);
        assert.match(sql, /btrim\(COALESCE\(c.email,''\)\) ~\*/);
        if (options.eligible !== false && values[0] === "org" && values[1] === "version" && values[2] === "contact") rows = [{ contact_id: "contact", customer_id: "customer", email: "recipient@example.com", display_name: "Recipient" }];
      } else if (sql.startsWith("SELECT id,status::text")) {
        assert.deepEqual(values, ["org", "contact"]);
        assert.match(sql, /organization_id=\$1 AND contact_id=\$2 FOR UPDATE/);
        rows = state.access ? [state.access] : [];
      } else if (sql.startsWith("INSERT INTO customer_portal_access")) {
        assert.deepEqual(values, ["org", "customer", "contact", "recipient@example.com", "Recipient", "staff"]);
        assert.match(sql, /'PENDING_INVITE'.*'VIEWER'/);
        state.access = { id: "access", customer_id: "customer", status: "PENDING_INVITE" }; rows = [state.access];
      } else if (sql.startsWith("UPDATE customer_portal_access")) {
        assert.match(sql, /WHERE organization_id=\$1 AND id=\$2/);
        assert.doesNotMatch(sql, /SET.*(?:customer_id|contact_id|status|access_role)=/);
        assert.deepEqual(values, ["org", state.access!.id, "recipient@example.com", "Recipient", "staff"]);
      } else if (sql.startsWith("SELECT id FROM v2_permission_sets")) {
        assert.deepEqual(values, ["org"]);
        assert.match(sql, /source_template_key='customer_full_portal' AND active LIMIT 1/);
        rows = options.template === false ? [] : [{ id: "permission" }];
      } else if (sql.startsWith("INSERT INTO v2_portal_permission_set_assignments")) {
        assert.deepEqual(values, ["org", state.access!.id, "permission"]);
        assert.match(sql, /ON CONFLICT\(organization_id,portal_access_id,permission_set_id\) DO UPDATE SET active=true/);
        if (!state.assignments.includes("permission")) state.assignments.push("permission");
      } else if (sql.startsWith("SELECT v2_authority_changed")) { assert.deepEqual(values, ["org"]); state.revision++; }
      else if (sql.startsWith("UPDATE v2_proof_versions")) { if (!state.issued) { state.issued = true; rows = [version()]; } }
      else if (sql.startsWith("INSERT INTO v2_proof_delivery_jobs")) state.deliveries.push(values);
      else if (sql.startsWith("INSERT INTO v2_audit_events")) state.audits.push(values);
      else if (sql.startsWith("SELECT * FROM v2_proof_versions")) rows = [version()];
      else if (sql.startsWith("SELECT * FROM v2_proof_works")) rows = [{ id: "work", organization_id: "org", order_document_id: "order", order_line_id: "line", created_at: new Date("2026-09-01"), created_principal_kind: "staff", created_principal_subject: "staff", created_staff_actor_user_id: "staff" }];
      else if (sql.startsWith("SELECT proof_version_id,position")) rows = [{ proof_version_id: "version", position: 0, artwork_assignment_id: "assignment", artwork_file_id: "art" }];
      else if (sql.startsWith("SELECT * FROM v2_proof_responses") || sql.startsWith("SELECT id,recipient_contact_id")) { /* Empty projection. */ }
      else throw new Error(`Unexpected mock query: ${sql}`);
      return { rows };
    },
    release() { released++; },
  } as unknown as PoolClient;
  const postgres = new PostgresProofingTransactionRunner({ connect: async () => client } as unknown as Pool, {
    afterIssue: async () => { if (options.afterIssue) throw new Error("injected issue hook failure"); },
    afterAudit: async () => { if (options.afterAudit) throw new Error("injected audit hook failure"); },
  });
  const runner: ProofingTransactionRunner = {
    transaction: (action, scope, principal) => postgres.transaction(tx => {
      // Only operation-request persistence is mocked; issuance, audit and transaction use real adapters.
      tx.reserve = async () => ({ kind: state.result ? "replay" : "new", request: { id: "request", resultJson: state.result ?? null } });
      tx.attribute = async () => {};
      tx.succeed = async (_org, _id, result) => { state.result = result; };
      return action(tx);
    },scope,principal),
  };
  return { client, calls, runner, state: () => state, released: () => released };
}
const context = (request = "request", capabilities: readonly "proof.issue"[] = ["proof.issue"]): OperationContext => ({ organizationId: "org", principal: { kind: "staff", organizationId: "org", userId: "staff", authority: { membershipId: "membership", capabilities } }, businessRequest: { id: request } });
const issue = (f: ReturnType<typeof fixture>, request = "request", ctx = context(request)) => new ProofingApplicationService(f.runner).issue(ctx, { businessRequestId: request, proofVersionId: brandedId<"ProofVersionId">("version"), recipientContactId: "contact" });

async function main() {
  let scenarios = 0;
  const check = async (action: () => Promise<void> | void) => { await action(); scenarios++; };
  await check(async () => {
    const f = fixture(); const result = await issue(f); assert.equal(result.ok, true);
    assert.deepEqual(f.state().access, { id: "access", customer_id: "customer", status: "PENDING_INVITE" });
    assert.deepEqual(f.state().assignments, ["permission"]); assert.equal(f.state().revision, 8);
    assert.deepEqual(f.state().deliveries, [["org", "version", "contact", "recipient@example.com", "Recipient", "access"]]);
    assert.equal(f.state().audits.length, 1);
    assert.deepEqual(f.state().audits[0], ["org", "request", "proof.issue.v1", "proof_issued", "proof_version", "version", "staff", "staff", "staff", JSON.stringify([{ kind: "proof_issued", summary: "Proof Version issued for response." }])]);
    assert.equal(f.calls.filter(c => c.sql === "BEGIN").length, 1); assert.equal(f.calls.at(-1)!.sql, "COMMIT"); assert.equal(f.released(), 1);
  });
  for (const status of ["ACTIVE", "PENDING_INVITE"]) await check(async () => {
    const f = fixture({ access: { id: "existing", customer_id: "customer", status } }); assert.equal((await issue(f)).ok, true);
    assert.equal(f.state().access!.status, status); assert.equal(f.calls.some(c => c.sql.startsWith("INSERT INTO customer_portal_access")), false);
    assert.equal(f.state().deliveries[0]![5], "existing");
  });
  for (const status of ["SUSPENDED", "DISABLED", "unexpected"]) await check(async () => {
    const f = fixture({ access: { id: "existing", customer_id: "customer", status } }); const result = await issue(f); assert.equal(result.ok, false);
    assert.equal(f.state().revision, 7); assert.deepEqual(f.state().assignments, []); assert.equal(f.calls.some(c => c.sql.startsWith("UPDATE customer_portal_access")), false);
  });
  await check(async () => {
    const f = fixture({ access: { id: "foreign", customer_id: "other-customer", status: "ACTIVE" } });
    assert.equal((await issue(f)).ok, true);
    assert.equal(f.state().access!.customer_id, "other-customer", "Existing linked-contact access is not retargeted; its broader lifecycle remains BDR-3.");
    assert.equal(f.state().deliveries[0]![5], "foreign");
  });
  for (const change of [{ organizationId: "wrong-tenant" }, { recipientContactId: "other-customer-contact" }, { proofVersionId: "foreign-proof" }]) await check(async () => {
    const f = fixture(); await assert.rejects(new PostgresProofRecipientAccess(f.client).ensureForProofIssue({ ...input, ...change }), /active customer contact/);
    assert.equal(f.calls.length, 2); assert.equal(f.state().access, undefined);
  });
  await check(async () => { const f = fixture(); await assert.rejects(new PostgresProofRecipientAccess(f.client).ensureForProofIssue({ ...input, recipientContactId: " " }), /Choose a customer contact/); assert.equal(f.calls.length, 0); });
  await check(async () => { const f = fixture({ eligible: false }); assert.equal((await issue(f)).ok, false); assert.equal(f.state().access, undefined); assert.equal(f.calls.at(-1)!.sql, "ROLLBACK"); });
  await check(async () => { const f = fixture({ template: false }); const result = await issue(f); assert.equal(result.ok, false); if (!result.ok) assert.match(result.error.message, /permissions are not configured/); assert.equal(f.state().access, undefined); assert.deepEqual(f.state().assignments, []); assert.equal(f.state().revision, 7); });
  await check(async () => {
    const f = fixture(); const first = await issue(f); const mutations = f.calls.filter(c => /^(INSERT|UPDATE)/.test(c.sql)).length;
    assert.deepEqual(await issue(f), first); assert.equal(f.calls.filter(c => /^(INSERT|UPDATE)/.test(c.sql)).length, mutations);
    assert.equal(f.state().revision, 8); assert.equal(f.state().assignments.length, 1); assert.equal(f.state().deliveries.length, 1);
    f.state().result = undefined; const repeated = await issue(f, "other-request"); assert.equal(repeated.ok, false);
    assert.equal(f.state().revision, 8); assert.equal(f.state().assignments.length, 1); assert.equal(f.state().deliveries.length, 1);
  });
  await check(async () => { const f = fixture(); assert.equal((await issue(f, "request", context("request", []))).ok, false); assert.equal(f.calls.length, 0); });
  for (const options of [{ fail: "INSERT INTO v2_portal_permission_set_assignments" }, { fail: "SELECT v2_authority_changed" }, { fail: "INSERT INTO v2_proof_delivery_jobs" }, { afterIssue: true }, { afterAudit: true }]) await check(async () => {
    const f = fixture(options); assert.equal((await issue(f)).ok, false);
    assert.deepEqual(f.state(), { access: undefined, assignments: [], revision: 7, issued: false, deliveries: [], audits: [], result: undefined });
    assert.equal(f.calls.at(-1)!.sql, "ROLLBACK"); assert.equal(f.calls.filter(c => c.sql === "BEGIN").length, 1); assert.equal(f.released(), 1);
  });
  await check(() => {
    const proofing = readFileSync("v2/infrastructure/proofing/postgresProofingTransaction.ts", "utf8");
    const auth = readFileSync("v2/infrastructure/authorization/postgresProofRecipientAccess.ts", "utf8");
    const contract = readFileSync("v2/src/authorization/proofRecipientAccess.ts", "utf8");
    assert.doesNotMatch(proofing, /(?:INSERT INTO|UPDATE) (?:customer_portal_access|v2_portal_permission_set_assignments|v2_permission_organization_state)/);
    assert.match(proofing, /new PostgresProofRecipientAccess\(this.client\).ensureForProofIssue\(input\)/);
    assert.doesNotMatch(auth, /(?:BEGIN|COMMIT|ROLLBACK|\.connect\(|\.transaction\()/);
    assert.doesNotMatch(auth, /(?:INSERT INTO|UPDATE) v2_(?:proof|customer_portal_ceiling|permission_set_capabilities)/);
    assert.doesNotMatch(contract, /(?:import|SELECT|INSERT|UPDATE|PoolClient)/);
  });
  console.log(`BD4 Proof recipient access: ${scenarios} mock-only scenarios passed.`);
}
main().catch(error => { console.error(error); process.exitCode = 1; });
