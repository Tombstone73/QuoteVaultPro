import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import React, { act, StrictMode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { JSDOM } from "jsdom";
import { PaymentsWorkspace } from "./PaymentsWorkspace";
import { createPaymentsWorkspaceClient, type PaymentsRecordResult, type PaymentsWorkspaceClient } from "./paymentsWorkspaceApi";
import type { PaymentWorkspaceFact, PaymentWorkspaceInvoice, PaymentWorkspacePage, PaymentWorkspaceQuery, PaymentWorkspaceRecordInput } from "../../src/modules/billing/paymentWorkspace";

assert.equal(process.env.V2_VALIDATION_MODE, "deterministic", "Use the sanitized deterministic runner.");
const dom = new JSDOM("<!doctype html><html><body><div id='root'></div></body></html>", { url: "https://ui.invalid/payments?period=month" });
Object.assign(globalThis, { React, window: dom.window, document: dom.window.document, navigator: dom.window.navigator, HTMLElement: dom.window.HTMLElement, Event: dom.window.Event, IS_REACT_ACT_ENVIRONMENT: true });
Object.defineProperty(globalThis, "crypto", { configurable: true, value: webcrypto });
const { createRoot } = await import("react-dom/client");
const { Simulate } = await import("react-dom/test-utils");
const originalFetch = globalThis.fetch;
globalThis.fetch = async () => { throw Error("Only the injected payment client is allowed; no provider/API fetch"); };
const amount = (cents: number, currency = "USD") => ({ currency, cents });
const window = { asOf: "2026-10-01T05:00:00.000Z", timeZone: "America/New_York", timeZoneSource: "organization" as const, startInclusive: "2026-10-01T04:00:00.000Z", endExclusive: "2026-10-02T04:00:00.000Z", todayDate: "2026-10-01", tomorrowDate: "2026-10-02" };
const fact: PaymentWorkspaceFact = { paymentId: "payment-a", occurredAt: "2026-10-01T04:30:00.000Z", recordedAt: "2026-10-01T04:45:00.000Z", amount: amount(8750), appliedAmount: amount(8750), refundedAmount: amount(1000), netAmount: amount(7750), method: "cash", source: "manual", actor: { kind: "staff", subjectId: "staff-a", staffActorUserId: "staff-a" }, refundState: "partially_refunded", allocations: [{ allocationId: "allocation-a", invoiceId: "invoice-a", invoiceNumber: "INV-A", orderId: "order-a", orderNumber: "ORD-A", customerId: "customer-a", customerName: "Local Customer", amount: amount(5000), refundedAmount: amount(1000) }, { allocationId: "allocation-b", invoiceId: "invoice-b", invoiceNumber: "INV-B", orderId: "order-b", orderNumber: "ORD-B", customerId: "customer-a", customerName: "Local Customer", amount: amount(3750), refundedAmount: amount(0) }] };
const page: PaymentWorkspacePage = { scope: "v2_payment_facts", window, summary: { paymentCount: 1, byCurrency: [{ currency: "USD", paymentCount: 1, amountCents: 8750, appliedCents: 8750, refundedCents: 1000, netCents: 7750 }] }, items: [fact], page: 1, pageSize: 25, totalMatching: 1, hasNextPage: false };
const invoice = (id: string, cents: number, currency = "USD"): PaymentWorkspaceInvoice => ({ invoiceId: `invoice-${id}`, invoiceNumber: `INV-${id.toUpperCase()}`, orderId: `order-${id}`, orderNumber: `ORD-${id.toUpperCase()}`, customerId: "customer-a", customerName: "Local Customer", collectibleBalance: amount(cents, currency) });
const receipt = (input: PaymentWorkspaceRecordInput): PaymentsRecordResult => ({ payment: { payment: { paymentId: "recorded-payment", invoiceId: input.allocations[0].invoiceId, amount: amount(8750), method: input.method, source: "manual", occurredAt: input.occurredAt }, allocations: input.allocations }, settlements: [], tenderReceipt: { selectedBalance: amount(8750), tendered: amount(10000), applied: amount(8750), changeDue: amount(1250) } });

function server() {
  const calls: { name: string; org: string; input?: unknown }[] = [];
  let readPage = page, readInvoices = [invoice("a", 5000), invoice("b", 3750), invoice("eur", 900, "EUR")];
  let pageError: unknown, pendingPage: Promise<PaymentWorkspacePage> | undefined;
  let recordAction: (input: PaymentWorkspaceRecordInput) => Promise<PaymentsRecordResult> = async (input) => receipt(input);
  const client: PaymentsWorkspaceClient = {
    page: async (org, query) => { calls.push({ name: "page", org, input: structuredClone(query) }); if (pageError) throw pageError; return pendingPage ?? structuredClone(readPage); },
    summary: async (org, query) => { calls.push({ name: "summary", org, input: query }); return { scope: readPage.scope, window: readPage.window, summary: readPage.summary }; },
    customers: async (org, search) => { calls.push({ name: "customers", org, input: search }); return [{ customerId: "customer-a", customerName: "Local Customer" }]; },
    invoices: async (org, query) => { calls.push({ name: "invoices", org, input: query }); return { items: structuredClone(readInvoices), page: 1, pageSize: 25, hasNextPage: false }; },
    record: async (org, input) => { calls.push({ name: "record", org, input: structuredClone(input) }); return recordAction(input); },
  };
  return { client, calls, page: (value: PaymentWorkspacePage) => { readPage = value; }, invoices: (value: PaymentWorkspaceInvoice[]) => { readInvoices = value; }, pageError: (error: unknown) => { pageError = error; }, pending: (value: Promise<PaymentWorkspacePage> | undefined) => { pendingPage = value; }, record: (action: typeof recordAction) => { recordAction = action; } };
}
let root = createRoot(document.getElementById("root")!);
let cache = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity, staleTime: Infinity }, mutations: { retry: false } } });
let props: React.ComponentProps<typeof PaymentsWorkspace>;
const text = () => document.body.textContent ?? "";
const button = (label: string) => { const node = [...document.querySelectorAll("button")].find((entry) => entry.textContent === label); assert.ok(node, `Button ${label}`); return node; };
const control = (label: string) => { const node = document.querySelector<HTMLInputElement | HTMLSelectElement>(`[aria-label="${label}"]`); assert.ok(node, `Control ${label}`); return node; };
async function settle(predicate: () => boolean = () => true) {
  for (let retry = 0; retry < 100; retry++) { await act(async () => { await new Promise((resolve) => setTimeout(resolve, 5)); }); if (predicate()) return; }
  assert.ok(predicate(), "UI state must settle");
}
async function render(overrides: Partial<typeof props> = {}) { props = { ...props, ...overrides }; await act(async () => root.render(<StrictMode><QueryClientProvider client={cache}><PaymentsWorkspace {...props} /></QueryClientProvider></StrictMode>)); await settle(); }
async function mount(s: ReturnType<typeof server>, overrides: Partial<typeof props> = {}) {
  await act(async () => root.unmount()); cache.clear(); root = createRoot(document.getElementById("root")!);
  cache = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity, staleTime: Infinity }, mutations: { retry: false } } });
  props = { organizationId: "org-a", sessionScope: "session-a", client: s.client, canPaymentView: true, canInvoiceView: true, canPaymentRecord: true, csrfReady: true, ...overrides };
  await render(); await settle(() => !text().includes("Loading payment facts") || Boolean(s.calls.find((call) => call.name === "page")));
}
async function click(label: string) { await act(async () => button(label).click()); await settle(); }
async function change(label: string, value: string) { await act(async () => { const node = control(label); node.value = value; Simulate.change(node); }); await settle(); }
async function select(label: string, checked: boolean) { await act(async () => { const node = control(label) as HTMLInputElement; node.checked = checked; Simulate.change(node); }); await settle(); }
async function entry() { await click("Record manual payment"); await change("Entry Customer", "customer-a"); await settle(() => Boolean(document.querySelector('[aria-label="Select Invoice INV-A"]'))); await select("Select Invoice INV-A", true); await select("Select Invoice INV-B", true); await change("Tendered", "100.00"); }
let cases = 0;
async function check(name: string, action: () => Promise<void>) { await action(); cases++; console.log(`PASS ${name}`); }

