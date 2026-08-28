import { describe, expect, jest, test } from "@jest/globals";
import { CanonicalProductLifecycleError, CanonicalProductLifecycleOperations } from "../services/products/canonicalProductLifecycleOperations";
import { isolateProductEditorLifecycleChange } from "../../client/src/lib/productEditorLifecycleSave";

const base = { id: "product-1", organizationId: "org-a", name: ".040 Styrene Signs", isActive: false, pbv2ActiveTreeVersionId: null, draftTreeVersionId: null, updatedAt: new Date("2026-08-12T12:00:00.000Z") };
describe("CanonicalProductLifecycleOperations", () => {
  test("an ordinary active Product editor save does not invoke the availability lifecycle", () => {
    expect(isolateProductEditorLifecycleChange({
      isNewProduct: false,
      currentIsActive: true,
      payload: { name: "Banner", isActive: true },
    })).toEqual({ productPayload: { name: "Banner" }, deferredLifecycle: null });
  });

  test("blocks draft-only activation and allows legacy no-tree activation", async () => {
    const blocked = new CanonicalProductLifecycleOperations({ get: jest.fn(async () => ({ ...base, draftTreeVersionId: "draft-1" })), update: jest.fn() } as any);
    await expect(blocked.propose({ organizationId: "org-a", productId: "product-1", isActive: true })).rejects.toMatchObject({ code: "PBV2_DRAFT_MUST_BE_PUBLISHED" });
    const allowed = new CanonicalProductLifecycleOperations({ get: jest.fn(async () => base), update: jest.fn(async (input: any) => ({ ...base, isActive: input.isActive, updatedAt: new Date("2026-08-12T12:01:00.000Z") })) } as any);
    const proposal = await allowed.propose({ organizationId: "org-a", productId: "product-1", isActive: true });
    expect(proposal.operationReference).toBe("products.update_lifecycle.v1");
  });
  test("preserves stale-state rejection", async () => {
    const service = new CanonicalProductLifecycleOperations({ get: jest.fn(async () => base), update: jest.fn() } as any);
    await expect(service.execute({ organizationId: "org-a", actorUserId: "user-a", productId: "product-1", isActive: true, expectedUpdatedAt: "2026-08-11T12:00:00.000Z" })).rejects.toBeInstanceOf(CanonicalProductLifecycleError);
  });
});
