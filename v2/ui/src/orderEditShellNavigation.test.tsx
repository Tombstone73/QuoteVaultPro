import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { JSDOM } from "jsdom";
import type { OrderRead, PrepressQueueItem, ProductionWorkProjection, ProofWorkProjection, UiBootstrap } from "./api";
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
const { OrderWorkspace }: typeof import("./OrderWorkspace") = require("./OrderWorkspace");
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
const secondLineId = "99999999-9999-4999-8999-999999999998";
const proofWorkId = "77777777-7777-4777-8777-777777777777";
const productionWorkId = "77777777-7777-4777-8777-777777777778";
const prepressUnitId = "77777777-7777-4777-8777-777777777779";
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
let bootstrap: UiBootstrap = { organizationId: org, userId: user, sessionScope: "shell-test-session", csrfToken: "test-csrf", capabilities: { quoteView: true, quoteCreate: true, quoteOverridePrice: false, orderView: true, orderCreate: true, orderEdit: true, orderCancel: true, artworkView: true, artworkAdopt: true, artworkAssign: true } };
const approvedProof: ProofWorkProjection = { work: { proofWorkId, orderId, orderLineId: secondLineId, createdAt: now }, recipients: [], versions: [{ version: { proofWorkId, proofVersionId: proofWorkId, sequence: 1, artwork: [], createdAt: now, issuedAt: now }, response: { proofResponseId: proofWorkId, proofVersionId: proofWorkId, outcome: "approved", origin: "direct", respondedAt: now, responderPrincipalSubject: customerId } }] };
let navigationFixture = false;
let productionNavigationFixture = false;
const readyPrepress: PrepressQueueItem = { orderId, orderNumber: "ORD-1001", customerDisplayName: "Original Customer", orderLineId: secondLineId, lineDescription: "Exact second line", quantity: 2, routingStepKind: "prepress", coverage: { state: "configured", productionArtworkComplete: true, allRequiredPrepressUnitsComplete: true, requirements: [{ requirement: { key: "front", side: "front" }, artworkAssignmentIds: [productId], productionArtworkCovered: true, prepressComplete: true, prepressUnits: [{ prepressUnitId, organizationId: org, orderId, orderLineId: secondLineId, artworkAssignmentId: productId, artworkFileId: productId, side: "front", createdAt: now, startedAt: now, completedAt: now }] }] }, operational: { materials: [], sourceArtwork: [], productionArtwork: [], proof: { required: true, state: "approved" }, productionDestination: "flatbed", readiness: { ready: true, blockers: [] } } };
const readyProduction: ProductionWorkProjection = { work: { productionWorkId, orderId, orderLineId: secondLineId, requirement: { key: "front", side: "front" }, artworkAssignmentId: productId, artworkFileId: productId, prepressUnitId, orderedQuantity: 2 }, attempts: [], completedGoodQuantity: 0, recordedGoodQuantity: 0, rejectedGoodQuantity: 0, usableGoodQuantity: 0, remainingGoodQuantity: 2, unitQuantitySatisfied: false, state: "ready", exceptionEvents: [], outputDispositions: [] };
let orderProductionWork: ProductionWorkProjection | undefined;
let orderRoutes: OrderRead["routes"] = [];
const rollStep = { routeInstanceStepId: "roll-step", position: 1, kind: "production", productionDestination: "roll" } as const;
const rollRoute: OrderRead["routes"][number] = { routeInstanceId: "roll-route", revision: "1", work: { orderLineId: secondLineId }, state: "active", currentStepId: rollStep.routeInstanceStepId, steps: [rollStep] };
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
    data = { order: { ...canonicalHeader, organizationId: org, orderId, customerContact: { organizationId: org, customerId }, currency: "USD", commercialState: "open", terms: canonicalHeader.terms ?? {}, lines: navigationFixture ? [sourceLine, { ...sourceLine, lineId: secondLineId, description: "Exact second line", position: 1 }] : [sourceLine] }, number: { display: "ORD-1001", core: "1001" }, revision: canonicalRevision, totals: { calculated: amount, selling: amount }, routes: orderRoutes, completionEligibility: { eligible: false, blockers: [{ orderLineId: sourceLineId, kind: "fulfillment_remaining", reason: "Two original items still await fulfillment." }], lines: [] } };
  } else if (path.endsWith("/orders")) data = { items: [], totalMatching: 0 };
  else if (path.includes("fulfillment")) data = { lines: [], handoffs: [] };
  else if (path.endsWith("/history") || path.endsWith("/workflow/actions") || path.includes("/artwork/orders/")) data = [];
  else if (path.includes("/proofing/orders/")) data = [approvedProof];
  else if (path.endsWith(`/proofing/works/${proofWorkId}`)) data = approvedProof;
  else if (path.endsWith("/prepress/queue")) data = { items: productionNavigationFixture && url.searchParams.get("requirementState") !== "unconfigured" ? [readyPrepress] : [], pagination: { page: 1, pageSize: 25, totalCount: productionNavigationFixture ? 1 : 0, totalPages: productionNavigationFixture ? 1 : 0 } };
  else if (path.endsWith(`/prepress/lines/${secondLineId}`)) data = readyPrepress;
  else if (path.endsWith(`/prepress/units/${prepressUnitId}/send-to-production`)) data = { unit: readyPrepress.coverage.requirements[0]!.prepressUnits[0]!, destination: "flatbed", productionWorkIds: [productionWorkId] };
  else if (path.includes("/production/orders/")) data = orderProductionWork ? [orderProductionWork] : [];
  else if (path.endsWith(`/production/works/${productionWorkId}`)) data = orderProductionWork ?? readyProduction;
  else if (path.endsWith("/proofing/works") || path.endsWith("/production/works") || path.includes("/production/runs") || path.includes("/production/daily")) data = { items: [], pagination: { page: 1, pageSize: 25, totalCount: 0, totalPages: 0 } };
  else if (path.endsWith("/routing/workspace")) data = { templates: [], instances: [] };
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
const selectSecondLine = async () => { const row = [...document.querySelectorAll(".v2-sales-items tbody tr")].find(node => node.textContent?.includes("Exact second line")); assert.ok(row); const control = row.querySelector("button"); assert.ok(control); await act(async () => control.click()); await settle(); };
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
  await check("Order exact second-line navigation preserves canonical Proof work and approved next preparation context", async () => {
    navigationFixture = true;
    bootstrap = { ...bootstrap, capabilities: { ...bootstrap.capabilities, prepressView: true, proofView: true, routeView: true } };
    await mount(false); await selectSecondLine();
    const inspector = document.querySelector(".v2-sales-line-editor"); assert.ok(inspector);
    await click("Open line Proofing", inspector);
    await settle(() => text().includes("Proofing complete"));
    assert.ok(window.location.pathname.includes(proofWorkId));
    assert.ok(calls.some(call => call.path.endsWith(`/proofing/works/${proofWorkId}`)), "exact canonical work is fetched, not first queue work");
    assert.match(text(), /Routing must evaluate and advance its own frozen prerequisite/);
    assert.ok(button("Open Routing"));
    await click("Open line Prepress");
    assert.ok(window.location.pathname.includes(secondLineId));
    assert.equal(commands().length, 0, "navigation never approves Proof or progresses frozen Routing");
    await mount(false); await selectSecondLine(); await click("Open line Proofing", document.querySelector(".v2-sales-line-editor")!); await settle(() => text().includes("Proofing complete"));
    await click("Open Routing"); assert.equal(window.location.pathname, "/routing"); assert.equal(commands().length, 0);
    await mount(false); await selectSecondLine(); await click("Open line Prepress", document.querySelector(".v2-sales-line-editor")!);
    assert.ok(window.location.pathname.includes(secondLineId)); assert.equal(commands().length, 0);
    await mount(false); await click("Artwork", document.querySelector(".v2-sales-document-tabs")!);
    const artworkLine = [...document.querySelectorAll(".v2-order-artwork > li")].find(node => node.textContent?.includes("Exact second line")); assert.ok(artworkLine);
    await click("Open line Prepress", artworkLine); assert.ok(window.location.pathname.includes(secondLineId)); assert.equal(commands().length, 0);
  });
  await check("Order hides preparation navigation when Prepress permission is absent", async () => {
    bootstrap = { ...bootstrap, capabilities: { ...bootstrap.capabilities, prepressView: false, proofView: false, routeView: false } };
    await mount(false); await selectSecondLine();
    const inspector = document.querySelector(".v2-sales-line-editor"); assert.ok(inspector);
    assert.equal([...inspector.querySelectorAll("button")].some(node => node.textContent === "Open line Prepress" || node.textContent === "Open line Proofing" || node.textContent === "Open Routing"), false);
    assert.equal(commands().length, 0);
  });
  await check("Canonical Prepress handoff opens its exact Production work and Flatbed station", async () => {
    productionNavigationFixture = true;
    bootstrap = { ...bootstrap, capabilities: { ...bootstrap.capabilities, prepressView: true, prepressComplete: true, routeAdvance: true, productionWork: true, productionView: true } };
    await mount(false); await selectSecondLine(); await click("Open line Prepress", document.querySelector(".v2-sales-line-editor")!);
    await settle(() => text().includes("Send to flatbed")); await click("Send to flatbed");
    await settle(() => window.location.pathname === `/production/works/${productionWorkId}`);
    assert.ok(calls.some(call => call.path.endsWith(`/production/works/${productionWorkId}`)));
    assert.match(document.querySelector('[role="tab"][aria-selected="true"]')?.textContent?.trim() ?? "", /^Flatbed\d*$/);
    assert.deepEqual(commands().map(call => call.path), [`/v2/organizations/${org}/prepress/units/${prepressUnitId}/send-to-production`], "navigation uses only the canonical handoff, without direct Production or Routing mutations");
  });
  await check("Prepress handoff cannot open Production when view capability is absent", async () => {
    bootstrap = { ...bootstrap, capabilities: { ...bootstrap.capabilities, productionView: false } };
    await mount(false); await selectSecondLine(); await click("Open line Prepress", document.querySelector(".v2-sales-line-editor")!);
    await settle(() => text().includes("Send to flatbed")); await click("Send to flatbed");
    assert.ok(window.location.pathname.includes(secondLineId));
    assert.equal(calls.some(call => call.path.includes("/production/works")), false);
    assert.equal(commands().length, 1);
  });
  await check("Order Production tab opens exact Roll work from its frozen current destination before any attempt", async () => {
    bootstrap = { ...bootstrap, capabilities: { ...bootstrap.capabilities, productionView: true } };
    orderProductionWork = readyProduction; orderRoutes = [rollRoute];
    await mount(false); await click("Production", document.querySelector(".v2-sales-document-tabs")!);
    await settle(() => text().includes("0/2 complete"));
    const tab = document.querySelector(".v2-order-tab .v2-order-owner-summary-value"); assert.ok(tab);
    await click("Production unit · Front · 0/2 complete", tab); await settle(() => window.location.pathname === `/production/works/${productionWorkId}`);
    assert.match(document.querySelector('[role="tab"][aria-selected="true"]')?.textContent ?? "", /^Roll\d*$/);
    assert.equal(commands().length, 0);
  });
  await check("Order Production summary recovers Roll active attempt even after its quantity is satisfied", async () => {
    const activeAttempt: NonNullable<ProductionWorkProjection["activeAttempt"]> = { productionAttemptId: "active-roll", productionWorkId, sequence: 1, kind: "initial", stationKey: "roll", goodQuantity: 2, wasteQuantity: 0, startedAt: now };
    orderProductionWork = { ...readyProduction, state: "active", attempts: [activeAttempt], activeAttempt, recordedGoodQuantity: 2, usableGoodQuantity: 2, completedGoodQuantity: 2, remainingGoodQuantity: 0, unitQuantitySatisfied: true };
    await mount(false); await settle(() => text().includes("2/2 complete"));
    const summary = document.querySelector(".v2-order-production-compact"); assert.ok(summary);
    await click("Production unit · Front · 2/2 complete · Roll", summary); await settle(() => window.location.pathname === `/production/works/${productionWorkId}`);
    assert.match(document.querySelector('[role="tab"][aria-selected="true"]')?.textContent ?? "", /^Roll\d*$/);
    assert.ok(calls.some(call => call.path.endsWith(`/production/works/${productionWorkId}`)));
    assert.equal(commands().length, 0);
  });
  await check("Mounted Order Production links omit station for missing or ambiguous frozen route evidence", async () => {
    for (const routes of [[], [rollRoute, { ...rollRoute, routeInstanceId: "duplicate" }], [{ ...rollRoute, steps: [rollStep, { ...rollStep, position: 2 }] }]] satisfies OrderRead["routes"][]) {
      orderRoutes = routes;
      await mount(false);
      const opened: { id: string; station?: "flatbed" | "roll" }[] = [];
      await act(async () => root.render(<QueryClientProvider client={cache}><OrderWorkspace organizationId={org} sessionScope={bootstrap.sessionScope} orderId={orderId} canEdit={false} canCreate={false} canCancel={false} canOverridePrice={false} canViewInvoice={false} canViewArtwork={false} canViewProofing={false} canViewProduction csrfReady onBack={() => undefined} openProduction={(id, station) => opened.push({ id, station })} /></QueryClientProvider>));
      await settle(() => text().includes("2/2 complete"));
      await click("Production unit · Front · 2/2 complete · Roll", document.querySelector(".v2-order-production-compact")!);
      assert.deepEqual(opened, [{ id: productionWorkId, station: undefined }], "existing attempt label must not override absent or ambiguous frozen destination");
      assert.equal(commands().length, 0);
    }
  });
} finally {
  window.removeEventListener(workspaceNavigationEvent, observeNavigation); window.removeEventListener("beforeunload", observeUnload); await act(async () => root.unmount()); cache.clear(); clearV2ApiSessionState(); globalThis.fetch = originalFetch; dom.window.Storage.prototype.setItem = originalStorageSet; if (previousCss) require.extensions[".css"] = previousCss; else delete require.extensions[".css"]; assert.equal(canNavigateFromSalesWorkspace(), true, "All workspace navigation listeners are removed after unmount"); dom.window.close();
}
console.log(`Actual App Order edit navigation: ${cases} scenarios passed.`);
