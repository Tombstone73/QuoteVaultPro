import "dotenv/config";

import { and, eq } from "drizzle-orm";

import { db, pool } from "../../server/db";
import { getStripeClient } from "../../server/lib/stripe";
import {
  getPortalStripeValidationSafetyErrors,
  parsePortalStripeValidationConfig,
} from "../../server/lib/portalStripeValidationConfig";
import {
  DEFAULT_PORTAL_TEST_EMAIL,
  parsePortalValidationSeedConfig,
} from "../../server/lib/portalValidationSeedConfig";
import { invoices, paymentWebhookEvents, payments } from "../../shared/schema";

type HttpResult<T = any> = {
  status: number;
  ok: boolean;
  contentType: string;
  text: string;
  json: T | null;
};

type StepResult = {
  step: string;
  ok: boolean;
  message?: string;
};

type PortalCreateIntentData = {
  clientSecret: string;
  paymentId: string;
  invoiceId: string;
  amount: number | string;
  currency: string;
  stripeAccountId?: string | null;
};

const config = parsePortalStripeValidationConfig({
  ...process.env,
  PORTAL_TEST_EMAIL: process.env.PORTAL_TEST_EMAIL || process.env.PLAYWRIGHT_EMAIL || DEFAULT_PORTAL_TEST_EMAIL,
  PORTAL_TEST_PASSWORD: process.env.PORTAL_TEST_PASSWORD || process.env.PLAYWRIGHT_PASSWORD,
});

const seed = parsePortalValidationSeedConfig({
  ...process.env,
  PORTAL_TEST_EMAIL: config.email,
  PORTAL_TEST_PASSWORD: config.password,
});

let cookieHeader = "";
const passed: StepResult[] = [];
const failed: StepResult[] = [];

function sanitizeDiagnostic(value: unknown): string {
  return String(value || "")
    .replace(/pi_[A-Za-z0-9]+/g, "pi_[redacted]")
    .replace(/acct_[A-Za-z0-9]+/g, "acct_[redacted]")
    .replace(/(?:sk|pk)_(?:test|live)_[A-Za-z0-9_]+/g, "[redacted_stripe_key]")
    .replace(/whsec_[A-Za-z0-9_]+/g, "whsec_[redacted]")
    .replace(/_secret_[A-Za-z0-9_]+/g, "_secret_[redacted]");
}

function record(step: string, fn: () => void) {
  try {
    fn();
    passed.push({ step, ok: true });
  } catch (error: any) {
    failed.push({ step, ok: false, message: sanitizeDiagnostic(error?.message || String(error)) });
  }
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
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
  const response = await fetch(`${config.baseUrl}${path}`, {
    ...init,
    headers: {
      ...(cookieHeader ? { Cookie: cookieHeader } : {}),
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...(init.headers || {}),
    },
  });
  mergeSetCookie(response.headers);

  const contentType = response.headers.get("content-type") || "";
  const text = await response.text();
  let json: T | null = null;
  if (contentType.includes("application/json") && text) {
    json = JSON.parse(text) as T;
  }
  return { status: response.status, ok: response.ok, contentType, text, json };
}

function extractPaymentIntentId(clientSecret: string): string {
  const match = clientSecret.match(/^(pi_[A-Za-z0-9]+)_secret_/);
  if (!match?.[1]) throw new Error("Could not parse PaymentIntent reference from client secret");
  return match[1];
}

function stripeRequestOptions(stripeAccountId?: string | null) {
  return stripeAccountId ? ({ stripeAccount: stripeAccountId } as any) : undefined;
}

function safeStripeSetupSummary() {
  return {
    secretKeyMode: config.stripeMode,
    publishableKeyMode: config.publishableKeyMode,
    webhookSecretStatus: config.webhookSecretStatus,
    webhookRoute: `${config.baseUrl}/api/payments/stripe/webhook`,
    stripeCliForwardCommand: `stripe listen --forward-to ${config.baseUrl}/api/payments/stripe/webhook`,
    canRunStripeApi: config.canRunStripeApi,
    canRunWebhookReplay: config.canRunWebhookReplay,
  };
}

async function login() {
  const loginResponse = await request("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ email: config.email, password: config.password }),
  });
  assert(loginResponse.ok, `portal login failed with ${loginResponse.status}`);
  assert(cookieHeader, "portal login did not return a session cookie");
}

async function createIntent(invoiceId: string): Promise<PortalCreateIntentData> {
  const response = await request<any>(`/api/portal/invoices/${encodeURIComponent(invoiceId)}/payments/stripe/create-intent`, {
    method: "POST",
    body: JSON.stringify({}),
  });
  assert(response.ok, `create-intent failed with ${response.status}: ${response.text.slice(0, 160)}`);
  assert(response.json?.data?.clientSecret, "create-intent did not return a client secret");
  assert(!response.text.includes("stripePaymentIntentId"), "portal create-intent exposed raw Stripe PaymentIntent field name");
  return response.json.data as PortalCreateIntentData;
}

