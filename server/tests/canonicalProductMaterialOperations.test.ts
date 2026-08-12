import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  CanonicalProductMaterialError,
  CanonicalProductMaterialOperations,
  canonicalProductMaterialProposalFromReference,
  renderCanonicalProductMaterialMigrationMarkdown,
  resolveCanonicalProductMaterialProposal,
} from "../services/products/canonicalProductMaterialOperations";

const resolved = (id = "material_1", label = "13oz Banner") => canonicalProductMaterialProposalFromReference({ state: "resolved", id, label });

function fixture(primaryMaterialId: string | null = null) {
  let product: any = { id: "product_1", organizationId: "org_1", name: "Banner", primaryMaterialId, updatedAt: new Date("2026-08-12T12:00:00.000Z") };
  const materialRows: Record<string, any> = {
    material_1: { id: "material_1", organizationId: "org_1", name: "13oz Banner", isActive: true },
    inactive_1: { id: "inactive_1", organizationId: "org_1", name: "Retired Banner", isActive: false },
  };
  const writes: any[] = [];
  const store = {
    getProduct: async ({ organizationId, productId }: any) => organizationId === product.organizationId && productId === product.id ? { ...product } : null,
    getMaterial: async ({ organizationId, materialId }: any) => materialRows[materialId]?.organizationId === organizationId ? { ...materialRows[materialId] } : null,
    update: async ({ organizationId, productId, materialId, expectedUpdatedAt, actorUserId, auditReference }: any) => {
      if (organizationId !== product.organizationId || productId !== product.id || (expectedUpdatedAt && expectedUpdatedAt.getTime() !== product.updatedAt.getTime())) return null;
      product = { ...product, primaryMaterialId: materialId, updatedAt: new Date(product.updatedAt.getTime() + 1_000) };
      writes.push({ materialId, actorUserId, auditReference });
      return { ...product };
    },
  };
  return { store, writes, current: () => ({ ...product }) };
}

