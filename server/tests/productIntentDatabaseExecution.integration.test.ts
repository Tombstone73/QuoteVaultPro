import { hasSafeTestDatabase } from "./helpers/safeTestDatabase";

const rollback = Symbol("canonical-product-intent-test-rollback");

function canonicalIntent(overrides: Record<string, unknown> = {}) {
  const base = {
    contractVersion: 1,
    intentId: "canonical-db-intent-1",
    organizationId: "",
    revision: 1,
    state: "ready_for_review",
    operation: "new_product",
    identity: { name: "Canonical DB Product", description: "Database integration fixture", category: { state: "resolved", id: "print", label: "Print" } },
    lifecycle: { productStatus: "inactive", published: false },
    measurement: { mode: "dimensions_required" },
    quantity: { behavior: "customer_entered", minimum: 1 },
    pricing: { model: "scalar", unit: "per_square_foot", priceCents: 500 },
    material: { state: "explicitly_unset" },
    optionGroups: [],
    workflow: { kind: "standard_production", requiresProofApproval: false, requiresProductionJob: false },
    production: { route: { state: "explicitly_unset" }, configuration: {} },
    visibility: { catalogVisible: false },
    unresolvedFields: [],
    fieldMetadata: {},
    revisionMetadata: { parentRevision: 0 },
    operationContext: {},
  };
  return { ...base, ...overrides };
}

/**
 * This file is deliberately a separate opt-in integration boundary.  It must
 * not import server/db, schema, or execution services unless TEST_DATABASE_URL
 * has passed the guard in setup.ts.  That keeps normal Product Intent contract
 * tests runnable on developer machines with no database configuration.
 *
 * The full execution cases belong here when a dedicated test database is
 * supplied: persistence/CAS, confirmation binding, stale confirmation,
 * transactional product + PBV2 DRAFT creation, projection variants, rollback,
 * idempotent replay, and exact returned IDs.
 */
const describeDatabase = hasSafeTestDatabase() ? describe : describe.skip;

