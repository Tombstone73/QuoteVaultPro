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