describe("CanonicalProductMaterialOperations", () => {
  it("resolves exactly one active trusted tenant candidate and preserves ambiguity/no-match", () => {
    expect(resolveCanonicalProductMaterialProposal("13OZ BANNER", [{ id: "m1", label: "13oz Banner", isActive: true }]).material).toEqual({ state: "resolved", materialId: "m1", label: "13oz Banner" });
    expect(resolveCanonicalProductMaterialProposal("Vinyl", [{ id: "m1", label: "Vinyl", isActive: true }, { id: "m2", label: "VINYL", isActive: true }]).material).toMatchObject({ state: "unresolved", requestedLabel: "Vinyl", candidates: [{ id: "m1" }, { id: "m2" }] });
    expect(resolveCanonicalProductMaterialProposal("Missing", [{ id: "m1", label: "Retired", isActive: false }]).material).toEqual({ state: "unresolved", requestedLabel: "Missing", candidates: [] });
  });

  it("assigns and clears an active tenant Material with a consistent audit/result contract", async () => {
    const state = fixture(); const service = new CanonicalProductMaterialOperations(state.store as any);
    const proposal = await service.propose({ organizationId: "org_1", productId: "product_1", material: resolved() });
    const assigned = await service.execute({ organizationId: "org_1", actorUserId: "admin_1", productId: "product_1", material: resolved(), expectedUpdatedAt: proposal.expectedUpdatedAt, auditContext: { source: "assistant_go", reference: "plan_1" } });
    expect(assigned).toMatchObject({ operationReference: "products.update_material_configuration.v1", auditReference: "plan_1", appliedChanges: [{ field: "primaryMaterialId", before: null, after: "material_1" }] });
    const cleared = await service.execute({ organizationId: "org_1", actorUserId: "admin_1", productId: "product_1", material: canonicalProductMaterialProposalFromReference({ state: "explicitly_unset" }), auditContext: { source: "product_editor", reference: "route_1" } });
    expect(cleared.appliedChanges[0]).toEqual({ field: "primaryMaterialId", before: "material_1", after: null });
    expect(state.writes).toEqual([{ materialId: "material_1", actorUserId: "admin_1", auditReference: "plan_1" }, { materialId: null, actorUserId: "admin_1", auditReference: "route_1" }]);
  });

  it("fails closed for tenant mismatch, inactive/unresolved references, missing actor, and stale state", async () => {
    const state = fixture(); const service = new CanonicalProductMaterialOperations(state.store as any);
    await expect(service.propose({ organizationId: "org_2", productId: "product_1", material: resolved() })).rejects.toMatchObject({ code: "PRODUCT_NOT_FOUND" });
    await expect(service.propose({ organizationId: "org_1", productId: "product_1", material: resolved("cross_tenant", "Other") })).rejects.toMatchObject({ code: "MATERIAL_NOT_FOUND" });
    await expect(service.propose({ organizationId: "org_1", productId: "product_1", material: resolved("inactive_1", "Retired Banner") })).rejects.toMatchObject({ code: "MATERIAL_INACTIVE" });
    await expect(service.propose({ organizationId: "org_1", productId: "product_1", material: resolveCanonicalProductMaterialProposal("Unknown", []) })).rejects.toMatchObject({ code: "MATERIAL_UNRESOLVED" });
    await expect(service.execute({ organizationId: "org_1", actorUserId: "", productId: "product_1", material: resolved() })).rejects.toMatchObject({ code: "ACTOR_REQUIRED" });
    await expect(service.execute({ organizationId: "org_1", actorUserId: "admin_1", productId: "product_1", material: resolved(), expectedUpdatedAt: "2026-01-01T00:00:00.000Z" })).rejects.toMatchObject({ code: "PRODUCT_MATERIAL_STALE" });
    expect(state.writes).toHaveLength(0);
  });

  it("preserves an unchanged inactive historical assignment while rejecting a new inactive assignment", async () => {
    const historical = fixture("inactive_1");
    await expect(new CanonicalProductMaterialOperations(historical.store as any).execute({ organizationId: "org_1", actorUserId: "admin_1", productId: "product_1", material: resolved("inactive_1", "Retired Banner") })).resolves.toMatchObject({ appliedChanges: [] });
    expect(historical.writes).toHaveLength(0);
    const newAssignment = fixture();
    await expect(new CanonicalProductMaterialOperations(newAssignment.store as any).execute({ organizationId: "org_1", actorUserId: "admin_1", productId: "product_1", material: resolved("inactive_1", "Retired Banner") })).rejects.toMatchObject({ code: "MATERIAL_INACTIVE" });
  });

  it("surfaces conditional-write conflicts and repository rollback without reporting a material change", async () => {
    const state = fixture();
    const stale = new CanonicalProductMaterialOperations({ ...state.store, update: async () => null } as any);
    await expect(stale.execute({ organizationId: "org_1", actorUserId: "admin_1", productId: "product_1", material: resolved(), expectedUpdatedAt: state.current().updatedAt.toISOString() })).rejects.toBeInstanceOf(CanonicalProductMaterialError);
    const rollback = new CanonicalProductMaterialOperations({ ...state.store, update: async () => { throw new Error("audit insert failed"); } } as any);
    await expect(rollback.execute({ organizationId: "org_1", actorUserId: "admin_1", productId: "product_1", material: resolved() })).rejects.toThrow("audit insert failed");
    expect(state.current().primaryMaterialId).toBeNull();
  });

  it("keeps Product Editor routing and the generated architecture report bound to the canonical operation", async () => {
    const route = await readFile(path.resolve(process.cwd(), "server/routes/products.routes.ts"), "utf8");
    expect(route).toContain("takeCanonicalProductMaterialChange(productData)");
    expect(route).toContain("canonicalProductMaterialOperations.execute");
    await expect(readFile(path.resolve(process.cwd(), "docs/architecture/canonical-product-material-migration.md"), "utf8")).resolves.toBe(renderCanonicalProductMaterialMigrationMarkdown());
  });
});
