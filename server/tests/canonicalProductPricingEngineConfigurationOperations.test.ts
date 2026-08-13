import { readFile } from "node:fs/promises";
import path from "node:path";
import { CanonicalProductPricingEngineConfigurationOperations } from "../services/products/canonicalProductPricingEngineConfigurationOperations";

describe("CanonicalProductPricingEngineConfigurationOperations", () => {
  it("proposes and executes the bounded rotation setting with stale protection", async () => {
    let product: any = { id: "product_1", organizationId: "org_1", name: "Coroplast", pricingProfileConfig: { allowRotation: false, sheetWidth: 48, variables: { keep: 1, allow_rotation: true } }, updatedAt: new Date("2026-08-13T00:00:00.000Z") };
    const updates: any[] = [];
    const service = new CanonicalProductPricingEngineConfigurationOperations({
      get: async ({ organizationId }: any) => organizationId === "org_1" ? product : null,
      update: async (input: any) => { if (product.updatedAt.getTime() !== input.expectedUpdatedAt.getTime()) return null; updates.push(input); product = { ...product, pricingProfileConfig: { allowRotation: input.changes.allowRotation, sheetWidth: 48, variables: { keep: 1 } }, updatedAt: new Date("2026-08-13T00:01:00.000Z") }; return product; },
    } as any);
    const proposal = await service.propose({ organizationId: "org_1", productId: "product_1", changes: { allowRotation: true } });
    expect(proposal.appliedChanges).toEqual([{ field: "Allow Rotation / Mixed Sheet Layout", before: false, after: true }]);
    const result = await service.execute({ organizationId: "org_1", actorUserId: "admin_1", productId: "product_1", changes: { allowRotation: true }, expectedUpdatedAt: proposal.expectedUpdatedAt, auditContext: { source: "assistant_go", reference: "plan_1" } });
    expect(result.operationReference).toBe("products.update_pricing_engine_configuration.v1");
    expect(updates[0]).toMatchObject({ organizationId: "org_1", actorUserId: "admin_1", reference: "plan_1", changes: { allowRotation: true } });
    await expect(service.execute({ organizationId: "org_1", actorUserId: "admin_1", productId: "product_1", changes: { allowRotation: false }, expectedUpdatedAt: proposal.expectedUpdatedAt })).rejects.toMatchObject({ code: "PRODUCT_PRICING_ENGINE_STALE" });
    await expect(service.propose({ organizationId: "org_2", productId: "product_1", changes: { allowRotation: false } })).rejects.toMatchObject({ code: "PRODUCT_NOT_FOUND" });
    await expect(service.execute({ organizationId: "org_1", actorUserId: "", productId: "product_1", changes: { allowRotation: false } })).rejects.toMatchObject({ code: "ACTOR_REQUIRED" });
    await expect(readFile(path.resolve(process.cwd(), "server/routes/products.routes.ts"), "utf8")).resolves.toContain("canonicalProductPricingEngineConfigurationOperations.execute");
  });
});
