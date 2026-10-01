import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import type { Pool, PoolClient } from "pg";
import type { OperationContext } from "../../src/application/operation.js";
import type { Capability } from "../../src/authorization/capabilities.js";
import type { ArtworkBinaryStorage } from "../../infrastructure/artwork/artworkBinaryStorage.js";
import type { SalesWorkspace } from "../../src/modules/sales/workspaceContracts.js";

// This suite has no URL target. Run through cleanEnvironment/run, not root Jest.
assert.equal(process.env.V2_VALIDATION_MODE, "deterministic", "The guarded deterministic runner is required.");
assert.deepEqual(Object.keys(process.env).filter((key) => /^(PG|DB)|DATABASE|POSTGRES|NEON|RAILWAY|CONNECTION_STRING/i.test(key)), []);
const { PostgresSalesWorkspaceStore, PostgresSalesWorkspaceTransaction } = await import("../../infrastructure/sales/postgresSalesWorkspace.js");
const { SalesWorkspaceApplicationService } = await import("../../src/modules/sales/workspaceApplication.js");
const { SalesWorkspaceLineService } = await import("../../src/modules/sales/workspaceLines.js");
const { PostgresWorkspaceLinePricing } = await import("../../infrastructure/sales/postgresWorkspaceLinePricing.js");
const { PostgresWorkspaceArtwork, requestWorkspaceArtworkCleanupInTransaction } = await import("../../infrastructure/artwork/postgresWorkspaceArtwork.js");
const { WorkspaceArtworkUploadService } = await import("../../infrastructure/artwork/workspaceArtworkUpload.js");
const { V2PricingParityAdapter } = await import("../../src/modules/pricing/v2PricingAdapter.js");
const { brandedId, currencyCode } = await import("../../src/modules/shared/commercialValues.js");

const org = randomUUID(), otherOrg = randomUUID(), user = randomUUID(), otherUser = randomUUID();
const customer = brandedId<"CustomerId">(randomUUID()), product = brandedId<"ProductId">(randomUUID());
const config = brandedId<"PricingConfigurationId">(randomUUID()), usd = currencyCode("USD");
const capabilities: readonly Capability[] = ["quote.create", "order.create", "quote.overridePrice", "order.overridePrice", "artwork.view", "artwork.adopt", "artwork.assign"];
function context(requestId = "request", organizationId = org, userId = user, caps = capabilities): OperationContext {
  return { organizationId, operationId: "sales.workspace.acceptance", businessRequest: { id: requestId, payloadFingerprint: "untrusted-wire-value" },
    principal: { kind: "staff", organizationId, userId, authority: { membershipId: randomUUID(), capabilities: caps } } };
}
const header = { customerContact: { organizationId: brandedId<"OrganizationId">(org), customerId: customer }, jobLabel: "Independent acceptance", purchaseOrderNumber: "PO-42" };
const entry = { productId: product, quantity: 2, description: "Source input retained", selections: {} };
const code = (expected: string) => (error: unknown) => { assert.equal((error as { code?: string }).code, expected); return true; };
const wire = <T>(value: T): T => JSON.parse(JSON.stringify(value));

