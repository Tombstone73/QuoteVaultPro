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
