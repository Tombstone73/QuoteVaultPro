import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import React, { act } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { JSDOM } from "jsdom";
import { ProductionDailyReport, ProductionDailyReportDocument } from "./ProductionDailyReport";
import { createProductionDailyReportClient, type ProductionDailyReport as Report, type ProductionDailyReportClient, type ProductionDailyReportRow } from "./productionDailyReportApi";
import { productionDueCategory, summarizeProductionDailyReport, type ProductionDailyReportRequest } from "../../src/modules/production/productionDailyReport";

Object.assign(globalThis, { React });
const calendar = { asOf: "2026-10-02T02:00:00.000Z", timeZone: "America/New_York", todayDate: "2026-10-01", tomorrowDate: "2026-10-02" };
const rows: ProductionDailyReportRow[] = Array.from({ length: 28 }, (_, index) => ({
  productionWorkId: `work-${String(index).padStart(2, "0")}`, orderId: index < 2 ? "mixed-order" : `order-${index}`, orderLineId: `line-${index}`, requirementKey: `unit-${index}`,
  replacementObligationId: index === 4 ? "replacement-a" : null, predecessorProductionWorkId: null, reworkCycleId: null,
  destination: index === 27 ? "unknown" : index % 2 === 0 ? "roll" : "flatbed",
  dueDate: index === 27 ? null : index === 0 ? "2026-09-30" : index === 2 ? "2026-10-02" : "2026-10-01",
  dueCategory: productionDueCategory(index === 27 ? null : index === 0 ? "2026-09-30" : index === 2 ? "2026-10-02" : "2026-10-01", calendar),
  orderNumber: index < 2 ? "ORD-MIXED" : `ORD-${index}`, customerName: "Customer A", purchaseOrderNumber: "PO-kept", jobLabel: index === 0 ? null : "Canonical Job Label",
  lineDescription: index === 1 ? "<script>not executable</script>" : "Frozen line description", requestedFulfillment: index % 4 === 0 ? "pickup" : index % 4 === 1 ? "shipping" : index % 4 === 2 ? "local_delivery" : "not_recorded",
  orderedQuantity: 10, remainingGoodQuantity: index === 0 ? 0 : 10, activeAttemptId: index === 0 ? "attempt-a" : null, state: index === 0 ? "held" : "ready",
}));
const report = (mode: "page" | "print" = "page", page = 1, population = rows): Report => {
  const pageSize = mode === "print" ? 1_000 : 25;
  return { calendar, summary: summarizeProductionDailyReport(population, calendar), rows: mode === "print" ? population : population.slice((page - 1) * pageSize, page * pageSize), blockedWork: [], pagination: { page, pageSize, totalPages: Math.ceil(population.length / pageSize), totalCount: population.length }, coverage: { truncated: false, countsComplete: true, candidateLimit: 1_000, blockedWorkCount: 0 }, mode };
};
const markup = renderToStaticMarkup(<ProductionDailyReportDocument report={report("print")} />);
for (const label of ["Daily Production Report", "Roll", "Flatbed", "Due", "Order", "Customer", "PO / Job Info", "Qty", "Requested Fulfillment", "Pickup", "Ship", "Delivery", "Not recorded", "No due date", "Destination not recorded", "PO-kept", "Canonical Job Label", "On hold", "0 remaining", "Replacement replacement-a"]) assert.ok(markup.includes(label), label);
assert.match(markup, /dateTime="2026-10-01"[^>]*>2026-10-01/, "requested calendar date is not shifted by the browser timezone");
assert.ok(!markup.includes("<script>"), "owner text is escaped by React");
assert.equal((markup.match(/data-work-id=/g) ?? []).length, 28);
const partial = renderToStaticMarkup(<ProductionDailyReportDocument report={{ ...report("print"), coverage: { truncated: true, countsComplete: false, candidateLimit: 1_000, blockedWorkCount: 0 } }} />);
assert.match(partial, /Partial report:[\s\S]*not all active work/);
const withBlocked = (value: Report): Report => ({ ...value, blockedWork: [{ productionWorkId: "lost-replacement-lineage", orderId: "mixed-order", orderLineId: "lost-line", requirementKey: "unit", reasonCode: "unresolved_replacement_rework_lineage", reason: "BDR4: replacement rework lineage is missing; classification is withheld." }], coverage: { ...value.coverage, countsComplete: false, blockedWorkCount: 1 } });
const blockedMarkup = renderToStaticMarkup(<ProductionDailyReportDocument report={withBlocked(report("print"))} />);
assert.equal((blockedMarkup.match(/data-work-id=/g) ?? []).length, 28, "independently eligible rows survive a blocked work");
assert.equal((blockedMarkup.match(/data-blocked-work-id=/g) ?? []).length, 1);
assert.match(blockedMarkup, /Blocked work[\s\S]*BDR4/); assert.match(blockedMarkup, /Counts are not complete/);
assert.match(blockedMarkup, /not classified as original or replacement/);
const css = await readFile(new URL("./productionDailyReport.css", import.meta.url), "utf8");
for (const rule of ["@media print", "size: landscape", "display: table-header-group", "break-inside: avoid", "break-before: page", "min-width: 0", "visibility: hidden", "@media (max-width: 760px)"]) assert.ok(css.includes(rule), rule);

