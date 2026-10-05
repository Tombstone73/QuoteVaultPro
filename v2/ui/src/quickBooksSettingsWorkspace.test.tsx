import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createRequire } from "node:module";
import { JSDOM } from "jsdom";
import type { QuickBooksQueueActivity } from "./api";

const source = readFileSync(resolve("v2/ui/src/QuickBooksSettingsWorkspace.tsx"), "utf8");
const styles = readFileSync(resolve("v2/ui/src/QuickBooksSettingsWorkspace.css"), "utf8");

assert.match(source, /QuickBooks operational health/);
assert.match(source, /Operators approve each current Invoice version, then Force Sync/);
assert.match(source, /Approved current V2 Invoice versions queue automatically/);
assert.match(source, /Review invoice accounting work/);
assert.match(source, /Approve for accounting/);
assert.match(source, /Approval required/);
assert.match(source, /Force Sync selected/);
assert.match(source, /row\.accountingApproval!=="approved"/);
assert.match(source, /Open financial facts/);
assert.match(source, /Review activity/);
assert.match(source, /Open import preview/);
assert.match(source, /Select visible/);
assert.match(source, /Clear selection/);
assert.match(source, /setSelection\(new Set\(\)\)/);
assert.match(source, /setFinancialSelection\(new Set\(\)\)/);
assert.match(source, /selection\.size > 100/);
assert.match(source, /financialSelection\.size > 100/);
assert.match(source, /Reconcile & resume/);
assert.match(source, /Reconcile Payment \(read only\)/);
assert.match(source, /Retry sync/);
assert.match(source, /No V2 invoices need synchronization/);
assert.match(source, /Nothing needs action/);
assert.match(source, /quickBooksCompanyConnectionCopy/);
assert.match(source, /Dismiss QuickBooks authorization notice/);
assert.match(source, /Company association retained · authorization required/);
assert.match(source, /state\?\.companyAssociated && <button/);
assert.match(styles, /\.v2-quickbooks-health span\{[^}]*white-space:normal/);
console.log("QuickBooks operations console presentation contracts passed.");

