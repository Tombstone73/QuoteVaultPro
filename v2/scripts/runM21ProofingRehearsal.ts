import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import { PostgresProofingTransactionRunner } from "../infrastructure/proofing/postgresProofingTransaction.js";
import { assertV2ProofingPhysicalPostconditions } from "../infrastructure/proofing/proofingPhysicalPostconditions.js";
import { requireV2M0CloneDatabaseUrl } from "../infrastructure/persistence/cloneSafety.js";
import { ProofingApplicationService } from "../src/modules/proofing/proofingApplication.js";
import { brandedId } from "../src/modules/shared/commercialValues.js";
import type { Capability } from "../src/authorization/capabilities.js";

const migrationsFolder = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../server/db/migrations_v2");
const staff = (organizationId: string, userId: string, id: string, capabilities: readonly Capability[] = ["proof.view", "proof.prepare", "proof.issue", "proof.respond"]) => ({
  organizationId, operationId: `m21:${id}`, businessRequest: { id, payloadFingerprint: "m21" },
  principal: { kind: "staff" as const, organizationId, userId, authority: { membershipId: `m21-${userId}`, capabilities } },
});
const portal = (organizationId: string, customerId: string, id: string) => ({
  organizationId, operationId: `m21:${id}`, businessRequest: { id, payloadFingerprint: "m21" },
  principal: { kind: "portal" as const, organizationId, customerId, subjectId: `portal-${customerId}`, capabilities: ["proof.respond"] as const },
});

async function scalarCount(client: { query: Function }, sql: string, values: unknown[]) {
  const result = await client.query<{ n: string }>(sql, values);
  return Number(result.rows[0]!.n);
}

