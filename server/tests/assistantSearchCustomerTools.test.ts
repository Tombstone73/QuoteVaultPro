import { describe, expect, jest, test } from "@jest/globals";
import { assistantEntitySummarySchema } from "@shared/assistantContracts";
import {
  createCustomerSummaryTool,
  createSearchGlobalTool,
  customerSummaryToolInputSchema,
  searchGlobalToolInputSchema,
} from "../services/assistant/searchCustomerTools";
import { escapeAssistantSearchTerm } from "../storage/assistantSearchCustomer.repo";

const invocation = {
  scope: { organizationId: "org_allowed", userId: "user_1" },
  correlationId: "correlation_1",
};

const repository = {
  search: jest.fn(async () => [
    {
      entityType: "customer" as const,
      recordId: "customer_1",
      displayLabel: "OTB Graphics",
      secondaryDescription: "hello@otb.test",
      status: "active",
      route: "/customers/customer_1",
      freshness: new Date("2026-07-21T12:00:00.000Z"),
    },
    {
      entityType: "order" as const,
      recordId: "order_1",
      displayLabel: "Order 16309",
      secondaryDescription: "OTB Graphics",
      status: "in_production",
      route: "/orders/order_1",
      freshness: new Date("2026-07-21T11:00:00.000Z"),
    },
  ]),
  searchByEntity: jest.fn(async (_organizationId: string, query: string, _limit: number, entityType: "customer" | "product") => [{
    entityType,
    recordId: `${entityType}_1`,
    displayLabel: entityType === "customer" ? query : "Economy Yard Sign Stakes",
    secondaryDescription: entityType === "customer" ? "hello@otb.test" : "Yard signs",
    status: "active",
    route: entityType === "customer" ? "/customers/customer_1" : "/products/product_1/edit",
    freshness: new Date("2026-07-21T12:00:00.000Z"),
  }]),
  getCustomerSummary: jest.fn(async () => ({
    id: "customer_1",
    companyName: "OTB Graphics",
    isActive: true,
    status: "active",
    route: "/customers/customer_1",
    freshness: new Date("2026-07-21T12:00:00.000Z"),
    contacts: [{
      id: "contact_1",
      name: "Ada Lovelace",
      title: "Buyer",
      email: "ada@otb.test",
      phone: null,
      isPrimary: true,
      route: "/contacts/contact_1",
      freshness: new Date("2026-07-21T11:00:00.000Z"),
    }],
    recentActivity: [{
      kind: "order" as const,
      id: "order_1",
      displayNumber: "Order 16309",
      status: "in_production",
      route: "/orders/order_1",
      freshness: new Date("2026-07-21T10:00:00.000Z"),
    }],
  })),
};

describe("Stage 2 customer/search assistant tools", () => {
  test("validates bounded search input and escapes SQL wildcard metacharacters", () => {
    expect(searchGlobalToolInputSchema.parse({ query: "OTB" }).maxResultsPerCategory).toBe(5);
    expect(() => searchGlobalToolInputSchema.parse({ query: "x" })).toThrow();
    expect(() => searchGlobalToolInputSchema.parse({ query: "OTB", maxResultsPerCategory: 6 })).toThrow();
    expect(escapeAssistantSearchTerm("100%_ready\\now")).toBe("100\\%\\_ready\\\\now");
  });

  test("retains contact records in the shared global-search DTO contract", () => {
    expect(assistantEntitySummarySchema.parse({
      entityType: "contact",
      recordId: "contact_1",
      label: "Ada Lovelace",
      sourceLink: { label: "Ada Lovelace", href: "/contacts/contact_1", entityType: "contact", entityId: "contact_1" },
      freshness: "2026-07-21T12:00:00.000Z",
    })).toMatchObject({ entityType: "contact" });
  });

  test("search.global passes only trusted organization scope and returns fixed safe source links", async () => {
    const tool = createSearchGlobalTool(repository);

    const result = await tool.execute(invocation, { query: "OTB", maxResultsPerCategory: 3, organizationId: "org_other" }).catch((error: unknown) => error);
    // Strict schemas reject provider attempts to smuggle identity fields.
    expect(result).toBeInstanceOf(Error);

    const validResult = await tool.execute(invocation, { query: "OTB", maxResultsPerCategory: 3 });
    expect(repository.search).toHaveBeenCalledWith("org_allowed", "OTB", 3);
    expect(validResult.status).toBe("success");
    expect(validResult.sourceLinks).toEqual([
      { recordId: "customer_1", route: "/customers/customer_1", label: "OTB Graphics" },
      { recordId: "order_1", route: "/orders/order_1", label: "Order 16309" },
    ]);
  });

  test.each([
    ["customer", "T3 Signs", "/customers/customer_1"],
    ["product", "Economy Yard Sign Stakes", "/products/product_1/edit"],
  ] as const)("uses a dedicated bounded tenant-safe %s lookup when deterministic routing supplies the entity type", async (entityType, query, route) => {
    const tool = createSearchGlobalTool(repository);
    repository.search.mockClear();
    repository.searchByEntity.mockClear();

    const result = await tool.execute(invocation, { query, entityType, maxResultsPerCategory: 3 });

    expect(repository.searchByEntity).toHaveBeenCalledWith("org_allowed", query, 3, entityType);
    expect(repository.search).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      status: "success",
      data: { results: [expect.objectContaining({ entityType, route })] },
    });
  });

  test("customers.get_summary omits finance and internal fields even when the caller asks for them", async () => {
    const tool = createCustomerSummaryTool(repository);
    const result = await tool.execute(invocation, { customerId: "customer_1" });

    expect(repository.getCustomerSummary).toHaveBeenCalledWith("org_allowed", "customer_1", 5);
    expect(result.status).toBe("success");
    if (result.status !== "success") throw new Error("Expected customer result");
    expect(result.data).not.toHaveProperty("currentBalance");
    expect(result.data).not.toHaveProperty("invoices");
    expect(result.data.customer).not.toHaveProperty("taxExemptCertificateRef");
    expect(result.data.customer).not.toHaveProperty("creditLimit");
    expect(result.data.customer).not.toHaveProperty("pricingTier");
    expect(result.data.customer).not.toHaveProperty("isTaxExempt");
    expect(result.sourceLinks).toEqual(expect.arrayContaining([
      { recordId: "customer_1", route: "/customers/customer_1", label: "OTB Graphics" },
      { recordId: "contact_1", route: "/contacts/contact_1", label: "Ada Lovelace" },
    ]));
  });

  test("customer lookups use the same safe not-found envelope for missing and cross-tenant records", async () => {
    const notFoundRepository = { ...repository, getCustomerSummary: jest.fn(async () => null) };
    const tool = createCustomerSummaryTool(notFoundRepository);
    const result = await tool.execute(invocation, { customerId: "customer_other_org" });

    expect(result).toMatchObject({ status: "not_found", data: { customerId: "customer_other_org" }, sourceLinks: [] });
    expect(notFoundRepository.getCustomerSummary).toHaveBeenCalledWith("org_allowed", "customer_other_org", 5);
  });

  test("customer ID input rejects empty or untrusted identity-shaped values", () => {
    expect(() => customerSummaryToolInputSchema.parse({ customerId: "" })).toThrow();
    expect(() => customerSummaryToolInputSchema.parse({ customerId: "customer 1" })).toThrow();
    expect(() => customerSummaryToolInputSchema.parse({ customerId: "customer_1", organizationId: "org_other" })).toThrow();
  });
});
