import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { PDFDocument } from "pdf-lib";
import type { Pool, PoolClient } from "pg";
import type { OperationContext } from "../../src/application/operation.js";
import { V2ApplicationError } from "../../src/errors/applicationError.js";
import { SalesWorkspaceApplicationService, bumpSalesWorkspaceRevision } from "../../src/modules/sales/workspaceApplication.js";
import type { SalesWorkspace, SalesWorkspacePromotionReceipt } from "../../src/modules/sales/workspaceContracts.js";
import { SalesWorkspaceMaintenanceService } from "../../src/modules/sales/workspaceMaintenance.js";
import { brandedId } from "../../src/modules/shared/commercialValues.js";
import type { ArtworkBinaryStorage } from "../../infrastructure/artwork/artworkBinaryStorage.js";
import { PostgresWorkspaceArtwork, promoteWorkspaceArtworkInTransaction, requestWorkspaceArtworkCleanupInTransaction } from "../../infrastructure/artwork/postgresWorkspaceArtwork.js";
import { WorkspaceArtworkUploadService } from "../../infrastructure/artwork/workspaceArtworkUpload.js";
import { PostgresSalesWorkspaceStore } from "../../infrastructure/sales/postgresSalesWorkspace.js";
import { PostgresWorkspaceMaintenance } from "../../infrastructure/sales/postgresWorkspaceMaintenance.js";
import { WorkspaceMaintenanceWorker } from "../../infrastructure/sales/workspaceMaintenanceWorker.js";

// Embedded PostgreSQL only. The production workspace/Artwork DDL and owner
// operations run unchanged; surrounding canonical prerequisites are fixtures.
const db = new PGlite();
const migration = (name: string) => readFileSync(new URL(`../../../server/db/migrations_v2/${name}`, import.meta.url), "utf8");
const maintenanceIndexes = migration("0298_v2_workspace_maintenance_expiry_index.sql").split("--> statement-breakpoint");
type Plan = { "Node Type": string; "Index Cond"?: string; "Actual Rows": number; "Rows Removed by Filter"?: number;
  "Shared Hit Blocks"?: number; "Shared Read Blocks"?: number; Plans?: Plan[] };
const flattenPlan = (plan: Plan): Plan[] => [plan, ...(plan.Plans ?? []).flatMap(flattenPlan)];
let inTransaction = false, connections = 0;
let failingCountOrganizationId: string | undefined;
let available = Promise.resolve();
const statements: { text: string; values?: unknown[] }[] = [];
const pool = { async connect() {
  // PGlite has one session. Serial connection leases prevent pretending that
  // two clients here establish real PostgreSQL SKIP LOCKED concurrency proof.
  const previous = available;
  let release!: () => void;
  available = new Promise<void>((resolve) => { release = resolve; });
  await previous;
  connections += 1;
  let released = false;
  return { async query(text: string, values?: unknown[]) {
    statements.push({ text, values });
    if (values?.[0] === failingCountOrganizationId && text.includes("SELECT count(*)::text AS count FROM v2_artwork_workspace_claims")) {
      throw new Error("Injected owner cleanup remaining-count failure");
    }
    if (text === "BEGIN") { assert.equal(inTransaction, false, "No nested transaction"); inTransaction = true; }
    try {
      const result = await db.query(text, values);
      const rows = result.rows.map((row) => Object.fromEntries(Object.entries(row as Record<string, unknown>).map(([key, value]) =>
        [key, value !== null && result.fields.find((field) => field.name === key)?.dataTypeID === 20 ? String(value) : value])));
      return { ...result, rows, rowCount: result.affectedRows ?? result.rows.length };
    } finally { if (text === "COMMIT" || text === "ROLLBACK") inTransaction = false; }
  }, release() { if (!released) { released = true; release(); } } } as unknown as PoolClient;
} } as unknown as Pool;

const users = [randomUUID(), randomUUID()];
const ownerStore = new PostgresSalesWorkspaceStore(pool);
const sales = new SalesWorkspaceApplicationService(ownerStore);
const maintenanceStore = new PostgresWorkspaceMaintenance(pool);
const objects = new Map<string, Uint8Array>();
const deletedKeys: string[] = [];
let failDelete = false;
let removeHook: (() => Promise<void>) | undefined;
const storage: ArtworkBinaryStorage = {
  async put(input) { assert.equal(inTransaction, false); const created = !objects.has(input.objectKey); objects.set(input.objectKey, input.bytes);
    return { objectKey: input.objectKey, storageProvider: "supabase", created }; },
  async remove(key) { assert.equal(inTransaction, false, "No provider I/O in expiry transaction"); await removeHook?.();
    if (failDelete) throw new Error("Provider removal failed"); deletedKeys.push(key); objects.delete(key); },
  async read(key) { const bytes = objects.get(key); if (!bytes) throw new Error("Missing object"); return Buffer.from(bytes); },
  async exists(key) { return objects.has(key); },
};
const artwork = new PostgresWorkspaceArtwork(pool, storage);
const uploads = new WorkspaceArtworkUploadService(artwork, storage);
const scope = (organizationId: string) => ({ kind: "service" as const, operation: "sales.workspace.maintenance" as const, organizationId });
const bounds = { expiryLimit: 100, cleanupLimit: 100 };
const service = (now?: Date) => new SalesWorkspaceMaintenanceService(maintenanceStore, artwork, () => now ?? new Date());
const actor = (organizationId: string, userId: string = users[0]!, requestId: string = randomUUID()): OperationContext => ({ organizationId, operationId: randomUUID(),
  principal: { kind: "staff", organizationId, userId, authority: { membershipId: randomUUID(),
    capabilities: ["quote.create", "quote.edit", "order.create", "artwork.view", "artwork.adopt", "artwork.assign"] } },
  businessRequest: { id: requestId, payloadFingerprint: "server-computed" } });