async function main() {
  const pool = new Pool({ connectionString: requireV2M0CloneDatabaseUrl(), max: 6, application_name: "m21-proofing-rehearsal" });
  try {
    await migrate(drizzle({ client: pool }), { migrationsFolder, migrationsTable: "__drizzle_migrations_v2", migrationsSchema: "public" });
    const client = await pool.connect();
    try {
      await assertV2ProofingPhysicalPostconditions(client);
      const suffix = randomUUID();
      const org = `m21-${suffix}`;
      const otherOrg = `m21-other-${suffix}`;
      const user = `m21-user-${suffix}`;
      const customer = `m21-customer-${suffix}`;
      const order = `m21-order-${suffix}`;
      const line = `m21-line-${suffix}`;
      const secondLine = `m21-line2-${suffix}`;
      const product = `m21-product-${suffix}`;
      const productType = `m21-type-${suffix}`;
      const file = `m21-file-${suffix}`;
      const assignment = `m21-assignment-${suffix}`;
      const secondAssignment = `m21-assignment2-${suffix}`;
      const route = `m21-route-${suffix}`;
      const routeStep = `m21-step-${suffix}`;
      const routeTemplate = `m21-template-${suffix}`;

      await client.query("BEGIN");
      await client.query("INSERT INTO organizations(id,name,slug) VALUES($1,'M21',$2),($3,'M21 Other',$4)", [org, `m21-${suffix}`, otherOrg, `m21-other-${suffix}`]);
      await client.query("INSERT INTO users(id,email,role) VALUES($1,$2,'owner')", [user, `${user}@test`]);
      await client.query("INSERT INTO customers(id,organization_id,company_name,display_name,is_active,status) VALUES($1,$2,'M21','M21',true,'active')", [customer, org]);
      await client.query("INSERT INTO product_types(id,organization_id,name,routing_mode) VALUES($1,$2,'M21','no_route')", [productType, org]);
      await client.query("INSERT INTO products(id,organization_id,name,description,is_active,measurement_mode,product_type_id) VALUES($1,$2,'M21','M21',true,'quantity_only',$3)", [product, org, productType]);
      await client.query("INSERT INTO v2_sales_documents(id,organization_id,document_kind,business_number,display_number,customer_id,currency,terms_json) VALUES($1,$2,'order',1,$3,$4,'USD','{}')", [order, org, `ORD-${suffix}`, customer]);
      await client.query("INSERT INTO v2_sales_order_details(document_id,organization_id) VALUES($1,$2)", [order, org]);
      for (const [id, position] of [[line, 0], [secondLine, 1]] as const) {
        await client.query("INSERT INTO v2_sales_document_lines(id,organization_id,document_id,position,product_id,description,quantity,currency,calculated_unit_cents,calculated_line_cents,selling_unit_cents,selling_line_cents,pricing_result_id,pricing_evidence_fingerprint,resolved_configuration,pricing_result,selling_price_decision) VALUES($1,$2,$3,$4,$5,'M21',1,'USD',1,1,1,1,'m21','sha256:m21','{}','{}','{}')", [id, org, order, position, product]);
      }
      await client.query("INSERT INTO v2_artwork_files(id,organization_id,storage_provider,object_key,original_filename,display_filename,content_type,byte_size,source_kind) VALUES($1,$2,'clone',$3,'proof.pdf','proof.pdf','application/pdf',1,'customer_upload')", [file, org, `m21/${suffix}`]);
      for (const [id, orderLineId, fingerprint] of [[assignment, line, "a"], [secondAssignment, secondLine, "b"]] as const) {
        await client.query("INSERT INTO v2_artwork_assignments(id,organization_id,artwork_file_id,order_document_id,order_line_id,purpose,identity_fingerprint) VALUES($1,$2,$3,$4,$5,'proof',$6)", [id, org, file, order, orderLineId, `sha256:${fingerprint.repeat(64)}`]);
      }
      await client.query("INSERT INTO v2_route_templates(id,organization_id,name,normalized_name,definition_fingerprint) VALUES($1,$2,'M21','m21','m21')", [routeTemplate, org]);
      await client.query("INSERT INTO v2_route_instances(id,organization_id,order_document_id,order_line_id,source_template_id,source_template_revision,source_template_fingerprint,route_state,current_step_id) VALUES($1,$2,$3,$4,$5,1,'m21','pending',$6)", [route, org, order, line, routeTemplate, routeStep]);
      await client.query("INSERT INTO v2_route_instance_steps(id,organization_id,route_instance_id,position,step_kind) VALUES($1,$2,$3,0,'proofing')", [routeStep, org, route]);
      await client.query("COMMIT");
      console.log("[m2.1] clone fixtures ready");
      const routeBefore = await client.query("SELECT revision,route_state,current_step_id FROM v2_route_instances WHERE organization_id=$1 AND id=$2", [org, route]);

      await assert.rejects(client.query("INSERT INTO v2_proof_works(organization_id,order_document_id,order_line_id,created_principal_kind,created_principal_subject) VALUES($1,$2,$3,'staff','bad')", [otherOrg, order, line]), /foreign key/i);
      const service = new ProofingApplicationService(new PostgresProofingTransactionRunner(pool));
      const work = await service.start(staff(org, user, "work"), { businessRequestId: "work", orderId: brandedId<"OrderId">(order), orderLineId: brandedId<"OrderLineId">(line) });
      assert(work.ok);
      if (!work.ok) return;
      console.log("[m2.1] proof work created");
      const versionOne = await service.createVersion(staff(org, user, "v1"), { businessRequestId: "v1", proofWorkId: work.value.work.proofWorkId, artworkAssignmentIds: [brandedId<"ArtworkAssignmentId">(assignment)] });
      assert(versionOne.ok && versionOne.value.version);
      if (!versionOne.ok || !versionOne.value.version) return;
      assert(!(await service.respond(staff(org, user, "unissued"), { businessRequestId: "unissued", proofVersionId: versionOne.value.version.proofVersionId, outcome: "approved" })).ok);
      assert((await service.issue(staff(org, user, "issue1"), { businessRequestId: "issue1", proofVersionId: versionOne.value.version.proofVersionId })).ok);
      assert((await service.respond(staff(org, user, "revision"), { businessRequestId: "revision", proofVersionId: versionOne.value.version.proofVersionId, outcome: "revision_requested", comment: "Please revise." })).ok);
      console.log("[m2.1] version one revision-requested");

      const versions = await Promise.all([service.createVersion(staff(org, user, "v2"), { businessRequestId: "v2", proofWorkId: work.value.work.proofWorkId, artworkAssignmentIds: [brandedId<"ArtworkAssignmentId">(assignment)] }), service.createVersion(staff(org, user, "v2"), { businessRequestId: "v2", proofWorkId: work.value.work.proofWorkId, artworkAssignmentIds: [brandedId<"ArtworkAssignmentId">(assignment)] })]);
      assert(versions.every((result) => result.ok) && versions[0]!.ok && versions[1]!.ok && versions[0]!.value.version!.proofVersionId === versions[1]!.value.version!.proofVersionId);
      const versionTwo = versions[0]!.value.version!;
      console.log("[m2.1] concurrent version creation converged");
      assert((await service.issue(staff(org, user, "issue2"), { businessRequestId: "issue2", proofVersionId: versionTwo.proofVersionId })).ok);
      const responseRace = await Promise.all([service.respond(portal(org, customer, "approve"), { businessRequestId: "approve", proofVersionId: versionTwo.proofVersionId, outcome: "approved", comment: "Approved" }), service.respond(staff(org, user, "conflict"), { businessRequestId: "conflict", proofVersionId: versionTwo.proofVersionId, outcome: "revision_requested" })]);
      assert.equal(responseRace.filter((result) => result.ok).length, 1, "contradictory Proof response race did not converge");
      assert.equal(responseRace.filter((result) => !result.ok).length, 1, "contradictory Proof response race did not reject one response");
      console.log("[m2.1] response race converged");
      const duplicateWork = await service.start(staff(org, user, "duplicate-work"), { businessRequestId: "duplicate-work", orderId: brandedId<"OrderId">(order), orderLineId: brandedId<"OrderLineId">(secondLine) });
      assert(duplicateWork.ok);
      if (!duplicateWork.ok) return;
      const duplicateVersion = await service.createVersion(staff(org, user, "duplicate-version"), { businessRequestId: "duplicate-version", proofWorkId: duplicateWork.value.work.proofWorkId, artworkAssignmentIds: [brandedId<"ArtworkAssignmentId">(secondAssignment)] });
      assert(duplicateVersion.ok && duplicateVersion.value.version);
      if (!duplicateVersion.ok || !duplicateVersion.value.version) return;
      assert((await service.issue(staff(org, user, "duplicate-issue"), { businessRequestId: "duplicate-issue", proofVersionId: duplicateVersion.value.version.proofVersionId })).ok);
      const duplicateApproval = await Promise.all([service.respond(portal(org, customer, "duplicate-approve"), { businessRequestId: "duplicate-approve", proofVersionId: duplicateVersion.value.version.proofVersionId, outcome: "approved", comment: "Approved" }), service.respond(portal(org, customer, "duplicate-approve"), { businessRequestId: "duplicate-approve", proofVersionId: duplicateVersion.value.version.proofVersionId, outcome: "approved", comment: "Approved" })]);
      assert(duplicateApproval.every((result) => result.ok) && duplicateApproval[0]!.ok && duplicateApproval[1]!.ok && duplicateApproval[0]!.value.response?.proofResponseId === duplicateApproval[1]!.value.response?.proofResponseId, "duplicate proof approval did not converge");
      const stale = await service.respond(staff(org, user, "stale"), { businessRequestId: "stale", proofVersionId: versionOne.value.version.proofVersionId, outcome: "approved" });
      assert(!stale.ok && stale.error.code === "CONFLICT");

      const projection = await service.getWork(staff(org, user, "read"), work.value.work.proofWorkId);
      assert(projection.ok && projection.value.versions.length === 2 && projection.value.versions[0]?.response?.outcome === "approved");
      const routeAfter = await client.query("SELECT revision,route_state,current_step_id FROM v2_route_instances WHERE organization_id=$1 AND id=$2", [org, route]);
      assert.deepEqual(routeAfter.rows, routeBefore.rows, "Proofing mutated frozen Routing");
      assert.equal(await scalarCount(client, "SELECT count(*) n FROM v2_audit_events WHERE organization_id=$1 AND event_type LIKE 'proof_%'", [org]) >= 5, true, "Proof audit missing");
      assert.equal(await scalarCount(client, "SELECT count(*) n FROM v2_principal_attributions WHERE organization_id=$1 AND resource_type LIKE 'proof_%'", [org]) >= 5, true, "Proof attribution missing");

      await assert.rejects(client.query("INSERT INTO v2_proof_version_artwork(organization_id,proof_version_id,position,artwork_assignment_id,artwork_file_id) VALUES($1,$2,99,$3,$4)", [org, versionTwo.proofVersionId, secondAssignment, file]), /OrderLine/i);
      const emptyVersion = `m21-empty-version-${suffix}`;
      await client.query("INSERT INTO v2_proof_versions(id,organization_id,proof_work_id,sequence,created_principal_kind,created_principal_subject) VALUES($1,$2,$3,99,'staff','physical-test')", [emptyVersion, org, work.value.work.proofWorkId]);
      await assert.rejects(client.query("UPDATE v2_proof_versions SET issued_at=now(),issued_principal_kind='staff',issued_principal_subject='physical-test' WHERE organization_id=$1 AND id=$2", [org, emptyVersion]), /Artwork evidence/i);
      await assert.rejects(client.query("UPDATE v2_proof_versions SET issued_at=now() WHERE organization_id=$1 AND id=$2", [org, versionTwo.proofVersionId]), /immutable/i);
      await assert.rejects(client.query("DELETE FROM v2_proof_responses WHERE organization_id=$1 AND proof_version_id=$2", [org, versionTwo.proofVersionId]), /immutable/i);
      const versionsBeforeRollback = await scalarCount(client, "SELECT count(*) n FROM v2_proof_versions WHERE organization_id=$1", [org]);
      const auditBeforeRollback = await scalarCount(client, "SELECT count(*) n FROM v2_audit_events WHERE organization_id=$1 AND event_type='proof_version_created'", [org]);
      const operationBeforeRollback = await scalarCount(client, "SELECT count(*) n FROM v2_operation_requests WHERE organization_id=$1 AND business_request_id='rollback'", [org]);
      const failed = await new ProofingApplicationService(new PostgresProofingTransactionRunner(pool, { afterVersion: async () => { throw Error("rollback"); } })).createVersion(staff(org, user, "rollback"), { businessRequestId: "rollback", proofWorkId: work.value.work.proofWorkId, artworkAssignmentIds: [brandedId<"ArtworkAssignmentId">(assignment)] });
      assert(!failed.ok, "injected version failure unexpectedly succeeded");
      assert.equal(await scalarCount(client, "SELECT count(*) n FROM v2_proof_versions WHERE organization_id=$1", [org]), versionsBeforeRollback, "rollback left a Proof Version");
      assert.equal(await scalarCount(client, "SELECT count(*) n FROM v2_audit_events WHERE organization_id=$1 AND event_type='proof_version_created'", [org]), auditBeforeRollback, "rollback left Audit");
      assert.equal(await scalarCount(client, "SELECT count(*) n FROM v2_operation_requests WHERE organization_id=$1 AND business_request_id='rollback'", [org]), operationBeforeRollback, "rollback left an operation result");
      console.log("[m2.1] Proofing PostgreSQL clone rehearsal passed (24 assertions). ");
    } finally { client.release(); }
  } finally { await pool.end(); }
}

main().catch((error) => { console.error(`[m2.1] rehearsal failed: ${error instanceof Error ? error.stack ?? error.message : String(error)}`); process.exitCode = 1; });
