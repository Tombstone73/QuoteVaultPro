import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { PDFDocument } from "pdf-lib";
import type { Pool, PoolClient } from "pg";
import type { OperationContext } from "../../src/application/operation.js";
import type { Capability } from "../../src/authorization/capabilities.js";
import { V2ApplicationError } from "../../src/errors/applicationError.js";
import { ArtworkApplicationService } from "../../src/modules/artwork/artworkApplication.js";
import type { ArtworkMutationResult } from "../../src/modules/artwork/contracts.js";
import { SalesWorkspaceApplicationService, bumpSalesWorkspaceRevision } from "../../src/modules/sales/workspaceApplication.js";
import type { SalesWorkspace, SalesWorkspaceLineMapEntry, SalesWorkspacePromotionReceipt } from "../../src/modules/sales/workspaceContracts.js";
import { brandedId } from "../../src/modules/shared/commercialValues.js";
import type { ArtworkBinaryStorage } from "../../infrastructure/artwork/artworkBinaryStorage.js";
import { PostgresArtworkTransactionRunner } from "../../infrastructure/artwork/postgresArtworkTransaction.js";
import { PostgresOrderEditArtwork, applyOrderEditArtworkInTransaction, authorizeOrderEditArtworkReplay, captureOrderEditArtwork, captureOrderEditArtworkFingerprint, validateOrderEditArtworkInTransaction } from "../../infrastructure/artwork/postgresOrderEditArtwork.js";
import { PostgresWorkspaceArtwork, requestWorkspaceArtworkCleanupInTransaction } from "../../infrastructure/artwork/postgresWorkspaceArtwork.js";
import { WorkspaceArtworkUploadService } from "../../infrastructure/artwork/workspaceArtworkUpload.js";
import { PostgresSalesWorkspaceStore, PostgresSalesWorkspaceTransaction } from "../../infrastructure/sales/postgresSalesWorkspace.js";

// Real PostgreSQL-compatible SQL and owner adapters, not a rollback simulation.
// PGlite has one WASM connection; the interleavings below are serial schedules,
// not a claim of native multi-connection contention/deadlock coverage.
const db = new PGlite();
const migration = (name: string) => readFileSync(new URL(`../../../server/db/migrations_v2/${name}`, import.meta.url), "utf8");
const ownerDdl = (name: string) => migration(name).split("\nINSERT INTO v2_permission_capabilities")[0]!;
let inTransaction = false;
const queries: { text: string; values: readonly unknown[] }[] = [];
const client = {
  async query(text: string, values?: unknown[]) {
    queries.push({ text, values: values ?? [] });
    if (text === "BEGIN") { assert.equal(inTransaction, false, "No nested transaction"); inTransaction = true; }
    try {
      const result = await db.query(text, values);
      const rows = result.rows.map((row) => Object.fromEntries(Object.entries(row as Record<string, unknown>).map(([field, value]) =>
        [field, value !== null && result.fields.find((entry) => entry.name === field)?.dataTypeID === 20 ? String(value) : value])));
      return { ...result, rows, rowCount: result.affectedRows ?? result.rows.length };
    } finally { if (text === "COMMIT" || text === "ROLLBACK") inTransaction = false; }
  }, release() {},
} as unknown as PoolClient;
const pool = { connect: async () => client } as unknown as Pool;
const organizationId = randomUUID(), otherOrganizationId = randomUUID(), userId = randomUUID(), otherUserId = randomUUID();
const customerId = randomUUID(), productId = randomUUID();
const grants: readonly Capability[] = ["order.view", "order.edit", "artwork.view", "artwork.adopt", "artwork.assign"];
function context(requestId = randomUUID(), capabilities = grants, actor = userId, org = organizationId): OperationContext {
  return { organizationId: org, operationId: randomUUID(), principal: { kind: "staff", organizationId: org, userId: actor,
    authority: { membershipId: randomUUID(), capabilities } }, businessRequest: { id: requestId, payloadFingerprint: "server-computed" } };
}
async function transaction<T>(action: () => Promise<T>): Promise<T> {
  await client.query("BEGIN");
  try { const result = await action(); await client.query("COMMIT"); return result; }
  catch (cause) { await client.query("ROLLBACK"); throw cause; }
}
const count = async (sql: string, values: unknown[] = []) => Number((await db.query<{ n: string }>(sql, values)).rows[0]!.n);
const canonical = async () => (await db.query<{ evidence: Record<string, unknown> }>(`SELECT jsonb_build_object(
  'documents',(SELECT jsonb_agg(to_jsonb(d) ORDER BY id) FROM v2_sales_documents d),
  'lines',(SELECT jsonb_agg(to_jsonb(l) ORDER BY id) FROM v2_sales_document_lines l),
  'files',(SELECT jsonb_agg(to_jsonb(f) ORDER BY id) FROM v2_artwork_files f),
  'assignments',(SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM v2_artwork_assignments a),
  'removals',(SELECT jsonb_agg(to_jsonb(r) ORDER BY artwork_assignment_id) FROM v2_artwork_assignment_removals r),
  'proofs',(SELECT jsonb_agg(to_jsonb(p) ORDER BY id) FROM v2_proof_versions p),
  'production',(SELECT jsonb_agg(to_jsonb(w) ORDER BY id) FROM v2_production_works w)) AS evidence`)).rows[0]!.evidence;
const references = new PostgresOrderEditArtwork(pool);
const artwork = new ArtworkApplicationService(new PostgresArtworkTransactionRunner(pool));
const store = new PostgresSalesWorkspaceStore(pool);
const sales = new SalesWorkspaceApplicationService(store, { onDiscard: (tx, ws) => requestWorkspaceArtworkCleanupInTransaction((tx as PostgresSalesWorkspaceTransaction).client,
  { organizationId: ws.organizationId, workspaceId: ws.id }) });
