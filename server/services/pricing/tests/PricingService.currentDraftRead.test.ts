import { jest } from "@jest/globals";
import { loadCurrentPbv2DraftTreeVersion } from "../PricingService";

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
});
