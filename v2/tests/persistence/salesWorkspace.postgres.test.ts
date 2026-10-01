import { afterAll, beforeAll, beforeEach, describe, expect, it } from "@jest/globals";
import { PGlite } from "@electric-sql/pglite";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Pool } from "pg";
import type { OperationContext } from "../../src/application/operation.js";
import { PostgresSalesWorkspaceStore } from "../../infrastructure/sales/postgresSalesWorkspace.js";
import { SalesWorkspaceApplicationService, bumpSalesWorkspaceRevision } from "../../src/modules/sales/workspaceApplication.js";
import type { SalesWorkspace, SalesWorkspacePromotionReceipt, WorkspaceLine } from "../../src/modules/sales/workspaceContracts.js";
import { V2PricingParityAdapter } from "../../src/modules/pricing/v2PricingAdapter.js";
import { calculatedDecision } from "../../src/modules/sales/quoteApplication.js";
import { workspaceLinePreviewFingerprint } from "../../src/modules/sales/workspaceLines.js";
import { brandedId, currencyCode } from "../../src/modules/shared/commercialValues.js";

const org = "20000000-0000-4000-8000-000000000001";
const user = "20000000-0000-4000-8000-000000000002";
const otherOrg = "20000000-0000-4000-8000-000000000003";
const otherUser = "20000000-0000-4000-8000-000000000004";
const context: OperationContext = { organizationId: org, operationId: "foundation-sql", principal: {
  kind: "staff", organizationId: org, userId: user, authority: { membershipId: "verified", capabilities: ["order.create"] },
} };
const scoped = (organizationId = org, userId = user): OperationContext => ({ ...context, organizationId,
  principal: { kind: "staff", organizationId, userId, authority: { membershipId: "verified", capabilities: ["order.create"] } } });

