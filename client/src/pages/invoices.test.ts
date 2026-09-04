import { readFileSync } from "node:fs";
import { canTakePaymentFromInvoiceList, getInvoiceListSendPath, getInvoiceListTakePaymentPath } from "@/lib/invoiceListPayment";
import type { InvoiceListItem } from "@/hooks/useInvoices";

const invoicesPageSource = readFileSync("client/src/pages/invoices.tsx", "utf8");
const invoiceDetailSource = readFileSync("client/src/pages/invoice-detail.tsx", "utf8");
const invoiceHooksSource = readFileSync("client/src/hooks/useInvoices.ts", "utf8");

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
  it("uses server paging metadata and tenant-wide summary facts instead of the visible rows", () => {
    expect(invoicesPageSource).toContain("page,");
    expect(invoicesPageSource).toContain("pageSize,");
    expect(invoicesPageSource).toContain("summary.totalOutstandingCents");
    expect(invoicesPageSource).toContain("summary.paidThisMonthCents");
    expect(invoicesPageSource).toContain("summary?.totalInvoices");
    expect(invoicesPageSource).toContain("of ${totalCount} invoices");
    expect(invoicesPageSource).not.toContain("value={filteredInvoices.length}");
    expect(invoicesPageSource).toContain('invoice-pagination-${position}');
    expect(invoicesPageSource).toContain('renderPaginationControls("top")');
    expect(invoicesPageSource).toContain('renderPagination("bottom")');
    expect(invoicesPageSource).toContain('data-testid="invoice-toolbar"');
    expect(invoicesPageSource).toContain('data-testid="invoice-pagination-top"');
  });

  it("keeps compact column filters server-driven and individually clearable", () => {
    expect(invoicesPageSource).toContain("Column filters");
    expect(invoicesPageSource).toContain("Customer / Company");
    expect(invoicesPageSource).toContain("setColumnFilter");
    expect(invoicesPageSource).toContain("clearColumnFilters");
    expect(invoicesPageSource).toContain("...columnFilters");
  });

  it("keeps the hardened summary and pagination contract instead of rendering fallback zero totals", () => {
    expect(invoiceHooksSource).toContain("if (!data.summary || !data.pagination)");
    expect(invoiceHooksSource).toContain("Invoice dashboard data is unavailable");
    expect(invoicesPageSource).not.toContain("summary ||");
    expect(invoicesPageSource).not.toContain("value={filteredInvoices.length}");
  });

  it("uses a compact, responsive totals strip and toolbar", () => {
    expect(invoicesPageSource).toContain("showTotals &&");
    expect(invoicesPageSource).toContain('data-testid="invoice-summary-strip"');
    expect(invoicesPageSource).toContain("getInvoiceTotalsVisible");
    expect(invoicesPageSource).toContain("setInvoiceTotalsVisible");
    expect(invoicesPageSource).toContain("flex flex-wrap items-center gap-2 p-3");
    expect(invoicesPageSource).toContain("min-w-[16rem] max-w-xl flex-1 basis-[22rem]");
  });

  it("keeps bulk selection explicit across page navigation", () => {
    expect(invoicesPageSource).toContain("selectedInvoiceIds");
    expect(invoicesPageSource).toContain("Select all visible accounting-approvable invoices");
    expect(invoicesPageSource).toContain("setPage((current) => Math.min(totalPages, current + 1))");
    expect(invoicesPageSource).not.toContain("setSelectedInvoiceIds(new Set())\n              setPage");
  });

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

  it("uses compact accessible quick actions and routes send to the canonical detail dialog", () => {
    expect(getInvoiceListSendPath("invoice-123")).toBe("/invoices/invoice-123?sendInvoice=1");
    expect(invoicesPageSource).toContain("getInvoiceListSendPath(invoice.id)");
    expect(invoicesPageSource).toContain("Send Invoice</TooltipContent>");
    expect(invoicesPageSource).toContain("Take Payment</TooltipContent>");
    expect(invoicesPageSource).toContain("View Invoice</TooltipContent>");
    expect(invoicesPageSource).toContain('size="icon"');
    expect(invoicesPageSource).toContain(">$</Button>");
    expect(invoicesPageSource).toContain("aria-label={`Send invoice ${invoice.invoiceNumber}`}");
    expect(invoicesPageSource).toContain('isAdminOrOwner && String((invoice as any).importSource || "").toLowerCase() !== "quickbooks"');
    expect(invoiceDetailSource).toContain('searchParams.get("sendInvoice") !== "1"');
    expect(invoiceDetailSource).toContain("handleEmailDialogOpenChange(true)");
    expect(invoiceDetailSource).toContain('next.delete("sendInvoice")');
    expect(invoiceDetailSource).toContain("if (!canSendInvoiceEmail)");
  });

  it("shows Take Payment for a live draft balance, but not void or zero-balance invoices", () => {
    expect(canTakePaymentFromInvoiceList(invoice({ status: "void" }))).toBe(false);
    expect(canTakePaymentFromInvoiceList(invoice({ status: "draft" }))).toBe(true);
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
