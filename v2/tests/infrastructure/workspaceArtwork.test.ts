import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { PDFDocument } from "pdf-lib";
import type { Pool, PoolClient } from "pg";
import type { OperationContext } from "../../src/application/operation.js";
import type { Capability } from "../../src/authorization/capabilities.js";
import { V2ApplicationError } from "../../src/errors/applicationError.js";
import type { WorkspaceArtworkUploadInput } from "../../src/modules/artwork/workspaceArtwork.js";
import { SalesWorkspaceApplicationService, bumpSalesWorkspaceRevision } from "../../src/modules/sales/workspaceApplication.js";
import type { SalesWorkspace, SalesWorkspacePromotionReceipt } from "../../src/modules/sales/workspaceContracts.js";
import { brandedId } from "../../src/modules/shared/commercialValues.js";
import type { ArtworkBinaryStorage } from "../../infrastructure/artwork/artworkBinaryStorage.js";
import { ArtworkStorageReconciler } from "../../infrastructure/artwork/artworkStorageReconciler.js";
import { PostgresArtworkStorageUploadLedger } from "../../infrastructure/artwork/artworkStorageUploadLedger.js";
import { PostgresWorkspaceArtwork, promoteWorkspaceArtworkInTransaction, requestWorkspaceArtworkCleanupInTransaction } from "../../infrastructure/artwork/postgresWorkspaceArtwork.js";
import { WorkspaceArtworkUploadService } from "../../infrastructure/artwork/workspaceArtworkUpload.js";
import { PostgresSalesWorkspaceStore, PostgresSalesWorkspaceTransaction } from "../../infrastructure/sales/postgresSalesWorkspace.js";

// Only surrounding legacy/canonical prerequisites are fixtures. Both new
// workspace migrations, upload ledger and actual owner operations execute SQL.
const db = new PGlite();
const sql = (name: string) => readFileSync(new URL(`../../../server/db/migrations_v2/${name}`, import.meta.url), "utf8");
let inTransaction = false;
const client = {
  async query(text: string, values?: unknown[]) {
    if (text === 'BEGIN') { assert.equal(inTransaction, false, 'No nested transaction'); inTransaction = true; }
    try {
      const result = await db.query(text, values);
      // node-postgres returns int8 as text; PGlite uses numeric values.
      const rows = result.rows.map((row) => Object.fromEntries(Object.entries(row as Record<string, unknown>).map(([key, value]) =>
        [key, value !== null && result.fields.find((field) => field.name === key)?.dataTypeID === 20 ? String(value) : value])));
      return { ...result, rows, rowCount: result.affectedRows ?? result.rows.length };
    } finally { if (text === 'COMMIT' || text === 'ROLLBACK') inTransaction = false; }
  }, release() {},
} as unknown as PoolClient;
const pool = { connect: async () => client, query: (text: string, values?: unknown[]) => client.query(text, values) } as unknown as Pool;
const org = randomUUID(), user = randomUUID(), otherOrg = randomUUID(), otherUser = randomUUID();
const capabilities: readonly Capability[] = ['quote.create','quote.edit','order.create','artwork.view','artwork.adopt','artwork.assign'];
const context = (requestId: string = randomUUID(), grants = capabilities): OperationContext => ({ organizationId: org, operationId: randomUUID(),
  principal: { kind: 'staff', organizationId: org, userId: user, authority: { membershipId: randomUUID(), capabilities: grants } },
  businessRequest: { id: requestId, payloadFingerprint: 'server-computed' } });
const scalar = async (query: string, values: unknown[] = []) => Number((await db.query<{ n: string }>(query, values)).rows[0]!.n);
const canonicalCount = () => scalar('SELECT count(*)::text n FROM v2_artwork_files');
const ownerStore = new PostgresSalesWorkspaceStore(pool);
const sales = new SalesWorkspaceApplicationService(ownerStore, { onDiscard: (tx, ws) => requestWorkspaceArtworkCleanupInTransaction((tx as PostgresSalesWorkspaceTransaction).client, { organizationId: ws.organizationId, workspaceId: ws.id }) });
const objects = new Map<string, Buffer>();
let puts = 0, deletes = 0, existsChecks = 0, failPut = false, failDelete = false;
let putHook: (() => Promise<void>) | undefined;
const storage: ArtworkBinaryStorage = {
  async put(input) {
    assert.equal(inTransaction, false, 'put must be outside database transactions');
    assert.equal(await scalar("SELECT count(*)::text n FROM v2_artwork_workspace_claims c JOIN v2_artwork_storage_upload_intents i ON i.id=c.upload_intent_id WHERE c.object_key=$1 AND c.state='pending' AND i.state IN ('pending_write','cleanup_pending')", [input.objectKey]), 1, 'claim + ledger persisted before bytes');
    puts += 1;
    const created = !objects.has(input.objectKey); objects.set(input.objectKey, Buffer.from(input.bytes));
    await putHook?.();
    if (failPut) throw new Error('ambiguous provider failure after bytes');
    return { storageProvider: 'supabase', objectKey: input.objectKey, created };
  },
  async remove(key) { assert.equal(inTransaction, false); deletes += 1; if (failDelete) throw new Error('provider delete failure'); objects.delete(key); },
  async exists(key) { existsChecks += 1; return objects.has(key); },
  async read(key) { assert.equal(inTransaction, false); const found = objects.get(key); if (!found) throw new Error('missing'); return found; },
};
const claims = new PostgresWorkspaceArtwork(pool, storage);
const uploads = new WorkspaceArtworkUploadService(claims, storage);
const document = await PDFDocument.create(); document.addPage([72, 72]); const bytes = await document.save();
const testNames: string[] = [];
async function scenario(name: string, action: () => Promise<void>) { await action(); testNames.push(name); console.log(`PASS ${name}`); }
async function fresh(withLine = true, expiry?: Date): Promise<SalesWorkspace> {
  let ws: SalesWorkspace;
  if (expiry) {
    ws = { id: randomUUID(), organizationId: org, creatorUserId: user, kind: 'new_sales', state: 'draft', revision: 1, header: {}, lines: [],
      createdAt: new Date(Date.now() - 5000).toISOString(), updatedAt: new Date().toISOString(), expiresAt: expiry.toISOString() };
    await ownerStore.run((tx) => tx.create(ws, randomUUID(), 'a'.repeat(64)));
  } else ws = await sales.create(context(), { requestId: randomUUID() });
  if (!withLine) return ws;
  return ownerStore.run(async (tx) => {
    const locked = (await tx.get(org, user, ws.id, true))!;
    const line = { id: randomUUID(), workspaceId: ws.id, position: 0, revision: 1, input: { productId: brandedId<'ProductId'>(randomUUID()), quantity: 1 } };
    await tx.putLine(org, line);
    const next = bumpSalesWorkspaceRevision({ ...locked, lines: [line] }); await tx.update(next, locked.revision); return next;
  });
}
function uploadInput(ws: SalesWorkspace, requestId = randomUUID()): WorkspaceArtworkUploadInput {
  return { workspaceId: ws.id, workspaceLineId: ws.lines[0]?.id, expectedRevision: ws.revision, requestId, filename: 'source.pdf', contentType: 'application/octet-stream', bytes };
}
async function upload(ws: SalesWorkspace) {
  const input = uploadInput(ws); const result = await uploads.upload(context(input.requestId), input);
  assert.equal(result.ok, true, result.ok ? '' : `${result.error.code}: ${result.error.message}`);
  return { input, ...result.value };
}