describe("Sales workspace PostgreSQL foundation (embedded, no ambient database)", () => {
  let database: PGlite;
  let store: PostgresSalesWorkspaceStore;
  let service: SalesWorkspaceApplicationService;
  let clock: Date;
  const statements: string[] = [];
  let releases = 0;
  beforeAll(async () => {
    database = new PGlite();
    // Only existing FK targets are stubbed; all workspace DDL is the actual new migration.
    await database.exec(`CREATE TABLE organizations(id varchar PRIMARY KEY);
      CREATE TABLE users(id varchar PRIMARY KEY);
      CREATE TABLE v2_sales_document_lines(id varchar PRIMARY KEY,organization_id varchar NOT NULL,document_id varchar NOT NULL,
        UNIQUE(id,organization_id),UNIQUE(id,organization_id,document_id));`);
    await database.query("INSERT INTO organizations(id) VALUES($1),($2)", [org, otherOrg]);
    await database.query("INSERT INTO users(id) VALUES($1),($2)", [user, otherUser]);
    await database.exec(readFileSync(resolve(process.cwd(), "server/db/migrations_v2/0294_v2_sales_workspace_foundation.sql"), "utf8"));
    // One embedded PostgreSQL connection. The adapter serializes checkout, not SQL semantics.
    let available = Promise.resolve();
    const pool = { async connect() {
      const prior = available;
      let unlock!: () => void;
      available = new Promise<void>((done) => { unlock = done; });
      await prior;
      return { async query(sql: string, params?: unknown[]) {
        statements.push(sql);
        const result = await database.query(sql, params);
        return { rows: result.rows, rowCount: result.affectedRows ?? result.rows.length };
      }, release() { releases++; unlock(); } };
    } } as unknown as Pool;
    store = new PostgresSalesWorkspaceStore(pool);
    service = new SalesWorkspaceApplicationService(store, { now: () => clock });
  }, 60000);
  beforeEach(() => { clock = new Date(); statements.length = 0; });
  afterAll(async () => { await database?.close(); });

  const create = (header: SalesWorkspace["header"] = {}) => service.create(context, { requestId: randomUUID(), header });
  const line = (workspaceId: string, position = 0): WorkspaceLine => ({ id: randomUUID(), workspaceId, position, revision: 1,
    input: { productId: randomUUID(), quantity: 2, selling: { kind: "calculated" } } });
  async function addLine(workspace: SalesWorkspace): Promise<SalesWorkspace> {
    return store.run(async (tx) => {
      const current = (await tx.get(org, user, workspace.id, true))!;
      const added = line(workspace.id, current.lines.length);
      await tx.putLine(org, added);
      const next = { ...bumpSalesWorkspaceRevision(current, clock), lines: [...current.lines, added] };
      await tx.update(next, current.revision);
      return next;
    });
  }

  it("persists/reloads incomplete TEMP drafts and writes zero canonical business tables", async () => {
    const initial = await create({ jobLabel: "Unassigned signage", terms: {} });
    expect(initial).toMatchObject({ revision: 1, header: { jobLabel: "Unassigned signage" }, lines: [], state: "draft" });
    expect(initial.expiresAt).toBe(new Date(clock.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString());
    const reloaded = await new SalesWorkspaceApplicationService(store, { now: () => clock }).get(context, initial.id);
    expect(reloaded).toEqual(initial);
    const saved = await service.saveDraft(context, initial.id, { requestId: randomUUID(), expectedRevision: 1, header: { notes: "Customer TBD" } });
    expect(saved.revision).toBe(2);
    expect((await service.list(context)).some((workspace) => workspace.id === initial.id)).toBe(true);
    const writes = statements.filter((sql) => /^\s*(?:INSERT INTO|UPDATE|DELETE FROM)\b/.test(sql));
    expect(writes.length).toBe(3);
    expect(writes.every((sql) => /(?:INSERT INTO|UPDATE) v2_sales_workspace(?:s|_requests)\b/.test(sql))).toBe(true);
    expect(await database.query("SELECT count(*)::integer AS count FROM v2_sales_document_lines")).toMatchObject({ rows: [{ count: 0 }] });
    expect(statements.some((sql) => /invoice|number_counter|audit_events|production|legacy/i.test(sql))).toBe(false);
  });
  it("scopes reads/list/replay to exact tenant and creator, and rechecks current authority", async () => {
    const requestId = randomUUID();
    const draft = await service.create(context, { requestId });
    await expect(service.get(scoped(org, otherUser), draft.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(service.get(scoped(otherOrg), draft.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await service.list(scoped(org, otherUser))).toEqual([]);
    await expect(service.create(scoped(org, otherUser), { requestId })).rejects.toMatchObject({ code: "CONFLICT" });
    const revoked: OperationContext = { ...context, principal: { kind: "staff", organizationId: org, userId: user, authority: { membershipId: "verified", capabilities: [] } } };
    await expect(service.create(revoked, { requestId })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await service.create(context, { requestId })).toEqual(draft);
    await expect(service.create(context, { requestId, header: { jobLabel: "different" } })).rejects.toMatchObject({ code: "CONFLICT" });
  });
  it("enforces CAS and durable request fingerprint replay after reloading", async () => {
    const draft = await create();
    const input = { requestId: randomUUID(), expectedRevision: 1, header: { jobLabel: "Approved entry" } };
    const saved = await service.saveDraft(context, draft.id, input);
    expect(saved.revision).toBe(2);
    expect(await new SalesWorkspaceApplicationService(store, { now: () => clock }).saveDraft(context, draft.id, input)).toEqual(saved);
    await expect(service.saveDraft(context, draft.id, { ...input, header: {} })).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(service.saveDraft(context, draft.id, { ...input, requestId: randomUUID() })).rejects.toMatchObject({ code: "CONFLICT" });
    expect((await service.get(context, draft.id)).revision).toBe(2);
  });
  it("accepts one of two queued CAS commands, without silently overwriting the winner", async () => {
    const draft = await create();
    const results = await Promise.allSettled(["A", "B"].map((jobLabel) => service.saveDraft(context, draft.id,
      { requestId: randomUUID(), expectedRevision: 1, header: { jobLabel } })));
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toMatchObject([{ reason: { code: "CONFLICT" } }]);
    expect((await service.get(context, draft.id))).toMatchObject({ revision: 2, header: { jobLabel: "A" } });
  });
  it("retains stable relational lines across save, discard tombstone and replay", async () => {
    const populated = await addLine(await create());
    const saved = await service.saveDraft(context, populated.id, { requestId: randomUUID(), expectedRevision: populated.revision, header: { purchaseOrderNumber: "PO-1" } });
    expect(saved.lines).toEqual(populated.lines);
    const mutation = { requestId: randomUUID(), expectedRevision: saved.revision };
    const discarded = await service.discard(context, saved.id, mutation);
    expect(discarded.state).toBe("discarded");
    expect((await service.get(context, saved.id)).lines).toEqual(populated.lines);
    expect(await service.discard(context, saved.id, mutation)).toEqual(discarded);
    await expect(service.saveDraft(context, saved.id, { requestId: randomUUID(), expectedRevision: discarded.revision, header: {} })).rejects.toMatchObject({ code: "CONFLICT" });
    expect((await service.list(context)).some((entry) => entry.id === saved.id)).toBe(false);
  });
  it("roundtrips dual preview evidence above 64KiB then clears both on customer change", async () => {
    const draft = await create();
    const entry = line(draft.id);
    const organizationId = brandedId<"OrganizationId">(org), productId = brandedId<"ProductId">(entry.input.productId);
    const pricingConfigurationId = brandedId<"PricingConfigurationId">(randomUUID());
    const configuration = { schemaVersion: 1 as const, organizationId, productId, pricingConfigurationId,
      pricingConfigurationVersion: "1", pricingConfigurationContentHash: "fixture-config", quantity: 2,
      selections: {}, derivedFacts: {}, productFacts: { persistenceEvidence: "x".repeat(20000) } };
    const calculated = await new V2PricingParityAdapter().calculate({ organizationId, resolvedConfiguration: configuration,
      sellableProduct: { organizationId, productId, displayName: "Fixture", lifecycle: "active", requiresDimensions: false,
        pricingConfiguration: { id: pricingConfigurationId, version: "1", contentHash: "fixture-config" }, pricingCurrency: currencyCode("USD") },
      rules: { base: { perPieceCents: 100 } }, pricingContext: { channel: "staff", effectiveAt: clock.toISOString() } });
    const evidence = { inputFingerprint: workspaceLinePreviewFingerprint(entry.input), resolvedConfiguration: configuration,
      pricingResult: calculated, sellingPriceDecision: calculatedDecision(calculated, entry.input.selling, { principalKind: "staff", subjectId: user }),
      calculatedAt: clock.toISOString() };
    const previews = { quote: { ...evidence, target: "quote" as const }, order: { ...evidence, target: "order" as const } };
    expect(Buffer.byteLength(JSON.stringify(previews))).toBeGreaterThan(65536);
    await store.run(async (tx) => {
      await tx.get(org, user, draft.id, true);
      await tx.putLine(org, { ...entry, previews });
      await tx.update(bumpSalesWorkspaceRevision(draft, clock), draft.revision);
    });
    const reloaded = await service.get(context, draft.id);
    expect(reloaded.lines[0].previews).toEqual(JSON.parse(JSON.stringify(previews)));
    expect(reloaded.lines[0]).not.toHaveProperty("preview");
    const changed = await service.saveDraft(context, draft.id, { requestId: randomUUID(), expectedRevision: reloaded.revision,
      header: { customerContact: { organizationId, customerId: brandedId<"CustomerId">(randomUUID()) } } });
    expect(changed.lines[0].previews).toBeUndefined();
    expect((await service.get(context, draft.id)).lines[0]).toMatchObject({ id: entry.id, revision: 2 });
    expect((await service.get(context, draft.id)).lines[0].previews).toBeUndefined();
    await expect(database.query("UPDATE v2_sales_workspace_lines SET preview_json=$1::jsonb WHERE id=$2",
      [JSON.stringify({ oversized: "x".repeat(262144) }), entry.id])).rejects.toMatchObject({ code: "23514" });
  });
  it("exposes expiry consistently, bounds maintenance and retains lines", async () => {
    const populated = await addLine(await create());
    clock = new Date(Date.parse(populated.expiresAt) + 1);
    expect((await service.get(context, populated.id)).state).toBe("expired");
    expect(await service.list(context)).toEqual([]);
    await expect(service.saveDraft(context, populated.id, { requestId: randomUUID(), expectedRevision: populated.revision, header: {} })).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(service.expire(context, 101)).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    const expired = await service.expire(context, 100);
    expect(expired).toContain(populated.id);
    expect((await service.get(context, populated.id)).lines).toEqual(populated.lines);
    expect(await service.expire(context)).toEqual([]);
  });
  it("rolls back callback failure and releases its checked-out connection", async () => {
    const draft = await create();
    const before = releases;
    await expect(store.run(async (tx) => {
      const current = (await tx.get(org, user, draft.id, true))!;
      await tx.putLine(org, line(draft.id));
      await tx.update(bumpSalesWorkspaceRevision(current, clock), current.revision);
      throw new Error("injected failure");
    })).rejects.toThrow("injected failure");
    expect(releases).toBe(before + 1);
    expect(await service.get(context, draft.id)).toEqual(draft);
    const cleanupService = new SalesWorkspaceApplicationService(store, { now: () => clock, onDiscard: async () => { throw new Error("cleanup claim failed"); } });
    await expect(cleanupService.discard(context, draft.id, { requestId: randomUUID(), expectedRevision: 1 })).rejects.toThrow("cleanup claim failed");
    expect((await service.get(context, draft.id)).state).toBe("draft");
  });
  it("enforces tenant FKs, unique positions, terminal immutability and empty reorder", async () => {
    const draft = await create();
    await store.run(async (tx) => { await tx.get(org, user, draft.id, true); await tx.reorderLines(org, draft.id, []); });
    await expect(store.run(async (tx) => {
      await tx.get(org, user, draft.id, true);
      await tx.putLine(org, line(draft.id)); await tx.putLine(org, line(draft.id));
    })).rejects.toMatchObject({ code: "CONFLICT" });
    expect((await service.get(context, draft.id)).lines).toEqual([]);
    await expect(database.query(`INSERT INTO v2_sales_workspace_lines(id,organization_id,workspace_id,position,input_json,revision)
      VALUES($1,$2,$3,0,'{}',1)`, [randomUUID(), otherOrg, draft.id])).rejects.toMatchObject({ code: "23503" });
    const discarded = await service.discard(context, draft.id, { requestId: randomUUID(), expectedRevision: 1 });
    await expect(database.query("UPDATE v2_sales_workspaces SET revision=revision+1,state='draft' WHERE id=$1", [discarded.id])).rejects.toMatchObject({ code: "23514" });
  });
  it("swaps line positions under deferred uniqueness and enforces bounded payload/revision constraints", async () => {
    const populated = await addLine(await addLine(await create()));
    const ids = populated.lines.map((entry) => entry.id).reverse();
    await store.run(async (tx) => {
      const current = (await tx.get(org, user, populated.id, true))!;
      await tx.reorderLines(org, populated.id, ids);
      await tx.update(bumpSalesWorkspaceRevision(current, clock), current.revision);
    });
    expect((await service.get(context, populated.id)).lines.map((entry) => entry.id)).toEqual(ids);
    await expect(database.query("UPDATE v2_sales_workspace_lines SET revision=0 WHERE id=$1", [ids[0]])).rejects.toMatchObject({ code: "23514" });
    await expect(database.query("UPDATE v2_sales_workspace_lines SET input_json=$1::jsonb WHERE id=$2", [JSON.stringify({ oversized: "x".repeat(65536) }), ids[0]])).rejects.toMatchObject({ code: "23514" });
  });
  it("prevents committing promoting and incomplete promoted states", async () => {
    const draft = await create();
    await expect(store.run(async (tx) => {
      const current = (await tx.get(org, user, draft.id, true))!;
      await tx.update({ ...current, state: "promoting" }, current.revision);
    })).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(store.run(async (tx) => {
      const current = (await tx.get(org, user, draft.id, true))!;
      await tx.update({ ...bumpSalesWorkspaceRevision(current, clock), state: "promoting" }, current.revision);
    })).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(store.run(async (tx) => {
      const current = (await tx.get(org, user, draft.id, true))!;
      await tx.update({ ...bumpSalesWorkspaceRevision(current, clock), state: "promoted" }, current.revision);
    })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    await expect(store.run(async (tx) => {
      const current = (await tx.get(org, user, draft.id, true))!;
      await tx.beginPromotion(org, draft.id, current.revision, randomUUID(), "order", "a".repeat(64));
      expect(await tx.get(org, user, draft.id)).toEqual({ ...draft, state: "promoting" });
    })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(await service.get(context, draft.id)).toEqual(draft);
  });
  it("requires a creator-held lock, current CAS and valid promotion identity", async () => {
    const draft = await create();
    await expect(store.run((tx) => tx.beginPromotion(org, draft.id, draft.revision, randomUUID(), "order", "a".repeat(64))))
      .rejects.toMatchObject({ code: "CONFLICT" });
    await expect(store.run(async (tx) => {
      expect(await tx.get(org, otherUser, draft.id, true)).toBeNull();
      await tx.beginPromotion(org, draft.id, draft.revision, randomUUID(), "order", "a".repeat(64));
    })).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(store.run(async (tx) => {
      await tx.get(org, user, draft.id, true);
      await tx.beginPromotion(org, draft.id, draft.revision + 1, randomUUID(), "order", "a".repeat(64));
    })).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(store.run(async (tx) => {
      await tx.get(org, user, draft.id, true);
      await tx.beginPromotion(org, draft.id, draft.revision, randomUUID(), "order", "invalid");
    })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(await service.get(context, draft.id)).toEqual(draft);
  });
  it.each(["incomplete", "position"])("rejects a physically invalid %s map at COMMIT", async (fault) => {
    const populated = fault === "incomplete" ? await addLine(await addLine(await create())) : await addLine(await create());
    const documentId = randomUUID(), canonicalLineId = randomUUID(), requestId = randomUUID();
    const position = fault === "position" ? 1 : 0;
    await database.query("INSERT INTO v2_sales_document_lines(id,organization_id,document_id) VALUES($1,$2,$3)", [canonicalLineId, org, documentId]);
    await expect(store.run(async (tx) => {
      await tx.get(org, user, populated.id, true);
      await tx.beginPromotion(org, populated.id, populated.revision, requestId, "order", "a".repeat(64));
      // Bypass only the map writer's completeness check to exercise the physical constraint.
      await tx.client.query(`INSERT INTO v2_sales_workspace_promotion_lines
        (organization_id,workspace_id,workspace_line_id,document_id,canonical_line_id,position,target) VALUES($1,$2,$3,$4,$5,$6,'order')`,
      [org, populated.id, populated.lines[0].id, documentId, canonicalLineId, position]);
      await tx.recordPromotion({ workspaceId: populated.id, organizationId: org, requestId, fingerprint: "a".repeat(64),
        inputRevision: populated.revision, target: "order", documentId, documentRevision: "1", header: populated.header,
        lineMap: [{ workspaceLineId: populated.lines[0].id, canonicalLineId, position }], promotedAt: clock.toISOString() });
      await tx.update({ ...bumpSalesWorkspaceRevision(populated, clock), state: "promoted" }, populated.revision);
    })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect((await service.get(context, populated.id)).state).toBe("draft");
    expect(await store.run((tx) => tx.getPromotionLineMap(org, populated.id))).toEqual([]);
  });
  it.each([false, true])("persists complete map, metadata and artworkPromoted=%s across replay", async (artworkPromoted) => {
    const populated = await addLine(await create({ jobLabel: "Durable job name", notes: "Durable workspace notes" }));
    const documentId = randomUUID(); const canonicalLineId = randomUUID();
    await database.query("INSERT INTO v2_sales_document_lines(id,organization_id,document_id) VALUES($1,$2,$3)", [canonicalLineId, org, documentId]);
    const receipt: SalesWorkspacePromotionReceipt = { workspaceId: populated.id, organizationId: org, requestId: randomUUID(), fingerprint: "a".repeat(64),
      inputRevision: populated.revision, target: "order", documentId, documentRevision: "7", header: populated.header,
      promotedAt: clock.toISOString(), lineMap: [{ workspaceLineId: populated.lines[0].id, canonicalLineId, position: 0 }],
      result: { revision: "7", number: { core: "1000", display: "ORD-1000" } }, artworkPromoted };
    await expect(store.run(async (tx) => {
      await tx.get(org, user, populated.id, true);
      await tx.beginPromotion(org, populated.id, populated.revision, receipt.requestId, receipt.target, receipt.fingerprint);
      await tx.recordPromotion({ ...receipt, documentId: randomUUID() });
    }))
      .rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    await expect(store.run(async (tx) => {
      await tx.get(org, user, populated.id, true);
      await tx.beginPromotion(org, populated.id, populated.revision, receipt.requestId, receipt.target, receipt.fingerprint);
      await tx.recordPromotion({ ...receipt, lineMap: [] });
    }))
      .rejects.toMatchObject({ code: "CONFLICT" });
    for (const mismatch of [{ requestId: randomUUID() }, { fingerprint: "b".repeat(64) }, { target: "quote" as const }]) {
      await expect(store.run(async (tx) => {
        const current = (await tx.get(org, user, populated.id, true))!;
        await tx.beginPromotion(org, populated.id, current.revision, receipt.requestId, receipt.target, receipt.fingerprint);
        await tx.recordPromotionLineMap(org, current.id, receipt.target, documentId, receipt.lineMap);
        await tx.recordPromotion({ ...receipt, ...mismatch });
        await tx.update({ ...bumpSalesWorkspaceRevision(current, clock), state: "promoted" }, current.revision);
      })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
      expect((await service.get(context, populated.id)).state).toBe("draft");
    }
    await store.run(async (tx) => {
      const current = (await tx.get(org, user, populated.id, true))!;
      await tx.lockPromotionRequest(org, receipt.requestId);
      expect(await tx.findPromotionRequest(org, receipt.requestId)).toBeNull();
      await tx.beginPromotion(org, current.id, current.revision, receipt.requestId, receipt.target, receipt.fingerprint);
      await tx.recordPromotionLineMap(org, current.id, receipt.target, documentId, receipt.lineMap);
      // Artwork can inspect the durable map before its final canonical revision is known.
      expect(await tx.getPromotionLineMap(org, current.id)).toEqual(receipt.lineMap);
      expect(await tx.getPromotion(org, current.id)).toBeNull();
      await tx.recordPromotion(receipt);
      await tx.update({ ...bumpSalesWorkspaceRevision(current, clock), state: "promoted", promotion: receipt }, current.revision);
    });
    expect((await service.get(context, populated.id)).promotion).toEqual(receipt);
    expect(await store.run((tx) => tx.findPromotionRequest(org, receipt.requestId))).toEqual(receipt);
    await expect(service.get(scoped(org, otherUser), populated.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    const another = await create();
    await expect(store.run(async (tx) => {
      await tx.get(org, user, another.id, true);
      await tx.beginPromotion(org, another.id, another.revision, receipt.requestId, receipt.target, receipt.fingerprint);
    })).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(database.query("DELETE FROM v2_sales_workspace_promotion_lines WHERE workspace_id=$1", [populated.id])).rejects.toMatchObject({ code: "23514" });
  });
  it("rejects missing, foreign-tenant and wrong-document canonical tuples on map INSERT", async () => {
    const populated = await addLine(await create());
    const documentId = randomUUID(), foreignLineId = randomUUID(), wrongDocumentLineId = randomUUID();
    await database.query("INSERT INTO v2_sales_document_lines(id,organization_id,document_id) VALUES($1,$2,$3),($4,$5,$6)",
      [foreignLineId, otherOrg, documentId, wrongDocumentLineId, org, randomUUID()]);
    for (const target of ["quote", "order"] as const) {
      for (const canonicalLineId of [randomUUID(), foreignLineId, wrongDocumentLineId]) {
        await expect(store.run(async (tx) => {
          await tx.get(org, user, populated.id, true);
          await tx.beginPromotion(org, populated.id, populated.revision, randomUUID(), target, "a".repeat(64));
          await tx.recordPromotionLineMap(org, populated.id, target, documentId,
            [{ workspaceLineId: populated.lines[0].id, canonicalLineId, position: 0 }]);
        })).rejects.toMatchObject({ code: "VALIDATION_ERROR", cause: {
          code: "23503", constraint: "v2_sales_workspace_promotion_lines_canonical_fk",
        } });
      }
    }
    expect(await service.get(context, populated.id)).toEqual(populated);
    expect(await store.run((tx) => tx.getPromotionLineMap(org, populated.id))).toEqual([]);
  });
  it("preserves immutable Quote and Order promotion history after later canonical line replacement and removal", async () => {
    for (const target of ["quote", "order"] as const) {
      const populated = await addLine(await addLine(await create()));
      const documentId = randomUUID(), canonicalIds = [randomUUID(), randomUUID()];
      await database.query("INSERT INTO v2_sales_document_lines(id,organization_id,document_id) VALUES($1,$2,$3),($4,$2,$3)",
        [canonicalIds[0], org, documentId, canonicalIds[1]]);
      const receipt: SalesWorkspacePromotionReceipt = { workspaceId: populated.id, organizationId: org,
        requestId: randomUUID(), fingerprint: "a".repeat(64), inputRevision: populated.revision, target,
        documentId, documentRevision: "1", header: populated.header, artworkPromoted: false,
        lineMap: populated.lines.map((entry, position) => ({ workspaceLineId: entry.id, canonicalLineId: canonicalIds[position], position })),
        promotedAt: clock.toISOString() };
      await store.run(async (tx) => {
        await tx.get(org, user, populated.id, true);
        await tx.beginPromotion(org, populated.id, populated.revision, receipt.requestId, target, receipt.fingerprint);
        await tx.recordPromotionLineMap(org, populated.id, target, documentId, receipt.lineMap);
        await tx.recordPromotion(receipt);
        await tx.update({ ...bumpSalesWorkspaceRevision(populated, clock), state: "promoted" }, populated.revision);
      });
      // Canonical writers may replace rows during a reorder, then remove a line.
      await store.run(async (tx) => {
        expect((await tx.client.query("DELETE FROM v2_sales_document_lines WHERE organization_id=$1 AND document_id=$2", [org, documentId])).rowCount).toBe(2);
        await tx.client.query("INSERT INTO v2_sales_document_lines(id,organization_id,document_id) VALUES($1,$2,$3),($4,$2,$3)",
          [canonicalIds[1], org, documentId, canonicalIds[0]]);
      });
      expect((await database.query("DELETE FROM v2_sales_document_lines WHERE organization_id=$1 AND document_id=$2 AND id <> ALL($3::text[])",
        [org, documentId, [canonicalIds[0]]])).affectedRows).toBe(1);
      expect((await service.get(context, populated.id)).promotion).toEqual(receipt);
      expect(await store.run((tx) => tx.getPromotionLineMap(org, populated.id))).toEqual(receipt.lineMap);
      expect(await store.run((tx) => tx.findPromotionRequest(org, receipt.requestId))).toEqual(receipt);
      await expect(database.query("UPDATE v2_sales_workspace_promotion_lines SET canonical_line_id=$1 WHERE workspace_id=$2", [randomUUID(), populated.id]))
        .rejects.toMatchObject({ code: "23514" });
      await expect(database.query("DELETE FROM v2_sales_workspace_promotion_lines WHERE workspace_id=$1", [populated.id]))
        .rejects.toMatchObject({ code: "23514" });
    }
  });
  it("rejects canonical line deletion inside either promotion transaction at COMMIT", async () => {
    for (const target of ["quote", "order"] as const) {
      const populated = await addLine(await create());
      const documentId = randomUUID(), canonicalLineId = randomUUID();
      await database.query("INSERT INTO v2_sales_document_lines(id,organization_id,document_id) VALUES($1,$2,$3)", [canonicalLineId, org, documentId]);
      const receipt: SalesWorkspacePromotionReceipt = { workspaceId: populated.id, organizationId: org,
        requestId: randomUUID(), fingerprint: "a".repeat(64), inputRevision: populated.revision, target,
        documentId, documentRevision: "1", header: populated.header,
        lineMap: [{ workspaceLineId: populated.lines[0].id, canonicalLineId, position: 0 }], promotedAt: clock.toISOString() };
      let reachedCommit = false;
      await expect(store.run(async (tx) => {
        await tx.get(org, user, populated.id, true);
        await tx.beginPromotion(org, populated.id, populated.revision, receipt.requestId, target, receipt.fingerprint);
        await tx.recordPromotionLineMap(org, populated.id, target, documentId, receipt.lineMap);
        await tx.recordPromotion(receipt);
        await tx.update({ ...bumpSalesWorkspaceRevision(populated, clock), state: "promoted" }, populated.revision);
        expect((await tx.client.query("DELETE FROM v2_sales_document_lines WHERE id=$1", [canonicalLineId])).rowCount).toBe(1);
        reachedCommit = true;
      })).rejects.toMatchObject({ code: "VALIDATION_ERROR", cause: {
        code: "23503", constraint: "v2_sales_workspace_promotion_lines_canonical_fk",
      } });
      expect(reachedCommit).toBe(true);
      expect(await service.get(context, populated.id)).toEqual(populated);
      expect(await store.run((tx) => tx.getPromotion(org, populated.id))).toBeNull();
      expect(await store.run((tx) => tx.getPromotionLineMap(org, populated.id))).toEqual([]);
      expect((await database.query("SELECT id FROM v2_sales_document_lines WHERE id=$1", [canonicalLineId])).rows).toEqual([{ id: canonicalLineId }]);
    }
  });
});
