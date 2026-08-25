import { readFileSync } from "node:fs";
import { canTakePaymentFromInvoiceList, getInvoiceListTakePaymentPath } from "@/lib/invoiceListPayment";
import type { InvoiceListItem } from "@/hooks/useInvoices";

const invoicesPageSource = readFileSync("client/src/pages/invoices.tsx", "utf8");

const invoice = (overrides: Partial<InvoiceListItem> = {}): InvoiceListItem => ({
  id: "invoice-1",
  invoiceNumber: "INV-1001",
  status: "sent",
  total: "125.00",
  amountPaid: "25.00",
  balanceDue: "100.00",
  displayRemaining: 100,
  displayTotal: 125,
  displayPaid: 25,
  emailStatus: "sent_current",
  customerName: "Acme Signs",
  companyName: "Acme Signs",
  contactName: null,
  contactEmail: null,
  orderNumber: null,
  orderName: null,
  jobName: null,
  purchaseOrderNumber: null,
  lastSentAt: null,
  lastInvoiceEmailRecipient: null,
  reminderStatus: "not_due",
  lastReminderSentAt: null,
  lastReminderRecipient: null,
  nextReminderDueAt: null,
  ...overrides,
} as InvoiceListItem);

describe("Invoices List payment entry point", () => {
  it("shows the Take Payment action for an eligible invoice", () => {
    expect(canTakePaymentFromInvoiceList(invoice())).toBe(true);
    expect(invoicesPageSource).toContain("Take Payment");
  });

  it("routes Take Payment to the canonical invoice detail workflow", () => {
    expect(getInvoiceListTakePaymentPath("invoice-123")).toBe("/invoices/invoice-123?takePayment=1");
    expect(invoicesPageSource).toContain("navigate(getInvoiceListTakePaymentPath(invoice.id))");
  });

  it("reopens Take Payment after a refund even when historical status remains paid", () => {
    expect(canTakePaymentFromInvoiceList(invoice({ status: "paid", displayRemaining: 100, balanceDue: "100.00" }))).toBe(true);
  });

  it("does not show Take Payment for void, draft, or zero-balance invoices", () => {
    expect(canTakePaymentFromInvoiceList(invoice({ status: "void" }))).toBe(false);
    expect(canTakePaymentFromInvoiceList(invoice({ status: "draft" }))).toBe(false);
    expect(canTakePaymentFromInvoiceList(invoice({ status: "paid", displayRemaining: 0, balanceDue: "0.00" }))).toBe(false);
  });

  it("no longer renders the legacy Record Payment dialog", () => {
    expect(invoicesPageSource).not.toContain("<Dialog");
    expect(invoicesPageSource).not.toContain("Record Payment");
    expect(invoicesPageSource).not.toContain("payment-amount");
    expect(invoicesPageSource).not.toContain("payment-method");
  });

  it("does not call the manual payment mutation directly from the Invoice List", () => {
    expect(invoicesPageSource).not.toContain("useRecordManualInvoicePayment");
    expect(invoicesPageSource).not.toContain("recordManualPayment");
    expect(invoicesPageSource).not.toContain("submitPayment");
    expect(invoicesPageSource).not.toContain("openPaymentDialog");
  });
});