async function fixture() {
  const db = new PGlite();
  const sql: string[] = [];
  let checkedOut = false, insideTransaction = false;
  const client = Object.freeze({
    async query(text: string, values?: readonly unknown[]) {
      sql.push(text);
      const result = await db.query(text, values ? [...values] : []);
      if (text === "BEGIN") insideTransaction = true;
      if (text === "COMMIT" || text === "ROLLBACK") insideTransaction = false;
      return { ...result, rowCount: result.affectedRows ?? result.rows.length };
    },
    release() { assert.equal(checkedOut, true); checkedOut = false; },
  }) as unknown as PoolClient;
  const pool = Object.freeze({ async connect() { assert.equal(checkedOut, false, "No nested connection or transaction is allowed."); checkedOut = true; return client; } }) as unknown as Pool;
  // Only prerequisite owner tables are stubs. Every workspace/claim table,
  // foreign key, deferred trigger and state guard comes from actual migrations.
  await db.exec(`CREATE TABLE organizations(id varchar PRIMARY KEY);
    CREATE TABLE users(id varchar PRIMARY KEY);
    CREATE TABLE v2_sales_documents(id varchar PRIMARY KEY,organization_id varchar NOT NULL REFERENCES organizations(id),document_kind text NOT NULL,revision integer NOT NULL DEFAULT 1,UNIQUE(id,organization_id));
    CREATE TABLE v2_sales_document_lines(id varchar PRIMARY KEY,organization_id varchar NOT NULL,document_id varchar NOT NULL,UNIQUE(id,organization_id),UNIQUE(id,organization_id,document_id),FOREIGN KEY(document_id,organization_id) REFERENCES v2_sales_documents(id,organization_id));
    CREATE TABLE acceptance_canonical_effects(id text PRIMARY KEY,owner text NOT NULL);
    CREATE TABLE acceptance_numbers(kind text PRIMARY KEY,value integer NOT NULL);
    CREATE TABLE v2_artwork_files(id varchar PRIMARY KEY,organization_id varchar NOT NULL REFERENCES organizations(id),storage_provider text NOT NULL,object_key text NOT NULL,content_type text NOT NULL,byte_size bigint NOT NULL,checksum_algorithm text,checksum_value text,UNIQUE(id,organization_id));`);
  for (const id of [org, otherOrg]) await db.query("INSERT INTO organizations VALUES($1)", [id]);
  for (const id of [user, otherUser]) await db.query("INSERT INTO users VALUES($1)", [id]);
  for (const name of ["0180_v2_foundation_persistence.sql", "0246_v2_artwork_storage_reconciliation.sql", "0294_v2_sales_workspace_foundation.sql", "0295_v2_sales_workspace_artwork.sql"]) {
    await db.exec(await readFile(new URL(`../../../server/db/migrations_v2/${name}`, import.meta.url), "utf8"));
  }
  let clock = new Date();
  const store = () => new PostgresSalesWorkspaceStore(pool);
  const app = () => new SalesWorkspaceApplicationService(store(), { now: () => clock,
    onDiscard: (tx, workspace) => { assert.ok(tx instanceof PostgresSalesWorkspaceTransaction); return requestWorkspaceArtworkCleanupInTransaction(tx.client, { organizationId: workspace.organizationId, workspaceId: workspace.id }); } });
  const pricing = new V2PricingParityAdapter();
  let pricingFails = false;
  const lines = () => new SalesWorkspaceLineService(store(), {
    now: () => clock,
    pricing: (tx) => { assert.ok(tx instanceof PostgresSalesWorkspaceTransaction); return new PostgresWorkspaceLinePricing(tx.client, { now: () => clock, pricing,
      customers: { validateContactReference: async (reference) => reference.organizationId === org, getContact: async () => null },
      customerPricing: { calculateForCustomer: (_id, request) => pricing.calculate(request) },
      products: { resolveActivePricingInput: async (input) => {
        if (pricingFails) throw new Error("Injected owner preview failure");
        return { ok: true, value: {
          sellableProduct: { organizationId: brandedId<"OrganizationId">(org), productId: product, displayName: "Fixture product", lifecycle: "active", requiresDimensions: false, pricingCurrency: usd, pricingConfiguration: { id: config, version: "1", contentHash: "fixture-v1" } },
          resolvedConfiguration: { schemaVersion: 1, organizationId: brandedId<"OrganizationId">(org), productId: product, pricingConfigurationId: config, pricingConfigurationVersion: "1", pricingConfigurationContentHash: "fixture-v1", quantity: input.quantity, selections: input.selections ?? {}, derivedFacts: {}, productFacts: {} },
          rules: { base: { perPieceCents: 125 } }, warnings: [],
        } };
      } },
    }); },
    releaseLineArtwork: (tx, workspace, lineId) => { assert.ok(tx instanceof PostgresSalesWorkspaceTransaction); return requestWorkspaceArtworkCleanupInTransaction(tx.client, { organizationId: workspace.organizationId, workspaceId: workspace.id, workspaceLineId: lineId }); },
  });
  const objects = new Map<string, Buffer>();
  let deleteFails = false, putFails = false, puts = 0;
  const storage: ArtworkBinaryStorage = {
    async put(input) { assert.equal(insideTransaction, false, "Storage must be outside SQL transactions."); puts++; if (putFails) throw Error("Injected storage outage"); const created = !objects.has(input.objectKey); objects.set(input.objectKey, Buffer.from(input.bytes)); return { storageProvider: "supabase", objectKey: input.objectKey, created }; },
    async read(key) { assert.equal(insideTransaction, false); assert.ok(objects.has(key)); return objects.get(key)!; },
    async exists(key) { return objects.has(key); },
    async remove(key) { assert.equal(insideTransaction, false); if (deleteFails) throw Error("Injected delete outage"); objects.delete(key); },
  };
  const artwork = new PostgresWorkspaceArtwork(pool, storage), uploads = new WorkspaceArtworkUploadService(artwork, storage);
  const canonical = async () => (await db.query(`SELECT
    (SELECT count(*)::int FROM v2_sales_documents) AS documents,
    (SELECT count(*)::int FROM v2_sales_document_lines) AS lines,
    (SELECT count(*)::int FROM acceptance_numbers) AS numbers,
    (SELECT count(*)::int FROM acceptance_canonical_effects) AS effects,
    (SELECT count(*)::int FROM v2_artwork_files) AS artwork`)).rows[0];
  const emptyCanonical = async () => assert.deepEqual(await canonical(), { documents: 0, lines: 0, numbers: 0, effects: 0, artwork: 0 });
  const create = () => app().create(context(), { requestId: randomUUID(), header });
  const add = (workspace: SalesWorkspace) => lines().add(context(), workspace.id, { requestId: randomUUID(), expectedRevision: workspace.revision, line: entry });
  const pdf = Buffer.from(await readFile(new URL("../fixtures/p7-qa-artwork.pdf", import.meta.url)));
  return { db, sql, client, app, store, lines, create, add, artwork, uploads, objects, pdf, canonical, emptyCanonical,
    setClock(value: Date) { clock = value; }, setPricingFailure(value: boolean) { pricingFails = value; },
    setDeleteFailure(value: boolean) { deleteFails = value; }, setPutFailure(value: boolean) { putFails = value; }, puts: () => puts,
    async close() { assert.equal(checkedOut, false); await db.close(); } };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
const cases: [string, (f: Fixture) => Promise<void>][] = [];
const acceptance = (name: string, run: (f: Fixture) => Promise<void>) => cases.push([name, run]);

// P/M identifiers are executable groups, not the campaign's numbered cases.
// Campaign cases 15-17 require the deferred existing-Order edit pipeline.
acceptance("P01 neutral creation allocates no canonical document, number, line or owner effects", async (f) => {
  const workspace = await f.app().create(context(), { requestId: "neutral" });
  assert.equal(workspace.kind, "new_sales"); assert.equal(workspace.state, "draft"); assert.equal(workspace.revision, 1);
  assert.deepEqual(workspace.header, {}); assert.deepEqual(workspace.lines, []);
  assert.match(workspace.id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  assert.equal(Date.parse(workspace.expiresAt) - Date.parse(workspace.createdAt), 30 * 86400000);
  await f.emptyCanonical();
});

acceptance("P02 Save Draft and fresh-service reload preserve relational lines and server evidence", async (f) => {
  const original = await f.add(await f.create());
  const saved = await f.app().saveDraft(context(), original.id, { requestId: "save", expectedRevision: original.revision, header: { ...header, notes: "Durable unsent notes" } });
  assert.equal(saved.revision, original.revision + 1);
  const reloaded = await f.app().get(context(), saved.id);
  assert.deepEqual(reloaded, saved);
  assert.equal(reloaded.lines[0].previews?.quote?.pricingResult.calculatedLineAmount.cents, 250);
  assert.deepEqual((await f.app().list(context())).map((item) => item.id), [saved.id]);
  assert.equal((await f.db.query<{ n: number }>("SELECT count(*)::int AS n FROM v2_sales_workspace_lines")).rows[0].n, 1);
  await f.emptyCanonical();
});

acceptance("P03 creation and Save Draft replay survive service reconstruction and reject changed input", async (f) => {
  const input = { requestId: "persistent-create", header };
  const workspace = await f.app().create(context(), input);
  assert.deepEqual(await f.app().create(context(), input), workspace);
  await assert.rejects(f.app().create(context(), { ...input, header: { ...header, jobLabel: "Changed" } }), code("CONFLICT"));
  const save = { requestId: "persistent-save", expectedRevision: 1, header: { ...header, notes: "Saved" } };
  const saved = await f.app().saveDraft(context(), workspace.id, save);
  assert.deepEqual(await f.app().saveDraft(context(), workspace.id, save), saved);
  await assert.rejects(f.app().saveDraft(context(), workspace.id, { ...save, header: {} }), code("CONFLICT"));
  assert.equal((await f.db.query<{ n: number }>("SELECT count(*)::int AS n FROM v2_sales_workspaces")).rows[0].n, 1);
  await f.emptyCanonical();
});

acceptance("P04 every header/line mutation uses stable UUIDs, durable replay and exactly one workspace CAS", async (f) => {
  let workspace = await f.create();
  const first = await f.add(workspace); const id = first.lines[0].id;
  assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i); assert.notEqual(id, workspace.id); assert.equal(first.revision, 2);
  const second = await f.add(first); const secondId = second.lines[1].id;
  const command = { requestId: "edit", expectedRevision: second.revision, lineId: id, line: { ...entry, quantity: 3 } };
  workspace = await f.lines().update(context(), second.id, command);
  assert.equal(workspace.lines[0].id, id); assert.equal(workspace.revision, second.revision + 1);
  assert.deepEqual(await f.lines().update(context(), second.id, command), wire(workspace));
  const staleRevision = second.revision;
  for (const operation of [
    () => f.app().saveDraft(context(), workspace.id, { requestId: randomUUID(), expectedRevision: staleRevision, header }),
    () => f.lines().add(context(), workspace.id, { requestId: randomUUID(), expectedRevision: staleRevision, line: entry }),
    () => f.lines().update(context(), workspace.id, { ...command, requestId: randomUUID(), expectedRevision: staleRevision }),
    () => f.lines().remove(context(), workspace.id, { requestId: randomUUID(), expectedRevision: staleRevision, lineId: id }),
    () => f.lines().reorder(context(), workspace.id, { requestId: randomUUID(), expectedRevision: staleRevision, lineIds: [secondId, id] }),
    () => f.lines().refresh(context(), workspace.id, { requestId: randomUUID(), expectedRevision: staleRevision }),
    () => f.app().discard(context(), workspace.id, { requestId: randomUUID(), expectedRevision: staleRevision }),
  ]) await assert.rejects(operation(), code("CONFLICT"));
  const reordered = await f.lines().reorder(context(), workspace.id, { requestId: "reorder", expectedRevision: workspace.revision, lineIds: [secondId, id] });
  assert.equal(reordered.revision, workspace.revision + 1); assert.deepEqual(reordered.lines.map((line) => line.id), [secondId, id]);
  assert.deepEqual((await f.app().get(context(), workspace.id)).lines, wire(reordered.lines));
  const refreshed = await f.lines().refresh(context(), workspace.id, { requestId: "refresh", expectedRevision: reordered.revision });
  assert.equal(refreshed.revision, reordered.revision + 1);
  const removed = await f.lines().remove(context(), workspace.id, { requestId: "remove", expectedRevision: refreshed.revision, lineId: secondId });
  assert.equal(removed.revision, refreshed.revision + 1); assert.equal(removed.lines[0].id, id); assert.equal(removed.lines[0].position, 0);
  const before = await f.app().get(context(), workspace.id);
  f.setPricingFailure(true);
  await assert.rejects(f.lines().update(context(), workspace.id, { ...command, requestId: "atomic-failure", expectedRevision: before.revision, header: { ...header, notes: "Must roll back" } }));
  assert.deepEqual(await f.app().get(context(), workspace.id), before);
  f.setPricingFailure(false);
  const final = await f.app().saveDraft(context(), workspace.id, { requestId: "customer-change", expectedRevision: before.revision, header: {} });
  assert.equal(final.lines[0].previews, undefined); assert.equal((await f.app().get(context(), workspace.id)).lines[0].previews, undefined);
  await f.emptyCanonical();
});

acceptance("P05 org, exact creator and Staff capability checks precede reads and mutation replays", async (f) => {
  const workspace = await f.create();
  const save = { requestId: "save", expectedRevision: workspace.revision, header: {} };
  await f.app().saveDraft(context(), workspace.id, save);
  for (const caller of [context("save", otherOrg), context("save", org, otherUser)]) {
    await assert.rejects(f.app().get(caller, workspace.id), code("NOT_FOUND"));
    await assert.rejects(f.app().saveDraft(caller, workspace.id, save), code("NOT_FOUND"));
    assert.deepEqual(await f.app().list(caller), []);
  }
  await assert.rejects(f.app().saveDraft(context("save", org, user, []), workspace.id, save), code("FORBIDDEN"));
  await assert.rejects(f.app().get({ ...context(), organizationId: otherOrg }, workspace.id), code("WRONG_TENANT"));
  await assert.rejects(f.app().get({ ...context(), principal: { kind: "portal", organizationId: org, subjectId: user, customerId: customer, capabilities } }, workspace.id), code("FORBIDDEN"));
  await f.emptyCanonical();
});

acceptance("P06 expiry is visible without read mutations, maintenance is retryable and promoting cannot commit", async (f) => {
  const now = new Date(); f.setClock(new Date(now.getTime() - 31 * 86400000));
  const expired = await f.create(); f.setClock(now);
  const start = f.sql.length;
  assert.equal((await f.app().get(context(), expired.id)).state, "expired");
  assert.deepEqual(await f.app().list(context()), []);
  assert.equal(f.sql.slice(start).some((text) => /^\s*(INSERT|UPDATE|DELETE)/i.test(text)), false);
  await assert.rejects(f.app().saveDraft(context(), expired.id, { requestId: "late", expectedRevision: 1, header }), code("CONFLICT"));
  assert.deepEqual(await f.app().expire(context()), [expired.id]); assert.deepEqual(await f.app().expire(context()), []);
  const active = await f.create();
  await assert.rejects(f.store().run(async (tx) => {
    const locked = await tx.get(org, user, active.id, true); assert.ok(locked);
    await tx.beginPromotion(org, active.id, locked.revision, "abandoned", "order", "a".repeat(64));
  }), code("VALIDATION_ERROR"));
  assert.deepEqual(await f.app().get(context(), active.id), active);
  await f.emptyCanonical();
});

acceptance("P07 discard only tombstones TEMP and preserves existing canonical documents", async (f) => {
  const id = randomUUID();
  await f.db.query("INSERT INTO v2_sales_documents(id,organization_id,document_kind) VALUES($1,$2,'order')", [id, org]);
  await f.db.query("INSERT INTO v2_sales_document_lines VALUES($1,$2,$3)", [randomUUID(), org, id]);
  const before = await f.canonical(); const workspace = await f.add(await f.create());
  const command = { requestId: "discard", expectedRevision: workspace.revision };
  const discarded = await f.app().discard(context(), workspace.id, command);
  assert.equal(discarded.state, "discarded"); assert.equal(discarded.revision, workspace.revision + 1);
  assert.deepEqual(await f.app().discard(context(), workspace.id, command), discarded);
  assert.deepEqual(await f.canonical(), before); assert.deepEqual(await f.app().list(context()), []);
  await assert.rejects(f.lines().add(context(), workspace.id, { requestId: "after-discard", expectedRevision: discarded.revision, line: entry }), code("CONFLICT"));
});

acceptance("P08 actual forward SQL enforces tenant FKs, positive revisions, scoped uniqueness and immutable identity", async (f) => {
  const workspace = await f.add(await f.create());
  await assert.rejects(f.db.query("UPDATE v2_sales_workspaces SET creator_user_id=$1,revision=revision+1 WHERE id=$2", [otherUser, workspace.id]), code("23514"));
  await assert.rejects(f.db.query("UPDATE v2_sales_workspace_lines SET revision=0 WHERE id=$1", [workspace.lines[0].id]), code("23514"));
  await assert.rejects(f.db.query("INSERT INTO v2_sales_workspace_lines(id,organization_id,workspace_id,position,input_json,revision) VALUES($1,$2,$3,1,'{}',1)", [randomUUID(), otherOrg, workspace.id]), code("23503"));
  await assert.rejects(f.db.query("INSERT INTO v2_sales_workspace_lines(id,organization_id,workspace_id,position,input_json,revision) VALUES($1,$2,$3,0,'{}',1)", [randomUUID(), org, workspace.id]), code("23505"));
  await assert.rejects(f.db.query("UPDATE v2_sales_workspace_lines SET id=$1 WHERE id=$2", [randomUUID(), workspace.lines[0].id]), code("23514"));
  assert.deepEqual(await f.app().get(context(), workspace.id), workspace);
  await f.emptyCanonical();
});

acceptance("P09 structurally validated PDF stages without OrderID; upload retry and creator denial preserve durable claims", async (f) => {
  const workspace = await f.add(await f.create());
  const input = { workspaceId: workspace.id, workspaceLineId: workspace.lines[0].id, requestId: "pdf", expectedRevision: workspace.revision, filename: "source.pdf", contentType: "application/octet-stream", bytes: f.pdf };
  f.setPutFailure(true);
  const failed = await f.uploads.upload(context("pdf"), input); assert.equal(failed.ok, false);
  if (!failed.ok) assert.equal(failed.error.code, "RETRYABLE_FAILURE", failed.error.message);
  const pending = (await f.artwork.list(context(), workspace.id))[0]; assert.ok(pending, "Upload must reserve a durable claim before calling storage."); assert.equal(pending.state, "pending");
  f.setPutFailure(false);
  const result = await f.uploads.upload(context("pdf"), input); assert.ok(result.ok);
  assert.equal(result.value.claim.id, pending.id); assert.equal(result.value.claim.state, "uploaded");
  assert.equal(result.value.claim.artworkFileId, null); assert.equal(result.value.claim.assignmentId, null);
  const puts = f.puts();
  assert.deepEqual(await f.uploads.upload(context("pdf"), input), result); assert.equal(f.puts(), puts);
  const denied = await f.uploads.upload(context("pdf", org, otherUser), input); assert.equal(denied.ok, false); assert.equal(f.puts(), puts);
  const corrupt = await f.uploads.upload(context("bad"), { ...input, requestId: "bad", bytes: Buffer.from("%PDF-1.4\nnot-a-document") }); assert.equal(corrupt.ok, false); assert.equal(f.puts(), puts);
  const stale = await f.uploads.upload(context("stale"), { ...input, requestId: "stale" }); assert.equal(stale.ok, false);
  if (!stale.ok) assert.equal(stale.error.code, "CONFLICT");
  const mutation = { workspaceId: workspace.id, claimId: pending.id, expectedRevision: workspace.revision, requestId: "stale-assignment" };
  await assert.rejects(f.artwork.assign(context(mutation.requestId), { ...mutation, workspaceLineId: workspace.lines[0].id }), code("CONFLICT"));
  await assert.rejects(f.artwork.remove(context(mutation.requestId), mutation), code("CONFLICT"));
  await assert.rejects(f.artwork.remove(context(mutation.requestId, org, otherUser), { ...mutation, expectedRevision: result.value.workspaceRevision }), code("NOT_FOUND"));
  const nonStaff = { ...context(mutation.requestId), principal: { kind: "portal" as const, organizationId: org, subjectId: user, customerId: customer, capabilities } };
  await assert.rejects(f.artwork.remove(nonStaff, { ...mutation, expectedRevision: result.value.workspaceRevision }), code("FORBIDDEN"));
  assert.equal((await f.app().get(context(), workspace.id)).revision, result.value.workspaceRevision); assert.equal(f.puts(), puts);
  assert.deepEqual(Buffer.from((await f.artwork.download(context(), workspace.id, pending.id)).bytes), f.pdf);
  assert.equal((await f.db.query<{ n: number }>("SELECT count(*)::int AS n FROM v2_artwork_storage_upload_intents")).rows[0].n, 1);
  assert.equal(Object.hasOwn(result.value.claim, "objectKey"), false);
  await f.emptyCanonical();
});

acceptance("P10 cleanup failure retains retry evidence, fences adoption, and never creates a canonical orphan", async (f) => {
  const workspace = await f.add(await f.create());
  const upload = await f.uploads.upload(context("pdf"), { workspaceId: workspace.id, workspaceLineId: workspace.lines[0].id, requestId: "pdf", expectedRevision: workspace.revision, filename: "source.pdf", contentType: "application/pdf", bytes: f.pdf });
  assert.ok(upload.ok, !upload.ok ? upload.error.message : "");
  const saved = await f.app().discard(context(), workspace.id, { requestId: "discard", expectedRevision: upload.value.workspaceRevision });
  assert.equal(saved.state, "discarded"); f.setDeleteFailure(true);
  const failed = await f.artwork.cleanup({ organizationId: org, limit: 10 }); assert.equal(failed.failed, 1); assert.equal(failed.remaining, 1);
  const row = (await f.db.query<{ state: string; cleanup_attempts: number; object_key: string; checksum_sha256: string; byte_size: number }>("SELECT * FROM v2_artwork_workspace_claims")).rows[0];
  assert.equal(row.state, "cleanup_pending"); assert.equal(row.cleanup_attempts, 1); assert.equal(f.objects.size, 1);
  await assert.rejects(f.db.query("INSERT INTO v2_artwork_files(id,organization_id,storage_provider,object_key,content_type,byte_size,checksum_algorithm,checksum_value) VALUES($1,$2,'supabase',$3,'application/pdf',$4,'sha256',$5)", [randomUUID(), org, row.object_key, row.byte_size, row.checksum_sha256]), code("23514"));
  await f.emptyCanonical(); f.setDeleteFailure(false);
  assert.equal((await f.artwork.cleanup({ organizationId: org, limit: 10 })).deleted, 1);
  assert.equal((await f.artwork.cleanup({ organizationId: org, limit: 10 })).inspected, 0); assert.equal(f.objects.size, 0);
  assert.equal((await f.artwork.list(context(), workspace.id))[0].state, "deleted");
  await assert.rejects(f.db.query("DELETE FROM v2_artwork_workspace_claims"), code("23514"));
  await f.emptyCanonical();
});

let failed = 0;
for (const [name, run] of cases) {
  const f = await fixture();
  try { await run(f); console.log(`PASS ${name}`); }
  catch (error) { failed++; console.error(`FAIL ${name}`, error); }
  finally { await f.close(); }
}
console.log(`Workspace persistence acceptance: ${cases.length - failed}/${cases.length} categories passed. Embedded PostgreSQL, not live multi-connection concurrency or provider validation.`);
console.log("Campaign cases 15-17 (existing-Order edits) are NOT IMPLEMENTED; P/M group totals are not campaign completion.");
if (failed) process.exitCode = 1;