const objects = new Map<string, Uint8Array>();
let puts = 0, deletes = 0;
const storage: ArtworkBinaryStorage = {
  async put(input) { assert.equal(inTransaction, false); puts += 1; objects.set(input.objectKey, input.bytes); return { storageProvider: "supabase", objectKey: input.objectKey, created: true }; },
  async read(key) { const bytes = objects.get(key); assert.ok(bytes); return Buffer.from(bytes); },
  async remove(key) { assert.equal(inTransaction, false); deletes += 1; objects.delete(key); },
  async exists(key) { return objects.has(key); },
};
const claims = new PostgresWorkspaceArtwork(pool, storage);
const uploads = new WorkspaceArtworkUploadService(claims, storage);
const pdf = await PDFDocument.create(); pdf.addPage([72, 72]); const bytes = await pdf.save();
let number = 1000;
async function line(orderId: string, position: number): Promise<string> {
  const id = randomUUID();
  await client.query(`INSERT INTO v2_sales_document_lines(id,organization_id,document_id,position,product_id,description,quantity,currency,
    calculated_unit_cents,calculated_line_cents,selling_unit_cents,selling_line_cents,pricing_result_id,pricing_evidence_fingerprint,resolved_configuration,pricing_result,selling_price_decision)
    VALUES($1,$2,$3,$4,$5,'Source line',1,'USD',100,100,100,100,$6,'fixture','{}','{}','{}')`, [id, organizationId, orderId, position, productId, randomUUID()]);
  return id;
}
async function freshOrder(lineCount = 2): Promise<{ orderId: string; lineIds: string[] }> {
  return transaction(async () => {
    const orderId = randomUUID(); number += 1;
    await client.query("INSERT INTO v2_sales_documents(id,organization_id,document_kind,business_number,display_number,customer_id,currency) VALUES($1,$2,'order',$3,$4,$5,'USD')", [orderId, organizationId, number, `ORD-${number}`, customerId]);
    await client.query("INSERT INTO v2_sales_order_details(document_id,organization_id) VALUES($1,$2)", [orderId, organizationId]);
    const lineIds: string[] = [];
    for (let position = 0; position < lineCount; position += 1) lineIds.push(await line(orderId, position));
    return { orderId, lineIds };
  });
}
async function adopt(orderId: string, lineId: string, purpose: "customer_supplied" | "production" = "customer_supplied"): Promise<ArtworkMutationResult> {
  const requestId = randomUUID();
  const result = await artwork.adopt(context(requestId), { businessRequestId: requestId, objectReference: { storageProvider: "fixture", objectKey: `${randomUUID()}.pdf` },
    originalFilename: "source.pdf", displayFilename: "source.pdf", contentType: "application/pdf", byteSize: bytes.length, source: "customer_upload",
    usage: { orderId: brandedId<"OrderId">(orderId), orderLineId: brandedId<"OrderLineId">(lineId), purpose } });
  if (!result.ok) throw result.error;
  assert.equal(result.ok, true);
  return result.value;
}
async function freshWorkspace(order: { orderId: string; lineIds: string[] }, actor = context()): Promise<SalesWorkspace> {
  return transaction(async () => {
    const workspaceId = randomUUID();
    const fingerprint = await captureOrderEditArtworkFingerprint(client, { context: actor, orderId: order.orderId });
    // Sales-owned fixture setup, not a substitute capture/fingerprint port.
    await client.query(`INSERT INTO v2_sales_workspaces(id,organization_id,creator_user_id,kind,state,source_document_kind,source_document_id,base_revision,
      revision,header_json,creation_request_id,creation_fingerprint,created_at,updated_at,expires_at,source_header_json,source_artifact_fingerprint)
      VALUES($1,$2,$3,'order_edit','draft','order',$4,'1',1,'{}',$5,$6,now(),now(),now()+interval '1 day',$7::jsonb,$8)`,
      [workspaceId, organizationId, userId, order.orderId, randomUUID(), "a".repeat(64), JSON.stringify({ orderId: order.orderId, organizationId }), fingerprint]);
    const lineMap = [];
    for (const [position, canonicalLineId] of order.lineIds.entries()) {
      const workspaceLineId = randomUUID();
      await client.query("INSERT INTO v2_sales_workspace_lines(id,organization_id,workspace_id,position,source_line_id,input_json,revision,source_snapshot,source_position) VALUES($1,$2,$3,$4,$5,$6::jsonb,1,$7::jsonb,$4)",
        [workspaceLineId, organizationId, workspaceId, position, canonicalLineId, JSON.stringify({ productId, quantity: 1 }), JSON.stringify({ lineId: canonicalLineId })]);
      lineMap.push({ workspaceLineId, canonicalLineId });
    }
    await captureOrderEditArtwork(client, { context: actor, workspaceId, orderId: order.orderId, lineMap });
    return (await new PostgresSalesWorkspaceTransaction(client).get(organizationId, userId, workspaceId, true))!;
  });
}
const inputFor = (ws: SalesWorkspace, actor = context()) => ({ context: actor, workspaceId: ws.id, orderId: ws.sourceDocumentId! });
const lineMapFor = (ws: SalesWorkspace): SalesWorkspaceLineMapEntry[] => ws.lines.map((temp) => ({ workspaceLineId: temp.id, canonicalLineId: temp.sourceLineId!, position: temp.position }));
async function save(ws: SalesWorkspace, actor = context(), beforeApply?: () => Promise<void>): Promise<void> {
  await transaction(async () => {
    const tx = new PostgresSalesWorkspaceTransaction(client);
    const current = (await tx.get(organizationId, userId, ws.id, true))!;
    await validateOrderEditArtworkInTransaction(client, inputFor(current, actor));
    const requestId = randomUUID(), fingerprint = "b".repeat(64);
    await tx.beginPromotion(organizationId, current.id, current.revision, requestId, "order", fingerprint);
    // Fixture Sales effects demonstrate actual outer-transaction rollback; the
    // Artwork application itself is real, with no fake passing owner port.
    await client.query("UPDATE v2_sales_documents SET purchase_order_number='accepted edit',revision=revision+1 WHERE organization_id=$1 AND id=$2", [organizationId, current.sourceDocumentId]);
    const lineMap: SalesWorkspaceLineMapEntry[] = [];
    for (const temp of current.lines) lineMap.push({ workspaceLineId: temp.id, canonicalLineId: temp.sourceLineId ?? await line(current.sourceDocumentId!, temp.position), position: temp.position });
    await tx.recordPromotionLineMap(organizationId, current.id, "order", current.sourceDocumentId!, lineMap);
    await beforeApply?.();
    const result = await applyOrderEditArtworkInTransaction(client, { ...inputFor(current, actor), lineMap });
    const receipt: SalesWorkspacePromotionReceipt = { workspaceId: current.id, organizationId, requestId, fingerprint, inputRevision: current.revision,
      target: "order", documentId: current.sourceDocumentId!, documentRevision: "2", header: current.header, lineMap, promotedAt: new Date().toISOString(), artworkPromoted: result.promotedCount > 0 };
    await tx.recordPromotion(receipt);
    await tx.update({ ...bumpSalesWorkspaceRevision(current), state: "promoted", promotion: receipt }, current.revision);
  });
}
const names: string[] = [];
async function scenario(name: string, action: () => Promise<void>) { await action(); names.push(name); console.log(`PASS ${name}`); }

