import { describe, expect, test } from "@jest/globals";

process.env.DATABASE_URL ??= "postgresql://readonly:readonly@127.0.0.1:1/quotevault_test";

let createQuoteDetailTool: typeof import("../services/assistant/quoteDetailTools").createQuoteDetailTool;
beforeAll(async () => ({ createQuoteDetailTool } = await import("../services/assistant/quoteDetailTools")));

describe("assistant quote detail tool", () => {
  test("returns bounded quote items and an authoritative no-related-order state", async () => {
    const repository = {
      getQuoteById: async () => ({
        id: "quote_1", displayNumber: "QT-910322", numberCore: 910322, quoteNumber: 910322, status: "pending", validUntil: null, totalPrice: "125.50", createdAt: new Date("2026-08-07T12:00:00.000Z"),
        customerName: "Acme Signs", customer: { id: "customer_1", companyName: "Acme Signs" }, contact: { firstName: "Ada", lastName: "Lovelace", email: "ada@example.test", phone: "555-0100" },
        lineItems: [{ id: "line_1", description: "Window graphic", productName: "Translucent Vinyl", quantity: 2, width: "24", height: "36", selectedOptions: [{ optionName: "Layers", value: "3" }] }],
      }),
      getRelatedOrderForQuote: async () => null,
    } as any;
    const result = await createQuoteDetailTool(repository).execute({ scope: { organizationId: "org_1", userId: "user_1" } }, { quoteId: "quote_1" });
    expect(result).toMatchObject({ status: "success", data: { quote: { recordId: "quote_1", label: "Quote QT-910322" }, total: 125.5, status: "sent", customer: { recordId: "customer_1" }, contact: { name: "Ada Lovelace" }, lineItems: [{ id: "line_1", description: "Window graphic", quantity: 2, dimensions: { widthInches: 24, heightInches: 36 }, options: ["Layers: 3"] }], relatedOrder: { state: "none" } } });
  });

  test("uses only an authoritative quote relationship and returns the linked order reference", async () => {
    const repository = {
      getQuoteById: async () => ({ id: "quote_2", displayNumber: "QT-2", numberCore: null, quoteNumber: 2, status: "active", validUntil: null, totalPrice: "0", createdAt: new Date("2026-08-07T12:00:00.000Z"), customerName: "Walk-in", customer: undefined, contact: undefined, lineItems: [] }),
      getRelatedOrderForQuote: async () => ({ id: "order_2", displayNumber: "ORD-2", orderNumber: "2" }),
    } as any;
    const result = await createQuoteDetailTool(repository).execute({ scope: { organizationId: "org_1", userId: "user_1" } }, { quoteId: "quote_2" });
    expect(result.data.relatedOrder).toMatchObject({ state: "linked", order: { recordId: "order_2", sourceLink: { href: "/orders/order_2" } } });
    expect(result.data.status).toBe("converted");
  });

  test("keeps tenant authority at the repository boundary", async () => {
    const calls: unknown[] = [];
    const repository = { getQuoteById: async (...args: unknown[]) => { calls.push(args); return undefined; }, getRelatedOrderForQuote: async () => null } as any;
    const result = await createQuoteDetailTool(repository).execute({ scope: { organizationId: "org_allowed", userId: "user_1" } }, { quoteId: "quote_other_org" });
    expect(calls).toEqual([["org_allowed", "quote_other_org"]]);
    expect(result).toMatchObject({ status: "not_found", sourceLinks: [] });
  });
});
