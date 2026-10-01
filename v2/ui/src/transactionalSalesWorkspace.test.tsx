import assert from "node:assert/strict";
import React, { act, StrictMode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { JSDOM } from "jsdom";
import { TransactionalSalesWorkspace, type TransactionalSalesWorkspaceProps } from "./TransactionalSalesWorkspace";
import { createSalesWorkspaceClient, salesWorkspaceKeys, type SalesWorkspaceClient, type WorkspaceHeader, type WorkspaceLineInput, type WorkspaceLineView, type WorkspacePromotionView, type WorkspaceView } from "./salesWorkspaceApi";
import type { ProductConfiguration, SalesLinePricingPreview } from "./api";
import type { WorkspaceArtworkClaim } from "../../src/modules/artwork/workspaceArtwork";
import { brandedId } from "../../src/modules/shared/commercialValues";

const org = "11111111-1111-4111-8111-111111111111";
const user = "22222222-2222-4222-8222-222222222222";
const workspaceId = "33333333-3333-4333-8333-333333333333";
const productId = "44444444-4444-4444-8444-444444444444";
const customerId = "55555555-5555-4555-8555-555555555555";
const lineId = "66666666-6666-4666-8666-666666666666";
const otherLineId = "77777777-7777-4777-8777-777777777777";
const contactId = "88888888-8888-4888-8888-888888888888";
const now = "2026-10-01T00:00:00.000Z";
const configuration: ProductConfiguration = { productId, displayName: "Banner", measurementMode: "dimensions_required", requiresDimensions: true, supportedDimensionUnits: ["in", "ft", "mm"], effectiveSelections: { finish: "matte" }, fields: [{ selectionKey: "finish", label: "Finish", inputType: "select", required: true, choices: [{ value: "matte", label: "Matte" }, { value: "gloss", label: "Gloss" }] }] };
const preview: SalesLinePricingPreview = { calculatedUnitAmount: { cents: 12345, currency: "USD" }, calculatedLineAmount: { cents: 12345, currency: "USD" }, currency: "USD", explanation: { optionImpacts: [], minimumChargeApplied: false } };
const input: WorkspaceLineInput = { productId, description: "Canned Banner", quantity: 1, selections: { finish: "matte" }, dimensions: { width: "24", height: "36", unit: "in" }, selling: { kind: "calculated" } };
const cannedLine = (id = lineId): WorkspaceLineView => {
  const resolved = { schemaVersion: 1 as const, organizationId: org, productId, pricingConfigurationId: productId, pricingConfigurationVersion: "v1", pricingConfigurationContentHash: "canned-hash", quantity: 1, selections: { finish: "matte" }, derivedFacts: {}, productFacts: {} };
  const price = { schemaVersion: 1 as const, id: "price-a", evidenceFingerprint: "server-price", organizationId: org, currency: "USD", calculatedUnitAmount: { cents: 12345, currency: "USD" }, calculatedLineAmount: { cents: 12345, currency: "USD" }, unitAmountEvidence: { exactUnitCents: "12345", allocation: "rounded_line_total_divided_by_quantity" as const }, components: [{ kind: "base" as const, label: "Canned", amount: { cents: 12345, currency: "USD" } }], optionImpacts: [], minimumChargeApplied: false, evaluator: { id: "canned", version: "1" }, rounding: { policyId: "canned", policyVersion: "1", stages: [] }, normalizedInput: resolved, warnings: [] };
  const evidence = { customerContact: { organizationId: org, customerId }, inputFingerprint: "server-input", resolvedConfiguration: resolved, pricingResult: price, sellingPriceDecision: { kind: "calculated" as const, pricingResultId: price.id, calculatedUnitAmount: price.calculatedUnitAmount, calculatedLineAmount: price.calculatedLineAmount, resultingUnitAmount: price.calculatedUnitAmount, resultingLineAmount: price.calculatedLineAmount, decidedAt: now }, calculatedAt: now };
  return { id, workspaceId, position: 0, revision: 1, input, previews: { quote: { ...evidence, target: "quote" }, order: { ...evidence, target: "order" } } };
};
const cannedWorkspace = (lines: readonly WorkspaceLineView[] = []): WorkspaceView => ({ id: workspaceId, organizationId: org, creatorUserId: user, kind: "new_sales", state: "draft", revision: 4, header: { customerContact: { organizationId: org, customerId, contactId }, jobLabel: "Saved entry" }, lines, createdAt: now, updatedAt: now, expiresAt: "2099-10-31T00:00:00.000Z" });
const copy = <T,>(value: T): T => structuredClone(value);

function mockServer(initial = cannedWorkspace(), initialClaims: readonly WorkspaceArtworkClaim[] = []) {
  let saved = copy(initial);
  let claims = copy(initialClaims);
  const calls: { method: string; input?: unknown }[] = [];
  const changed = (method: string, body: Readonly<{ expectedRevision: number; header?: WorkspaceHeader }>, lines = saved.lines) => {
    calls.push({ method, input: copy(body) });
    assert.equal(body.expectedRevision, saved.revision, `${method} uses the last acknowledged CAS revision`);
    saved = { ...saved, header: body.header ?? saved.header, lines, revision: saved.revision + 1 };
    return copy(saved);
  };
  const client: SalesWorkspaceClient = {
    create: async (_org, body) => { calls.push({ method: "create", input: copy(body) }); saved = { ...saved, header: body.header ?? {}, lines: [], revision: 1 }; return copy(saved); },
    read: async (_org, id) => { assert.equal(id, saved.id); calls.push({ method: "read" }); return copy(saved); },
    list: async () => { calls.push({ method: "list" }); return [copy(saved)]; },
    saveDraft: async (_org, _id, body) => changed("saveDraft", body),
    addLine: async (_org, _id, body) => changed("addLine", body, [...saved.lines, { ...cannedLine(saved.lines.length ? otherLineId : lineId), input: body.line, position: saved.lines.length }]),
    updateLine: async (_org, _id, body) => changed("updateLine", body, saved.lines.map((line) => line.id === body.lineId ? { ...line, input: body.line, revision: line.revision + 1 } : line)),
    removeLine: async (_org, _id, body) => changed("removeLine", body, saved.lines.filter((line) => line.id !== body.lineId)),
    reorderLines: async (_org, _id, body) => changed("reorderLines", body, body.lineIds.map((id, position) => ({ ...saved.lines.find((line) => line.id === id)!, position }))),
    refreshLines: async (_org, _id, body) => changed("refreshLines", body),
    discard: async (_org, _id, body) => { changed("discard", body); saved = { ...saved, state: "discarded" }; return copy(saved); },
    promote: async (_org, body) => {
      calls.push({ method: "promote", input: copy(body) });
      assert.equal(body.expectedRevision, saved.revision);
      const receipt: WorkspacePromotionView["receipt"] = { workspaceId, organizationId: org, requestId: body.requestId, fingerprint: "server-promotion", inputRevision: body.expectedRevision, target: body.target, documentId: "canonical-id", documentRevision: "9", header: saved.header, lineMap: saved.lines.map((line) => ({ workspaceLineId: line.id, canonicalLineId: `canonical-${line.id}`, position: line.position })), promotedAt: now, result: {}, artworkPromoted: false };
      saved = { ...saved, state: "promoted", promotion: receipt };
      return { receipt, replayed: false, promotedWorkspaceHeader: receipt.header };
    },
    customers: async () => [{ customerId, displayName: "Canned Customer" }],
    products: async () => [{ productId, displayName: "Banner" }],
    contacts: async (_org, _id, query) => ({ items: [{ id: brandedId<"ContactId">(contactId), label: "Casey" }], selectedContact: query.selectedContactId === contactId ? { id: brandedId<"ContactId">(contactId), label: "Casey" } : null }),
    configurationApi: () => ({ configuration: async () => copy(configuration), resolveConfiguration: async (_org, _product, selections) => ({ ...configuration, effectiveSelections: { ...selections } }), previewLinePricing: async () => copy(preview) }),
    listArtwork: async () => { calls.push({ method: "listArtwork" }); return copy(claims); },
    uploadArtwork: async (_org, id, body) => {
      calls.push({ method: "uploadArtwork", input: { workspaceId: id, workspaceLineId: body.workspaceLineId, requestId: body.requestId, expectedRevision: body.expectedRevision, filename: body.file.name } });
      assert.equal(body.expectedRevision, saved.revision);
      const claim: WorkspaceArtworkClaim = { id: "claim-a", workspaceId, workspaceLineId: body.workspaceLineId ?? null, filename: body.file.name, contentType: "application/pdf", byteSize: body.file.size, checksumSha256: "canned", state: "uploaded", artworkFileId: null, assignmentId: null };
      claims = [...claims, claim]; saved = { ...saved, revision: saved.revision + 1 };
      return { claim, workspaceRevision: saved.revision };
    },
    assignArtwork: async (_org, body) => { calls.push({ method: "assignArtwork", input: copy(body) }); const claim = { ...claims[0]!, workspaceLineId: body.workspaceLineId }; claims = [claim]; saved = { ...saved, revision: saved.revision + 1 }; return { claim, workspaceRevision: saved.revision }; },
    removeArtwork: async (_org, body) => { calls.push({ method: "removeArtwork", input: copy(body) }); const claim = { ...claims[0]!, state: "cleanup_pending" as const }; claims = [claim]; saved = { ...saved, revision: saved.revision + 1 }; return { claim, workspaceRevision: saved.revision }; },
  };
  return { client, calls, saved: () => copy(saved), replace: (next: WorkspaceView) => { saved = next; } };
}

const dom = new JSDOM("<!doctype html><html><body><div id='root'></div></body></html>", { url: "https://ui.invalid/sales/new" });
Object.assign(globalThis, { window: dom.window, document: dom.window.document, navigator: dom.window.navigator, HTMLElement: dom.window.HTMLElement, Event: dom.window.Event, IS_REACT_ACT_ENVIRONMENT: true });
const { createRoot } = await import("react-dom/client");
const { Simulate } = await import("react-dom/test-utils");
const originalFetch = globalThis.fetch;
globalThis.fetch = async () => { throw new Error("Unexpected external or canonical API call"); };
let root = createRoot(document.getElementById("root")!);
let cache = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
let currentProps: TransactionalSalesWorkspaceProps;
let opened: NonNullable<WorkspaceView["promotion"]>[] = [];
const text = () => document.body.textContent ?? "";
const button = (label: string) => { const match = [...document.querySelectorAll("button")].find((node) => node.textContent === label); assert.ok(match, `Button ${label} exists`); return match; };
const field = (label: string): HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement => {
  const explicit = document.querySelector<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(`[aria-label="${label}"]`);
  if (explicit) return explicit;
  const match = [...document.querySelectorAll("label")].find((node) => node.textContent?.trim().startsWith(label));
  const control = match?.querySelector("input,select,textarea"); assert.ok(control, `Field ${label} exists`); return control as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
};
const settle = async (predicate: () => boolean = () => true) => {
  for (let attempt = 0; attempt < 80; attempt++) { await act(async () => { await new Promise((resolve) => setTimeout(resolve, 5)); }); if (predicate()) return; }
  assert.ok(predicate(), "Expected UI state settled");
};
const click = async (label: string) => { await act(async () => button(label).click()); await settle(); };
const change = async (label: string, value: string) => { await act(async () => { const node = field(label); node.value = value; Simulate.change(node); }); await settle(); };
const render = async (overrides: Partial<TransactionalSalesWorkspaceProps> = {}) => {
  currentProps = { ...currentProps, ...overrides };
  await act(async () => root.render(<StrictMode><QueryClientProvider client={cache}><TransactionalSalesWorkspace {...currentProps} /></QueryClientProvider></StrictMode>));
  await settle();
};
const mount = async (server: ReturnType<typeof mockServer>, resume = true, overrides: Partial<TransactionalSalesWorkspaceProps> = {}) => {
  await act(async () => root.unmount()); cache.clear();
  window.history.replaceState({}, "", resume ? `/sales/new?workspaceId=${workspaceId}` : "/sales/new");
  root = createRoot(document.getElementById("root")!);
  cache = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  opened = [];
  currentProps = { client: server.client, organizationId: org, sessionScope: "staff-session", userId: user, csrfReady: true, capabilities: { quoteCreate: true, orderCreate: true, quoteOverridePrice: true, orderOverridePrice: true, artworkView: true, artworkAdopt: true, artworkAssign: true }, openCanonical: (receipt) => { opened.push(receipt); }, ...overrides };
  await render();
  await settle(() => resume ? Boolean(document.querySelector('[aria-label="Transactional Sales workspace"]')) || text().includes("permission") || text().includes("identity did not match") : text().includes("Resume Draft"));
};
let cases = 0;
const check = async (name: string, work: () => Promise<void>) => { await work(); cases++; console.log(`PASS ${name}`); };

try {
  await check("StrictMode render never creates and explicit creation is neutral and serialized", async () => {
    const server = mockServer(); await mount(server, false);
    assert.equal(server.calls.filter((call) => call.method === "create").length, 0);
    assert.doesNotMatch(text(), /Save Quote|Save Order|Create Quote|Create Order/);
    await act(async () => { button("New Sales Entry").click(); button("New Sales Entry").click(); });
    await settle(() => text().includes("Draft revision 1"));
    assert.equal(server.calls.filter((call) => call.method === "create").length, 1);
    assert.equal(new URLSearchParams(window.location.search).get("workspaceId"), workspaceId);
    assert.equal(server.calls.filter((call) => call.method === "promote").length, 0);
  });
  await check("Creation retry keeps the same business request", async () => {
    const server = mockServer(); const original = server.client.create; const ids: string[] = [];
    server.client.create = async (organization, body) => { ids.push(body.requestId); if (ids.length === 1) throw { code: "RETRYABLE_FAILURE", message: "Connection lost" }; return original(organization, body); };
    await mount(server, false); await click("New Sales Entry"); assert.match(text(), /Connection lost/); await click("New Sales Entry");
    assert.equal(ids.length, 2); assert.equal(ids[0], ids[1]);
  });
  await check("Save Draft persists all header fields and reload resumes durable workspace", async () => {
    const server = mockServer(); await mount(server);
    await change("PO #", "PO-9"); await change("Job Label", "Local job"); await change("Requested Due", "2026-11-02"); await change("Fulfillment", "pickup"); await change("Fulfillment instructions", "Call on arrival"); await change("Terms code", "net_30"); await change("Commercial notes", "Commercial memo"); await change("Workspace notes", "Internal memo");
    assert.equal(server.calls.filter((call) => call.method === "saveDraft").length, 0, "No on-blur writes");
    await click("Save Draft");
    assert.deepEqual(server.saved().header, { customerContact: { organizationId: org, customerId, contactId }, jobLabel: "Local job", purchaseOrderNumber: "PO-9", requestedDueDate: "2026-11-02T00:00:00.000Z", requestedFulfillment: { method: "pickup", instructions: "Call on arrival" }, terms: { termsCode: "net_30", commercialNotes: "Commercial memo" }, notes: "Internal memo" });
    await mount(server); assert.equal(field("Job Label").value, "Local job"); assert.equal(server.saved().revision, 5); assert.equal(server.calls.filter((call) => call.method === "create" || call.method === "promote").length, 0);
  });
  await check("Resume action opens an owned listed workspace without creating another", async () => {
    const server = mockServer(); server.client.list = async () => [server.saved(), { ...server.saved(), id: otherLineId, creatorUserId: "other-user", header: { jobLabel: "Private foreign draft" } }];
    await mount(server, false); assert.doesNotMatch(text(), /Private foreign draft/); await click("Resume Saved entry"); await settle(() => text().includes("Draft revision 4")); assert.equal(server.calls.filter((call) => call.method === "create" || call.method === "promote").length, 0);
  });
  await check("Neutral customer selection clears the previous contact before saving", async () => {
    const server = mockServer(); server.client.customers = async () => [{ customerId, displayName: "Canned Customer" }, { customerId: otherLineId, displayName: "Second Customer" }];
    await mount(server); await change("Customer", otherLineId); assert.equal(field("Contact").value, ""); await click("Save Draft"); assert.deepEqual(server.saved().header.customerContact, { organizationId: org, customerId: otherLineId });
  });
  await check("Contact-only mode replaces the whole reference and saves without inferring the old Customer", async () => {
    const original = cannedWorkspace([cannedLine()]);
    const initial = { ...original, header: { ...original.header, terms: { termsCode: "net_30", commercialNotes: "Preserved terms" }, notes: "TEMP only" } };
    const server = mockServer(initial); await mount(server);
    await change("Customer / Contact mode", "contact_only");
    assert.equal(document.querySelector('[aria-label="Customer"]'), null);
    assert.doesNotMatch(text(), /\$123\.45/, "unsaved identity changes invalidate displayed target previews");
    await click("Save Draft");
    assert.deepEqual(server.saved().header.customerContact, { organizationId: org, contactId });
    assert.deepEqual(server.saved().header.terms, initial.header.terms); assert.equal(server.saved().header.notes, "TEMP only");
    await mount(server); assert.equal(field("Customer / Contact mode").value, "contact_only"); assert.equal(field("Contact").value, contactId);
    assert.equal(server.calls.filter(call => call.method === "promote").length, 0);
  });
  await check("Store line atomically submits unsaved header and reuses the configured editor", async () => {
    const server = mockServer(); await mount(server); await change("Job Label", "Header with line"); await click("Add Item");
    assert.ok(button("Save Draft").disabled); assert.ok(button("Save Quote").disabled); assert.ok(button("Save Order").disabled);
    await change("Product", productId); await settle(() => Boolean([...document.querySelectorAll("label")].find((node) => node.textContent?.trim().startsWith("Width (in)"))));
    await change("Quantity", "3"); await change("Width (in)", "24"); await change("Height (in)", "36"); await change("Finish", "gloss");
    await click("Store line"); await settle(() => server.saved().lines.length === 1);
    assert.equal(server.saved().header.jobLabel, "Header with line"); assert.equal(server.saved().lines[0]!.id, lineId); assert.equal(server.saved().lines[0]!.input.quantity, 3); assert.equal(server.saved().lines[0]!.input.selections?.finish, "gloss");
    assert.deepEqual(server.calls.filter((call) => ["addLine", "saveDraft", "promote"].includes(call.method)).map((call) => call.method), ["addLine"]);
    assert.match(text(), /\$123\.45/); assert.doesNotMatch(text(), /\$370\.35/, "No UI quantity-times-preview calculation");
  });
  await check("Edit reorder remove preserve persisted TEMP UUIDs and CAS roundtrip", async () => {
    const server = mockServer(cannedWorkspace([cannedLine(), { ...cannedLine(otherLineId), position: 1 }])); await mount(server); await click("Edit item 1"); await settle(() => !button("Store line").disabled); await change("Quantity", "7"); await click("Store line");
    assert.equal(server.saved().lines[0]!.id, lineId); assert.equal(server.saved().lines[0]!.input.quantity, 7);
    await click("Move item 1 down"); assert.deepEqual(server.saved().lines.map((line) => line.id), [otherLineId, lineId]);
    await click("Remove item 1"); assert.deepEqual(server.saved().lines.map((line) => line.id), [lineId]);
    await mount(server); assert.equal(document.querySelector("[data-workspace-line-id]")?.getAttribute("data-workspace-line-id"), lineId); assert.match(text(), /Quantity 7/);
  });
  for (const target of ["Quote", "Order"] as const) await check(`Only explicit Save ${target} promotes after current local header persistence`, async () => {
    const server = mockServer(cannedWorkspace([cannedLine()])); await mount(server); await change("PO #", "Before promotion"); assert.equal(opened.length, 0); await click(`Save ${target}`);
    assert.deepEqual(server.calls.filter((call) => ["saveDraft", "promote"].includes(call.method)).map((call) => call.method), ["saveDraft", "promote"]);
    assert.equal(opened.length, 1); assert.equal(opened[0]!.target, target.toLowerCase()); assert.equal(opened[0]!.header.purchaseOrderNumber, "Before promotion"); assert.equal(opened[0]!.lineMap[0]!.workspaceLineId, lineId);
  });
  await check("Promotion double click is disabled and cannot duplicate mutation", async () => {
    const server = mockServer(cannedWorkspace([cannedLine()])); const original = server.client.promote; let release!: () => void; let invocations = 0;
    server.client.promote = async (organization, body) => { invocations++; await new Promise<void>((resolve) => { release = resolve; }); return original(organization, body); };
    await mount(server); await act(async () => { button("Save Order").click(); button("Save Order").click(); });
    assert.equal(invocations, 1); assert.ok(button("Save Order").disabled); assert.ok(field("PO #").closest("fieldset")?.disabled);
    await act(async () => release()); await settle(() => opened.length === 1); assert.equal(server.calls.filter((call) => call.method === "promote").length, 1);
  });
  await check("Uncertain promotion retries the same target request without another draft write", async () => {
    const server = mockServer(cannedWorkspace([cannedLine()])); const original = server.client.promote; const ids: string[] = [];
    server.client.promote = async (organization, body) => { ids.push(body.requestId); if (ids.length === 1) throw { code: "RETRYABLE_FAILURE", message: "Lost response" }; return original(organization, body); };
    await mount(server); await click("Save Order"); assert.match(text(), /Lost response/); assert.ok(button("Save Quote").disabled); assert.ok(button("Save Draft").disabled); await click("Save Order"); assert.equal(ids[0], ids[1]); assert.equal(opened.length, 1);
  });
  await check("Definite promotion validation failure permits correcting local fields", async () => {
    const server = mockServer(cannedWorkspace([cannedLine()])); server.client.promote = async () => { throw { code: "VALIDATION_ERROR", message: "Customer required" }; };
    await mount(server); await click("Save Quote"); assert.match(text(), /Customer required/); assert.equal(field("PO #").closest("fieldset")?.disabled, false); assert.equal(button("Save Draft").disabled, false); await change("PO #", "Correctable"); await click("Save Draft"); assert.equal(server.saved().header.purchaseOrderNumber, "Correctable");
  });
  await check("Stale revision preserves local draft until explicit latest adoption", async () => {
    const server = mockServer(); const original = server.client.saveDraft; let stale = true;
    server.client.saveDraft = async (organization, id, body) => { if (stale) { stale = false; server.replace({ ...server.saved(), revision: 8, header: { ...server.saved().header, jobLabel: "Other saved change" } }); throw { code: "CONFLICT", message: "Workspace revision changed" }; } return original(organization, id, body); };
    await mount(server); await change("Job Label", "Keep my unsaved job"); await click("Save Draft"); assert.equal(field("Job Label").value, "Keep my unsaved job"); assert.match(text(), /Local edits are retained/); assert.ok(button("Save Draft").disabled);
    await click("Review latest saved version"); assert.equal(field("Job Label").value, "Keep my unsaved job"); assert.match(text(), /Other saved change/); await click("Use latest and discard local changes"); assert.equal(field("Job Label").value, "Other saved change"); await change("PO #", "Reapplied deliberately"); await click("Save Draft"); assert.equal(server.saved().revision, 9);
  });
  await check("Stale line write keeps the open editor and unsaved header intact", async () => {
    const server = mockServer(cannedWorkspace([cannedLine()])); server.client.updateLine = async () => { throw { code: "CONFLICT", message: "Line revision changed" }; };
    await mount(server); await change("Job Label", "Keep header too"); await click("Edit item 1"); await settle(() => !button("Store line").disabled); await change("Quantity", "9"); await click("Store line"); assert.equal(field("Quantity").value, "9"); assert.equal(field("Job Label").value, "Keep header too"); assert.match(text(), /Line revision changed/); assert.equal(server.saved().lines[0]!.input.quantity, 1);
  });
  await check("Reload of a committed promotion opens its durable receipt without another write", async () => {
    const server = mockServer(cannedWorkspace([cannedLine()])); await mount(server); await click("Save Quote"); await mount(server); assert.match(text(), /Saved as quote/); assert.equal(opened.length, 0); await click("Open saved document"); assert.equal(opened.length, 1); assert.equal(opened[0]!.documentId, "canonical-id"); assert.equal(server.calls.filter((call) => call.method === "promote").length, 1);
  });
  await check("Discard is only a workspace tombstone with no promotion", async () => {
    const server = mockServer(cannedWorkspace([cannedLine()])); await mount(server); await change("Job Label", "Do not save"); await click("Discard"); await click("Confirm Discard"); assert.equal(server.saved().state, "discarded"); assert.equal(server.saved().header.jobLabel, "Saved entry"); assert.equal(server.calls.filter((call) => call.method === "saveDraft" || call.method === "promote" || call.method === "uploadArtwork").length, 0); assert.equal(opened.length, 0);
  });
  await check("Staged upload retry stays TEMP and advances CAS without losing unsaved header", async () => {
    const server = mockServer(cannedWorkspace([cannedLine()])); const original = server.client.uploadArtwork; const ids: string[] = [];
    server.client.uploadArtwork = async (organization, id, body) => { ids.push(body.requestId); if (ids.length === 1) throw { code: "RETRYABLE_FAILURE", message: "Upload interrupted" }; return original(organization, id, body); };
    await mount(server); await change("Job Label", "Still local"); await change("Attach to", lineId);
    await act(async () => { const node = field("PDF file") as HTMLInputElement; Object.defineProperty(node, "files", { configurable: true, value: [new dom.window.File(["%PDF-canned"], "source.pdf", { type: "application/pdf" })] }); Simulate.change(node); });
    assert.ok(button("Save Draft").disabled); await click("Upload staged PDF"); assert.match(text(), /Upload interrupted/); await click("Upload staged PDF"); assert.equal(ids[0], ids[1]); await settle(() => text().includes("source.pdf: uploaded")); assert.equal(field("Job Label").value, "Still local"); await click("Save Draft"); assert.equal(server.saved().revision, 6); assert.equal(server.saved().header.jobLabel, "Still local"); assert.equal(server.calls.filter((call) => call.method === "promote").length, 0); await click("Remove source.pdf");
  });
  const existingClaim: WorkspaceArtworkClaim = { id: "claim-existing", workspaceId, workspaceLineId: null, filename: "existing.pdf", contentType: "application/pdf", byteSize: 100, checksumSha256: "canned-existing", state: "uploaded", artworkFileId: null, assignmentId: null };
  await check("Artwork view and assign allow existing claim management without adopt", async () => {
    const server = mockServer(cannedWorkspace([cannedLine()]), [existingClaim]);
    await mount(server, true, { capabilities: { quoteCreate: true, quoteOverridePrice: false, artworkView: true, artworkAssign: true, artworkAdopt: false } });
    await settle(() => text().includes("existing.pdf: uploaded"));
    assert.ok(server.calls.some((call) => call.method === "listArtwork"));
    assert.ok(field("PDF file").matches(":disabled"));
    assert.ok(button("Upload staged PDF").disabled);
    assert.equal(field("Assign existing.pdf").matches(":disabled"), false);
    assert.equal(button("Remove existing.pdf").disabled, false);
    assert.match(text(), /Hard limit: one unlayered PDF per TEMP line/);
    await change("Assign existing.pdf", lineId);
    await settle(() => server.calls.some((call) => call.method === "assignArtwork"));
    const assignment = server.calls.find((call) => call.method === "assignArtwork")?.input as { workspaceId: string; claimId: string; workspaceLineId: string; expectedRevision: number };
    assert.equal(assignment.workspaceId, workspaceId); assert.equal(assignment.claimId, existingClaim.id);
    assert.equal(assignment.workspaceLineId, lineId); assert.equal(assignment.expectedRevision, 4);
    await click("Remove existing.pdf");
    assert.equal(server.calls.filter((call) => call.method === "removeArtwork").length, 1);
    assert.equal(server.calls.filter((call) => call.method === "uploadArtwork").length, 0);
  });
  await check("Artwork adopt and assign without view do not read or upload or block draft work", async () => {
    const server = mockServer(cannedWorkspace([cannedLine()]), [existingClaim]);
    await mount(server, true, { capabilities: { quoteCreate: true, quoteOverridePrice: false, artworkView: false, artworkAssign: true, artworkAdopt: true } });
    assert.equal(server.calls.filter((call) => call.method === "listArtwork").length, 0);
    assert.doesNotMatch(text(), /existing\.pdf/);
    assert.match(text(), /Artwork view permission is required/);
    assert.ok(field("PDF file").matches(":disabled"));
    assert.ok(button("Upload staged PDF").disabled);
    await click("Upload staged PDF");
    assert.equal(server.calls.filter((call) => call.method === "uploadArtwork").length, 0);
    assert.equal(button("Add Item").disabled, false);
    await change("PO #", "Still available"); await click("Save Draft");
    assert.equal(server.saved().header.purchaseOrderNumber, "Still available");
    assert.equal(server.calls.filter((call) => call.method === "listArtwork").length, 0, "Draft invalidation does not fetch forbidden Artwork");
    assert.doesNotMatch(text(), /Staged files could not be loaded/);
    await render({ capabilities: { ...currentProps.capabilities, artworkView: true } });
    await settle(() => text().includes("existing.pdf: uploaded"));
    const reads = server.calls.filter((call) => call.method === "listArtwork").length;
    await render({ capabilities: { ...currentProps.capabilities, artworkView: false } });
    assert.doesNotMatch(text(), /existing\.pdf/, "Revoked view hides already cached claims");
    await change("PO #", "Available after revocation"); await click("Save Draft");
    assert.equal(server.calls.filter((call) => call.method === "listArtwork").length, reads);
  });
  await check("Artwork view and adopt without assign permit only workspace-level uploads", async () => {
    const server = mockServer(cannedWorkspace([cannedLine()]), [existingClaim]);
    await mount(server, true, { capabilities: { quoteCreate: true, quoteOverridePrice: false, artworkView: true, artworkAssign: false, artworkAdopt: true } });
    await settle(() => text().includes("existing.pdf: uploaded"));
    assert.ok(field("Assign existing.pdf").matches(":disabled"));
    assert.ok(button("Remove existing.pdf").disabled);
    assert.ok((field("Attach to").querySelector(`option[value="${lineId}"]`) as HTMLOptionElement).disabled);
    assert.match(text(), /Artwork assign permission is required/);
    await click("Remove existing.pdf");
    await act(async () => { const node = field("PDF file") as HTMLInputElement; Object.defineProperty(node, "files", { configurable: true, value: [new dom.window.File(["%PDF-canned"], "unassigned.pdf", { type: "application/pdf" })] }); Simulate.change(node); });
    assert.equal(button("Upload staged PDF").disabled, false);
    await click("Upload staged PDF");
    const uploaded = server.calls.find((call) => call.method === "uploadArtwork")?.input as { workspaceLineId?: string; filename: string };
    assert.equal(uploaded.workspaceLineId, undefined); assert.equal(uploaded.filename, "unassigned.pdf");
    assert.equal(server.calls.filter((call) => call.method === "assignArtwork" || call.method === "removeArtwork").length, 0);
  });
  await check("Target permissions and session identity remain separate and fail closed", async () => {
    const server = mockServer(cannedWorkspace([cannedLine()])); await mount(server, true, { capabilities: { quoteCreate: false, orderCreate: true, quoteOverridePrice: false, orderOverridePrice: false } }); assert.ok(button("Save Quote").disabled); assert.equal(button("Save Order").disabled, false); await click("Edit item 1"); assert.equal([...document.querySelectorAll("select")].some((node) => node.getAttribute("aria-label") === "Selling price decision"), false); await click("Cancel");
    const before = server.calls.length; await render({ capabilities: { quoteCreate: false, orderCreate: false, quoteOverridePrice: false } }); assert.match(text(), /do not have permission/); assert.equal(server.calls.length, before);
    await render({ userId: "other-user", sessionScope: "new-session", capabilities: { orderCreate: true, quoteOverridePrice: false } }); await settle(() => text().includes("identity did not match")); assert.doesNotMatch(text(), /Canned Banner/); assert.notDeepEqual(salesWorkspaceKeys.workspace("a", org, user, workspaceId), salesWorkspaceKeys.workspace("a", org, "other-user", workspaceId));
  });
  await check("Existing price override requires the selected target's own capability", async () => {
    const server = mockServer(cannedWorkspace([{ ...cannedLine(), input: { ...input, selling: { kind: "unit_override", unitCents: 900, reason: "Negotiated" } } }]));
    await mount(server, true, { capabilities: { quoteCreate: true, orderCreate: true, quoteOverridePrice: false, orderOverridePrice: true } }); assert.ok(button("Save Quote").disabled); assert.equal(button("Save Order").disabled, false); await click("Save Quote"); assert.equal(server.calls.filter((call) => call.method === "promote").length, 0);
  });
  await check("Session replacement during draft save cannot launch promotion", async () => {
    const server = mockServer(cannedWorkspace([cannedLine()])); const original = server.client.saveDraft; let release!: () => void;
    server.client.saveDraft = async (organization, id, body) => { await new Promise<void>((resolve) => { release = resolve; }); return original(organization, id, body); };
    await mount(server); await change("PO #", "Pending"); await act(async () => button("Save Order").click()); await render({ sessionScope: "replaced", userId: "other-user" }); await act(async () => release()); await settle(); assert.equal(server.calls.filter((call) => call.method === "promote").length, 0); assert.equal(opened.length, 0);
  });
  await check("Injected HTTP adapter sends scoped workspace routes and CSRF, never canonical calls", async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const client = createSalesWorkspaceClient({ request: async <T,>(url: string, init?: RequestInit): Promise<T> => { calls.push({ url, init }); return {} as T; }, commandHeaders: () => ({ "x-v2-csrf-token": "test-csrf" }) });
    const mutation = { requestId: "request-a", expectedRevision: 4 };
    await client.create(org, { requestId: "request-create" }); await client.saveDraft(org, workspaceId, { ...mutation, header: {} }); await client.addLine(org, workspaceId, { ...mutation, header: {}, line: input }); await client.updateLine(org, workspaceId, { ...mutation, lineId, line: input }); await client.removeLine(org, workspaceId, { ...mutation, lineId }); await client.reorderLines(org, workspaceId, { ...mutation, lineIds: [lineId] }); await client.refreshLines(org, workspaceId, mutation); await client.promote(org, { ...mutation, workspaceId, target: "order" }); await client.discard(org, workspaceId, mutation); await client.configurationApi(workspaceId).configuration(org, productId);
    assert.ok(calls.every((call) => call.url.startsWith(`/v2/organizations/${org}/sales-workspaces`)));
    assert.ok(calls.filter((call) => call.init?.method).every((call) => (call.init!.headers as Record<string, string>)["x-v2-csrf-token"] === "test-csrf"));
    const update = calls.find((call) => call.init?.method === "PATCH" && call.url.includes("/lines/"))!;
    assert.deepEqual(JSON.parse(String(update.init!.body)), { ...mutation, line: input });
    assert.match(calls.at(-1)!.url, new RegExp(`/${workspaceId}/products/${productId}/configuration$`));
    await client.uploadArtwork(org, workspaceId, { ...mutation, workspaceLineId: lineId, file: new File(["%PDF-canned"], "source.pdf", { type: "application/pdf" }) });
    const upload = calls.at(-1)!; assert.ok(upload.init!.body instanceof FormData); assert.equal(upload.init!.body.get("expectedRevision"), "4"); assert.equal(upload.init!.body.get("workspaceLineId"), lineId); assert.equal(upload.init!.body.get("requestId"), mutation.requestId); assert.equal((upload.init!.headers as Record<string, string>)["content-type"], undefined);
  });
} finally {
  await act(async () => root.unmount()); cache.clear(); globalThis.fetch = originalFetch; dom.window.close();
}
console.log(`Transactional Sales Workspace: ${cases} scenarios passed.`);