try {
  await db.exec(`CREATE TABLE organizations(id varchar PRIMARY KEY); CREATE TABLE users(id varchar PRIMARY KEY);
    CREATE TABLE customers(id varchar PRIMARY KEY,organization_id varchar NOT NULL REFERENCES organizations(id),UNIQUE(id,organization_id));
    CREATE TABLE customer_contacts(id varchar PRIMARY KEY,organization_id varchar NOT NULL REFERENCES organizations(id));
    CREATE TABLE products(id varchar PRIMARY KEY,organization_id varchar NOT NULL REFERENCES organizations(id));
    CREATE TABLE product_types(id varchar PRIMARY KEY,organization_id varchar NOT NULL REFERENCES organizations(id));`);
  await db.query("INSERT INTO organizations VALUES($1),($2)", [organizationId, otherOrganizationId]);
  await db.query("INSERT INTO users VALUES($1),($2)", [userId, otherUserId]);
  await db.query("INSERT INTO customers VALUES($1,$2)", [customerId, organizationId]);
  await db.query("INSERT INTO products VALUES($1,$2)", [productId, organizationId]);
  await db.exec(migration("0180_v2_foundation_persistence.sql"));
  await db.exec(migration("0187_v2_sales_commercial_persistence.sql"));
  await db.exec(migration("0189_v2_sales_document_and_conversion_integrity.sql"));
  await db.exec(migration("0192_v2_quote_operation_audit_and_override_capability.sql").split("-- Selling-price authority")[0]!);
  // Actual Sales constraints needed by every Artwork/Proof/Production FK.
  await db.exec(migration("0195_v2_order_draft_invoice_vertical_slice.sql").split("-- M1.8 deliberately")[0]!);
  await db.exec(migration("0197_v2_artwork_domain_foundation.sql").split("-- Only future template-derived")[0]!);
  await db.exec(ownerDdl("0199_v2_proofing_domain_foundation.sql"));
  await db.exec(ownerDdl("0201_v2_prepress_domain_foundation.sql"));
  await db.exec(migration("0202_v2_required_production_unit_specification.sql"));
  await db.exec(ownerDdl("0204_v2_production_domain_foundation.sql"));
  await db.exec(migration("0242_v2_quote_artwork_lineage.sql"));
  await db.exec(migration("0244_v2_order_artwork_replacement_lineage.sql"));
  await db.exec(migration("0246_v2_artwork_storage_reconciliation.sql"));
  await db.exec(migration("0258_v2_order_completion_archive_lifecycle.sql").split("CREATE TRIGGER v2_fulfillment_handoff_open_order_guard")[0]!);
  await db.exec(migration("0290_v2_artwork_additive_line_assignments.sql"));
  await db.exec(migration("0291_v2_artwork_assignment_removal.sql"));
  await db.exec(migration("0294_v2_sales_workspace_foundation.sql"));
  await db.exec(migration("0295_v2_sales_workspace_artwork.sql"));
  await db.exec(migration("0296_v2_order_edit_workspaces.sql"));
  await db.exec(migration("0297_v2_order_edit_artwork.sql"));

  await scenario("Capture keeps canonical state identical and freezes every empty/source line without upload claims", async () => {
    const order = await freshOrder(), source = await adopt(order.orderId, order.lineIds[0]!);
    const before = await canonical(); const ws = await freshWorkspace(order);
    assert.deepEqual(await canonical(), before);
    assert.equal(await count("SELECT jsonb_array_length(source_line_map_json)::text n FROM v2_artwork_workspace_edit_sessions WHERE workspace_id=$1", [ws.id]), 2);
    assert.equal(await count("SELECT count(*)::text n FROM v2_artwork_workspace_claims WHERE workspace_id=$1", [ws.id]), 0);
    assert.equal(await count("SELECT count(*)::text n FROM v2_artwork_storage_upload_intents"), 0);
    const read = await references.readOrderEditArtwork(context(), ws.id);
    assert.equal(read[0]!.artworkFileId, source.artworkFile.id); assert.equal(read[0]!.action, "KEEP");
    assert.equal("objectReference" in read[0]!, false); assert.equal("baselineFingerprint" in read[0]!, false);
    await assert.rejects(db.query("UPDATE v2_artwork_workspace_edit_refs SET source_status='removed' WHERE workspace_id=$1", [ws.id]), /immutable/);
    await assert.rejects(db.query("DELETE FROM v2_artwork_workspace_edit_sessions WHERE workspace_id=$1", [ws.id]), /immutable/);
  });
  await scenario("Incomplete capture mapping including an omitted empty line is rejected", async () => {
    const order = await freshOrder(), ws = await freshWorkspace(order);
    await assert.rejects(transaction(() => captureOrderEditArtwork(client, { ...inputFor(ws), lineMap: lineMapFor(ws).slice(0, 1) })), /complete/);
  });
  await scenario("Immutable source rows preserve accepted-Quote provenance plus removed and superseded assignment evidence", async () => {
    const order = await freshOrder(), source = await adopt(order.orderId, order.lineIds[0]!);
    const snapshotId = randomUUID(), inheritedId = randomUUID();
    await transaction(async () => {
      const quoteId = randomUUID(), quoteAssignmentId = randomUUID(), checkpointId = randomUUID(), convertedId = randomUUID(); number += 1;
      await client.query("INSERT INTO v2_sales_documents(id,organization_id,document_kind,business_number,display_number,customer_id,currency) VALUES($1,$2,'quote',$3,$4,$5,'USD')", [quoteId, organizationId, number, `QUO-${number}`, customerId]);
      await client.query("INSERT INTO v2_sales_quote_details(document_id,organization_id) VALUES($1,$2)", [quoteId, organizationId]);
      const quoteLineId = await line(quoteId, 0);
      await client.query(`INSERT INTO v2_quote_artwork_assignments(id,organization_id,artwork_file_id,quote_document_id,quote_line_id,purpose,
        identity_fingerprint,created_principal_kind,created_principal_subject) VALUES($1,$2,$3,$4,$5,'customer_supplied',$6,'staff',$7)`,
        [quoteAssignmentId, organizationId, source.artworkFile.id, quoteId, quoteLineId, `sha256:${"a".repeat(64)}`, userId]);
      for (const [id, sequence, kind] of [[checkpointId, 1, "quote_accepted"], [convertedId, 2, "quote_converted"]] as const) {
        await client.query(`INSERT INTO v2_sales_quote_checkpoints(id,organization_id,quote_document_id,checkpoint_sequence,checkpoint_kind,
          schema_version,occurred_at,principal_kind,principal_subject,evidence_fingerprint,payload)
          VALUES($1,$2,$3,$4,$5,1,now(),'staff',$6,'fixture','{}')`, [id, organizationId, quoteId, sequence, kind, userId]);
      }
      await client.query("UPDATE v2_sales_quote_details SET delivery_state='sent',acceptance_state='accepted' WHERE organization_id=$1 AND document_id=$2", [organizationId, quoteId]);
      await client.query("INSERT INTO v2_sales_quote_conversions(id,organization_id,quote_document_id,source_checkpoint_id,order_document_id,conversion_checkpoint_id) VALUES($1,$2,$3,$4,$5,$6)",
        [randomUUID(), organizationId, quoteId, checkpointId, order.orderId, convertedId]);
      await client.query(`INSERT INTO v2_quote_accepted_artwork_snapshots(id,organization_id,quote_document_id,quote_line_id,acceptance_checkpoint_id,quote_artwork_assignment_id,artwork_file_id,purpose,evidence_fingerprint)
        VALUES($1,$2,$3,$4,$5,$6,$7,'customer_supplied',$8)`, [snapshotId, organizationId, quoteId, quoteLineId, checkpointId, quoteAssignmentId, source.artworkFile.id, `sha256:${"a".repeat(64)}`]);
      await client.query(`INSERT INTO v2_artwork_assignments(id,organization_id,artwork_file_id,order_document_id,order_line_id,purpose,source_quote_accepted_artwork_snapshot_id,identity_fingerprint)
        VALUES($1,$2,$3,$4,$5,'customer_supplied',$6,$7)`, [inheritedId, organizationId, source.artworkFile.id, order.orderId, order.lineIds[1], snapshotId, `sha256:${"c".repeat(64)}`]);
    });
    const replaceId = randomUUID(), replaced = await artwork.replace(context(replaceId), { businessRequestId: replaceId, supersedesArtworkAssignmentId: source.assignment.id,
      objectReference: { storageProvider: "fixture", objectKey: `${randomUUID()}.pdf` }, originalFilename: "replacement.pdf", contentType: "application/pdf", byteSize: 50, source: "customer_upload",
      usage: { orderId: source.assignment.orderId, orderLineId: source.assignment.orderLineId, purpose: "customer_supplied" } });
    if (!replaced.ok) throw replaced.error;
    const removeId = randomUUID(), removed = await artwork.remove(context(removeId), { businessRequestId: removeId, artworkAssignmentId: replaced.value.assignment.id,
      orderId: source.assignment.orderId, orderLineId: source.assignment.orderLineId });
    assert.equal(removed.ok, true);
    const ws = await freshWorkspace(order), refs = await references.readOrderEditArtwork(context(), ws.id);
    assert.equal(refs.length, 3);
    assert.equal(refs.find((ref) => ref.sourceAssignmentId === source.assignment.id)!.status, "superseded");
    assert.equal(refs.find((ref) => ref.sourceAssignmentId === replaced.value.assignment.id)!.status, "removed");
    assert.equal(refs.find((ref) => ref.sourceAssignmentId === inheritedId)!.sourceQuoteAcceptedArtworkSnapshotId, snapshotId);
    const persisted = (await db.query<{ evidence: { assignment: { source_quote_accepted_artwork_snapshot_id: string }; file: { id: string }; removal: unknown }; baseline_fingerprint: string }>(
      "SELECT source_evidence_json evidence,baseline_fingerprint FROM v2_artwork_workspace_edit_refs WHERE workspace_id=$1 AND source_assignment_id=$2", [ws.id, inheritedId])).rows[0]!;
    assert.equal(persisted.evidence.assignment.source_quote_accepted_artwork_snapshot_id, snapshotId);
    assert.equal(persisted.evidence.file.id, source.artworkFile.id); assert.equal(persisted.evidence.removal, null);
    assert.equal(persisted.baseline_fingerprint, ws.sourceArtifactFingerprint);
    const intentId = randomUUID(); await assert.rejects(references.stageOrderEditArtworkIntent(context(intentId), ws.id, source.assignment.id, "REMOVE", ws.revision, intentId), /Only current/);
    const before = await canonical(); await save(ws);
    assert.deepEqual((await canonical()).assignments, before.assignments); assert.deepEqual((await canonical()).removals, before.removals);
  });
  await scenario("No-view editor captures and saves headers without metadata or reference capabilities", async () => {
    const order = await freshOrder(); await adopt(order.orderId, order.lineIds[0]!);
    const actor = context(randomUUID(), ["order.view", "order.edit"]), ws = await freshWorkspace(order, actor);
    await assert.rejects(references.readOrderEditArtwork(actor, ws.id), (error: unknown) => error instanceof V2ApplicationError && error.code === "FORBIDDEN");
    await save(ws, actor);
    assert.equal(await count("SELECT count(*)::text n FROM v2_artwork_assignment_removals WHERE artwork_assignment_id IN (SELECT id FROM v2_artwork_assignments WHERE order_document_id=$1)", [order.orderId]), 0);
  });
  await scenario("Exact creator, tenant, fresh Order edit authority and view/assign authority protect read and intent replay", async () => {
    const order = await freshOrder(), source = await adopt(order.orderId, order.lineIds[0]!), ws = await freshWorkspace(order);
    const requestId = randomUUID();
    const accepted = await references.stageOrderEditArtworkIntent(context(requestId), ws.id, source.assignment.id, "REMOVE", ws.revision, requestId);
    assert.deepEqual(await references.stageOrderEditArtworkIntent(context(requestId), ws.id, source.assignment.id, "REMOVE", ws.revision, requestId), accepted);
    for (const actor of [context(requestId, grants, otherUserId), context(requestId, grants, userId, otherOrganizationId), context(requestId, ["order.view", "artwork.view", "artwork.assign"]), context(requestId, ["order.view", "order.edit", "artwork.assign"])]) {
      await assert.rejects(references.stageOrderEditArtworkIntent(actor, ws.id, source.assignment.id, "REMOVE", ws.revision, requestId));
    }
    await assert.rejects(references.readOrderEditArtwork(context(randomUUID(), grants, otherUserId), ws.id));
    await assert.rejects(references.stageOrderEditArtworkIntent(context(requestId), ws.id, source.assignment.id, "KEEP", ws.revision, requestId), /different payload/);
  });
  await scenario("KEEP resets a staged REMOVE without canonical, upload ledger, or binary side effects", async () => {
    const order = await freshOrder(), source = await adopt(order.orderId, order.lineIds[0]!), ws = await freshWorkspace(order), before = await canonical();
    const removeId = randomUUID(), keepId = randomUUID();
    const removed = await references.stageOrderEditArtworkIntent(context(removeId), ws.id, source.assignment.id, "REMOVE", ws.revision, removeId);
    await references.stageOrderEditArtworkIntent(context(keepId), ws.id, source.assignment.id, "KEEP", removed.workspaceRevision, keepId);
    const sideEffects = { puts, deletes, audits: await count("SELECT count(*)::text n FROM v2_audit_events") };
    await save(ws);
    assert.deepEqual({ puts, deletes, audits: await count("SELECT count(*)::text n FROM v2_audit_events") }, sideEffects);
    assert.deepEqual((await canonical())!.files, before!.files);
    assert.equal(await count("SELECT count(*)::text n FROM v2_artwork_storage_upload_intents"), 0);
  });
  await scenario("Concurrent additive assignment to an initially empty line conflicts before Sales mutation", async () => {
    const order = await freshOrder(), ws = await freshWorkspace(order);
    await adopt(order.orderId, order.lineIds[1]!);
    const before = await canonical();
    await assert.rejects(save(ws), /Artwork changed/);
    assert.deepEqual(await canonical(), before);
  });
  await scenario("Concurrent canonical REMOVE changes the full baseline and blocks even a header-only Save", async () => {
    const order = await freshOrder(), source = await adopt(order.orderId, order.lineIds[0]!), ws = await freshWorkspace(order), requestId = randomUUID();
    const removed = await artwork.remove(context(requestId), { businessRequestId: requestId, artworkAssignmentId: source.assignment.id,
      orderId: source.assignment.orderId, orderLineId: source.assignment.orderLineId });
    assert.equal(removed.ok, true); const before = await canonical();
    await assert.rejects(save(ws), /Artwork changed/); assert.deepEqual(await canonical(), before);
  });
  await scenario("Changed file metadata is detected despite identical canonical assignment IDs", async () => {
    const order = await freshOrder(), source = await adopt(order.orderId, order.lineIds[0]!), ws = await freshWorkspace(order);
    await db.query("UPDATE v2_artwork_files SET display_filename='changed.pdf' WHERE organization_id=$1 AND id=$2", [organizationId, source.artworkFile.id]);
    const before = await canonical(); await assert.rejects(save(ws), /Artwork changed/); assert.deepEqual(await canonical(), before);
  });
  await scenario("New canonical source-line membership invalidates even an entirely empty baseline", async () => {
    const order = await freshOrder(), ws = await freshWorkspace(order);
    await transaction(() => line(order.orderId, 2));
    const before = await canonical();
    await assert.rejects(save(ws), /Artwork changed/); assert.deepEqual(await canonical(), before);
  });
  await scenario("A superseded or removed assignment cannot receive stale intents or pass fingerprint validation", async () => {
    const order = await freshOrder(), source = await adopt(order.orderId, order.lineIds[0]!), ws = await freshWorkspace(order);
    const requestId = randomUUID();
    const replaced = await artwork.replace(context(requestId), { businessRequestId: requestId, supersedesArtworkAssignmentId: source.assignment.id,
      objectReference: { storageProvider: "fixture", objectKey: `${randomUUID()}.pdf` }, originalFilename: "replacement.pdf", contentType: "application/pdf", byteSize: 50, source: "customer_upload",
      usage: { orderId: source.assignment.orderId, orderLineId: source.assignment.orderLineId, purpose: "customer_supplied" } });
    assert.equal(replaced.ok, true);
    const intentId = randomUUID(); await assert.rejects(references.stageOrderEditArtworkIntent(context(intentId), ws.id, source.assignment.id, "REMOVE", ws.revision, intentId), /Artwork changed/);
    await assert.rejects(save(ws), /Artwork changed/);
    const staleRemoveId = randomUUID(), stale = await artwork.remove(context(staleRemoveId), { businessRequestId: staleRemoveId, artworkAssignmentId: source.assignment.id, orderId: source.assignment.orderId, orderLineId: source.assignment.orderLineId });
    assert.equal(stale.ok, false); if (!stale.ok) assert.equal(stale.error.code, "CONFLICT");
  });
  await scenario("REMOVE appends a tombstone and one owner audit while retaining file, assignment, and Sales-line history", async () => {
    const order = await freshOrder(), source = await adopt(order.orderId, order.lineIds[0]!), ws = await freshWorkspace(order);
    const requestId = randomUUID(); await references.stageOrderEditArtworkIntent(context(requestId), ws.id, source.assignment.id, "REMOVE", ws.revision, requestId);
    const beforeAudit = await count("SELECT count(*)::text n FROM v2_audit_events WHERE event_type='artwork_assignment_removed'");
    await save(ws);
    assert.equal(await count("SELECT count(*)::text n FROM v2_artwork_assignment_removals WHERE artwork_assignment_id=$1", [source.assignment.id]), 1);
    assert.equal(await count("SELECT count(*)::text n FROM v2_artwork_files WHERE id=$1", [source.artworkFile.id]), 1);
    assert.equal(await count("SELECT count(*)::text n FROM v2_artwork_assignments WHERE id=$1", [source.assignment.id]), 1);
    assert.equal(await count("SELECT count(*)::text n FROM v2_audit_events WHERE event_type='artwork_assignment_removed'"), beforeAudit + 1);
    await assert.rejects(db.query("DELETE FROM v2_sales_document_lines WHERE id=$1", [order.lineIds[0]]), /foreign key/);
    await assert.rejects(db.query("DELETE FROM v2_artwork_assignment_removals WHERE artwork_assignment_id=$1", [source.assignment.id]), /immutable/);
  });
  await scenario("Source-line removal with Artwork history is blocked even after a staged REMOVE", async () => {
    const order = await freshOrder(), source = await adopt(order.orderId, order.lineIds[0]!), ws = await freshWorkspace(order);
    const requestId = randomUUID(); await references.stageOrderEditArtworkIntent(context(requestId), ws.id, source.assignment.id, "REMOVE", ws.revision, requestId);
    await transaction(async () => {
      const tx = new PostgresSalesWorkspaceTransaction(client); await tx.get(organizationId, userId, ws.id, true);
      await tx.deleteLine(organizationId, ws.id, ws.lines[0]!.id);
    });
    await assert.rejects(save(ws), /retained Artwork assignment history/);
  });
  for (const bound of ["Proof", "Production"] as const) await scenario(`${bound}-bound removal throws from actual Artwork owner and rolls back Sales, map, audit, and canonical effects`, async () => {
    const order = await freshOrder(), source = await adopt(order.orderId, order.lineIds[0]!, bound === "Production" ? "production" : "customer_supplied");
    await transaction(async () => {
      if (bound === "Proof") {
        const workId = randomUUID(), versionId = randomUUID();
        await client.query("INSERT INTO v2_proof_works(id,organization_id,order_document_id,order_line_id,created_principal_kind,created_principal_subject) VALUES($1,$2,$3,$4,'staff',$5)", [workId, organizationId, order.orderId, order.lineIds[0], userId]);
        await client.query("INSERT INTO v2_proof_versions(id,organization_id,proof_work_id,sequence,created_principal_kind,created_principal_subject) VALUES($1,$2,$3,1,'staff',$4)", [versionId, organizationId, workId, userId]);
        await client.query("INSERT INTO v2_proof_version_artwork(organization_id,proof_version_id,position,artwork_assignment_id,artwork_file_id) VALUES($1,$2,0,$3,$4)", [organizationId, versionId, source.assignment.id, source.artworkFile.id]);
      } else {
        await client.query("INSERT INTO v2_sales_line_production_requirements(organization_id,document_id,order_line_id,requirement_key) VALUES($1,$2,$3,'unit')", [organizationId, order.orderId, order.lineIds[0]]);
        await client.query(`INSERT INTO v2_production_works(id,organization_id,order_document_id,order_line_id,requirement_key,artwork_assignment_id,artwork_file_id,ordered_quantity,created_principal_kind,created_principal_subject)
          VALUES($1,$2,$3,$4,'unit',$5,$6,1,'staff',$7)`, [randomUUID(), organizationId, order.orderId, order.lineIds[0], source.assignment.id, source.artworkFile.id, userId]);
      }
    });
    const ws = await freshWorkspace(order), requestId = randomUUID();
    await references.stageOrderEditArtworkIntent(context(requestId), ws.id, source.assignment.id, "REMOVE", ws.revision, requestId);
    const before = await canonical(), beforeAudit = await count("SELECT count(*)::text n FROM v2_audit_events");
    await assert.rejects(save(ws), (error: unknown) => error instanceof V2ApplicationError && error.code === "CONFLICT" && /in use/.test(error.message));
    assert.deepEqual(await canonical(), before); assert.equal(await count("SELECT count(*)::text n FROM v2_audit_events"), beforeAudit);
    assert.equal(await count("SELECT count(*)::text n FROM v2_sales_workspace_promotion_lines WHERE workspace_id=$1", [ws.id]), 0);
    assert.equal(await count("SELECT count(*)::text n FROM v2_artwork_workspace_edit_applications WHERE workspace_id=$1", [ws.id]), 0);
    assert.equal(await count("SELECT count(*)::text n FROM v2_sales_workspaces WHERE id=$1 AND state='draft'", [ws.id]), 1);
  });
  await scenario("Existing valid PDF staging adopts additively on Save with no second put and no double workspace revision bump", async () => {
    const order = await freshOrder(), source = await adopt(order.orderId, order.lineIds[0]!), ws = await freshWorkspace(order), requestId = randomUUID();
    const uploaded = await uploads.upload(context(requestId), { workspaceId: ws.id, workspaceLineId: ws.lines[0]!.id, expectedRevision: ws.revision, requestId, filename: "new.pdf", contentType: "application/pdf", bytes });
    if (!uploaded.ok) throw uploaded.error; assert.equal(uploaded.ok, true);
    const beforePuts = puts;
    await save(ws);
    assert.equal(puts, beforePuts);
    assert.equal(await count("SELECT count(*)::text n FROM v2_current_artwork_assignments WHERE order_document_id=$1", [order.orderId]), 2);
    assert.equal(await count("SELECT count(*)::text n FROM v2_current_artwork_assignments WHERE id=$1", [source.assignment.id]), 1);
    assert.equal(await count("SELECT revision::text n FROM v2_sales_workspaces WHERE id=$1", [ws.id]), uploaded.value.workspaceRevision + 1);
    assert.equal(await count("SELECT revision::text n FROM v2_sales_documents WHERE id=$1", [order.orderId]), 2);
    const promoted = (await claims.list(context(), ws.id))[0]!; assert.equal(promoted.state, "promoted"); assert.equal(promoted.id, uploaded.value.claim.id);
  });
  await scenario("New TEMP-line PDF is promoted to the server-generated added canonical line after complete baseline validation", async () => {
    const order = await freshOrder(), ws = await freshWorkspace(order), tempId = randomUUID();
    const edited = await transaction(async () => {
      const tx = new PostgresSalesWorkspaceTransaction(client), current = (await tx.get(organizationId, userId, ws.id, true))!;
      await tx.putLine(organizationId, { id: tempId, workspaceId: ws.id, position: current.lines.length, input: { productId, quantity: 1 }, revision: 1 });
      await tx.update(bumpSalesWorkspaceRevision(current), current.revision);
      return (await tx.get(organizationId, userId, ws.id, true))!;
    });
    const requestId = randomUUID(), uploaded = await uploads.upload(context(requestId), { workspaceId: ws.id, workspaceLineId: tempId,
      expectedRevision: edited.revision, requestId, filename: "new-line.pdf", contentType: "application/pdf", bytes });
    if (!uploaded.ok) throw uploaded.error;
    await save(ws);
    const claim = (await claims.list(context(), ws.id))[0]!;
    const map = (await db.query<{ canonical_line_id: string }>("SELECT canonical_line_id FROM v2_sales_workspace_promotion_lines WHERE organization_id=$1 AND workspace_id=$2 AND workspace_line_id=$3", [organizationId, ws.id, tempId])).rows[0]!;
    assert.equal(await count("SELECT count(*)::text n FROM v2_artwork_assignments WHERE organization_id=$1 AND id=$2 AND order_line_id=$3", [organizationId, claim.assignmentId, map.canonical_line_id]), 1);
    assert.equal(order.lineIds.includes(map.canonical_line_id), false);
    assert.equal(await count("SELECT count(*)::text n FROM v2_sales_document_lines WHERE organization_id=$1 AND document_id=$2", [organizationId, order.orderId]), 3);
  });
  await scenario("Completed REMOVE application replays once, rejects remapping, and honors current owner capabilities", async () => {
    const order = await freshOrder(), source = await adopt(order.orderId, order.lineIds[0]!), ws = await freshWorkspace(order), requestId = randomUUID();
    await references.stageOrderEditArtworkIntent(context(requestId), ws.id, source.assignment.id, "REMOVE", ws.revision, requestId);
    await save(ws); const before = await canonical(), beforeAudit = await count("SELECT count(*)::text n FROM v2_audit_events");
    const result = await transaction(() => applyOrderEditArtworkInTransaction(client, { ...inputFor(ws), lineMap: lineMapFor(ws) }));
    assert.equal(result.removedCount, 1); assert.equal(result.promotedCount, 0);
    assert.deepEqual(await canonical(), before); assert.equal(await count("SELECT count(*)::text n FROM v2_audit_events"), beforeAudit);
    await assert.rejects(transaction(() => applyOrderEditArtworkInTransaction(client, { ...inputFor(ws), lineMap: [...lineMapFor(ws)].reverse().map((entry, position) => ({ ...entry, position })) })), /different line mapping/);
    for (const capabilities of [["order.view", "order.edit", "artwork.assign"], ["order.view", "order.edit", "artwork.view"]] as const) {
      const actor = context(randomUUID(), capabilities);
      await assert.rejects(authorizeOrderEditArtworkReplay(client, inputFor(ws, actor)), (error: unknown) => error instanceof V2ApplicationError && error.code === "FORBIDDEN");
    }
    await authorizeOrderEditArtworkReplay(client, inputFor(ws));
  });
  await scenario("Cancel releases only new staged bytes and leaves all canonical business rows equivalent", async () => {
    const order = await freshOrder(), source = await adopt(order.orderId, order.lineIds[0]!), ws = await freshWorkspace(order), intentId = randomUUID();
    const intent = await references.stageOrderEditArtworkIntent(context(intentId), ws.id, source.assignment.id, "REMOVE", ws.revision, intentId);
    const uploadId = randomUUID(), uploaded = await uploads.upload(context(uploadId), { workspaceId: ws.id, workspaceLineId: ws.lines[1]!.id, expectedRevision: intent.workspaceRevision, requestId: uploadId, filename: "cancel.pdf", contentType: "application/pdf", bytes });
    if (!uploaded.ok) throw uploaded.error; assert.equal(uploaded.ok, true);
    const before = await canonical();
    await sales.discard(context(), ws.id, { requestId: randomUUID(), expectedRevision: uploaded.value.workspaceRevision });
    await claims.cleanup({ organizationId, limit: 100 });
    assert.deepEqual(await canonical(), before); assert.equal((await claims.list(context(), ws.id))[0]!.state, "deleted");
    await assert.rejects(save(ws), /active draft/);
  });
  await scenario("Apply cannot bypass validation or carry a validation across transaction boundaries", async () => {
    const order = await freshOrder(), ws = await freshWorkspace(order);
    await transaction(() => validateOrderEditArtworkInTransaction(client, inputFor(ws)));
    await assert.rejects(transaction(async () => {
      const tx = new PostgresSalesWorkspaceTransaction(client); await tx.get(organizationId, userId, ws.id, true);
      await tx.beginPromotion(organizationId, ws.id, ws.revision, randomUUID(), "order", "c".repeat(64));
      await applyOrderEditArtworkInTransaction(client, { ...inputFor(ws), lineMap: lineMapFor(ws) });
    }), /validated before the Sales mutation/);
  });
  await scenario("Empty-set validation holds the real scoped advisory transaction lock until commit", async () => {
    const order = await freshOrder(), ws = await freshWorkspace(order);
    assert.equal(await count("SELECT count(*)::text n FROM pg_locks WHERE locktype='advisory' AND pid=pg_backend_pid()"), 0);
    await transaction(async () => {
      const validation = await validateOrderEditArtworkInTransaction(client, inputFor(ws));
      assert.equal(validation.hasChanges, false); assert.deepEqual(validation.sourceLineIdsWithHistory, []);
      assert.equal(await count("SELECT count(*)::text n FROM pg_locks WHERE locktype='advisory' AND pid=pg_backend_pid()"), 1);
    });
    assert.equal(await count("SELECT count(*)::text n FROM pg_locks WHERE locktype='advisory' AND pid=pg_backend_pid()"), 0);
  });
  await scenario("Actual canonical adopt, assign, replacement and assignment-only resolution take scoped Order locks before writes", async () => {
    const order = await freshOrder(); queries.length = 0;
    const source = await adopt(order.orderId, order.lineIds[0]!);
    const fileInsert = queries.findIndex((query) => /INSERT INTO v2_artwork_files/.test(query.text));
    const rowLock = queries.findIndex((query) => /v2_sales_documents.*FOR UPDATE/.test(query.text));
    const orderLock = queries.findIndex((query) => /v2_sales_order_details.*FOR UPDATE/.test(query.text));
    const advisory = queries.findIndex((query) => /pg_advisory_xact_lock/.test(query.text));
    assert.ok(rowLock >= 0 && rowLock < orderLock && orderLock < advisory && advisory < fileInsert);
    assert.deepEqual(queries[advisory]!.values, [`order-artwork:${organizationId}:${order.orderId}`]);
    queries.length = 0; const assignId = randomUUID();
    const assigned = await artwork.assign(context(assignId), { businessRequestId: assignId, artworkFileId: source.artworkFile.id,
      usage: { orderId: source.assignment.orderId, orderLineId: brandedId<"OrderLineId">(order.lineIds[1]!), purpose: "customer_supplied" } });
    assert.equal(assigned.ok, true);
    assert.ok(queries.findIndex((query) => /pg_advisory_xact_lock/.test(query.text)) < queries.findIndex((query) => /INSERT INTO v2_artwork_assignments/.test(query.text)));
    queries.length = 0; const replacementId = randomUUID();
    const replacement = await artwork.replace(context(replacementId), { businessRequestId: replacementId, supersedesArtworkAssignmentId: source.assignment.id,
      objectReference: { storageProvider: "fixture", objectKey: `${randomUUID()}.pdf` }, originalFilename: "replacement.pdf", contentType: "application/pdf", byteSize: 50, source: "customer_upload",
      usage: { orderId: source.assignment.orderId, orderLineId: source.assignment.orderLineId, purpose: "customer_supplied" } });
    if (!replacement.ok) throw replacement.error;
    assert.ok(queries.findIndex((query) => /pg_advisory_xact_lock/.test(query.text)) < queries.findIndex((query) => /INSERT INTO v2_artwork_files/.test(query.text)));
    queries.length = 0; const requestId = randomUUID();
    const removed = await artwork.remove(context(requestId), { businessRequestId: requestId, artworkAssignmentId: replacement.value.assignment.id, orderId: source.assignment.orderId, orderLineId: source.assignment.orderLineId });
    assert.equal(removed.ok, true);
    const resolved = queries.findIndex((query) => /SELECT order_document_id FROM v2_artwork_assignments/.test(query.text));
    const locked = queries.findIndex((query) => /pg_advisory_xact_lock/.test(query.text));
    const reread = queries.findIndex((query) => /SELECT \* FROM v2_artwork_assignments/.test(query.text));
    const tombstone = queries.findIndex((query) => /INSERT INTO v2_artwork_assignment_removals/.test(query.text));
    assert.ok(resolved >= 0 && resolved < locked && locked < reread && reread < tombstone);
    const functions = await db.query<{ n: number }>("SELECT count(*)::integer n FROM pg_trigger WHERE tgname='aa_v2_artwork_order_coordination' AND NOT tgisinternal");
    assert.equal(functions.rows[0]!.n, 2);
  });
  console.log(`orderEditArtwork.postgres.test: ${names.length} actual PGlite owner scenarios PASS; native multi-connection races NOT RUN`);
} finally { await db.close(); }