const count = async (sql: string, values: unknown[] = []) => Number((await db.query<{ n: string }>(sql, values)).rows[0]!.n);
const document = await PDFDocument.create(); document.addPage([72, 72]); const bytes = await document.save();
const names: string[] = [];
async function scenario(name: string, action: () => Promise<void>) { await action(); names.push(name); console.log(`PASS ${name}`); }
async function organization(id = randomUUID()): Promise<string> { await db.query("INSERT INTO organizations VALUES($1)", [id]); return id; }
async function fresh(organizationId: string, withLine = true, creatorUserId: string = users[0]!, expiresAt = new Date(Date.now() + 86_400_000)): Promise<SalesWorkspace> {
  const created = new Date(Math.min(Date.now() - 1_000, expiresAt.getTime() - 1_000));
  const workspace: SalesWorkspace = { id: randomUUID(), organizationId, creatorUserId, kind: "new_sales", state: "draft", revision: 1,
    header: {}, lines: [], createdAt: created.toISOString(), updatedAt: created.toISOString(), expiresAt: expiresAt.toISOString() };
  await ownerStore.run((tx) => tx.create(workspace, randomUUID(), "a".repeat(64)));
  if (!withLine) return workspace;
  return ownerStore.run(async (tx) => {
    const current = (await tx.get(organizationId, creatorUserId, workspace.id, true))!;
    const line = { id: randomUUID(), workspaceId: workspace.id, position: 0, revision: 1, input: { productId: brandedId<"ProductId">(randomUUID()), quantity: 2 } };
    await tx.putLine(organizationId, line);
    const next = bumpSalesWorkspaceRevision({ ...current, lines: [line] }); await tx.update(next, current.revision); return next;
  });
}
async function upload(workspace: SalesWorkspace, owner = uploads) {
  const requestId = randomUUID();
  const response = await owner.upload(actor(workspace.organizationId, workspace.creatorUserId, requestId), { requestId,
    workspaceId: workspace.id, workspaceLineId: workspace.lines[0]?.id, expectedRevision: workspace.revision,
    filename: "source.pdf", contentType: "application/pdf", bytes });
  assert.equal(response.ok, true, response.ok ? "" : `${response.error.code}: ${response.error.message}`);
  return response.value;
}
async function state(organizationId: string, workspaceId: string) {
  return (await db.query<{ state: string; revision: number; header_json: unknown; updated_at: string }>(
    "SELECT state,revision,header_json,updated_at::text FROM v2_sales_workspaces WHERE organization_id=$1 AND id=$2", [organizationId, workspaceId])).rows[0]!;
}
async function claim(organizationId: string, claimId: string) {
  return (await db.query<{ state: string; object_key: string; cleanup_attempts: number; cleanup_recheck_required: boolean }>(
    "SELECT state,object_key,cleanup_attempts,cleanup_recheck_required FROM v2_artwork_workspace_claims WHERE organization_id=$1 AND id=$2", [organizationId, claimId])).rows[0]!;
}
async function canonicalSnapshot(organizationId: string) {
  return Promise.all(["v2_sales_documents", "v2_sales_document_lines", "v2_artwork_files", "v2_artwork_assignments"].map(async (table) =>
    (await db.query(`SELECT * FROM ${table} WHERE organization_id=$1 ORDER BY id`, [organizationId])).rows));
}
async function promote(workspace: SalesWorkspace, sharedReferenceOnly = false) {
  return ownerStore.run(async (tx) => {
    const current = (await tx.get(workspace.organizationId, workspace.creatorUserId, workspace.id, true))!;
    const requestId = randomUUID(), documentId = randomUUID(), canonicalLineId = randomUUID();
    await tx.beginPromotion(workspace.organizationId, workspace.id, current.revision, requestId, "order", "b".repeat(64));
    await tx.client.query("INSERT INTO v2_sales_documents(id,organization_id,document_kind) VALUES($1,$2,'order')", [documentId, workspace.organizationId]);
    await tx.client.query("INSERT INTO v2_sales_document_lines VALUES($1,$2,$3)", [canonicalLineId, workspace.organizationId, documentId]);
    await tx.client.query("INSERT INTO v2_sales_order_details VALUES($1,$2)", [documentId, workspace.organizationId]);
    const lineMap = [{ workspaceLineId: workspace.lines[0]!.id, canonicalLineId, position: 0 }];
    await tx.recordPromotionLineMap(workspace.organizationId, workspace.id, "order", documentId, lineMap);
    if (sharedReferenceOnly) {
      // Model an existing canonical reference, as the Artwork owner's existing
      // workspaceArtwork.test.ts shared-blob scenario does. No runtime SQL copy.
      await tx.client.query(`INSERT INTO v2_artwork_files(id,organization_id,storage_provider,object_key,original_filename,display_filename,content_type,byte_size,checksum_algorithm,checksum_value,source_kind)
        SELECT $3,organization_id,storage_provider,object_key,filename,filename,content_type,byte_size,'sha256',checksum_sha256,'customer_upload'
        FROM v2_artwork_workspace_claims WHERE organization_id=$1 AND workspace_id=$2`, [workspace.organizationId, workspace.id, randomUUID()]);
    } else await promoteWorkspaceArtworkInTransaction(tx.client, { organizationId: workspace.organizationId, workspaceId: workspace.id,
      actor: actor(workspace.organizationId, workspace.creatorUserId), documentKind: "order", documentId, lineMap });
    const receipt: SalesWorkspacePromotionReceipt = { organizationId: workspace.organizationId, workspaceId: workspace.id,
      requestId, fingerprint: "b".repeat(64), inputRevision: current.revision, target: "order", documentId, documentRevision: "1",
      header: current.header, lineMap, promotedAt: new Date().toISOString() };
    await tx.recordPromotion(receipt);
    await tx.update({ ...bumpSalesWorkspaceRevision(current), state: "promoted", promotion: receipt }, current.revision);
    if (sharedReferenceOnly) await requestWorkspaceArtworkCleanupInTransaction(tx.client, { organizationId: workspace.organizationId, workspaceId: workspace.id });
    return receipt;
  });
}