await db.exec(`CREATE TABLE organizations(id varchar PRIMARY KEY); CREATE TABLE users(id varchar PRIMARY KEY);
  CREATE TABLE v2_sales_documents(id varchar PRIMARY KEY,organization_id varchar NOT NULL,document_kind text NOT NULL,revision bigint NOT NULL DEFAULT 1,updated_at timestamptz DEFAULT now(),UNIQUE(id,organization_id));
  CREATE TABLE v2_sales_document_lines(id varchar PRIMARY KEY,organization_id varchar NOT NULL,document_id varchar NOT NULL,UNIQUE(id,organization_id),UNIQUE(id,organization_id,document_id));
  CREATE TABLE v2_sales_order_details(document_id varchar,organization_id varchar,PRIMARY KEY(document_id,organization_id));
  CREATE TABLE v2_sales_quote_details(document_id varchar,organization_id varchar,delivery_state text DEFAULT 'not_sent',acceptance_state text DEFAULT 'not_accepted',lifecycle_state text DEFAULT 'open',PRIMARY KEY(document_id,organization_id));
  CREATE TABLE v2_artwork_assignment_removals(organization_id varchar,artwork_assignment_id varchar);`);
await db.query('INSERT INTO organizations VALUES($1),($2)', [org, otherOrg]);
await db.query('INSERT INTO users VALUES($1),($2)', [user, otherUser]);
await db.exec(sql('0180_v2_foundation_persistence.sql'));
await db.exec(sql('0192_v2_quote_operation_audit_and_override_capability.sql').split('-- Selling-price authority')[0]!);
await db.exec(sql('0197_v2_artwork_domain_foundation.sql').split('-- Only future template-derived')[0]!);
await db.exec('ALTER TABLE v2_artwork_assignments ADD COLUMN supersedes_artwork_assignment_id varchar');
await db.exec(sql('0242_v2_quote_artwork_lineage.sql').split('CREATE TABLE v2_quote_accepted_artwork_snapshots')[0]!);
await db.exec(sql('0246_v2_artwork_storage_reconciliation.sql'));
await db.exec(sql('0294_v2_sales_workspace_foundation.sql'));
await db.exec(sql('0295_v2_sales_workspace_artwork.sql'));

