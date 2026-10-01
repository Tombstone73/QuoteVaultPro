import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { register } from "node:module";
import React, { act } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { JSDOM } from "jsdom";
import { CommandCenter } from "./CommandCenter";
import { defaultVisualAppearance } from "./appearance";
import { authenticatedWorkspaceTransport, clearV2ApiSessionState, quoteApi, type FinancialInvoicePage, type FinancialLedgerEntry, type UiBootstrap } from "./api";
import { createPaymentsWorkspaceClient } from "./paymentsWorkspaceApi";
import type { PaymentWorkspaceFact, PaymentWorkspacePage, PaymentWorkspaceRecordInput, PaymentWorkspaceSummaryRead } from "../../src/modules/billing/paymentWorkspace";
import { visibleNavigationSections } from "./VisualShell";

assert.equal(process.env.V2_VALIDATION_MODE, "deterministic", "Use the sanitized deterministic runner.");
const dom = new JSDOM("<!doctype html><html><body><div id='root'></div></body></html>", { url: "https://ui.invalid/" });
Object.assign(globalThis, { React, window: dom.window, document: dom.window.document, navigator: dom.window.navigator, HTMLElement: dom.window.HTMLElement,
  HTMLInputElement: dom.window.HTMLInputElement, Event: dom.window.Event, localStorage: dom.window.localStorage, sessionStorage: dom.window.sessionStorage, IS_REACT_ACT_ENVIRONMENT: true });
Object.defineProperty(globalThis, "crypto", { configurable: true, value: webcrypto });
// The standalone Node runner has no CSS loader. Ignore only stylesheet imports;
// the actual App, workspaces and transport still execute without module mocks.
register(`data:text/javascript,${encodeURIComponent('export async function load(url, context, nextLoad) { if (url.endsWith(".css")) return { format: "module", source: "", shortCircuit: true }; return nextLoad(url, context); }')}`, import.meta.url);
const { App } = await import("./App");
const { createRoot } = await import("react-dom/client");
const { Simulate } = await import("react-dom/test-utils");
const originalFetch = globalThis.fetch;
const base = "/v2/organizations/org-a";
const amount = (cents: number) => ({ currency: "USD", cents });
const fact: PaymentWorkspaceFact = { paymentId: "payment-a", occurredAt: "2026-03-08T12:00:00.000Z", recordedAt: "2026-03-08T12:05:00.000Z",
  amount: amount(8750), appliedAmount: amount(8750), refundedAmount: amount(1000), netAmount: amount(7750), method: "cash", source: "manual",
  actor: { kind: "staff", subjectId: "staff-a" }, refundState: "partially_refunded", allocations: [{ allocationId: "allocation-a", invoiceId: "invoice-a", invoiceNumber: "INV-A", orderId: "order-a", orderNumber: "ORD-A", customerId: "customer-a", customerName: "Local Customer", amount: amount(8750), refundedAmount: amount(1000) }] };
const summaryFor = (period: string): PaymentWorkspaceSummaryRead => ({ scope: "v2_payment_facts",
  window: { asOf: "2026-03-08T18:00:00.000Z", timeZone: "America/New_York", timeZoneSource: "organization",
    startInclusive: period === "month" ? "2026-03-01T05:00:00.000Z" : "2026-03-08T05:00:00.000Z",
    endExclusive: period === "month" ? "2026-04-01T04:00:00.000Z" : "2026-03-09T04:00:00.000Z", todayDate: "2026-03-08", tomorrowDate: "2026-03-09" },
  summary: { paymentCount: 3, byCurrency: [{ currency: "USD", paymentCount: 2, amountCents: 8750, appliedCents: 8750, refundedCents: 1000, netCents: 7750 }, { currency: "EUR", paymentCount: 1, amountCents: 5000, appliedCents: 5000, refundedCents: 0, netCents: 5000 }] } });
const permitted: UiBootstrap["capabilities"] = { quoteView: false, quoteCreate: false, quoteOverridePrice: false, paymentView: true, paymentRecord: true, invoiceView: true, customerView: true, orderView: true };
const ledgerEntry: FinancialLedgerEntry = { kind: "payment", id: fact.paymentId, paymentId: fact.paymentId, amount: fact.amount, method: fact.method,
  source: "manual", occurredAt: fact.occurredAt, recordedAt: fact.recordedAt, balanceAfter: amount(0), recordSource: "v2", recordId: fact.paymentId,
  invoiceId: "invoice-a", sourceOrderId: "order-a", sourceOrderNumber: "ORD-A", customerId: "customer-a", customerName: "Local Customer" };