async function portalConfirm(invoiceId: string, paymentIntentId: string) {
  const response = await request<any>(`/api/portal/invoices/${encodeURIComponent(invoiceId)}/payments/stripe/confirm`, {
    method: "POST",
    body: JSON.stringify({ paymentIntentId }),
  });
  assert(response.ok, `portal confirm failed with ${response.status}: ${response.text.slice(0, 160)}`);
  assert(!response.text.includes("stripePaymentIntentId"), "portal confirm exposed raw Stripe PaymentIntent field name");
  return response.json?.data;
}

function syntheticPaymentIntentForWebhook(pi: any) {
  return {
    id: String(pi.id),
    object: "payment_intent",
    amount: Number(pi.amount || 0),
    amount_received: Number(pi.amount_received || 0),
    currency: String(pi.currency || "usd"),
    metadata: pi.metadata || {},
    status: String(pi.status || ""),
  };
}

async function postSignedWebhook(params: {
  eventId: string;
  type: "payment_intent.succeeded" | "payment_intent.payment_failed";
  paymentIntent: any;
  stripeAccountId?: string | null;
}) {
  const stripe = getStripeClient();
  const payload = JSON.stringify({
    id: params.eventId,
    object: "event",
    type: params.type,
    livemode: false,
    created: Math.floor(Date.now() / 1000),
    data: { object: syntheticPaymentIntentForWebhook(params.paymentIntent) },
    ...(params.stripeAccountId ? { account: params.stripeAccountId } : {}),
  });
  const signature = stripe.webhooks.generateTestHeaderString({
    payload,
    secret: String(process.env.STRIPE_WEBHOOK_SECRET || ""),
  });

  const response = await fetch(`${config.baseUrl}/api/payments/stripe/webhook`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Stripe-Signature": signature,
    },
    body: payload,
  });
  const text = await response.text();
  assert(response.ok, `webhook ${params.type} failed with ${response.status}: ${text.slice(0, 160)}`);
  return { status: response.status, text };
}

async function assertWebhookSignaturePathReady() {
  const stripe = getStripeClient();
  const payload = JSON.stringify({
    id: `evt_portal_validation_${seed.seedKey.replace(/[^a-z0-9_]/gi, "_")}_health_${Date.now()}`,
    object: "event",
    type: "portal.validation.healthcheck",
    livemode: false,
    created: Math.floor(Date.now() / 1000),
    data: { object: { object: "portal_validation_healthcheck" } },
  });
  const signature = stripe.webhooks.generateTestHeaderString({
    payload,
    secret: String(process.env.STRIPE_WEBHOOK_SECRET || ""),
  });

  const response = await fetch(`${config.baseUrl}/api/payments/stripe/webhook`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Stripe-Signature": signature,
    },
    body: payload,
  });
  const text = await response.text();
  assert(
    response.ok,
    `webhook signature health check failed with ${response.status}: ${text.slice(0, 160)}. Restart the local server with the same STRIPE_WEBHOOK_SECRET used by this validator.`,
  );
}

async function getPortalInvoice(invoiceId: string) {
  const response = await request<any>(`/api/portal/invoices/${encodeURIComponent(invoiceId)}`);
  assert(response.ok, `invoice detail failed with ${response.status}`);
  return response.json?.data;
}

async function getPortalPayments(invoiceId: string) {
  const response = await request<any>(`/api/portal/invoices/${encodeURIComponent(invoiceId)}/payments`);
  assert(response.ok, `payment history failed with ${response.status}`);
  return Array.isArray(response.json?.data) ? response.json.data : [];
}

async function getDbPaymentRows(invoiceId: string, paymentIntentId: string) {
  return db
    .select()
    .from(payments)
    .where(
      and(
        eq(payments.organizationId, seed.organizationId),
        eq(payments.invoiceId, invoiceId),
        eq(payments.stripePaymentIntentId, paymentIntentId),
      ),
    );
}

async function getDbInvoice(invoiceId: string) {
  const [invoice] = await db.select().from(invoices).where(eq(invoices.id, invoiceId)).limit(1);
  return invoice;
}

async function assertSingleStripePayment(invoiceId: string, paymentIntentId: string, expectedStatus: string) {
  const rows = await getDbPaymentRows(invoiceId, paymentIntentId);
  assert(rows.length === 1, `expected exactly one Stripe payment row, got ${rows.length}`);
  assert(String((rows[0] as any).status) === expectedStatus, `expected payment status ${expectedStatus}, got ${(rows[0] as any).status}`);
}