try {
  await scenario('Cleanup rejects malformed tenant and bounds before acquiring a connection', async () => {
    let connections = 0;
    const forbiddenPool = { connect: async () => { connections += 1; throw new Error('Unexpected database access'); } };
    const maintenance = new PostgresWorkspaceArtwork(forbiddenPool, storage);
    for (const organizationId of ['', undefined, 'not-a-tenant', null]) {
      await assert.rejects(maintenance.cleanup({ organizationId, limit: 10 } as never), (error: unknown) => error instanceof V2ApplicationError && error.code === 'VALIDATION_ERROR');
    }
    for (const limit of [0, 101, -1, 1.5, undefined, NaN]) {
      await assert.rejects(maintenance.cleanup({ organizationId: org, limit } as never), (error: unknown) => error instanceof V2ApplicationError && error.code === 'VALIDATION_ERROR');
    }
    assert.equal(connections, 0);
    const before = { puts, deletes, existsChecks };
    assert.deepEqual(await claims.cleanup({ organizationId: otherOrg, limit: 10 }), { inspected: 0, deleted: 0, retained: 0, failed: 0, busy: 0, remaining: 0 });
    assert.deepEqual({ puts, deletes, existsChecks }, before);
  });
  await scenario('PDF owner validation and 10MB limit occur before storage or claims', async () => {
    const ws = await fresh(); const input = uploadInput(ws); const before = puts;
    for (const [badBytes, code] of [[new Uint8Array(), 'EMPTY_FILE'], [Buffer.from('not PDF'), 'NOT_PDF'], [Buffer.from('%PDF-invalid'), 'CORRUPT_PDF'], [new Uint8Array(10 * 1024 * 1024 + 1), 'SIZE_LIMIT']] as const) {
      const result = await uploads.upload(context(input.requestId), { ...input, bytes: badBytes }); assert.equal(result.ok, false); if (!result.ok) assert.equal(result.error.code, code);
    }
    assert.equal(puts, before); assert.equal(await scalar('SELECT count(*)::text n FROM v2_artwork_workspace_claims'), 0);
  });
  await scenario('Legacy reconciler fails closed for workspace prefixes without a liveness adapter or storage call', async () => {
    const ledger = new PostgresArtworkStorageUploadLedger(pool);
    const intent = await ledger.reserve({ organizationId: org, storageProvider: 'supabase', objectKey: `v2-artwork/${org}/workspaces/${randomUUID()}/${randomUUID()}.pdf`,
      requestIdentity: `legacy-looking:${randomUUID()}`, expectedChecksumSha256: 'a'.repeat(64), expectedContentType: 'application/pdf', expectedByteSize: bytes.length, objectExpectedToBeCreated: true });
    await db.query("UPDATE v2_artwork_storage_upload_intents SET updated_at=now()-interval '2 days' WHERE id=$1", [intent.id]);
    const before = { puts, deletes, existsChecks };
    const result = await new ArtworkStorageReconciler(ledger, storage).reconcile({ olderThan: new Date(Date.now() - 86_400_000), limit: 100, leaseMs: 1000 });
    assert.equal(result.retained, 1); assert.equal(result.deleted, 0); assert.equal(result.adopted, 0);
    assert.deepEqual({ puts, deletes, existsChecks }, before);
    assert.equal(await scalar("SELECT count(*)::text n FROM v2_artwork_storage_upload_intents WHERE id=$1 AND state='cleanup_pending' AND adopted_artwork_file_id IS NULL AND last_error_code='workspace_cleanup_required'", [intent.id]), 1);
  });
  await scenario('TEMP upload persists ledger first without canonical Sales or Artwork allocation; reload/replay preserves one identity', async () => {
    const ws = await fresh(); const before = puts; const staged = await upload(ws);
    assert.equal(staged.claim.state, 'uploaded'); assert.equal(staged.workspaceRevision, ws.revision + 1);
    assert.equal(await canonicalCount(), 0); assert.equal(await scalar('SELECT count(*)::text n FROM v2_sales_documents'), 0);
    assert.equal('objectKey' in staged.claim, false);
    const replay = await new WorkspaceArtworkUploadService(new PostgresWorkspaceArtwork(pool, storage), storage).upload(context(staged.input.requestId), staged.input);
    assert.deepEqual(replay, { ok: true, value: { claim: staged.claim, workspaceRevision: staged.workspaceRevision } }); assert.equal(puts, before + 1);
    assert.deepEqual((await claims.download(context(), ws.id, staged.claim.id)).bytes, Buffer.from(bytes));
    const mismatch = await uploads.upload(context(staged.input.requestId), { ...staged.input, filename: 'changed.pdf' }); assert.equal(mismatch.ok, false); if (!mismatch.ok) assert.equal(mismatch.error.code, 'CONFLICT');
  });
  await scenario('Fresh authorization applies to request replay and tenant/user/capability violations cause no storage I/O', async () => {
    const ws = await fresh(); const staged = await upload(ws); const before = puts;
    const staff = context(staged.input.requestId);
    const badContexts: OperationContext[] = [
      { ...staff, organizationId: otherOrg },
      { ...staff, principal: { ...staff.principal, userId: otherUser } as OperationContext['principal'] },
      context(staged.input.requestId, ['quote.create','artwork.assign']),
      { ...staff, principal: { kind: 'service', organizationId: org, clientId: user, capabilities } },
    ];
    for (const bad of badContexts) { const result = await uploads.upload(bad, staged.input); assert.equal(result.ok, false); }
    await assert.rejects(claims.list(badContexts[1]!, ws.id), (error: unknown) => error instanceof V2ApplicationError && error.code === 'NOT_FOUND');
    await assert.rejects(claims.download(context('read', ['quote.create']), ws.id, staged.claim.id), /authority/);
    assert.equal(puts, before);
  });
  await scenario('Stale revisions and cross-workspace TEMP line identity reject before a put', async () => {
    const ws = await fresh(), other = await fresh(); const input = uploadInput(ws); const before = puts;
    for (const changed of [{ ...input, expectedRevision: 1 }, { ...input, workspaceLineId: other.lines[0]!.id }]) {
      const result = await uploads.upload(context(changed.requestId), changed); assert.equal(result.ok, false);
    }
    assert.equal(puts, before);
  });
  await scenario('Ambiguous failed put preserves pending claim and retries same object without canonical adoption', async () => {
    const ws = await fresh(); const input = uploadInput(ws); failPut = true;
    const failed = await uploads.upload(context(input.requestId), input); failPut = false;
    assert.equal(failed.ok, false); if (!failed.ok) assert.equal(failed.error.code, 'RETRYABLE_FAILURE');
    assert.equal((await claims.list(context(), ws.id))[0]!.state, 'pending'); assert.equal(await canonicalCount(), 0);
    const before = objects.size; const retried = await uploads.upload(context(input.requestId), input);
    assert.equal(retried.ok, true); assert.equal(objects.size, before);
    assert.equal((await claims.list(context(), ws.id))[0]!.state, 'uploaded');
  });
  await scenario('Unassigned upload can bind later; duplicate unlayered source slot never silently replaces', async () => {
    const ws = await fresh(); const input = { ...uploadInput(ws), workspaceLineId: undefined };
    const result = await uploads.upload(context(input.requestId), input); assert.equal(result.ok, true);
    const requestId = randomUUID(); const assigned = await claims.assign(context(requestId), { workspaceId: ws.id, claimId: result.value.claim.id, workspaceLineId: ws.lines[0]!.id, requestId, expectedRevision: result.value.workspaceRevision });
    assert.equal(assigned.claim.workspaceLineId, ws.lines[0]!.id);
    const second = uploadInput({ ...ws, revision: assigned.workspaceRevision }); const rejected = await uploads.upload(context(second.requestId), second); assert.equal(rejected.ok, false);
  });
  for (const pending of [false, true]) await scenario(`Current claim binding requires assign authority on ${pending ? 'pending retry' : 'uploaded replay'}`, async () => {
    const ws = await fresh(); const input = { ...uploadInput(ws), workspaceLineId: undefined };
    failPut = pending; const initial = await uploads.upload(context(input.requestId), input); failPut = false;
    assert.equal(initial.ok, !pending);
    const claim = (await claims.list(context(), ws.id))[0]!;
    const requestId = randomUUID();
    const assigned = await claims.assign(context(requestId), { workspaceId: ws.id, claimId: claim.id, workspaceLineId: ws.lines[0]!.id, requestId, expectedRevision: ws.revision + 1 });
    const before = puts;
    const denied = await uploads.upload(context(input.requestId, ['quote.create','artwork.adopt']), { ...input, expectedRevision: assigned.workspaceRevision });
    assert.equal(denied.ok, false); if (!denied.ok) assert.equal(denied.error.code, 'FORBIDDEN');
    assert.equal(puts, before); assert.equal((await claims.list(context(), ws.id))[0]!.state, pending ? 'pending' : 'uploaded');
    const allowed = await uploads.upload(context(input.requestId), { ...input, expectedRevision: assigned.workspaceRevision });
    assert.equal(allowed.ok, true); assert.equal(allowed.value.claim.workspaceLineId, ws.lines[0]!.id);
  });
  await scenario('A created-false collision must match stored length, digest and validated PDF before upload acceptance', async () => {
    const ws = await fresh(); const input = uploadInput(ws); let objectKey = '', reads = 0;
    const wrongBytes = Buffer.from(bytes); wrongBytes[20] = wrongBytes[20]! ^ 1;
    const collisionStorage: ArtworkBinaryStorage = {
      ...storage,
      async put(value) { objectKey = value.objectKey; if (!objects.has(objectKey)) objects.set(objectKey, wrongBytes); return { storageProvider: 'supabase', objectKey, created: false }; },
      async read(key) { reads += 1; return storage.read(key); },
    };
    const collisionClaims = new PostgresWorkspaceArtwork(pool, collisionStorage);
    const collisionUploads = new WorkspaceArtworkUploadService(collisionClaims, collisionStorage);
    const beforeFiles = await canonicalCount();
    const denied = await collisionUploads.upload(context(input.requestId), input);
    assert.equal(denied.ok, false); assert.equal(reads, 1);
    assert.equal((await collisionClaims.list(context(), ws.id))[0]!.state, 'pending');
    assert.equal(await canonicalCount(), beforeFiles);
    assert.equal(await scalar("SELECT count(*)::text n FROM v2_artwork_workspace_claims WHERE workspace_id=$1 AND last_error_code='upload_failed' AND settled_upload_generation=upload_generation", [ws.id]), 1);
    objects.set(objectKey, Buffer.from('not PDF'));
    const badLength = await collisionUploads.upload(context(input.requestId), input); assert.equal(badLength.ok, false); assert.equal(reads, 2);
    objects.set(objectKey, Buffer.from(bytes));
    const accepted = await collisionUploads.upload(context(input.requestId), input); assert.equal(accepted.ok, true); assert.equal(reads, 3);
    assert.equal(accepted.value.claim.state, 'uploaded'); assert.equal(await canonicalCount(), beforeFiles);
  });
  await scenario('Legacy reconciler honors actual relational TEMP claims even without the prefix and never fake-adopts', async () => {
    const ws = await fresh(); const staged = await upload(ws);
    await db.query("UPDATE v2_artwork_storage_upload_intents SET request_identity='legacy-looking',updated_at=now()-interval '2 days' WHERE id=(SELECT upload_intent_id FROM v2_artwork_workspace_claims WHERE id=$1)", [staged.claim.id]);
    const before = deletes;
    const summary = await new ArtworkStorageReconciler(new PostgresArtworkStorageUploadLedger(pool), storage, claims).reconcile({ olderThan: new Date(Date.now() - 86_400_000), limit: 100, leaseMs: 1000 });
    assert.equal(summary.retained, 1); assert.equal(summary.adopted, 0); assert.equal(deletes, before);
    assert.equal((await claims.list(context(), ws.id))[0]!.state, 'uploaded');
  });
  await scenario('Cleanup failure retains durable evidence; successful retry deletes only released bytes', async () => {
    const ws = await fresh(); const staged = await upload(ws); const requestId = randomUUID();
    const removed = await claims.remove(context(requestId), { workspaceId: ws.id, claimId: staged.claim.id, expectedRevision: staged.workspaceRevision, requestId });
    failDelete = true; const failed = await claims.cleanup({ organizationId: org, limit: 100 }); failDelete = false;
    assert.equal(failed.failed, 1); assert.equal(failed.remaining, 1);
    assert.equal((await claims.list(context(), ws.id))[0]!.state, 'cleanup_pending');
    assert.equal(await scalar('SELECT cleanup_attempts::text n FROM v2_artwork_workspace_claims WHERE id=$1', [staged.claim.id]), 1);
    const replacement = await upload({ ...ws, revision: removed.workspaceRevision });
    const done = await claims.cleanup({ organizationId: org, limit: 100 }); assert.equal(done.deleted, 1); assert.equal(done.remaining, 0);
    const remaining = await claims.list(context(), ws.id);
    assert.equal(remaining.find((claim) => claim.id === staged.claim.id)!.state, 'deleted'); assert.equal(await canonicalCount(), 0);
    assert.equal(remaining.find((claim) => claim.id === replacement.claim.id)!.state, 'uploaded');
    assert.deepEqual((await claims.download(context(), ws.id, replacement.claim.id)).bytes, Buffer.from(bytes));
  });
  await scenario('Discard during a put records cleanup-pending, never canonical adoption or lost deletion evidence', async () => {
    const ws = await fresh(); const input = uploadInput(ws);
    putHook = async () => { await sales.discard(context(), ws.id, { requestId: randomUUID(), expectedRevision: ws.revision + 1 }); };
    const result = await uploads.upload(context(input.requestId), input); putHook = undefined;
    assert.equal(result.ok, false); assert.equal((await claims.list(context(), ws.id))[0]!.state, 'cleanup_pending');
    assert.equal((await claims.cleanup({ organizationId: org, limit: 100 })).deleted, 1);
    assert.equal(await canonicalCount(), 0);
  });
  await scenario('Disconnected pending upload remains cleanup-eligible until its late write is recovered on a new session', async () => {
    const ws = await fresh(); const input = uploadInput(ws);
    let dead = false, connections = 0, objectKey = '';
    const disconnected = { query: (text: string, values?: unknown[]) => dead ? Promise.reject(new Error('Session disconnected')) : client.query(text, values), release() {} } as unknown as PoolClient;
    const faultPool = { connect: async () => ++connections === 1 ? disconnected : client };
    let start!: () => void, complete!: () => void;
    const started = new Promise<void>((resolve) => { start = resolve; });
    const completion = new Promise<void>((resolve) => { complete = resolve; });
    const delayedStorage: ArtworkBinaryStorage = { ...storage, async put(value) {
      objectKey = value.objectKey; start(); await completion;
      objects.set(objectKey, Buffer.from(value.bytes));
      return { storageProvider: 'supabase', objectKey, created: true };
    } };
    const faultClaims = new PostgresWorkspaceArtwork(faultPool, delayedStorage);
    const uploading = new WorkspaceArtworkUploadService(faultClaims, delayedStorage).upload(context(input.requestId), input);
    await started;
    // Fault injection models PostgreSQL releasing a disconnected session's
    // locks while the independent object-storage request is still in flight.
    await client.query('SELECT pg_advisory_unlock_all()'); dead = true;
    await sales.discard(context(), ws.id, { requestId: randomUUID(), expectedRevision: ws.revision + 1 });
    const initial = await claims.cleanup({ organizationId: org, limit: 100 });
    assert.equal(initial.deleted, 1); assert.equal(initial.remaining, 1); assert.equal(objects.has(objectKey), false);
    const claim = (await claims.list(context(), ws.id))[0]!; assert.equal(claim.state, 'cleanup_pending');
    await assert.rejects(db.query("UPDATE v2_artwork_workspace_claims SET state='deleted' WHERE id=$1", [claim.id]), /settlement/);
    complete(); const result = await uploading; assert.equal(result.ok, false);
    assert.equal(objects.has(objectKey), true); assert.ok(connections >= 2, 'Late completion must acquire a fresh recovery connection');
    assert.equal(await scalar('SELECT count(*)::text n FROM v2_artwork_workspace_claims WHERE id=$1 AND settled_upload_generation=upload_generation', [claim.id]), 1);
    const final = await claims.cleanup({ organizationId: org, limit: 100 });
    assert.equal(final.deleted, 1); assert.equal(final.remaining, 0); assert.equal(objects.has(objectKey), false);
    assert.equal((await claims.list(context(), ws.id))[0]!.state, 'deleted');
    assert.equal(await canonicalCount(), 0);
  });
  await scenario('A delete ACK cannot finalize using upload settlement that happened after deletion dispatch', async () => {
    const ws = await fresh(); const input = uploadInput(ws);
    let dead = false, connections = 0, objectKey = '';
    const events: string[] = [];
    const disconnected = { query: (text: string, values?: unknown[]) => dead ? Promise.reject(new Error('Session disconnected')) : client.query(text, values), release() {} } as unknown as PoolClient;
    const faultPool = { connect: async () => ++connections === 1 ? disconnected : client };
    let startPut!: () => void, finishPut!: () => void, appliedDelete!: () => void, acknowledgeDelete!: () => void;
    const putStarted = new Promise<void>((resolve) => { startPut = resolve; });
    const putCompletion = new Promise<void>((resolve) => { finishPut = resolve; });
    const deleteApplied = new Promise<void>((resolve) => { appliedDelete = resolve; });
    const deleteAcknowledgment = new Promise<void>((resolve) => { acknowledgeDelete = resolve; });
    const delayedStorage: ArtworkBinaryStorage = {
      ...storage,
      async put(value) {
        objectKey = value.objectKey; startPut(); await putCompletion;
        objects.set(objectKey, Buffer.from(value.bytes)); events.push('put-written');
        return { storageProvider: 'supabase', objectKey, created: true };
      },
      async remove(key) {
        await storage.remove(key); events.push('delete-applied'); appliedDelete();
        await deleteAcknowledgment; events.push('delete-ack');
      },
    };
    const faultClaims = new PostgresWorkspaceArtwork(faultPool, delayedStorage);
    const uploading = new WorkspaceArtworkUploadService(faultClaims, delayedStorage).upload(context(input.requestId), input);
    await putStarted;
    await client.query('SELECT pg_advisory_unlock_all()'); dead = true;
    await sales.discard(context(), ws.id, { requestId: randomUUID(), expectedRevision: ws.revision + 1 });
    const cleaning = faultClaims.cleanup({ organizationId: org, limit: 100 });
    await deleteApplied;
    assert.equal(objects.has(objectKey), false);
    const claim = (await claims.list(context(), ws.id))[0]!;
    assert.equal(await scalar('SELECT count(*)::text n FROM v2_artwork_workspace_claims WHERE id=$1 AND upload_generation=1 AND settled_upload_generation=0', [claim.id]), 1);
    finishPut(); const uploaded = await uploading; assert.equal(uploaded.ok, false);
    assert.ok(connections >= 4, 'Completion recovery must use a fresh connection while delete awaits its ACK');
    assert.equal(objects.has(objectKey), true);
    assert.equal(await scalar('SELECT count(*)::text n FROM v2_artwork_workspace_claims WHERE id=$1 AND upload_generation=1 AND settled_upload_generation=1 AND NOT cleanup_recheck_required', [claim.id]), 1);
    events.push('settlement-recorded'); acknowledgeDelete();
    const first = await cleaning;
    assert.deepEqual(events, ['delete-applied', 'put-written', 'settlement-recorded', 'delete-ack']);
    assert.equal(first.remaining, 1, 'Delete ACK must not use settlement that happened after dispatch');
    assert.equal(first.deleted, 1); assert.equal(objects.has(objectKey), true);
    assert.equal((await claims.list(context(), ws.id))[0]!.state, 'cleanup_pending');
    assert.equal(await scalar("SELECT count(*)::text n FROM v2_artwork_storage_upload_intents WHERE id=(SELECT upload_intent_id FROM v2_artwork_workspace_claims WHERE id=$1) AND state='cleanup_pending'", [claim.id]), 1);
    const final = await faultClaims.cleanup({ organizationId: org, limit: 100 });
    assert.equal(final.deleted, 1); assert.equal(final.remaining, 0); assert.equal(objects.has(objectKey), false);
    assert.equal((await claims.list(context(), ws.id))[0]!.state, 'deleted');
    assert.equal(await scalar("SELECT count(*)::text n FROM v2_artwork_storage_upload_intents WHERE id=(SELECT upload_intent_id FROM v2_artwork_workspace_claims WHERE id=$1) AND state='cleaned'", [claim.id]), 1);
    assert.equal(await canonicalCount(), 0);
  });
  await scenario('Line deletion requires owner release; released claim preserves evidence after the TEMP line disappears', async () => {
    const ws = await fresh(); const staged = await upload(ws);
    await assert.rejects(ownerStore.run(async (tx) => { await tx.get(org, user, ws.id, true); await tx.deleteLine(org, ws.id, ws.lines[0]!.id); }));
    await ownerStore.run(async (tx) => {
      const current = (await tx.get(org, user, ws.id, true))!;
      await requestWorkspaceArtworkCleanupInTransaction((tx as PostgresSalesWorkspaceTransaction).client, { organizationId: org, workspaceId: ws.id, workspaceLineId: ws.lines[0]!.id });
      await tx.deleteLine(org, ws.id, ws.lines[0]!.id); await tx.update(bumpSalesWorkspaceRevision({ ...current, lines: [] }), current.revision);
    });
    const claim = (await claims.list(context(), ws.id))[0]!; assert.equal(claim.id, staged.claim.id); assert.equal(claim.workspaceLineId, null); assert.equal(claim.state, 'cleanup_pending');
    assert.equal((await claims.cleanup({ organizationId: org, limit: 100 })).deleted, 1);
  });
  await scenario('Expiry rejects upload and releases abandoned pending/uploaded bytes without a startup worker', async () => {
    const expired = await fresh(false, new Date(Date.now() - 1000)); const input = uploadInput(expired);
    const denied = await uploads.upload(context(input.requestId), input); assert.equal(denied.ok, false);
    const ws = await fresh(true, new Date(Date.now() + 1500)); await upload(ws);
    await new Promise((resolve) => setTimeout(resolve, 1550));
    const cleaned = await claims.cleanup({ organizationId: org, limit: 100 }); assert.equal(cleaned.deleted, 1);
    assert.equal((await claims.list(context(), ws.id))[0]!.state, 'deleted');
  });

  for (const stage of ['unassigned','pending'] as const) await scenario(`${stage} TEMP claim rejects promotion without choosing an arbitrary line or adopting a file`, async () => {
    const ws = await fresh(); const input = { ...uploadInput(ws), ...(stage === 'unassigned' ? { workspaceLineId: undefined } : {}) };
    failPut = stage === 'pending'; const staged = await uploads.upload(context(input.requestId), input); failPut = false;
    assert.equal(staged.ok, stage === 'unassigned');
    const beforeFiles = await canonicalCount(), beforePuts = puts;
    await assert.rejects((async () => {
      await client.query('BEGIN');
      try {
        const tx = new PostgresSalesWorkspaceTransaction(client); const current = (await tx.get(org, user, ws.id, true))!;
        await tx.beginPromotion(org, ws.id, current.revision, randomUUID(), 'order', 'a'.repeat(64));
        const documentId = randomUUID(), canonicalLineId = randomUUID();
        await client.query("INSERT INTO v2_sales_documents(id,organization_id,document_kind) VALUES($1,$2,'order')", [documentId, org]);
        await client.query('INSERT INTO v2_sales_document_lines VALUES($1,$2,$3)', [canonicalLineId, org, documentId]);
        await client.query('INSERT INTO v2_sales_order_details VALUES($1,$2)', [documentId, org]);
        const lineMap = [{ workspaceLineId: ws.lines[0]!.id, canonicalLineId, position: 0 }];
        await tx.recordPromotionLineMap(org, ws.id, 'order', documentId, lineMap);
        await promoteWorkspaceArtworkInTransaction(client, { organizationId: org, workspaceId: ws.id, actor: context(), documentKind: 'order', documentId, lineMap });
      } finally { await client.query('ROLLBACK'); }
    })(), /finish uploading and be assigned/);
    assert.equal(await canonicalCount(), beforeFiles); assert.equal(puts, beforePuts);
    const claim = (await claims.list(context(), ws.id))[0]!;
    assert.equal(claim.state, stage === 'unassigned' ? 'uploaded' : 'pending'); assert.equal(claim.artworkFileId, null);
    if (stage === 'unassigned') assert.equal(claim.workspaceLineId, null);
    assert.equal((await sales.get(context(), ws.id)).state, 'draft');
  });

  for (const target of ['quote','order'] as const) await scenario(`${target} promotion uses actual canonical owners on one client, binds identity and replays without duplicate rows`, async () => {
    const ws = await fresh(); const staged = await upload(ws); const documentId = randomUUID(), lineId = randomUUID(), promotionRequestId = randomUUID();
    const beforeFiles = await canonicalCount(); const beforePuts = puts;
    await client.query('BEGIN');
    try {
      const tx = new PostgresSalesWorkspaceTransaction(client); const current = (await tx.get(org, user, ws.id, true))!;
      await tx.beginPromotion(org, ws.id, current.revision, promotionRequestId, target, 'a'.repeat(64));
      await client.query('INSERT INTO v2_sales_documents(id,organization_id,document_kind) VALUES($1,$2,$3)', [documentId, org, target]);
      await client.query('INSERT INTO v2_sales_document_lines VALUES($1,$2,$3)', [lineId, org, documentId]);
      await client.query(target === 'quote' ? 'INSERT INTO v2_sales_quote_details(document_id,organization_id) VALUES($1,$2)' : 'INSERT INTO v2_sales_order_details VALUES($1,$2)', [documentId, org]);
      const lineMap = [{ workspaceLineId: ws.lines[0]!.id, canonicalLineId: lineId, position: 0 }];
      await tx.recordPromotionLineMap(org, ws.id, target, documentId, lineMap);
      const promoteInput = { organizationId: org, workspaceId: ws.id, actor: context(), documentKind: target, documentId, lineMap };
      await assert.rejects(promoteWorkspaceArtworkInTransaction(client, { ...promoteInput, organizationId: otherOrg }), /organization/);
      await assert.rejects(promoteWorkspaceArtworkInTransaction(client, { ...promoteInput, lineMap: [] }), /mapping/);
      await assert.rejects(promoteWorkspaceArtworkInTransaction(client, { ...promoteInput, documentId: randomUUID() }), /mapping/);
      await assert.rejects(promoteWorkspaceArtworkInTransaction(client, { ...promoteInput, actor: context('denied', ['quote.create','artwork.adopt']) }), /authority/);
      const result = await promoteWorkspaceArtworkInTransaction(client, promoteInput);
      assert.equal(result.promotedCount, 1); assert.equal(result.claims[0]!.id, staged.claim.id);
      assert.deepEqual(await promoteWorkspaceArtworkInTransaction(client, promoteInput), result);
      await assert.rejects(promoteWorkspaceArtworkInTransaction(client, { ...promoteInput, documentKind: target === 'quote' ? 'order' : 'quote' }), /mapping/);
      const revision = String((await db.query<{ revision: number }>('SELECT revision FROM v2_sales_documents WHERE id=$1', [documentId])).rows[0]!.revision);
      assert.equal(revision, target === 'quote' ? '2' : '1');
      const receipt: SalesWorkspacePromotionReceipt = { workspaceId: ws.id, organizationId: org, requestId: promotionRequestId, fingerprint: 'a'.repeat(64), inputRevision: current.revision, target, documentId, documentRevision: revision, header: {}, lineMap, promotedAt: new Date().toISOString() };
      await tx.recordPromotion(receipt); await tx.update({ ...bumpSalesWorkspaceRevision(current), state: 'promoted', promotion: receipt }, current.revision);
      await client.query('COMMIT');
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    assert.equal(await canonicalCount(), beforeFiles + 1); assert.equal(puts, beforePuts);
    await client.query('BEGIN');
    try {
      const replay = await promoteWorkspaceArtworkInTransaction(client, { organizationId: org, workspaceId: ws.id, actor: context(), documentKind: target, documentId, lineMap: [{ workspaceLineId: ws.lines[0]!.id, canonicalLineId: lineId, position: 0 }] });
      assert.equal(replay.promotedCount, 1); assert.equal(replay.claims[0]!.id, staged.claim.id);
      await client.query('COMMIT');
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    assert.equal(await canonicalCount(), beforeFiles + 1);
    assert.equal(await scalar(`SELECT count(*)::text n FROM v2_artwork_workspace_claims c
      JOIN v2_artwork_storage_upload_intents i ON i.id=c.upload_intent_id AND i.organization_id=c.organization_id
      JOIN v2_artwork_files f ON f.id=c.artwork_file_id AND f.organization_id=c.organization_id
      WHERE c.id=$1 AND c.state='promoted' AND i.state='adopted' AND i.adopted_artwork_file_id=f.id
      AND c.object_key=i.object_key AND f.object_key=c.object_key`, [staged.claim.id]), 1);
    const beforeDeletes = deletes; await claims.cleanup({ organizationId: org, limit: 100 }); assert.equal(deletes, beforeDeletes);
    assert.equal((await claims.list(context(), ws.id))[0]!.state, 'promoted');
  });
  await scenario('Late assignment failure really rolls back canonical files and map; uploaded claim remains retryable', async () => {
    const ws = await fresh(); const staged = await upload(ws); const before = await canonicalCount();
    await db.exec("CREATE FUNCTION fixture_reject_assignment() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected'; END $$; CREATE TRIGGER fixture_reject BEFORE INSERT ON v2_artwork_assignments FOR EACH ROW EXECUTE FUNCTION fixture_reject_assignment();");
    await assert.rejects((async () => {
      await client.query('BEGIN');
      try {
        const tx = new PostgresSalesWorkspaceTransaction(client); const current = (await tx.get(org, user, ws.id, true))!;
        await tx.beginPromotion(org, ws.id, current.revision, randomUUID(), 'order', 'a'.repeat(64));
        const documentId = randomUUID(), canonicalLineId = randomUUID();
        await client.query("INSERT INTO v2_sales_documents(id,organization_id,document_kind) VALUES($1,$2,'order')", [documentId, org]);
        await client.query('INSERT INTO v2_sales_document_lines VALUES($1,$2,$3)', [canonicalLineId, org, documentId]);
        await client.query('INSERT INTO v2_sales_order_details VALUES($1,$2)', [documentId, org]);
        const lineMap = [{ workspaceLineId: ws.lines[0]!.id, canonicalLineId, position: 0 }];
        await tx.recordPromotionLineMap(org, ws.id, 'order', documentId, lineMap);
        await promoteWorkspaceArtworkInTransaction(client, { organizationId: org, workspaceId: ws.id, actor: context(), documentKind: 'order', documentId, lineMap });
      } finally { await client.query('ROLLBACK'); }
    })());
    await db.exec('DROP TRIGGER fixture_reject ON v2_artwork_assignments; DROP FUNCTION fixture_reject_assignment()');
    assert.equal(await canonicalCount(), before); assert.equal((await sales.get(context(), ws.id)).state, 'draft');
    assert.equal((await claims.list(context(), ws.id))[0]!.id, staged.claim.id); assert.equal((await claims.list(context(), ws.id))[0]!.state, 'uploaded');
    assert.equal(await scalar('SELECT count(*)::text n FROM v2_sales_workspace_promotion_lines WHERE workspace_id=$1', [ws.id]), 0);
  });
  await scenario('Physical fence blocks arbitrary adoption before promotion and after cleanup release', async () => {
    const ws = await fresh(); const staged = await upload(ws);
    const insert = `INSERT INTO v2_artwork_files(id,organization_id,storage_provider,object_key,original_filename,display_filename,content_type,byte_size,checksum_algorithm,checksum_value,source_kind)
      SELECT $2,organization_id,storage_provider,object_key,filename,filename,content_type,byte_size,'sha256',checksum_sha256,'customer_upload' FROM v2_artwork_workspace_claims WHERE id=$1`;
    await assert.rejects(db.query(insert, [staged.claim.id, randomUUID()]), /not available/);
    const requestId = randomUUID(); await claims.remove(context(requestId), { workspaceId: ws.id, claimId: staged.claim.id, expectedRevision: staged.workspaceRevision, requestId });
    await assert.rejects(db.query(insert, [staged.claim.id, randomUUID()]), /not available/);
    await assert.rejects(db.query('DELETE FROM v2_artwork_workspace_claims WHERE id=$1', [staged.claim.id]), /evidence/);
    await claims.cleanup({ organizationId: org, limit: 100 });
  });
  await scenario('A released claim with a real shared canonical blob reference is retained, never deleted', async () => {
    const ws = await fresh(); const staged = await upload(ws); const documentId = randomUUID(), canonicalLineId = randomUUID(), fileId = randomUUID(), requestId = randomUUID();
    await ownerStore.run(async (tx) => {
      const current = (await tx.get(org, user, ws.id, true))!;
      await tx.beginPromotion(org, ws.id, current.revision, requestId, 'order', 'a'.repeat(64));
      await client.query("INSERT INTO v2_sales_documents(id,organization_id,document_kind) VALUES($1,$2,'order')", [documentId, org]);
      await client.query('INSERT INTO v2_sales_document_lines VALUES($1,$2,$3)', [canonicalLineId, org, documentId]);
      const lineMap = [{ workspaceLineId: ws.lines[0]!.id, canonicalLineId, position: 0 }];
      await tx.recordPromotionLineMap(org, ws.id, 'order', documentId, lineMap);
      // Simulate a pre-existing canonical reference independently of claim state.
      await client.query(`INSERT INTO v2_artwork_files(id,organization_id,storage_provider,object_key,original_filename,display_filename,content_type,byte_size,checksum_algorithm,checksum_value,source_kind)
        SELECT $2,organization_id,storage_provider,object_key,filename,filename,content_type,byte_size,'sha256',checksum_sha256,'customer_upload' FROM v2_artwork_workspace_claims WHERE id=$1`, [staged.claim.id, fileId]);
      const receipt: SalesWorkspacePromotionReceipt = { workspaceId: ws.id, organizationId: org, requestId, fingerprint: 'a'.repeat(64), inputRevision: current.revision, target: 'order', documentId, documentRevision: '1', header: {}, lineMap, promotedAt: new Date().toISOString() };
      await tx.recordPromotion(receipt); await tx.update({ ...bumpSalesWorkspaceRevision(current), state: 'promoted', promotion: receipt }, current.revision);
      await requestWorkspaceArtworkCleanupInTransaction(client, { organizationId: org, workspaceId: ws.id });
    });
    const before = deletes; const result = await claims.cleanup({ organizationId: org, limit: 100 });
    assert.equal(result.retained, 1); assert.equal(result.remaining, 0); assert.equal(deletes, before);
    const retained = (await claims.list(context(), ws.id))[0]!; assert.equal(retained.state, 'retained'); assert.equal(retained.artworkFileId, fileId);
    assert.equal(await scalar("SELECT count(*)::text n FROM v2_artwork_storage_upload_intents WHERE adopted_artwork_file_id=$1 AND state='adopted'", [fileId]), 1);
  });
  await scenario('An ambiguous provider failure stays visible and removes a later remote write on the next bounded scan', async () => {
    const ws = await fresh(); const input = uploadInput(ws); let objectKey = '';
    const uncertainStorage: ArtworkBinaryStorage = { ...storage, async put(value) {
      objectKey = value.objectKey;
      throw new Error('Provider result unknown: the request may still arrive remotely');
    } };
    const uncertainClaims = new PostgresWorkspaceArtwork(pool, uncertainStorage);
    const failed = await new WorkspaceArtworkUploadService(uncertainClaims, uncertainStorage).upload(context(input.requestId), input);
    assert.equal(failed.ok, false);
    await sales.discard(context(), ws.id, { requestId: randomUUID(), expectedRevision: ws.revision + 1 });
    const first = await claims.cleanup({ organizationId: org, limit: 100 });
    assert.equal(first.deleted, 1); assert.equal(first.remaining, 1); assert.equal(objects.has(objectKey), false);
    // There is no provider settlement/cancellation proof in ArtworkBinaryStorage.
    // A false exists() or elapsed timeout must never suppress this later write.
    objects.set(objectKey, Buffer.from(bytes));
    const second = await claims.cleanup({ organizationId: org, limit: 100 });
    assert.equal(second.deleted, 1); assert.equal(second.remaining, 1); assert.equal(objects.has(objectKey), false);
    const claim = (await claims.list(context(), ws.id))[0]!;
    assert.equal(claim.state, 'cleanup_pending');
    await assert.rejects(db.query("UPDATE v2_artwork_workspace_claims SET state='deleted' WHERE id=$1", [claim.id]), /deleted_check/);
    assert.equal(await scalar("SELECT count(*)::text n FROM v2_artwork_storage_upload_intents WHERE id=(SELECT upload_intent_id FROM v2_artwork_workspace_claims WHERE id=$1) AND state='cleanup_pending'", [claim.id]), 1);
  });
  console.log(`workspaceArtwork.test: ${testNames.length} PGlite scenarios PASS`);
} finally { await db.close(); }