try {
  await db.exec(`CREATE TABLE organizations(id varchar PRIMARY KEY); CREATE TABLE users(id varchar PRIMARY KEY);
    CREATE TABLE v2_sales_documents(id varchar PRIMARY KEY,organization_id varchar NOT NULL,document_kind text NOT NULL,revision bigint NOT NULL DEFAULT 1,updated_at timestamptz DEFAULT now(),UNIQUE(id,organization_id));
    CREATE TABLE v2_sales_document_lines(id varchar PRIMARY KEY,organization_id varchar NOT NULL,document_id varchar NOT NULL,UNIQUE(id,organization_id),UNIQUE(id,organization_id,document_id));
    CREATE TABLE v2_sales_order_details(document_id varchar,organization_id varchar,PRIMARY KEY(document_id,organization_id));
    CREATE TABLE v2_sales_quote_details(document_id varchar,organization_id varchar,delivery_state text DEFAULT 'not_sent',acceptance_state text DEFAULT 'not_accepted',lifecycle_state text DEFAULT 'open',PRIMARY KEY(document_id,organization_id));
    CREATE TABLE v2_artwork_assignment_removals(organization_id varchar,artwork_assignment_id varchar);`);
  await db.query("INSERT INTO users VALUES($1),($2)", users);
  await db.exec(migration("0180_v2_foundation_persistence.sql"));
  await db.exec(migration("0192_v2_quote_operation_audit_and_override_capability.sql").split("-- Selling-price authority")[0]!);
  await db.exec(migration("0197_v2_artwork_domain_foundation.sql").split("-- Only future template-derived")[0]!);
  await db.exec("ALTER TABLE v2_artwork_assignments ADD COLUMN supersedes_artwork_assignment_id varchar");
  await db.exec(migration("0242_v2_quote_artwork_lineage.sql").split("CREATE TABLE v2_quote_accepted_artwork_snapshots")[0]!);
  await db.exec(migration("0246_v2_artwork_storage_reconciliation.sql"));
  await db.exec(migration("0294_v2_sales_workspace_foundation.sql"));
  await db.exec(migration("0295_v2_sales_workspace_artwork.sql"));

  await scenario("0298 bounds the actual creator quota query by tenant and expiry, preserving all 10000 fixture rows", async () => {
    const org = await organization("10000000-0000-4000-8000-000000000001"), foreign = await organization("20000000-0000-4000-8000-000000000002");
    const now = "2026-09-30T00:00:00.000Z";
    for (const [organizationId, prefix, expiry] of [[org, "10000000", "2026-10-01T00:00:00.000Z"],
      [foreign, "20000000", "2026-09-29T00:00:00.000Z"]] as const) {
      const inserted = await db.query(`INSERT INTO v2_sales_workspaces
        (id,organization_id,creator_user_id,kind,state,revision,header_json,creation_request_id,creation_fingerprint,created_at,updated_at,expires_at)
        SELECT $3||'-0000-4000-8000-'||lpad(n::text,12,'0'),$1,$2,'new_sales','draft',1,'{}'::jsonb,
          'expiry-plan:'||n::text,repeat('a',64),'2026-09-28T00:00:00Z','2026-09-28T00:00:00Z',$4::timestamptz
        FROM generate_series(1,5000) AS n`, [organizationId, users[0], prefix, expiry]);
      assert.equal(inserted.affectedRows, 5000);
    }
    await db.exec("ANALYZE v2_sales_workspaces");
    const start = statements.length;
    assert.deepEqual(await maintenanceStore.expireDrafts({ organizationId: org, now, limit: 1 }), []);
    const selection = statements.slice(start).find((query) => query.text.includes("SELECT creator_user_id FROM v2_sales_workspaces"))!;
    assert.ok(selection, "Explain the adapter's actual quota prequery, not a test copy");
    const explain = async () => (await db.query<{ "QUERY PLAN": { Plan: Plan }[] }>(
      `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${selection.text}`, selection.values)).rows[0]!["QUERY PLAN"][0]!.Plan;
    const before = flattenPlan(await explain());
    assert.equal(before[0]!["Actual Rows"], 0);
    const filteredBefore = Math.max(...before.map((node) => node["Rows Removed by Filter"] ?? 0));
    assert.ok(filteredBefore >= 5000, "Without a tenant-expiry index, LIMIT 1 still scans and filters unrelated/future rows");
    const rowsBefore = await db.query(`SELECT organization_id,count(*)::text AS n,sum(revision)::text AS revisions,
      min(state) AS state,min(expires_at)::text AS expiry FROM v2_sales_workspaces
      WHERE organization_id=ANY($1::varchar[]) GROUP BY organization_id ORDER BY organization_id`, [[org, foreign]]);
    const globalIndex = (await db.query("SELECT indexdef FROM pg_indexes WHERE indexname='v2_sales_workspaces_expiry_idx'")).rows;
    assert.equal(globalIndex.length, 1, "The original global expiry index must remain present");
    // Load the actual migration in phases so the next case can reproduce the
    // owner UPDATE with only the tenant index before adding its creator index.
    await db.exec(maintenanceIndexes[0]!);
    await db.exec("ANALYZE v2_sales_workspaces");
    assert.deepEqual((await db.query(`SELECT organization_id,count(*)::text AS n,sum(revision)::text AS revisions,
      min(state) AS state,min(expires_at)::text AS expiry FROM v2_sales_workspaces
      WHERE organization_id=ANY($1::varchar[]) GROUP BY organization_id ORDER BY organization_id`, [[org, foreign]])).rows, rowsBefore.rows);
    assert.deepEqual((await db.query("SELECT indexdef FROM pg_indexes WHERE indexname='v2_sales_workspaces_expiry_idx'")).rows, globalIndex);
    const assertBoundedPlan = async (expectedRows: number) => {
      const plan = flattenPlan(await explain());
      assert.ok(plan.some((node) => /organization_id/.test(node["Index Cond"] ?? "") && /expires_at/.test(node["Index Cond"] ?? "")),
        `Quota selection must have indexed tenant and expiry conditions: ${JSON.stringify(plan)}`);
      assert.equal(plan[0]!["Actual Rows"], expectedRows);
      assert.ok(plan.every((node) => (node["Rows Removed by Filter"] ?? 0) === 0));
      assert.ok(plan.every((node) => node["Actual Rows"] <= 1));
      return plan;
    };
    await assertBoundedPlan(0);
    const due = await fresh(org, false, users[0]!, new Date("2026-09-29T23:00:00.000Z"));
    await assertBoundedPlan(1);
    assert.deepEqual(await maintenanceStore.expireDrafts({ organizationId: org, now, limit: 1 }), [due.id]);
    assert.equal((await state(org, due.id)).revision, 2);
    assert.equal(await count("SELECT count(*)::text n FROM v2_sales_workspaces WHERE organization_id=$1 AND state='draft'", [org]), 5000);
    assert.equal(await count("SELECT count(*)::text n FROM v2_sales_workspaces WHERE organization_id=$1 AND state='draft'", [foreign]), 5000);
    console.log(`Expiry quota EXPLAIN: before filtered ${filteredBefore}; after tenant+expiry Index Cond, filtered 0, actual rows 0/1`);
  });

  await scenario("0298 also bounds the real creator expiry UPDATE and the adapter expires exactly 25 without losing future rows", async () => {
    const org = await organization("30000000-9999-4999-8999-000000000003");
    const creatorA = "10000000-1111-4111-8111-000000000001", creatorB = "20000000-1111-4111-8111-000000000002";
    await db.query("INSERT INTO users VALUES($1),($2)", [creatorA, creatorB]);
    const now = "2026-09-30T00:00:00.000Z", limit = 25;
    for (const [creator, prefix, expiry] of [[creatorA, "30000000", "2026-10-01T00:00:00.000Z"],
      [creatorB, "40000000", "2026-09-29T00:00:00.000Z"]] as const) {
      const inserted = await db.query(`INSERT INTO v2_sales_workspaces
        (id,organization_id,creator_user_id,kind,state,revision,header_json,creation_request_id,creation_fingerprint,created_at,updated_at,expires_at)
        SELECT $3||'-0000-4000-8000-'||lpad(n::text,12,'0'),$1,$2,'new_sales','draft',1,'{}'::jsonb,
          'creator-expiry-plan:'||$3||':'||n::text,repeat('a',64),'2026-09-28T00:00:00Z','2026-09-28T00:00:00Z',$4::timestamptz
        FROM generate_series(1,5000) AS n`, [org, creator, prefix, expiry]);
      assert.equal(inserted.affectedRows, 5000);
    }
    const early = await fresh(org, false, creatorA, new Date("2026-09-28T23:00:00.000Z"));
    const earlyBefore = await state(org, early.id);
    const snapshot = async () => (await db.query(`SELECT creator_user_id,count(*)::text AS n,sum(revision)::text AS revisions,
      min(state) AS state,min(expires_at)::text AS expiry FROM v2_sales_workspaces WHERE organization_id=$1
      GROUP BY creator_user_id ORDER BY creator_user_id`, [org])).rows;
    const rowsBefore = await snapshot();
    const tenantIndexBefore = (await db.query("SELECT indexdef FROM pg_indexes WHERE indexname='v2_sales_workspaces_tenant_expiry_idx'")).rows;
    assert.equal(tenantIndexBefore.length, 1);
    await db.exec("ANALYZE v2_sales_workspaces");
    const probeOwnerUpdate = () => ownerStore.run(async (tx) => {
      await tx.client.query("SAVEPOINT owner_expiry_probe");
      try {
        const start = statements.length;
        assert.deepEqual(await tx.expireDrafts(org, creatorA, now, limit), [early.id]);
        const update = statements.slice(start).find((query) => query.text.includes("WITH candidates AS") && query.text.includes("UPDATE v2_sales_workspaces"));
        assert.ok(update, "Use SQL and parameters captured from the actual owner method");
        assert.deepEqual(update.values, [org, creatorA, now, limit, ["new_sales", "order_edit"]]);
        await tx.client.query("ROLLBACK TO SAVEPOINT owner_expiry_probe");
        return (await tx.client.query<{ "QUERY PLAN": { Plan: Plan }[] }>(
          `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${update.text}`, update.values)).rows[0]!["QUERY PLAN"][0]!.Plan;
      } finally {
        // EXPLAIN ANALYZE executes this UPDATE. Roll back both probe writes and
        // their deferred trigger events before the enclosing owner tx commits.
        await tx.client.query("ROLLBACK TO SAVEPOINT owner_expiry_probe");
        await tx.client.query("RELEASE SAVEPOINT owner_expiry_probe");
      }
    });
    const before = flattenPlan(await probeOwnerUpdate());
    const filteredBefore = Math.max(...before.map((node) => node["Rows Removed by Filter"] ?? 0));
    assert.ok(filteredBefore >= 5000, "Tenant-only expiry access still scans another creator or future drafts");
    assert.deepEqual(await snapshot(), rowsBefore);
    assert.deepEqual(await state(org, early.id), earlyBefore);
    console.log(`Owner expiry UPDATE before creator index: filtered ${filteredBefore} with LIMIT ${limit}`);
    assert.ok(maintenanceIndexes[1], "0298 must also contain the creator-scoped expiry index");
    await db.exec(maintenanceIndexes[1]);
    await db.exec("ANALYZE v2_sales_workspaces");
    assert.equal((await db.query("SELECT indexdef FROM pg_indexes WHERE indexname='v2_sales_workspaces_creator_expiry_idx'")).rows.length, 1);
    assert.deepEqual((await db.query("SELECT indexdef FROM pg_indexes WHERE indexname='v2_sales_workspaces_tenant_expiry_idx'")).rows, tenantIndexBefore);
    const afterRoot = await probeOwnerUpdate(), after = flattenPlan(afterRoot);
    assert.ok(after.some((node) => ["organization_id", "creator_user_id", "expires_at"].every((field) =>
      (node["Index Cond"] ?? "").includes(field))), `Owner expiry must index all three scope conditions: ${JSON.stringify(after)}`);
    assert.ok(after.every((node) => (node["Rows Removed by Filter"] ?? 0) === 0));
    assert.ok(after.every((node) => node["Actual Rows"] <= limit));
    assert.ok(Number.isInteger(afterRoot["Shared Hit Blocks"]) && Number.isInteger(afterRoot["Shared Read Blocks"]));
    const buffers = afterRoot["Shared Hit Blocks"]! + afterRoot["Shared Read Blocks"]!;
    // Budget owner row/index work per bounded candidate, not wall time or an RPC timeout.
    assert.ok(buffers <= limit * 64, `Owner expiry touched ${buffers} shared buffers for a ${limit}-row batch`);
    assert.deepEqual(await snapshot(), rowsBefore);
    assert.deepEqual(await state(org, early.id), earlyBefore);
    const start = statements.length;
    const expired = await maintenanceStore.expireDrafts({ organizationId: org, now, limit });
    assert.equal(expired.length, limit); assert.equal(new Set(expired).size, limit); assert.ok(expired.includes(early.id));
    assert.equal(await count("SELECT count(*)::text n FROM v2_sales_workspaces WHERE organization_id=$1", [org]), 10001);
    assert.equal(await count("SELECT count(*)::text n FROM v2_sales_workspaces WHERE organization_id=$1 AND creator_user_id=$2 AND expires_at>$3 AND state='draft' AND revision=1", [org, creatorA, now]), 5000);
    assert.equal(await count("SELECT count(*)::text n FROM v2_sales_workspaces WHERE organization_id=$1 AND creator_user_id=$2 AND state='expired' AND revision=2", [org, creatorA]), 1);
    assert.equal(await count("SELECT count(*)::text n FROM v2_sales_workspaces WHERE organization_id=$1 AND creator_user_id=$2 AND state='expired' AND revision=2", [org, creatorB]), 24);
    const selection = statements.slice(start).find((query) => query.text.includes("SELECT creator_user_id FROM v2_sales_workspaces"))!;
    const quota = flattenPlan((await db.query<{ "QUERY PLAN": { Plan: Plan }[] }>(
      `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${selection.text}`, selection.values)).rows[0]!["QUERY PLAN"][0]!.Plan);
    assert.ok(quota.some((node) => ["organization_id", "expires_at"].every((field) => (node["Index Cond"] ?? "").includes(field))));
    assert.ok(quota.every((node) => (node["Rows Removed by Filter"] ?? 0) === 0 && node["Actual Rows"] <= limit));
    assert.deepEqual(await canonicalSnapshot(org), [[], [], [], []]);
    console.log(`Owner expiry UPDATE after creator index: org+creator+expiry Index Cond, filtered 0, buffers ${buffers}; adapter expired ${expired.length}, future drafts preserved 5000`);
  });

  await scenario("invalid adapter limits, tenant IDs, cursor and clock reject before connection acquisition", async () => {
    const before = connections;
    for (const limit of [NaN, Infinity, 0, 101, -1, 1.5]) {
      await assert.rejects(maintenanceStore.expireDrafts({ organizationId: users[0]!, now: new Date().toISOString(), limit }), V2ApplicationError);
    }
    for (const limit of [NaN, 0, 26]) await assert.rejects(maintenanceStore.listOrganizationIds({ afterOrganizationId: null, limit }), V2ApplicationError);
    await assert.rejects(maintenanceStore.listOrganizationIds({ afterOrganizationId: "invalid", limit: 1 }), V2ApplicationError);
    await assert.rejects(maintenanceStore.expireDrafts({ organizationId: "invalid", now: new Date().toISOString(), limit: 1 }), V2ApplicationError);
    await assert.rejects(maintenanceStore.expireDrafts({ organizationId: users[0]!, now: "invalid", limit: 1 }), V2ApplicationError);
    assert.equal(connections, before);
  });

  await scenario("browser crash resumes only the last durable save, stable TEMP lines and receipt without canonical allocation", async () => {
    const org = await organization();
    const workspace = await fresh(org);
    const saved = await sales.saveDraft(actor(org), workspace.id, { requestId: randomUUID(), expectedRevision: workspace.revision,
      header: { jobLabel: "Last saved", notes: "Durable draft" } });
    const unsaved = { ...saved, header: { jobLabel: "Unsaved browser memory" } };
    assert.notDeepEqual(unsaved.header, saved.header);
    const reopened = await new SalesWorkspaceApplicationService(new PostgresSalesWorkspaceStore(pool)).get(actor(org), saved.id);
    assert.deepEqual(reopened, saved);
    assert.deepEqual((await sales.list(actor(org))).map((row) => row.id), [saved.id]);
    const receipt = (await db.query("SELECT result_json FROM v2_sales_workspace_requests WHERE organization_id=$1 AND workspace_id=$2", [org, saved.id])).rows;
    assert.equal((await service().run(scope(org), bounds)).expiredWorkspaceIds.length, 0);
    assert.deepEqual(await sales.get(actor(org), saved.id), saved);
    assert.deepEqual((await db.query("SELECT result_json FROM v2_sales_workspace_requests WHERE organization_id=$1 AND workspace_id=$2", [org, saved.id])).rows, receipt);
    assert.deepEqual(await canonicalSnapshot(org), [[], [], [], []]);
  });

  await scenario("bounded expiry uses real stored creators, one revision per draft and no cross-tenant or terminal mutation", async () => {
    const org = await organization(), other = await organization();
    const expired = new Date(Date.now() - 10_000);
    const first = await fresh(org, false, users[0]!, expired), second = await fresh(org, false, users[1]!, expired), third = await fresh(org, false, users[1]!, expired);
    const foreign = await fresh(other, false, users[0]!, expired);
    const foreignBefore = await state(other, foreign.id);
    const batch = await maintenanceStore.expireDrafts({ organizationId: org, now: new Date().toISOString(), limit: 2 });
    assert.equal(batch.length, 2);
    assert.equal(new Set(batch).size, 2);
    for (const id of batch) { const row = await state(org, id); assert.equal(row.state, "expired"); assert.equal(row.revision, 2); }
    const rest = await maintenanceStore.expireDrafts({ organizationId: org, now: new Date().toISOString(), limit: 2 });
    assert.equal(rest.length, 1);
    assert.deepEqual(new Set([...batch, ...rest]), new Set([first.id, second.id, third.id]));
    const terminal = await Promise.all([first, second, third].map((row) => state(org, row.id)));
    assert.deepEqual(await maintenanceStore.expireDrafts({ organizationId: org, now: new Date().toISOString(), limit: 2 }), []);
    assert.deepEqual(await Promise.all([first, second, third].map((row) => state(org, row.id))), terminal);
    assert.deepEqual(await state(other, foreign.id), foreignBefore);
  });

  await scenario("expiry commits before failed provider cleanup, preserving claims, input and revision for a later safe retry", async () => {
    const org = await organization(), workspace = await fresh(org), staged = await upload(workspace);
    const lastSaved = await sales.get(actor(org), workspace.id);
    const now = new Date(Date.parse(workspace.expiresAt) + 1_000);
    removeHook = async () => { assert.equal((await state(org, workspace.id)).state, "expired"); };
    failDelete = true;
    const failed = await service(now).run(scope(org), bounds);
    failDelete = false; removeHook = undefined;
    assert.deepEqual(failed.expiredWorkspaceIds, [workspace.id]);
    assert.equal(failed.reason, "cleanup_failed");
    assert.equal(failed.cleanup!.failed, 1); assert.equal(failed.cleanup!.remaining, 1);
    const pending = await claim(org, staged.claim.id);
    assert.equal(pending.state, "cleanup_pending"); assert.equal(pending.cleanup_attempts, 1); assert.equal(objects.has(pending.object_key), true);
    const terminal = await state(org, workspace.id);
    assert.equal(terminal.revision, lastSaved.revision + 1);
    const reread = await sales.get(actor(org), workspace.id);
    assert.deepEqual(reread.header, lastSaved.header); assert.deepEqual(reread.lines, lastSaved.lines);
    const done = await service(now).run(scope(org), bounds);
    assert.deepEqual(done.expiredWorkspaceIds, []); assert.equal(done.cleanup!.deleted, 1); assert.equal(done.cleanup!.remaining, 0);
    assert.equal((await claim(org, staged.claim.id)).state, "deleted"); assert.equal(objects.has(pending.object_key), false);
    assert.deepEqual(await state(org, workspace.id), terminal);
    assert.deepEqual(await canonicalSnapshot(org), [[], [], [], []]);
  });

  await scenario("restart after expiry commit discovers a tenant with only terminal workspaces and finishes owner cleanup", async () => {
    const org = await organization("ffffffff-ffff-4fff-8fff-ffffffffffff"), workspace = await fresh(org), staged = await upload(workspace);
    const now = new Date(Date.parse(workspace.expiresAt) + 1_000);
    assert.deepEqual(await maintenanceStore.expireDrafts({ organizationId: org, now: now.toISOString(), limit: 1 }), [workspace.id]);
    assert.equal((await claim(org, staged.claim.id)).state, "uploaded", "Crash before cleanup leaves the owner claim durable");
    const worker = new WorkspaceMaintenanceWorker({ store: new PostgresWorkspaceMaintenance(pool), maintenance: service(now), tenantLimit: 1,
      afterOrganizationId: "ffffffff-ffff-4fff-8fff-fffffffffffe",
      environment: { V2_MUTATION_WORKERS_ENABLED: "true", V2_WORKSPACE_MAINTENANCE_ENABLED: "true" } });
    const tick = await worker.tick(); await worker.stop();
    assert.equal(tick.organizationsProcessed, 1); assert.equal(tick.organizations[0]!.organizationId, org);
    assert.equal(tick.expired, 0); assert.equal(tick.deleted, 1); assert.equal(tick.remaining, 0);
    assert.equal((await claim(org, staged.claim.id)).state, "deleted");
  });

  await scenario("actual owner remaining-count failure yields unknown worker backlog without undoing committed expiry or cleanup", async () => {
    const org = "ffffffff-ffff-4fff-8fff-ffffffffffff", workspace = await fresh(org), staged = await upload(workspace);
    const now = new Date(Date.parse(workspace.expiresAt) + 1_000), deletedBefore = deletedKeys.length;
    const worker = new WorkspaceMaintenanceWorker({ store: maintenanceStore, maintenance: service(now), tenantLimit: 1,
      afterOrganizationId: "ffffffff-ffff-4fff-8fff-fffffffffffe", environment: {
        V2_MUTATION_WORKERS_ENABLED: "true", V2_WORKSPACE_MAINTENANCE_ENABLED: "true" } });
    failingCountOrganizationId = org;
    let tick;
    try { tick = await worker.tick(); } finally { failingCountOrganizationId = undefined; await worker.stop(); }
    assert.equal(tick.reason, "partial"); assert.equal(tick.remaining, null); assert.equal(tick.knownRemaining, 0);
    assert.equal(tick.errorCode, "CLEANUP_COUNT_UNAVAILABLE"); assert.equal(tick.failedOrganizations, 1);
    assert.equal(tick.afterOrganizationId, org); assert.equal(tick.expired, 1);
    assert.equal(tick.organizations[0]!.reason, "cleanup_failed"); assert.equal(tick.organizations[0]!.cleanup, null);
    assert.equal(tick.organizations[0]!.errorCode, "INTERNAL_ERROR");
    assert.equal((await state(org, workspace.id)).state, "expired");
    assert.equal((await state(org, workspace.id)).revision, staged.workspaceRevision + 1);
    assert.equal((await claim(org, staged.claim.id)).state, "deleted");
    assert.equal(deletedKeys.length, deletedBefore + 1, "Actual owner removal finished before the count failed");
    const retried = await service(now).run(scope(org), bounds);
    assert.equal(retried.reason, "completed"); assert.deepEqual(retried.expiredWorkspaceIds, []);
    assert.equal(retried.cleanup!.remaining, 0);
  });

  await scenario("ambiguous upload settlement stays cleanup-pending after ACK and is rechecked for a late write", async () => {
    const org = await organization(), workspace = await fresh(org); let key = "";
    const uncertainStorage: ArtworkBinaryStorage = { ...storage, async put(input) { key = input.objectKey; throw new Error("Remote outcome unknown"); } };
    const uncertain = new WorkspaceArtworkUploadService(new PostgresWorkspaceArtwork(pool, uncertainStorage), uncertainStorage);
    const requestId = randomUUID();
    const failed = await uncertain.upload(actor(org, users[0]!, requestId), { requestId, workspaceId: workspace.id, workspaceLineId: workspace.lines[0]!.id,
      expectedRevision: workspace.revision, filename: "unknown.pdf", contentType: "application/pdf", bytes });
    assert.equal(failed.ok, false);
    const staged = (await artwork.list(actor(org), workspace.id))[0]!;
    await sales.discard(actor(org), workspace.id, { requestId: randomUUID(), expectedRevision: workspace.revision + 1 });
    const terminal = await state(org, workspace.id);
    const first = await service().run(scope(org), bounds);
    assert.equal(first.reason, "cleanup_pending"); assert.equal(first.cleanup!.deleted, 1); assert.equal(first.cleanup!.remaining, 1);
    assert.equal((await claim(org, staged.id)).cleanup_recheck_required, true);
    objects.set(key, bytes);
    const next = await service().run(scope(org), bounds);
    assert.equal(next.cleanup!.deleted, 1); assert.equal(next.cleanup!.remaining, 1); assert.equal(objects.has(key), false);
    assert.equal((await claim(org, staged.id)).state, "cleanup_pending");
    await assert.rejects(db.query("UPDATE v2_artwork_workspace_claims SET state='deleted' WHERE organization_id=$1 AND id=$2", [org, staged.id]), /deleted_check/);
    assert.deepEqual(await state(org, workspace.id), terminal);
  });

  await scenario("Sales organization cursor includes discarded/error and active removed-file tenants with bounded indexed seeks", async () => {
    const org = await organization(), workspace = await fresh(org), staged = await upload(workspace);
    const requestId = randomUUID();
    const removed = await artwork.remove(actor(org, users[0]!, requestId), { requestId, workspaceId: workspace.id,
      claimId: staged.claim.id, expectedRevision: staged.workspaceRevision });
    const before = await state(org, workspace.id), start = statements.length;
    const ids = await maintenanceStore.listOrganizationIds({ afterOrganizationId: null, limit: 2 });
    assert.equal(ids.length, 2); assert.deepEqual(ids, [...new Set(ids)].sort());
    const queries = statements.slice(start);
    assert.equal(queries.length, 2);
    assert.ok(queries.every((query) => /WHERE organization_id>\$1 ORDER BY organization_id,creation_request_id LIMIT 1/.test(query.text)));
    assert.equal(queries[1]!.values![0], ids[0]);
    assert.equal(queries.some((query) => /artwork|DISTINCT|GROUP BY/.test(query.text)), false);
    const done = await service().run(scope(org), bounds);
    assert.equal(done.expiredWorkspaceIds.length, 0); assert.equal(done.cleanup!.deleted, 1);
    assert.equal((await state(org, workspace.id)).state, "draft"); assert.equal(before.revision, removed.workspaceRevision);
    assert.deepEqual(await state(org, workspace.id), before);
  });

  await scenario("promoted claim, shared canonical file, source document and durable promotion receipts are never deleted or rewritten", async () => {
    // Complements the actual owner shared/promoted scenarios in workspaceArtwork.test.ts.
    for (const shared of [false, true]) {
      const org = await organization(), workspace = await fresh(org), staged = await upload(workspace);
      const receipt = await promote(workspace, shared);
      const before = await canonicalSnapshot(org), terminal = await state(org, workspace.id);
      const receipts = (await db.query("SELECT * FROM v2_sales_workspace_promotions WHERE organization_id=$1 AND workspace_id=$2", [org, workspace.id])).rows;
      const deletedBefore = deletedKeys.length;
      const maintenance = await service(new Date(Date.parse(workspace.expiresAt) + 1_000)).run(scope(org), bounds);
      assert.deepEqual(maintenance.expiredWorkspaceIds, []);
      assert.equal(maintenance.cleanup!.deleted, 0); assert.equal(deletedKeys.length, deletedBefore);
      assert.equal(maintenance.cleanup!.retained, shared ? 1 : 0);
      assert.equal((await claim(org, staged.claim.id)).state, shared ? "retained" : "promoted");
      assert.equal(objects.has((await claim(org, staged.claim.id)).object_key), true);
      assert.deepEqual(await canonicalSnapshot(org), before); assert.deepEqual(await state(org, workspace.id), terminal);
      assert.deepEqual((await db.query("SELECT * FROM v2_sales_workspace_promotions WHERE organization_id=$1 AND workspace_id=$2", [org, workspace.id])).rows, receipts);
      assert.deepEqual((await sales.get(actor(org), workspace.id)).promotion, receipt);
    }
  });

  await scenario("interrupted promotion cannot commit promoting and maintenance invents no unstuck repair", async () => {
    const org = await organization(), workspace = await fresh(org), before = await state(org, workspace.id);
    await assert.rejects(ownerStore.run(async (tx) => {
      await tx.get(org, workspace.creatorUserId, workspace.id, true);
      await tx.beginPromotion(org, workspace.id, workspace.revision, randomUUID(), "order", "a".repeat(64));
    }), /persistence constraints/);
    assert.deepEqual(await state(org, workspace.id), before);
    assert.equal((await service().run(scope(org), bounds)).expiredWorkspaceIds.length, 0);
    assert.deepEqual(await state(org, workspace.id), before);
    assert.equal(await count("SELECT count(*)::text n FROM v2_sales_workspace_promotions WHERE organization_id=$1", [org]), 0);
    assert.deepEqual(await canonicalSnapshot(org), [[], [], [], []]);
  });

  await scenario("two callers expire each persisted draft at most once using the existing SQL, without lease DDL", async () => {
    const org = await organization(), workspace = await fresh(org, false, users[0]!, new Date(Date.now() - 1_000));
    const start = statements.length, input = { organizationId: org, now: new Date().toISOString(), limit: 1 };
    const results = await Promise.all([maintenanceStore.expireDrafts(input), new PostgresWorkspaceMaintenance(pool).expireDrafts(input)]);
    assert.deepEqual(results.flat(), [workspace.id]);
    assert.equal((await state(org, workspace.id)).revision, 2);
    assert.ok(statements.slice(start).some((query) => /FOR UPDATE SKIP LOCKED/.test(query.text)));
    assert.equal(statements.slice(start).some((query) => /CREATE|DELETE|v2_artwork/.test(query.text)), false);
    assert.ok(statements.slice(start).filter((query) => /UPDATE v2_sales_workspaces/.test(query.text)).every((query) =>
      query.values![0] === org && query.values![1] === workspace.creatorUserId));
  });
  console.log(`workspaceMaintenance.test: ${names.length} actual PGlite scenarios PASS; no external database or provider used`);
} finally { await db.close(); }