function server() {
  const state = { capabilities: { ...permitted }, bootstrapDenied: false, sessionScope: "payment-session-a", csrfToken: "payment-csrf-a",
    summaryError: false, summaryGate: undefined as Promise<void> | undefined, fallbackZone: false };
  const calls: { url: URL; method: string; headers: Headers; body: unknown }[] = [];
  const unexpected: string[] = [];
  const respond = (data: unknown) => new Response(JSON.stringify({ ok: true, data }), { status: 200, headers: { "content-type": "application/json", "x-v2-session-scope": state.sessionScope } });
  const deny = (code = "FORBIDDEN", message = "Fresh permission denied", status = 403) => new Response(JSON.stringify({ ok: false, error: { code, message } }), { status, headers: { "content-type": "application/json", "x-v2-session-scope": state.sessionScope } });
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const raw = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const url = new URL(raw, window.location.origin), method = init?.method ?? "GET", headers = new Headers(init?.headers);
    assert.equal(url.origin, window.location.origin); assert.equal(init?.credentials, "include"); assert.equal(init?.cache, "no-store");
    assert.equal(headers.get("content-type"), "application/json", "CSRF command headers must not replace JSON content type");
    const body = typeof init?.body === "string" ? JSON.parse(init.body) as unknown : undefined;
    calls.push({ url, method, headers, body });
    if (url.pathname === `${base}/ui-bootstrap`) return state.bootstrapDenied ? deny() : respond({ organizationId: "org-a", userId: "staff-a", sessionScope: state.sessionScope, csrfToken: state.csrfToken, capabilities: state.capabilities } satisfies UiBootstrap);
    if (url.pathname === `${base}/action-center`) return respond({ items: [] });
    if (url.pathname === `${base}/payment-workspace/manual` && method === "POST") {
      assert.equal(headers.get("x-v2-csrf-token"), state.csrfToken);
      assert.ok(body && typeof body === "object"); assert.equal("organizationId" in body, false);
      return deny("STALE_STATE", "Canonical Invoice balance changed", 409);
    }
    if (url.pathname.startsWith(`${base}/payment-workspace`)) {
      if (state.capabilities.paymentView !== true) return deny();
      const suffix = url.pathname.slice(`${base}/payment-workspace`.length);
      if (suffix === "/customers") return respond([{ customerId: "customer-a", customerName: "Local Customer" }]);
      if (suffix === "/invoices") {
        assert.equal(url.searchParams.get("customerId"), "customer-a");
        return respond({ items: [{ invoiceId: "invoice-a", invoiceNumber: "INV-A", orderId: "order-a", orderNumber: "ORD-A", customerId: "customer-a", customerName: "Local Customer", collectibleBalance: amount(8750) }], page: 1, pageSize: 25, hasNextPage: false });
      }
      if (suffix === "/summary") { await state.summaryGate; if (state.summaryError) return deny("CONFLICT", "Reporting window unavailable", 409); }
      const summary = summaryFor(url.searchParams.get("period") ?? "today");
      const data = state.fallbackZone ? { ...summary, window: { ...summary.window, timeZone: "UTC", timeZoneSource: "default_utc" as const } } : summary;
      if (suffix === "/summary") return respond(data);
      if (suffix === "") return respond({ ...data, items: [fact], page: 1, pageSize: 25, totalMatching: 3, hasNextPage: false } satisfies PaymentWorkspacePage);
    }
    if (url.pathname === `${base}/finance/ledger`) return respond({ items: [ledgerEntry], page: 1, pageSize: 25, totalMatching: 1, hasNextPage: false });
    if (url.pathname === `${base}/finance/overview`) return respond({ items: [], page: 1, pageSize: 25, totalMatching: 0, hasNextPage: false,
      summary: { totalMatching: 0, outstanding: [], openInvoiceCount: 0, unpaid: { count: 0, balance: [] }, partiallyPaid: { count: 0, balance: [] }, paid: { count: 0, balance: [] }, creditDue: { count: 0, balance: [] } } } satisfies FinancialInvoicePage);
    if (/^\/v2\/organizations\/org-a\/(customers\/customer-a|orders\/order-a(?:\/|$)|finance\/invoices\/invoice-a)/.test(url.pathname)) return deny("NOT_FOUND", "Canonical destination fixture stops at its read boundary", 404);
    if (window.location.pathname === "/orders/order-a" && [`${base}/quotes/form/customers`, `${base}/quotes/form/products`].includes(url.pathname)) return deny("NOT_FOUND", "Existing Order form reads stop at their canonical boundary", 404);
    unexpected.push(`${method} ${url.pathname}`); throw Error(`Unexpected endpoint ${method} ${url.pathname}`);
  };
  return { state, calls, unexpected, fetch };
}

