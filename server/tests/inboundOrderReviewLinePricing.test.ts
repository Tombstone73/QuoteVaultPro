import { beforeEach, describe, expect, jest, test } from "@jest/globals";

jest.unstable_mockModule("../storage/inboundOrders.repo", () => ({
  inboundOrdersRepository: {},
}));

jest.unstable_mockModule("../storage/orders.repo", () => ({
  OrdersRepository: jest.fn().mockImplementation(() => ({})),
}));

jest.unstable_mockModule("../services/pricing/PricingService", () => ({
  priceLineItem: jest.fn(),
}));

jest.unstable_mockModule("../services/inboundOrders/CustomerIntelligenceService", () => ({
  CustomerIntelligenceService: jest.fn().mockImplementation(() => ({})),
  customerIntelligenceService: {},
}));

const { InboundOrderService } = await import("../services/inboundOrders/InboundOrderService");

const mockPriceLineItem = jest.fn<(...args: any[]) => Promise<any>>();

function makeRepository() {
  return {
    getProduct: jest.fn(async (_organizationId: string, productId: string) => (
      productId === "product_pvc"
        ? {
            id: "product_pvc",
            name: "PVC Signs",
            measurementMode: "dimensions_required",
            pricingProfileKey: "sheet",
          }
        : null
    )),
    getProductActivePbv2Tree: jest.fn(async () => ({
      product: { id: "product_pvc", name: "PVC Signs", pbv2ActiveTreeVersionId: "tree_pvc" },
      activeTree: null,
    })),
  };
}

describe("InboundOrderService review line pricing", () => {
  beforeEach(() => {
    mockPriceLineItem.mockReset();
    mockPriceLineItem.mockResolvedValue({
      lineTotalCents: 4500,
      breakdown: { totalCents: 4500 },
    });
  });

  test("prices a single edited review line through canonical pricing and preserves manual override", async () => {
    const repo = makeRepository();
    const service = new InboundOrderService(repo as any, undefined as any, mockPriceLineItem);

    const review = await service.priceReviewLine({
      organizationId: "org_1",
      lineItem: {
        sourceLineItemId: "line_1",
        sourceText: "3 PVC Signs 24x36",
        productName: "PVC Signs",
        selectedProductId: "product_pvc",
        selectedProductSource: "staff_selected",
        quantity: 3,
        quantitySource: "staff_selected",
        width: 24,
        height: 36,
        dimensionsUnit: "in",
        dimensionsSource: "staff_selected",
        materialText: "3mm White PVC",
        printSpecs: [],
        optionTexts: [],
        finishingTexts: [],
        optionSelectionsJson: {
          schemaVersion: 2,
          selected: {
            thickness: { value: "3mm_white", origin: "USER_SELECTED" },
          },
        },
        pbv2TreeVersionId: "tree_pvc",
        pricingReviewJson: {
          status: "mismatch",
          message: "Previous pricing failed.",
          acknowledged: false,
          resolution: null,
          resolutionNote: null,
          poPriceCents: null,
          poUnitPriceCents: null,
          poExtendedPriceCents: null,
          poRushFeesCents: null,
          poTotalPriceCents: null,
          systemPriceCents: null,
          systemUnitPriceCents: null,
          differenceCents: null,
          comparisonType: null,
          sourceEvidence: [],
          alternatePricingNotes: [],
          evaluatedAt: null,
          priceOverrideMode: "override_total_after_margin",
          priceOverrideValueCents: 5100,
          priceOverrideSource: "staff",
          effectiveUnitPriceCents: 1700,
          effectiveTotalCents: 5100,
        },
        artworkLinks: [],
        artworkQuantityMode: "same_quantity_each",
        notes: null,
      },
    });

    expect(mockPriceLineItem).toHaveBeenCalledWith(expect.objectContaining({
      organizationId: "org_1",
      productId: "product_pvc",
      quantity: 3,
      widthIn: 24,
      heightIn: 36,
      pbv2TreeVersionIdOverride: "tree_pvc",
      pbv2ExplicitSelections: expect.objectContaining({ thickness: expect.objectContaining({ value: "3mm_white" }) }),
    }));
    expect(review).toMatchObject({
      systemPriceCents: 4500,
      systemUnitPriceCents: 1500,
      priceOverrideMode: "override_total_after_margin",
      priceOverrideValueCents: 5100,
      priceOverrideSource: "staff",
      effectiveTotalCents: 5100,
      effectiveUnitPriceCents: 1700,
    });
  });

  test("normalizes feet and applies whole-foot square-foot billing before canonical pricing", async () => {
    const repo = makeRepository();
    repo.getProduct.mockResolvedValue({
      id: "product_banner",
      name: "Banner",
      measurementMode: "dimensions_required",
      pricingProfileKey: "default",
    });
    mockPriceLineItem.mockImplementation(async (input) => ({
      lineTotalCents: ((input.widthIn * input.heightIn) / 144) * input.quantity * 100,
      breakdown: { totalCents: ((input.widthIn * input.heightIn) / 144) * input.quantity * 100 },
    }));
    const service = new InboundOrderService(repo as any, undefined as any, mockPriceLineItem);

    const review = await service.priceReviewLine({
      organizationId: "org_1",
      lineItem: {
        sourceLineItemId: "line_1",
        sourceText: "2 banners 3 x 8 ft",
        productName: "Banner",
        selectedProductId: "product_banner",
        selectedProductSource: "staff_selected",
        quantity: 2,
        quantitySource: "staff_selected",
        width: 3,
        height: 8,
        dimensionsUnit: "ft",
        dimensionsSource: "staff_selected",
        printSpecs: [],
        optionTexts: [],
        finishingTexts: [],
        optionSelectionsJson: null,
        pbv2TreeVersionId: null,
        pricingReviewJson: null,
        artworkLinks: [],
      },
    });

    expect(mockPriceLineItem).toHaveBeenCalledWith(expect.objectContaining({
      quantity: 2,
      widthIn: 36,
      heightIn: 96,
    }));
    // 3 ft × 8 ft = 24 billable sq ft, multiplied by two items at $1/sq ft.
    expect(review).toMatchObject({ systemPriceCents: 4800, systemUnitPriceCents: 2400 });
  });

  test("single-line pricing fails closed when product selection is missing", async () => {
    const repo = makeRepository();
    const service = new InboundOrderService(repo as any, undefined as any, mockPriceLineItem);

    const review = await service.priceReviewLine({
      organizationId: "org_1",
      lineItem: {
        sourceLineItemId: "line_1",
        sourceText: "3 PVC Signs",
        productName: null,
        selectedProductId: null,
        quantity: 3,
        width: 24,
        height: 36,
        printSpecs: [],
        optionTexts: [],
        finishingTexts: [],
        pricingReviewJson: null,
        artworkLinks: [],
      },
    });

    expect(mockPriceLineItem).not.toHaveBeenCalled();
    expect(review).toMatchObject({
      status: "not_available",
      message: "Select a catalog product before calculating price.",
      systemPriceCents: null,
      effectiveTotalCents: 0,
    });
  });
});
