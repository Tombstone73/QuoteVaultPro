import { afterAll, afterEach, beforeAll, describe, expect, jest, test } from "@jest/globals";
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import React, { act } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { JSDOM } from "jsdom";
import type { RequestHandler } from "express";
import type { Pool } from "pg";
import request from "supertest";
import { createV2HttpApp } from "../../src/interfaces/http/app.js";
import { loadV2RuntimeConfig } from "../../src/config/runtimeConfig.js";
import { createPaymentWorkspaceDependencies } from "../../infrastructure/billing/authenticatedPaymentWorkspaceRuntime.js";
import { requireV2CsrfToken } from "../../infrastructure/authentication/sessionCsrf.js";
import { IssuedV2PrincipalProvider, PassportSessionIdentitySource } from "../../infrastructure/authentication/trustedHostPrincipalProvider.js";
import { PermissionSetPrincipalIssuer } from "../../src/authorization/permissionSets.js";
import type { Capability } from "../../src/authorization/capabilities.js";
import { BillingPaymentsApplicationService, type BillingFinancialTransaction, type BillingFinancialTransactionRunner } from "../../src/modules/billing/paymentApplication.js";
import { brandedId, currencyCode, money } from "../../src/modules/shared/commercialValues.js";
import { V2ApplicationError } from "../../src/errors/applicationError.js";
import { FinancialReadApplicationService, type FinancialReadPort } from "../../src/modules/billing/financialReadApplication.js";

const path = "/v2/organizations/org-a/payment-workspace";
const token = "trusted-payment-mount-csrf";
const body = { businessRequestId: "mount-payment", method: "cash", occurredAt: "2026-03-08T12:00:00.000Z",
  allocations: [{ invoiceId: "invoice-a", amount: { currency: "USD", cents: 8750 } }],
  tender: { tendered: { currency: "USD", cents: 10000 }, expectedBalances: [{ invoiceId: "invoice-a", collectibleBalance: { currency: "USD", cents: 8750 } }] } };
let browserIdentity = 0;