let root = createRoot(document.getElementById("root")!);
let cache = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false } } });
const text = () => document.body.textContent ?? "";
const control = (label: string) => { const found = document.querySelector<HTMLInputElement | HTMLSelectElement>(`[aria-label="${label}"]`); assert.ok(found, `Control ${label}`); return found; };
async function settle(predicate: () => boolean = () => true) {
  for (let index = 0; index < 150; index++) { await act(async () => { await new Promise((resolve) => setTimeout(resolve, 5)); }); if (predicate()) return; }
  assert.ok(predicate(), "UI boundary must settle");
}
async function mount(s: ReturnType<typeof server>, pathname: string, storedOrg = true) {
  await act(async () => root.unmount()); cache.clear(); clearV2ApiSessionState();
  root = createRoot(document.getElementById("root")!);
  cache = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false } } });
  window.history.replaceState({}, "", pathname); sessionStorage.clear(); if (storedOrg) sessionStorage.setItem("ph.v2.organization-id", "org-a");
  globalThis.fetch = s.fetch;
  await act(async () => root.render(<QueryClientProvider client={cache}><App appearance={defaultVisualAppearance} setAppearance={() => {}} /></QueryClientProvider>));
  await settle(() => !storedOrg || s.state.bootstrapDenied || (s.state.capabilities.paymentView === false && text().includes("do not have permission")) || text().includes("America/New_York") || text().includes("Global transaction ledger"));
}
async function click(label: string) {
  const node = [...document.querySelectorAll<HTMLButtonElement | HTMLAnchorElement>("button,a")].find((entry) => entry.textContent === label);
  assert.ok(node, `Link/button ${label}`); await act(async () => node.click()); await settle();
}
async function change(label: string, value: string | boolean) {
  await act(async () => { const node = control(label); if (typeof value === "boolean") (node as HTMLInputElement).checked = value; else node.value = value; Simulate.change(node); }); await settle();
}
let cases = 0;
async function check(name: string, action: () => Promise<void>) { await action(); cases++; console.log(`PASS ${name}`); }

