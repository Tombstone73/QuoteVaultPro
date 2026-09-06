import { readFileSync } from "node:fs";
import { canTakePaymentFromInvoiceList, getInvoiceListTakePaymentPath } from "@/lib/invoiceListPayment";
import type { InvoiceListItem } from "@/hooks/useInvoices";

const invoicesPageSource = readFileSync("client/src/pages/invoices.tsx", "utf8");
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
  emailDeliveryStatus: null,
  emailDeliveryFailureReason: null,
  emailDeliveryUpdatedAt: null,
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

  it("uses the configured API origin for both invoice-list reads", () => {
    const listHooks = invoiceHooksSource.slice(
      invoiceHooksSource.indexOf("export function useInvoices("),
      invoiceHooksSource.indexOf("// Get invoice detail"),
    );
    expect(invoiceHooksSource).toContain("import { apiFetch, apiRequest }");
    expect(listHooks).toContain("apiFetch(`/api/invoices?${params}`)");
    expect(listHooks).not.toContain("fetch(`/api/invoices?${params}`");
  });

  it("routes every invoice and payment operation through the canonical API client", () => {
    expect(invoiceHooksSource).not.toMatch(/\bfetch\(\s*[`'"]\/api\//);
    expect(invoiceHooksSource).toContain("apiFetch(`/api/invoices/${id}/send`");
    expect(invoiceHooksSource).toContain("apiFetch('/api/payments'");
    expect(invoiceHooksSource).toContain("apiRequest(");
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

  it("uses compact accessible quick actions and opens the canonical direct-send dialog", () => {
    expect(invoicesPageSource).toContain("handleQuickSend(invoice)");
    expect(invoicesPageSource).toContain("InvoiceEmailSendDialog");
    expect(invoicesPageSource).toContain("setQuickSendInvoice");
    expect(invoicesPageSource).toContain("Send Invoice</TooltipContent>");
    expect(invoicesPageSource).toContain("Take Payment</TooltipContent>");
    expect(invoicesPageSource).toContain("View Invoice</TooltipContent>");
    expect(invoicesPageSource).toContain('size="icon"');
    expect(invoicesPageSource).toContain(">$</Button>");
    expect(invoicesPageSource).toContain("aria-label={`Send invoice ${invoice.invoiceNumber}`}");
    expect(invoicesPageSource).toContain('isAdminOrOwner && String((invoice as any).importSource || "").toLowerCase() !== "quickbooks"');
    expect(invoicesPageSource).not.toContain("getInvoiceListSendPath");
  });

  it("uses the canonical accounting-approval mutation for a compact inline approval control", () => {
    expect(invoicesPageSource).toContain('<TitanTableHead className="w-[116px] min-w-[116px]">Approved</TitanTableHead>');
    expect(invoicesPageSource).toContain("const handleApproveInvoice = async (invoice: InvoiceListItem)");
    expect(invoicesPageSource).toContain("await approveInvoices.mutateAsync([invoice.id])");
    expect(invoicesPageSource).toContain("if (approveInvoices.isPending) return");
    expect(invoicesPageSource).toContain("aria-label={`Approve invoice ${invoice.invoiceNumber} for accounting`}");
    expect(invoicesPageSource).toContain("{approvingInvoiceId === invoice.id && approveInvoices.isPending ? 'Approving…' : 'Not Approved'}");
    expect(invoicesPageSource).toContain("<StatusPill variant=\"info\">Approved</StatusPill>");
    expect(invoicesPageSource).toContain("isAdminOrOwner ? (");
    expect(invoicesPageSource).toContain("event.stopPropagation();\n                          void handleApproveInvoice(invoice);");
  });

  it("detects an uncertain delivery before opening the normal direct-send dialog", () => {
    const quickSend = invoicesPageSource.slice(invoicesPageSource.indexOf("const handleQuickSend"), invoicesPageSource.indexOf("const confirmVerifiedNotSent"));
    expect(quickSend).toContain("invoice.emailDeliveryStatus === 'needs_review'");
    expect(quickSend).toContain("setNeedsReviewPromptJob");
    expect(quickSend).toContain("setQuickSendInvoice");
  });

  it("keeps queued, sending, retrying, and failed delivery states distinct from Last Sent", () => {
    expect(invoicesPageSource).toContain('queued: { label: "Queued"');
    expect(invoicesPageSource).toContain('processing: { label: "Sending"');
    expect(invoicesPageSource).toContain('retrying: { label: "Retrying"');
    expect(invoicesPageSource).toContain('failed: { label: "Delivery Failed"');
    expect(invoicesPageSource).toContain('needs_review: { label: "Needs Review"');
    expect(invoicesPageSource).toContain("emailDeliveryFailureReason");
    expect(invoicesPageSource).toContain("invoice.lastSentAt ? formatDate(invoice.lastSentAt) : EMPTY_VALUE");
    expect(invoiceHooksSource).toContain("refetchInterval");
    expect(invoiceHooksSource).toContain('"queued", "processing", "retrying"');
  });

  it("provides a bounded, polling email queue with an explicit needs-review resolution flow", () => {
    expect(invoicesPageSource).toContain("Invoice Email Queue");
    expect(invoicesPageSource).toContain("invoice-email-queue-open");
    expect(invoicesPageSource).toContain("Active");
    expect(invoicesPageSource).toContain("Delivery Failed");
    expect(invoicesPageSource).toContain("Delivery outcome uncertain. Retry blocked until reviewed.");
    expect(invoicesPageSource).toContain("Safe to send again:");
    expect(invoicesPageSource).toContain(">Review</Button>");
    expect(invoicesPageSource).toContain("Retry through Queue");
    expect(invoicesPageSource).toContain("I verified this email was not sent");
    expect(invoicesPageSource).toContain("Keep Blocked");
    expect(invoicesPageSource).toContain("Previous delivery needs review");
    expect(invoicesPageSource).toContain("Stale");
    expect(invoicesPageSource).toContain("navigate(`/invoices/${job.invoiceId}`)");
    expect(invoicesPageSource).not.toContain("Retry email");
    expect(invoiceHooksSource).toContain("useInvoiceEmailQueue");
    expect(invoiceHooksSource).toContain("email-queue?view=");
    expect(invoiceHooksSource).toContain("useResolveInvoiceEmailDeliveryReview");
  });

  it("shows Take Payment for a live draft balance, but not void or zero-balance invoices", () => {
    expect(canTakePaymentFromInvoiceList(invoice({ status: "void" }))).toBe(false);
    expect(canTakePaymentFromInvoiceList(invoice({ status: "draft" }))).toBe(true);
    expect(canTakePaymentFromInvoiceList(invoice({ status: "paid", displayRemaining: 0, balanceDue: "0.00" }))).toBe(false);
  });

  it("no longer renders the legacy Record Payment dialog", () => {
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