function fixture(browser = false) {
  const grants: readonly Capability[] = ["payment.view", "payment.record", "invoice.view", "customer.view", "order.view"];
  const state = { authenticated: true, userId: browser ? `staff-browser-${++browserIdentity}` : "staff-a", organizationId: "org-a", capabilities: browser ? grants : ["payment.view", "payment.record", "invoice.view"] as readonly Capability[], session: { v2CsrfToken: token, v2SessionScope: "payment-session-a" }, connections: 0, releases: 0, authorityReads: 0, transactions: 0, records: 0, balance: 8750, paid: 0,
    bootstrapGate: undefined as Promise<void> | undefined, commandGate: undefined as Promise<void> | undefined, resourceDenied: false, resourceFailure: undefined as "FORBIDDEN" | "CONFLICT" | undefined, failHook: false };
  const sql: { text: string; values?: readonly unknown[] }[] = [];
  const pool = { connect: async () => {
    state.connections++;
    return { query: async (text: string, values?: readonly unknown[]) => {
      sql.push({ text, values });
      if (/^(BEGIN|COMMIT|ROLLBACK)/.test(text)) return { rows: [] };
      if (state.resourceFailure) throw new V2ApplicationError(state.resourceFailure, "The financial resource is unavailable");
      if (state.resourceDenied) throw new V2ApplicationError("FORBIDDEN", "The financial resource is denied");
      expect(values?.[0]).toBe(/pg_timezone_names/.test(text) || /WITH local_clock/.test(text) ? "America/New_York" : state.organizationId);
      if (/FROM organizations/.test(text)) return { rows: [{ timezone: "America/New_York" }] };
      if (/pg_timezone_names/.test(text)) return { rows: [{ valid: true }] };
      if (/WITH local_clock/.test(text)) return { rows: [{ start_inclusive: new Date("2026-03-08T05:00:00Z"), end_exclusive: new Date("2026-03-09T04:00:00Z"), today_date: "2026-03-08", tomorrow_date: "2026-03-09", dates_valid: true }] };
      if (/FROM facts GROUP BY/.test(text)) return { rows: state.organizationId === "org-a" ? [{ currency: "USD", count: "1", amount: "8750", applied: "8750", refunded: "1000", net: "7750" }] : [] };
      if (/FROM customers/.test(text)) return { rows: browser && state.organizationId === "org-a" ? [{ id: "customer-a", name: "Local Customer" }] : [] };
      if (/WITH balances/.test(text)) return { rows: browser && !state.paid ? [{ id: "invoice-a", invoice_display_number: "INV-A", order_id: "order-a", order_number: "ORD-A", customer_id: "customer-a", customer_name: "Local Customer", currency: "USD", balance: "8750" }] : [] };
      if (/FROM selected p/.test(text)) return { rows: [] };
      throw Error(`Unexpected read: ${text}`);
    }, release: () => { state.releases++; } };
  } } as unknown as Pool;
  const unsupported = async (): Promise<never> => { throw Error("Only the injected canonical aggregate owner may record"); };
  const stored = new Map<string, { fingerprint: string; result: unknown | null }>();
  const usd = currencyCode("USD");
  const tx = {
    reserve: async (input) => {
      const previous = stored.get(input.businessRequestId);
      if (previous && previous.fingerprint !== input.payloadFingerprint) throw new V2ApplicationError("IDEMPOTENCY_CONFLICT", "Different original payment request");
      if (previous) return { kind: "replay" as const, request: { id: input.businessRequestId, resultJson: previous.result } };
      stored.set(input.businessRequestId, { fingerprint: input.payloadFingerprint, result: null });
      return { kind: "new" as const, request: { id: input.businessRequestId, resultJson: null } };
    },
    lockInvoices: async (org, ids) => org === "org-a" && ids.length === 1 && ids[0] === "invoice-a" ? [{ invoiceId: ids[0], customerId: "customer-a", currency: "USD", totalCents: state.balance, lifecycle: "issued" as const }] : [],
    settlement: async (_org, id, currency, gross) => ({ invoiceId: id, gross: money(currencyCode(currency), gross), successfulPayments: money(usd, state.paid), successfulRefunds: money(usd, 0), collectibleBalance: money(usd, gross - state.paid) }),
    recordPaymentAggregate: async (input) => {
      state.records++;
      state.paid += input.allocations.reduce((sum, allocation) => sum + allocation.amount.cents, 0);
      return { payment: { paymentId: brandedId<"PaymentId">("canonical-mount-payment"), invoiceId: input.allocations[0].invoiceId, amount: money(usd, state.paid), method: input.method as "cash", source: "manual" as const, occurredAt: input.occurredAt }, allocations: input.allocations };
    },
    succeed: async (_org, id, _type, _resource, result) => { stored.get(id)!.result = result; },
    attribute: async () => {}, audit: async () => {}, enqueue: async () => {},
    lockInvoice: unsupported, recordPayment: unsupported, recordRefund: unsupported, beginProvider: unsupported, confirmProviderPayment: unsupported, confirmProviderRefund: unsupported,
  } satisfies BillingFinancialTransaction;
  const runner: BillingFinancialTransactionRunner = { transaction: async (action) => {
    state.transactions++;
    const before = structuredClone({ stored, paid: state.paid, records: state.records });
    try { return await action(tx); }
    catch (error) { stored.clear(); for (const [id, value] of before.stored) stored.set(id, value); state.paid = before.paid; state.records = before.records; throw error; }
  } };
  const canonical = new BillingPaymentsApplicationService(runner, undefined, { reconcileOrder: async () => {}, reconcileInvoice: async () => { if (state.failHook) throw Error("Committed; lifecycle hook failed"); } });
  const principals = new IssuedV2PrincipalProvider(new PassportSessionIdentitySource(), new PermissionSetPrincipalIssuer({
    resolveStaff: async (userId, organizationId) => {
      state.authorityReads++;
      return userId === state.userId && organizationId === state.organizationId ? { organizationId, organizationActive: true, authorityRevision: state.authorityReads,
        staff: { userId, membershipId: "member-a", membershipActive: true, permissionSets: [{ id: "accounting", name: "Accounting", active: true, revision: 1 }], capabilities: state.capabilities, teamAccessManagement: false } } : null;
    }, resolvePortal: async () => null,
  }));
  const trustedHostMiddleware: RequestHandler = (req, response, next) => {
    if (!state.authenticated) { response.status(403).json({ ok: false, error: { code: "FORBIDDEN", message: "Trusted session required" } }); return; }
    Object.assign(req, { session: state.session, sessionID: "trusted-session", user: { id: state.userId }, isAuthenticated: () => state.authenticated });
    const gate = req.path.endsWith("/ui-bootstrap") ? state.bootstrapGate : req.method === "POST" && req.path.endsWith("/manual") ? state.commandGate : undefined;
    if (gate) void gate.then(() => next(), next); else next();
  };
  const args: Parameters<typeof createV2HttpApp> = [loadV2RuntimeConfig({ NODE_ENV: "test", V2_SERVICE_NAME: "payment-mount-test" }), { log: () => {} }];
  if (browser) {
    const emptySummary = { totalMatching: 0, outstanding: [], openInvoiceCount: 0, unpaid: { count: 0, balance: [] }, partiallyPaid: { count: 0, balance: [] }, paid: { count: 0, balance: [] }, creditDue: { count: 0, balance: [] } };
    const financialPort: FinancialReadPort = {
      readFinancialInvoice: async () => null, readLegacyFinancialInvoice: async () => null, listFinancialInvoices: async () => [], summarizeFinancialInvoices: async () => emptySummary,
      pageFinancialInvoices: async () => ({ items: [], page: 1, pageSize: 25, totalMatching: 0, hasNextPage: false, summary: emptySummary }),
      pageFinancialLedger: async () => {
        if (state.resourceDenied) throw new V2ApplicationError("FORBIDDEN", "The financial resource is denied");
        return { items: [{ kind: "payment", id: brandedId<"PaymentId">("ledger-payment"), amount: money(usd, 8750), balanceAfter: money(usd, 0), method: "cash", source: "manual", occurredAt: body.occurredAt, recordedAt: body.occurredAt,
          recordSource: "v2", recordId: "ledger-payment", invoiceId: brandedId<"InvoiceId">("invoice-a"), sourceOrderId: "order-a", sourceOrderNumber: "ORD-A", customerId: "customer-a", customerName: "Local Customer" }], page: 1, pageSize: 25, totalMatching: 1, hasNextPage: false };
      },
    };
    // Unexercised nonfinancial routes have no ports. Browser probes execute the
    // actual bootstrap/action router and real canonical financial services only.
    args[3] = { trustedHostMiddleware, dependencies: { principals, formReads: { customers: async () => [], contacts: async () => [], products: async () => [], configuration: async () => null } },
      actionCenterDependencies: { principals, reader: { summary: async () => [] } } } as unknown as Parameters<typeof createV2HttpApp>[3];
    args[5] = { trustedHostMiddleware, dependencies: { principals, payments: canonical, financialRead: new FinancialReadApplicationService({ read: async (action) => action(financialPort) }) } } as unknown as Parameters<typeof createV2HttpApp>[5];
  }
  args[23] = { trustedHostMiddleware, dependencies: createPaymentWorkspaceDependencies({ pool, principals, payments: canonical, requireCsrf: requireV2CsrfToken }) };
  return { app: createV2HttpApp(...args), state, sql, grants, receipts: stored, principals };
}

