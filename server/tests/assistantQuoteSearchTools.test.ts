import { beforeAll, describe, expect, jest, test } from "@jest/globals";
import { isOpenQuoteWorkflowState } from "@shared/quoteWorkflow";

process.env.DATABASE_URL ??= "postgresql://readonly:readonly@127.0.0.1:1/quotevault_test";

let createQuoteSearchTool: typeof import("../services/assistant/quoteSearchTools").createQuoteSearchTool;
let quoteSearchToolInputSchema: typeof import("../services/assistant/quoteSearchTools").quoteSearchToolInputSchema;

beforeAll(async () => {
  ({ createQuoteSearchTool, quoteSearchToolInputSchema } = await import("../services/assistant/quoteSearchTools"));
});

const repository = {
  search: jest.fn(async () => ({
    totalMatchingQuotes: 2,
    quotes: [
      {
        quoteId: "quote_2",
        quoteNumber: "Q-1002",
        customer: { id: "customer_2", name: "Beta Signs", sourceLink: { label: "Beta Signs", href: "/customers/customer_2", entityType: "customer" as const, entityId: "customer_2" } },
        total: 6200,
        status: "sent" as const,
        open: true,
        createdAt: new Date("2026-08-07T12:00:00.000Z"),
        sourceLink: { label: "Quote Q-1002", href: "/quotes/quote_2", entityType: "quote" as const, entityId: "quote_2" },
      },
      {
        quoteId: "quote_1",
        quoteNumber: "Q-1001",
        customer: { id: "customer_1", name: "Acme", sourceLink: { label: "Acme", href: "/customers/customer_1", entityType: "customer" as const, entityId: "customer_1" } },
        total: 5000,
        status: "draft" as const,
        open: true,
        createdAt: new Date("2026-08-06T12:00:00.000Z"),
        sourceLink: { label: "Quote Q-1001", href: "/quotes/quote_1", entityType: "quote" as const, entityId: "quote_1" },
      },
    ],
  })),
};

describe("assistant quote search tool", () => {
  test("accepts a tenant-wide open quote investigation without a customer or internal ID", async () => {
    const tool = createQuoteSearchTool(repository);
    const result = await tool.execute({ scope: { organizationId: "org_allowed", userId: "user_1" } }, {
      lifecycle: "open",
      sort: "newest",
      limit: 5,
    });

    expect(repository.search).toHaveBeenCalledWith("org_allowed", { lifecycle: "open", sort: "newest", limit: 5 });
    expect(result).toMatchObject({
      status: "success",
      data: {
        totalMatchingQuotes: 2,
        quotes: expect.arrayContaining([expect.objectContaining({ quoteNumber: "Q-1002", customer: expect.objectContaining({ name: "Beta Signs" }), total: 6200, status: "sent", open: true })]),
        appliedFilters: { lifecycle: "open", recencyField: "createdAt", sentAtAvailable: false },
      },
    });
    expect(result.sourceLinks).toEqual([
      expect.objectContaining({ recordId: "quote_2", route: "/quotes/quote_2" }),
      expect.objectContaining({ recordId: "quote_1", route: "/quotes/quote_1" }),
    ]);
  });

  test("keeps customer scope optional while allowing a named-customer investigation", async () => {
    const tool = createQuoteSearchTool(repository);
    await tool.execute({ scope: { organizationId: "org_allowed", userId: "user_1" } }, { customer: "Acme", lifecycle: "open" });
    expect(repository.search).toHaveBeenLastCalledWith("org_allowed", { customer: "Acme", lifecycle: "open" });
  });

  test("returns a normal successful zero-result envelope", async () => {
    const empty = { search: jest.fn(async () => ({ totalMatchingQuotes: 0, quotes: [] })) };
    const result = await createQuoteSearchTool(empty).execute({ scope: { organizationId: "org_allowed", userId: "user_1" } }, { lifecycle: "open" });
    expect(result).toMatchObject({ status: "success", data: { totalMatchingQuotes: 0, quotes: [] } });
    expect(result.sourceLinks).toEqual([]);
  });

  test("uses the shared lifecycle definition and rejects conflicting raw status filters", () => {
    expect(isOpenQuoteWorkflowState("draft")).toBe(true);
    expect(isOpenQuoteWorkflowState("pending_approval")).toBe(true);
    expect(isOpenQuoteWorkflowState("sent")).toBe(true);
    expect(isOpenQuoteWorkflowState("approved")).toBe(false);
    expect(isOpenQuoteWorkflowState("expired")).toBe(false);
    expect(() => quoteSearchToolInputSchema.parse({ lifecycle: "open", status: "sent" })).toThrow();
  });
});