async function assertInvoicePaid(invoiceId: string) {
  const invoice = await getPortalInvoice(invoiceId);
  assert(String(invoice.status) === "paid", `expected portal invoice paid, got ${invoice.status}`);
  assert(Number(invoice.amountDue) === 0, `expected amountDue 0, got ${invoice.amountDue}`);
  const dbInvoice = await getDbInvoice(invoiceId);
  assert(String((dbInvoice as any)?.status) === "paid", `expected DB invoice paid, got ${(dbInvoice as any)?.status}`);
}

async function assertInvoiceStillPayable(invoiceId: string) {
  const invoice = await getPortalInvoice(invoiceId);
  assert(["sent", "open", "partially_paid", "overdue"].includes(String(invoice.status)), `expected payable status, got ${invoice.status}`);
  assert(Number(invoice.amountDue) > 0, `expected amountDue > 0, got ${invoice.amountDue}`);
}

async function confirmPaymentIntentWithTestCard(params: {
  clientSecret: string;
  stripeAccountId?: string | null;
  paymentMethod: "pm_card_visa" | "pm_card_chargeDeclined";
}) {
  const stripe = getStripeClient();
  const paymentIntentId = extractPaymentIntentId(params.clientSecret);
  try {
    return await stripe.paymentIntents.confirm(
      paymentIntentId,
      {
        payment_method: params.paymentMethod,
        return_url: `${config.baseUrl}/portal/invoices`,
      },
      stripeRequestOptions(params.stripeAccountId),
    );
  } catch (error: any) {
    if (params.paymentMethod === "pm_card_chargeDeclined") {
      const retrieved = await stripe.paymentIntents.retrieve(paymentIntentId, stripeRequestOptions(params.stripeAccountId));
      return retrieved;
    }
    throw error;
  }
}

async function validateConfirmBeforeWebhook() {
  const invoiceId = seed.invoiceIds.stripeConfirmFirst;
  const intent = await createIntent(invoiceId);
  const paymentIntentId = extractPaymentIntentId(intent.clientSecret);
  const confirmed = await confirmPaymentIntentWithTestCard({
    clientSecret: intent.clientSecret,
    stripeAccountId: intent.stripeAccountId,
    paymentMethod: "pm_card_visa",
  });
  assert(String((confirmed as any).status) === "succeeded", `expected Stripe test PaymentIntent succeeded, got ${(confirmed as any).status}`);

  await portalConfirm(invoiceId, paymentIntentId);
  await portalConfirm(invoiceId, paymentIntentId);
  await assertSingleStripePayment(invoiceId, paymentIntentId, "succeeded");
  await assertInvoicePaid(invoiceId);

  const eventId = `evt_portal_validation_${seed.seedKey.replace(/[^a-z0-9_]/gi, "_")}_confirm_first_${Date.now()}`;
  await postSignedWebhook({
    eventId,
    type: "payment_intent.succeeded",
    paymentIntent: confirmed,
    stripeAccountId: intent.stripeAccountId,
  });
  await postSignedWebhook({
    eventId,
    type: "payment_intent.succeeded",
    paymentIntent: confirmed,
    stripeAccountId: intent.stripeAccountId,
  });
  await assertSingleStripePayment(invoiceId, paymentIntentId, "succeeded");
  await assertInvoicePaid(invoiceId);

  const stale = await request<any>(`/api/portal/invoices/${encodeURIComponent(invoiceId)}/payments/stripe/create-intent`, {
    method: "POST",
    body: JSON.stringify({}),
  });
  assert(stale.status === 409, `expected paid invoice create-intent to return 409, got ${stale.status}`);

  const webhookRows = await db
    .select()
    .from(paymentWebhookEvents)
    .where(and(eq(paymentWebhookEvents.provider, "stripe"), eq(paymentWebhookEvents.eventId, eventId)));
  assert(webhookRows.length === 1, `expected one webhook event row after replay, got ${webhookRows.length}`);
}

async function validateWebhookBeforeConfirm() {
  const invoiceId = seed.invoiceIds.stripeWebhookFirst;
  const intent = await createIntent(invoiceId);
  const paymentIntentId = extractPaymentIntentId(intent.clientSecret);
  const confirmed = await confirmPaymentIntentWithTestCard({
    clientSecret: intent.clientSecret,
    stripeAccountId: intent.stripeAccountId,
    paymentMethod: "pm_card_visa",
  });
  assert(String((confirmed as any).status) === "succeeded", `expected Stripe test PaymentIntent succeeded, got ${(confirmed as any).status}`);

  const eventId = `evt_portal_validation_${seed.seedKey.replace(/[^a-z0-9_]/gi, "_")}_webhook_first_${Date.now()}`;
  await postSignedWebhook({
    eventId,
    type: "payment_intent.succeeded",
    paymentIntent: confirmed,
    stripeAccountId: intent.stripeAccountId,
  });
  await postSignedWebhook({
    eventId,
    type: "payment_intent.succeeded",
    paymentIntent: confirmed,
    stripeAccountId: intent.stripeAccountId,
  });

  await portalConfirm(invoiceId, paymentIntentId);
  await portalConfirm(invoiceId, paymentIntentId);
  await assertSingleStripePayment(invoiceId, paymentIntentId, "succeeded");
  await assertInvoicePaid(invoiceId);

  const history = await getPortalPayments(invoiceId);
  assert(history.filter((row: any) => row.status === "succeeded").length === 1, "expected one portal-visible succeeded payment");
}

