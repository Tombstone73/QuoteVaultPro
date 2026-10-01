import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { JSDOM } from "jsdom";
import type { UiBootstrap } from "./api";

// Mount the actual App, with one React/query module graph. Only CSS evaluation
// is omitted; all Quote HTTP, authorization, application and CRM reads are real.
const require = createRequire(import.meta.url);
const previousCss = require.extensions[".css"];
require.extensions[".css"] = () => {};
const React: typeof import("react") = require("react");
const { act } = React;
const { QueryClient, QueryClientProvider }: typeof import("@tanstack/react-query") = require("@tanstack/react-query");
const { quoteContactFixture }: typeof import("../../tests/interfaces/quoteContactSelection.test") = require("../../tests/interfaces/quoteContactSelection.test");
const request: typeof import("supertest") = require("supertest");
const f = await quoteContactFixture();
const dom = new JSDOM("<!doctype html><html><body><div id='root'></div></body></html>", { url: "https://ui.invalid/quotes" });
Object.assign(globalThis, { React, window: dom.window, document: dom.window.document, navigator: dom.window.navigator, sessionStorage: dom.window.sessionStorage, HTMLElement: dom.window.HTMLElement, Event: dom.window.Event, PopStateEvent: dom.window.PopStateEvent, IS_REACT_ACT_ENVIRONMENT: true });
const { createRoot }: typeof import("react-dom/client") = require("react-dom/client");
const { Simulate }: typeof import("react-dom/test-utils") = require("react-dom/test-utils");
const { App }: typeof import("./App") = require("./App");
const { defaultVisualAppearance }: typeof import("./appearance") = require("./appearance");
const { clearV2ApiSessionState }: typeof import("./api") = require("./api");
const originalQuote = structuredClone(f.quote);
const originalPrincipal = f.principal;
let bootstrap: UiBootstrap = { organizationId: f.org, userId: "staff", sessionScope: "quote-contact-session", csrfToken: "fixture-csrf", capabilities: { quoteView: true, quoteEdit: true, quoteCreate: false, quoteSend: false, quoteConvert: false, quoteOverridePrice: false } };
const calls: { path: string; method: string; body?: { patch: { customerContact: unknown } } }[] = [];
let selectionGate: (() => Promise<void>) | undefined;
let selectionFailure = false;
const originalFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = new URL(String(input), window.location.origin), path = url.pathname, method = init?.method ?? "GET";
  const body = init?.body ? JSON.parse(String(init.body)) : undefined;
  calls.push({ path, method, body });
  let status = 200, result: unknown;
  if (path.endsWith("/ui-bootstrap")) result = { ok: true, data: bootstrap };
  else if (path.endsWith("/artwork") || path.endsWith("/history") || path.endsWith("/workflow/actions")) result = { ok: true, data: [] };
  else if (path.startsWith(`/v2/organizations/${f.org}/quotes/`)) {
    const response = method === "PATCH" ? await request(f.app).patch(path).send(body) : await request(f.app).get(path + url.search);
    if (path.endsWith("/contact-selection")) {
      // Delay an already-resolved old reference, not the new Customer's request.
      if (selectionGate) await selectionGate();
      if (selectionFailure) return new Response(JSON.stringify({ ok: false, error: { code: "FORBIDDEN", message: "Unavailable" } }), { status: 403 });
    }
    result = response.body; status = response.status;
  } else throw Error(`Unexpected actual App request ${method} ${path}`);
  return new Response(JSON.stringify(result), { status, headers: { "content-type": "application/json" } });
};
let cache = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
let root = createRoot(document.getElementById("root")!);
const text = () => document.body.textContent ?? "";
const assertSelectionScope = () => assert.ok(cache.getQueryCache().getAll().some(query => JSON.stringify(query.queryKey) === JSON.stringify([
  "v2", bootstrap.sessionScope, f.org, "quote-contact-selection", f.quoteId, f.quote.revision, f.org, f.quote.quote.customerContact.customerId ?? "", f.quote.quote.customerContact.contactId ?? "",
])), "saved selection query includes session, organization, Quote, revision and complete canonical reference");
const field = (label: string) => { const node = document.querySelector(`[aria-label="${label}"]`); assert.ok(node, `${label} field exists`); return node as HTMLInputElement | HTMLSelectElement; };
const contact = () => field("Contact") as HTMLSelectElement;
const settle = async (predicate: () => boolean) => {
  for (let index = 0; index < 150; index++) { await act(async () => { await new Promise(resolve => setTimeout(resolve, 5)); }); if (predicate()) return; }
  assert.ok(predicate(), `App settled: ${text()}\n${JSON.stringify(calls)}`);
};
const mount = async () => {
  await act(async () => root.unmount()); cache.clear(); clearV2ApiSessionState(); calls.length = 0;
  sessionStorage.clear(); sessionStorage.setItem("ph.v2.organization-id", f.org);
  window.history.replaceState({}, "", `/quotes/${f.quoteId}`);
  cache = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } }); root = createRoot(document.getElementById("root")!);
  await act(async () => root.render(<QueryClientProvider client={cache}><App appearance={defaultVisualAppearance} setAppearance={() => {}} /></QueryClientProvider>));
  await settle(() => text().includes("QT1001"));
};
const change = async (label: string, value: string) => { await act(async () => { const node = field(label); node.value = value; Simulate.change(node); }); };
const save = async () => { const button = [...document.querySelectorAll("button")].find(node => node.textContent === "Save"); assert.ok(button); await act(async () => button.click()); await settle(() => text().includes("Quote saved.")); };
let cases = 0;
const check = async (name: string, work: () => Promise<void>) => { await work(); cases++; console.log(`PASS ${name}`); };
try {
  await check("actual Quote direct reload initializes and displays persisted Contact without a Customer", async () => {
    await mount();
    await settle(() => contact().selectedOptions[0]?.textContent === "Zoe Saved");
    assert.equal(contact().value, f.contactId); assert.equal(contact().disabled, true, "display repair does not enable Contact changing without Customer");
    assert.equal(field("Customer").value, "");
    assertSelectionScope();
    assert.equal([...document.querySelectorAll("button")].find(node => node.textContent === "Open Customer")?.disabled, true);
    assert.ok(calls.some(call => call.path.endsWith(`/${f.quoteId}/contact-selection`)));
    assert.ok(!calls.some(call => /\/form\/customers\/[^/]+\/contacts|\/organizations\/[^/]+\/contacts\//.test(call.path)));
    await mount(); await settle(() => contact().selectedOptions[0]?.textContent === "Zoe Saved");
    assert.equal(contact().value, f.contactId);
  });
  await check("unrelated Save from mounted Quote reaches actual owner and reload preserves Contact with absent Customer", async () => {
    const before = (await f.db.query("SELECT * FROM customers ORDER BY id")).rows;
    await change("PO #", "PO-MOUNTED"); await save();
    const patch = calls.find(call => call.method === "PATCH")!.body!;
    assert.deepEqual(patch.patch.customerContact, { organizationId: f.org, contactId: f.contactId });
    assert.deepEqual(f.quote.quote.customerContact, patch.patch.customerContact);
    assert.equal(f.quote.quote.purchaseOrderNumber, "PO-MOUNTED");
    await settle(() => cache.isFetching() === 0); assertSelectionScope();
    await mount(); await settle(() => contact().selectedOptions[0]?.textContent === "Zoe Saved");
    assert.equal(field("PO #").value, "PO-MOUNTED");
    assert.deepEqual((await f.db.query("SELECT * FROM customers ORDER BY id")).rows, before);
  });
  await check("view-only and converted read-only canonical Quote both display saved Contact", async () => {
    bootstrap = { ...bootstrap, capabilities: { ...bootstrap.capabilities, quoteEdit: false } };
    f.principal = { kind: "staff", organizationId: f.org, userId: "staff", authority: { membershipId: "viewer", capabilities: ["quote.view"] } };
    await mount(); await settle(() => contact().selectedOptions[0]?.textContent === "Zoe Saved"); assert.equal(contact().disabled, true);
    f.quote = { ...f.quote, quote: { ...f.quote.quote, convertedOrderId: "converted-order" as never } };
    await mount(); await settle(() => text().includes("Zoe Saved")); assert.equal(document.querySelector('[aria-label="Contact"]'), null);
    f.quote = structuredClone(originalQuote); f.principal = originalPrincipal; bootstrap = { ...bootstrap, capabilities: { ...bootstrap.capabilities, quoteEdit: true } };
  });
  await check("a new authenticated session receives its own persisted Contact query", async () => {
    bootstrap = { ...bootstrap, sessionScope: "quote-contact-next-session" };
    await mount(); await settle(() => contact().selectedOptions[0]?.textContent === "Zoe Saved"); assertSelectionScope();
  });
  await check("a null Customer from canonical transport does not disable selected Contact hydration", async () => {
    f.quote = { ...f.quote, quote: { ...f.quote.quote, customerContact: { ...f.quote.quote.customerContact, customerId: null as never } } };
    await mount(); await settle(() => contact().selectedOptions[0]?.textContent === "Zoe Saved");
    assert.equal(field("Customer").value, ""); assert.equal(contact().value, f.contactId); assertSelectionScope();
    f.quote = structuredClone(originalQuote);
  });
  await check("Customer-linked opened edit retains filter and explicit Customer change clears selected Contact", async () => {
    f.quote = { ...f.quote, quote: { ...f.quote.quote, customerContact: { ...f.quote.quote.customerContact, customerId: f.customerId } } };
    await mount(); await settle(() => contact().selectedOptions[0]?.textContent === "Zoe Saved");
    assert.equal(contact().disabled, false); assert.equal(field("Customer").value, f.customerId);
    await change("Customer", f.otherCustomerId);
    await settle(() => calls.some(call => call.path.endsWith(`/customers/${f.otherCustomerId}/contacts`)));
    assert.equal(contact().value, ""); assert.ok(![...contact().options].some(option => option.value === f.contactId));
  });
  await check("late old selected lookup cannot add previous Customer Contact after explicit change", async () => {
    let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; }); selectionGate = () => gate;
    await mount(); await settle(() => calls.some(call => call.path.endsWith("/contact-selection")));
    await settle(() => [...(field("Customer") as HTMLSelectElement).options].some(option => option.value === f.otherCustomerId));
    await change("Customer", f.otherCustomerId); await act(async () => { release(); await gate; }); selectionGate = undefined;
    await settle(() => cache.isFetching() === 0);
    assert.equal(contact().value, ""); assert.ok(![...contact().options].some(option => option.value === f.contactId));
    assert.equal(field("Customer").value, f.otherCustomerId);
  });
  await check("loading missing inactive foreign and inaccessible references retain explicit saved identity without remap", async () => {
    f.quote = structuredClone(originalQuote);
    let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; }); selectionGate = () => gate;
    await mount(); await settle(() => contact().selectedOptions[0]?.textContent?.includes("Loading") === true);
    assert.equal(contact().value, f.contactId); assert.ok(contact().selectedOptions[0]?.textContent?.includes(f.contactId));
    await act(async () => { release(); await gate; }); selectionGate = undefined;
    await settle(() => contact().selectedOptions[0]?.textContent === "Zoe Saved");
    for (const condition of ["missing", "inactive", "foreign", "inaccessible"] as const) {
      f.quote = structuredClone(originalQuote);
      if (condition === "missing") f.quote = { ...f.quote, quote: { ...f.quote.quote, customerContact: { organizationId: f.org, contactId: "missing-saved-id" as never } } };
      if (condition === "inactive") await f.db.query("UPDATE customer_contacts SET status='archived' WHERE id=$1", [f.contactId]);
      if (condition === "foreign") f.quote = { ...f.quote, quote: { ...f.quote.quote, customerContact: { organizationId: f.org, contactId: f.foreignContactId } } };
      selectionFailure = condition === "inaccessible";
      await mount(); await settle(() => contact().selectedOptions[0]?.textContent?.includes("unavailable") === true);
      const savedId = f.quote.quote.customerContact.contactId!;
      assert.equal(contact().value, savedId); assert.ok(contact().selectedOptions[0]?.textContent?.includes(savedId));
      assert.equal(field("Customer").value, ""); assert.ok(!calls.some(call => call.method !== "GET"));
      await f.db.query("UPDATE customer_contacts SET status='active' WHERE id=$1", [f.contactId]); selectionFailure = false;
    }
  });
  console.log(`Mounted canonical Quote contact selection: ${cases} cases passed (actual App -> HTTP route -> Quote owner -> Customers PGlite).`);
} finally {
  await act(async () => root.unmount()); cache.clear(); clearV2ApiSessionState(); globalThis.fetch = originalFetch;
  if (previousCss) require.extensions[".css"] = previousCss; else delete require.extensions[".css"];
  dom.window.close(); await f.db.close();
}
