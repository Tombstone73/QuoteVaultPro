import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import { JSDOM } from "jsdom";
import type { ProductionDailyReport } from "../../src/modules/production/productionDailyReport";
import type { UiBootstrap, ProductionWorkProjection } from "./api";
import type { ProductionOutputReceipt } from "./productionRecoveryApi";

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
const { ProductionRunWorkspace } = require("./ProductionRunWorkspace") as typeof import("./ProductionRunWorkspace");
const apiModule = require("./api") as typeof import("./api");
const { clearV2ApiSessionState, quoteApi, productionDailyReportApi } = apiModule;
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
const calls: WireCall[] = [], deferred: { call: WireCall; resolve: (response: Response) => void }[] = [], outputCalls: { call: WireCall; body: Record<string, unknown> }[] = [];
let currentBootstrap = structuredClone(bootstrap), reportMode: "success" | "error" | "defer-page" | "defer-print" = "success", prints = 0;
let denyPageReads = false, reportLabel = "Current";
let outputMode: "none" | "ordinary" | "run" = "none", outputFailuresRemaining = 0, activeRunResponse: unknown;
let operationalProjection = projection, operationalQueue = queue;
const durableReceipts=new Map<string,ProductionOutputReceipt>();
const receiptCreators=new Map<string,string>();
let pausePrepareJson=false;
const pausedPrepareBodies:{resume:()=>void;scope:string;body:Record<string,unknown>}[]=[];
const deniedPageCalls: WireCall[] = [];
let ownerHttp:((call:WireCall)=>Promise<Response>)|undefined;
const originalFetch = globalThis.fetch, originalPrint = window.print;
const response = (payload: unknown, status = 200, scope = currentBootstrap.sessionScope) => new Response(JSON.stringify(payload), { status, headers: { "content-type": "application/json", "x-v2-session-scope": scope } });
globalThis.fetch = async (input, init) => {
  const url = new URL(String(input), "https://ui.invalid"); const call = { url, init }; calls.push(call);
  if(ownerHttp&&(/\/production\/runs(?:\/|$)/.test(url.pathname)||/\/production\/output-(?:recovery|intents)/.test(url.pathname))){if(init?.method==="POST"&&url.pathname.endsWith("/output"))outputCalls.push({call,body:JSON.parse(String(init.body))});return ownerHttp(call);}
  if ((init?.method ?? "GET") === "POST") {
    assert.notEqual(outputMode, "none", `Unexpected Production mutation: ${url}`);
    const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
    if(url.pathname.includes("/production/output-intents/")){
      const operation=url.pathname.split("/").at(-1) as ProductionOutputReceipt["operation"];
      const prior=durableReceipts.get(String(body.businessRequestId));
      const receipt=prior??{operation,businessRequestId:String(body.businessRequestId),productionWorkId:workId,productionAttemptId:String(body.productionAttemptId??"88888888-8888-4888-8888-888888888888"),...(body.productionRunId?{productionRunId:String(body.productionRunId),productionRunAllocationId:String(body.productionRunAllocationId)}:{}),intent:body as ProductionOutputReceipt["intent"],submittedAt:new Date().toISOString(),status:"pending" as const,result:null};
      durableReceipts.set(receipt.businessRequestId,receipt);if(!prior)receiptCreators.set(receipt.businessRequestId,String(currentBootstrap.userId));
      const result=response({ok:true,data:{...receipt,intent:body}});
      if(pausePrepareJson){const json=result.json.bind(result);const gate=new Promise<void>(resume=>pausedPrepareBodies.push({resume,scope:currentBootstrap.sessionScope,body}));result.json=async()=>{await gate;return json();};}
      return result;
    }
    outputCalls.push({ call, body });
    if (outputFailuresRemaining > 0) { outputFailuresRemaining--; return response({ ok: false, error: { code: "RETRYABLE_FAILURE", message: "The Production output response was lost." } }, 503); }
    const receipt=durableReceipts.get(String(body.businessRequestId));if(receipt)durableReceipts.set(receipt.businessRequestId,{...receipt,status:"succeeded",result:outputMode==="run"?activeRunResponse:{work:{organizationId:org,productionWorkId:workId},attempt:{productionAttemptId:receipt.productionAttemptId,productionWorkId:workId}}});
    return response({ ok: true, data: outputMode === "run" ? activeRunResponse : { accepted: true } });
  }
  assert.equal(init?.method ?? "GET", "GET", `Report integration unexpectedly attempted a non-GET request: ${url}`);
  if (url.pathname.endsWith("/ui-bootstrap")) return response({ ok: true, data: currentBootstrap });
  if(url.pathname.endsWith("/production/output-recovery"))return response({ok:true,data:currentBootstrap.organizationId===org?[...durableReceipts.values()].filter(receipt=>receipt.operation===url.searchParams.get("operation")&&(!url.searchParams.has("businessRequestId")||receipt.businessRequestId===url.searchParams.get("businessRequestId"))).reverse().map(receipt=>receiptCreators.get(receipt.businessRequestId)===currentBootstrap.userId?receipt:{...receipt,intent:null,intentRedacted:true,rejection:undefined}):[]});
  if (url.pathname.endsWith("/production/daily-report")) {
    if (denyPageReads && url.searchParams.get("mode") === "page") {
      deniedPageCalls.push(call);
      return response({ ok: false, error: { code: "FORBIDDEN", message: "Production report view was revoked in the current session." } }, 403, bootstrap.sessionScope);
    }
    if (reportMode === "error") return response({ ok: false, error: { code: "CONFLICT", message: "Correct the organization reporting timezone before retrying." } }, 409);
    if ((reportMode === "defer-print" && url.searchParams.get("mode") === "print") || (reportMode === "defer-page" && url.searchParams.get("mode") === "page")) return new Promise(resolve => deferred.push({ call, resolve }));
    return response({ ok: true, data: data(url, reportLabel, currentBootstrap.organizationId) });
  }
  if (/\/production\/stations\/(?:roll|flatbed)\/queue$/.test(url.pathname)) return response({ ok: true, data: url.pathname.endsWith("/flatbed/queue") ? operationalQueue : queue });
  if (url.pathname.endsWith(`/production/works/${workId}`)) return response({ ok: true, data: operationalProjection });
  if (url.pathname.endsWith("/production/runs")) return response({ ok: true, data: activeRunResponse && (activeRunResponse as { stationKey?: string }).stationKey === url.searchParams.get("station") ? [activeRunResponse] : [] });
  if (url.pathname.endsWith("/prepress")) return response({ ok: false, error: { code: "FORBIDDEN", message: "Prepress permission is not granted." } }, 403);
  throw Error(`Unexpected authenticated API request: ${url}`);
};
window.print = () => { prints++; };
let root = createRoot(document.getElementById("root")!), cache = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity },mutations:{gcTime:Infinity} } });
const text = () => document.body.textContent ?? "";
const button = (label: string) => {
  const parent = ["Overview", "Board", "Calendar", "Stations", "Daily Report"].includes(label) ? document.querySelector('[aria-label="Production view"]') : document;
  const element = [...(parent?.querySelectorAll<HTMLButtonElement>("button") ?? [])].find(node => node.textContent?.trim() === label);
  assert.ok(element, `Button ${label}`); return element;
};
const settle = async (predicate: () => boolean = () => true) => { for (let index = 0; index < 100; index++) { await act(async () => { await new Promise(resolve => setTimeout(resolve, 5)); }); if (predicate()) return; } assert.ok(predicate(), "Expected mounted report state"); };
const click = async (label: string) => { await act(async () => button(label).click()); await settle(); };
const reportCalls = () => calls.filter(call => call.url.pathname.endsWith("/production/daily-report"));
const setInputValue = async (selector: string, value: string) => {
  const input = document.querySelector<HTMLInputElement>(selector); assert.ok(input, `Input ${selector}`);
  const setter = Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, "value")?.set; assert.ok(setter);
  await act(async () => { setter.call(input, value); input.dispatchEvent(new dom.window.Event("input", { bubbles: true })); });
  assert.equal(input.value, value);
};
const withStorageMethodThrowing = async (method: "getItem" | "setItem", work: () => Promise<void>) => {
  const prototype = dom.window.Storage.prototype, descriptor = Object.getOwnPropertyDescriptor(prototype, method); assert.ok(descriptor);
  Object.defineProperty(prototype, method, { ...descriptor, value: () => { throw new Error(`Injected sessionStorage ${method} failure`); } });
  try { await work(); } finally { Object.defineProperty(prototype, method, descriptor); }
};
const withStorageReadbackMismatch = async (key: string, work: () => Promise<void>) => {
  const prototype = dom.window.Storage.prototype, descriptor = Object.getOwnPropertyDescriptor(prototype, "getItem"); assert.ok(descriptor);
  const original = descriptor.value as (this: Storage, key: string) => string | null;
  Object.defineProperty(prototype, "getItem", { ...descriptor, value: function(this: Storage, requestedKey: string) {
    const raw = original.call(this, requestedKey);
    if (requestedKey !== key || raw === null) return raw;
    const record = JSON.parse(raw) as Record<string, unknown>; return JSON.stringify({ ...record, businessRequestId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" });
  } });
  try { await work(); } finally { Object.defineProperty(prototype, "getItem", descriptor); }
};
const withRequestIdCounter = async (work: (count: () => number) => Promise<void>) => {
  const cryptoObject = globalThis.crypto, descriptor = Object.getOwnPropertyDescriptor(cryptoObject, "randomUUID"), original = cryptoObject.randomUUID.bind(cryptoObject);
  let count = 0;
  Object.defineProperty(cryptoObject, "randomUUID", { configurable: true, writable: true, value: () => { count++; return original(); } });
  try { await work(() => count); } finally { if (descriptor) Object.defineProperty(cryptoObject, "randomUUID", descriptor); else Reflect.deleteProperty(cryptoObject, "randomUUID"); }
};
const baseCallCount = () => calls.filter(call => /\/production\/stations\/|\/prepress$/.test(call.url.pathname)).length;
const reset = async (path = "/production") => {
  await act(async () => root.unmount()); cache.clear(); root = createRoot(document.getElementById("root")!); cache = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity },mutations:{gcTime:Infinity} } });
  clearV2ApiSessionState(); (globalThis as typeof globalThis & { __phV2ProductionOutputFences?: Map<string, string> }).__phV2ProductionOutputFences?.clear(); currentBootstrap = structuredClone(bootstrap); reportMode = "success"; calls.length = 0; deferred.length = 0; prints = 0;
  denyPageReads = false; reportLabel = "Current"; deniedPageCalls.length = 0; outputMode = "none"; outputFailuresRemaining = 0; outputCalls.length = 0; activeRunResponse = undefined; operationalProjection = projection; operationalQueue = queue;
  durableReceipts.clear();
  receiptCreators.clear();pausePrepareJson=false;pausedPrepareBodies.length=0;
  ownerHttp=undefined;
  window.history.replaceState({}, "", path); sessionStorage.clear(); sessionStorage.setItem("ph.v2.organization-id", org);
};
const mountApp = async (path = "/production") => { await reset(path); await act(async () => root.render(React.createElement(QueryClientProvider, { client: cache }, React.createElement(App, { appearance: defaultVisualAppearance, setAppearance: () => {} })))); await settle(() => Boolean(document.querySelector('[aria-label="Production view"]'))); };
const renderWorkspace = async (organizationId: string, sessionScope: string, canView = true, canWork = false) => {
  await act(async () => root.render(React.createElement(QueryClientProvider, { client: cache }, React.createElement(ProductionWorkspace, { organizationId, sessionScope, canView, canWork, canComplete: canWork, onStationChange: () => {}, onSelectWork: () => {}, openOrder: () => { throw Error("Report must not navigate an operational Order"); }, openCustomer: () => { throw Error("Report must not edit a Customer"); }, openArtwork: () => { throw Error("Report must not mutate Artwork"); } })))); await settle();
};
const renderRunWorkspace = async (organizationId: string, sessionScope: string) => {
  await act(async () => root.render(React.createElement(QueryClientProvider, { client: cache }, React.createElement(ProductionRunWorkspace, { organizationId, sessionScope, station: "flatbed", queue: [], canWork: true, onOpenArtwork: () => {} })))); await settle();
};
const openDirectRunOutput = async (organizationId: string, sessionScope: string) => {
  await renderRunWorkspace(organizationId, sessionScope);
  await settle(() => Boolean(document.querySelector(".v2-production-run-row")));
  await act(async () => document.querySelector<HTMLButtonElement>(".v2-production-run-row")!.click());
  await settle(() => Boolean(document.querySelector('[aria-label="Run good output"]')));
};
const remountWorkspace = async (organizationId: string, sessionScope: string, canWork = true) => {
  await act(async () => root.unmount()); root = createRoot(document.getElementById("root")!);
  await renderWorkspace(organizationId, sessionScope, true, canWork);
};
const remountRunWorkspace = async (organizationId: string, sessionScope: string) => {
  await act(async () => root.unmount()); root = createRoot(document.getElementById("root")!);
  await renderRunWorkspace(organizationId, sessionScope);
};
const prepareOrdinaryOutput = () => {
  outputMode = "ordinary"; outputFailuresRemaining = 1;
  const attempt = { productionAttemptId: "55555555-5555-4555-8555-555555555555", productionWorkId: workId, sequence: 1, kind: "initial", stationKey: "flatbed", goodQuantity: 0, wasteQuantity: 0, startedAt: "2026-10-02T10:00:00.000Z", startedPrincipalKind: "staff", startedPrincipalSubject: user };
  operationalProjection = { ...projection, attempts: [attempt], activeAttempt: attempt, recordedGoodQuantity: 0, remainingGoodQuantity: 5, state: "active" } as unknown as ProductionWorkProjection;
  operationalQueue = { items: [operationalProjection], pagination: { page: 1, pageSize: 25, totalCount: 1, totalPages: 1 }, counts: { total: 1 } } as unknown as typeof queue;
  return attempt;
};
const prepareRunOutput = () => {
  outputMode = "run"; outputFailuresRemaining = 1;
  const runId = "66666666-6666-4666-8666-666666666666", allocationId = "77777777-7777-4777-8777-777777777777";
  activeRunResponse = { productionRunId: runId, organizationId: org, stationKey: "flatbed", state: "active", revision: 2, materialFingerprint: null, layoutMetadata: {}, allocations: [{ productionRunAllocationId: allocationId, productionWorkId: workId, allocatedQuantity: 10, goodQuantity: 0, wasteQuantity: 0, artworkAssignmentId: workId, artworkFileId: workId, artworkIdentityFingerprint: `sha256:${"a".repeat(64)}`, artworkObjectVersion: "version-a", productionAttemptId: "88888888-8888-4888-8888-888888888888", position: 0 }], events: [] };
  return { runId, allocationId };
};
const openOutputSurface = async (mode: "ordinary" | "run", organizationId: string, sessionScope: string) => {
  await renderWorkspace(organizationId, sessionScope, true, true);
  if (mode === "ordinary") {
    await click("Stations"); await settle(() => Boolean(document.querySelector('[aria-label="Flatbed good output"]')));
  } else {
    await click("Board"); await click("Runs"); await click("Stations"); await settle(() => Boolean(document.querySelector(".v2-production-run-row")));
    await act(async () => document.querySelector<HTMLButtonElement>(".v2-production-run-row")!.click());
    await settle(() => Boolean(document.querySelector('[aria-label="Run good output"]')));
  }
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
  await check("sessionStorage setter failures fail closed for ordinary and Run output handlers", async () => {
    for (const mode of ["ordinary", "run"] as const) {
      await reset(); await quoteApi.bootstrap(org);
      if (mode === "ordinary") prepareOrdinaryOutput(); else prepareRunOutput();
      await openOutputSurface(mode, org, bootstrap.sessionScope);
      await setInputValue(mode === "ordinary" ? '[aria-label="Flatbed good output"]' : '[aria-label="Run good output"]', mode === "ordinary" ? "7" : "8");
      await withStorageMethodThrowing("setItem", async () => {
        await click("Record output");
        const alert = document.querySelector('[role="alert"]'); assert.ok(alert);
        assert.match(alert.textContent ?? "", /could not be saved and verified|saved Production output intent/);
        assert.equal(outputCalls.length, 0, `${mode} output POST must not run when storage persistence fails`);
        assert.doesNotMatch(alert.textContent ?? "", /55555555|66666666|77777777|7 good|8 good/);
      });
    }
  });
  await check("sessionStorage getter failures block mounted ordinary and Run output surfaces", async () => {
    for (const mode of ["ordinary", "run"] as const) {
      await reset(); await quoteApi.bootstrap(org);
      if (mode === "ordinary") prepareOrdinaryOutput(); else prepareRunOutput();
      await withStorageMethodThrowing("getItem", async () => {
        if (mode === "ordinary") { await renderWorkspace(org, bootstrap.sessionScope, true, true); await click("Stations"); }
        else await renderRunWorkspace(org, bootstrap.sessionScope);
        const alert = document.querySelector('[role="alert"]'); assert.ok(alert);
        assert.match(alert.textContent ?? "", /could not verify the Production output intent/);
        assert.equal(outputCalls.length, 0, `${mode} output POST must not run when storage reads fail`);
        assert.doesNotMatch(alert.textContent ?? "", /55555555|66666666|77777777|88888888|7 good|8 good/);
      });
    }
  });
  await check("mismatched canonical readback blocks both output APIs before submission", async () => {
    for (const mode of ["ordinary", "run"] as const) {
      await reset(); await quoteApi.bootstrap(org);
      if (mode === "ordinary") prepareOrdinaryOutput(); else prepareRunOutput();
      await openOutputSurface(mode, org, bootstrap.sessionScope);
      await setInputValue(mode === "ordinary" ? '[aria-label="Flatbed good output"]' : '[aria-label="Run good output"]', mode === "ordinary" ? "7" : "8");
      const key = mode === "ordinary" ? `ph.v2.production.pending-output.${org}.${bootstrap.sessionScope}` : `ph.v2.production.pending-run-output.${org}.${bootstrap.sessionScope}`;
      await withStorageReadbackMismatch(key, async () => {
        await click("Record output");
        const alert = document.querySelector('[role="alert"]'); assert.ok(alert);
        assert.match(alert.textContent ?? "", /could not be saved and verified|saved Production output intent/);
        assert.equal(outputCalls.length, 0, `${mode} mismatched readback must not submit`);
        assert.doesNotMatch(alert.textContent ?? "", /aaaaaaaa-aaaa|55555555|66666666|77777777|7 good|8 good/);
      });
    }
  });
  await check("canonical but malformed saved intents block remount and preflight without generating a new ID", async () => {
    for (const mode of ["ordinary", "run"] as const) {
      await reset(); await quoteApi.bootstrap(org);
      if (mode === "ordinary") prepareOrdinaryOutput(); else prepareRunOutput();
      await openOutputSurface(mode, org, bootstrap.sessionScope);
      if (mode === "run") await setInputValue('[aria-label="Run good output"]', "8");
      const key = mode === "ordinary" ? `ph.v2.production.pending-output.${org}.${bootstrap.sessionScope}` : `ph.v2.production.pending-run-output.${org}.${bootstrap.sessionScope}`;
      const malformed = mode === "ordinary"
        ? { organizationId: org, sessionScope: bootstrap.sessionScope, productionAttemptId: "55555555-5555-4555-8555-555555555555", businessRequestId: "99999999-9999-4999-8999-999999999999", submittedAt: "2026-10-02T11:00:00.000Z", input: { goodQuantityDelta: "7", wasteQuantityDelta: 0 } }
        : { organizationId: org, sessionScope: bootstrap.sessionScope, productionRunId: "66666666-6666-4666-8666-666666666666", allocationId: "77777777-7777-4777-8777-777777777777", businessRequestId: "99999999-9999-4999-8999-999999999999", submittedAt: "2026-10-02T11:00:00.000Z", input: { goodQuantityDelta: "8", wasteQuantityDelta: 0 } };
      sessionStorage.setItem("ph.v2.production.pending-output-presence", org);
      sessionStorage.setItem(key, JSON.stringify(malformed));
      await withRequestIdCounter(async count => {
        await click("Record output");
        assert.equal(count(), 0, `${mode} malformed intent must be rejected before businessRequestId generation`);
        assert.equal(outputCalls.length, 0);
      });
      const alert = document.querySelector(mode === "ordinary" ? '[aria-label="Blocked Production output recovery"]' : '[aria-label="Blocked Production Run output recovery"]'); assert.ok(alert); assert.match(alert.textContent ?? "", /malformed/);
      assert.doesNotMatch(document.body.textContent ?? "", /99999999|55555555|66666666|77777777|7 good|8 good/);
      if (mode === "ordinary") await remountWorkspace(org, bootstrap.sessionScope); else await remountRunWorkspace(org, bootstrap.sessionScope);
      assert.ok(document.querySelector('[role="alert"]'), `${mode} malformed recovery stays blocked after remount`);
      assert.equal(outputCalls.length, 0);
    }
  });
  await check("scope changes redact and fence both pending output intents until owner reconciliation", async () => {
    await reset(); await quoteApi.bootstrap(org);
    const attempt = prepareOrdinaryOutput(); await openOutputSurface("ordinary", org, bootstrap.sessionScope);
    await setInputValue('[aria-label="Flatbed good output"]', "7"); await click("Record output"); await settle(() => outputCalls.length === 1);
    const ordinaryRequestId = outputCalls[0]!.body.businessRequestId as string;
    clearV2ApiSessionState(); currentBootstrap = { ...currentBootstrap, sessionScope: "report-session-b" }; await quoteApi.bootstrap(org); operationalQueue = queue;
    await renderWorkspace(org, "report-session-b", true, true); await click("Stations");
    let recovery = document.querySelector('[role="alert"][aria-label*="Production output recovery"]'); assert.ok(recovery);
    assert.doesNotMatch(recovery.textContent ?? "", new RegExp(`${ordinaryRequestId}|${attempt.productionAttemptId}|7 good|0 waste`));
    assert.equal(outputCalls.length, 1); assert.ok(sessionStorage.getItem(`ph.v2.production.pending-output.${org}.${bootstrap.sessionScope}`));
    await click("Refresh Production state to reconcile");
    assert.equal(sessionStorage.getItem("ph.v2.production.pending-output-presence"),org,"projection refresh must not erase an unresolved physical output intent");
    assert.equal(outputCalls.length, 1, "projection refresh never creates another physical output request");

    await reset(); await quoteApi.bootstrap(org);
    const { runId, allocationId } = prepareRunOutput(); await openDirectRunOutput(org, bootstrap.sessionScope);
    await setInputValue('[aria-label="Run good output"]', "8"); await click("Record output"); await settle(() => outputCalls.length === 1);
    const runRequestId = outputCalls[0]!.body.businessRequestId as string;
    clearV2ApiSessionState(); currentBootstrap = { ...currentBootstrap, organizationId: otherOrg, sessionScope: "other-org-session" }; await quoteApi.bootstrap(otherOrg); activeRunResponse = undefined;
    await renderRunWorkspace(otherOrg, "other-org-session"); await settle(() => Boolean(document.querySelector('[aria-label="Redacted Production Run output recovery"], [aria-label="Blocked Production Run output recovery"]')));
    recovery = document.querySelector('[aria-label="Redacted Production Run output recovery"], [aria-label="Blocked Production Run output recovery"]'); assert.ok(recovery);
    assert.doesNotMatch(recovery.textContent ?? "", new RegExp(`${runRequestId}|${runId}|${allocationId}|88888888|8 good|0 waste`));
    assert.equal(document.querySelector('[aria-label="Run good output"]'), null);
    assert.equal(outputCalls.length, 1); assert.equal(sessionStorage.getItem("ph.v2.production.pending-output-presence"), org);
    assert.ok(sessionStorage.getItem(`ph.v2.production.pending-run-output.${org}.${bootstrap.sessionScope}`), "a different organization cannot silently clear the old intent");
  });
  await check("uncertain ordinary output retry reuses the exact attempt, quantities, timestamp and business request without clamping", async () => {
    await reset(); await quoteApi.bootstrap(org);
    const attempt = prepareOrdinaryOutput();
    await openOutputSurface("ordinary", org, bootstrap.sessionScope);
    await setInputValue('[aria-label="Flatbed good output"]', "7");
    await click("Record output"); await settle(() => outputCalls.length === 1 && Boolean(document.querySelector('[role="alert"]')));
    const first = outputCalls[0]!; const originalNotice = document.querySelector('[role="alert"]')?.textContent ?? "";
    assert.match(originalNotice, /The Production output response was lost/);
    assert.equal(first.call.url.pathname, `/v2/organizations/${org}/production/attempts/${attempt.productionAttemptId}/output`);
    assert.deepEqual(first.body, { goodQuantityDelta: 7, wasteQuantityDelta: 0, businessRequestId: first.body.businessRequestId });
    assert.match(String(first.body.businessRequestId), /^[0-9a-f-]{36}$/i); assert.match(originalNotice, /\d{4}-\d\d-\d\dT.*Z/); assert.match(originalNotice, /7 good and 0 waste/);
    const submittedAt = originalNotice.match(/\d{4}-\d\d-\d\dT[^ ]+Z/)?.[0];
    await remountWorkspace(org, bootstrap.sessionScope); await click("Stations");
    const recoveredNotice = document.querySelector(".v2-production-output-pending")?.textContent ?? "";
    assert.ok(recoveredNotice.includes(String(first.body.businessRequestId)) && submittedAt && recoveredNotice.includes(submittedAt));
    await click("Retry original output"); await settle(() => outputCalls.length === 2);
    const second = outputCalls[1]!;
    assert.equal(second.call.url.href, first.call.url.href); assert.deepEqual(second.body, first.body);
    assert.equal(sessionStorage.getItem(`ph.v2.production.pending-output.${org}.${bootstrap.sessionScope}`), null);
    assert.equal(sessionStorage.getItem("ph.v2.production.pending-output-presence"), null);
    assert.doesNotMatch(originalNotice, /remainingGoodQuantity/);
    assert.equal(outputCalls.some(({ call }) => call.url.pathname.endsWith(`/works/${workId}/attempts`)), false, "retry never starts another physical attempt");
  });
  await check("uncertain Run output retry reuses the exact allocation, quantities, timestamp and business request", async () => {
    await reset(); await quoteApi.bootstrap(org);
    const { runId, allocationId } = prepareRunOutput();
    await openOutputSurface("run", org, bootstrap.sessionScope);
    await setInputValue('[aria-label="Run good output"]', "8");
    await click("Record output"); await settle(() => outputCalls.length === 1 && Boolean(document.querySelector('[aria-label="Pending Production Run output"][role="alert"]')));
    const first = outputCalls[0]!; const originalNotice = document.querySelector('[aria-label="Pending Production Run output"]')?.textContent ?? "";
    assert.match(originalNotice, /The Production output response was lost/);
    assert.equal(first.call.url.pathname, `/v2/organizations/${org}/production/runs/${runId}/allocations/${allocationId}/output`);
    assert.deepEqual(first.body, { goodQuantityDelta: 8, wasteQuantityDelta: 0, businessRequestId: first.body.businessRequestId });
    assert.match(String(first.body.businessRequestId), /^[0-9a-f-]{36}$/i); assert.match(originalNotice, /\d{4}-\d\d-\d\dT.*Z/); assert.match(originalNotice, /8 good and 0 waste/);
    const submittedAt = originalNotice.match(/\d{4}-\d\d-\d\dT[^ ]+Z/)?.[0];
    await remountWorkspace(org, bootstrap.sessionScope); await click("Board"); await click("Runs"); await click("Stations");
    await settle(() => Boolean(document.querySelector(".v2-production-run-row")));
    await act(async () => document.querySelector<HTMLButtonElement>(".v2-production-run-row")!.click());
    await settle(() => Boolean(document.querySelector('[aria-label="Pending Production Run output"]')));
    const recoveredNotice = document.querySelector('[aria-label="Pending Production Run output"]')?.textContent ?? "";
    assert.ok(recoveredNotice.includes(String(first.body.businessRequestId)) && submittedAt && recoveredNotice.includes(submittedAt));
    await click("Retry original output"); await settle(() => outputCalls.length === 2);
    const second = outputCalls[1]!;
    assert.equal(second.call.url.href, first.call.url.href); assert.deepEqual(second.body, first.body);
    assert.equal(sessionStorage.getItem(`ph.v2.production.pending-run-output.${org}.${bootstrap.sessionScope}`), null);
    assert.equal(sessionStorage.getItem("ph.v2.production.pending-output-presence"), null);
    assert.equal(outputCalls.some(({ call }) => call.url.pathname.endsWith(`/runs/${runId}/transitions`)), false, "retry never starts, completes or cancels the Run");
  });
  await check("durable discovery recovers pending output after complete tab-storage loss without a blind new POST",async()=>{
    for(const mode of ["ordinary","run"] as const){
      await reset();await quoteApi.bootstrap(org);if(mode==="ordinary")prepareOrdinaryOutput();else prepareRunOutput();
      await openOutputSurface(mode,org,bootstrap.sessionScope);if(mode==="run")await setInputValue('[aria-label="Run good output"]',"8");
      await click("Record output");await settle(()=>outputCalls.length===1);const first=outputCalls[0]!;
      sessionStorage.clear();if(mode==="ordinary")await remountWorkspace(org,bootstrap.sessionScope);else {await remountRunWorkspace(org,bootstrap.sessionScope);await act(async()=>document.querySelector<HTMLButtonElement>(".v2-production-run-row")!.click());}
      await settle(()=>text().includes(String(first.body.businessRequestId)));
      assert.equal(outputCalls.length,1,"durable discovery is read-only and never invents a new physical report");
      await click("Retry original output");await settle(()=>outputCalls.length===2);
      assert.deepEqual(outputCalls[1]!.body,first.body);assert.equal(outputCalls[1]!.call.url.href,first.call.url.href);
    }
  });
  await check("committed-response loss is recovered by exact receipt without repeating physical output",async()=>{
    await reset();await quoteApi.bootstrap(org);prepareOrdinaryOutput();await openOutputSurface("ordinary",org,bootstrap.sessionScope);
    await click("Record output");await settle(()=>outputCalls.length===1);const id=String(outputCalls[0]!.body.businessRequestId);
    const original=durableReceipts.get(id)!;durableReceipts.set(id,{...original,status:"succeeded",result:{work:{organizationId:org,productionWorkId:workId},attempt:{productionAttemptId:original.productionAttemptId,productionWorkId:workId}}});
    await click("Look up original output result");await settle(()=>sessionStorage.getItem("ph.v2.production.pending-output-presence")===null);
    assert.equal(outputCalls.length,1);assert.match(text(),/Result: succeeded/);
  });
  await check("fresh same-actor session can explicitly rebind only the matching durable owner intent",async()=>{
    for(const mode of ["ordinary","run"] as const){
      await reset();await quoteApi.bootstrap(org);if(mode==="ordinary")prepareOrdinaryOutput();else prepareRunOutput();
      await openOutputSurface(mode,org,bootstrap.sessionScope);if(mode==="run")await setInputValue('[aria-label="Run good output"]',"8");
      await click("Record output");await settle(()=>outputCalls.length===1);const first=outputCalls[0]!;
      clearV2ApiSessionState();currentBootstrap={...currentBootstrap,sessionScope:"recovery-session-b"};await quoteApi.bootstrap(org);
      if(mode==="ordinary")await renderWorkspace(org,currentBootstrap.sessionScope,true,true);else {await renderRunWorkspace(org,currentBootstrap.sessionScope);await act(async()=>document.querySelector<HTMLButtonElement>(".v2-production-run-row")!.click());}
      await settle(()=>Boolean([...document.querySelectorAll("button")].find(node=>node.textContent==="Recover this owner request")));
      await click("Recover this owner request");assert.equal(outputCalls.length,1,"session rebind is receipt recovery only, never a physical report");
      const key=`ph.v2.production.pending-${mode==="run"?"run-":""}output.${org}.${currentBootstrap.sessionScope}`;
      const saved=JSON.parse(sessionStorage.getItem(key)!);assert.equal(saved.businessRequestId,first.body.businessRequestId);
      await click("Retry original output");await settle(()=>outputCalls.length===2);assert.deepEqual(outputCalls[1]!.body,first.body);
    }
  });
  await check("EXACT ordinary and Run pause-json/unmount/AuthA-clear/AuthB-bootstrap continuation never posts old intent under B",async()=>{
    for(const mode of ["ordinary","run"] as const){
      await reset();await quoteApi.bootstrap(org);if(mode==="ordinary")prepareOrdinaryOutput();else prepareRunOutput();
      await openOutputSurface(mode,org,bootstrap.sessionScope);await setInputValue(mode==="ordinary"?'[aria-label="Flatbed good output"]':'[aria-label="Run good output"]',"3");
      await click("Record output");await settle(()=>outputCalls.length===1);const original=outputCalls[0]!;
      pausePrepareJson=true;await click("Retry original output");await settle(()=>pausedPrepareBodies.length===1);
      assert.equal(pausedPrepareBodies[0]!.scope,bootstrap.sessionScope);assert.equal(pausedPrepareBodies[0]!.body.businessRequestId,original.body.businessRequestId);
      await act(async()=>root.unmount());root=createRoot(document.getElementById("root")!);
      clearV2ApiSessionState();currentBootstrap={...currentBootstrap,userId:"99999999-9999-4999-8999-999999999999",sessionScope:"auth-b",csrfToken:"CSRF_B"};await quoteApi.bootstrap(org);
      await act(async()=>pausedPrepareBodies[0]!.resume());await settle();
      assert.equal(outputCalls.length,1,"no physical POST after A unmount/body decode");
      assert.equal(calls.filter(call=>call.init?.method==="POST"&&(call.init.headers as Record<string,string>)["x-v2-csrf-token"]==="CSRF_B").length,0,"B CSRF never carries A's pending body");
      const stored=[...Array(sessionStorage.length)].map((_,i)=>sessionStorage.key(i)!).find(key=>key.startsWith("ph.v2.production.pending-")&&key.includes(bootstrap.sessionScope));
      assert.ok(stored);assert.equal(JSON.parse(sessionStorage.getItem(stored)!).businessRequestId,original.body.businessRequestId,"admission remains recoverable");
    }
  });
  await check("same-scope unmount fences prepare continuation while fresh mounted owner can retry exact receipt",async()=>{
    for(const mode of ["ordinary","run"] as const){
      await reset();await quoteApi.bootstrap(org);if(mode==="ordinary")prepareOrdinaryOutput();else prepareRunOutput();await openOutputSurface(mode,org,bootstrap.sessionScope);await setInputValue(mode==="ordinary"?'[aria-label="Flatbed good output"]':'[aria-label="Run good output"]',"3");
      await click("Record output");await settle(()=>outputCalls.length===1);const original=outputCalls[0]!;
      pausePrepareJson=true;await click("Retry original output");await settle(()=>pausedPrepareBodies.length===1);
      await act(async()=>root.unmount());root=createRoot(document.getElementById("root")!);await act(async()=>pausedPrepareBodies[0]!.resume());await settle();assert.equal(outputCalls.length,1);
      pausePrepareJson=false;if(mode==="ordinary")await renderWorkspace(org,bootstrap.sessionScope,true,true);else await renderRunWorkspace(org,bootstrap.sessionScope);
      await click("Retry original output");await settle(()=>outputCalls.length===2);assert.deepEqual(outputCalls[1]!.body,original.body);
    }
  });
  await check("Actor B sees only protected status and never adopts Actor A pending body",async()=>{
    for(const mode of ["ordinary","run"] as const){
      await reset();await quoteApi.bootstrap(org);if(mode==="ordinary")prepareOrdinaryOutput();else prepareRunOutput();await openOutputSurface(mode,org,bootstrap.sessionScope);await setInputValue(mode==="ordinary"?'[aria-label="Flatbed good output"]':'[aria-label="Run good output"]',"3");
      await click("Record output");await settle(()=>outputCalls.length===1);sessionStorage.clear();clearV2ApiSessionState();currentBootstrap={...currentBootstrap,userId:"99999999-9999-4999-8999-999999999999",sessionScope:"actor-b",csrfToken:"CSRF_B"};await quoteApi.bootstrap(org);
      if(mode==="ordinary")await remountWorkspace(org,currentBootstrap.sessionScope);else {await remountRunWorkspace(org,currentBootstrap.sessionScope);await act(async()=>document.querySelector<HTMLButtonElement>(".v2-production-run-row")!.click());}await settle();
      assert.equal(document.querySelector('[aria-label="Pending Production output"],[aria-label="Pending Production Run output"]'),null);
      assert.equal([...document.querySelectorAll("button")].some(button=>button.textContent==="Retry original output"),false);assert.equal(outputCalls.length,1);
      const protectedText=document.querySelector('[aria-label="Durable Production output receipt"],[aria-label="Durable Production Run output receipt"]')?.textContent??"";assert.match(protectedText,/private to its initiating actor/);assert.doesNotMatch(protectedText,/Historical committed/);assert.match(protectedText,/Result: pending/);
      assert.equal([...durableReceipts.values()][0]?.intent?.goodQuantityDelta,3,"original admission was not overwritten or lost");
    }
  });
  await check("actual mounted Run lookup and rebind replay repair post-commit lifecycle before clearing admission",async()=>{
    const {PGlite}=await import("@electric-sql/pglite"),express=(await import("express")).default,requestHttp=(await import("supertest")).default;
    const {productionRecoveryFixture}=await import("../../tests/infrastructure/productionRecoveryFixture"),{PostgresProductionRunTransaction,PostgresProductionRunTransactionRunner}=await import("../../infrastructure/production/postgresProductionRunTransaction"),{PostgresProductionRecovery}=await import("../../infrastructure/production/postgresProductionRecovery"),{ProductionRecoveryService}=await import("../../src/modules/production/productionRecovery"),{ProductionRunApplicationService}=await import("../../src/modules/production/productionRunApplication"),{createProductionRouter}=await import("../../src/interfaces/http/productionRoutes"),{brandedId}=await import("../../src/modules/shared/commercialValues");
    for(const recoveryPath of ["lookup","rebind"] as const){
      await reset();const db=new PGlite();
      const client={query:async(sql:string,values?:unknown[])=>{if(values===undefined){const entries=await db.exec(sql),entry=entries.at(-1)??{rows:[],affectedRows:0};return {...entry,rowCount:entry.affectedRows??entry.rows.length};}const entry=await db.query(sql,values);return {...entry,rowCount:entry.affectedRows??entry.rows.length};},release(){}} as unknown as import("pg").PoolClient;
      const pool={connect:async()=>client} as unknown as import("pg").Pool;
      try{
        await productionRecoveryFixture(client,await readFile(new URL("../../tests/infrastructure/productionExclusiveMembership.request.sql",import.meta.url),"utf8"));
        const testOrg=brandedId<"OrganizationId">("org-a"),runId=brandedId<"ProductionRunId">("ui-repair"),actor={principalKind:"staff" as const,principalSubject:"actor-a",staffActorUserId:"actor-a"},owner=new PostgresProductionRunTransaction(client,true);
        await client.query("BEGIN");const members=await owner.lockCandidates(testOrg,[brandedId<"ProductionWorkId">("work-a")]);const seeded=await owner.create({id:runId,organizationId:testOrg,stationKey:"roll",materialFingerprint:null,layoutMetadata:{},members,quantities:new Map([["work-a",10]]),...actor});await client.query("COMMIT");
        await client.query("INSERT INTO v2_production_attempts(id,organization_id,production_work_id,sequence,attempt_kind,station_key) VALUES('ui-attempt','org-a','work-a',1,'initial','roll')");await client.query("UPDATE v2_production_run_allocations SET production_attempt_id='ui-attempt' WHERE production_run_id='ui-repair'");await client.query("UPDATE v2_production_runs SET state='active' WHERE id='ui-repair'");
        let lifecycleCalls=0;const lifecycle={reconcileOrder:async()=>{lifecycleCalls++;if(lifecycleCalls===1)throw Error("Inert post-commit reconciliation failure");},reconcileInvoice:async()=>{throw Error("No financial reconciliation in this fixture");}};
        const dependencies={runs:new ProductionRunApplicationService(new PostgresProductionRunTransactionRunner(pool),undefined,lifecycle),recovery:new ProductionRecoveryService(new PostgresProductionRecovery(pool)),principals:{principal:async()=>({kind:"staff",organizationId:testOrg,userId:"actor-a",authority:{membershipId:"ui-owner",capabilities:["production.view","production.run.execute"]}})}} as unknown as import("../../src/interfaces/http/productionRoutes").ProductionHttpDependencies;
        const app=express();app.use(express.json());app.use("/v2/organizations/:organizationId/production",createProductionRouter(dependencies));
        ownerHttp=async call=>{const method=call.init?.method??"GET";const pending=method==="POST"?requestHttp(app).post(call.url.pathname).send(JSON.parse(String(call.init?.body))):requestHttp(app).get(call.url.pathname).query(Object.fromEntries(call.url.searchParams));const result=await pending;return response(result.body,result.status,currentBootstrap.sessionScope);};
        currentBootstrap={...bootstrap,organizationId:testOrg,userId:"actor-a",capabilities:{...bootstrap.capabilities,productionWork:true}};await quoteApi.bootstrap(testOrg);
        await act(async()=>root.render(React.createElement(QueryClientProvider,{client:cache},React.createElement(ProductionRunWorkspace,{organizationId:testOrg,sessionScope:currentBootstrap.sessionScope,station:"roll",queue:[],canWork:true,onOpenArtwork:()=>{}}))));await settle(()=>Boolean(document.querySelector(".v2-production-run-row")));await act(async()=>document.querySelector<HTMLButtonElement>(".v2-production-run-row")!.click());await setInputValue('[aria-label="Run good output"]',"3");await click("Record output");await settle(()=>outputCalls.length===1&&lifecycleCalls===1);
        const original=outputCalls[0]!,savedKey=`ph.v2.production.pending-run-output.${testOrg}.${currentBootstrap.sessionScope}`;assert.ok(sessionStorage.getItem(savedKey));assert.equal((await client.query("SELECT good_quantity FROM v2_production_attempts WHERE id='ui-attempt'")).rows[0].good_quantity,3);
        const eventsBefore=(await client.query("SELECT count(*)::integer n FROM v2_production_run_events WHERE event_kind='good_output'")).rows[0].n;
        if(recoveryPath==="rebind")await settle(()=>[...document.querySelectorAll("button")].some(node=>node.textContent==="Recover this owner request"));
        const postsBefore=outputCalls.length;await click(recoveryPath==="lookup"?"Look up original output result":"Recover this owner request");await settle(()=>sessionStorage.getItem(savedKey)===null&&lifecycleCalls===2);
        assert.equal(outputCalls.length,postsBefore+1,"GET alone cannot acknowledge unfinished lifecycle repair");assert.deepEqual(outputCalls.at(-1)!.body,original.body);assert.equal(outputCalls.at(-1)!.call.url.pathname,original.call.url.pathname);
        assert.equal((await client.query("SELECT good_quantity FROM v2_production_attempts WHERE id='ui-attempt'")).rows[0].good_quantity,3);assert.equal((await client.query("SELECT count(*)::integer n FROM v2_production_run_events WHERE event_kind='good_output'")).rows[0].n,eventsBefore);assert.equal(seeded.allocations.length,1);
      }finally{await act(async()=>root.unmount());root=createRoot(document.getElementById("root")!);cache.clear();ownerHttp=undefined;await db.close();}
    }
  });
  await check("durable selection never adopts an intent bound to another Work/Run allocation",async()=>{
    for(const mode of ["ordinary","run"] as const){
      await reset();await quoteApi.bootstrap(org);if(mode==="ordinary")prepareOrdinaryOutput();else prepareRunOutput();await openOutputSurface(mode,org,bootstrap.sessionScope);await setInputValue(mode==="ordinary"?'[aria-label="Flatbed good output"]':'[aria-label="Run good output"]',"3");await click("Record output");await settle(()=>outputCalls.length===1);sessionStorage.clear();
      if(mode==="ordinary"){
        const different="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",attempt={...operationalProjection.activeAttempt!,productionAttemptId:"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",productionWorkId:different};operationalProjection={...operationalProjection,work:{...operationalProjection.work,productionWorkId:different},activeAttempt:attempt,attempts:[attempt]};operationalQueue={...operationalQueue,items:[operationalProjection]} as unknown as typeof queue;cache.clear();await remountWorkspace(org,bootstrap.sessionScope);
      }else{activeRunResponse={...(activeRunResponse as Record<string,unknown>),productionRunId:"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"};cache.clear();await remountRunWorkspace(org,bootstrap.sessionScope);await act(async()=>document.querySelector<HTMLButtonElement>(".v2-production-run-row")!.click());}await settle();
      assert.equal(document.querySelector('[aria-label="Pending Production output"],[aria-label="Pending Production Run output"]'),null);assert.equal(outputCalls.length,1);
    }
  });
  console.log(`Production actual App/workspace/parent-API integration: ${cases} named cases passed. Lookup/rebind lifecycle paths use real HTTP owner services and PGlite; other bootstrap/report DTOs are intercepted fixtures. No native, browser print-layout or provider proof.`);
} finally { await act(async () => root.unmount()); cache.clear(); clearV2ApiSessionState(); globalThis.fetch = originalFetch; window.print = originalPrint; if (oldCss) require.extensions[".css"] = oldCss; else delete require.extensions[".css"]; if (oldReact) Object.assign(globalThis, { React: oldReact }); else delete (globalThis as { React?: typeof React }).React; dom.window.close(); }
