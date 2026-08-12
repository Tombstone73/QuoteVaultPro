import { readFile } from "node:fs/promises";
import path from "node:path";
import { CanonicalProductConfigurationError, CanonicalProductConfigurationOperations, renderCanonicalProductOperationMigrationMarkdown } from "../services/products/canonicalProductConfigurationOperations";

function fixture() {
  let product: any = {
    id: "product_1", organizationId: "org_1", name: "Banner", description: "Original", category: "Signs", productTypeId: "type_1",
    measurementMode: "dimensions_required", workflowIntent: "standard_production", requiresProductionJob: true, requiresProofApproval: false,
    updatedAt: new Date("2026-08-12T12:00:00.000Z"),
  };
  const store = {
    getProduct: async ({ organizationId, productId }: any) => organizationId === product.organizationId && productId === product.id ? { ...product } : null,
    listProductTypeIds: async () => ["type_1", "type_2"],
    updateProduct: async ({ organizationId, productId, changes, expectedUpdatedAt }: any) => {
      if (organizationId !== product.organizationId || productId !== product.id || (expectedUpdatedAt && expectedUpdatedAt.getTime() !== product.updatedAt.getTime())) return null;
      product = { ...product, ...changes, updatedAt: new Date(product.updatedAt.getTime() + 1_000) };
      return { ...product };
    },
  };
  return { store, current: () => ({ ...product }) };
}

describe("CanonicalProductConfigurationOperations", () => {
  it("updates the shared identity and workflow slice and applies established service-fee invariants", async () => {
    const state = fixture(); const service = new CanonicalProductConfigurationOperations(state.store as any);
    const proposal = await service.propose({ organizationId: "org_1", productId: "product_1", changes: { name: "Installation fee", workflowIntent: "service_fee" } });
    const result = await service.execute({ organizationId: "org_1", actorUserId: "admin_1", productId: "product_1", changes: { name: "Installation fee", workflowIntent: "service_fee" }, expectedUpdatedAt: proposal.expectedUpdatedAt, auditContext: { source: "assistant_go", reference: "plan_1" } });
    expect(result).toMatchObject({ operationReference: "products.update_configuration.v1", auditReference: "plan_1" });
    expect(result.appliedChanges.map((change) => change.field)).toEqual(expect.arrayContaining(["name", "workflowIntent", "measurementMode", "requiresProductionJob"]));
    expect(state.current()).toMatchObject({ name: "Installation fee", workflowIntent: "service_fee", measurementMode: "quantity_only", requiresProductionJob: false, requiresProofApproval: false });
  });

  it("fails closed for tenant mismatch, missing actor, invalid product type, no-op, and stale state without writing", async () => {
    const state = fixture(); const service = new CanonicalProductConfigurationOperations(state.store as any);
    await expect(service.propose({ organizationId: "org_2", productId: "product_1", changes: { name: "Nope" } })).rejects.toMatchObject({ code: "PRODUCT_NOT_FOUND" });
    await expect(service.execute({ organizationId: "org_1", actorUserId: "", productId: "product_1", changes: { name: "Nope" } })).rejects.toMatchObject({ code: "ACTOR_REQUIRED" });
    await expect(service.propose({ organizationId: "org_1", productId: "product_1", changes: { productTypeId: "unknown" } })).rejects.toMatchObject({ code: "UNKNOWN_PRODUCT_TYPE_ID" });
    await expect(service.propose({ organizationId: "org_1", productId: "product_1", changes: { name: "Banner" } })).rejects.toMatchObject({ code: "NO_PRODUCT_CONFIGURATION_CHANGES" });
    await expect(service.execute({ organizationId: "org_1", actorUserId: "admin_1", productId: "product_1", changes: { name: "Nope" }, expectedUpdatedAt: "2026-01-01T00:00:00.000Z" })).rejects.toMatchObject({ code: "PRODUCT_CONFIGURATION_STALE" });
    expect(state.current().name).toBe("Banner");
  });

  it("returns stale on a conditional-write conflict and leaves the product unchanged", async () => {
    const state = fixture(); const base = state.store;
    const service = new CanonicalProductConfigurationOperations({ ...base, updateProduct: async () => null } as any);
    const proposal = await service.propose({ organizationId: "org_1", productId: "product_1", changes: { description: "Changed" } });
    await expect(service.execute({ organizationId: "org_1", actorUserId: "admin_1", productId: "product_1", changes: { description: "Changed" }, expectedUpdatedAt: proposal.expectedUpdatedAt })).rejects.toBeInstanceOf(CanonicalProductConfigurationError);
    expect(state.current().description).toBe("Original");
  });

  it("keeps the Product Editor route delegated to the canonical operation and its migration report generated", async () => {
    await expect(readFile(path.resolve(process.cwd(), "server/routes/products.routes.ts"), "utf8")).resolves.toContain("canonicalProductConfigurationOperations.execute");
    await expect(readFile(path.resolve(process.cwd(), "docs/architecture/canonical-product-operation-migration.md"), "utf8")).resolves.toBe(renderCanonicalProductOperationMigrationMarkdown());
  });
});
