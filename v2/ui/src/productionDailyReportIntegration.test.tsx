import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { JSDOM } from "jsdom";
import type { ProductionDailyReport } from "../../src/modules/production/productionDailyReport";
import type { UiBootstrap, ProductionWorkProjection } from "./api";

assert.equal(process.env.V2_VALIDATION_MODE, "deterministic");
const require = createRequire(import.meta.url);
const dom = new JSDOM("<!doctype html><html><body><div id='root'></div></body></html>", { url: "https://ui.invalid/production" });
Object.assign(globalThis, { window: dom.window, document: dom.window.document, navigator: dom.window.navigator, HTMLElement: dom.window.HTMLElement, Event: dom.window.Event, localStorage: dom.window.localStorage, sessionStorage: dom.window.sessionStorage, IS_REACT_ACT_ENVIRONMENT: true });
// Only stylesheet evaluation is ignored. Actual App, ProductionWorkspace,
// report renderer and API stay on the same CommonJS React/query module graph.
const oldCss = require.extensions[".css"]; require.extensions[".css"] = () => {};
const React = require("react") as typeof import("react"), { act } = React;
const oldReact = (globalThis as { React?: typeof React }).React;
Object.assign(globalThis, { React });
const { createRoot } = require("react-dom/client") as typeof import("react-dom/client");
const { QueryClient, QueryClientProvider } = require("@tanstack/react-query") as typeof import("@tanstack/react-query");
const { App } = require("./App") as typeof import("./App");
const { defaultVisualAppearance } = require("./appearance") as typeof import("./appearance");
const { ProductionWorkspace } = require("./ProductionWorkspace") as typeof import("./ProductionWorkspace");
const { clearV2ApiSessionState, quoteApi, productionDailyReportApi } = require("./api") as typeof import("./api");
const org = "11111111-1111-4111-8111-111111111111", otherOrg = "22222222-2222-4222-8222-222222222222", user = "33333333-3333-4333-8333-333333333333";
const workId = "44444444-4444-4444-8444-444444444444";
const bootstrap: UiBootstrap = { organizationId: org, userId: user, sessionScope: "report-session-a", csrfToken: "report-csrf", capabilities: {
  quoteCreate: false, orderCreate: false, quoteOverridePrice: false, productionView: true, productionWork: false, productionComplete: false, prepressView: false,
} };
const queue = { items: [], pagination: { page: 1, pageSize: 25, totalCount: 0, totalPages: 1 }, counts: { total: 0 } };
const projection = { work: { productionWorkId: workId, organizationId: org, orderId: workId, orderLineId: workId, requirement: { key: "unit" }, orderedQuantity: 10, createdAt: "2026-10-01T00:00:00Z", createdPrincipalKind: "staff", createdPrincipalSubject: user, artworkAssignmentId: workId, artworkFileId: workId }, attempts: [], completedGoodQuantity: 0, recordedGoodQuantity: 0, rejectedGoodQuantity: 0, usableGoodQuantity: 0, remainingGoodQuantity: 10, unitQuantitySatisfied: false, state: "ready", exceptionEvents: [], outputDispositions: [], operatorContext: { orderNumber: "DEEP-LINK ORDER" } } as unknown as ProductionWorkProjection;
const data = (url: URL, label = "Current", tenant = org): ProductionDailyReport => {
  const mode = url.searchParams.get("mode") === "print" ? "print" : "page", page = Number(url.searchParams.get("page") ?? 1), pageSize = Number(url.searchParams.get("pageSize") ?? 25);
  const rows = Array.from({ length: 26 }, (_, index) => ({ productionWorkId: `${tenant === org ? "00000000" : "aaaaaaaa"}-0000-4000-8000-${String(index + 1).padStart(12, "0")}`, orderId: tenant === org ? workId : otherOrg, orderLineId: tenant === org ? workId : otherOrg, requirementKey: `unit-${index + 1}`, replacementObligationId: null, predecessorProductionWorkId: null, reworkCycleId: null, orderNumber: `${label} ORDER ${index + 1}`, customerName: `${label} CUSTOMER`, jobLabel: `${label} JOB ${index + 1}`, purchaseOrderNumber: "PO-REPORT", lineDescription: "Frozen report line", destination: index % 2 ? "flatbed" as const : "roll" as const, state: "ready" as const, dueDate: "2026-10-01", dueCategory: "today" as const, orderedQuantity: 10, remainingGoodQuantity: 10, activeAttemptId: null, requestedFulfillment: "pickup" as const }));
  return { mode,
    calendar: { asOf: "2026-10-01T14:00:00.000Z", timeZone: "America/New_York", todayDate: "2026-10-01", tomorrowDate: "2026-10-02" },
    summary: { totalActive: 26, distinctOrders: 1, activeAttempts: 0, overdue: 0, dueToday: 26, dueTomorrow: 0, future: 0, noDue: 0, roll: 13, flatbed: 13, unknownDestination: 0 },
    pagination: { page: mode === "print" ? 1 : page, pageSize: mode === "print" ? 1000 : pageSize, totalCount: 26, totalPages: mode === "print" ? 1 : Math.ceil(26 / pageSize) },
    coverage: { candidateLimit: 1000, blockedWorkCount: 0, truncated: false, countsComplete: true }, blockedWork: [],
    rows: mode === "print" ? rows : rows.slice((page - 1) * pageSize, page * pageSize) };
};
type WireCall = { url: URL; init?: RequestInit };
const calls: WireCall[] = [], deferred: { call: WireCall; resolve: (response: Response) => void }[] = [];
let currentBootstrap = structuredClone(bootstrap), reportMode: "success" | "error" | "defer-page" | "defer-print" = "success", prints = 0;
let denyPageReads = false, reportLabel = "Current";
const deniedPageCalls: WireCall[] = [];
const originalFetch = globalThis.fetch, originalPrint = window.print;
const response = (payload: unknown, status = 200, scope = currentBootstrap.sessionScope) => new Response(JSON.stringify(payload), { status, headers: { "content-type": "application/json", "x-v2-session-scope": scope } });
globalThis.fetch = async (input, init) => {
  const url = new URL(String(input), "https://ui.invalid"); const call = { url, init }; calls.push(call);
  assert.ok((init?.method ?? "GET") === "GET", `Report integration unexpectedly attempted a mutation: ${url}`);
  if (url.pathname.endsWith("/ui-bootstrap")) return response({ ok: true, data: currentBootstrap });
  if (url.pathname.endsWith("/production/daily-report")) {
    if (denyPageReads && url.searchParams.get("mode") === "page") {
      deniedPageCalls.push(call);
      return response({ ok: false, error: { code: "FORBIDDEN", message: "Production report view was revoked in the current session." } }, 403, bootstrap.sessionScope);
    }
    if (reportMode === "error") return response({ ok: false, error: { code: "CONFLICT", message: "Correct the organization reporting timezone before retrying." } }, 409);
    if ((reportMode === "defer-print" && url.searchParams.get("mode") === "print") || (reportMode === "defer-page" && url.searchParams.get("mode") === "page")) return new Promise(resolve => deferred.push({ call, resolve }));
    return response({ ok: true, data: data(url, reportLabel, currentBootstrap.organizationId) });
  }
  if (/\/production\/stations\/(?:roll|flatbed)\/queue$/.test(url.pathname)) return response({ ok: true, data: queue });
  if (url.pathname.endsWith(`/production/works/${workId}`)) return response({ ok: true, data: projection });
  if (url.pathname.endsWith("/prepress")) return response({ ok: false, error: { code: "FORBIDDEN", message: "Prepress permission is not granted." } }, 403);
  throw Error(`Unexpected authenticated API request: ${url}`);
};
window.print = () => { prints++; };
let root = createRoot(document.getElementById("root")!), cache = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
const text = () => document.body.textContent ?? "";
const button = (label: string) => {
  const parent = ["Overview", "Board", "Calendar", "Stations", "Daily Report"].includes(label) ? document.querySelector('[aria-label="Production view"]') : document;
  const element = [...(parent?.querySelectorAll<HTMLButtonElement>("button") ?? [])].find(node => node.textContent?.trim() === label);
  assert.ok(element, `Button ${label}`); return element;
};
const settle = async (predicate: () => boolean = () => true) => { for (let index = 0; index < 100; index++) { await act(async () => { await new Promise(resolve => setTimeout(resolve, 5)); }); if (predicate()) return; } assert.ok(predicate(), "Expected mounted report state"); };
const click = async (label: string) => { await act(async () => button(label).click()); await settle(); };
const reportCalls = () => calls.filter(call => call.url.pathname.endsWith("/production/daily-report"));
const baseCallCount = () => calls.filter(call => /\/production\/stations\/|\/prepress$/.test(call.url.pathname)).length;
const reset = async (path = "/production") => {
  await act(async () => root.unmount()); cache.clear(); root = createRoot(document.getElementById("root")!); cache = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  clearV2ApiSessionState(); currentBootstrap = structuredClone(bootstrap); reportMode = "success"; calls.length = 0; deferred.length = 0; prints = 0;
  denyPageReads = false; reportLabel = "Current"; deniedPageCalls.length = 0;
  window.history.replaceState({}, "", path); sessionStorage.clear(); sessionStorage.setItem("ph.v2.organization-id", org);
};
const mountApp = async (path = "/production") => { await reset(path); await act(async () => root.render(React.createElement(QueryClientProvider, { client: cache }, React.createElement(App, { appearance: defaultVisualAppearance, setAppearance: () => {} })))); await settle(() => Boolean(document.querySelector('[aria-label="Production view"]'))); };
const renderWorkspace = async (organizationId: string, sessionScope: string, canView = true) => {
  await act(async () => root.render(React.createElement(QueryClientProvider, { client: cache }, React.createElement(ProductionWorkspace, { organizationId, sessionScope, canView, canWork: false, canComplete: false, onStationChange: () => {}, onSelectWork: () => {}, openOrder: () => { throw Error("Report must not navigate an operational Order"); }, openCustomer: () => { throw Error("Report must not edit a Customer"); }, openArtwork: () => { throw Error("Report must not mutate Artwork"); } })))); await settle();
};
let cases = 0;
const check = async (name: string, work: () => Promise<void>) => { await work(); cases++; console.log(`PASS ${name}`); };
try {
  await check("actual App exposes fifth Daily Report with production.view only and correct authenticated request envelope", async () => {
    await mountApp(); assert.equal(currentBootstrap.capabilities.prepressView, false); assert.equal(button("Daily Report").getAttribute("aria-pressed"), "false");
    // A cached operational projection is not a grant. Daily mode must hide even
    // previously populated open-work controls, not merely an empty first page.
    await act(async () => { cache.setQueryData(["v2", bootstrap.sessionScope, org, "production", "eligible"], { items: [{ routingStepKind: "production", orderNumber: "Cached operational context", lineDescription: "Not report authority", quantity: 10, coverage: { productionArtworkComplete: true, allRequiredPrepressUnitsComplete: true, requirements: [{ artworkAssignmentIds: [workId], requirement: { key: "unit" } }] } }] }); });
    await settle(() => Boolean(document.querySelector(".v2-production-open-work")));
    assert.ok(document.querySelector(".v2-production-open-work")); assert.equal(button("Open Production Work").disabled, true);
    await click("Daily Report"); await settle(() => text().includes("Current JOB 1"));
    assert.equal(button("Daily Report").getAttribute("aria-pressed"), "true"); assert.match(text(), /Daily Production Report/);
    const call = reportCalls().at(-1)!; assert.equal(call.url.pathname, `/v2/organizations/${org}/production/daily-report`);
    assert.deepEqual([...call.url.searchParams.entries()], [["page", "1"], ["pageSize", "25"], ["mode", "page"]]);
    assert.equal(call.init?.method, "GET"); assert.equal(call.init?.credentials, "include"); assert.equal(call.init?.cache, "no-store"); assert.ok(call.init?.signal instanceof AbortSignal);
    assert.equal(call.init?.body, undefined); assert.equal((call.init?.headers as Record<string, string>)["content-type"], "application/json");
    assert.equal(document.querySelectorAll("[data-work-id]").length, 25); assert.equal(document.querySelector(".v2-production-open-work"), null);
    const before = baseCallCount(); await act(async () => { await cache.invalidateQueries({ queryKey: ["v2"] }); }); await settle();
    assert.equal(baseCallCount(), before, "daily mode disables queue/Prepress refetches instead of inventing a privileged read");
  });
  await check("real page and full-print client use matching renderer with server pagination and no auto print on a page read", async () => {
    await mountApp(); await click("Daily Report"); await settle(() => text().includes("Current JOB 1")); assert.equal(prints, 0);
    await click("Next page"); await settle(() => text().includes("Page 2 of 2"));
    assert.equal(reportCalls().at(-1)!.url.searchParams.get("page"), "2"); assert.match(text(), /Current JOB 26/); assert.equal(document.querySelectorAll("[data-work-id]").length, 1);
    await click("Print full report"); await settle(() => prints === 1);
    const call = reportCalls().find(call => call.url.searchParams.get("mode") === "print")!;
    assert.deepEqual([...call.url.searchParams.entries()], [["page", "1"], ["pageSize", "25"], ["mode", "print"]]);
    assert.equal(document.querySelectorAll(".production-daily-report-print [data-work-id]").length, 26); assert.equal(prints, 1);
  });
  await check("actual deep-linked Production work clears through existing callback and can be reopened after leaving report", async () => {
    await mountApp(`/production/works/${workId}`); await settle(() => text().includes("DEEP-LINK ORDER"));
    assert.equal(button("Stations").getAttribute("aria-pressed"), "true"); await click("Daily Report"); await settle(() => text().includes("Daily Production Report"));
    assert.equal(window.location.pathname, "/production"); assert.equal(document.querySelector(".v2-production-station-panel"), null);
    await click("Overview"); assert.equal(button("Daily Report").getAttribute("aria-pressed"), "false"); assert.equal(document.querySelector(".production-daily-report"), null);
    await act(async () => { window.history.pushState({}, "", `/production/works/${workId}`); window.dispatchEvent(new window.Event("popstate")); });
    await settle(() => button("Stations").getAttribute("aria-pressed") === "true"); assert.match(text(), /DEEP-LINK ORDER/); assert.equal(window.location.pathname, `/production/works/${workId}`);
  });
  await check("plain server ApiError becomes a safe coded Error in real API and report surface", async () => {
    await reset(); await quoteApi.bootstrap(org); reportMode = "error";
    await assert.rejects(productionDailyReportApi.dailyReport(org, { mode: "page" }), cause => cause instanceof Error && (cause as Error & { code: string }).code === "CONFLICT" && cause.message.includes("reporting timezone"));
    await renderWorkspace(org, bootstrap.sessionScope); await click("Daily Report"); await settle(() => Boolean(document.querySelector('[role="alert"]')));
    assert.match(text(), /Correct the organization reporting timezone/); assert.equal(button("Print full report").disabled, true); assert.equal(prints, 0);
  });
  await check("M9 generation rejects a late report both before and after body decode without caching old session data", async () => {
    for (const boundary of ["headers", "body"] as const) {
      await reset(); await quoteApi.bootstrap(org);
      if (boundary === "headers") {
        reportMode = "defer-page"; const pending = productionDailyReportApi.dailyReport(org, { mode: "page" }); const rejected = assert.rejects(pending, cause => cause instanceof Error && (cause as Error & { code: string }).code === "SESSION_CONTEXT_CHANGED");
        assert.equal(deferred.length, 1); clearV2ApiSessionState(); deferred[0].resolve(response({ ok: true, data: data(deferred[0].call.url, "Private old") })); await rejected;
      } else {
        const original = globalThis.fetch; let finishBody!: (value: unknown) => void, started = false;
        globalThis.fetch = async (input, init) => String(input).includes("/daily-report") ? { ok: true, headers: new Headers({ "x-v2-session-scope": bootstrap.sessionScope }), json: () => { started = true; return new Promise(resolve => { finishBody = resolve; }); } } as unknown as Response : original(input, init);
        try { const pending = productionDailyReportApi.dailyReport(org, {}); const rejected = assert.rejects(pending, cause => cause instanceof Error && (cause as Error & { code: string }).code === "SESSION_CONTEXT_CHANGED"); await settle(() => started); clearV2ApiSessionState(); finishBody({ ok: true, data: data(new URL(`https://ui.invalid/v2/organizations/${org}/production/daily-report`), "Private old") }); await rejected; } finally { globalThis.fetch = original; }
      }
      assert.equal(prints, 0); assert.doesNotMatch(text(), /Private old/);
    }
  });
  await check("late page and print responses cannot cross tenant/session scope or trigger an old print", async () => {
    await reset(); await quoteApi.bootstrap(org); await renderWorkspace(org, bootstrap.sessionScope); await click("Daily Report"); await settle(() => text().includes("Current JOB 1"));
    reportMode = "defer-print"; await click("Print full report"); const old = [...deferred]; assert.ok(old.length); assert.equal(prints, 0);
    clearV2ApiSessionState(); currentBootstrap = { ...currentBootstrap, organizationId: otherOrg, sessionScope: "report-session-b" }; reportMode = "success";
    await quoteApi.bootstrap(otherOrg); await renderWorkspace(otherOrg, currentBootstrap.sessionScope); await settle(() => reportCalls().some(call => call.url.pathname.includes(otherOrg)));
    await act(async () => old.forEach(call => call.resolve(response({ ok: true, data: data(call.call.url, "Private old", org) }, 200, bootstrap.sessionScope)))); await settle();
    assert.equal(prints, 0); assert.doesNotMatch(text(), /Private old/); assert.ok(old.every(call => call.call.init?.signal?.aborted));
    assert.equal(document.querySelector(".production-daily-report-print [data-work-id]"), null);
    const pendingCalls: typeof deferred = []; reportMode = "defer-page";
    await click("Next page"); pendingCalls.push(...deferred.filter(call => !old.includes(call))); assert.ok(pendingCalls.length);
    clearV2ApiSessionState(); currentBootstrap = { ...currentBootstrap, sessionScope: "report-session-c" }; reportMode = "success"; await quoteApi.bootstrap(otherOrg); await renderWorkspace(otherOrg, currentBootstrap.sessionScope);
    await act(async () => pendingCalls.forEach(call => call.resolve(response({ ok: true, data: data(call.call.url, "Private previous page", otherOrg) }, 200, "report-session-b")))); await settle();
    assert.doesNotMatch(text(), /Private previous page/); assert.equal(prints, 0);
  });
  await check("revoked canView unmounts report queries and blocks deferred print without granting another capability", async () => {
    await reset(); await quoteApi.bootstrap(org); await renderWorkspace(org, bootstrap.sessionScope); await click("Daily Report"); await settle(() => text().includes("Current JOB 1"));
    reportMode = "defer-print"; await click("Print full report"); const old = [...deferred]; await renderWorkspace(org, bootstrap.sessionScope, false);
    await act(async () => old.forEach(call => call.resolve(response({ ok: true, data: data(call.call.url, "Private revoked") })))); await settle();
    assert.match(text(), /do not have permission to view Production/); assert.doesNotMatch(text(), /Private revoked/); assert.equal(prints, 0); assert.equal(document.querySelector(".production-daily-report"), null);
  });
  await check("same-session report denial removes prepared print DOM, rejects a late print and requires an explicit new print after recovery", async () => {
    const observed: { sequence: string; stage: string; printRows: number; printDocuments: number; oldProtectedText: boolean; prints: number }[] = [];
    const expected: typeof observed = [];
    const capture = (sequence: string, stage: string) => {
      const printRoot = document.querySelector(".production-daily-report-print");
      observed.push({ sequence, stage, printRows: printRoot?.querySelectorAll("[data-work-id]").length ?? 0,
        printDocuments: printRoot?.querySelectorAll(".production-daily-report-heading").length ?? 0,
        oldProtectedText: /Current JOB|Late denied JOB/.test(printRoot?.textContent ?? ""), prints });
      expected.push({ sequence, stage, printRows: 0, printDocuments: 0, oldProtectedText: false, prints: 1 });
    };
    for (const sequence of ["prepared", "in-flight"] as const) {
      await mountApp(); await click("Daily Report"); await settle(() => text().includes("Current JOB 1"));
      await click("Print full report"); await settle(() => prints === 1);
      assert.equal(document.querySelectorAll(".production-daily-report-print [data-work-id]").length, 26, "a valid protected print document was prepared before denial");
      const initialBootstrapCalls = calls.filter(call => call.url.pathname.endsWith("/ui-bootstrap")).length;
      let pendingPrint: typeof deferred = [];
      if (sequence === "in-flight") {
        reportMode = "defer-print"; await click("Print full report");
        pendingPrint = [...deferred]; assert.ok(pendingPrint.length, "the second actual print request is still in flight");
      }
      denyPageReads = true;
      await click("Refresh"); await settle(() => text().includes("Production report view was revoked in the current session."));
      assert.equal(deniedPageCalls.length, 1, "the actual Refresh reached the page API and returned the same-session 403");
      assert.equal(currentBootstrap.capabilities.productionView, true);
      assert.equal(currentBootstrap.sessionScope, bootstrap.sessionScope);
      assert.equal(calls.filter(call => call.url.pathname.endsWith("/ui-bootstrap")).length, initialBootstrapCalls, "bootstrap was not refreshed into canView=false");
      const cachedBootstrap = cache.getQueryCache().getAll().map(query => query.state.data as Partial<UiBootstrap> | undefined)
        .find(value => value?.organizationId === org && value.userId === user && value.sessionScope === bootstrap.sessionScope && value.capabilities?.productionView === true);
      assert.ok(cachedBootstrap, "the actual App still holds the production.view bootstrap in the same epoch");
      const failedRead = cache.getQueryCache().getAll().find(query => query.queryKey.includes("daily-report") && query.state.error);
      assert.ok(failedRead?.state.error instanceof Error);
      assert.equal((failedRead.state.error as Error & { code: string }).code, "FORBIDDEN", "the real API normalized the denial without changing session generation");
      assert.equal(button("Daily Report").getAttribute("aria-pressed"), "true"); assert.equal(button("Print full report").disabled, true);
      capture(sequence, "after-denial");
      if (sequence === "in-flight") {
        // The transport deliberately finishes despite abort, so renderer guards
        // must reject this snapshot instead of relying on network cancellation.
        await act(async () => pendingPrint.forEach(call => call.resolve(response({ ok: true, data: data(call.call.url, "Late denied", org) }, 200, bootstrap.sessionScope))));
        await settle(); capture(sequence, "after-late-print");
      }
      denyPageReads = false; reportMode = "success"; reportLabel = "Recovered";
      await click("Refresh"); await settle(() => text().includes("Recovered JOB 1") && !text().includes("Production report view was revoked in the current session."));
      capture(sequence, "after-clean-refresh");
      const beforeExplicitPrint = prints;
      await click("Print full report"); await settle(() => prints === beforeExplicitPrint + 1);
      assert.equal(document.querySelectorAll(".production-daily-report-print [data-work-id]").length, 26);
      assert.match(document.querySelector(".production-daily-report-print")?.textContent ?? "", /Recovered JOB 1/);
      assert.doesNotMatch(document.querySelector(".production-daily-report-print")?.textContent ?? "", /Current JOB|Late denied JOB/);
    }
    // Evaluate every denial/recovery boundary, even if the first one leaks, so
    // one permanent regression records both Ctrl+P data and late auto-print risk.
    assert.deepEqual(observed, expected, "same-session FORBIDDEN must erase protected print documents and invalidate pending/prepared snapshots until a new explicit print");
  });
  console.log(`Production daily report actual App/workspace/API integration: ${cases} cases passed. Bootstrap and operational/report wire DTOs are intercepted fixtures; actual API generation, query signals, renderer and print guards execute. No browser print-layout/provider proof.`);
} finally { await act(async () => root.unmount()); cache.clear(); clearV2ApiSessionState(); globalThis.fetch = originalFetch; window.print = originalPrint; if (oldCss) require.extensions[".css"] = oldCss; else delete require.extensions[".css"]; if (oldReact) Object.assign(globalThis, { React: oldReact }); else delete (globalThis as { React?: typeof React }).React; dom.window.close(); }