const transportCalls: { path: string; init: RequestInit }[] = [];
const api = createProductionDailyReportClient(async <T,>(path: string, init: RequestInit): Promise<T> => { transportCalls.push({ path, init }); return report() as T; });
const controller = new AbortController();
await api.dailyReport("org / a", { page: 2, pageSize: 50 }, controller.signal);
assert.equal(transportCalls[0]!.path, "/v2/organizations/org%20%2F%20a/production/daily-report?page=2&pageSize=50&mode=page");
assert.equal(transportCalls[0]!.init.method, "GET"); assert.equal(transportCalls[0]!.init.signal, controller.signal); assert.equal(transportCalls[0]!.init.cache, "no-store");
await api.dailyReport("org-a", { mode: "print" }); assert.match(transportCalls[1]!.path, /mode=print$/);

const dom = new JSDOM("<!doctype html><html><body><div id='root'></div></body></html>");
Object.assign(globalThis, { window: dom.window, document: dom.window.document, navigator: dom.window.navigator, HTMLElement: dom.window.HTMLElement, Event: dom.window.Event, IS_REACT_ACT_ENVIRONMENT: true });
const { createRoot } = await import("react-dom/client");
const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
queryClient.setQueryData(["v2", "scope-a", "org-a", "production", "daily-report", 1, 25], report());
const root = createRoot(document.getElementById("root")!);
type Pending = { organizationId: string; request: ProductionDailyReportRequest; signal?: AbortSignal; resolve: (value: Report) => void };
const pending: Pending[] = [], calls: Omit<Pending, "resolve">[] = [];
const injected: ProductionDailyReportClient = { dailyReport: async (organizationId, request, signal) => {
  calls.push({ organizationId, request, signal });
  if (organizationId === "org-error") throw Error("Operational eligibility is unresolved (BDR-4).");
  return new Promise<Report>(resolve => pending.push({ organizationId, request, signal, resolve }));
} };
const printed: string[] = [];
dom.window.print = () => printed.push(document.querySelector(".production-daily-report-print")!.innerHTML);
const render = async (overrides: Partial<React.ComponentProps<typeof ProductionDailyReport>> = {}) => { await act(async () => { root.render(<QueryClientProvider client={queryClient}><ProductionDailyReport organizationId="org-a" sessionScope="scope-a" canView client={injected} {...overrides} /></QueryClientProvider>); }); };
const text = () => document.body.textContent ?? "";
const screenIds = () => [...document.querySelectorAll(".production-daily-report-screen [data-work-id]")].map(element => element.getAttribute("data-work-id"));
const click = async (label: string) => { const button = [...document.querySelectorAll("button")].find(element => element.textContent === label)!; assert.ok(button, label); assert.equal(button.disabled, false); await act(async () => { button.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })); }); };
const settle = async () => { for (let i = 0; i < 8; i++) await act(async () => { await new Promise(resolve => setTimeout(resolve, 5)); }); };
try {
  await render({ organizationId: "" }); assert.match(text(), /authenticated organization/); assert.equal(calls.length, 0);
  await render({ sessionScope: "" }); assert.match(text(), /authenticated organization/); assert.equal(calls.length, 0);
  await render({ canView: false }); assert.match(text(), /do not have permission/); assert.equal(calls.length, 0); assert.doesNotMatch(text(), /ORD-MIXED|Print full report/);
  await render(); assert.equal(screenIds().length, 25); assert.match(text(), /28/); assert.equal(calls.length, 0, "injected client and session-partitioned cache remain independently testable");
  await click("Next page"); assert.match(text(), /Loading the Production daily report/); assert.deepEqual(screenIds(), []);
  assert.deepEqual(calls[0]!.request, { page: 2, pageSize: 25, mode: "page" });
  await act(async () => { pending.shift()!.resolve(report("page", 2)); }); await settle();
  assert.deepEqual(screenIds(), ["work-26", "work-25", "work-27"]); assert.match(text(), /Page 2 of 2/); assert.match(text(), /Summary counts cover all eligible works/);
  await click("Print full report"); assert.match(text(), /Preparing the full report snapshot/); assert.equal(printed.length, 0, "never print a sliced screen page");
  assert.deepEqual(calls.at(-1)!.request, { mode: "print" });
  await act(async () => { pending.shift()!.resolve(withBlocked({ ...report("print"), calendar: { ...calendar, asOf: "2026-10-02T03:00:00.000Z" } })); }); await settle();
  assert.equal(printed.length, 1); assert.equal((printed[0]!.match(/data-work-id=/g) ?? []).length, 28); assert.ok(printed[0]!.includes("work-00") && printed[0]!.includes("work-27"));
  assert.ok(printed[0]!.includes("2026-10-02T03:00:00.000Z"), "print header is from its own consistent full snapshot, not the earlier screen response");
  assert.equal((printed[0]!.match(/data-blocked-work-id=/g) ?? []).length, 1); assert.match(printed[0]!, /BDR4/); assert.match(printed[0]!, /Counts are not complete/);
  assert.deepEqual(screenIds(), ["work-26", "work-25", "work-27"], "printing does not replace or re-slice the screen page");
  await click("Print full report"); const stale = pending.shift()!;
  await render({ canView: false }); assert.doesNotMatch(text(), /ORD-MIXED|Customer A|work-27/);
  await act(async () => { stale.resolve(report("print")); }); await settle(); assert.equal(printed.length, 1, "revocation during an in-flight print cannot print or reveal cached data");
  await render(); assert.equal(printed.length, 1); assert.deepEqual(screenIds(), ["work-26", "work-25", "work-27"]);
  await click("Print full report"); await act(async () => { pending.shift()!.resolve(report("page", 2)); }); await settle();
  assert.equal(printed.length, 1, "a sliced/malformed print response must never reach browser print"); assert.match(text(), /full print snapshot is unavailable[\s\S]*Nothing has been printed/);
  await render({ organizationId: "org-b", sessionScope: "scope-b" }); assert.match(text(), /Loading the Production daily report/); assert.doesNotMatch(text(), /Customer A|work-27/);
  assert.equal(calls.at(-1)!.organizationId, "org-b"); assert.equal(calls.at(-1)!.request.page, 1, "tenant switch resets paging without an old-tenant request");
  await act(async () => { pending.shift()!.resolve(report("page", 1, [])); }); await settle(); assert.match(text(), /No active Production work requires attention/);
  await render({ organizationId: "org-blocked", sessionScope: "scope-blocked" }); await act(async () => { pending.shift()!.resolve(withBlocked(report("page", 1, []))); }); await settle();
  assert.match(text(), /No eligible work in the resolved population/); assert.doesNotMatch(text(), /No active Production work requires attention/); assert.match(text(), /BDR4/);
  await render({ sessionScope: "scope-new" }); assert.match(text(), /Loading the Production daily report/); assert.doesNotMatch(text(), /Customer A|work-27/);
  await act(async () => { pending.shift()!.resolve(report("page", 1, [])); }); await settle(); assert.match(text(), /No active Production work requires attention/);
  await render({ organizationId: "org-error", sessionScope: "scope-error" }); await settle(); assert.match(document.querySelector('[role="alert"]')!.textContent ?? "", /Operational eligibility is unresolved/);
  assert.equal(printed.length, 1);
} finally {
  await act(async () => { root.unmount(); }); queryClient.clear(); dom.window.close();
}
console.log("productionDailyReport UI: explicit missing fields, injected GET client, calendar dates, accessible states, pagination, full matching print, authority revocation and tenant/session isolation PASS");
