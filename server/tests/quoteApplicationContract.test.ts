import { describe, expect, test } from "@jest/globals";
import { quoteCreateRequestSchema, createInputSchema } from "../services/assistant/quoteApplicationContract";
import { assistantStructuredCardSchema } from "@shared/assistantContracts";
import { deepSeekFunctionParameters } from "../services/ai/providers/configuredProvider";

const sevenLines = Array.from({ length: 7 }, (_, index) => ({
  productId: `product-${index + 1}`, quantity: index + 1, width: 24, height: 18,
  optionSelections: { thickness: index % 2 ? "10mm" : "4mm" },
}));

describe("shared Quote application contract", () => {
  test("keeps all seven configurations and PO/date fields in one review request", () => {
    const parsed = quoteCreateRequestSchema.parse({ customerId: "customer-1", contactId: "contact-1", poReference: "152878", shippingInstructions: "Deliver to receiving",
      requestedDueDate: "2026-11-06T17:00:00.000Z", validUntil: "2026-11-20T17:00:00.000Z", lines: sevenLines });
    expect(parsed.lines).toHaveLength(7);
    expect(parsed.lines[1]!.optionSelections).toEqual({ thickness: "10mm" });
    expect(parsed.poReference).toBe("152878");
    expect(parsed.requestedDueDate).toBe("2026-11-06T17:00:00.000Z");
    expect(parsed.shippingInstructions).toBe("Deliver to receiving");
  });

  test("rejects incomplete or silently narrowed Quote requests", () => {
    expect(() => quoteCreateRequestSchema.parse({ customerId: "customer-1", lines: [] })).toThrow();
    expect(() => quoteCreateRequestSchema.parse({ customerId: "customer-1", lines: [{ ...sevenLines[0], overridePriceCents: 1200 }] })).toThrow();
    expect(() => quoteCreateRequestSchema.parse({ customerId: "customer-1", lines: sevenLines, targetQuoteId: "20686" })).toThrow();
    expect(() => quoteCreateRequestSchema.parse({ customerId: "customer-1", lines: sevenLines.slice(0, 6), expectedLineCount: 7 })).toThrow();
  });

  test("persists the detailed Quote review card", () => {
    expect(assistantStructuredCardSchema.parse({ kind: "quote_intake_summary", title: "New Quote preview", summary: "Seven lines", sourceLinks: [], details: {
      customerName: "Brainstorm Print", poReference: "152878", lineItems: sevenLines,
    } })).toMatchObject({ kind: "quote_intake_summary", details: { lineItems: sevenLines } });
  });

  test("the configured provider transport retains the executable Quote line schema", () => {
    const parameters = deepSeekFunctionParameters(createInputSchema as unknown as Record<string, unknown>);
    const lines = (parameters.properties as any).lines;
    expect(parameters.required).toEqual(["customerId", "lines"]);
    expect(lines.items.properties).toMatchObject({ productId: { type: "string" }, quantity: { type: "integer" }, optionSelections: { type: "object" }, overridePriceCents: { type: "integer" } });
  });

  test("the shared catalog exposes the Quote adapter and dispatches validation", async () => {
    const originalUrl = process.env.DATABASE_URL;
    process.env.DATABASE_URL ||= "postgres://localhost:5432/quote_contract_test_not_connected";
    try {
      const { createQuoteApplicationTools } = await import("../services/assistant/quoteApplicationTools");
      const { createApplicationOperationTools } = await import("../services/assistant/applicationOperationTools");
      const adapter = createQuoteApplicationTools().find((tool) => tool.name === "quotes.prepare_create");
      expect(adapter).toBeDefined();
      const [discover, prepare] = createApplicationOperationTools([adapter!]);
      const context = { scope: { organizationId: "org", userId: "user" }, actor: { userId: "user", email: null }, conversationId: "conversation", permissions: ["assistant.quotes.create_draft"], context: {}, correlationId: "correlation", goal: "Quote PO 152878" } as never;
      const listing = await discover!.execute({ arguments: { query: "quote" }, context });
      expect(listing.result?.data).toMatchObject({ operations: [{ name: "quotes.prepare_create", confirmation: "GO after review" }] });
      const rejected = await prepare!.execute({ arguments: { operation: "quotes.prepare_create", arguments: { customerId: "customer", lines: [] } }, context });
      expect(rejected.status).toBe("rejected");
      expect(rejected.failureCode).toBe("quote_create_arguments_invalid");
    } finally {
      if (originalUrl === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = originalUrl;
    }
  });
});