try {
  await check("Payments slot uses verified paymentView only, and denied initial mounts issue zero financial reads", async () => {
    for (const capabilities of [undefined, { ...permitted, paymentView: false }]) assert.equal(visibleNavigationSections(capabilities).some((section) => section.items.some((item) => item.page === "payments")), false);
    assert.equal(visibleNavigationSections(permitted).flatMap((section) => section.items).filter((item) => item.page === "payments").length, 1);
    const missing = server(); await mount(missing, "/payments?period=month", false); assert.equal(missing.calls.length, 0);
    const denied = server(); denied.state.bootstrapDenied = true; await mount(denied, "/payments?period=month"); await settle();
    assert.equal(denied.calls.some((call) => /payment-workspace|finance/.test(call.url.pathname)), false);
    assert.doesNotMatch(text(), /USD 87\.50|Local Customer|INV-A|Legacy Transactions/);
    const noPermission = server(); noPermission.state.capabilities.paymentView = false; await mount(noPermission, "/payments?period=month", false);
    sessionStorage.setItem("ph.v2.organization-id", "org-a"); await mount(noPermission, "/payments?period=month"); await settle();
    assert.equal(noPermission.calls.some((call) => /payment-workspace|finance/.test(call.url.pathname)), false);
  });
  await check("Dashboard uses only shared Payment summary protocol; real timezone/DST windows and mixed currencies stay separate", async () => {
    const s = server(); await mount(s, "/"); await settle(() => document.querySelectorAll('[aria-label="Payment metrics"] article strong').length === 4);
    const summaries = s.calls.filter((call) => call.url.pathname === `${base}/payment-workspace/summary`);
    assert.deepEqual(summaries.map((call) => call.url.searchParams.get("period")).sort(), ["month", "today"]);
    assert.equal(s.calls.some((call) => /finance|invoices|\/payment-workspace$/.test(call.url.pathname)), false);
    for (const [period, label] of [["today", "Payments Today"], ["month", "Payments This Month"]] as const) {
      const card = document.querySelector(`[aria-label="${label}"]`)!;
      assert.equal(card.querySelector("a")!.getAttribute("href"), `/payments?period=${period}`);
      assert.match(card.textContent!, /3recorded payments|USD 87\.50|EUR 50\.00|America\/New_York|inclusive|exclusive|known as of/);
      const read = summaryFor(period);
      const format = (value: string) => new Intl.DateTimeFormat(undefined, { dateStyle: "short", timeStyle: "short", timeZone: read.window.timeZone }).format(new Date(value));
      assert.ok(card.textContent!.includes(format(read.window.startInclusive))); assert.ok(card.textContent!.includes(format(read.window.endExclusive))); assert.ok(card.textContent!.includes(format(read.window.asOf)));
      assert.doesNotMatch(card.textContent!, /137\.50|Net after refunds/);
    }
    assert.equal((Date.parse(summaryFor("today").window.endExclusive) - Date.parse(summaryFor("today").window.startInclusive)) / 3600000, 23);
    assert.deepEqual(s.unexpected, []);
  });
  await check("both Dashboard hrefs open actual Payments with period and survive hard reload and browser history", async () => {
    const s = server(); await mount(s, "/"); await settle(() => Boolean(document.querySelector('[aria-label="Payments This Month"] a')));
    for (const label of ["Payments Today", "Payments This Month"] as const) {
      await mount(s, "/"); await settle(() => Boolean(document.querySelector(`[aria-label="${label}"] a`)));
      const href = `/payments?period=${label === "Payments Today" ? "today" : "month"}`;
      const displayed = document.querySelector<HTMLAnchorElement>(`[aria-label="${label}"] a`)!; assert.equal(displayed.getAttribute("href"), href);
      await click(label); assert.equal(window.location.pathname + window.location.search, href);
      await settle(() => Boolean(document.querySelector('[aria-label="Payments workspace"]')));
      const period = new URLSearchParams(window.location.search).get("period"); assert.equal(control("Payment period").value, period);
      assert.equal(s.calls.filter((call) => call.url.pathname === `${base}/payment-workspace`).at(-1)!.url.searchParams.get("period"), period);
      await mount(s, window.location.pathname + window.location.search); assert.equal(control("Payment period").value, period);
    }
    await act(async () => { window.history.pushState({}, "", "/payments?period=today"); window.dispatchEvent(new Event("popstate")); }); await settle();
    assert.equal(control("Payment period").value, "today"); assert.equal(s.calls.filter((call) => call.url.pathname === `${base}/payment-workspace`).at(-1)!.url.searchParams.get("period"), "today");
    assert.match(text(), /successful lifetime refunds.*known at the server read time.*not only refunds/);
    assert.deepEqual(s.unexpected, []);
  });
  await check("visible Legacy Transactions link renders the original ledger and Payment Facts returns to M6", async () => {
    const s = server(); await mount(s, "/payments?period=month"); await click("Legacy Transactions");
    assert.equal(window.location.pathname + window.location.search, "/payments?view=legacy");
    await settle(() => s.calls.some((call) => call.url.pathname === `${base}/finance/ledger`));
    assert.match(text(), /Global transaction ledger|Refund facts/); assert.ok(document.querySelector('[aria-label="Ledger source"]'));
    assert.equal(document.querySelector('[aria-label="Payments workspace"]'), null);
    await click("Payment Facts"); assert.equal(window.location.search, "?period=today"); assert.equal(control("Payment period").value, "today");
    assert.deepEqual(s.unexpected, []);
  });
  await check("canonical Invoice, Order and Customer links retain owner URLs and read boundaries", async () => {
    for (const [label, pathname, endpoint] of [["Invoice INV-A", "/invoices/invoice-a", `${base}/finance/invoices/invoice-a`], ["Order ORD-A", "/orders/order-a", `${base}/orders/order-a`], ["Local Customer", "/customers/customer-a", `${base}/customers/customer-a`]] as const) {
      const s = server(); await mount(s, "/payments?period=month"); await click(label); assert.equal(window.location.pathname, pathname);
      await settle(() => s.calls.some((call) => call.url.pathname === endpoint));
      assert.equal(s.calls.some((call) => call.method !== "GET"), false); assert.deepEqual(s.unexpected, []);
    }
  });
  await check("real client command wraps preserve session CSRF plus JSON; canonical stale response is not a fabricated success", async () => {
    const s = server(); await mount(s, "/payments?period=today"); await click("Record manual payment"); await change("Entry Customer", "customer-a");
    await settle(() => Boolean(document.querySelector('[aria-label="Select Invoice INV-A"]'))); await change("Select Invoice INV-A", true); await change("Tendered", "100.00"); await click("Record Payment");
    await settle(() => text().includes("Selection cleared"));
    const call = s.calls.find((entry) => entry.method === "POST")!;
    assert.equal(call.url.pathname, `${base}/payment-workspace/manual`); assert.equal(call.headers.get("x-v2-csrf-token"), "payment-csrf-a");
    const input = call.body as PaymentWorkspaceRecordInput; assert.equal(input.tender.tendered.cents, 10000); assert.equal(input.allocations[0].amount.cents, 8750); assert.ok(input.businessRequestId);
    assert.equal("organizationId" in input, false); assert.doesNotMatch(text(), /Recorded payment receipt/); assert.deepEqual(s.unexpected, []);
  });
  await check("same-session permission loss hides cached financial page and Dashboard data and makes no further financial calls", async () => {
    for (const pathname of ["/payments?period=month", "/", "/payments?view=legacy"]) {
      const s = server(); await mount(s, pathname); await settle(() => text().includes(pathname.includes("view=legacy") ? "Local Customer" : "USD 87.50"));
      const before = s.calls.filter((call) => /payment-workspace|finance/.test(call.url.pathname)).length;
      s.state.capabilities.paymentView = false;
      await act(async () => { await cache.invalidateQueries({ queryKey: ["v2", "payment-session-a", "org-a", "ui-bootstrap"] }); }); await settle(() => !text().includes("USD 87.50"));
      assert.doesNotMatch(text(), /87\.50|EUR 50\.00|INV-A|Local Customer|Global transaction ledger|Payments Today|Payments This Month/);
      assert.equal(s.calls.filter((call) => /payment-workspace|finance/.test(call.url.pathname)).length, before);
      assert.ok(cache.getQueryCache().findAll({ queryKey: ["v2", "payment-session-a", "org-a", "payment-workspace"] }).every((query) => query.state.data === undefined), "Disabled query observers may remain, but no cached financial data survives permission loss");
      assert.deepEqual(s.unexpected, []);
    }
  });
  await check("session replacement clears old CSRF before new bootstrap and hides cached financial data", async () => {
    const s = server(); await mount(s, "/payments?period=month"); await settle(() => text().includes("USD 87.50"));
    s.state.sessionScope = "payment-session-b"; s.state.csrfToken = "payment-csrf-b";
    const client = createPaymentsWorkspaceClient(authenticatedWorkspaceTransport);
    await act(async () => { await assert.rejects(client.summary("org-a", { period: "today" }), { code: "SESSION_CONTEXT_CHANGED" }); }); await settle();
    assert.doesNotMatch(text(), /USD 87\.50|EUR 50\.00|Local Customer|INV-A/);
    assert.equal(authenticatedWorkspaceTransport.commandHeaders("org-a")["x-v2-csrf-token"], "");
    await quoteApi.bootstrap("org-a"); assert.equal(authenticatedWorkspaceTransport.commandHeaders("org-a")["x-v2-csrf-token"], "payment-csrf-b");
    assert.deepEqual(s.unexpected, []);
  });
  await check("Dashboard loading/error/UTC fallback are explicit and never false financial zero", async () => {
    const s = server(); globalThis.fetch = s.fetch; clearV2ApiSessionState(); await quoteApi.bootstrap("org-a");
    await act(async () => root.unmount()); cache.clear(); root = createRoot(document.getElementById("root")!);
    const client = createPaymentsWorkspaceClient(authenticatedWorkspaceTransport);
    let release!: () => void; s.state.summaryGate = new Promise((resolve) => { release = resolve; });
    const render = (canPaymentView: boolean) => act(async () => root.render(<QueryClientProvider client={cache}><CommandCenter organizationId="org-a" sessionScope="payment-session-a" canPaymentView={canPaymentView} paymentsClient={client} /></QueryClientProvider>));
    await render(true); await settle(); assert.match(text(), /Loading payment summary/); assert.doesNotMatch(text(), /0recorded payments|USD|EUR/);
    s.state.summaryError = true; await act(async () => release()); await settle(() => text().includes("Payment summary unavailable"));
    assert.doesNotMatch(text(), /0recorded payments|USD|EUR/);
    s.state.summaryGate = undefined; s.state.summaryError = false; s.state.fallbackZone = true;
    await act(async () => { await cache.invalidateQueries({ queryKey: ["v2", "payment-session-a", "org-a", "payment-workspace"] }); }); await settle(() => text().includes("UTC fallback"));
    const count = s.calls.length; await render(false); assert.doesNotMatch(text(), /USD 87\.50|EUR 50\.00|Payment metrics|Payments Today|Payments This Month/); assert.equal(s.calls.length, count);
    assert.deepEqual(s.unexpected, []);
  });
  console.log(`paymentWorkspaceNavigation.test: ${cases} actual App/Dashboard/transport scenarios PASS.`);
} finally {
  await act(async () => root.unmount()); cache.clear(); clearV2ApiSessionState(); globalThis.fetch = originalFetch; dom.window.close();
}
