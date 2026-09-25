import { describe, expect, test } from "@jest/globals";
import { inflateSync } from "node:zlib";
import { resolveCanonicalInvoiceCustomerOwnership } from "../../shared/invoiceCustomerOwnership";
import { resolveInvoiceBillingParty, toInvoicePdfBillingParty } from "../../shared/invoiceBillingParty";
import { generateInvoicePdfBytes } from "../lib/invoicePdf";
import { getInvoiceBillingOwnerTransitionBlocker } from "../services/orders/invoiceBillingOwnerTransition";

const noHistory = { paymentExists: false, successfulEmailExists: false, deliveryJobExists: false, autoCreatedInvoiceEvidence: true };
const autoCreated = { status: "billed", issuedAt: new Date("2026-08-20"), invoiceVersion: 1, amountPaid: "0.00", qbSyncStatus: "not_synced", syncStatus: "pending" };

describe("Contact-owned Invoice boundary", () => {
  test("Customer-only and Customer-plus-Contact retain Customer billing, while Contact-owned Invoice never inherits a former company", () => {
    expect(resolveCanonicalInvoiceCustomerOwnership({ invoiceCustomerId: "company", linkedOrderId: "order", linkedOrderCustomerId: "company" }).customerId).toBe("company");
    expect(resolveCanonicalInvoiceCustomerOwnership({ invoiceCustomerId: "company", linkedOrderId: "order", linkedOrderCustomerId: "company", linkedOrderContactId: "contact" }).customerId).toBe("company");
    expect(resolveCanonicalInvoiceCustomerOwnership({ invoiceCustomerId: null, invoiceContactId: "contact", linkedOrderId: "order", linkedOrderCustomerId: "former-company" })).toEqual({ customerId: null, contactId: "contact", source: "contact" });
  });

  test("the untouched auto-created Invoice can change owner despite its billed/issuedAt markers", () => {
    expect(getInvoiceBillingOwnerTransitionBlocker(autoCreated, noHistory)).toBeNull();
    expect(getInvoiceBillingOwnerTransitionBlocker({ ...autoCreated, status: 'finalized' }, noHistory)).toBeNull();
    expect(getInvoiceBillingOwnerTransitionBlocker(autoCreated, { ...noHistory, autoCreatedInvoiceEvidence: false })).toMatch(/issued checkpoint/);
  });

  test.each([
    ["sent checkpoint", { lastSentAt: new Date() }, noHistory],
    ["sent email", {}, { ...noHistory, successfulEmailExists: true }],
    ["queued email", {}, { ...noHistory, deliveryJobExists: true }],
    ["payment", {}, { ...noHistory, paymentExists: true }],
    ["paid rollup", { amountPaid: "25.00" }, noHistory],
    ["QuickBooks", { qbInvoiceId: "qb-1" }, noHistory],
    ["approval", { accountingApprovedAt: new Date() }, noHistory],
    ["historical", { isHistorical: true }, noHistory],
  ])("blocks ownership transfer after %s", (_label, update, evidence) => {
    expect(getInvoiceBillingOwnerTransitionBlocker({ ...autoCreated, ...update }, evidence)).not.toBeNull();
  });

  test("Contact billing party preserves name, address, email and phone without fabricating a company", () => {
    const party = resolveInvoiceBillingParty({ contact: { id: "contact", firstName: "Logan", lastName: "Payne", email: "logan@example.test", phone: "555-0100", street1: "4 Main St", city: "Akron", state: "OH" } });
    expect(party).toMatchObject({ kind: "contact", name: "Logan Payne", email: "logan@example.test", phone: "555-0100" });
    expect(toInvoicePdfBillingParty(party)).toMatchObject({ name: "Logan Payne", billingStreet1: "4 Main St" });
    expect(toInvoicePdfBillingParty(party)).not.toHaveProperty("companyName");
  });

  test("Contact-owned Invoice PDF Bill To renders the Contact rather than Unknown customer", async () => {
    const party = resolveInvoiceBillingParty({ contact: { id: "contact", firstName: "Logan", lastName: "Payne", street1: "4 Main St", email: "logan@example.test" } });
    const pdf = await generateInvoicePdfBytes({
      invoice: { invoiceNumber: 12, status: "billed", totalCents: 2500, subtotalCents: 2500, taxCents: 0, shippingCents: 0 },
      customer: toInvoicePdfBillingParty(party),
      companySettings: null,
      paymentSummary: { totalCents: 2500, amountPaidCents: 0, amountDueCents: 2500 },
      lineItems: [{ description: "Sign", quantity: 1, unitPriceCents: 2500, lineTotalCents: 2500 }],
    });
    const raw = Buffer.from(pdf).toString("latin1");
    const contents = [...raw.matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)].map((match) => {
      try { return inflateSync(Buffer.from(match[1], "latin1")).toString("latin1"); }
      catch { return match[1]; }
    }).join("\n");
    const text = contents.replace(/<([0-9A-Fa-f]+)>\s*Tj/g, (_token, hex) => Buffer.from(hex, "hex").toString("latin1"));
    expect(text).toContain("Logan Payne");
    expect(text).toContain("4 Main St");
    expect(text).not.toContain("Unknown customer");
  });
});
