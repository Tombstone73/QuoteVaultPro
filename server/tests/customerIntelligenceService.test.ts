import { describe, expect, jest, test } from "@jest/globals";

import { CustomerIntelligenceService } from "../services/inboundOrders/CustomerIntelligenceService";

function makeRepository(overrides: Record<string, any> = {}) {
  return {
    getCustomer: jest.fn(async (_organizationId: string, customerId: string) => (
      customerId === "customer_1"
        ? { id: "customer_1", companyName: "Brainstorm Print", email: "billing@brainstormprint.com" }
        : null
    )),
    searchCustomers: jest.fn(async (_organizationId: string, search: string | null) => {
      const value = String(search ?? "").toLowerCase();
      if (value.includes("brainstormprint.com") || value.includes("brainstorm")) {
        return [{ id: "customer_1", companyName: "Brainstorm Print", email: "billing@brainstormprint.com", phone: null, status: "active" }];
      }
      return [];
    }),
    listCustomerHistoricalContext: jest.fn(async () => [
      {
        sourceType: "order",
        sourceId: "order_1",
        reference: "1001",
        createdAt: "2026-05-10T12:00:00.000Z",
        productId: "product_pvc",
        productName: "PVC Signs",
        description: "Lobby PVC signs with contour cutting",
        width: "24.00",
        height: "36.00",
        quantity: 3,
        specsJson: { material: "3mm White PVC", finishing: "Contour Cutting" },
        optionSelectionsJson: { selected: { thickness: { value: "3mm White PVC" } } },
        selectedOptions: [{ optionName: "Contour Cutting", value: "No" }],
        materialUsages: [{ materialName: "3mm White PVC" }],
        materialUsageJson: null,
      },
      {
        sourceType: "quote",
        sourceId: "quote_1",
        reference: "Q-250",
        createdAt: "2026-04-01T12:00:00.000Z",
        productId: "product_pvc",
        productName: "PVC Signs",
        description: "Repeat PVC lobby sign",
        width: "24.00",
        height: "36.00",
        quantity: 1,
        specsJson: { stock: "3mm White PVC" },
        optionSelectionsJson: null,
        selectedOptions: [],
        materialUsages: [],
        materialUsageJson: null,
      },
    ]),
    ...overrides,
  };
}

describe("CustomerIntelligenceService", () => {
  test("generates compact customer history summaries from recent orders and quotes", async () => {
    const repo = makeRepository();
    const service = new CustomerIntelligenceService(repo as any, { scopeMonths: 24, maxRecords: 25 });

    const summary = await service.buildSummary({
      organizationId: "org_1",
      customerId: "customer_1",
    });

    expect(summary).toMatchObject({
      customer: { id: "customer_1", companyName: "Brainstorm Print" },
      scopeMonths: 24,
      maxRecords: 25,
      recordCount: 2,
    });
    expect(summary?.frequentProducts).toEqual([
      expect.objectContaining({ productId: "product_pvc", label: "PVC Signs", count: 2 }),
    ]);
    expect(summary?.frequentMaterials).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: "3mm White PVC", count: 2 }),
    ]));
    expect(summary?.frequentDimensions).toEqual([
      expect.objectContaining({ label: "24x36", count: 2 }),
    ]);
    expect(summary?.frequentFinishing).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: "Contour Cutting", count: 1 }),
    ]));
    expect(summary?.recentOrderReferences).toEqual(expect.arrayContaining([
      expect.objectContaining({ sourceType: "order", reference: "1001", productSummary: "PVC Signs" }),
      expect.objectContaining({ sourceType: "quote", reference: "Q-250", productSummary: "PVC Signs" }),
    ]));
  });

  test("bounds long historical display summaries without changing the source rows", async () => {
    const longProduct = `  Premium Display ${"x".repeat(300)}  `;
    const longMaterial = `  Material ${"m".repeat(300)}  `;
    const longFinish = `  Finish ${"f".repeat(300)}  `;
    const longReference = `REF-${"r".repeat(200)}`;
    const row = {
      sourceType: "order",
      sourceId: "order_long",
      reference: longReference,
      createdAt: "2026-05-11T12:00:00.000Z",
      productId: null,
      productName: null,
      description: longProduct,
      width: null,
      height: null,
      quantity: 1,
      specsJson: { material: longMaterial },
      optionSelectionsJson: null,
      selectedOptions: [{ optionName: "Finishing", value: longFinish }],
      materialUsages: [],
      materialUsageJson: null,
    };
    const repo = makeRepository({ listCustomerHistoricalContext: jest.fn(async () => [row]) });
    const service = new CustomerIntelligenceService(repo as any, { scopeMonths: 24, maxRecords: 25 });

    const summary = await service.buildSummary({ organizationId: "org_1", customerId: "customer_1" });

    expect(summary?.recentProducts[0].label).toHaveLength(255);
    expect(summary?.recentProducts[0].label.endsWith("…")).toBe(true);
    expect(summary?.frequentProducts[0].label).toHaveLength(255);
    expect(summary?.frequentMaterials[0].label).toHaveLength(255);
    expect(summary?.frequentFinishing[0].label).toHaveLength(255);
    expect(summary?.commonTerminology[0].term.length).toBeLessThanOrEqual(120);
    expect(summary?.recentOrderReferences[0]).toMatchObject({
      reference: expect.any(String),
      productSummary: expect.any(String),
    });
    expect(summary?.recentOrderReferences[0].reference.length).toBeLessThanOrEqual(120);
    expect(summary?.recentOrderReferences[0].productSummary?.length).toBeLessThanOrEqual(255);
    expect(row.description).toBe(longProduct);
    expect(row.reference).toBe(longReference);
    expect(row.specsJson.material).toBe(longMaterial);
  });

  test("resolves one strong customer from inbound source evidence before generating context", async () => {
    const repo = makeRepository();
    const service = new CustomerIntelligenceService(repo as any, { scopeMonths: 24, maxRecords: 25 });

    const summary = await service.buildSummaryForSourceEvidence({
      organizationId: "org_1",
      senderEmail: "shawn@brainstormprint.com",
      senderName: "Shawn Fears",
    });

    expect(summary?.customer.id).toBe("customer_1");
    expect(repo.searchCustomers).toHaveBeenCalledWith("org_1", "shawn@brainstormprint.com", 5);
    expect(repo.listCustomerHistoricalContext).toHaveBeenCalledWith(expect.objectContaining({
      organizationId: "org_1",
      customerId: "customer_1",
      maxRecords: 25,
    }));
  });

  test("returns no context when no customer can be resolved", async () => {
    const repo = makeRepository({
      searchCustomers: jest.fn(async () => []),
    });
    const service = new CustomerIntelligenceService(repo as any, { scopeMonths: 24, maxRecords: 25 });

    const summary = await service.buildSummaryForSourceEvidence({
      organizationId: "org_1",
      senderEmail: "unknown@example.com",
    });

    expect(summary).toBeNull();
    expect(repo.listCustomerHistoricalContext).not.toHaveBeenCalled();
  });
});
