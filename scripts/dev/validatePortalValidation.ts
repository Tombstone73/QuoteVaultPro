import "dotenv/config";

import {
  parsePortalValidationSeedConfig,
  DEFAULT_PORTAL_TEST_EMAIL,
} from "../../server/lib/portalValidationSeedConfig";

type ValidationIssue = {
  step: string;
  message: string;
};

type HttpResult<T = any> = {
  status: number;
  ok: boolean;
  contentType: string;
  text: string;
  json: T | null;
  bytes?: Uint8Array;
};

const baseUrl = (process.env.PORTAL_VALIDATION_BASE_URL || process.env.PLAYWRIGHT_BASE_URL || "http://localhost:5000").replace(/\/$/, "");
const config = parsePortalValidationSeedConfig({
  ...process.env,
  PORTAL_TEST_EMAIL: process.env.PORTAL_TEST_EMAIL || process.env.PLAYWRIGHT_EMAIL || DEFAULT_PORTAL_TEST_EMAIL,
  PORTAL_TEST_PASSWORD: process.env.PORTAL_TEST_PASSWORD || process.env.PLAYWRIGHT_PASSWORD,
});

let cookieHeader = "";
const issues: ValidationIssue[] = [];
const passed: string[] = [];
const skipped: string[] = [];

function assert(condition: unknown, step: string, message: string) {
  if (!condition) throw new Error(`${step}: ${message}`);
}

function record(step: string, fn: () => void) {
  try {
    fn();
    passed.push(step);
  } catch (error: any) {
    issues.push({ step, message: error?.message || String(error) });
  }
}

function mergeSetCookie(headers: Headers) {
  const raw = headers.get("set-cookie");
  if (!raw) return;
  cookieHeader = raw
    .split(/,(?=[^;,]+=)/)
    .map((cookie) => cookie.split(";")[0]?.trim())
    .filter(Boolean)
    .join("; ");
}

async function request<T = any>(path: string, init: RequestInit = {}): Promise<HttpResult<T>> {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      ...(cookieHeader ? { Cookie: cookieHeader } : {}),
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...(init.headers || {}),
    },
  });
  mergeSetCookie(response.headers);
  const contentType = response.headers.get("content-type") || "";
  const bytes = new Uint8Array(await response.arrayBuffer());
  const text = new TextDecoder().decode(bytes);
  let json: T | null = null;
  if (contentType.includes("application/json") && text) {
    json = JSON.parse(text) as T;
  }
  return { status: response.status, ok: response.ok, contentType, text, json, bytes };
}

