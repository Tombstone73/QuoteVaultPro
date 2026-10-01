import { expect, jest, test } from "@jest/globals";

jest.unstable_mockModule("../db", () => ({ db: {}, pool: {}, hasQuoteAttachmentPagesTable: () => false }));
jest.unstable_mockModule("../storage/productDesignConfig.repo", () => ({
  productDesignConfigRepository: { getByProductId: async () => null },
}));
const { QuotesRepository } = await import("../storage/quotes.repo");
const { quotes, quoteLineItems, products, users } = await import("@shared/schema");
const { buildQuoteLineItemSavePayload } = await import("../../client/src/features/quotes/editor/quoteLineItemSavePayload");

test("canonical line update persists customer description through a fresh Quote read and unrelated edits", async () => {
  // In-memory query adapter exercises the real repository whitelist and read
  // projection. No live database is used, and the API response is not the store.
  let stored: any = { id: "line", quoteId: "q", productId: "product", productName: "Coroplast",
    width: "48", height: "96", quantity: 420, linePrice: "5040", status: "active", displayOrder: 0,
    description: null, productionNotes: "STAFF ONLY", specsJson: {}, selectedOptions: [],
    priceBreakdown: { basePrice: 5040, optionsPrice: 0, total: 5040, formula: "" } };
  const quote = { id: "q", organizationId: "org", userId: "staff", customerId: null, contactId: null };
  const database: any = {
    select: () => ({ from: (table: unknown) => ({ where: () => {
      const rows = table === quoteLineItems ? [stored] : table === quotes ? [quote]
        : table === products ? [{ id: "product", name: "Coroplast" }]
        : table === users ? [{ id: "staff" }] : [];
      const result = Promise.resolve(structuredClone(rows));
      return Object.assign(result, { limit: () => result, orderBy: () => result });
    } }) }),
    update: (table: unknown) => ({ set: (patch: any) => ({ where: () => ({ returning: async () => {
      expect(table).toBe(quoteLineItems);
      stored = { ...stored, ...Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined)) };
      return [structuredClone(stored)];
    } }) }) }),
  };
  const repo = new QuotesRepository(database);
  jest.spyOn(repo as any, "getInboundReviewLinksForQuoteIds").mockResolvedValue(new Map());
  const description = '48" x 96" white corrugated plastic sheets\nCustomer-approved finish';
  await repo.updateLineItem("line", buildQuoteLineItemSavePayload({ ...stored, description } as any) as any);
  const reloaded = await repo.getQuoteById("org", "q");
  expect(reloaded?.lineItems[0].description).toBe(description);
  expect(reloaded?.lineItems[0].productionNotes).toBe("STAFF ONLY");
  await repo.updateLineItem("line", { quantity: 421, width: "49", optionSelectionsJson: { selected: {} }, linePrice: "5052", displayOrder: 2 } as any);
  expect((await repo.getQuoteById("org", "q"))?.lineItems[0].description).toBe(description);
  await repo.updateLineItem("line", { description: null });
  expect((await repo.getQuoteById("org", "q"))?.lineItems[0].description).toBeNull();
});
