import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { JSDOM } from "jsdom";
import type { UiBootstrap } from "./api";
import type { WorkspaceHeader, WorkspacePromotionView, WorkspaceView } from "./salesWorkspaceApi";

// The actual App imports CSS. Keep the fixture on one CommonJS React/query
// graph under the existing tsx runner and ignore only stylesheet evaluation.
const require = createRequire(import.meta.url);
const previousCss = require.extensions[".css"];
require.extensions[".css"] = () => {};
const React: typeof import("react") = require("react");
const { act } = React;
const { QueryClient, QueryClientProvider }: typeof import("@tanstack/react-query") = require("@tanstack/react-query");
const dom = new JSDOM("<!doctype html><html><body><div id='root'></div></body></html>", { url: "https://ui.invalid/orders" });
Object.assign(globalThis, { React, window: dom.window, document: dom.window.document, navigator: dom.window.navigator, sessionStorage: dom.window.sessionStorage, HTMLElement: dom.window.HTMLElement, Event: dom.window.Event, PopStateEvent: dom.window.PopStateEvent, IS_REACT_ACT_ENVIRONMENT: true });
const { createRoot }: typeof import("react-dom/client") = require("react-dom/client");
const { Simulate }: typeof import("react-dom/test-utils") = require("react-dom/test-utils");
const { App }: typeof import("./App") = require("./App");
const { defaultVisualAppearance }: typeof import("./appearance") = require("./appearance");
const { canNavigateFromSalesWorkspace, workspaceNavigationEvent }: typeof import("./workspaceNavigation") = require("./workspaceNavigation");
const { clearV2ApiSessionState }: typeof import("./api") = require("./api");