try {
  await check("injected transport owns paths, command headers and shared summary query", async () => {
    const requests: { url: string; init?: RequestInit }[] = [];
    const transport = createPaymentsWorkspaceClient({ request: async <T,>(url: string, init?: RequestInit) => { requests.push({ url, init }); return {} as T; }, commandHeaders: (org) => ({ "x-v2-csrf-token": tokenFor(org), "content-type": "application/json" }) });
    function tokenFor(org: string) { return `csrf:${org}`; }
    const query = { period: "custom" as const, fromDate: "2026-03-08", toDate: "2026-03-08", customerId: "customer-a", method: "cash" as const };
    await transport.page("org a", query); await transport.summary("org a", query); await transport.invoices("org a", { customerId: "customer-a" }); await transport.customers("org a", "name & value");
    const input: PaymentWorkspaceRecordInput = { businessRequestId: "retry-a", occurredAt: window.asOf, method: "cash", allocations: [{ invoiceId: "invoice-a", amount: amount(8750) }], tender: { tendered: amount(10000), expectedBalances: [{ invoiceId: "invoice-a", collectibleBalance: amount(8750) }] } };
    await transport.record("org a", input);
    assert.ok(requests.every((item) => item.url.startsWith("/v2/organizations/org%20a/payment-workspace")));
    assert.equal(requests[0].url.split("?")[1], requests[1].url.split("?")[1]); assert.ok(requests[1].url.includes("/summary?"));
    assert.deepEqual(requests[4].init, { method: "POST", headers: { "x-v2-csrf-token": "csrf:org a", "content-type": "application/json" }, body: JSON.stringify(input) });
  });
  await check("first-class fact presentation is truthful about actors, refund cohort, currency and legacy scope", async () => {
    const s = server(); let legacy = 0;
    s.page({ ...page, items: [fact, { ...fact, paymentId: "service-payment", actor: { kind: "service", subjectId: "stripe-service" }, method: "card", source: "provider" }, { ...fact, paymentId: "unknown-actor", actor: { kind: "unknown" }, allocations: [] }], summary: { paymentCount: 3, byCurrency: [...page.summary.byCurrency, { currency: "EUR", paymentCount: 1, amountCents: 5000, appliedCents: 5000, refundedCents: 0, netCents: 5000 }] } });
    await mount(s, { initialQuery: { period: "month" }, openLegacyLedger: () => { legacy++; } }); await settle(() => text().includes("stripe-service"));
    assert.match(text(), /V2 payment facts only|One row per recorded payment|America\/New_York|organization timezone|lifetime refunds/);
    assert.match(text(), /ORD-A|INV-A|INV-B|Staff staff-a|Service stripe-service|Recorded actor unavailable|partially refunded/);
    assert.match(text(), /USD 87\.50|USD 77\.50|EUR 50\.00/); assert.doesNotMatch(text(), /Staff stripe-service/);
    assert.deepEqual(s.calls.find((call) => call.name === "page")!.input, { period: "month" });
    assert.equal(s.calls.filter((call) => call.name === "record").length, 0);
    await click("Native + legacy allocation ledger"); assert.equal(legacy, 1);
  });
  await check("loading, empty, error and explicit UTC fallback states render without inventing totals", async () => {
    const s = server(); let resolve!: (page: PaymentWorkspacePage) => void; s.pending(new Promise((done) => { resolve = done; }));
    await mount(s); assert.match(text(), /Loading payment facts/); assert.doesNotMatch(text(), /USD 87\.50/);
    const empty = { ...page, items: [], totalMatching: 0, summary: { paymentCount: 0, byCurrency: [] }, window: { ...window, timeZone: "UTC", timeZoneSource: "default_utc" as const } };
    await act(async () => resolve(empty)); await settle(() => text().includes("No V2 payments"));
    assert.match(text(), /UTC fallback|No V2 payments/);
    const failed = server(); failed.pageError(Object.assign(Error("Configured timezone invalid"), { code: "CONFLICT" })); await mount(failed); await settle(() => text().includes("Configured timezone invalid"));
    assert.match(text(), /Configured timezone invalid/); assert.doesNotMatch(text(), /Unique payments|USD 87\.50/);
  });
  await check("cash 100 for selected 87.50 shows applied/change and posts authoritative balances", async () => {
    const s = server(); await mount(s); await entry();
    const preview = document.querySelector('[aria-label="Tender preview"]')!.textContent!;
    assert.match(preview, /Selected balanceUSD 87\.50TenderedUSD 100\.00AppliedUSD 87\.50Change dueUSD 12\.50/);
    assert.equal((control("Select Invoice INV-EUR") as HTMLInputElement).disabled, true, "one currency only");
    await change("Manual method", "check"); assert.match(text(), /Noncash tender must equal Applied/); assert.equal(button("Record Payment").disabled, true);
    assert.equal(s.calls.filter((call) => call.name === "record").length, 0);
    await change("Manual method", "cash"); await click("Record Payment"); await settle(() => text().includes("Recorded payment receipt"));
    const record = s.calls.find((call) => call.name === "record")!.input as PaymentWorkspaceRecordInput;
    assert.deepEqual(record.allocations, [{ invoiceId: "invoice-a", amount: amount(5000) }, { invoiceId: "invoice-b", amount: amount(3750) }]);
    assert.deepEqual(record.tender.expectedBalances, [{ invoiceId: "invoice-a", collectibleBalance: amount(5000) }, { invoiceId: "invoice-b", collectibleBalance: amount(3750) }]);
    assert.equal(record.tender.tendered.cents, 10000); assert.equal(s.calls.filter((call) => call.name === "record").length, 1);
    assert.match(document.querySelector('[aria-label="Recorded payment receipt"]')!.textContent!, /AppliedUSD 87\.50Change dueUSD 12\.50/);
    assert.doesNotMatch(text(), /Manual multi-invoice payment/);
  });
  await check("partial and insufficient tender uses shared Billing validation, never silent redistribution", async () => {
    const s = server(); await mount(s); await entry(); await change("Tendered", "50.00");
    assert.match(text(), /Tendered amount is below Applied/); assert.equal(button("Record Payment").disabled, true);
    await change("Applied to Invoice INV-A", "12.50"); await change("Tendered", "50.00");
    const preview = document.querySelector('[aria-label="Tender preview"]')!.textContent!;
    assert.match(preview, /AppliedUSD 50\.00Change dueUSD 0\.00/); assert.equal(button("Record Payment").disabled, false);
    assert.equal(control("Applied to Invoice INV-B").value, "37.50"); assert.equal(s.calls.filter((call) => call.name === "record").length, 0);
  });
  await check("lost-response retry freezes request identity, tender and occurred time, then displays stored receipt", async () => {
    const s = server(); let stored: PaymentsRecordResult | undefined; let original: PaymentWorkspaceRecordInput | undefined;
    s.record(async (input) => { if (!stored) { original = structuredClone(input); stored = receipt(input); throw Error("Response lost after commit"); } assert.deepEqual(input, original); return stored; });
    await mount(s); await entry(); await click("Record Payment"); await settle(() => text().includes("Retry original payment"));
    assert.match(text(), /Response lost after commit|original request is retained|Editing is locked/);
    assert.equal(control("Tendered").disabled, true); assert.equal(control("Manual method").disabled, true); assert.equal(button("Cancel entry").disabled, true);
    await click("Retry original payment"); await settle(() => text().includes("Recorded payment receipt"));
    const attempts = s.calls.filter((call) => call.name === "record"); assert.equal(attempts.length, 2); assert.deepEqual(attempts[0].input, attempts[1].input);
    assert.match(document.querySelector('[aria-label="Recorded payment receipt"]')!.textContent!, /USD 12\.50/);
  });
  await check("stale balances clear selection, refresh authoritative picker and require explicit confirmation", async () => {
    const s = server(); s.record(async () => { s.invoices([invoice("a", 4000), invoice("b", 3750)]); throw Object.assign(Error("Balance changed"), { code: "STALE_STATE" }); });
    await mount(s); await entry(); await click("Record Payment"); await settle(() => text().includes("Selection cleared"));
    assert.equal((control("Select Invoice INV-A") as HTMLInputElement).checked, false); assert.equal((control("Select Invoice INV-B") as HTMLInputElement).checked, false);
    assert.equal(control("Tendered").value, ""); assert.equal(button("Record Payment").disabled, true); assert.match(text(), /USD 40\.00/);
    assert.ok(s.calls.filter((call) => call.name === "invoices").length >= 2); assert.doesNotMatch(text(), /Retry original payment/);
    assert.equal(s.calls.filter((call) => call.name === "record").length, 1);
  });
  await check("view/record/invoice authority and CSRF UI flags cannot trigger unauthorized picker or mutation", async () => {
    const s = server(); await mount(s, { canPaymentView: false }); assert.match(text(), /do not have permission/); assert.equal(s.calls.length, 0);
    await render({ canPaymentView: true, canInvoiceView: false }); await settle(() => text().includes("Unique payments")); assert.doesNotMatch(text(), /Record manual payment/);
    await render({ canInvoiceView: true, canPaymentRecord: false }); assert.doesNotMatch(text(), /Record manual payment/);
    await render({ canPaymentRecord: true, csrfReady: false }); assert.equal(button("Record manual payment").disabled, true);
    assert.equal(s.calls.filter((call) => ["record", "invoices"].includes(call.name)).length, 0);
    await render({ organizationId: "" }); assert.match(text(), /Select an authenticated organization/); assert.doesNotMatch(text(), /INV-A|Local Customer/);
  });
  for (const permission of ["canPaymentRecord", "canPaymentView", "canInvoiceView"] as const) {
    await check(`same-session ${permission} revoke/regrant clears unsubmitted state and requires fresh balances and selection`, async () => {
      const s = server(); await mount(s); await entry(); await change("Manual method", "other"); await change("Tendered", "87.50");
      const reads = s.calls.filter((call) => call.name === "invoices").length;
      await render({ [permission]: false }); assert.doesNotMatch(text(), /Manual multi-invoice payment|Tender preview/);
      s.invoices([invoice("a", 4000), invoice("b", 3750)]);
      await render({ [permission]: true });
      assert.equal(props.organizationId, "org-a"); assert.equal(props.sessionScope, "session-a");
      assert.doesNotMatch(text(), /Manual multi-invoice payment|Tender preview/, "authority restoration cannot resume an unsubmitted stale form");
      await click("Record manual payment");
      assert.equal(control("Entry Customer").value, ""); assert.equal(control("Tendered").value, ""); assert.equal(control("Manual method").value, "cash");
      assert.equal(button("Record Payment").disabled, true); assert.equal(s.calls.filter((call) => call.name === "record").length, 0);
      await change("Entry Customer", "customer-a"); await settle(() => text().includes("USD 40.00"));
      assert.ok(s.calls.filter((call) => call.name === "invoices").length > reads, "old cached picker balance cannot survive revocation");
      assert.equal((control("Select Invoice INV-A") as HTMLInputElement).checked, false); assert.equal((control("Select Invoice INV-B") as HTMLInputElement).checked, false);
      assert.equal(button("Record Payment").disabled, true);
      await select("Select Invoice INV-A", true); assert.equal(control("Applied to Invoice INV-A").value, "40.00");
      assert.equal(control("Tendered").value, ""); assert.equal(button("Record Payment").disabled, true);
    });
    await check(`same-session ${permission} revoke/regrant preserves and locks an uncertain original submitted request`, async () => {
      const s = server(); let stored: PaymentsRecordResult | undefined; let original: PaymentWorkspaceRecordInput | undefined;
      s.record(async (input) => { if (!stored) { original = structuredClone(input); stored = receipt(input); throw Object.assign(Error("Payment committed; lifecycle response lost"), { code: "RETRYABLE_FAILURE" }); } assert.deepEqual(input, original); return stored; });
      await mount(s); await entry(); await click("Record Payment"); await settle(() => text().includes("Retry original payment"));
      await render({ [permission]: false }); assert.doesNotMatch(text(), /Manual multi-invoice payment|Tender preview/);
      assert.equal(s.calls.filter((call) => call.name === "record").length, 1);
      s.invoices([invoice("a", 4000), invoice("b", 3750)]);
      await render({ [permission]: true }); await settle(() => text().includes("Retry original payment"));
      assert.equal(props.organizationId, "org-a"); assert.equal(props.sessionScope, "session-a");
      assert.equal(control("Tendered").value, "100.00"); assert.equal(control("Tendered").disabled, true);
      assert.equal(control("Manual method").disabled, true); assert.equal(control("Entry Customer").disabled, true);
      assert.equal((control("Select Invoice INV-A") as HTMLInputElement).disabled, true); assert.equal(button("Cancel entry").disabled, true);
      assert.equal(button("Record manual payment").disabled, true, "hiding cannot offer a replacement request");
      await click("Retry original payment"); await settle(() => text().includes("Recorded payment receipt"));
      const attempts = s.calls.filter((call) => call.name === "record"); assert.equal(attempts.length, 2); assert.deepEqual(attempts[0].input, attempts[1].input);
      assert.equal((attempts[1].input as PaymentWorkspaceRecordInput).tender.expectedBalances[0].collectibleBalance.cents, 5000);
      assert.match(document.querySelector('[aria-label="Recorded payment receipt"]')!.textContent!, /AppliedUSD 87\.50Change dueUSD 12\.50/);
    });
  }
  await check("same-session revoke/regrant while submission is pending cannot replace the unresolved original request", async () => {
    const s = server(); let reject!: (cause: unknown) => void; let stored: PaymentsRecordResult | undefined; let original: PaymentWorkspaceRecordInput | undefined;
    const unresolved = new Promise<PaymentsRecordResult>((_resolve, fail) => { reject = fail; });
    s.record(async (input) => { if (!stored) { original = structuredClone(input); stored = receipt(input); return unresolved; } assert.deepEqual(input, original); return stored; });
    await mount(s); await entry(); await click("Record Payment");
    assert.equal(button("Recording...").disabled, true);
    await render({ canPaymentView: false }); assert.doesNotMatch(text(), /Manual multi-invoice payment/);
    await render({ canPaymentView: true }); assert.equal(control("Tendered").disabled, true); assert.equal(button("Recording...").disabled, true);
    assert.equal(button("Record manual payment").disabled, true); assert.equal(button("Cancel entry").disabled, true);
    await act(async () => reject(Object.assign(Error("Committed response lost"), { code: "RETRYABLE_FAILURE" })));
    await settle(() => text().includes("Retry original payment"));
    await click("Retry original payment"); await settle(() => text().includes("Recorded payment receipt"));
    const attempts = s.calls.filter((call) => call.name === "record"); assert.equal(attempts.length, 2); assert.deepEqual(attempts[0].input, attempts[1].input);
  });
  await check("Customer/method/period filters and pagination query the same fact population", async () => {
    const s = server(); s.page({ ...page, totalMatching: 2, hasNextPage: true }); await mount(s, { initialQuery: { period: "month" } });
    await click("Next payments"); assert.deepEqual(s.calls.filter((call) => call.name === "page").at(-1)!.input, { period: "month", page: 2 });
    await change("Payment Customer", "customer-a"); await change("Filter payment method", "cash");
    assert.deepEqual(s.calls.filter((call) => call.name === "page").at(-1)!.input, { period: "month", page: 1, customerId: "customer-a", method: "cash" });
    await change("Payment period", "custom"); await change("From date", "2026-09-01"); await change("Through date", "2026-09-30");
    assert.deepEqual(s.calls.filter((call) => call.name === "page").at(-1)!.input, { period: "custom", customerId: "customer-a", method: "cash", pageSize: undefined, fromDate: "2026-09-01", toDate: "2026-09-30", page: 1 });
    assert.equal(s.calls.filter((call) => call.name === "record").length, 0);
  });
  await check("permission revoke and organization/session replacement hide fact and retry receipt state", async () => {
    const s = server(); await mount(s); await entry();
    s.record(async () => { throw Error("Lost response"); }); await click("Record Payment"); await settle(() => text().includes("Retry original payment"));
    await render({ canPaymentView: false }); assert.doesNotMatch(text(), /INV-A|Retry original payment|Tendered/);
    await render({ canPaymentView: true, organizationId: "org-b", sessionScope: "session-b" });
    assert.doesNotMatch(text(), /Retry original payment|Manual multi-invoice payment/);
    assert.ok(s.calls.some((call) => call.name === "page" && call.org === "org-b"));
    await render({ sessionScope: "" }); assert.match(text(), /Select an authenticated organization/); assert.doesNotMatch(text(), /INV-A/);
  });
  await check("verified same-identity epoch rebound preserves unknown request; a later STALE_STATE cannot authorize a new UUID", async () => {
    const s = server(); s.record(async () => { throw Object.assign(Error("Outcome unknown"), { code: "RETRYABLE_FAILURE" }); });
    await mount(s, { verifiedUserId: "verified-unknown-retry" }); await entry(); await click("Record Payment"); await settle(() => text().includes("Retry original payment"));
    const original = s.calls.find((call) => call.name === "record")!.input;
    await render({ sessionScope: "rebound-epoch" }); assert.match(text(), /Retry original payment/); assert.equal(control("Tendered").value, "100.00"); assert.equal(control("Tendered").disabled, true);
    s.record(async () => { throw Object.assign(Error("Retry denied; earlier outcome is not disproven"), { code: "STALE_STATE" }); });
    await click("Retry original payment"); await settle(() => text().includes("Retry denied"));
    assert.doesNotMatch(text(), /Selection cleared/); assert.match(text(), /Retry original payment/);
    assert.equal(button("Record manual payment").disabled, true); assert.equal(button("Cancel entry").disabled, true);
    assert.equal(control("Tendered").value, "100.00"); assert.equal(control("Tendered").disabled, true);
    await render({ sessionScope: "second-rebound" }); assert.match(text(), /Retry original payment/);
    assert.deepEqual(s.calls.filter((call) => call.name === "record").map((call) => call.input), [original, original]);
  });
  await check("verified initial established no-write rejection clears only that request, with no epoch restoration POST", async () => {
    const s = server(); s.record(async () => { throw Object.assign(Error("Initial locked balances stale before write"), { code: "STALE_STATE" }); });
    await mount(s, { verifiedUserId: "verified-initial-no-write" }); await entry(); await click("Record Payment"); await settle(() => text().includes("Selection cleared"));
    await render({ sessionScope: "no-write-epoch" }); assert.doesNotMatch(text(), /Retry original payment|Manual multi-invoice payment/);
    assert.equal(button("Record manual payment").disabled, false); assert.equal(s.calls.filter((call) => call.name === "record").length, 1);
  });
  await check("fresh actor and tenant recovery keys cannot inherit another identity's locked request", async () => {
    const s = server(); s.record(async () => { throw Error("Submitted response unconfirmed"); });
    await mount(s, { verifiedUserId: "verified-isolation-a" }); await entry(); await click("Record Payment"); await settle(() => text().includes("Retry original payment"));
    await render({ verifiedUserId: "verified-isolation-b" }); assert.doesNotMatch(text(), /Retry original payment|Manual multi-invoice payment/);
    await render({ verifiedUserId: "verified-isolation-a", organizationId: "org-b" }); assert.doesNotMatch(text(), /Retry original payment|Manual multi-invoice payment/);
    await render({ organizationId: "org-a", sessionScope: "verified-return" }); assert.match(text(), /Retry original payment/);
    assert.equal(control("Tendered").value, "100.00"); assert.equal(control("Tendered").disabled, true);
    assert.equal(s.calls.filter((call) => call.name === "record").length, 1);
    const collision = server(); collision.record(async () => { throw Error("Pending identity-specific result"); });
    await mount(collision, { verifiedUserId: "verified-collision:epoch", sessionScope: "x" }); await entry(); await click("Record Payment"); await settle(() => text().includes("Retry original payment"));
    await render({ verifiedUserId: "verified-collision", sessionScope: "epoch:x" });
    assert.doesNotMatch(text(), /Retry original payment|Manual multi-invoice payment/, "Actor and epoch delimiters cannot collide to reuse another actor's component state");
  });
  console.log(`paymentsWorkspace.test: ${cases} mounted UI/transport scenarios PASS; no provider, live DB or shared wiring.`);
} finally {
  await act(async () => root.unmount()); cache.clear(); globalThis.fetch = originalFetch; dom.window.close();
}