const require = createRequire(import.meta.url);
const previousCss = require.extensions[".css"];
require.extensions[".css"] = () => {};
const React: typeof import("react") = require("react");
const { act } = React;
const { QueryClient, QueryClientProvider }: typeof import("@tanstack/react-query") = require("@tanstack/react-query");
const { createRoot }: typeof import("react-dom/client") = require("react-dom/client");
const { quickBooksIntegrationApi }: typeof import("./api") = require("./api");
const { QuickBooksSettingsWorkspace }: typeof import("./QuickBooksSettingsWorkspace") = require("./QuickBooksSettingsWorkspace");
const originalApi = { ...quickBooksIntegrationApi };
const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "https://ui.invalid/settings" });
const previousGlobals = new Map(["React", "window", "document", "IS_REACT_ACT_ENVIRONMENT", "fetch"].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
let networkCalls = 0;
Object.defineProperties(globalThis, {
  React: { configurable: true, value: React }, window: { configurable: true, value: dom.window }, document: { configurable: true, value: dom.window.document },
  IS_REACT_ACT_ENVIRONMENT: { configurable: true, value: true },
  fetch: { configurable: true, value: async () => { networkCalls++; throw new Error("Unexpected provider/network call in Accounting UI fixture."); } },
});
type Reconciliation = Awaited<ReturnType<typeof quickBooksIntegrationApi.reconcile>>;
const deferred = <T,>() => {
  let resolve!: (value: T) => void, reject!: (cause: unknown) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
};
const heldPayment = (id = "pay-a", customerName = "Customer A"): QuickBooksQueueActivity => ({ jobId: `job-${id}`, subjectKind: "payment", subjectId: id, displayNumber: `Invoice ${id}`, customerName, amountCents: 300, currency: "USD", state: "uncertain", attemptCount: 2, lastError: "Provider outcome unconfirmed", updatedAt: "2026-10-03T00:00:00Z", completedAt: null, providerId: null, retryEligible: false, recoveryEligible: true });
const queuePage = (items: readonly QuickBooksQueueActivity[]) => ({ items, total: items.length, page: 1, pageSize: 25, hasNextPage: false });
const queueRows = new Map<string, readonly QuickBooksQueueActivity[]>();
const reconciliationCalls: { organizationId: string; kind: string; subjectId: string; outcome: ReturnType<typeof deferred<Reconciliation>> }[] = [];
const queueCalls: string[] = [], forbiddenWrites: string[] = [];
quickBooksIntegrationApi.get = async () => ({ state: "not_connected", environment: "sandbox", connected: false, companyAssociated: false, connectedCompanyName: null, actionRequired: null, refunds: { state: "configuration_required", account: null } });
quickBooksIntegrationApi.policy = async () => ({ autoSync: false });
quickBooksIntegrationApi.operations = async () => ({ eligibleInvoiceCount: 0, awaitingApprovalInvoiceCount: 0, queueSummary: { queued: 0, processing: 0, succeeded: 0, actionRequired: 1 } });
quickBooksIntegrationApi.queue = async organizationId => { queueCalls.push(organizationId); return queuePage(queueRows.get(organizationId) ?? []); };
quickBooksIntegrationApi.reconcile = async (organizationId, kind, subjectId) => { const outcome = deferred<Reconciliation>(); reconciliationCalls.push({ organizationId, kind, subjectId, outcome }); return outcome.promise; };
for (const name of ["connect", "disconnect", "setPolicy", "setRefundDisbursementAccount", "approveInvoice", "syncSelected", "syncFinancial", "retry", "importInvoices"] as const) {
  quickBooksIntegrationApi[name] = (async () => { forbiddenWrites.push(name); throw new Error(`Unexpected write/retry ${name}`); }) as never;
}
const flush = () => act(async () => { await new Promise(done => setTimeout(done, 0)); });
const settle = async (predicate: () => boolean) => {
  for (let step = 0; step < 60; step++) { await flush(); if (predicate()) return; }
  assert.ok(predicate(), `Accounting UI did not settle: ${document.body.textContent}`);
};
type Props = React.ComponentProps<typeof QuickBooksSettingsWorkspace>;
const mount = async () => {
  queueRows.clear(); queueRows.set("org-a", [heldPayment()]); reconciliationCalls.length = 0; queueCalls.length = 0;
  const container = document.createElement("div"); document.body.append(container);
  const root = createRoot(container);
  // Even a host default retry cannot turn this explicit reconciliation into a loop.
  const cache = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity, gcTime: Infinity }, mutations: { retry: 2 } } });
  let props: Props = { organizationId: "org-a", sessionScope: "session-a", canConfigure: true };
  const render = async (changes: Partial<Props> = {}) => { props = { ...props, ...changes }; await act(async () => root.render(<QueryClientProvider client={cache}><QuickBooksSettingsWorkspace {...props} /></QueryClientProvider>)); await flush(); };
  const click = async (label: string) => {
    const button = [...container.querySelectorAll("button")].find(node => node.textContent === label);
    assert.ok(button, `${label} action is visible`); assert.equal(button.disabled, false);
    await act(async () => button.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }))); await flush();
  };
  const openQueue = async () => { await settle(() => Boolean([...container.querySelectorAll("button")].find(node => node.textContent === "Review activity"))); await click("Review activity"); await settle(() => !container.textContent!.includes("Loading queue")); };
  await render();
  return { container, render, click, openQueue, close: async () => { await act(async () => root.unmount()); cache.clear(); container.remove(); } };
};
let mountedCases = 0;
try {
  const success = await mount();
  try {
    await success.openQueue(); assert.equal(reconciliationCalls.length, 0, "No read reconciliation happens before explicit click");
    await success.click("Reconcile Payment (read only)");
    assert.deepEqual(reconciliationCalls.map(({ organizationId, kind, subjectId }) => [organizationId, kind, subjectId]), [["org-a", "payment", "pay-a"]]);
    const original = heldPayment(); queueRows.set("org-a", [{ ...original, state: "succeeded", lastError: null, providerId: "qb-payment-300", recoveryEligible: false }]);
    await act(async () => reconciliationCalls[0]!.outcome.resolve({ state: "succeeded", providerId: "qb-payment-300" }));
    await settle(() => Boolean(success.container.querySelector('[role="status"]')));
    assert.match(success.container.querySelector('[role="status"]')!.textContent!, /reconciled \(read only\): succeeded.*QuickBooks Payment ID: qb-payment-300.*No new Payment was queued/);
    await settle(() => !success.container.textContent!.includes("uncertain"));
    assert.equal(success.container.querySelector(".v2-settings-chip")!.textContent, "succeeded");
    assert.doesNotMatch(success.container.textContent!, /Retry sync|Reconcile & resume/); assert.equal(reconciliationCalls.length, 1);
    mountedCases++;
  } finally { await success.close(); }

  const conflict = await mount();
  try {
    await conflict.openQueue(); await conflict.click("Reconcile Payment (read only)");
    await act(async () => reconciliationCalls[0]!.outcome.reject({ code: "CONFLICT", message: "409: provider evidence requires operator reconciliation" }));
    await settle(() => Boolean(conflict.container.querySelector('[role="alert"]')));
    assert.match(conflict.container.querySelector('[role="alert"]')!.textContent!, /409: provider evidence.*Payment remains held.*No new export or retry was queued/);
    assert.match(conflict.container.textContent!, /uncertain/); assert.doesNotMatch(conflict.container.textContent!, /Nothing needs action|No queue activity|reconciled \(read only\): succeeded/);
    await flush(); await flush(); assert.equal(reconciliationCalls.length, 1, "409 is not automatically retried"); mountedCases++;
  } finally { await conflict.close(); }

  for (const invalid of [{ state: "queued", attemptCount: 2 }, { state: "succeeded", providerId: "" }] as const) {
    const unknown = await mount();
    try {
      await unknown.openQueue(); await unknown.click("Reconcile Payment (read only)"); await act(async () => reconciliationCalls[0]!.outcome.resolve(invalid));
      await settle(() => Boolean(unknown.container.querySelector('[role="alert"]')));
      assert.match(unknown.container.querySelector('[role="alert"]')!.textContent!, /remains held.*did not confirm a provider identity/);
      assert.equal(unknown.container.querySelector('[role="status"]'), null); assert.match(unknown.container.textContent!, /uncertain/); assert.equal(reconciliationCalls.length, 1); mountedCases++;
    } finally { await unknown.close(); }
  }

  const credential = await mount();
  try {
    queueRows.set("org-a", [{ ...heldPayment("invoice-a"), subjectKind: "invoice", lastError: "Failed to get valid access token" }]);
    await credential.openQueue(); await credential.click("Reconcile & resume");
    assert.deepEqual(reconciliationCalls.map(({ kind, subjectId }) => [kind, subjectId]), [["invoice", "invoice-a"]]);
    queueRows.set("org-a", [{ ...heldPayment("invoice-a"), subjectKind: "invoice", state: "queued", lastError: null, recoveryEligible: false }]);
    await act(async () => reconciliationCalls[0]!.outcome.resolve({ state: "queued", attemptCount: 2 }));
    await settle(() => credential.container.querySelector(".v2-settings-chip")?.textContent === "queued");
    assert.equal(credential.container.querySelector('[role="status"]'), null); assert.equal(credential.container.querySelector('[role="alert"]'), null); mountedCases++;
  } finally { await credential.close(); }

  const unattempted = await mount();
  const readonlyRetryStub = quickBooksIntegrationApi.retry;
  try {
    queueRows.set("org-a", [{ ...heldPayment(), state: "blocked", lastError: "Credentials were unavailable before preparation", retryEligible: true, recoveryEligible: false }]);
    const retryCalls: string[][] = [];
    quickBooksIntegrationApi.retry = async (organizationId, kind, subjectId) => { retryCalls.push([organizationId, kind, subjectId]); queueRows.set("org-a", [{ ...heldPayment(), state: "queued", retryEligible: false, recoveryEligible: false }]); return { state: "queued", attemptCount: 1 }; };
    await unattempted.openQueue(); assert.equal(retryCalls.length, 0);
    assert.doesNotMatch(unattempted.container.textContent!, /Reconcile Payment \(read only\)/);
    await unattempted.click("Retry sync");
    await settle(() => unattempted.container.querySelector(".v2-settings-chip")?.textContent === "queued");
    assert.deepEqual(retryCalls, [["org-a", "payment", "pay-a"]]); assert.equal(reconciliationCalls.length, 0); mountedCases++;
  } finally { quickBooksIntegrationApi.retry = readonlyRetryStub; await unattempted.close(); }

  for (const change of [{ organizationId: "org-b" }, { sessionScope: "session-b" }]) {
    const scoped = await mount();
    try {
      await scoped.openQueue(); await scoped.click("Reconcile Payment (read only)"); const old = reconciliationCalls[0]!;
      const nextOrg = change.organizationId ?? "org-a"; queueRows.set(nextOrg, [heldPayment("pay-new", "Customer in new scope")]);
      await scoped.render(change); await scoped.openQueue();
      const countBeforeLate = queueCalls.length;
      await act(async () => old.outcome.resolve({ state: "succeeded", providerId: "old-scope-provider-secret" })); await flush(); await flush();
      assert.match(scoped.container.textContent!, /Customer in new scope/);
      assert.doesNotMatch(scoped.container.textContent!, /Customer A|Invoice pay-a|old-scope-provider-secret|reconciled \(read only\): succeeded/);
      assert.equal(queueCalls.length, countBeforeLate, "Old-scope completion cannot refresh the new scope"); assert.equal(reconciliationCalls.length, 1); mountedCases++;
    } finally { await scoped.close(); }
  }

  const revoked = await mount();
  try {
    await revoked.openQueue(); await revoked.click("Reconcile Payment (read only)"); const old = reconciliationCalls[0]!;
    await revoked.render({ canConfigure: false });
    await act(async () => old.outcome.reject(new Error("old-scope held payment private error"))); await flush();
    assert.match(revoked.container.textContent!, /do not have permission/); assert.doesNotMatch(revoked.container.textContent!, /Customer A|pay-a|private error|provider/); mountedCases++;
  } finally { await revoked.close(); }
  assert.deepEqual(forbiddenWrites, [], "No sync, retry, create, OAuth or import is triggered by Payment read reconciliation");
  assert.equal(networkCalls, 0);
  console.log(`PASS ${mountedCases} mounted Accounting cases: explicit Payment read, confirmed ID/state, 409/unknown held, durable unattempted explicit retry, credential queue unchanged, tenant/session/grant fencing; zero provider/network writes.`);
} finally {
  Object.assign(quickBooksIntegrationApi, originalApi);
  if (previousCss) require.extensions[".css"] = previousCss; else delete require.extensions[".css"];
  for (const [key, descriptor] of previousGlobals) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete (globalThis as Record<string, unknown>)[key]; }
  dom.window.close();
}