const org = "11111111-1111-4111-8111-111111111111";
const user = "22222222-2222-4222-8222-222222222222";
const workspaceId = "33333333-3333-4333-8333-333333333333";
const orderId = "88888888-8888-4888-8888-888888888888";
const customerId = "55555555-5555-4555-8555-555555555555";
const contactId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const productId = "44444444-4444-4444-8444-444444444444";
const sourceLineId = "99999999-9999-4999-8999-999999999999";
const tempLineId = "66666666-6666-4666-8666-666666666666";
const now = "2026-10-01T00:00:00.000Z";
const clone = <T,>(value: T): T => structuredClone(value);
const amount = { cents: 10000, currency: "USD" };
const unitAmount = { cents: 5000, currency: "USD" };
const resolved = { schemaVersion: 1 as const, organizationId: org, productId, pricingConfigurationId: productId, pricingConfigurationVersion: "historical-v1", pricingConfigurationContentHash: "frozen-hash", quantity: 2, selections: {}, derivedFacts: {}, productFacts: {} };
const sourceLine: NonNullable<WorkspaceView["lines"][number]["sourceLineSnapshot"]> = {
  lineId: sourceLineId, productId, description: "Original Banner", operationalNote: "Retain original packing note", quantity: 2, resolvedConfiguration: resolved,
  pricingResult: { schemaVersion: 1, id: "historical-price", evidenceFingerprint: "historical-evidence", organizationId: org, currency: "USD", calculatedUnitAmount: unitAmount, calculatedLineAmount: amount, unitAmountEvidence: { exactUnitCents: "5000", allocation: "rounded_line_total_divided_by_quantity" }, components: [{ kind: "base", label: "Original sale", amount }], optionImpacts: [], minimumChargeApplied: false, evaluator: { id: "historical", version: "1" }, rounding: { policyId: "historical", policyVersion: "1", stages: [] }, normalizedInput: resolved, warnings: [] },
  calculatedLineAmount: amount, sellingLineAmount: amount, sellingPriceDecision: { kind: "calculated", pricingResultId: "historical-price", calculatedUnitAmount: unitAmount, calculatedLineAmount: amount, resultingUnitAmount: unitAmount, resultingLineAmount: amount, decidedAt: now },
};
const header: WorkspaceHeader = { customerContact: { organizationId: org, customerId }, jobLabel: "Original Job", purchaseOrderNumber: "OLD-PO", requestedDueDate: "2026-10-20T00:00:00.000Z", terms: { termsCode: "net_30", commercialNotes: "Original Order commercial notes" }, requestedFulfillment: { method: "pickup", instructions: "Original pickup instructions" } };
const fixture = (): WorkspaceView => ({ id: workspaceId, organizationId: org, creatorUserId: user, kind: "order_edit", state: "draft", sourceDocumentKind: "order", sourceDocumentId: orderId, baseRevision: "7", sourceHeader: { organizationId: org, orderId, orderNumber: "ORD-1001", customerContact: { organizationId: org, customerId }, jobLabel: "Original Job", purchaseOrderNumber: "OLD-PO", requestedDueDate: "2026-10-20T00:00:00.000Z", currency: "USD", commercialState: "open", terms: { termsCode: "net_30", commercialNotes: "Original Order commercial notes" }, requestedFulfillment: { method: "pickup", instructions: "Original pickup instructions" } }, header: clone(header), lines: [{ id: tempLineId, workspaceId, position: 0, sourcePosition: 0, sourceLineId, sourceLineSnapshot: clone(sourceLine), operationalNote: sourceLine.operationalNote, revision: 1, input: { productId, description: sourceLine.description, quantity: 2, selections: {}, selling: { kind: "calculated" } } }], removedLines: [], revision: 1, createdAt: now, updatedAt: now, expiresAt: "2099-10-31T00:00:00.000Z" });
const bootstrap: UiBootstrap = { organizationId: org, userId: user, sessionScope: "shell-test-session", csrfToken: "test-csrf", capabilities: { quoteView: true, quoteCreate: true, quoteOverridePrice: false, orderView: true, orderCreate: true, orderEdit: true, orderCancel: true, artworkView: true, artworkAdopt: true, artworkAssign: true } };
type Call = { path: string; method: string; body: Record<string, unknown> };
let workspace = fixture();
let canonicalHeader = clone(header);
let canonicalRevision = "7";
let calls: Call[] = [];
let lostResponse = false;
let saveGate: (() => Promise<void>) | undefined;
let readGate: (() => Promise<void>) | undefined;
let committed = 0;
const receipts = new Map<string, WorkspacePromotionView>();
let beforeUnload = 0;
let navigationEvents: boolean[] = [];
const storageWrites: [string, string][] = [];
const originalStorageSet = dom.window.Storage.prototype.setItem;
dom.window.Storage.prototype.setItem = function (key, value) { storageWrites.push([key, value]); return originalStorageSet.call(this, key, value); };
const originalFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = new URL(String(input), window.location.origin); const path = url.pathname; const method = init?.method ?? "GET";
  const body = init?.body instanceof FormData ? Object.fromEntries(init.body.entries()) : init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : {};
  calls.push({ path, method, body });
  let data: unknown;
  if (path.endsWith("/ui-bootstrap")) data = bootstrap;
  else if (path.endsWith("/sales-workspaces/order-edits")) { assert.equal(body.orderId, orderId); assert.deepEqual(Object.keys(body).sort(), ["orderId", "requestId"]); data = workspace; }
  else if (path.endsWith(`/sales-workspaces/${workspaceId}/promote`)) {
    const replay = receipts.get(String(body.requestId));
    if (replay) data = { ...replay, replayed: true };
    else {
      assert.equal(body.target, "order"); assert.equal(body.expectedRevision, workspace.revision); if (saveGate) await saveGate();
      const { notes: _workspaceNotes, ...commercialHeader } = workspace.header;
      canonicalHeader = clone(commercialHeader); canonicalRevision = "8"; committed++;
      const receipt: WorkspacePromotionView["receipt"] = { workspaceId, organizationId: org, requestId: String(body.requestId), fingerprint: "owner-committed-receipt", inputRevision: workspace.revision, target: "order", documentId: orderId, documentRevision: "8", displayNumber: "ORD-1001", header: clone(workspace.header), lineMap: [{ workspaceLineId: tempLineId, canonicalLineId: sourceLineId, position: 0 }], promotedAt: now, artworkPromoted: true, result: { orderId, revision: "8" } };
      workspace = { ...workspace, state: "promoted", promotion: receipt }; data = { receipt, replayed: false, promotedWorkspaceHeader: receipt.header } satisfies WorkspacePromotionView;
      receipts.set(receipt.requestId, clone(data as WorkspacePromotionView));
      if (lostResponse) { lostResponse = false; throw new Error("Save response lost after commit"); }
    }
  } else if (path.endsWith(`/sales-workspaces/${workspaceId}`)) {
    if (method === "PATCH") { assert.equal(body.expectedRevision, workspace.revision); workspace = { ...workspace, header: clone(body.header as WorkspaceHeader), revision: workspace.revision + 1 }; }
    data = workspace;
  } else if (path.includes("/sales-workspaces/") && (path.endsWith("/artwork") || path.endsWith("/artwork-edit") || path.endsWith("/products"))) data = [];
  else if (path.endsWith(`/sales-workspaces/${workspaceId}/contacts`)) {
    assert.equal(path, `/v2/organizations/${workspace.organizationId}/sales-workspaces/${workspace.id}/contacts`);
    assert.equal(workspace.creatorUserId, bootstrap.userId, "Contact lookup follows the bootstrapped fixture creator");
    const rows = [{ organizationId: org, linkedCustomerId: customerId, id: contactId, label: "Original Customer contact" }];
    const eligible = rows.filter(row => row.organizationId === workspace.organizationId && (!url.searchParams.has("customerId") || row.linkedCustomerId === url.searchParams.get("customerId")));
    const choices = eligible.map(({ id, label }) => ({ id, label }));
    data = { items: choices.filter(row => row.label.toLowerCase().includes(url.searchParams.get("search")?.trim().toLowerCase() ?? "")).slice(0, Number(url.searchParams.get("limit") ?? 25)),
      selectedContact: choices.find(row => row.id === url.searchParams.get("selectedContactId")) ?? null };
  }
  else if (path.endsWith("/sales-workspaces")) data = [];
  else if (path === `/v2/organizations/${org}/orders/${orderId}`) {
    assert.equal(method, "GET", "App must not perform canonical commercial writes"); if (canonicalRevision === "8" && readGate) await readGate();
    data = { order: { ...canonicalHeader, organizationId: org, orderId, customerContact: { organizationId: org, customerId }, currency: "USD", commercialState: "open", terms: canonicalHeader.terms ?? {}, lines: [sourceLine] }, number: { display: "ORD-1001", core: "1001" }, revision: canonicalRevision, totals: { calculated: amount, selling: amount }, routes: [], completionEligibility: { eligible: false, blockers: [{ orderLineId: sourceLineId, kind: "fulfillment_remaining", reason: "Two original items still await fulfillment." }], lines: [] } };
  } else if (path.endsWith("/orders")) data = { items: [], totalMatching: 0 };
  else if (path.includes("fulfillment")) data = { lines: [], handoffs: [] };
  else if (path.endsWith("/history") || path.endsWith("/workflow/actions") || path.includes("/artwork/orders/")) data = [];
  else if (path.endsWith("/customers") || path.endsWith("/customers/form-options")) data = [{ customerId, displayName: "Original Customer" }];
  else if (path.includes("contacts") || path.endsWith("/products") || path.endsWith("/form-products") || path.endsWith("/form-customers")) data = [];
  else throw new Error(`Unexpected actual App request ${method} ${url}`);
  return new Response(JSON.stringify({ ok: true, data: clone(data) }), { status: 200, headers: { "content-type": "application/json" } });
};
let cache = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity, gcTime: Infinity } } });
let root = createRoot(document.getElementById("root")!);
const text = () => document.body.textContent ?? "";
const button = (label: string, within: ParentNode = document) => { const node = [...within.querySelectorAll("button")].find(value => value.textContent?.trim() === label); assert.ok(node, `${label} button exists`); return node; };
const field = (label: string) => { const parent = [...document.querySelectorAll("label")].find(node => node.textContent?.trim().startsWith(label)); const control = parent?.querySelector("input,select,textarea"); assert.ok(control, `${label} field exists`); return control as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement; };
const settle = async (predicate: () => boolean = () => true) => { for (let index = 0; index < 150; index++) { await act(async () => { await new Promise(resolve => setTimeout(resolve, 5)); }); if (predicate()) return; } assert.ok(predicate(), `App transition settled: ${text()}\n${JSON.stringify(calls)}`); };
const click = async (label: string, within?: ParentNode) => { await act(async () => button(label, within).click()); await settle(); };
const change = async (label: string, value: string) => { await act(async () => { const node = field(label); node.value = value; Simulate.change(node); }); await settle(); };
const storage = () => Object.fromEntries(Array.from({ length: sessionStorage.length }, (_, index) => { const key = sessionStorage.key(index)!; return [key, sessionStorage.getItem(key)]; }));
const commands = () => calls.filter(call => call.method !== "GET");
const observeNavigation = (event: Event) => navigationEvents.push(event.defaultPrevented);
const observeUnload = () => { beforeUnload++; };
const mount = async (active = true) => {
  window.removeEventListener(workspaceNavigationEvent, observeNavigation); await act(async () => root.unmount()); cache.clear(); clearV2ApiSessionState();
  workspace = fixture(); canonicalHeader = clone(header); canonicalRevision = "7"; calls = []; lostResponse = false; saveGate = undefined; readGate = undefined; committed = 0; receipts.clear(); beforeUnload = 0; navigationEvents = [];
  sessionStorage.clear(); sessionStorage.setItem("ph.v2.organization-id", org); sessionStorage.setItem("unrelated.session.key", "retained"); storageWrites.length = 0;
  window.history.replaceState({}, "", `/orders/${orderId}${active ? `?workspaceId=${workspaceId}` : ""}`);
  cache = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity, gcTime: Infinity } } }); root = createRoot(document.getElementById("root")!);
  await act(async () => root.render(<QueryClientProvider client={cache}><App appearance={defaultVisualAppearance} setAppearance={() => {}} /></QueryClientProvider>));
  await settle(() => active ? text().includes("Editing ORD-1001") : text().includes("Edit Order"));
  window.addEventListener(workspaceNavigationEvent, observeNavigation);
};
const sidebar = () => { const node = document.querySelector(".v2-sidebar"); assert.ok(node); return node; };
const toolbarNewEntry = async () => { await click("New"); await click("New Sales Entry"); };
let cases = 0;
const check = async (name: string, work: () => Promise<void>) => { await work(); cases++; console.log(`PASS ${name}`); };
window.addEventListener("beforeunload", observeUnload);
try {
  await check("Actual App sidebar and toolbar cannot abandon dirty header plus open line input", async () => {
    await mount(); await click("Save Draft"); assert.equal(canNavigateFromSalesWorkspace(), true); navigationEvents = []; await change("Job Label", "Unstored header"); await click("Add Item"); await change("Quantity", "9"); assert.ok(button("Back to Order").disabled);
    const url = window.location.href; const stored = storage(); const writes = storageWrites.length; const prior = commands().length;
    await click("Orders", sidebar()); await toolbarNewEntry();
    assert.equal(window.location.href, url); assert.deepEqual(storage(), stored); assert.equal(storageWrites.length, writes); assert.equal(field("Job Label").value, "Unstored header"); assert.equal(field("Quantity").value, "9"); assert.equal(commands().length, prior); assert.deepEqual(navigationEvents, [true, true]); assert.equal(beforeUnload, 0);
  });
  await check("An open line editor alone blocks same-tick App exits after a clean draft acknowledgement", async () => {
    await mount(); await click("Save Draft"); assert.equal(canNavigateFromSalesWorkspace(), true); navigationEvents = []; const url = window.location.href; const stored = storage(); const prior = commands().length;
    await act(async () => { button("Add Item").click(); button("Orders", sidebar()).click(); }); await settle(); await change("Quantity", "9"); await toolbarNewEntry();
    assert.equal(window.location.href, url); assert.deepEqual(storage(), stored); assert.equal(field("Job Label").value, "Original Job"); assert.equal(field("Quantity").value, "9"); assert.equal(commands().length, prior); assert.deepEqual(navigationEvents, [true, true]); assert.equal(beforeUnload, 0);
  });
  await check("Unstored PDF alone blocks the real App sidebar without invoking native unload", async () => {
    await mount(); await click("Save Draft"); assert.equal(canNavigateFromSalesWorkspace(), true); const prior = commands().length; await act(async () => { const node = field("PDF file") as HTMLInputElement; Object.defineProperty(node, "files", { configurable: true, value: [new File(["%PDF-test"], "local-only.pdf", { type: "application/pdf" })] }); Simulate.change(node); }); await settle();
    const url = window.location.href; const stored = storage(); await click("Orders", sidebar()); assert.equal(window.location.href, url); assert.deepEqual(storage(), stored); assert.match(text(), /local-only\.pdf/); assert.equal(commands().length, prior); assert.equal(beforeUnload, 0);
  });
  await check("Explicit clean Save Draft permits App sidebar exit and keeps the resumable workspace", async () => {
    await mount(); await change("Job Label", "Durable draft label"); await change("Workspace notes", "Workspace metadata, not Order notes"); await click("Save Draft"); assert.equal(button("Back to Order").disabled, false);
    await click("Orders", sidebar()); await settle(() => window.location.pathname === "/orders"); assert.equal(document.querySelector('[aria-label="Transactional Sales workspace"]'), null); assert.equal(workspace.state, "draft"); assert.equal(workspace.header.jobLabel, "Durable draft label"); assert.equal(workspace.header.notes, "Workspace metadata, not Order notes"); assert.equal(canonicalHeader.terms?.commercialNotes, "Original Order commercial notes"); assert.equal(canonicalRevision, "7"); assert.deepEqual(commands().map(call => call.method), ["PATCH"]); assert.equal(beforeUnload, 0); assert.equal(canNavigateFromSalesWorkspace(), true);
  });
  await check("Clean saved draft permits toolbar New and its storage transition", async () => {
    await mount(); await click("Save Draft"); const writes = storageWrites.length; await toolbarNewEntry(); await settle(() => window.location.pathname === "/quotes"); assert.ok(storageWrites.slice(writes).some(([key, value]) => key === "ph.v2.new-quote" && value === "1")); assert.equal(workspace.state, "draft"); assert.deepEqual(commands().map(call => call.method), ["PATCH"]); assert.equal(beforeUnload, 0);
  });
  await check("Mutation lock blocks same-tick App navigation and lost Save keeps that guard until terminal replay", async () => {
    await mount(); await click("Save Draft"); assert.equal(canNavigateFromSalesWorkspace(), true); let release!: () => void; saveGate = () => new Promise<void>(resolve => { release = resolve; }); lostResponse = true;
    const url = window.location.href; const stored = storage(); const writes = storageWrites.length;
    await act(async () => { button("Save").click(); button("Orders", sidebar()).click(); }); await settle(() => Boolean(release)); await toolbarNewEntry();
    assert.equal(window.location.href, url); assert.deepEqual(storage(), stored); assert.equal(storageWrites.length, writes); assert.equal(calls.filter(call => call.path.endsWith("/promote")).length, 1); assert.equal(beforeUnload, 0);
    await act(async () => release()); await settle(() => text().includes("Save response lost after commit")); await click("Orders", sidebar()); await toolbarNewEntry(); assert.equal(window.location.href, url); assert.deepEqual(storage(), stored); assert.equal(storageWrites.length, writes); assert.ok(button("Cancel").disabled); assert.equal(committed, 1);
    saveGate = undefined; await click("Save"); await settle(() => text().includes("Edit Order") && !text().includes("Editing ORD-1001"));
    const promotions = calls.filter(call => call.path.endsWith("/promote")); assert.equal(promotions.length, 2); assert.equal(promotions[0]!.body.requestId, promotions[1]!.body.requestId); assert.equal(committed, 1); assert.equal(canNavigateFromSalesWorkspace(), true); assert.equal(beforeUnload, 0);
  });
  await check("Save success refreshes the actual reopened readonly Order header after stale cache", async () => {
    await mount(false); assert.equal(field("PO #").value, "OLD-PO"); assert.equal(field("Requested Due").value, "2026-10-20"); await click("Edit Order"); await settle(() => text().includes("Editing ORD-1001"));
    await change("PO #", "NEW-PO"); await change("Job Label", "Fresh canonical label"); await change("Requested Due", "2026-11-15"); await change("Terms code", "net_45"); await change("Commercial notes", "Fresh Order commercial notes"); await change("Workspace notes", "Retained TEMP metadata"); await change("Fulfillment", "shipping"); await change("Street", "100 Fresh Street"); await change("City", "Fresh City"); await change("Fulfillment instructions", "Fresh destination instructions");
    let release!: () => void; readGate = () => new Promise<void>(resolve => { release = resolve; }); await click("Save"); await settle(() => Boolean(release) && text().includes("Edit Order")); assert.equal(field("PO #").value, "OLD-PO", "Old cache is present before the fresh read is released"); assert.equal(field("Requested Due").value, "2026-10-20"); assert.equal(field("Terms").value, "net_30");
    readGate = undefined; await act(async () => release()); await settle(() => field("PO #").value === "NEW-PO"); assert.equal(field("Requested Due").value, "2026-11-15"); assert.equal(field("Terms").value, "net_45"); assert.match(text(), /Fresh canonical label/); assert.equal(field("PO #").matches(":disabled"), true); assert.equal(canonicalRevision, "8");
    await click("Notes"); assert.equal(field("Notes").value, "Fresh Order commercial notes"); assert.equal(canonicalHeader.terms?.commercialNotes, "Fresh Order commercial notes"); assert.equal(canonicalHeader.notes, undefined); assert.equal(workspace.header.notes, "Retained TEMP metadata");
    const tabs = document.querySelector(".v2-sales-document-tabs"); assert.ok(tabs); await click("Fulfillment", tabs); assert.equal(field("Method").value, "shipping"); assert.equal(field("Address").value, "100 Fresh Street"); assert.equal(field("City").value, "Fresh City"); assert.equal(field("Instructions").value, "Fresh destination instructions"); assert.equal(field("Address").matches(":disabled"), true); assert.equal(canNavigateFromSalesWorkspace(), true);
  });
  await check("Trusted session teardown removes the listener without trapping expired authority", async () => {
    await mount(); await change("Job Label", "Private expired-session draft"); await act(async () => { assert.equal(canNavigateFromSalesWorkspace(), false); });
    await act(async () => window.dispatchEvent(new dom.window.Event("v2:session-context-changed"))); await settle(() => !text().includes("Private expired-session draft")); assert.equal(canNavigateFromSalesWorkspace(), true); assert.equal(document.querySelector('[aria-label="Transactional Sales workspace"]'), null); assert.equal(commands().length, 0);
  });
} finally {
  window.removeEventListener(workspaceNavigationEvent, observeNavigation); window.removeEventListener("beforeunload", observeUnload); await act(async () => root.unmount()); cache.clear(); clearV2ApiSessionState(); globalThis.fetch = originalFetch; dom.window.Storage.prototype.setItem = originalStorageSet; if (previousCss) require.extensions[".css"] = previousCss; else delete require.extensions[".css"]; assert.equal(canNavigateFromSalesWorkspace(), true, "All workspace navigation listeners are removed after unmount"); dom.window.close();
}
console.log(`Actual App Order edit navigation: ${cases} scenarios passed.`);
