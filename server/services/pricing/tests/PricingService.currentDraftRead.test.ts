import { jest } from "@jest/globals";
import { loadCurrentPbv2DraftTreeVersion, readablePbv2TreeVersionId } from "../PricingService";

describe("current PBV2 DRAFT pricing read", () => {
  test("uses the same latest linked DRAFT selection as the Product Editor", async () => {
    const currentDraft = { id: "draft-current", productId: "product-1", status: "DRAFT" };
    const limit = jest.fn(async () => [currentDraft]);
    const orderBy = jest.fn(() => ({ limit }));
    const where = jest.fn(() => ({ orderBy }));
    const from = jest.fn(() => ({ where }));
    const database = { select: jest.fn(() => ({ from })) } as any;

    const result = await loadCurrentPbv2DraftTreeVersion(
      { organizationId: "org-a", productId: "product-1" },
      database,
    );

    expect(result).toEqual(currentDraft);
    expect(orderBy).toHaveBeenCalledTimes(1);
    expect(limit).toHaveBeenCalledWith(1);
  });

  test("reports no readable DRAFT when the Product Editor has none", async () => {
    const limit = jest.fn(async () => []);
    const database = { select: jest.fn(() => ({ from: jest.fn(() => ({ where: jest.fn(() => ({ orderBy: jest.fn(() => ({ limit })) })) })) })) } as any;

    await expect(loadCurrentPbv2DraftTreeVersion({ organizationId: "org-a", productId: "product-1" }, database)).resolves.toBeNull();
  });

  test("uses the Product Editor's linked DRAFT for an active default-method product with no active pointer", async () => {
    const loadCurrentDraft = jest.fn(async () => ({ id: "draft-current", productId: "product-1", status: "DRAFT" }));

    await expect(readablePbv2TreeVersionId({
      id: "product-1", isActive: true, pricingMethod: "default", pbv2ActiveTreeVersionId: null,
    }, "org-a", loadCurrentDraft)).resolves.toBe("draft-current");

    expect(loadCurrentDraft).toHaveBeenCalledWith({ organizationId: "org-a", productId: "product-1" });
  });
});