async function main() {
  if (!config.password) {
    throw new Error("PORTAL_TEST_PASSWORD or PLAYWRIGHT_PASSWORD is required for portal validation.");
  }

  const login = await request("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ email: config.email, password: config.password }),
  });
  record("portal user can log in", () => {
    assert(login.ok, "login", `expected 2xx, got ${login.status}: ${login.text.slice(0, 120)}`);
    assert(cookieHeader, "login", "expected session cookie");
  });

  const session = await request<any>("/api/auth/session");
  record("auth session is valid", () => {
    assert(session.json?.authenticated === true, "session", "expected authenticated session");
  });

  const me = await request<any>("/api/portal/me");
  record("portal session resolves customer scope", () => {
    assert(me.ok, "portal me", `expected 2xx, got ${me.status}`);
    assert(me.json?.data?.customerId === config.customerId, "portal me", "expected seeded customer scope");
  });

  const dashboard = await request<any>("/api/portal/dashboard");
  record("portal dashboard loads", () => {
    assert(dashboard.ok, "dashboard", `expected 2xx, got ${dashboard.status}`);
    assert(dashboard.json?.data?.summary, "dashboard", "expected summary");
  });
  record("portal dashboard summarizes seeded customer state", () => {
    const summary = dashboard.json?.data?.summary || {};
    assert(Number(summary.openInvoiceCount) >= 1, "dashboard summary", "expected open invoices");
    assert(Number(summary.outstandingBalance) > 0, "dashboard summary", "expected outstanding balance");
    assert(Number(summary.activeOrderCount) >= 1, "dashboard summary", "expected active orders");
    assert(Number(summary.quotesNeedingAction) >= 1, "dashboard summary", "expected quotes needing action");
  });
  record("portal dashboard includes action-safe cards and recent documents", () => {
    const data = dashboard.json?.data || {};
    assert((data.invoices || []).some((invoice: any) => invoice.id === config.invoiceIds.payable), "dashboard invoices", "expected payable invoice");
    assert((data.quotes || []).some((quote: any) => quote.id === config.quoteIds.active), "dashboard quotes", "expected active quote");
    assert((data.activeOrders || []).some((order: any) => order.id === config.orderIds.portalStatus), "dashboard orders", "expected active order");
    assert((data.recentFiles || []).some((file: any) => file.id === `oa_${config.fileIds.orderVisible}`), "dashboard files", "expected visible order file");
    assert((data.recentFiles || []).some((file: any) => file.id === `qa_${config.fileIds.quoteVisible}`), "dashboard files", "expected visible quote file");
  });
  record("portal dashboard is sanitized", () => {
    const serialized = JSON.stringify(dashboard.json?.data || {});
    assert(!serialized.includes("storage") && !serialized.includes("bucket") && !serialized.includes("fileUrl"), "dashboard", "leaked storage metadata");
    assert(!serialized.includes("notesInternal") && !serialized.includes("productionNotes") && !serialized.includes("routing"), "dashboard", "leaked internal metadata");
  });

  const list = await request<any>("/api/portal/invoices");
  const invoices = Array.isArray(list.json?.data) ? list.json.data : [];
  const byNumber = new Map<number, any>(invoices.map((invoice: any) => [Number(invoice.invoiceNumber), invoice]));
  record("portal invoice list loads", () => {
    assert(list.ok, "invoice list", `expected 2xx, got ${list.status}`);
  });
  record("payable invoice appears", () => {
    const invoice = byNumber.get(config.invoiceNumbers.payable);
    assert(invoice, "payable invoice", `Invoice #${config.invoiceNumbers.payable} missing`);
    assert(Number(invoice.amountDue) > 0, "payable invoice", "expected amountDue > 0");
  });
  record("paid invoice appears paid", () => {
    const invoice = byNumber.get(config.invoiceNumbers.paid);
    assert(invoice, "paid invoice", `Invoice #${config.invoiceNumbers.paid} missing`);
    assert(invoice.status === "paid", "paid invoice", `expected paid, got ${invoice.status}`);
    assert(Number(invoice.amountDue) === 0, "paid invoice", "expected amountDue = 0");
  });
  record("draft invoice does not appear", () => {
    assert(!byNumber.has(config.invoiceNumbers.draft), "draft invoice", "draft invoice should not be visible");
  });
  record("void invoice appears but is not payable", () => {
    const invoice = byNumber.get(config.invoiceNumbers.void);
    assert(invoice, "void invoice", `Invoice #${config.invoiceNumbers.void} missing`);
    assert(invoice.status === "void", "void invoice", `expected void, got ${invoice.status}`);
  });

  const detail = await request<any>(`/api/portal/invoices/${encodeURIComponent(config.invoiceIds.payable)}`);
  record("invoice detail loads", () => {
    assert(detail.ok, "invoice detail", `expected 2xx, got ${detail.status}`);
    assert(detail.json?.data?.id === config.invoiceIds.payable, "invoice detail", "expected payable invoice detail");
  });

  const payments = await request<any>(`/api/portal/invoices/${encodeURIComponent(config.invoiceIds.paid)}/payments`);
  record("payment history loads", () => {
    assert(payments.ok, "payment history", `expected 2xx, got ${payments.status}`);
    assert(Array.isArray(payments.json?.data) && payments.json.data.length > 0, "payment history", "expected paid invoice payment row");
  });

  const pdf = await request(`/api/portal/invoices/${encodeURIComponent(config.invoiceIds.payable)}/pdf`);
  record("PDF endpoint returns PDF response", () => {
    assert(pdf.ok, "pdf", `expected 2xx, got ${pdf.status}`);
    assert(pdf.contentType.includes("application/pdf"), "pdf", `expected application/pdf, got ${pdf.contentType}`);
    assert(pdf.text.startsWith("%PDF"), "pdf", "expected PDF header");
  });

  const invoiceFiles = await request<any>(`/api/portal/invoices/${encodeURIComponent(config.invoiceIds.payable)}/files`);
  record("invoice file list exposes portal-safe PDF", () => {
    assert(invoiceFiles.ok, "invoice files", `expected 2xx, got ${invoiceFiles.status}`);
    const files = Array.isArray(invoiceFiles.json?.data) ? invoiceFiles.json.data : [];
    assert(files.some((file: any) => file.id === "pdf" && file.categoryLabel === "Invoice"), "invoice files", "expected invoice PDF file");
    const serialized = JSON.stringify(files);
    assert(!serialized.includes("storage") && !serialized.includes("bucket") && !serialized.includes("fileUrl"), "invoice files", "leaked storage metadata");
  });

  const invoiceFileDownload = await request(`/api/portal/invoices/${encodeURIComponent(config.invoiceIds.payable)}/files/pdf`);
  record("invoice file download returns PDF response", () => {
    assert(invoiceFileDownload.ok, "invoice file download", `expected 2xx, got ${invoiceFileDownload.status}`);
    assert(invoiceFileDownload.contentType.includes("application/pdf"), "invoice file download", `expected PDF, got ${invoiceFileDownload.contentType}`);
    assert(invoiceFileDownload.text.startsWith("%PDF"), "invoice file download", "expected PDF header");
  });

  const fake = await request("/api/portal/invoices/not-a-real-invoice");
  record("fake invoice ID returns safe 404", () => {
    assert(fake.status === 404, "fake invoice", `expected 404, got ${fake.status}`);
    assert(!fake.text.includes("stack") && !fake.text.includes("DATABASE_URL"), "fake invoice", "response leaked implementation detail");
  });

  const orderList = await request<any>("/api/portal/orders");
  const orderRows = Array.isArray(orderList.json?.data) ? orderList.json.data : [];
  const portalOrder = orderRows.find((order: any) => order.id === config.orderIds.portalStatus);
  record("portal order list loads scoped orders", () => {
    assert(orderList.ok, "order list", `expected 2xx, got ${orderList.status}`);
    assert(portalOrder, "order list", "expected seeded portal order");
    assert(!orderRows.some((order: any) => order.id === config.orderIds.otherCustomer), "order list", "other customer order should not be visible");
  });
  record("portal order list is sanitized", () => {
    const serialized = JSON.stringify(orderList.json?.data || {});
    assert(!serialized.includes("routingTarget"), "order list", "leaked routingTarget");
    assert(!serialized.includes("notesInternal"), "order list", "leaked internal notes");
    assert(!serialized.includes("productionNotes"), "order list", "leaked production notes");
    assert(!serialized.includes("materialUsage"), "order list", "leaked material usage");
    assert(!serialized.includes("createdByUserId"), "order list", "leaked staff/user metadata");
    assert(!serialized.includes("workflowState"), "order list", "leaked workflow state");
    assert(!serialized.includes('"fulfillmentStatus":'), "order list", "leaked raw fulfillment status");
  });

  const orderDetail = await request<any>(`/api/portal/orders/${encodeURIComponent(config.orderIds.portalStatus)}`);
  record("portal order detail loads", () => {
    assert(orderDetail.ok, "order detail", `expected 2xx, got ${orderDetail.status}`);
    assert(orderDetail.json?.data?.id === config.orderIds.portalStatus, "order detail", "expected seeded order detail");
    assert(Array.isArray(orderDetail.json?.data?.lineItems) && orderDetail.json.data.lineItems.length >= 2, "order detail", "expected line items");
    assert(orderDetail.json?.data?.proofStatusSummary?.actionRequired === true, "order detail", "expected proof action indicator");
  });
  record("portal order detail is sanitized", () => {
    const serialized = JSON.stringify(orderDetail.json?.data || {});
    assert(!serialized.includes("routingTarget"), "order detail", "leaked routingTarget");
    assert(!serialized.includes("notesInternal"), "order detail", "leaked internal notes");
    assert(!serialized.includes("productionNotes"), "order detail", "leaked production notes");
    assert(!serialized.includes("unitPrice"), "order detail", "leaked line item pricing internals");
    assert(!serialized.includes("materialUsage"), "order detail", "leaked material usage");
    assert(!serialized.includes("createdByUserId"), "order detail", "leaked staff/user metadata");
    assert(!serialized.includes("workflowState"), "order detail", "leaked workflow state");
    assert(!serialized.includes('"fulfillmentStatus":'), "order detail", "leaked raw fulfillment status");
  });

  const fakeOrder = await request("/api/portal/orders/not-a-real-order");
  record("fake order ID returns safe 404", () => {
    assert(fakeOrder.status === 404, "fake order", `expected 404, got ${fakeOrder.status}`);
    assert(!fakeOrder.text.includes("stack") && !fakeOrder.text.includes("DATABASE_URL"), "fake order", "response leaked implementation detail");
  });

  const otherOrder = await request(`/api/portal/orders/${encodeURIComponent(config.orderIds.otherCustomer)}`);
  record("other customer order returns safe 404", () => {
    assert(otherOrder.status === 404, "other order", `expected 404, got ${otherOrder.status}`);
  });

  const orderFiles = await request<any>(`/api/portal/orders/${encodeURIComponent(config.orderIds.portalStatus)}/files`);
  record("portal order file list loads safely", () => {
    assert(orderFiles.ok, "order files", `expected 2xx, got ${orderFiles.status}`);
    const serialized = JSON.stringify(orderFiles.json?.data || {});
    assert(!serialized.includes("storage") && !serialized.includes("bucket") && !serialized.includes("fileUrl"), "order files", "leaked storage metadata");
  });
  record("visible order file appears and staff-only file is hidden", () => {
    const files = Array.isArray(orderFiles.json?.data) ? orderFiles.json.data : [];
    assert(files.some((file: any) => file.id === `oa_${config.fileIds.orderVisible}`), "order files", "expected customer-visible order file");
    assert(!files.some((file: any) => file.id === `oa_${config.fileIds.orderStaffOnly}`), "order files", "staff-only order file should not appear");
    const visible = files.find((file: any) => file.id === `oa_${config.fileIds.orderVisible}`);
    assert(visible?.displayName === "Portal Validation Order Document", "order files", "expected portal display name");
    assert(visible?.description === "Customer-visible DEV order document.", "order files", "expected portal description");
  });

  const orderFileDownload = await request(`/api/portal/orders/${encodeURIComponent(config.orderIds.portalStatus)}/files/oa_${encodeURIComponent(config.fileIds.orderVisible)}`);
  record("visible order file downloads through portal proxy", () => {
    assert(orderFileDownload.ok, "order file download", `expected 2xx, got ${orderFileDownload.status}`);
    assert(orderFileDownload.text.includes("visible order document"), "order file download", "expected seeded file content");
  });

  const orderStaffOnlyDownload = await request(`/api/portal/orders/${encodeURIComponent(config.orderIds.portalStatus)}/files/oa_${encodeURIComponent(config.fileIds.orderStaffOnly)}`);
  record("staff-only order file download returns safe 404", () => {
    assert(orderStaffOnlyDownload.status === 404, "staff-only order file", `expected 404, got ${orderStaffOnlyDownload.status}`);
  });

  const otherOrderFiles = await request(`/api/portal/orders/${encodeURIComponent(config.orderIds.otherCustomer)}/files`);
  record("other customer order files return safe 404", () => {
    assert(otherOrderFiles.status === 404, "other order files", `expected 404, got ${otherOrderFiles.status}`);
  });

  const otherOrderFileDownload = await request(`/api/portal/orders/${encodeURIComponent(config.orderIds.otherCustomer)}/files/oa_${encodeURIComponent(config.fileIds.otherOrderVisible)}`);
  record("other customer visible order file returns safe 404", () => {
    assert(otherOrderFileDownload.status === 404, "other order file download", `expected 404, got ${otherOrderFileDownload.status}`);
  });

  const fakeOrderFile = await request(`/api/portal/orders/${encodeURIComponent(config.orderIds.portalStatus)}/files/not-a-real-file`);
  record("fake order file returns safe 404", () => {
    assert(fakeOrderFile.status === 404, "fake order file", `expected 404, got ${fakeOrderFile.status}`);
  });

  const proofList = await request<any>("/api/portal/proofs");
  const proofRows = Array.isArray(proofList.json?.data) ? proofList.json.data : [];
  const actionableProof = proofRows.find((proof: any) => proof.id === config.proofVersionIds.actionable);
  const approvedProof = proofRows.find((proof: any) => proof.id === config.proofVersionIds.approved);
  const supersededProof = proofRows.find((proof: any) => proof.id === config.proofVersionIds.superseded);
  record("portal proof list loads scoped proofs", () => {
    assert(proofList.ok, "proof list", `expected 2xx, got ${proofList.status}`);
    assert(actionableProof, "proof list", "expected actionable proof");
    assert(approvedProof, "proof list", "expected approved proof");
    assert(supersededProof, "proof list", "expected superseded proof");
    assert(!proofRows.some((proof: any) => proof.id === config.proofVersionIds.otherCustomer), "proof list", "other customer proof should not be visible");
  });
  record("portal proof list is sanitized", () => {
    const serialized = JSON.stringify(proofList.json?.data || {});
    assert(!serialized.includes("internalNotes"), "proof list", "leaked internal notes");
    assert(!serialized.includes("proofFileId"), "proof list", "leaked proof file id");
    assert(!serialized.includes("storage") && !serialized.includes("bucket") && !serialized.includes("fileUrl"), "proof list", "leaked storage metadata");
    assert(actionableProof?.displayStatus === "Awaiting Your Approval", "proof list", `expected Awaiting Your Approval, got ${actionableProof?.displayStatus}`);
  });

  const proofDetail = await request<any>(`/api/portal/proofs/${encodeURIComponent(config.proofVersionIds.actionable)}`);
  record("portal proof detail loads", () => {
    assert(proofDetail.ok, "proof detail", `expected 2xx, got ${proofDetail.status}`);
    assert(proofDetail.json?.data?.id === config.proofVersionIds.actionable, "proof detail", "expected actionable proof detail");
    assert(proofDetail.json?.data?.customerActionRequired === true, "proof detail", "expected action required");
    assert(Array.isArray(proofDetail.json?.data?.history), "proof detail", "expected safe history");
  });

  const tokenProof = await request<any>(`/api/portal/proof/${encodeURIComponent(config.proofTokenRaw)}`);
  record("token-link proof flow still resolves", () => {
    assert(tokenProof.ok, "token proof", `expected 2xx, got ${tokenProof.status}`);
    assert(tokenProof.json?.data?.proofVersion?.id === config.proofVersionIds.actionable, "token proof", "expected seeded proof token");
  });

  const proofFileDownload = await request(`/api/portal/proofs/${encodeURIComponent(config.proofVersionIds.actionable)}/file`);
  record("portal proof file downloads through portal proxy", () => {
    assert(proofFileDownload.ok, "proof file", `expected 2xx, got ${proofFileDownload.status}`);
    assert(proofFileDownload.text.includes("actionable proof file"), "proof file", "expected seeded proof content");
  });

  const fakeProof = await request("/api/portal/proofs/not-a-real-proof");
  record("fake proof ID returns safe 404", () => {
    assert(fakeProof.status === 404, "fake proof", `expected 404, got ${fakeProof.status}`);
  });

  const otherProof = await request(`/api/portal/proofs/${encodeURIComponent(config.proofVersionIds.otherCustomer)}`);
  record("other customer proof returns safe 404", () => {
    assert(otherProof.status === 404, "other proof", `expected 404, got ${otherProof.status}`);
  });

  const supersededProofAction = await request(`/api/portal/proofs/${encodeURIComponent(config.proofVersionIds.superseded)}/approve`, { method: "POST", body: "{}" });
  record("superseded proof cannot be acted on", () => {
    assert(supersededProofAction.status === 409, "superseded proof", `expected 409, got ${supersededProofAction.status}`);
  });

  const approveProof = await request<any>(`/api/portal/proofs/${encodeURIComponent(config.proofVersionIds.actionable)}/approve`, { method: "POST", body: "{}" });
  record("portal user can approve actionable proof", () => {
    assert(approveProof.ok, "approve proof", `expected 2xx, got ${approveProof.status}: ${approveProof.text}`);
    assert(approveProof.json?.data?.proof?.displayStatus === "Approved", "approve proof", "expected approved proof DTO");
  });

  const repeatApproveProof = await request<any>(`/api/portal/proofs/${encodeURIComponent(config.proofVersionIds.actionable)}/approve`, { method: "POST", body: "{}" });
  record("repeat proof approve is idempotent", () => {
    assert(repeatApproveProof.ok, "repeat approve proof", `expected 2xx, got ${repeatApproveProof.status}`);
    assert(repeatApproveProof.json?.data?.proof?.displayStatus === "Approved", "repeat approve proof", "expected approved proof DTO");
  });

  const refreshedProofDashboard = await request<any>("/api/portal/dashboard");
  const refreshedProofOrder = await request<any>(`/api/portal/orders/${encodeURIComponent(config.orderIds.portalStatus)}`);
  record("proof actions update portal dashboard and order summaries", () => {
    assert(refreshedProofDashboard.ok, "proof dashboard refresh", `expected 2xx, got ${refreshedProofDashboard.status}`);
    assert(!((refreshedProofDashboard.json?.data?.proofs || []).some((proof: any) => proof.id === config.proofVersionIds.actionable)), "proof dashboard refresh", "approved proof should no longer require action");
    assert(refreshedProofOrder.ok, "proof order refresh", `expected 2xx, got ${refreshedProofOrder.status}`);
    assert(refreshedProofOrder.json?.data?.proofStatusSummary?.actionRequired === false, "proof order refresh", "order should not show proof action required after approval");
  });

  const quoteList = await request<any>("/api/portal/quotes");
  const quoteRows = Array.isArray(quoteList.json?.data) ? quoteList.json.data : [];
  const activeQuote = quoteRows.find((quote: any) => quote.id === config.quoteIds.active);
  const expiredQuote = quoteRows.find((quote: any) => quote.id === config.quoteIds.expired);
  const canceledQuote = quoteRows.find((quote: any) => quote.id === config.quoteIds.canceled);
  record("portal quote list loads scoped visible quotes", () => {
    assert(quoteList.ok, "quote list", `expected 2xx, got ${quoteList.status}`);
    assert(activeQuote, "quote list", "expected active seeded quote");
    assert(expiredQuote, "quote list", "expected expired seeded quote");
    assert(canceledQuote, "quote list", "expected canceled seeded quote");
    assert(!quoteRows.some((quote: any) => quote.id === config.quoteIds.draft), "quote list", "draft quote should not be visible");
    assert(!quoteRows.some((quote: any) => quote.id === config.quoteIds.otherCustomer), "quote list", "other customer quote should not be visible");
  });
  record("portal quote list statuses are customer-safe", () => {
    assert(activeQuote.displayStatus === "Ready for Review", "quote list", `expected Ready for Review, got ${activeQuote?.displayStatus}`);
    assert(expiredQuote.displayStatus === "Expired", "quote list", `expected Expired, got ${expiredQuote?.displayStatus}`);
    assert(canceledQuote.displayStatus === "Unavailable", "quote list", `expected Unavailable, got ${canceledQuote?.displayStatus}`);
  });
  record("portal quote list is sanitized", () => {
    const serialized = JSON.stringify(quoteList.json?.data || {});
    assert(!serialized.includes("organizationId"), "quote list", "leaked organizationId");
    assert(!serialized.includes("customerId"), "quote list", "leaked customerId");
    assert(!serialized.includes("margin"), "quote list", "leaked margin");
    assert(!serialized.includes("priceBreakdown"), "quote list", "leaked price breakdown");
    assert(!serialized.includes("pbv2Snapshot"), "quote list", "leaked PBV2 snapshot");
    assert(!serialized.includes("formula"), "quote list", "leaked formula internals");
    assert(!serialized.includes("createdByUserId"), "quote list", "leaked staff metadata");
  });

  const quoteDetail = await request<any>(`/api/portal/quotes/${encodeURIComponent(config.quoteIds.active)}`);
  record("portal quote detail loads", () => {
    assert(quoteDetail.ok, "quote detail", `expected 2xx, got ${quoteDetail.status}`);
    assert(quoteDetail.json?.data?.id === config.quoteIds.active, "quote detail", "expected active quote detail");
    assert(Array.isArray(quoteDetail.json?.data?.lineItems) && quoteDetail.json.data.lineItems.length > 0, "quote detail", "expected line items");
    assert(quoteDetail.json?.data?.expirationSummary?.expired === false, "quote detail", "expected non-expired summary");
  });
  const expiredQuoteDetail = await request<any>(`/api/portal/quotes/${encodeURIComponent(config.quoteIds.expired)}`);
  record("portal expired quote detail is clearly expired", () => {
    assert(expiredQuoteDetail.ok, "expired quote", `expected 2xx, got ${expiredQuoteDetail.status}`);
    assert(expiredQuoteDetail.json?.data?.displayStatus === "Expired", "expired quote", "expected Expired displayStatus");
    assert(expiredQuoteDetail.json?.data?.expirationSummary?.expired === true, "expired quote", "expected expired=true");
  });
  record("portal quote detail is sanitized", () => {
    const serialized = JSON.stringify(quoteDetail.json?.data || {});
    assert(!serialized.includes("organizationId"), "quote detail", "leaked organizationId");
    assert(!serialized.includes("customerId"), "quote detail", "leaked customerId");
    assert(!serialized.includes("margin"), "quote detail", "leaked margin");
    assert(!serialized.includes("cost"), "quote detail", "leaked cost");
    assert(!serialized.includes("priceBreakdown"), "quote detail", "leaked price breakdown");
    assert(!serialized.includes("pbv2Snapshot"), "quote detail", "leaked PBV2 snapshot");
    assert(!serialized.includes("formula"), "quote detail", "leaked formula internals");
    assert(!serialized.includes("createdByUserId"), "quote detail", "leaked staff metadata");
    assert(!serialized.includes("productionNotes"), "quote detail", "leaked internal production notes");
  });

  const fakeQuote = await request("/api/portal/quotes/not-a-real-quote");
  record("fake quote ID returns safe 404", () => {
    assert(fakeQuote.status === 404, "fake quote", `expected 404, got ${fakeQuote.status}`);
    assert(!fakeQuote.text.includes("stack") && !fakeQuote.text.includes("DATABASE_URL"), "fake quote", "response leaked implementation detail");
  });

  const draftQuote = await request(`/api/portal/quotes/${encodeURIComponent(config.quoteIds.draft)}`);
  record("draft quote returns safe 404", () => {
    assert(draftQuote.status === 404, "draft quote", `expected 404, got ${draftQuote.status}`);
  });

  const otherQuote = await request(`/api/portal/quotes/${encodeURIComponent(config.quoteIds.otherCustomer)}`);
  record("other customer quote returns safe 404", () => {
    assert(otherQuote.status === 404, "other quote", `expected 404, got ${otherQuote.status}`);
  });

  const quoteFiles = await request<any>(`/api/portal/quotes/${encodeURIComponent(config.quoteIds.active)}/files`);
  record("portal quote file list loads safely", () => {
    assert(quoteFiles.ok, "quote files", `expected 2xx, got ${quoteFiles.status}`);
    const serialized = JSON.stringify(quoteFiles.json?.data || {});
    assert(!serialized.includes("storage") && !serialized.includes("bucket") && !serialized.includes("fileUrl"), "quote files", "leaked storage metadata");
  });
  record("visible quote file appears and staff-only file is hidden", () => {
    const files = Array.isArray(quoteFiles.json?.data) ? quoteFiles.json.data : [];
    assert(files.some((file: any) => file.id === `qa_${config.fileIds.quoteVisible}`), "quote files", "expected customer-visible quote file");
    assert(!files.some((file: any) => file.id === `qa_${config.fileIds.quoteStaffOnly}`), "quote files", "staff-only quote file should not appear");
    const visible = files.find((file: any) => file.id === `qa_${config.fileIds.quoteVisible}`);
    assert(visible?.displayName === "Portal Validation Quote Document", "quote files", "expected portal display name");
    assert(visible?.description === "Customer-visible DEV quote document.", "quote files", "expected portal description");
  });

  const quoteFileDownload = await request(`/api/portal/quotes/${encodeURIComponent(config.quoteIds.active)}/files/qa_${encodeURIComponent(config.fileIds.quoteVisible)}`);
  record("visible quote file downloads through portal proxy", () => {
    assert(quoteFileDownload.ok, "quote file download", `expected 2xx, got ${quoteFileDownload.status}`);
    assert(quoteFileDownload.text.includes("visible quote document"), "quote file download", "expected seeded file content");
  });

  const quoteStaffOnlyDownload = await request(`/api/portal/quotes/${encodeURIComponent(config.quoteIds.active)}/files/qa_${encodeURIComponent(config.fileIds.quoteStaffOnly)}`);
  record("staff-only quote file download returns safe 404", () => {
    assert(quoteStaffOnlyDownload.status === 404, "staff-only quote file", `expected 404, got ${quoteStaffOnlyDownload.status}`);
  });

  const otherQuoteFiles = await request(`/api/portal/quotes/${encodeURIComponent(config.quoteIds.otherCustomer)}/files`);
  record("other customer quote files return safe 404", () => {
    assert(otherQuoteFiles.status === 404, "other quote files", `expected 404, got ${otherQuoteFiles.status}`);
  });

  const otherQuoteFileDownload = await request(`/api/portal/quotes/${encodeURIComponent(config.quoteIds.otherCustomer)}/files/qa_${encodeURIComponent(config.fileIds.otherQuoteVisible)}`);
  record("other customer visible quote file returns safe 404", () => {
    assert(otherQuoteFileDownload.status === 404, "other quote file download", `expected 404, got ${otherQuoteFileDownload.status}`);
  });

  const fakeQuoteFile = await request(`/api/portal/quotes/${encodeURIComponent(config.quoteIds.active)}/files/not-a-real-file`);
  record("fake quote file returns safe 404", () => {
    assert(fakeQuoteFile.status === 404, "fake quote file", `expected 404, got ${fakeQuoteFile.status}`);
  });

  const approveQuote = await request<any>(`/api/portal/quotes/${encodeURIComponent(config.quoteIds.active)}/approve`, {
    method: "POST",
    body: JSON.stringify({ note: "DEV validation approval" }),
  });
  const approvedOrderId = approveQuote.json?.data?.order?.id;
  record("portal user can approve actionable quote", () => {
    assert(approveQuote.ok, "approve quote", `expected 2xx, got ${approveQuote.status}: ${approveQuote.text.slice(0, 180)}`);
    assert(approveQuote.json?.data?.quote?.displayStatus === "Converted to Order", "approve quote", "expected converted quote status");
    assert(approvedOrderId, "approve quote", "expected safe order summary");
    assert(!approveQuote.text.includes("organizationId") && !approveQuote.text.includes("customerId"), "approve quote", "leaked tenant/customer ids");
  });

  const repeatApproveQuote = await request<any>(`/api/portal/quotes/${encodeURIComponent(config.quoteIds.active)}/approve`, {
    method: "POST",
    body: JSON.stringify({ note: "retry should be idempotent" }),
  });
  record("repeat approve does not create duplicate order", () => {
    assert(repeatApproveQuote.ok, "repeat approve", `expected 2xx, got ${repeatApproveQuote.status}: ${repeatApproveQuote.text.slice(0, 180)}`);
    assert(repeatApproveQuote.json?.data?.order?.id === approvedOrderId, "repeat approve", "expected same order id");
  });

  const expiredApprove = await request<any>(`/api/portal/quotes/${encodeURIComponent(config.quoteIds.expired)}/approve`, {
    method: "POST",
    body: JSON.stringify({}),
  });
  record("expired quote cannot be approved", () => {
    assert(expiredApprove.status === 409, "expired approve", `expected 409, got ${expiredApprove.status}`);
  });

  const otherApprove = await request<any>(`/api/portal/quotes/${encodeURIComponent(config.quoteIds.otherCustomer)}/approve`, {
    method: "POST",
    body: JSON.stringify({}),
  });
  record("other customer quote cannot be acted on", () => {
    assert(otherApprove.status === 404, "other approve", `expected 404, got ${otherApprove.status}`);
  });

  const declineQuote = await request<any>(`/api/portal/quotes/${encodeURIComponent(config.quoteIds.decline)}/decline`, {
    method: "POST",
    body: JSON.stringify({ note: "DEV validation decline" }),
  });
  record("decline changes visible portal status safely", () => {
    assert(declineQuote.ok, "decline quote", `expected 2xx, got ${declineQuote.status}: ${declineQuote.text.slice(0, 180)}`);
    assert(declineQuote.json?.data?.quote?.displayStatus === "Declined", "decline quote", "expected Declined displayStatus");
    assert(!declineQuote.text.includes("organizationId") && !declineQuote.text.includes("customerId"), "decline quote", "leaked tenant/customer ids");
  });

  const revisionQuote = await request<any>(`/api/portal/quotes/${encodeURIComponent(config.quoteIds.revision)}/request-revision`, {
    method: "POST",
    body: JSON.stringify({ note: "DEV validation revision request" }),
  });
  record("request revision changes visible portal status safely", () => {
    assert(revisionQuote.ok, "revision quote", `expected 2xx, got ${revisionQuote.status}: ${revisionQuote.text.slice(0, 180)}`);
    assert(revisionQuote.json?.data?.quote?.displayStatus === "Revision Requested", "revision quote", "expected Revision Requested displayStatus");
    assert(!revisionQuote.text.includes("organizationId") && !revisionQuote.text.includes("customerId"), "revision quote", "leaked tenant/customer ids");
  });

  const paidCreateIntent = await request<any>(`/api/portal/invoices/${encodeURIComponent(config.invoiceIds.paid)}/payments/stripe/create-intent`, {
    method: "POST",
    body: JSON.stringify({}),
  });
  record("paid invoice cannot start payment", () => {
    assert(paidCreateIntent.status === 409, "paid create-intent", `expected 409, got ${paidCreateIntent.status}`);
  });

  const voidCreateIntent = await request<any>(`/api/portal/invoices/${encodeURIComponent(config.invoiceIds.void)}/payments/stripe/create-intent`, {
    method: "POST",
    body: JSON.stringify({}),
  });
  record("void invoice cannot start payment", () => {
    assert(voidCreateIntent.status === 409, "void create-intent", `expected 409, got ${voidCreateIntent.status}`);
  });

  if (process.env.PORTAL_VALIDATE_CREATE_INTENT === "1") {
    const createIntent = await request<any>(`/api/portal/invoices/${encodeURIComponent(config.invoiceIds.payable)}/payments/stripe/create-intent`, {
      method: "POST",
      body: JSON.stringify({}),
    });
    record("optional create-intent eligibility", () => {
      assert(createIntent.ok, "create-intent", `expected 2xx, got ${createIntent.status}: ${createIntent.text.slice(0, 160)}`);
      assert(createIntent.json?.data?.clientSecret, "create-intent", "expected portal-safe clientSecret");
      assert(!createIntent.text.includes("stripePaymentIntentId"), "create-intent", "should not expose raw Stripe PaymentIntent ID");
    });
  } else {
    skipped.push("Stripe create-intent check skipped; set PORTAL_VALIDATE_CREATE_INTENT=1 when Stripe DEV prerequisites are ready.");
  }

  const report = {
    baseUrl,
    email: config.email,
    customerId: config.customerId,
    invoiceNumbers: config.invoiceNumbers,
    passed,
    skipped,
    issues,
  };

  console.log(JSON.stringify(report, null, 2));
  if (issues.length > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