describe("Mounted Payment workspace authenticated integration", () => {
  test("actual app mount uses PostgreSQL snapshot and server window for page and Dashboard summary", async () => {
    const f = fixture();
    const page = await request(f.app).get(`${path}?period=today`).expect(200);
    const summary = await request(f.app).get(`${path}/summary?period=today`).expect(200);
    expect(page.body.data.summary).toEqual(summary.body.data.summary);
    for (const result of [page, summary]) {
      expect(result.headers["x-v2-session-scope"]).toBe("payment-session-a");
      expect(result.headers["cache-control"]).toBe("private, no-store");
      expect(result.body.data).toMatchObject({ scope: "v2_payment_facts", window: { timeZone: "America/New_York", timeZoneSource: "organization", startInclusive: "2026-03-08T05:00:00.000Z", endExclusive: "2026-03-09T04:00:00.000Z" }, summary: { paymentCount: 1, byCurrency: [{ amountCents: 8750, refundedCents: 1000, netCents: 7750 }] } });
    }
    expect(f.sql.filter((entry) => entry.text.startsWith("BEGIN")).map((entry) => entry.text)).toEqual(Array(2).fill("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY"));
    expect(f.sql.filter((entry) => /WITH local_clock/.test(entry.text)).map((entry) => entry.values?.[2])).toEqual(["today", "today"]);
    expect(f.state.connections).toBe(2); expect(f.state.releases).toBe(2);
  });
  test.each([undefined, "invalid-token"])("mounted CSRF rejects %s before any owner or Principal operation", async (supplied) => {
    const f = fixture(), command = request(f.app).post(`${path}/manual`);
    if (supplied) command.set("x-v2-csrf-token", supplied);
    expect((await command.send(body).expect(403)).body.error.message).toMatch(/CSRF/);
    expect(f.state).toMatchObject({ authorityReads: 0, transactions: 0, records: 0, connections: 0 });
  });
  test("trusted host denies every financial endpoint before dangerous reads without authentication", async () => {
    const f = fixture(); f.state.authenticated = false;
    for (const suffix of ["", "/summary", "/customers", "/invoices?customerId=customer-a"]) await request(f.app).get(path + suffix).expect(403);
    await request(f.app).post(`${path}/manual`).set("x-v2-csrf-token", token).send(body).expect(403);
    expect(f.state).toMatchObject({ authorityReads: 0, transactions: 0, records: 0, connections: 0 }); expect(f.sql).toEqual([]);
  });
  test("fresh permission loss denies cached read/picker/record without touching PostgreSQL or canonical transaction", async () => {
    const f = fixture(); await request(f.app).get(`${path}/summary?period=month`).expect(200);
    f.state.capabilities = ["order.view"];
    for (const suffix of ["", "/summary", "/customers", "/invoices?customerId=customer-a"]) await request(f.app).get(path + suffix).expect(403);
    await request(f.app).post(`${path}/manual`).set("x-v2-csrf-token", token).send(body).expect(403);
    expect(f.state).toMatchObject({ connections: 1, authorityReads: 6, transactions: 0, records: 0 });
  });
  test("Invoice picker requires both invoice.view and payment.record, not payment.view alone", async () => {
    const f = fixture(); f.state.capabilities = ["payment.view"];
    await request(f.app).get(`${path}/invoices?customerId=customer-a`).expect(403);
    expect(f.state.connections).toBe(0);
    f.state.capabilities = ["invoice.view", "payment.record"];
    await request(f.app).get(`${path}/invoices?customerId=customer-a`).expect(200);
    expect(f.state.connections).toBe(1);
  });
  test("path owns organization scope; forged body/clock and foreign path cannot reach the owner", async () => {
    const f = fixture();
    await request(f.app).get(path.replace("org-a", "org-b") + "/summary?period=month").expect(404);
    for (const query of ["organizationId=org-b", "asOf=1990-01-01", "timeZone=UTC"]) await request(f.app).get(`${path}/summary?${query}`).expect(400);
    await request(f.app).post(`${path}/manual`).set("x-v2-csrf-token", token).send({ ...body, organizationId: "org-b" }).expect(400);
    expect(f.state).toMatchObject({ connections: 0, transactions: 0, records: 0 });
  });
  test("injected existing canonical owner rejects stale balance then records/replays one aggregate receipt", async () => {
    const f = fixture(); f.state.balance = 8000;
    expect((await request(f.app).post(`${path}/manual`).set("x-v2-csrf-token", token).send(body).expect(409)).body.error.code).toBe("STALE_STATE");
    expect(f.state.records).toBe(0);
    f.state.balance = 8750;
    const result = await request(f.app).post(`${path}/manual`).set("x-v2-csrf-token", token).send(body).expect(200);
    expect(result.body.data).toMatchObject({ payment: { payment: { paymentId: "canonical-mount-payment", amount: { cents: 8750 } } }, tenderReceipt: { applied: { cents: 8750 }, changeDue: { cents: 1250 } } });
    expect((await request(f.app).post(`${path}/manual`).set("x-v2-csrf-token", token).send(body).expect(200)).body).toEqual(result.body);
    expect(f.state.records).toBe(1); expect(f.state.connections).toBe(0);
  });
  test("replacement session rejects previous CSRF and emits the new trusted epoch", async () => {
    const f = fixture(); f.state.session = { v2CsrfToken: "replacement-csrf", v2SessionScope: "payment-session-b" };
    const denied = await request(f.app).post(`${path}/manual`).set("x-v2-csrf-token", token).send(body).expect(403);
    expect(denied.headers["x-v2-session-scope"]).toBe("payment-session-b"); expect(f.state.transactions).toBe(0);
    await request(f.app).post(`${path}/manual`).set("x-v2-csrf-token", "replacement-csrf").send(body).expect(200);
    expect(f.state.records).toBe(1);
  });
});