describeDatabase("canonical Product Intent database execution (requires safe TEST_DATABASE_URL)", () => {
  let db: any;
  let schema: any;
  let createWriter: any;

  beforeAll(async () => {
    // These imports are intentionally delayed. In the ordinary no-DB run this
    // describe block is skipped before server/db can be evaluated.
    ({ db } = await import("../db"));
    schema = await import("@shared/schema");
    ({ createCanonicalProductDraftExecutionWriter: createWriter } = await import("../services/productIntentCompiler/productIntentDraftExecution"));
  });

  async function runRollbackOnly(assertions: (tx: any, organizationId: string) => Promise<void>) {
    const nonce = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const organizationId = `canonical-db-test-${nonce}`;
    try {
      await db.transaction(async (tx: any) => {
        await tx.insert(schema.organizations).values({
          id: organizationId,
          name: "Canonical Product Intent DB Test",
          slug: `canonical-db-${nonce}`.slice(0, 96),
        });
        await assertions(tx, organizationId);
        throw rollback;
      });
    } catch (error) {
      if (error !== rollback) throw error;
    }
    return organizationId;
  }

  test("creates canonical PBV2 drafts transactionally and rolls every fixture back", async () => {
    let createdProductId = "";
    let createdTreeVersionId = "";
    const organizationId = await runRollbackOnly(async (tx, orgId) => {
      const materialId = `canonical-material-${Date.now()}`;
      const stationId = `canonical-station-${Date.now()}`;
      await tx.insert(schema.materials).values({ organizationId: orgId, id: materialId, name: "Test Acrylic", sku: `TEST-${Date.now()}`, type: "sheet", costPerUnit: "1" });
      await tx.insert(schema.stations).values({ organizationId: orgId, id: stationId, key: "flatbed", name: "Flatbed", active: true });

      // Reuse the outer transaction for the writer's transaction boundary.
      // Throwing the sentinel from runRollbackOnly proves product, tree, and
      // audit writes are atomic without leaving test rows behind.
      const writer = createWriter({ transaction: async (work: (inner: any) => Promise<unknown>) => work(tx) });
      const intent = canonicalIntent({
        organizationId: orgId,
        intentId: `canonical-matrix-${orgId}`,
        pricing: {
          model: "two_dimensional_matrix", unit: "per_piece", rowOptionKey: "thickness", columnOptionKey: "sides",
          cells: [
            { row: "3mm", column: "single", priceCents: 1200 }, { row: "3mm", column: "double", priceCents: 1800 },
            { row: "6mm", column: "single", priceCents: 1600 }, { row: "6mm", column: "double", priceCents: 2200 },
          ],
        },
        material: { state: "resolved", id: materialId, label: "Test Acrylic" },
        optionGroups: [
          { key: "thickness", label: "Thickness", required: true, selectionMode: "single", values: [{ key: "3mm", label: "3mm", isDefault: true }, { key: "6mm", label: "6mm", isDefault: false }] },
          { key: "sides", label: "Sides", required: true, selectionMode: "single", values: [{ key: "single", label: "Single-sided", isDefault: true }, { key: "double", label: "Double-sided", isDefault: false }] },
          { key: "lamination", label: "Lamination", required: true, selectionMode: "single", values: [{ key: "none", label: "None", isDefault: true }, { key: "gloss", label: "Gloss", isDefault: false }] },
        ],
        workflow: { kind: "standard_production", requiresProofApproval: true, requiresProductionJob: true },
        production: { route: { state: "resolved", id: stationId, label: "Flatbed" }, configuration: {} },
      });
      const first = await writer.execute({ intent, organizationId: orgId, actorUserId: null, idempotencyKey: "matrix-replay" });
      const replay = await writer.execute({ intent, organizationId: orgId, actorUserId: null, idempotencyKey: "matrix-replay" });
      createdProductId = first.productId;
      createdTreeVersionId = first.pbv2TreeVersionId;
      expect(replay).toMatchObject({ productId: first.productId, pbv2TreeVersionId: first.pbv2TreeVersionId, reused: true });

      const [product] = await tx.select().from(schema.products).where((await import("drizzle-orm")).eq(schema.products.id, first.productId));
      const [tree] = await tx.select().from(schema.pbv2TreeVersions).where((await import("drizzle-orm")).eq(schema.pbv2TreeVersions.id, first.pbv2TreeVersionId));
      expect(product).toMatchObject({ organizationId: orgId, isActive: false, primaryMaterialId: materialId, requiresProofApproval: true, requiresProductionJob: true });
      expect(tree).toMatchObject({ organizationId: orgId, productId: first.productId, status: "DRAFT", schemaVersion: 2 });
      expect(tree.treeJson.pricingMatrix.rows).toHaveLength(4);
      expect(tree.treeJson.meta.pricingV2.optionMatrixPricingUnit).toBe("per_piece");
      const laminationInput = Object.values(tree.treeJson.nodes).find((node: any) => node.key === "lamination") as any;
      expect(laminationInput.input.defaultValue).toBe("none");
      expect(tree.treeJson.meta.canonicalExecution.pbv2TreeVersionId).toBe(first.pbv2TreeVersionId);
      expect(first.sourceLink).toContain(`draftTreeVersionId=${first.pbv2TreeVersionId}`);

      await expect(writer.execute({ intent: { ...intent, pricing: { model: "scalar", unit: "per_piece", priceCents: 99 } }, organizationId: orgId, actorUserId: null, idempotencyKey: "matrix-replay" })).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });

      const tiers = canonicalIntent({
        organizationId: orgId,
        intentId: `canonical-tiers-${orgId}`,
        identity: { name: "Canonical Quantity Tiers", description: "", category: { state: "resolved", id: "print", label: "Print" } },
        measurement: { mode: "quantity_only" },
        pricing: { model: "quantity_tiers", unit: "per_piece", tiers: [{ minimumQuantity: 1, maximumQuantity: 24, priceCents: 300 }, { minimumQuantity: 25, maximumQuantity: 49, priceCents: 250 }, { minimumQuantity: 50, maximumQuantity: null, priceCents: 200 }] },
      });
      const tierResult = await writer.execute({ intent: tiers, organizationId: orgId, actorUserId: null, idempotencyKey: "tiers" });
      const [tierProduct] = await tx.select().from(schema.products).where((await import("drizzle-orm")).eq(schema.products.id, tierResult.productId));
      const [tierTree] = await tx.select().from(schema.pbv2TreeVersions).where((await import("drizzle-orm")).eq(schema.pbv2TreeVersions.id, tierResult.pbv2TreeVersionId));
      expect(tierProduct).toMatchObject({ measurementMode: "quantity_only", primaryMaterialId: null });
      expect(tierTree.treeJson.meta.pricingV2.qtyTiers).toEqual(expect.arrayContaining([
        expect.objectContaining({ minQty: 1, maxQty: 24, perPieceCents: 300 }),
        expect.objectContaining({ minQty: 50, maxQty: null, perPieceCents: 200 }),
      ]));
      expect(tierTree.treeJson.meta.productIntake.material).toEqual({ state: "explicitly_unset" });
    });

    const { eq } = await import("drizzle-orm");
    const rows = await db.select({ id: schema.products.id }).from(schema.products).where(eq(schema.products.id, createdProductId));
    expect(rows).toEqual([]);
    const trees = await db.select({ id: schema.pbv2TreeVersions.id }).from(schema.pbv2TreeVersions).where(eq(schema.pbv2TreeVersions.id, createdTreeVersionId));
    expect(trees).toEqual([]);
    // The organization itself was in the same transaction; this guards against
    // fixture leakage if a writer failure happens between product/tree inserts.
    const organizations = await db.select({ id: schema.organizations.id }).from(schema.organizations).where(eq(schema.organizations.id, organizationId));
    expect(organizations).toEqual([]);
  });
});
