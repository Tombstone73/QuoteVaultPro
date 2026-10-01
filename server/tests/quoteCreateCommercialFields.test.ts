import { describe, expect, jest, test } from "@jest/globals";
jest.unstable_mockModule("../db", () => ({ db: {}, pool: {}, hasQuoteAttachmentPagesTable: () => false }));
const numbering = await import("../services/documentNumberingService");
jest.unstable_mockModule("../services/documentNumberingService", () => ({
  ...numbering,
  allocateJobNumber: async () => 20001,
  isDocumentNumberUniqueViolation: () => false,
  toDocumentNumberConflictError: (error: unknown) => error,
}));
const { QuotesRepository } = await import("../storage/quotes.repo");
const { quotes } = await import("@shared/schema");

describe("new Quote commercial fields", () => {
  test.each(["pickup", "ship", "deliver"])("persists notes, %s fulfillment and canonical totals on first save", async (method) => {
    let saved: any;
    const charge = method === "pickup" ? null : 2500;
    // In-memory DB adapter: no database or storage is accessed.
    const database: any = {
      transaction: async (fn: any) => fn(database),
      insert: (table: unknown) => ({ values: (data: any) => ({ returning: async () => {
        if (table === quotes) { saved = { ...data, id: "q" }; return [saved]; }
        return data.map((line: any, index: number) => ({ ...line, id: `line-${index}` }));
      } }) }),
      select: () => ({ from: () => ({ where: () => {
        const result = Promise.resolve([{ id: "product", settings: {} }]);
        return Object.assign(result, { limit: () => result });
      } }) }),
    };
    const repo = new QuotesRepository(database);
    jest.spyOn(repo as any, "getDesignConfigMap").mockResolvedValue(new Map());
    const result = await repo.createQuote("org", {
      userId: "staff", shippingMethod: method, shippingCents: charge, shippingInstructions: "Internal job notes",
      discountAmount: "10", taxRate: 0.075,
      lineItems: [{ productId: "product", productName: "Banner", width: "24", height: "36", quantity: 100,
        linePrice: "250", isTaxableSnapshot: true, priceBreakdown: {}, selectedOptions: [] }] as any,
    });
    expect(saved).toMatchObject({ shippingMethod: method, shippingInstructions: "Internal job notes", shippingCents: charge,
      subtotal: "250", discountAmount: "10", taxableSubtotal: "240", taxAmount: "18", totalPrice: charge ? "283" : "258" });
    expect(result).toMatchObject(saved);
  });
});
