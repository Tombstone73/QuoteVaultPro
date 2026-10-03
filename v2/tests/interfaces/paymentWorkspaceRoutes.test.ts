import { describe, expect, test } from "@jest/globals";
import express from "express";
import request from "supertest";
import { createPaymentWorkspaceRouter } from "../../src/interfaces/http/paymentWorkspaceRoutes.js";
import { PaymentWorkspaceApplicationService, type PaymentWorkspaceReadPort, type PaymentWorkspaceReadRunner } from "../../src/modules/billing/paymentWorkspace.js";
import { BillingPaymentsApplicationService, type BillingFinancialTransaction, type BillingFinancialTransactionRunner } from "../../src/modules/billing/paymentApplication.js";
import { requireV2CsrfToken } from "../../infrastructure/authentication/sessionCsrf.js";
import { V2ApplicationError } from "../../src/errors/applicationError.js";
import type { Principal } from "../../src/authorization/principals.js";
import type { Capability } from "../../src/authorization/capabilities.js";
import { brandedId, currencyCode, money } from "../../src/modules/shared/commercialValues.js";

const usd = currencyCode("USD"), when = "2026-10-01T05:00:00.000Z", token = "trusted-session-csrf-token";
const body = { businessRequestId: "payment-request", occurredAt: when, method: "cash", allocations: [{ invoiceId: "invoice-a", amount: { currency: "USD", cents: 5000 } }, { invoiceId: "invoice-b", amount: { currency: "USD", cents: 3750 } }], tender: { tendered: { currency: "USD", cents: 10000 }, expectedBalances: [{ invoiceId: "invoice-a", collectibleBalance: { currency: "USD", cents: 5000 } }, { invoiceId: "invoice-b", collectibleBalance: { currency: "USD", cents: 3750 } }] } };
const principal = (capabilities: readonly Capability[] = ["payment.view", "payment.record", "invoice.view"]): Principal => ({ kind: "staff", organizationId: "org-a", userId: "staff-a", authority: { membershipId: "membership-a", capabilities } });
function fixture() {
  let identity: Principal = principal(), paid = new Map<string, number>(), transactions = 0, records = 0, providerCalls = 0, reads = 0, failLifecycle = false;
  const reconciledInvoices: string[] = [];
  const totals = new Map([["invoice-a", 5000], ["invoice-b", 3750]]), requests = new Map<string, { fingerprint: string; result: unknown | null }>();
  const unsupported = async (): Promise<never> => { providerCalls++; throw Error("Legacy/provider operation must not be called"); };
  const readCalls: unknown[][] = [];
  const tx = {
    lockInvoice: unsupported, recordPayment: unsupported, recordRefund: unsupported, confirmProviderPayment: unsupported, confirmProviderRefund: unsupported,
    lockInvoices: async (org, ids) => org === "org-a" ? ids.filter((id) => totals.has(id)).map((id) => ({ invoiceId: id, currency: "USD", customerId: "customer-a", totalCents: totals.get(id)!, lifecycle: "draft" as const })) : [],
    settlement: async (_org, id, currency, total) => ({ invoiceId: id, gross: money(currencyCode(currency), total), successfulPayments: money(usd, paid.get(id) ?? 0), successfulRefunds: money(usd, 0), collectibleBalance: money(usd, total - (paid.get(id) ?? 0)) }),
    pendingProviderPaymentCents: async () => 0,
    reserve: async (input) => {
      const saved = requests.get(input.businessRequestId);
      if (saved && saved.fingerprint !== input.payloadFingerprint) throw new V2ApplicationError("IDEMPOTENCY_CONFLICT", "Existing request has different tender evidence.");
      if (saved) return { kind: "replay" as const, request: { id: input.businessRequestId, resultJson: structuredClone(saved.result) } };
      requests.set(input.businessRequestId, { fingerprint: input.payloadFingerprint, result: null });
      return { kind: "new" as const, request: { id: input.businessRequestId, resultJson: null } };
    },
    recordPaymentAggregate: async (input) => {
      records++;
      for (const allocation of input.allocations) paid.set(allocation.invoiceId, (paid.get(allocation.invoiceId) ?? 0) + allocation.amount.cents);
      return { payment: { paymentId: brandedId<"PaymentId">("canonical-payment"), invoiceId: input.allocations[0].invoiceId, amount: money(usd, input.allocations.reduce((sum, entry) => sum + entry.amount.cents, 0)), method: input.method as "cash", source: "manual" as const, occurredAt: input.occurredAt }, allocations: input.allocations };
    },
    attribute: async () => {}, audit: async () => {}, enqueue: async () => {}, succeed: async (_org, id, _type, _resource, result) => { requests.get(id)!.result = structuredClone(result); },
    beginProvider: async () => { providerCalls++; throw Error("Providers must not be called"); },
  } satisfies BillingFinancialTransaction;
  const runner: BillingFinancialTransactionRunner = { async transaction(action) {
    transactions++; const before = structuredClone({ paid, records, requests });
    try { return await action(tx); }
    catch (error) { paid = before.paid; records = before.records; requests.clear(); for (const [id, value] of before.requests) requests.set(id, value); throw error; }
  } };
  const window = { asOf: when, timeZone: "UTC", timeZoneSource: "default_utc" as const, startInclusive: "2026-10-01T00:00:00.000Z", endExclusive: "2026-10-02T00:00:00.000Z", todayDate: "2026-10-01", tomorrowDate: "2026-10-02" };
  const summary = { paymentCount: 0, byCurrency: [] };
  const port: PaymentWorkspaceReadPort = {
    readWindow: async (...args) => { readCalls.push(args); return window; },
    pagePayments: async (...args) => { readCalls.push(args); return { scope: "v2_payment_facts", window: args[2], summary, items: [], page: 1, pageSize: 25, totalMatching: 0, hasNextPage: false }; },
    summarizePayments: async (...args) => { readCalls.push(args); return { scope: "v2_payment_facts", window: args[2], summary }; },
    listCustomers: async () => [], pageCollectibleInvoices: async () => ({ items: [], page: 1, pageSize: 25, hasNextPage: false }),
  };
  const readRunner: PaymentWorkspaceReadRunner = { read: async (action) => { reads++; return action(port); } };
  const canonical = new BillingPaymentsApplicationService(runner, undefined, { reconcileOrder: async () => {}, reconcileInvoice: async (_org, id) => { reconciledInvoices.push(id); if (failLifecycle) throw new V2ApplicationError("STALE_STATE", "Injected post-commit lifecycle failure"); } });
  const service = new PaymentWorkspaceApplicationService(readRunner, canonical, undefined, () => new Date(when));
  const app = express(); app.use(express.json({ limit: "32kb" }));
  app.use((req, _res, next) => { Object.assign(req, { session: { v2CsrfToken: token } }); next(); });
  app.use("/v2/organizations/:organizationId/payment-workspace", createPaymentWorkspaceRouter({ service, requireCsrf: requireV2CsrfToken, principals: { principal: async () => identity } }));
  const path = "/v2/organizations/org-a/payment-workspace";
  return { app, path, readCalls, reconciledInvoices, failLifecycle: (fail: boolean) => { failLifecycle = fail; }, identity: (next: Principal) => { identity = next; }, balance: (id: string, value: number) => paid.set(id, value), state: () => ({ records, providerCalls, transactions, reads, paid: Object.fromEntries(paid) }) };
}

