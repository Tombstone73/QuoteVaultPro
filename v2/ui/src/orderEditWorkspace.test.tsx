import assert from "node:assert/strict";
import React, { act, StrictMode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { JSDOM } from "jsdom";
import { OrderWorkspace, type OrderWorkspaceProps } from "./OrderWorkspace";
import { TransactionalSalesWorkspace } from "./TransactionalSalesWorkspace";
import { createSalesWorkspaceClient, salesWorkspaceKeys, type WorkspaceEditArtworkReference, type WorkspaceHeader, type WorkspaceLineInput, type WorkspaceLineView, type WorkspacePromotionView, type WorkspaceView } from "./salesWorkspaceApi";
import { salesKeys } from "./quoteFormQueries";
import type { OrderRead, ProductConfiguration } from "./api";
import type { WorkspaceArtworkClaim } from "../../src/modules/artwork/workspaceArtwork";

const org = "11111111-1111-4111-8111-111111111111";
const user = "22222222-2222-4222-8222-222222222222";
const workspaceId = "33333333-3333-4333-8333-333333333333";
const productId = "44444444-4444-4444-8444-444444444444";
const customerId = "55555555-5555-4555-8555-555555555555";
const contactId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const tempLineId = "66666666-6666-4666-8666-666666666666";
const secondTempId = "77777777-7777-4777-8777-777777777777";
const orderId = "88888888-8888-4888-8888-888888888888";
const sourceLineId = "99999999-9999-4999-8999-999999999999";
const now = "2026-10-01T00:00:00.000Z";
const copy = <T,>(value: T): T => structuredClone(value);
const amount = { cents: 10000, currency: "USD" };
const configuration: ProductConfiguration = { productId, displayName: "Banner", measurementMode: "quantity_only", requiresDimensions: false, supportedDimensionUnits: ["in"], effectiveSelections: {}, fields: [] };
const sourceLine = (kind: "calculated" | "locked" | "discount" = "locked"): NonNullable<WorkspaceLineView["sourceLineSnapshot"]> => {
  const resolved = { schemaVersion: 1 as const, organizationId: org, productId, pricingConfigurationId: productId, pricingConfigurationVersion: "historical-v1", pricingConfigurationContentHash: "frozen-hash", quantity: 2, selections: {}, derivedFacts: {}, productFacts: {} };
  const pricingResult = { schemaVersion: 1 as const, id: "historical-price", evidenceFingerprint: "historical-evidence", organizationId: org, currency: "USD", calculatedUnitAmount: { ...amount, cents: 5000 }, calculatedLineAmount: amount, unitAmountEvidence: { exactUnitCents: "5000", allocation: "rounded_line_total_divided_by_quantity" as const }, components: [{ kind: "base" as const, label: "Historical", amount }], optionImpacts: [], minimumChargeApplied: false, evaluator: { id: "historical", version: "1" }, rounding: { policyId: "historical", policyVersion: "1", stages: [] }, normalizedInput: resolved, warnings: [] };
  const decision = { pricingResultId: pricingResult.id, calculatedUnitAmount: pricingResult.calculatedUnitAmount, calculatedLineAmount: amount, resultingUnitAmount: { ...amount, cents: kind === "calculated" ? 5000 : 4000 }, resultingLineAmount: { ...amount, cents: kind === "calculated" ? 10000 : 8000 }, decidedAt: now };
  return { lineId: sourceLineId, productId, description: "Historical Banner", operationalNote: "Retain packing note", quantity: 2, resolvedConfiguration: resolved, pricingResult, calculatedLineAmount: amount, sellingLineAmount: decision.resultingLineAmount, sellingPriceDecision: kind === "calculated" ? { ...decision, kind } : kind === "locked" ? { ...decision, kind, reason: "Accepted historical sale" } : { ...decision, kind, reason: "Historical discount", discountBasisPoints: 2000 } };
};
const fixture = (kind: "calculated" | "locked" | "discount" = "locked"): WorkspaceView => {
  const source = sourceLine(kind);
  const header = { customerContact: { organizationId: org, customerId }, purchaseOrderNumber: "ORIGINAL-PO", jobLabel: "Original Job", terms: { termsCode: "net_30", commercialNotes: "Original commercial note" }, requestedFulfillment: { method: "pickup" as const, instructions: "Original instructions" } };
  const line: WorkspaceLineView = { id: tempLineId, workspaceId, position: 0, sourcePosition: 0, sourceLineId, sourceLineSnapshot: source, operationalNote: source.operationalNote, revision: 1, input: { productId, description: source.description, quantity: source.quantity, selections: {}, ...(kind === "calculated" ? { selling: { kind: "calculated" as const } } : {}) } };
  return { id: workspaceId, organizationId: org, creatorUserId: user, kind: "order_edit", state: "draft", sourceDocumentKind: "order", sourceDocumentId: orderId, baseRevision: "7", sourceHeader: { organizationId: org, orderId, orderNumber: "ORD-1001", customerContact: header.customerContact, currency: "USD", terms: header.terms, commercialState: "open", requestedFulfillment: header.requestedFulfillment, jobLabel: header.jobLabel, purchaseOrderNumber: header.purchaseOrderNumber }, header, lines: [line], removedLines: [], revision: 1, createdAt: now, updatedAt: now, expiresAt: "2099-10-31T00:00:00.000Z" };
};
const orderRead = (workspace: WorkspaceView): OrderRead => ({
  order: { organizationId: org, orderId, ...workspace.header, customerContact: { organizationId: org, customerId: workspace.header.customerContact?.customerId ?? customerId }, terms: workspace.header.terms ?? {}, currency: "USD", commercialState: "open", lines: workspace.lines.map((line, position) => ({ lineId: line.sourceLineId ?? `new-${line.id}`, productId: line.input.productId, description: line.input.description ?? "", operationalNote: line.operationalNote, quantity: line.input.quantity, position: position + 1, resolvedConfiguration: line.sourceLineSnapshot?.resolvedConfiguration ?? {}, calculatedUnitAmount: { ...amount, cents: 5000 }, calculatedLineAmount: amount, sellingUnitAmount: { ...amount, cents: 4000 }, sellingLineAmount: { ...amount, cents: 8000 }, sellingPriceDecision: { kind: line.sourceLineSnapshot?.sellingPriceDecision.kind ?? "calculated" } })) },
  number: { display: "ORD-1001", core: "1001" }, revision: "7", totals: { calculated: amount, selling: { ...amount, cents: 8000 } }, routes: [], completionEligibility: { eligible: false, blockers: [{ orderLineId: sourceLineId, kind: "fulfillment_remaining", reason: "Two original items await handoff." }], lines: [] },
});

type OwnerCall = { url: string; method: string; body: Record<string, unknown>; csrf?: string };
function owner(initial = fixture()) {
  let workspace = copy(initial);
  let claims: WorkspaceArtworkClaim[] = [];
  let references: WorkspaceEditArtworkReference[] = [{ workspaceLineId: tempLineId, sourceCanonicalLineId: sourceLineId, sourceAssignmentId: "source-assignment", artworkFileId: "source-file", status: "current", action: "KEEP", filename: "original.pdf", contentType: "application/pdf", byteSize: 1200, purpose: "customer_supplied", sourceQuoteAcceptedArtworkSnapshotId: null }];
  const calls: OwnerCall[] = [];
  const canonicalCalls: { url: string; method: string }[] = [];
  const business = { order: orderRead(initial), invoice: { id: "invoice-original", totalCents: 8000, version: "4", payments: [{ id: "payment-original", amountCents: 2000 }] }, routes: [{ id: "route-original", currentStep: "prepress" }], production: [{ id: "work-original", orderedQuantity: 2, completedQuantity: 0 }], fulfillment: [{ id: "handoff-history", quantity: 1 }], materials: [{ id: "requirement-original", orderLineId: sourceLineId, materialId: "banner-stock", requiredQuantity: 3, unit: "sqft", configurationVersion: "frozen-material-v2" }], inventory: { materialId: "banner-stock", onHand: 100, reserved: 3, ledger: [{ id: "reservation-original", orderLineId: sourceLineId, quantity: 3 }] }, artwork: [{ id: "source-assignment", artworkFileId: "source-file", orderLineId: sourceLineId }], history: [{ id: "sales-created", revision: "7" }] };
  let committed = 0;
  let beforeCommit: (() => Promise<void>) | undefined;
  let rejection: unknown;
  let loseResponse = false;
  let startLoss = false;
  const receipts = new Map<string, WorkspacePromotionView>();
  const mutate = (body: Record<string, unknown>) => {
    assert.equal(body.expectedRevision, workspace.revision, "TEMP commands use the last acknowledged workspace revision");
    assert.match(String(body.requestId), /^[a-f0-9-]{36}$/);
    workspace = { ...workspace, revision: workspace.revision + 1, ...(body.header ? { header: copy(body.header as WorkspaceHeader) } : {}) };
  };
  const request = async <T,>(url: string, init?: RequestInit): Promise<T> => {
    const method = init?.method ?? "GET";
    const body = init?.body instanceof FormData ? Object.fromEntries(init.body.entries()) : init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : {};
    calls.push({ url, method, body, csrf: (init?.headers as Record<string, string> | undefined)?.["x-v2-csrf-token"] });
    let result: unknown;
    if (url.endsWith("/order-edits")) {
      assert.equal(method, "POST"); assert.deepEqual(Object.keys(body).sort(), ["orderId", "requestId"]); assert.equal(body.orderId, orderId);
      assert.match(String(body.requestId), /^[a-f0-9-]{36}$/);
      if (startLoss) { startLoss = false; throw { code: "RETRYABLE_FAILURE", message: "Start response lost" }; }
      result = workspace;
    } else if (url.endsWith("/promote")) {
      assert.equal(body.target, "order");
      if (receipts.has(String(body.requestId))) return copy({ ...receipts.get(String(body.requestId))!, replayed: true }) as T;
      if (beforeCommit) await beforeCommit();
      if (rejection) throw rejection;
      assert.equal(body.expectedRevision, workspace.revision);
      const receipt: WorkspacePromotionView["receipt"] = { workspaceId, organizationId: org, requestId: String(body.requestId), fingerprint: "owner-fingerprint", inputRevision: workspace.revision, target: "order", documentId: orderId, documentRevision: "8", displayNumber: "ORD-1001", header: workspace.header, lineMap: workspace.lines.map((line, position) => ({ workspaceLineId: line.id, canonicalLineId: line.sourceLineId ?? `new-${line.id}`, position })), promotedAt: now, artworkPromoted: true, result: JSON.parse(JSON.stringify({ ...orderRead(workspace), revision: "8" })) };
      result = { receipt, replayed: false, promotedWorkspaceHeader: receipt.header } satisfies WorkspacePromotionView;
      workspace = { ...workspace, state: "promoted", promotion: receipt }; committed++;
      business.order = { ...orderRead(workspace), revision: "8" };
      receipts.set(receipt.requestId, copy(result as WorkspacePromotionView));
      if (loseResponse) { loseResponse = false; throw { code: "RETRYABLE_FAILURE", message: "Save response lost after commit" }; }
    } else if (url.endsWith("/discard")) { mutate(body); workspace = { ...workspace, state: "discarded" }; claims = []; result = workspace;
    } else if (url.endsWith("/artwork-edit")) {
      if (method === "GET") result = references;
      else { mutate(body); references = references.map(reference => reference.sourceAssignmentId === body.sourceAssignmentId ? { ...reference, action: body.action === "remove" ? "REMOVE" : "KEEP" } : reference); result = { sourceAssignmentId: body.sourceAssignmentId, action: body.action === "remove" ? "REMOVE" : "KEEP", workspaceRevision: workspace.revision }; }
    } else if (url.endsWith("/artwork") && method === "GET") result = claims;
    else if (url.endsWith("/artwork") && method === "POST") {
      const file = body.file as File; mutate({ ...body, expectedRevision: Number(body.expectedRevision) });
      assert.equal(file.type, "application/pdf"); const claim: WorkspaceArtworkClaim = { id: "staged-claim", workspaceId, workspaceLineId: String(body.workspaceLineId || "") || null, state: "uploaded", filename: file.name, contentType: "application/pdf", byteSize: file.size, checksumSha256: "test-pdf", artworkFileId: null, assignmentId: null }; claims.push(claim); result = { claim, workspaceRevision: workspace.revision };
    } else if (url.endsWith("/artwork/staged-claim") && method === "DELETE") { mutate(body); const claim = { ...claims[0]!, state: "cleanup_pending" as const }; claims = [claim]; result = { claim, workspaceRevision: workspace.revision };
    } else if (url.endsWith("/lines/reorder")) { mutate(body); workspace = { ...workspace, lines: (body.lineIds as string[]).map((id, position) => ({ ...workspace.lines.find(line => line.id === id)!, position })) }; result = workspace;
    } else if (url.includes("/lines/") && method === "PATCH") { mutate(body); const id = url.split("/").at(-1); workspace = { ...workspace, lines: workspace.lines.map(line => line.id === id ? { ...line, input: copy(body.line as WorkspaceLineInput), ...(Object.hasOwn(body, "operationalNote") ? { operationalNote: String(body.operationalNote) } : {}) } : line) }; result = workspace;
    } else if (url.includes("/lines/") && method === "DELETE") { mutate(body); const id = url.split("/").at(-1); workspace = { ...workspace, lines: workspace.lines.filter(line => line.id !== id).map((line, position) => ({ ...line, position })) }; result = workspace;
    } else if (url.endsWith("/lines") && method === "POST") { mutate(body); workspace = { ...workspace, lines: [...workspace.lines, { id: secondTempId, workspaceId, position: workspace.lines.length, revision: 1, input: copy(body.line as WorkspaceLineInput) }] }; result = workspace;
    } else if (url.includes("/configuration")) result = configuration;
    else if (url.endsWith("/resolve")) result = configuration;
    else if (url.endsWith("/preview")) result = { calculatedUnitAmount: amount, calculatedLineAmount: amount, currency: "USD", explanation: { optionImpacts: [], minimumChargeApplied: false } };
    else if (url.endsWith("/products")) result = initial.lines[0]?.sourceLineSnapshot?.sellingPriceDecision.kind === "calculated" ? [{ productId, displayName: "Current ACTIVE Banner" }] : [];
    else if (url.includes("/customers?")) result = [{ customerId, displayName: "Original Customer" }];
    else if (new URL(url, "https://ui.invalid").pathname.endsWith("/contacts")) {
      const parsed = new URL(url, "https://ui.invalid");
      assert.equal(parsed.pathname, `/v2/organizations/${workspace.organizationId}/sales-workspaces/${workspace.id}/contacts`);
      assert.equal(workspace.creatorUserId, user, "Contact lookup belongs to the current fixture creator");
      const rows = [{ organizationId: org, linkedCustomerId: customerId, id: contactId, label: "Original Customer contact" }];
      const eligible = rows.filter(row => row.organizationId === workspace.organizationId && (!parsed.searchParams.has("customerId") || row.linkedCustomerId === parsed.searchParams.get("customerId")));
      const choices = eligible.map(({ id, label }) => ({ id, label }));
      result = { items: choices.filter(row => row.label.toLowerCase().includes(parsed.searchParams.get("search")?.trim().toLowerCase() ?? "")).slice(0, Number(parsed.searchParams.get("limit") ?? 25)),
        selectedContact: choices.find(row => row.id === parsed.searchParams.get("selectedContactId")) ?? null };
    }
    else if (url.endsWith(`/${workspaceId}`)) { if (method === "PATCH") mutate(body); result = workspace; }
    else throw new Error(`Unexpected TEMP route ${method} ${url}`);
    return copy(result) as T;
  };
  const client = createSalesWorkspaceClient({ request, commandHeaders: () => ({ "x-v2-csrf-token": "test-csrf" }) });
  return { client, calls, canonicalCalls, business: () => copy(business), workspace: () => copy(workspace), replace: (next: WorkspaceView) => { workspace = copy(next); }, committed: () => committed, defer: (work: () => Promise<void>) => { beforeCommit = work; }, reject: (error: unknown) => { rejection = error; }, loseResponse: () => { loseResponse = true; }, loseStart: () => { startLoss = true; } };
}

const dom = new JSDOM("<!doctype html><html><body><div id='root'></div></body></html>", { url: `https://ui.invalid/orders/${orderId}` });
Object.assign(globalThis, { React, window: dom.window, document: dom.window.document, navigator: dom.window.navigator, HTMLElement: dom.window.HTMLElement, Event: dom.window.Event, IS_REACT_ACT_ENVIRONMENT: true });
const { createRoot } = await import("react-dom/client");
const { Simulate } = await import("react-dom/test-utils");
const originalFetch = globalThis.fetch;
let server = owner();
let root = createRoot(document.getElementById("root")!);
let cache = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity, gcTime: Infinity } } });
let props: OrderWorkspaceProps;
let opened: string[] = [];
let invalidations = 0;
const text = () => document.body.textContent ?? "";
const findButton = (label: string) => [...document.querySelectorAll("button")].find(button => button.textContent === label);
const button = (label: string) => { const value = findButton(label); assert.ok(value, `${label} button exists`); return value; };
const field = (label: string) => {
  const direct = document.querySelector(`[aria-label="${label}"]`);
  const parent = [...document.querySelectorAll("label")].find(node => node.textContent?.trim().startsWith(label));
  const control = direct ?? parent?.querySelector("input,select,textarea"); assert.ok(control, `${label} field exists`); return control as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
};
const settle = async (predicate: () => boolean = () => true) => { for (let index = 0; index < 100; index++) { await act(async () => { await new Promise(resolve => setTimeout(resolve, 5)); }); if (predicate()) return; } assert.ok(predicate(), "UI transition settled"); };
const click = async (label: string) => { await act(async () => button(label).click()); await settle(); };
const change = async (label: string, value: string) => { await act(async () => { const node = field(label); node.value = value; Simulate.change(node); }); await settle(); };
const render = async (overrides: Partial<OrderWorkspaceProps> = {}) => { props = { ...props, ...overrides }; await act(async () => root.render(<StrictMode><QueryClientProvider client={cache}><OrderWorkspace {...props} /></QueryClientProvider></StrictMode>)); await settle(); };
globalThis.fetch = async (input, init) => {
  const url = String(input); const method = init?.method ?? "GET"; server.canonicalCalls.push({ url, method });
  assert.equal(method, "GET", `No canonical mutation is reachable: ${url}`);
  const data = new URL(url, window.location.origin).pathname === `/v2/organizations/${org}/orders/${orderId}` ? { ...server.business().order, order: { ...server.business().order.order, lines: server.workspace().lines.map(line => line.sourceLineSnapshot ?? { ...sourceLine("calculated"), lineId: `new-${line.id}`, description: line.input.description ?? "Current ACTIVE Banner", quantity: line.input.quantity }) } }
    : url.includes("fulfillment") ? { lines: [], handoffs: [] }
    : url.includes("/artwork/") || url.endsWith("/history") || url.endsWith("/workflow/actions") ? []
    : [];
  return new Response(JSON.stringify({ ok: true, data }), { status: 200, headers: { "content-type": "application/json" } });
};
const mount = async (next = owner(), resume = false, overrides: Partial<OrderWorkspaceProps> = {}) => {
  await act(async () => root.unmount()); cache.clear(); server = next; opened = []; invalidations = 0;
  window.history.replaceState({}, "", `/orders/${orderId}${resume ? `?workspaceId=${workspaceId}` : ""}`);
  cache = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity, gcTime: Infinity } } });
  cache.setQueryData(salesKeys.order("staff-session", org, orderId), server.business().order);
  const invalidate = cache.invalidateQueries.bind(cache); cache.invalidateQueries = ((filters, options) => { if (filters?.queryKey?.length === 3) invalidations++; return invalidate(filters, options); }) as typeof cache.invalidateQueries;
  root = createRoot(document.getElementById("root")!);
  props = { organizationId: org, sessionScope: "staff-session", userId: user, orderId, canEdit: true, canCreate: false, canCancel: true, canOverridePrice: false, canViewInvoice: false, canViewArtwork: true, canAdoptArtwork: true, canRemoveArtwork: true, canViewProofing: false, canViewProduction: false, csrfReady: true, workspaceClient: server.client, workspaceCapabilities: { orderView: true, orderEdit: true, quoteCreate: false, orderCreate: false, quoteOverridePrice: false, orderOverridePrice: false, artworkView: true, artworkAdopt: true, artworkAssign: true }, onBack: () => { throw new Error("Editor must not leave the Order path"); }, openOrder: id => { opened.push(id); }, openFulfillment: () => {}, openRouting: () => {}, ...overrides };
  await render(); await settle(() => resume ? text().includes("Editing") || text().includes("conflict") || text().includes("session") || text().includes("verified") : Boolean(findButton("Edit Order")));
};
const enter = async () => { await click("Edit Order"); await settle(() => text().includes("Editing")); };
const neutralFixture = (): WorkspaceView => {
  const source = fixture("calculated");
  return { ...source, kind: "new_sales", sourceDocumentKind: undefined, sourceDocumentId: undefined, sourceHeader: undefined, baseRevision: undefined, header: { ...source.header, jobLabel: "Neutral saved entry" }, lines: [{ id: tempLineId, workspaceId, position: 0, revision: 1, input: source.lines[0]!.input }] };
};
const renderNeutral = async (controlledId?: string, onWorkspaceIdChange?: (id: string | undefined) => void) => {
  await act(async () => root.render(<QueryClientProvider client={cache}><TransactionalSalesWorkspace organizationId={org} sessionScope="staff-session" userId={user} client={server.client} workspaceId={controlledId} onWorkspaceIdChange={onWorkspaceIdChange} capabilities={{ quoteCreate: false, orderCreate: true, quoteOverridePrice: false, orderOverridePrice: false }} csrfReady openCanonical={receipt => { opened.push(receipt.documentId); }} /></QueryClientProvider>));
  await settle(() => Boolean(findButton("Save Order")));
};
const mountNeutral = async (controlledId?: string, onWorkspaceIdChange?: (id: string | undefined) => void) => {
  await mount(owner(neutralFixture()), false);
  window.history.replaceState({}, "", `/sales-entry?workspaceId=${workspaceId}`);
  await renderNeutral(controlledId, onWorkspaceIdChange);
};
const noCanonicalChanges = (before: ReturnType<typeof server.business>) => { assert.deepEqual(server.business(), before, "Canonical Order, Invoice, payment, route, Production, Fulfillment, Materials, Inventory, Artwork and history remain equivalent"); assert.ok(server.canonicalCalls.every(call => call.method === "GET")); };
let cases = 0;
const check = async (name: string, work: () => Promise<void>) => { await work(); cases++; console.log(`PASS ${name}`); };
try {
  await check("Canonical pane is read-only, one Edit action starts TEMP from the server source", async () => {
    await mount(); const before = server.business();
    assert.ok(field("PO #").matches(":disabled")); assert.equal(findButton("Save"), undefined);
    await click("Artwork"); assert.equal(document.querySelector('input[type="file"]'), null); assert.equal(findButton("Upload Artwork"), undefined);
    await act(async () => { button("Edit Order").click(); button("Edit Order").click(); }); await settle(() => text().includes("Editing"));
    assert.equal(server.calls.filter(call => call.url.endsWith("/order-edits")).length, 1);
    assert.equal(server.workspace().baseRevision, "7"); assert.equal(window.location.pathname, `/orders/${orderId}`); assert.equal(new URLSearchParams(window.location.search).get("workspaceId"), workspaceId);
    assert.match(text(), /Editing ORD-1001/);
    assert.equal(findButton("Cancel Order"), undefined); assert.equal(findButton("Routing"), undefined); assert.equal(findButton("Save Quote"), undefined); assert.equal(button("Save").disabled, false);
    noCanonicalChanges(before); assert.equal(invalidations, 0);
  });
  await check("Start response-loss retry keeps its stable request ID", async () => {
    await mount(); server.loseStart(); await click("Edit Order"); assert.match(text(), /Start response lost/); await enter();
    const starts = server.calls.filter(call => call.url.endsWith("/order-edits")); assert.equal(starts.length, 2); assert.equal(starts[0]!.body.requestId, starts[1]!.body.requestId);
  });
  await check("Header, intent, historical description and note persist only in TEMP; Cancel is snapshot-equivalent", async () => {
    await mount(); const before = server.business(); await enter(); const canonicalReads = server.canonicalCalls.length;
    await change("PO #", "TEMP-PO"); await change("Job Label", "TEMP label"); await change("Commercial notes", "TEMP note"); await change("Fulfillment", "shipping"); await change("Street", "1 TEMP Street"); await change("City", "Draft City");
    await click("Edit item 1"); await change("Line description", "TEMP historical description"); await change("Operational line note", "TEMP operational note"); await click("Store line details");
    const update = server.calls.find(call => call.url.endsWith(`/lines/${tempLineId}`) && call.method === "PATCH")!;
    assert.equal(update.body.expectedRevision, 1); assert.equal((update.body.line as WorkspaceLineInput).selling, undefined); assert.equal(server.workspace().header.purchaseOrderNumber, "TEMP-PO"); assert.equal(server.workspace().lines[0]!.operationalNote, "TEMP operational note"); assert.deepEqual(server.workspace().lines[0]!.sourceLineSnapshot, fixture().lines[0]!.sourceLineSnapshot);
    assert.equal(server.calls.filter(call => /\/(configuration|resolve|preview)$/.test(call.url)).length, 0, "Historical presentation never adopts or recalculates ACTIVE Product defaults");
    assert.equal(server.canonicalCalls.length, canonicalReads, "Hidden canonical pane cannot initiate owner reads or actions during TEMP edits");
    await click("Cancel"); await click("Confirm Cancel"); await settle(() => Boolean(findButton("Edit Order")));
    assert.equal(server.workspace().state, "discarded"); assert.equal(server.calls.filter(call => call.url.endsWith("/promote")).length, 0); noCanonicalChanges(before); assert.equal(invalidations, 0); assert.equal(window.location.search, "");
  });
  await check("Discounted and inactive historical lines stay displayable and editable without price-override authority", async () => {
    await mount(owner(fixture("discount")), true); assert.match(text(), /Historical discount price/); assert.match(text(), /\$80\.00/); await click("Edit item 1"); assert.match(text(), /cannot be replaced by a calculated price automatically/); assert.equal(findButton("Change quantity or price"), undefined); await change("Line description", "Preserved discount description"); await click("Store line details"); assert.equal(button("Save").disabled, false); assert.equal(server.workspace().lines[0]!.sourceLineSnapshot?.sellingPriceDecision.kind, "discount");
    assert.equal(server.calls.filter(call => call.url.endsWith("/products") || /\/(configuration|resolve|preview)$/.test(call.url)).length, 0, "Historical presentation requires no Product lookup");
  });
  await check("Reorder and removal use TEMP UUIDs, with no canonical line mutation", async () => {
    const workspace = fixture(); const second = { ...workspace.lines[0]!, id: secondTempId, position: 1, sourcePosition: 1, sourceLineId: "second-source", sourceLineSnapshot: { ...sourceLine(), lineId: "second-source" } };
    await mount(owner({ ...workspace, lines: [...workspace.lines, second] }), true); const before = server.business(); await click("Move item 1 down"); assert.deepEqual(server.workspace().lines.map(line => line.id), [secondTempId, tempLineId]); await click("Remove item 1"); assert.deepEqual(server.workspace().lines.map(line => line.id), [tempLineId]); noCanonicalChanges(before);
  });
  await check("New lines retain TEMP identities until the single Save returns complete source/new mapping", async () => {
    await mount(owner(fixture("calculated")), true); const before = server.business(); await change("PO #", "Header with new line"); await click("Add Item"); assert.ok(button("Save").disabled); await change("Product", productId); await settle(() => !button("Store line").disabled); await change("Quantity", "3"); await click("Store line");
    assert.equal(server.workspace().lines[1]!.id, secondTempId); assert.equal(server.workspace().lines[1]!.sourceLineId, undefined); assert.equal(server.workspace().header.purchaseOrderNumber, "Header with new line"); noCanonicalChanges(before);
    await click("Save"); await settle(() => opened.length === 1); assert.deepEqual(server.workspace().promotion?.lineMap, [{ workspaceLineId: tempLineId, canonicalLineId: sourceLineId, position: 0 }, { workspaceLineId: secondTempId, canonicalLineId: `new-${secondTempId}`, position: 1 }]); assert.equal(server.committed(), 1);
  });
  await check("Save persists current header then promotes once and navigates to the SAME Order", async () => {
    await mount(undefined, true); await change("PO #", "COMMITTED-PO"); await click("Save"); await settle(() => opened.length === 1);
    assert.equal(opened[0], orderId); assert.equal(server.committed(), 1); assert.equal(server.calls.filter(call => call.url.endsWith("/promote")).length, 1); assert.equal(server.business().order.order.purchaseOrderNumber, "COMMITTED-PO"); assert.equal(server.workspace().promotion?.lineMap[0]!.canonicalLineId, sourceLineId); assert.equal(invalidations, 1); assert.equal(window.location.pathname, `/orders/${orderId}`); assert.equal(window.location.search, "");
  });
  await check("Double Save is serialized and Cancel cannot close an in-flight commit", async () => {
    await mount(undefined, true); let release!: () => void; server.defer(() => new Promise<void>(resolve => { release = resolve; }));
    await act(async () => { button("Save").click(); button("Save").click(); }); await settle(() => Boolean(release)); assert.ok(button("Cancel").disabled); assert.ok(button("Back to Order").disabled); assert.equal(server.calls.filter(call => call.url.endsWith("/promote")).length, 1); await act(async () => release()); await settle(() => opened.length === 1); assert.equal(server.committed(), 1);
  });
  await check("Lost Save response freezes changes and retries the identical committed receipt", async () => {
    await mount(undefined, true); server.loseResponse(); await click("Save"); assert.match(text(), /Save response lost after commit/); assert.ok(button("Cancel").disabled); assert.ok(button("Back to Order").disabled); assert.ok(button("Save Draft").disabled); assert.equal(opened.length, 0); assert.equal(invalidations, 0);
    await click("Save"); await settle(() => opened.length === 1); const calls = server.calls.filter(call => call.url.endsWith("/promote")); assert.equal(calls[0]!.body.requestId, calls[1]!.body.requestId); assert.equal(server.committed(), 1); assert.equal(invalidations, 1);
  });
  await check("Stale source rejection retains TEMP header and line values, exposing typed reason and safe Cancel", async () => {
    await mount(undefined, true); const before = server.business(); await change("Job Label", "Retain my stale edit"); await click("Edit item 1"); await change("Line description", "Retain my stale line"); await click("Store line details"); server.reject({ code: "STALE_STATE", message: "Order revision changed", details: { reason: "source_revision_changed" } }); await click("Save");
    assert.equal(field("Job Label").value, "Retain my stale edit"); assert.match(text(), /Retain my stale line/); assert.match(text(), /source_revision_changed/); assert.match(text(), /cannot be rebased automatically/); assert.equal(opened.length, 0); assert.equal(invalidations, 0); await click("Review latest saved version"); assert.equal(field("Job Label").value, "Retain my stale edit"); await click("Cancel"); await click("Confirm Cancel"); noCanonicalChanges(before);
  });
  await check("Progressed owner blockers are shown, not bypassed through a canonical PATCH", async () => {
    await mount(owner(fixture("calculated")), true); const before = server.business(); await click("Edit item 1"); await click("Change quantity or price"); await settle(() => !button("Store line").disabled); await change("Quantity", "5"); await click("Store line"); assert.equal(server.workspace().lines[0]!.input.quantity, 5);
    server.reject({ code: "CONFLICT", message: "Progressed quantity needs owner reconciliation", details: { reason: "progressed_order_quantity_change" } }); await click("Save"); assert.match(text(), /progressed_order_quantity_change/); assert.match(text(), /Quantity 5/); noCanonicalChanges(before); assert.equal(server.committed(), 0);
  });
  await check("Existing keep/remove and new PDF add/remove are TEMP Artwork-owner operations", async () => {
    await mount(undefined, true); const before = server.business(); await settle(() => Boolean(findButton("Remove existing original.pdf"))); await change("Job Label", "Still local during Artwork"); await click("Remove existing original.pdf"); await settle(() => Boolean(findButton("Keep original.pdf"))); await click("Keep original.pdf");
    await change("Attach to", tempLineId); await act(async () => { const node = field("PDF file") as HTMLInputElement; Object.defineProperty(node, "files", { configurable: true, value: [new File(["%PDF-test"], "new.pdf", { type: "application/pdf" })] }); Simulate.change(node); }); await click("Upload staged PDF"); await settle(() => Boolean(findButton("Remove new.pdf"))); await click("Remove new.pdf"); assert.equal(field("Job Label").value, "Still local during Artwork");
    const intents = server.calls.filter(call => call.url.endsWith("/artwork-edit") && call.method === "POST"); assert.deepEqual(intents.map(call => call.body.action), ["remove", "keep"]); assert.ok(intents.every(call => call.body.sourceAssignmentId === "source-assignment")); assert.ok(server.calls.filter(call => call.method !== "GET").every(call => call.csrf === "test-csrf")); noCanonicalChanges(before); assert.match(text(), /Replacement and production designation are unavailable/);
  });
  await check("Reload resumes source TEMP and Save Draft explicitly acknowledges safe return", async () => {
    await mount(undefined, true); await change("Job Label", "Durable resumed label"); assert.ok(button("Back to Order").disabled); const warning = new dom.window.Event("beforeunload", { cancelable: true }); window.dispatchEvent(warning); assert.ok(warning.defaultPrevented); await click("Save Draft"); assert.equal(button("Back to Order").disabled, false);
    const persisted = server; await mount(persisted, true); assert.equal(field("Job Label").value, "Durable resumed label"); assert.equal(server.calls.filter(call => call.url.endsWith("/order-edits")).length, 0); await click("Save Draft"); await click("Back to Order"); assert.equal(window.location.search, ""); assert.equal(server.workspace().state, "draft"); assert.equal(server.calls.filter(call => call.url.endsWith("/promote") || call.url.endsWith("/discard")).length, 0);
  });
  await check("Same-Order query navigation cannot silently unmount dirty TEMP", async () => {
    await mount(undefined, true); await change("Job Label", "Retain across browser Back"); await act(async () => { window.history.replaceState({}, "", `/orders/${orderId}`); window.dispatchEvent(new dom.window.PopStateEvent("popstate")); }); await settle();
    assert.equal(field("Job Label").value, "Retain across browser Back"); assert.equal(new URLSearchParams(window.location.search).get("workspaceId"), workspaceId); assert.match(text(), /Finish Save, Cancel/); assert.equal(findButton("Edit Order"), undefined); assert.equal(server.calls.filter(call => call.url.endsWith("/promote") || call.url.endsWith("/discard")).length, 0);
    await click("Save Draft"); await click("Back to Order"); assert.equal(window.location.search, "");
  });
  await check("Workspace query mismatch cannot disclose another Order draft", async () => {
    const wrong = { ...fixture(), sourceDocumentId: "different-order", header: { jobLabel: "PRIVATE OTHER ORDER" } }; await mount(owner(wrong), true); await settle(() => text().includes("source conflict")); assert.doesNotMatch(text(), /PRIVATE OTHER ORDER|Historical Banner|original\.pdf/); assert.equal(server.calls.filter(call => /\/(products|artwork|artwork-edit|customers\?)/.test(call.url)).length, 0);
  });
  await check("Tenant, creator and session cache isolation hides cached TEMP values", async () => {
    await mount(undefined, true); await change("Job Label", "PRIVATE LOCAL DRAFT"); await render({ userId: "different-user", sessionScope: "replacement-session" }); await settle(() => text().includes("identity did not match")); assert.doesNotMatch(text(), /PRIVATE LOCAL DRAFT|Historical Banner/);
    await render({ organizationId: "other-org", userId: user, sessionScope: "other-tenant" }); await settle(() => text().includes("identity did not match")); assert.doesNotMatch(text(), /Original Job|Historical Banner/); assert.notDeepEqual(salesWorkspaceKeys.workspace("staff-session", org, user, workspaceId), salesWorkspaceKeys.workspace("staff-session", org, "different-user", workspaceId));
  });
  await check("Fresh order.view/order.edit flags fail closed, independent of Order creation caps", async () => {
    await mount(undefined, true); assert.equal(button("Save").disabled, false); const before = server.calls.length; await render({ workspaceCapabilities: { ...props.workspaceCapabilities!, orderView: false } }); assert.match(text(), /could not be verified/); assert.doesNotMatch(text(), /Historical Banner/); assert.equal(server.calls.length, before);
    await render({ workspaceCapabilities: { orderView: true, orderEdit: false, orderCreate: true, quoteCreate: true, quoteOverridePrice: false } }); assert.match(text(), /could not be verified/); assert.equal(server.calls.length, before);
  });
  await check("Committed edit reload opens durable same-Order receipt without another promotion", async () => {
    await mount(undefined, true); await click("Save"); await settle(() => opened.length === 1); const persisted = server; await mount(persisted, true); assert.match(text(), /Saved as order/); assert.equal(opened.length, 0); await click("Open saved document"); assert.deepEqual(opened, [orderId]); assert.equal(server.calls.filter(call => call.url.endsWith("/promote")).length, 1);
  });
  await check("A mismatched Save receipt cannot navigate to or invalidate a second Order", async () => {
    const invalid = owner(); const promote = invalid.client.promote; invalid.client.promote = async (...args) => { const result = await promote(...args); return { ...result, receipt: { ...result.receipt, documentId: "another-order" } }; };
    await mount(invalid, true); await click("Save"); assert.match(text(), /receipt did not match/); assert.deepEqual(opened, []); assert.equal(invalidations, 0); assert.ok(button("Cancel").disabled); assert.ok(button("Back to Order").disabled); assert.equal(window.location.pathname, `/orders/${orderId}`);
  });
  await check("A source-edit workspace cannot leak into neutral New Sales Entry", async () => {
    await mount(undefined, true); await act(async () => root.render(<QueryClientProvider client={cache}><TransactionalSalesWorkspace organizationId={org} sessionScope="staff-session" userId={user} client={server.client} workspaceId={workspaceId} capabilities={{ quoteCreate: true, quoteOverridePrice: false }} csrfReady openCanonical={() => { throw new Error("Mismatched neutral source must not open"); }} /></QueryClientProvider>)); await settle(() => text().includes("source conflict")); assert.doesNotMatch(text(), /Historical Banner|Save Quote/);
  });
  await check("Editing visible TEMP terms retains unknown server terms and the full immutable source header", async () => {
    const workspace = fixture(); const terms = { ...workspace.header.terms, futureOwnerTerms: { context: "server-only-context", version: 12, flags: ["retain", "unknown"] } };
    await mount(owner({ ...workspace, header: { ...workspace.header, terms }, sourceHeader: { ...workspace.sourceHeader!, terms } }), true); const before = server.business(); const source = server.workspace().sourceHeader;
    await change("Terms code", "net_45"); await change("Commercial notes", "Only the visible note changed"); await click("Save Draft");
    const saved = server.calls.find(call => call.method === "PATCH" && call.url.endsWith(`/${workspaceId}`))!;
    assert.deepEqual((saved.body.header as typeof workspace.header & { terms: typeof terms }).terms.futureOwnerTerms, terms.futureOwnerTerms); assert.equal(server.workspace().header.terms?.termsCode, "net_45"); assert.deepEqual(server.workspace().sourceHeader, source); noCanonicalChanges(before);
  });
  await check("Neutral entry URL changes retain both dirty header and the mounted line editor", async () => {
    await mountNeutral(); const before = server.business(); await change("Job Label", "Keep my neutral local header"); await click("Add Item"); await change("Quantity", "7"); const calls = server.calls.length;
    await act(async () => { window.history.replaceState({}, "", `/sales-entry?workspaceId=${productId}`); window.dispatchEvent(new dom.window.PopStateEvent("popstate")); }); await settle();
    assert.equal(field("Job Label").value, "Keep my neutral local header"); assert.equal(field("Quantity").value, "7"); assert.equal(new URLSearchParams(window.location.search).get("workspaceId"), workspaceId); assert.match(text(), /before switching workspaces/); assert.equal(server.calls.length, calls); noCanonicalChanges(before);
  });
  await check("Hot controlled workspace props cannot remount a dirty neutral entry", async () => {
    const changes: (string | undefined)[] = []; const notify = (id: string | undefined) => { changes.push(id); };
    await mountNeutral(workspaceId, notify); await change("Job Label", "Keep across owner wrapper update"); const calls = server.calls.length; await renderNeutral(productId, notify);
    assert.equal(field("Job Label").value, "Keep across owner wrapper update"); assert.equal(changes.at(-1), workspaceId); assert.equal(new URLSearchParams(window.location.search).get("workspaceId"), workspaceId); assert.equal(server.calls.length, calls);
    await renderNeutral(workspaceId, notify); await click("Save Draft"); assert.equal(server.workspace().header.jobLabel, "Keep across owner wrapper update");
  });
  await check("Neutral URL switching is blocked synchronously during Save and after a lost response", async () => {
    await mountNeutral(); let release!: () => void; server.defer(() => new Promise<void>(resolve => { release = resolve; })); server.loseResponse();
    await act(async () => { button("Save Order").click(); window.history.replaceState({}, "", "/sales-entry"); window.dispatchEvent(new dom.window.PopStateEvent("popstate")); }); await settle(() => Boolean(release));
    assert.equal(new URLSearchParams(window.location.search).get("workspaceId"), workspaceId); assert.ok(button("Save Order").disabled);
    await act(async () => release()); await settle(() => text().includes("Save response lost after commit"));
    await act(async () => { window.history.replaceState({}, "", `/sales-entry?workspaceId=${productId}`); window.dispatchEvent(new dom.window.PopStateEvent("popstate")); }); await settle();
    assert.equal(new URLSearchParams(window.location.search).get("workspaceId"), workspaceId); assert.ok(button("Save Draft").disabled); assert.deepEqual(opened, []);
    server.defer(async () => {}); await click("Save Order"); await settle(() => opened.length === 1); const promotions = server.calls.filter(call => call.url.endsWith("/promote")); assert.equal(promotions.length, 2); assert.equal(promotions[0]!.body.requestId, promotions[1]!.body.requestId); assert.equal(server.committed(), 1);
  });
} finally { await act(async () => root.unmount()); cache.clear(); globalThis.fetch = originalFetch; dom.window.close(); }
console.log(`Order edit workspace: ${cases} scenarios passed.`);
