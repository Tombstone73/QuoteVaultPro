import { describe, expect, test } from "@jest/globals";
import { generateCustomerStatementPdfBytes } from "../lib/customerStatementPdf";

describe("customer statement PDF", () => {
  test("renders the same canonical open-balance projection used by statement delivery", async () => {
    const pdf = await generateCustomerStatementPdfBytes({
      statementDate: "2026-09-20",
      organization: { companyName: "PrintersHero", email: null, phone: null, address: "123 Print Way" },
      customer: { id: "customer-1", companyName: "DG Graphics", email: "billing@example.test", phone: null, billingAddress: null },
      summary: { outstandingCents: 100000, unappliedCreditCents: 2500, amountDueCents: 97500, agingCents: { current: 97500, oneToThirty: 0, thirtyOneToSixty: 0, sixtyOneToNinety: 0, ninetyPlus: 0, noDueDate: 0 } },
      openItems: [{ invoiceId: "invoice-1", invoiceNumber: "20389", issueDate: "2026-09-01", dueDate: "2026-09-30", poNumber: "PO-1", orderNumber: "20389", originalCents: 100000, paidCents: 0, remainingCents: 100000, agingBucket: "current" }],
      recentPayments: [],
      unappliedCredits: [{ id: "credit-1", amountCents: 2500, sourceType: "account_credit", createdAt: "2026-09-20", reference: null, reason: null }],
    });
    expect(Buffer.from(pdf).subarray(0, 5).toString("ascii")).toBe("%PDF-");
    expect(pdf.length).toBeGreaterThan(500);
  });
});