describe("Payment workspace HTTP owner boundary", () => {
  test("manual HTTP executes actual canonical multi-invoice operation and returns applied/change receipt", async () => {
    const f = fixture();
    const result = await request(f.app).post(`${f.path}/manual`).set("x-v2-csrf-token", token).send(body).expect(200);
    expect(result.body.data).toMatchObject({ payment: { payment: { paymentId: "canonical-payment", amount: { currency: "USD", cents: 8750 } }, allocations: body.allocations }, tenderReceipt: { applied: { cents: 8750 }, tendered: { cents: 10000 }, changeDue: { cents: 1250 } } });
    expect(f.state()).toMatchObject({ records: 1, providerCalls: 0, paid: { "invoice-a": 5000, "invoice-b": 3750 } });
    expect(result.headers["cache-control"]).toBe("private, no-store");
    const retry = await request(f.app).post(`${f.path}/manual`).set("x-v2-csrf-token", token).send(body).expect(200);
    expect(retry.body).toEqual(result.body); expect(f.state().records).toBe(1);
    const changed = { ...body, tender: { ...body.tender, tendered: { currency: "USD", cents: 11000 } } };
    expect((await request(f.app).post(`${f.path}/manual`).set("x-v2-csrf-token", token).send(changed).expect(409)).body.error.code).toBe("IDEMPOTENCY_CONFLICT");
    expect(f.state().records).toBe(1);
  });
  test.each([undefined, "wrong-token"])("real session CSRF rejects %s before canonical work", async (supplied) => {
    const f = fixture(), action = request(f.app).post(`${f.path}/manual`);
    if (supplied) action.set("x-v2-csrf-token", supplied);
    const result = await action.send(body).expect(403);
    expect(result.body.error.message).toMatch(/CSRF/); expect(f.state()).toMatchObject({ transactions: 0, records: 0, providerCalls: 0 });
  });
  test.each([[["payment.record"]], [["invoice.view"]], [[]]] as readonly [readonly Capability[]][])("picker and record deny incomplete authority %j", async (caps) => {
    const f = fixture(); f.identity(principal(caps));
    await request(f.app).get(`${f.path}/invoices?customerId=customer-a`).expect(403);
    await request(f.app).post(`${f.path}/manual`).set("x-v2-csrf-token", token).send(body).expect(403);
    expect(f.state()).toMatchObject({ reads: 0, transactions: 0, records: 0 });
  });
  test("Staff-only reads/commands refuse Portal and Service, even with matching capabilities", async () => {
    const f = fixture();
    for (const identity of [{ kind: "portal" as const, organizationId: "org-a", customerId: "customer-a", subjectId: "portal-a", capabilities: ["payment.view", "invoice.view", "payment.record"] as const }, { kind: "service" as const, organizationId: "org-a", clientId: "service-a", capabilities: ["payment.view", "invoice.view", "payment.record"] as const }]) {
      f.identity(identity); await request(f.app).get(f.path).expect(403);
      await request(f.app).post(`${f.path}/manual`).set("x-v2-csrf-token", token).send(body).expect(403);
    }
    expect(f.state()).toMatchObject({ reads: 0, transactions: 0 });
  });
  test("foreign tenant and foreign Invoice fail without recording or leaking data", async () => {
    const f = fixture();
    const foreign = f.path.replace("org-a", "org-b");
    expect((await request(f.app).get(foreign).expect(404)).body.error.code).toBe("WRONG_TENANT");
    await request(f.app).post(`${foreign}/manual`).set("x-v2-csrf-token", token).send(body).expect(404);
    const bad = { ...body, allocations: [{ ...body.allocations[0], invoiceId: "foreign-invoice" }], tender: { ...body.tender, expectedBalances: [{ ...body.tender.expectedBalances[0], invoiceId: "foreign-invoice" }] } };
    await request(f.app).post(`${f.path}/manual`).set("x-v2-csrf-token", token).send(bad).expect(404);
    expect(f.state()).toMatchObject({ records: 0, providerCalls: 0 });
  });
  test("stale canonical balances return 409, with no silent allocation/payment", async () => {
    const f = fixture(); f.balance("invoice-a", 1000);
    const result = await request(f.app).post(`${f.path}/manual`).set("x-v2-csrf-token", token).send(body).expect(409);
    expect(result.body.error.code).toBe("STALE_STATE"); expect(f.state().records).toBe(0);
  });
  test("post-commit hook failure returns retryable 503, then original request recovers its stored receipt once", async () => {
    const f = fixture(); f.failLifecycle(true);
    const uncertain = await request(f.app).post(`${f.path}/manual`).set("x-v2-csrf-token", token).send(body).expect(503);
    expect(uncertain.body.error.code).toBe("RETRYABLE_FAILURE");
    expect(uncertain.body.error.message).toMatch(/original business request/);
    expect(f.state()).toMatchObject({ records: 1, providerCalls: 0, paid: { "invoice-a": 5000, "invoice-b": 3750 } });
    f.identity(principal(["payment.record"]));
    await request(f.app).post(`${f.path}/manual`).set("x-v2-csrf-token", token).send(body).expect(403);
    expect(f.reconciledInvoices).toHaveLength(2);
    f.identity(principal()); f.failLifecycle(false);
    const replay = await request(f.app).post(`${f.path}/manual`).set("x-v2-csrf-token", token).send(body).expect(200);
    expect(replay.body.data).toMatchObject({ payment: { payment: { paymentId: "canonical-payment", amount: { cents: 8750 } } }, tenderReceipt: { tendered: { cents: 10000 }, changeDue: { cents: 1250 } } });
    expect(f.state().records).toBe(1); expect(f.reconciledInvoices).toEqual(["invoice-a", "invoice-b", "invoice-a", "invoice-b"]);
  });
  test("strict input rejects forged clocks, principal/organization claims and provider methods", async () => {
    const f = fixture();
    for (const query of ["asOf=1990-01-01", "timeZone=UTC", "period=year", "period=today&fromDate=2026-10-01", "page=0", "pageSize=101", "customerId=a&customerId=b", "period=custom&fromDate=2026-02-30&toDate=2026-03-01"]) await request(f.app).get(`${f.path}?${query}`).expect(400);
    for (const input of [{ ...body, principal: principal() }, { ...body, organizationId: "org-b" }, { ...body, method: "card" }, { ...body, method: "ach" }, { ...body, tender: undefined }, { ...body, occurredAt: "2026-02-30T05:00:00Z" }, { ...body, tender: { ...body.tender, tendered: { currency: "USD", cents: 100.01 } } }]) await request(f.app).post(`${f.path}/manual`).set("x-v2-csrf-token", token).send(input).expect(400);
    expect(f.state()).toMatchObject({ records: 0, transactions: 0, providerCalls: 0 });
  });
  test("Dashboard summary uses the same reporting window as the list; no public asOf override", async () => {
    const f = fixture(), filter = "?period=month&customerId=customer-a&method=cash";
    const page = await request(f.app).get(f.path + filter).expect(200), summary = await request(f.app).get(`${f.path}/summary${filter}`).expect(200);
    expect(summary.body.data.window).toEqual(page.body.data.window); expect(summary.body.data.summary).toEqual(page.body.data.summary);
    expect(f.readCalls.filter((args) => args.length === 3 && args[2] instanceof Date).map((args) => args[2])).toEqual([new Date(when), new Date(when)]);
    await request(f.app).get(`${f.path}/summary?period=today&asOf=1990-01-01`).expect(400);
  });
  test("noncash excess is validation failure; no provider invoked", async () => {
    const f = fixture(); await request(f.app).post(`${f.path}/manual`).set("x-v2-csrf-token", token).send({ ...body, method: "check" }).expect(400);
    expect(f.state()).toMatchObject({ transactions: 0, records: 0, providerCalls: 0 });
  });
});
