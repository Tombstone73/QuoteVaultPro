import { jest } from "@jest/globals";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { CanonicalProductPublishOperations, validateCanonicalProductPublishTarget } from "../services/products/canonicalProductPublishOperations";

describe("CanonicalProductPublishOperations", () => {
  const target = () => ({ product: { id: "product_1", organizationId: "org_1", name: "Styrene", isActive: false, primaryMaterialId: null, pbv2ActiveTreeVersionId: null, updatedAt: new Date("2026-08-13T00:00:00.000Z") }, tree: { id: "tree_1", organizationId: "org_1", productId: "product_1", status: "DRAFT", schemaVersion: 2, treeJson: { schemaVersion: 2 }, publishedAt: null, updatedAt: new Date("2026-08-13T00:00:00.000Z") }, materials: [] });
  const directMatrixTree = (basePrice = 7500) => ({
    schemaVersion: 2,
    status: "DRAFT",
    rootNodeIds: ["finish"],
    nodes: [{
      id: "finish", type: "INPUT", status: "ENABLED", key: "finish",
      input: { selectionKey: "finish", valueType: "ENUM" },
      choices: [{ value: "economy", label: "Economy" }],
    }],
    edges: [],
    meta: {
      pricingProfileKey: "qty_only",
      pricingV2: { tierBasis: "line_item_quantity", base: { perSqftCents: 0, perPieceCents: 0, minimumChargeCents: 0 }, qtyTiers: [] },
    },
    pricingMatrix: { dimensions: ["finish"], rows: [{ id: "economy", match: { finish: "economy" }, variables: { base_price: basePrice } }] },
  });
  it("binds exact versions and atomically requests publish plus activation", async () => {
    let current: any = target(); const calls: any[] = [];
    const service = new CanonicalProductPublishOperations({ get: async ({ organizationId }: any) => organizationId === "org_1" ? current : null, publish: async (input: any) => { calls.push(input); return { product: { ...current.product, isActive: true, pbv2ActiveTreeVersionId: "tree_1" }, tree: { ...current.tree, status: "ACTIVE" } }; } } as any, () => ({ treeJson: { schemaVersion: 2 }, findings: [], warnings: [], errors: [] }));
    const proposal = await service.propose({ organizationId: "org_1", productId: "product_1" });
    expect(proposal).toMatchObject({ treeVersionId: "tree_1", operationReference: "products.publish_configuration.v1" });
    const result = await service.execute({ organizationId: "org_1", actorUserId: "admin_1", productId: "product_1", treeVersionId: "tree_1", expectedProductUpdatedAt: proposal.expectedProductUpdatedAt, expectedTreeUpdatedAt: proposal.expectedTreeUpdatedAt, activateProduct: true, auditContext: { source: "assistant_go", reference: "plan_1" } });
    expect(calls[0]).toMatchObject({ activateProduct: true, reference: "plan_1" });
    expect(result.appliedChanges).toEqual([{ field: "PBV2 configuration", before: "DRAFT", after: "ACTIVE" }, { field: "Lifecycle", before: "inactive", after: "active" }]);
    current = { ...current, tree: { ...current.tree, updatedAt: new Date("2026-08-13T00:02:00.000Z") } };
    await expect(service.execute({ organizationId: "org_1", actorUserId: "admin_1", productId: "product_1", treeVersionId: "tree_1", expectedProductUpdatedAt: proposal.expectedProductUpdatedAt, expectedTreeUpdatedAt: proposal.expectedTreeUpdatedAt })).rejects.toMatchObject({ code: "PBV2_PUBLISH_STALE" });
  });

  it("requires explicit warning confirmation", async () => {
    const warning: any = { code: "PBV2_W_TEST", severity: "WARNING", message: "Review this configuration.", path: "tree" };
    const service = new CanonicalProductPublishOperations({ get: async () => target(), publish: async () => null } as any, () => ({ treeJson: { schemaVersion: 2 }, findings: [warning], warnings: [warning], errors: [] }));
    const proposal = await service.propose({ organizationId: "org_1", productId: "product_1" });
    await expect(service.execute({ organizationId: "org_1", actorUserId: "admin_1", productId: "product_1", treeVersionId: "tree_1", expectedProductUpdatedAt: proposal.expectedProductUpdatedAt, expectedTreeUpdatedAt: proposal.expectedTreeUpdatedAt })).rejects.toMatchObject({ code: "PBV2_PUBLISH_WARNINGS_CONFIRM_REQUIRED" });
  });

  it("reports the real canonical validation blocker for an invalid DRAFT", async () => {
    const service = new CanonicalProductPublishOperations({ get: async () => target(), publish: async () => null } as any);
    await expect(service.propose({ organizationId: "org_1", productId: "product_1" })).rejects.toMatchObject({ code: "PBV2_PUBLISH_INVALID", findings: expect.arrayContaining([expect.objectContaining({ severity: "ERROR" })]) });
  });

  it("allows activation for direct matrix pricing without fake tiers and blocks a genuinely unpriced row", async () => {
    const valid = target();
    valid.tree.treeJson = directMatrixTree();
    const publish = jest.fn(async ({ product, tree }: any) => ({ product: { ...product, isActive: true, pbv2ActiveTreeVersionId: tree.id }, tree: { ...tree, status: "ACTIVE" } }));
    const service = new CanonicalProductPublishOperations({ get: async () => valid, publish } as any);

    const proposal = await service.propose({ organizationId: "org_1", productId: "product_1" });
    await service.execute({ organizationId: "org_1", actorUserId: "admin_1", productId: "product_1", treeVersionId: "tree_1", expectedProductUpdatedAt: proposal.expectedProductUpdatedAt, expectedTreeUpdatedAt: proposal.expectedTreeUpdatedAt, confirmWarnings: true, activateProduct: true });
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({ activateProduct: true }));

    const invalid = target();
    invalid.tree.treeJson = directMatrixTree(0);
    const invalidService = new CanonicalProductPublishOperations({ get: async () => invalid, publish: async () => null } as any);
    await expect(invalidService.propose({ organizationId: "org_1", productId: "product_1" })).rejects.toMatchObject({ code: "PBV2_PUBLISH_INVALID" });
  });

  it("uses the version-row Draft lifecycle when tree JSON has no duplicated status", async () => {
    const valid = target();
    const tree = directMatrixTree();
    delete (tree as { status?: unknown }).status;
    valid.tree.treeJson = tree;

    const validation = validateCanonicalProductPublishTarget(valid as any);
    expect(validation.errors).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "PBV2_E_TREE_STATUS_INVALID" }),
    ]));
    expect(validation.treeJson.status).toBe("DRAFT");
  });

  it("blocks publication until a Draft inheriting a legacy Product Formula owns a canonical Formula", () => {
    const legacyExpression = "ceil((((w+.25)*(h+.25))*q)/144)*p";
    const legacy = target();
    legacy.product = { ...legacy.product, pricingEngine: "pricingFormula", pricingFormula: legacyExpression };
    legacy.tree.treeJson = directMatrixTree();

    const missing = validateCanonicalProductPublishTarget(legacy as any);
    expect(missing.errors).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "PBV2_E_LEGACY_PRODUCT_FORMULA_NOT_CANONICALIZED" }),
    ]));

    const embedded = structuredClone(legacy) as any;
    embedded.tree.treeJson.meta.pricingFormula = legacyExpression;
    expect(validateCanonicalProductPublishTarget(embedded).errors).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "PBV2_E_LEGACY_PRODUCT_FORMULA_NOT_CANONICALIZED" }),
    ]));

    const intentionallyChanged = structuredClone(legacy) as any;
    intentionallyChanged.tree.treeJson.meta.pricingFormula = `${legacyExpression} + 0`;
    expect(validateCanonicalProductPublishTarget(intentionallyChanged).errors).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "PBV2_E_LEGACY_PRODUCT_FORMULA_NOT_CANONICALIZED" }),
    ]));

    const revisionBound = structuredClone(legacy) as any;
    revisionBound.formulaRevision = { id: "formula-revision-1", formulaId: "formula-1", expression: legacyExpression };
    expect(validateCanonicalProductPublishTarget(revisionBound).errors).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "PBV2_E_LEGACY_PRODUCT_FORMULA_NOT_CANONICALIZED" }),
    ]));
  });

  it("requires an actor, rejects another tenant, and is shared by the UI route", async () => {
    const service = new CanonicalProductPublishOperations({ get: async ({ organizationId }: any) => organizationId === "org_1" ? target() : null, publish: async () => null } as any, () => ({ treeJson: { schemaVersion: 2 }, findings: [], warnings: [], errors: [] }));
    const proposal = await service.propose({ organizationId: "org_1", productId: "product_1" });
    await expect(service.execute({ organizationId: "org_1", actorUserId: "", productId: "product_1", treeVersionId: "tree_1", expectedProductUpdatedAt: proposal.expectedProductUpdatedAt, expectedTreeUpdatedAt: proposal.expectedTreeUpdatedAt })).rejects.toMatchObject({ code: "ACTOR_REQUIRED" });
    await expect(service.propose({ organizationId: "org_2", productId: "product_1" })).rejects.toMatchObject({ code: "PRODUCT_PUBLISH_TARGET_NOT_FOUND" });
    const route = await readFile(path.resolve(process.cwd(), "server/routes/products.routes.ts"), "utf8");
    expect(route).toContain("canonicalProductPublishOperations.execute");
    expect(route).toContain("const activateProduct = (req.body as any)?.activateProduct === true;");
    expect(route).toContain("activateProduct, auditContext");
  });
});
