import assert from "node:assert/strict";
import React, { act, StrictMode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { JSDOM } from "jsdom";
import { TransactionalSalesWorkspace, type TransactionalSalesWorkspaceProps } from "./TransactionalSalesWorkspace";
import { createSalesWorkspaceClient, type WorkspaceView } from "./salesWorkspaceApi";
import { workspaceNavigationEvent } from "./workspaceNavigation";
import { SalesWorkspaceApplicationService, validateSalesWorkspaceHeader } from "../../src/modules/sales/workspaceApplication";
import type { SalesWorkspace, SalesWorkspaceStore, SalesWorkspaceTransaction } from "../../src/modules/sales/workspaceContracts";
import type { OperationContext } from "../../src/application/operation";
import type { SalesContactSelectionQuery, SalesContactSelectionResult } from "../../src/modules/customers/salesContactSelection";
import { brandedId } from "../../src/modules/shared/commercialValues";

assert.equal(process.env.V2_VALIDATION_MODE, "deterministic");
const org = "11111111-1111-4111-8111-111111111111", user = "22222222-2222-4222-8222-222222222222", id = "33333333-3333-4333-8333-333333333333";
const customer = "44444444-4444-4444-8444-444444444444", contact = "55555555-5555-4555-8555-555555555555", savedContact = "66666666-6666-4666-8666-666666666666";
const secondId = "77777777-7777-4777-8777-777777777777", secondUser = "88888888-8888-4888-8888-888888888888";
const now = "2026-10-01T00:00:00.000Z";
const choice = (value: string, label: string) => ({ id: brandedId<"ContactId">(value), label });
const defaultLookup = async (query: SalesContactSelectionQuery): Promise<SalesContactSelectionResult> => ({
  items: [choice(contact, "Alex Contact")], selectedContact: query.selectedContactId === savedContact ? choice(savedContact, "Zoe Hydrated") : query.selectedContactId === contact ? choice(contact, "Alex Contact") : null,
});
const initial = (contactOnly = false): SalesWorkspace => ({ id, organizationId: org, creatorUserId: user, kind: "new_sales", state: "draft", revision: 4,
  header: validateSalesWorkspaceHeader({ customerContact: { organizationId: org, ...(contactOnly ? {} : { customerId: customer }), contactId: savedContact }, jobLabel: "Persisted label", purchaseOrderNumber: "PO-hidden", requestedDueDate: "2026-11-01T00:00:00.000Z", requestedFulfillment: { method: "pickup", instructions: "Retain pickup" }, terms: { termsCode: "net_30", commercialNotes: "Retain commercial notes", taxContextReference: "retain-tax-policy", salesRepresentativeId: secondUser }, notes: "TEMP notes" }, org),
  // This fixture renders acknowledged server evidence; it does not calculate a price.
  lines: [{ id: contact, workspaceId: id, position: 0, revision: 1, input: { productId: customer, quantity: 2 }, previews: { quote: { sellingPriceDecision: { resultingLineAmount: { cents: 12345, currency: "USD" } } }, order: { sellingPriceDecision: { resultingLineAmount: { cents: 12345, currency: "USD" } } } } }] as unknown as SalesWorkspace["lines"],
  createdAt: now, updatedAt: now, expiresAt: "2026-10-31T00:00:00.000Z" });

function server(seed = initial()) {
  const workspaces = new Map<string, SalesWorkspace>([[id, structuredClone(seed)], [secondId, { ...structuredClone(initial(true)), id: secondId, creatorUserId: secondUser, header: { customerContact: { organizationId: brandedId<"OrganizationId">(org), contactId: brandedId<"ContactId">(contact) }, jobLabel: "Second identity" }, lines: [] }]]);
  const receipts = new Map<string, unknown>(), calls: { url: string; method: string; body?: unknown; query?: SalesContactSelectionQuery }[] = [];
  const tx = {
    getKind: async (organizationId: string, creator: string, workspaceId: string) => { const row = workspaces.get(workspaceId); return row?.organizationId === organizationId && row.creatorUserId === creator ? row.kind : null; },
    get: async (organizationId: string, creator: string, workspaceId: string) => { const row = workspaces.get(workspaceId); return row?.organizationId === organizationId && row.creatorUserId === creator ? structuredClone(row) : null; },
    getRequest: async (_org: string, workspaceId: string, requestId: string) => receipts.get(`${workspaceId}/${requestId}`) ?? null,
    update: async (next: SalesWorkspace, expectedRevision: number) => { assert.equal(workspaces.get(next.id)!.revision, expectedRevision); workspaces.set(next.id, structuredClone(next)); },
    recordRequest: async (_org: string, workspaceId: string, requestId: string, receipt: unknown) => { receipts.set(`${workspaceId}/${requestId}`, structuredClone(receipt)); },
    invalidatePreviews: async (_org: string, workspaceId: string) => { const row = workspaces.get(workspaceId)!; workspaces.set(workspaceId, { ...row, lines: row.lines.map(line => ({ ...line, previews: undefined, revision: line.revision + 1 })) }); },
  } as unknown as SalesWorkspaceTransaction;
  const store: SalesWorkspaceStore = { run: async work => work(tx), withWorkspace: async () => { throw Error("Unexpected alternate mutation path"); } };
  const service = new SalesWorkspaceApplicationService(store, { now: () => new Date(now) });
  let actor = user, lookup = defaultLookup;
  const operation = (organizationId: string): OperationContext => ({ organizationId, operationId: "mounted-contact-workspace", principal: { kind: "staff", organizationId, userId: actor, authority: { membershipId: "verified", capabilities: ["quote.create", "order.create"] } } });
  const client = createSalesWorkspaceClient({ commandHeaders: () => ({ "x-v2-csrf-token": "test-csrf" }),
    request: async <T,>(url: string, init?: RequestInit): Promise<T> => {
      const parsed = new URL(url, "https://ui.invalid"), parts = parsed.pathname.split("/"), organizationId = parts[3], workspaceId = parts[5], resource = parts[6];
      const method = init?.method ?? "GET", body = init?.body ? JSON.parse(String(init.body)) : undefined;
      calls.push({ url, method, body });
      if (method !== "GET") assert.equal((init?.headers as Record<string, string>)["x-v2-csrf-token"], "test-csrf");
      const context = operation(organizationId);
      let result: unknown;
      if (!resource && method === "GET") result = await service.get(context, workspaceId);
      else if (!resource && method === "PATCH") result = await service.saveDraft(context, workspaceId, body);
      else if (resource === "customers") { await service.get(context, workspaceId); result = [{ customerId: customer, displayName: "Existing Account" }]; }
      else if (resource === "contacts") {
        await service.get(context, workspaceId);
        const query: SalesContactSelectionQuery = { ...(parsed.searchParams.has("customerId") ? { customerId: brandedId<"CustomerId">(parsed.searchParams.get("customerId")!) } : {}), ...(parsed.searchParams.has("selectedContactId") ? { selectedContactId: brandedId<"ContactId">(parsed.searchParams.get("selectedContactId")!) } : {}), ...(parsed.searchParams.has("search") ? { search: parsed.searchParams.get("search")! } : {}), ...(parsed.searchParams.has("limit") ? { limit: Number(parsed.searchParams.get("limit")) } : {}) };
        calls.at(-1)!.query = query; result = await lookup(query);
      } else if (resource === "products" || resource === "artwork") result = [];
      else throw Error(`Unexpected canonical/provider endpoint ${method} ${url}`);
      return structuredClone(result) as T;
    },
  });
  return { client, calls, saved: (workspaceId = id) => structuredClone(workspaces.get(workspaceId)!),
    setActor(value: string) { actor = value; }, setLookup(value: typeof defaultLookup) { lookup = value; } };
}

const dom = new JSDOM("<!doctype html><html><body><div id='root'></div></body></html>", { url: "https://ui.invalid/sales/new" });
Object.assign(globalThis, { window: dom.window, document: dom.window.document, navigator: dom.window.navigator, HTMLElement: dom.window.HTMLElement, Event: dom.window.Event, IS_REACT_ACT_ENVIRONMENT: true });
const { createRoot } = await import("react-dom/client"), { Simulate } = await import("react-dom/test-utils");
const originalFetch = globalThis.fetch; globalThis.fetch = async () => { throw Error("Unexpected external transport"); };
let root = createRoot(document.getElementById("root")!), cache = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } }), props: TransactionalSalesWorkspaceProps;
const text = () => document.body.textContent ?? "";
const field = (label: string) => { const result = document.querySelector<HTMLInputElement | HTMLSelectElement>(`[aria-label="${label}"]`); assert.ok(result, label); return result; };
const settle = async (predicate: () => boolean = () => true) => { for (let attempt = 0; attempt < 100; attempt++) { await act(async () => { await new Promise(resolve => setTimeout(resolve, 5)); }); if (predicate()) return; } assert.ok(predicate(), "UI settled"); };
const change = async (label: string, value: string) => { await act(async () => { const control = field(label); control.value = value; Simulate.change(control); }); await settle(); };
const render = async (patch: Partial<TransactionalSalesWorkspaceProps> = {}) => { props = { ...props, ...patch }; await act(async () => root.render(<StrictMode><QueryClientProvider client={cache}><TransactionalSalesWorkspace {...props} /></QueryClientProvider></StrictMode>)); await settle(); };
const mount = async (fixture: ReturnType<typeof server>) => { await act(async () => root.unmount()); cache.clear(); root = createRoot(document.getElementById("root")!); cache = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  props = { organizationId: org, userId: user, sessionScope: "session-a", workspaceId: id, client: fixture.client, csrfReady: true, capabilities: { quoteCreate: true, orderCreate: true, quoteOverridePrice: false }, openCanonical: () => { throw Error("No canonical action in draft integration"); } }; await render(); await settle(() => Boolean(document.querySelector('[aria-label="Contact"]'))); };
const save = async () => { const button = [...document.querySelectorAll("button")].find(node => node.textContent === "Save Draft"); assert.ok(button); await act(async () => button.click()); await settle(() => text().includes("Draft saved")); };
let cases = 0;
const check = async (name: string, work: () => Promise<void>) => { await work(); cases++; console.log(`PASS ${name}`); };
try {
  await check("mounted workspace mode change replaces the whole reference, invalidates previews and persists/reloads all hidden header fields", async () => {
    const fixture = server(), before = fixture.saved().header; await mount(fixture); await settle(() => text().includes("Zoe Hydrated"));
    assert.match(text(), /\$123\.45/); assert.equal(window.dispatchEvent(new window.Event(workspaceNavigationEvent, { cancelable: true })), true);
    await change("Customer / Contact mode", "contact_only");
    assert.equal(document.querySelector('[aria-label="Customer"]'), null); assert.doesNotMatch(text(), /\$123\.45/);
    await act(async () => { assert.equal(window.dispatchEvent(new window.Event(workspaceNavigationEvent, { cancelable: true })), false, "dirty identity retains navigation guard"); });
    await save();
    const header = fixture.saved().header; assert.deepEqual(header, { ...before, customerContact: { organizationId: org, contactId: savedContact } });
    assert.equal(Object.hasOwn(header.customerContact!, "customerId"), false); assert.equal(fixture.saved().lines[0].previews, undefined);
    assert.equal(fixture.calls.filter(call => call.method === "PATCH").length, 1); assert.ok(!fixture.calls.some(call => call.url.includes("/promote")));
    await mount(fixture); await settle(() => text().includes("Zoe Hydrated")); assert.equal(field("Customer / Contact mode").value, "contact_only"); assert.equal(field("Contact").value, savedContact);
    assert.match(text(), /Payment allocation across accountless Invoices remains unsupported/);
  });
  await check("real workspace client sends selected hydration separately and contact-only search never sends a Customer", async () => {
    const fixture = server(initial(true)); await mount(fixture); await settle(() => text().includes("Zoe Hydrated"));
    assert.equal(field("Contact").value, savedContact); assert.ok(!fixture.calls.some(call => call.query?.customerId));
    await change("Search Contacts", "Alex %_"); await settle(() => fixture.calls.some(call => call.query?.search === "Alex %_"));
    const request = fixture.calls.filter(call => call.query?.search === "Alex %_").at(-1)!; assert.equal(request.query?.selectedContactId, savedContact);
    assert.equal(new URL(request.url, "https://ui.invalid").searchParams.get("search"), "Alex %_"); assert.equal(Object.hasOwn(request.query!, "customerId"), false);
  });
  await check("Contact-only clear/save never restores the previous account or performs canonical creation", async () => {
    const fixture = server(initial(true)); await mount(fixture); await settle(() => text().includes("Zoe Hydrated"));
    await change("Contact", ""); await save(); assert.equal(fixture.saved().header.customerContact, undefined);
    assert.equal(fixture.calls.filter(call => call.method === "POST").length, 0);
    assert.equal(field("Customer / Contact mode").value, "contact_only", "clearing a Contact does not require an account");
  });
  await check("late search responses cannot restore a prior reference or stale choices in the real workspace", async () => {
    const fixture = server(initial(true)), pending: { query: SalesContactSelectionQuery; resolve: (value: SalesContactSelectionResult) => void }[] = [];
    fixture.setLookup(query => new Promise(resolve => pending.push({ query, resolve }))); await mount(fixture);
    await change("Search Contacts", "old"); const old = pending.at(-1)!; await change("Search Contacts", "new"); const latest = pending.at(-1)!;
    await act(async () => latest.resolve({ items: [choice(contact, "Current choice")], selectedContact: choice(savedContact, "Current saved") }));
    await act(async () => old.resolve({ items: [choice(customer, "Private old choice")], selectedContact: choice(savedContact, "Private old saved") }));
    await settle(); assert.doesNotMatch(text(), /Private old/); assert.equal(field("Contact").value, savedContact);
    assert.equal(fixture.calls.filter(call => call.method === "PATCH").length, 0); assert.equal(Object.hasOwn(fixture.saved().header.customerContact!, "customerId"), false);
  });
  await check("org/user/session/workspace scope replacement discards old lookups without restoring old identity", async () => {
    const fixture = server(initial(true)), pending: { query: SalesContactSelectionQuery; resolve: (value: SalesContactSelectionResult) => void }[] = [];
    fixture.setLookup(query => new Promise(resolve => pending.push({ query, resolve }))); await mount(fixture); const old = [...pending];
    fixture.setActor(secondUser); await render({ userId: secondUser, sessionScope: "session-b", workspaceId: secondId }); await settle(() => text().includes("Second identity"));
    const current = pending.at(-1)!; await act(async () => current.resolve({ items: [choice(contact, "Second scope choice")], selectedContact: choice(contact, "Second scope choice") }));
    await act(async () => old.forEach(call => call.resolve({ items: [choice(savedContact, "Private old identity")], selectedContact: choice(savedContact, "Private old identity") })));
    await settle(); assert.doesNotMatch(text(), /Private old identity|Zoe Hydrated/); assert.equal(field("Contact").value, contact);
    assert.equal(fixture.calls.filter(call => call.method === "PATCH").length, 0); assert.equal(fixture.saved().header.customerContact?.contactId, savedContact);
    const fresh = fixture.calls.filter(call => call.query?.selectedContactId === contact).at(-1)!; assert.ok(fresh.url.includes(secondId));
  });
  console.log(`Mounted contact-only workspace integration: ${cases} cases passed. Draft mutations use the actual Sales application; HTTP/SQL promotion is covered by contactOnlyWorkspaceRoutes.`);
} finally { await act(async () => root.unmount()); cache.clear(); globalThis.fetch = originalFetch; dom.window.close(); }