async function validateFailedPaymentDoesNotMutateInvoice() {
  const invoiceId = seed.invoiceIds.stripeFailed;
  const intent = await createIntent(invoiceId);
  const paymentIntentId = extractPaymentIntentId(intent.clientSecret);
  const failedPi = await confirmPaymentIntentWithTestCard({
    clientSecret: intent.clientSecret,
    stripeAccountId: intent.stripeAccountId,
    paymentMethod: "pm_card_chargeDeclined",
  });

  await portalConfirm(invoiceId, paymentIntentId);
  await postSignedWebhook({
    eventId: `evt_portal_validation_${seed.seedKey.replace(/[^a-z0-9_]/gi, "_")}_failed_${Date.now()}`,
    type: "payment_intent.payment_failed",
    paymentIntent: failedPi,
    stripeAccountId: intent.stripeAccountId,
  });

  await assertSingleStripePayment(invoiceId, paymentIntentId, "failed");
  await assertInvoiceStillPayable(invoiceId);
}

async function main() {
  const safetyErrors = getPortalStripeValidationSafetyErrors(config);
  if (safetyErrors.length > 0) {
    console.log(
      JSON.stringify(
        {
          stripeDevSetup: safeStripeSetupSummary(),
          refused: safetyErrors,
          nextSteps: [
            "Run the portal seed first with ALLOW_DEV_PORTAL_SEED=1.",
            `Run: stripe listen --forward-to ${config.baseUrl}/api/payments/stripe/webhook`,
            "Restart the local server with STRIPE_WEBHOOK_SECRET set to the whsec_ value printed by Stripe CLI.",
          ],
        },
        null,
        2,
      ),
    );
    process.exitCode = 1;
    return;
  }

  console.warn("DEV Stripe validation writes test-mode payment rows to the connected database.");
  console.warn("Frontend success remains TEMP; this script validates backend confirm and webhook-safe reconciliation.");

  await assertWebhookSignaturePathReady();
  await login();

  const portalInvoices = await request<any>("/api/portal/invoices");
  record("seeded Stripe validation invoices are portal-visible", () => {
    assert(portalInvoices.ok, `invoice list failed with ${portalInvoices.status}`);
    const rows = Array.isArray(portalInvoices.json?.data) ? portalInvoices.json.data : [];
    const numbers = new Set(rows.map((invoice: any) => Number(invoice.invoiceNumber)));
    assert(numbers.has(seed.invoiceNumbers.stripeConfirmFirst), "confirm-first invoice missing from portal list");
    assert(numbers.has(seed.invoiceNumbers.stripeWebhookFirst), "webhook-first invoice missing from portal list");
    assert(numbers.has(seed.invoiceNumbers.stripeFailed), "failed-payment invoice missing from portal list");
  });

  await validateConfirmBeforeWebhook();
  passed.push({ step: "confirm-before-webhook is idempotent", ok: true });

  await validateWebhookBeforeConfirm();
  passed.push({ step: "webhook-before-confirm is idempotent", ok: true });

  await validateFailedPaymentDoesNotMutateInvoice();
  passed.push({ step: "failed Stripe test payment does not mutate invoice paid state", ok: true });

  const report = {
    baseUrl: config.baseUrl,
    email: config.email,
    stripeDevSetup: safeStripeSetupSummary(),
    invoiceNumbers: {
      confirmBeforeWebhook: seed.invoiceNumbers.stripeConfirmFirst,
      webhookBeforeConfirm: seed.invoiceNumbers.stripeWebhookFirst,
      failedPayment: seed.invoiceNumbers.stripeFailed,
    },
    passed,
    failed,
    securityChecks: [
      "No live Stripe keys accepted by this DEV validation runner.",
      "No raw PaymentIntent IDs, client secrets, account IDs, or connection strings are printed.",
      "Synthetic webhook payloads omit client_secret.",
      "Portal responses are checked for absence of stripePaymentIntentId field names.",
    ],
  };

  console.log(JSON.stringify(report, null, 2));
  if (failed.length > 0) process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error(sanitizeDiagnostic(error?.message || String(error)));
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