describe("Actual App + authenticated transport + mounted HTTP + canonical Billing counterexamples", () => {
  let dom: JSDOM;
  let root: import("react-dom/client").Root;
  let createRoot: typeof import("react-dom/client").createRoot;
  let Simulate: typeof import("react-dom/test-utils").Simulate;
  let App: typeof import("../../ui/src/App.js").App;
  let AuthGate: typeof import("../../ui/src/AuthGate.js").AuthGate;
  let api: typeof import("../../ui/src/api.js");
  let appearance: typeof import("../../ui/src/appearance.js").defaultVisualAppearance;
  let cache: QueryClient;
  const originalFetch = globalThis.fetch;
  const releaseGates = new Set<() => void>();
  const protectedObservers = new Set<MutationObserver>();
  type BrowserServer = ReturnType<typeof browserServer>;
  const text = () => document.body.textContent ?? "";
  const control = (label: string) => { const node = document.querySelector<HTMLInputElement | HTMLSelectElement>(`[aria-label="${label}"]`); assert.ok(node, `Control ${label}`); return node; };
  async function settle(predicate: () => boolean = () => true) {
    for (let index = 0; index < 150; index++) { await act(async () => { await new Promise((resolve) => setTimeout(resolve, 5)); }); if (predicate()) return; }
    assert.ok(predicate(), "Actual mounted App must settle");
  }
  function browserServer() {
    const server = fixture(true);
    const calls: { url: URL; method: string; rawBody?: string; body: unknown; status?: number; delivered?: boolean }[] = [];
    type Call = (typeof calls)[number];
    const holds: { match: (call: Call) => boolean; stage: "request" | "response"; gate: Promise<void>; call?: Call }[] = [];
    let financialRequestsGate: Promise<void> | undefined;
    const holdNext = (match: (call: Call) => boolean, stage: "request" | "response") => {
      let release!: () => void;
      const hold = { match, stage, gate: new Promise<void>((resolve) => { release = resolve; releaseGates.add(resolve); }), call: undefined as Call | undefined };
      holds.push(hold);
      return { release, get call() { return hold.call; } };
    };
    const delayFinancialObservers = () => {
      let release!: () => void;
      financialRequestsGate = new Promise((resolve) => { release = resolve; releaseGates.add(resolve); });
      return () => { financialRequestsGate = undefined; release(); };
    };
    const fetch: typeof globalThis.fetch = async (input, init) => {
      const raw = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      const url = new URL(raw, window.location.origin), method = init?.method ?? "GET";
      assert.equal(init?.credentials, "include"); assert.equal(init?.cache, "no-store");
      assert.equal(new Headers(init?.headers).get("content-type"), "application/json");
      const call: Call = { url, method, rawBody: typeof init?.body === "string" ? init.body : undefined, body: typeof init?.body === "string" ? JSON.parse(init.body) as unknown : undefined, status: undefined, delivered: false };
      calls.push(call);
      const hold = holds.find((candidate) => !candidate.call && candidate.match(call));
      if (hold) hold.call = call;
      const observerGate = method === "GET" && url.pathname.startsWith(path) ? financialRequestsGate : undefined;
      if (hold?.stage === "request") await hold.gate;
      if (observerGate) await observerGate;
      // AuthGate's server-owned session READ fixture uses the same trusted
      // cookie identity and fresh Principal issuer as the real HTTP handlers.
      // It is not derived from React props, local storage or payment flags.
      if (url.pathname === "/v2/auth/session" || url.pathname === "/v2/auth/logout") {
        if (url.pathname.endsWith("/logout")) {
          assert.equal(new Headers(init?.headers).get("x-v2-csrf-token"), server.state.session.v2CsrfToken);
          server.state.authenticated = false;
        }
        if (!server.state.authenticated && url.pathname.endsWith("/session")) {
          call.status = 401; call.delivered = true;
          return new Response(JSON.stringify({ ok: false, error: { code: "FORBIDDEN", message: "No authenticated server session" } }), { status: 401 });
        }
        if (url.pathname.endsWith("/logout")) {
          call.status = 200; call.delivered = true;
          return new Response(JSON.stringify({ ok: true, data: { loggedOut: true } }), { status: 200 });
        }
        await server.principals.principal({ session: server.state.session, user: { id: server.state.userId }, isAuthenticated: () => server.state.authenticated } as never, server.state.organizationId);
        const verified: import("../../ui/src/auth.js").V2AuthSession = { staff: { id: server.state.userId, email: "staff@fixture.invalid", displayName: "Verified Staff" },
          organizations: [{ id: server.state.organizationId, name: "Verified Organization" }], activeOrganizationId: server.state.organizationId,
          csrfToken: server.state.session.v2CsrfToken, sessionScope: server.state.session.v2SessionScope };
        call.status = 200; if (hold?.stage === "response") await hold.gate; call.delivered = true;
        return new Response(JSON.stringify({ ok: true, data: verified }), { status: 200 });
      }
      const http = method === "POST" ? request(server.app).post(url.pathname + url.search) : request(server.app).get(url.pathname + url.search);
      new Headers(init?.headers).forEach((value, name) => http.set(name, value));
      if (call.rawBody) http.send(call.rawBody);
      const response = await http; call.status = response.status;
      if (hold?.stage === "response") await hold.gate;
      call.delivered = true;
      return new Response(response.text, { status: response.status, headers: { "content-type": "application/json", "x-v2-session-scope": response.headers["x-v2-session-scope"] ?? server.state.session.v2SessionScope } });
    };
    return { ...server, calls, fetch, holdNext, delayFinancialObservers };
  }
  beforeAll(async () => {
    dom = new JSDOM("<!doctype html><html><body><div id='root'></div></body></html>", { url: "https://ui.invalid/" });
    Object.assign(globalThis, { React, window: dom.window, document: dom.window.document, navigator: dom.window.navigator, HTMLElement: dom.window.HTMLElement, HTMLInputElement: dom.window.HTMLInputElement,
      Event: dom.window.Event, localStorage: dom.window.localStorage, sessionStorage: dom.window.sessionStorage, IS_REACT_ACT_ENVIRONMENT: true });
    Object.defineProperty(globalThis, "crypto", { configurable: true, value: webcrypto });
    // Only CSS is mocked. Every App, transport, Principal, HTTP and Billing module executes.
    jest.unstable_mockModule("../../ui/src/QuickBooksSettingsWorkspace.css", () => ({}));
    ({ createRoot } = await import("react-dom/client")); ({ Simulate } = await import("react-dom/test-utils"));
    ({ App } = await import("../../ui/src/App.js")); ({ AuthGate } = await import("../../ui/src/AuthGate.js")); api = await import("../../ui/src/api.js");
    ({ defaultVisualAppearance: appearance } = await import("../../ui/src/appearance.js"));
    root = createRoot(document.getElementById("root")!);
    cache = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false } } });
  });
  afterAll(async () => {
    if (root) await act(async () => root.unmount()); cache?.clear(); api?.clearV2ApiSessionState(); globalThis.fetch = originalFetch; dom?.window.close();
  });
  afterEach(async () => {
    for (const observer of protectedObservers) observer.disconnect(); protectedObservers.clear();
    await act(async () => { for (const release of releaseGates) release(); releaseGates.clear(); await new Promise((resolve) => setTimeout(resolve, 10)); });
  });
  async function mount(server: BrowserServer, pathname: string, withAuthGate = false) {
    await act(async () => root.unmount()); cache.clear(); api.clearV2ApiSessionState(); root = createRoot(document.getElementById("root")!);
    cache = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false } } });
    window.history.replaceState({}, "", pathname); sessionStorage.clear(); sessionStorage.setItem("ph.v2.organization-id", "org-a"); globalThis.fetch = server.fetch;
    const app = React.createElement(App, { appearance, setAppearance: () => {} });
    await act(async () => root.render(React.createElement(QueryClientProvider, { client: cache }, withAuthGate ? React.createElement(AuthGate, null, app) : app)));
    await settle(() => text().includes(pathname.includes("view=legacy") ? "Local Customer" : server.state.organizationId === "org-a" ? "USD 87.50" : "No V2 payments match"));
    await settle(() => server.calls.every((call) => call.status !== undefined));
    if (pathname === "/") await settle(() => document.querySelectorAll('[aria-label="Payment metrics"] article strong').length === 2);
  }
  async function click(label: string) {
    const node = [...document.querySelectorAll<HTMLButtonElement | HTMLAnchorElement>("button,a")].find((entry) => entry.textContent === label);
    assert.ok(node, `Button/link ${label}`); await act(async () => node.click()); await settle();
  }
  async function change(label: string, value: string | boolean) {
    await act(async () => { const node = control(label); if (typeof value === "boolean") (node as HTMLInputElement).checked = value; else node.value = value; Simulate.change(node); }); await settle();
  }
  async function entry() {
    await click("Record manual payment"); await change("Entry Customer", "customer-a"); await settle(() => Boolean(document.querySelector('[aria-label="Select Invoice INV-A"]')));
    await change("Select Invoice INV-A", true); await change("Tendered", "100.00");
  }
  async function historyPeriod(period: "today" | "month") {
    await act(async () => { window.history.pushState({}, "", `/payments?period=${period}`); window.dispatchEvent(new Event("popstate")); }); await settle(() => control("Payment period").value === period);
  }
  const bootstrapKey = ["v2", "payment-session-a", "org-a", "ui-bootstrap"];
  const bootstrapCalls = (server: BrowserServer) => server.calls.filter((call) => call.url.pathname.endsWith("/ui-bootstrap"));
  const recheckReady = () => ![...document.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "Recheck financial access")!.disabled;
  async function replaceEpoch(server: BrowserServer, epoch: string) {
    const restoration = server.holdNext((call) => call.url.pathname === "/v2/auth/session", "request");
    server.state.session = { v2CsrfToken: `csrf-${epoch}`, v2SessionScope: epoch };
    await click("Refresh payments"); await settle(() => text().includes("Restoring secure session"));
    assert.equal(document.querySelector('[aria-label="Payments workspace"]'), null, "Actual AuthGate has torn down App, not merely changed Payment props");
    assert.doesNotMatch(text(), /87\.50|100\.00|12\.50|Retry original payment/);
    await act(async () => restoration.release());
    await settle(() => Boolean(document.querySelector('[aria-label="Payments workspace"]')) && text().includes("USD 87.50"));
    await settle(() => bootstrapCalls(server).some((call) => call.delivered));
  }
  const manualCalls = (server: BrowserServer) => server.calls.filter((call) => call.url.pathname === `${path}/manual` && call.method === "POST");
  const protectedContent = /87\.50|100\.00|12\.50/;
  const assertFinancialHidden = () => {
    assert.doesNotMatch(text(), protectedContent);
    assert.equal(document.querySelector('[aria-label="Recorded payment receipt"]'), null);
    assert.match(text(), /Financial read access was denied/);
  };
  function watchProtectedContent() {
    const exposures: string[] = [];
    const observer = new dom.window.MutationObserver(() => { if (protectedContent.test(text())) exposures.push(text()); });
    observer.observe(document.body, { childList: true, subtree: true, characterData: true }); protectedObservers.add(observer);
    return { exposures, stop: () => { observer.disconnect(); protectedObservers.delete(observer); } };
  }
  async function recordReceipt(server: BrowserServer) {
    await mount(server, "/payments?period=month"); await entry(); await click("Record Payment");
    await settle(() => Boolean(document.querySelector('[aria-label="Recorded payment receipt"]')));
    await settle(() => server.calls.every((call) => call.delivered));
    assert.match(document.querySelector('[aria-label="Recorded payment receipt"]')!.textContent!, /AppliedUSD 87\.50Change dueUSD 12\.50/);
    assert.match(document.querySelector('[aria-label="Recorded payment receipt"]')!.textContent!, /TenderedUSD 100\.00/);
    assert.equal(server.state.records, 1); assert.equal(server.state.paid, 8750);
  }
  test.each(["/", "/payments?period=month", "/payments?view=legacy"])("one real financial GET 403 hides cached reads immediately at %s; no test bootstrap invalidation", async (pathname) => {
    const server = browserServer(); await mount(server, pathname);
    const bootstraps = bootstrapCalls(server).length, connections = server.state.connections;
    let release!: () => void; server.state.bootstrapGate = new Promise((resolve) => { release = resolve; releaseGates.add(resolve); });
    server.state.capabilities = server.grants.filter((capability) => capability !== "payment.view");
    const key = cache.getQueryCache().findAll({ queryKey: ["v2", "payment-session-a", "org-a", pathname.includes("view=legacy") ? "finance" : "payment-workspace"] })
      .find((query) => pathname === "/" ? query.queryKey[4] === "summary" && (query.queryKey[5] as { period: string }).period === "today" : query.queryKey[4] === (pathname.includes("view=legacy") ? "ledger" : "page"))!.queryKey;
    await act(async () => { await cache.refetchQueries({ queryKey: key, exact: true }); }); await settle(() => text().includes("Financial read access was denied"));
    assert.doesNotMatch(text(), /87\.50|INV-A|Local Customer|Global transaction ledger|Payments Today|Payments This Month/);
    assert.equal(cache.getQueryData<import("../../ui/src/api.js").UiBootstrap>(bootstrapKey)!.capabilities.paymentView, true, "UI must hide while old verified bootstrap is still cached and new bootstrap is blocked");
    assert.equal(server.state.connections, connections, "Owner denied before PostgreSQL read runner");
    assert.equal(server.calls.filter((call) => call.status === 403).length, 1, JSON.stringify(server.calls.filter((call) => call.status === 403).map((call) => call.url.pathname + call.url.search)));
    await settle(() => bootstrapCalls(server).length === bootstraps + 1);
    server.state.bootstrapGate = undefined; await act(async () => release()); await settle(() => cache.getQueryData<import("../../ui/src/api.js").UiBootstrap>(bootstrapKey)?.capabilities.paymentView === false);
    await settle(); assert.equal(bootstrapCalls(server).length, bootstraps + 1, "No auto-query/bootstrap/403 loop");
    server.state.capabilities = server.grants; await click("Recheck financial access"); await settle(() => text().includes(pathname.includes("view=legacy") ? "Local Customer" : "USD 87.50"));
    assert.equal(bootstrapCalls(server).length, bootstraps + 2); assert.equal(server.state.records, 0);
  });
  test("resource read denial stays hidden while fresh bootstrap still grants payment.view; explicit recheck probes original GET", async () => {
    const server = browserServer(); await mount(server, "/"); const bootstraps = bootstrapCalls(server).length;
    server.state.resourceDenied = true;
    await act(async () => { await cache.refetchQueries({ queryKey: ["v2", "payment-session-a", "org-a", "payment-workspace", "summary", { period: "today" }], exact: true }); });
    await settle(() => text().includes("Financial read access was denied")); await settle(() => bootstrapCalls(server).filter((call) => call.status === 200).length === bootstraps + 1);
    assert.equal(cache.getQueryData<import("../../ui/src/api.js").UiBootstrap>(bootstrapKey)!.capabilities.paymentView, true);
    assert.doesNotMatch(text(), /87\.50|Payments Today|Payments This Month/);
    const denied = server.calls.filter((call) => call.status === 403).length; await settle(); assert.equal(server.calls.filter((call) => call.status === 403).length, denied);
    await click("Recheck financial access"); await settle(() => server.calls.filter((call) => call.status === 403).length === denied + 1);
    assert.doesNotMatch(text(), /87\.50|Payments Today|Payments This Month/); assert.equal(bootstrapCalls(server).length, bootstraps + 2);
    server.state.resourceDenied = false; await click("Recheck financial access"); await settle(() => text().includes("USD 87.50")); assert.equal(server.state.records, 0);
  });
  test("real POST denial gates recording, not view, retains the original request and records once on regrant", async () => {
    const server = browserServer(); await mount(server, "/payments?period=month"); await entry();
    server.state.capabilities = server.grants.filter((capability) => capability !== "payment.record"); await click("Record Payment"); await settle(() => text().includes("Payment recording access was denied"));
    assert.match(text(), /USD 87\.50/); assert.doesNotMatch(text(), /Financial read access was denied|Manual multi-invoice payment/);
    assert.equal(server.calls.filter((call) => call.method === "POST")[0].status, 403); assert.equal(server.state.records, 0); assert.equal(server.state.transactions, 0);
    await settle(recheckReady); server.state.capabilities = server.grants; await click("Recheck financial access"); await settle(() => text().includes("Retry original payment"));
    assert.equal(control("Tendered").value, "100.00"); assert.equal(control("Tendered").disabled, true);
    await click("Retry original payment"); await settle(() => Boolean(document.querySelector('[aria-label="Recorded payment receipt"]')));
    const attempts = server.calls.filter((call) => call.method === "POST"); assert.equal(attempts.length, 2); assert.equal(attempts[0].rawBody, attempts[1].rawBody);
    assert.equal(server.state.records, 1); assert.equal(server.state.paid, 8750); assert.match(document.querySelector('[aria-label="Recorded payment receipt"]')!.textContent!, /Change dueUSD 12\.50/);
  });
  test.each(["invoice.view", "payment.record"] as const)("picker GET %s loss does not revoke payment.view and regrant requires new selection", async (capability) => {
    const server = browserServer(); await mount(server, "/payments?period=month"); await click("Record manual payment");
    server.state.capabilities = server.grants.filter((grant) => grant !== capability); await change("Entry Customer", "customer-a"); await settle(() => text().includes("Payment recording access was denied"));
    assert.match(text(), /USD 87\.50/); assert.doesNotMatch(text(), /Financial read access was denied|Manual multi-invoice payment/);
    assert.equal(server.calls.filter((call) => call.status === 403)[0].url.pathname, `${path}/invoices`);
    await settle(recheckReady); server.state.capabilities = server.grants; await click("Recheck financial access"); await settle(() => text().includes("Record manual payment"));
    await click("Record manual payment"); assert.equal(control("Entry Customer").value, ""); assert.equal(control("Tendered").value, ""); assert.equal(server.state.records, 0); assert.equal(server.calls.some((call) => call.method === "POST"), false);
  });
  test("canonical committed 503 plus Browser Back preserves UUID/time/tender/balances through read denial and regrant, replaying exactly one receipt", async () => {
    const server = browserServer(); await mount(server, "/payments?period=today"); await historyPeriod("month"); await entry();
    server.state.failHook = true; await click("Record Payment"); await settle(() => text().includes("Retry original payment"));
    const original = server.calls.find((call) => call.method === "POST")!; assert.equal(original.status, 503); assert.equal(server.state.records, 1); assert.equal(server.state.paid, 8750);
    const input = original.body as import("../../src/modules/billing/paymentWorkspace.js").PaymentWorkspaceRecordInput; assert.ok(input.businessRequestId); assert.ok(input.occurredAt);
    assert.deepEqual(input.tender, { tendered: { currency: "USD", cents: 10000 }, expectedBalances: [{ invoiceId: "invoice-a", collectibleBalance: { currency: "USD", cents: 8750 } }] });
    await act(async () => window.history.back()); await settle(() => window.location.search === "?period=today" && control("Payment period").value === "today");
    assert.match(text(), /Retry original payment/); assert.equal(control("Tendered").value, "100.00"); assert.equal(control("Tendered").disabled, true);
    assert.equal([...document.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "Record manual payment")!.disabled, true);
    await click("Legacy Transactions"); assert.equal(window.location.search, "?period=today"); assert.match(text(), /before leaving this workspace/);
    server.state.capabilities = server.grants.filter((capability) => capability !== "payment.view");
    await act(async () => { await cache.refetchQueries({ queryKey: ["v2", "payment-session-a", "org-a", "payment-workspace", "page"] }); }); await settle(() => text().includes("Financial read access was denied"));
    assert.doesNotMatch(text(), /Retry original payment|Tender preview|USD 87\.50/);
    await settle(recheckReady); server.state.capabilities = server.grants; await click("Recheck financial access"); await settle(() => text().includes("Retry original payment"));
    assert.equal(control("Tendered").value, "100.00"); assert.equal(control("Tendered").disabled, true);
    server.state.failHook = false; await click("Retry original payment"); await settle(() => Boolean(document.querySelector('[aria-label="Recorded payment receipt"]')));
    const attempts = server.calls.filter((call) => call.method === "POST"); assert.equal(attempts.length, 2); assert.equal(attempts[0].rawBody, attempts[1].rawBody); assert.equal(server.state.records, 1); assert.equal(server.state.paid, 8750); assert.equal(server.receipts.size, 1);
    assert.match(document.querySelector('[aria-label="Recorded payment receipt"]')!.textContent!, /AppliedUSD 87\.50Change dueUSD 12\.50/);
    assert.equal((server.receipts.get(input.businessRequestId)!.result as { tenderReceipt: { changeDue: { cents: number } } }).tenderReceipt.changeDue.cents, 1250);
  });
  test("precommit pending request survives reporting Back, blocks off-workspace history, then retries canonical 503 unchanged", async () => {
    const server = browserServer(); await mount(server, "/payments?period=today"); await historyPeriod("month"); await entry();
    let release!: () => void; server.state.commandGate = new Promise((resolve) => { release = resolve; releaseGates.add(resolve); }); server.state.failHook = true;
    await click("Record Payment"); await settle(() => server.calls.some((call) => call.method === "POST")); assert.equal(server.state.records, 0); assert.match(text(), /Recording\.\.\./);
    await act(async () => window.history.back()); await settle(() => window.location.search === "?period=today" && control("Payment period").value === "today");
    assert.equal(control("Tendered").value, "100.00"); assert.equal(control("Tendered").disabled, true); assert.match(text(), /Recording\.\.\./);
    await act(async () => { window.history.pushState({}, "", "/"); window.dispatchEvent(new Event("popstate")); }); await settle(); assert.equal(window.location.pathname + window.location.search, "/payments?period=today"); assert.match(text(), /before leaving this workspace/);
    assert.equal(server.calls.filter((call) => call.method === "POST").length, 1);
    server.state.commandGate = undefined; await act(async () => release()); await settle(() => text().includes("Retry original payment")); assert.equal(server.state.records, 1); assert.equal(server.calls.find((call) => call.method === "POST")!.status, 503);
    server.state.failHook = false; await click("Retry original payment"); await settle(() => Boolean(document.querySelector('[aria-label="Recorded payment receipt"]')));
    const attempts = server.calls.filter((call) => call.method === "POST"); assert.equal(attempts.length, 2); assert.equal(attempts[0].rawBody, attempts[1].rawBody); assert.equal(server.state.records, 1); assert.match(document.querySelector('[aria-label="Recorded payment receipt"]')!.textContent!, /Change dueUSD 12\.50/);
  });
  test("normal safe Today/Month history updates period while retaining local filters, with no request", async () => {
    const server = browserServer(); await mount(server, "/payments?period=today"); await change("Filter payment method", "cash"); await historyPeriod("month"); assert.equal(control("Filter payment method").value, "cash");
    await settle(() => server.calls.filter((call) => call.url.pathname === path).at(-1)!.url.searchParams.get("period") === "month");
    await act(async () => window.history.back()); await settle(() => window.location.search === "?period=today" && control("Payment period").value === "today"); assert.equal(control("Filter payment method").value, "cash");
    await settle(() => server.calls.filter((call) => call.url.pathname === path).at(-1)!.url.searchParams.get("period") === "today"); assert.equal(server.calls.some((call) => call.method === "POST"), false);
  });
  test("new App Customer403 invalidates an already-latched older explicit recheck200 without revealing canonical receipt while observers are delayed", async () => {
    const server = browserServer(); await recordReceipt(server);
    const customer = server.holdNext((call) => call.url.pathname === `${path}/customers` && call.url.searchParams.get("q") === "held-customer", "request");
    await change("Find Customer", "held-customer"); await settle(() => Boolean(customer.call));
    assert.equal(customer.call!.status, undefined, "The App-originated Customer query has not reached the owner yet");
    server.state.resourceDenied = true; await click("Refresh payments"); await settle(() => text().includes("Financial read access was denied")); await settle(recheckReady);
    assertFinancialHidden();
    const bootstraps = bootstrapCalls(server).length;
    assert.equal(cache.getQueryData<import("../../ui/src/api.js").UiBootstrap>(bootstrapKey)!.capabilities.paymentView, true);
    const older = server.holdNext((call) => call.url.pathname === path, "response");
    server.state.resourceDenied = false; await click("Recheck financial access"); await settle(() => older.call?.status === 200);
    assert.equal(older.call!.delivered, false, "A real owner-verified200 is held after HTTP, not fabricated");
    const releaseObservers = server.delayFinancialObservers();
    server.state.resourceDenied = true;
    await act(async () => customer.release()); await settle(() => customer.call?.status === 403 && customer.call.delivered === true);
    assertFinancialHidden(); assert.equal(bootstrapCalls(server).length, bootstraps + 1, "Repeated read denial advances recovery fencing without scheduling another bootstrap");
    const watch = watchProtectedContent(), requests = server.calls.length;
    await act(async () => older.release()); await settle();
    assertFinancialHidden(); assert.deepEqual(watch.exposures, [], "The newer genuine403 cannot be cleared by an older200, even briefly");
    assert.equal(server.calls.length, requests, "Stale recovery cannot restart financial observers");
    assert.equal(server.state.records, 1); assert.equal(server.state.paid, 8750);
    watch.stop(); releaseObservers(); server.state.resourceDenied = false;
    await click("Recheck financial access"); await settle(() => Boolean(document.querySelector('[aria-label="Recorded payment receipt"]')));
    assert.match(document.querySelector('[aria-label="Recorded payment receipt"]')!.textContent!, /TenderedUSD 100\.00AppliedUSD 87\.50Change dueUSD 12\.50/);
    assert.equal(server.calls.filter((call) => call.method === "POST").length, 1); assert.equal(server.state.records, 1);
  });
  test.each(["FORBIDDEN", "CONFLICT"] as const)("newer explicit recheck %s supersedes an older held200; clean recovery needs a newer successful probe", async (failure) => {
    const server = browserServer(); await recordReceipt(server);
    server.state.resourceDenied = true; await click("Refresh payments"); await settle(() => text().includes("Financial read access was denied")); await settle(recheckReady);
    const bootstraps = bootstrapCalls(server).length;
    const older = server.holdNext((call) => call.url.pathname === path, "response");
    server.state.resourceDenied = false; await click("Recheck financial access"); await settle(() => older.call?.status === 200); await settle(recheckReady);
    server.state.resourceFailure = failure;
    await click("Recheck financial access");
    await settle(() => server.calls.some((call) => call.url.pathname === path && call.status === (failure === "FORBIDDEN" ? 403 : 409) && call.delivered));
    assertFinancialHidden();
    assert.equal(bootstrapCalls(server).length, bootstraps + 2, "Two explicit controls are two fresh rechecks, not a bootstrap/403 loop");
    const releaseObservers = server.delayFinancialObservers(), watch = watchProtectedContent(), requests = server.calls.length;
    await act(async () => older.release()); await settle();
    assertFinancialHidden(); assert.deepEqual(watch.exposures, [], "A superseded successful recheck cannot overrule the newer failed recheck");
    assert.equal(server.calls.length, requests); assert.equal(server.state.records, 1); assert.equal(server.receipts.size, 1);
    watch.stop(); releaseObservers(); server.state.resourceFailure = undefined;
    await click("Recheck financial access"); await settle(() => Boolean(document.querySelector('[aria-label="Recorded payment receipt"]')));
    assert.match(document.querySelector('[aria-label="Recorded payment receipt"]')!.textContent!, /TenderedUSD 100\.00AppliedUSD 87\.50Change dueUSD 12\.50/);
    assert.equal(server.calls.filter((call) => call.method === "POST").length, 1); assert.equal(server.state.records, 1);
  });
  test("actual AuthGate teardown after canonical commit503 must retain the original request for verified same-identity epoch recovery", async () => {
    const server = browserServer(); await mount(server, "/payments?period=month", true); await entry();
    server.state.failHook = true; await click("Record Payment"); await settle(() => text().includes("Retry original payment"));
    const original = server.calls.find((call) => call.method === "POST")!;
    assert.equal(original.status, 503); assert.equal(server.state.records, 1); assert.equal(server.state.paid, 8750);
    await replaceEpoch(server, "payment-session-b");
    assert.match(text(), /Retry original payment/, "Unknown canonical outcome must survive real App unmount/restoration");
    assert.equal(control("Tendered").value, "100.00"); assert.equal(control("Tendered").disabled, true);
    assert.equal(server.calls.filter((call) => call.method === "POST").length, 1, "Restoration never submits automatically");
    server.state.failHook = false; await click("Retry original payment"); await settle(() => Boolean(document.querySelector('[aria-label="Recorded payment receipt"]')));
    const attempts = server.calls.filter((call) => call.method === "POST"); assert.equal(attempts.length, 2); assert.equal(attempts[0].rawBody, attempts[1].rawBody);
    assert.equal(server.state.records, 1); assert.match(document.querySelector('[aria-label="Recorded payment receipt"]')!.textContent!, /Change dueUSD 12\.50/);
  });
  test("actual AuthGate teardown during admitted precommit pending command must not permit a new-ID payment", async () => {
    const server = browserServer(); await mount(server, "/payments?period=month", true); await entry();
    let release!: () => void; server.state.commandGate = new Promise((resolve) => { release = resolve; releaseGates.add(resolve); });
    await click("Record Payment"); await settle(() => server.calls.some((call) => call.method === "POST")); assert.equal(server.state.records, 0);
    await replaceEpoch(server, "pending-session-b");
    assert.match(text(), /Retry original payment/, "Pending at teardown is an unknown outcome, not an empty new form");
    assert.equal(control("Tendered").disabled, true); assert.equal(server.calls.filter((call) => call.method === "POST").length, 1);
    server.state.commandGate = undefined;
    await click("Retry original payment"); await settle(() => Boolean(document.querySelector('[aria-label="Recorded payment receipt"]')));
    await act(async () => release()); await settle();
    const attempts = server.calls.filter((call) => call.method === "POST"); assert.equal(attempts.length, 2); assert.equal(attempts[0].rawBody, attempts[1].rawBody);
    assert.equal(server.state.records, 1); assert.equal(server.state.paid, 8750);
    assert.ok(document.querySelector('[aria-label="Recorded payment receipt"]'), "Old completion cannot replace the newer recovered receipt");
  });
  test.each([false, true])("held old canonical response (hook failure %s), epoch recovery, denied retry/regrant and late completion retain one exact request/receipt", async (failHook) => {
    const server = browserServer(); await mount(server, "/payments?period=month", true); await entry();
    const old = server.holdNext((call) => call.url.pathname === `${path}/manual` && call.method === "POST", "response");
    server.state.failHook = failHook; await click("Record Payment"); await settle(() => old.call?.status === (failHook ? 503 : 200));
    assert.equal(server.state.records, 1); assert.equal(server.state.paid, 8750); assert.equal(old.call!.delivered, false);
    await replaceEpoch(server, "recovered-session-b"); await settle(() => text().includes("Retry original payment"));
    assert.equal(control("Tendered").value, "100.00"); assert.equal(control("Tendered").disabled, true); assert.equal(manualCalls(server).length, 1);
    server.state.capabilities = server.grants.filter((capability) => capability !== "payment.record");
    await click("Retry original payment"); await settle(() => text().includes("Payment recording access was denied"));
    assert.equal(manualCalls(server)[1].status, 403); assert.equal(manualCalls(server)[1].rawBody, old.call!.rawBody);
    assert.equal(server.state.records, 1); await settle(recheckReady);
    server.state.capabilities = server.grants; await click("Recheck financial access"); await settle(() => text().includes("Retry original payment"));
    assert.equal(control("Tendered").value, "100.00"); assert.equal(control("Tendered").disabled, true);
    assert.equal(manualCalls(server).length, 2, "Neither auth nor authority restoration automatically POSTs");
    server.state.failHook = false; await click("Retry original payment"); await settle(() => Boolean(document.querySelector('[aria-label="Recorded payment receipt"]')));
    const recoveredReceipt = document.querySelector('[aria-label="Recorded payment receipt"]')!.textContent!;
    assert.match(recoveredReceipt, /TenderedUSD 100\.00AppliedUSD 87\.50Change dueUSD 12\.50/);
    await act(async () => old.release()); await settle();
    assert.equal(document.querySelector('[aria-label="Recorded payment receipt"]')!.textContent, recoveredReceipt);
    assert.doesNotMatch(text(), /Retry original payment|original submitted payment has an unconfirmed outcome/);
    assert.ok(manualCalls(server).every((call) => call.rawBody === old.call!.rawBody)); assert.equal(manualCalls(server).length, 3);
    assert.equal(server.state.records, 1); assert.equal(server.receipts.size, 1);
    await replaceEpoch(server, "receipt-session-c"); await settle(() => Boolean(document.querySelector('[aria-label="Recorded payment receipt"]')));
    assert.equal(document.querySelector('[aria-label="Recorded payment receipt"]')!.textContent, recoveredReceipt);
    assert.equal(manualCalls(server).length, 3, "Confirmed receipt restoration performs no replay POST");
  });
  test.each(["user", "tenant"] as const)("logout and verified foreign %s never inherit unknown intent; verified original identity can explicitly recover", async (different) => {
    const server = browserServer(); const originalUser = server.state.userId;
    await mount(server, "/payments?period=month", true); await entry(); server.state.failHook = true;
    await click("Record Payment"); await settle(() => text().includes("Retry original payment"));
    const original = manualCalls(server)[0]; assert.equal(server.state.records, 1);
    // Exercise the actual AuthGate logout control, not a synthetic epoch event.
    await click("Verified Staff"); await click("Sign out"); await settle(() => text().includes("Staff sign in"));
    assert.doesNotMatch(text(), /Retry original payment|87\.50|100\.00|12\.50/);
    server.state.authenticated = true;
    if (different === "user") server.state.userId = "foreign-verified-staff"; else server.state.organizationId = "org-b";
    server.state.session = { v2CsrfToken: "foreign-session-csrf", v2SessionScope: "foreign-session" };
    await mount(server, "/payments?period=month", true);
    assert.doesNotMatch(text(), /Retry original payment|Manual multi-invoice payment|Recorded payment receipt|100\.00|12\.50/);
    assert.equal(manualCalls(server).length, 1, "Foreign verified identity cannot replay or inherit another identity's checkpoint");
    server.state.userId = originalUser; server.state.organizationId = "org-a";
    server.state.session = { v2CsrfToken: "returned-identity-csrf", v2SessionScope: "returned-identity" };
    await mount(server, "/payments?period=month", true); await settle(() => text().includes("Retry original payment"));
    assert.equal(control("Tendered").value, "100.00"); assert.equal(control("Tendered").disabled, true); assert.equal(manualCalls(server).length, 1);
    server.state.failHook = false; await click("Retry original payment"); await settle(() => Boolean(document.querySelector('[aria-label="Recorded payment receipt"]')));
    assert.equal(manualCalls(server)[1].rawBody, original.rawBody); assert.equal(server.state.records, 1);
  });
});
