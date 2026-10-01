import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import React, { act, StrictMode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { JSDOM } from "jsdom";
import { PersistedSalesEntry } from "./PersistedSalesEntry";
import { clearV2ApiSessionState, type ProductConfiguration, type UiBootstrap } from "./api";
import { salesWorkspaceKeys, type WorkspaceHeader, type WorkspaceLineInput, type WorkspacePromotionView, type WorkspaceView } from "./salesWorkspaceApi";

const organizationId = "11111111-1111-4111-8111-111111111111";
const userId = "22222222-2222-4222-8222-222222222222";
const workspaceId = "33333333-3333-4333-8333-333333333333";
const productId = "44444444-4444-4444-8444-444444444444";
const customerId = "55555555-5555-4555-8555-555555555555";
const contactId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const lineId = "66666666-6666-4666-8666-666666666666";
const otherUserId = "77777777-7777-4777-8777-777777777777";
const sessionScope = "verified-workspace-session";
const base = `/v2/organizations/${organizationId}/sales-workspaces`;
const now = new Date().toISOString();
const lineInput: WorkspaceLineInput = { productId, description: "Saved sign", quantity: 2, selections: { finish: "matte" } };
const savedWorkspace = (): WorkspaceView => ({
  id: workspaceId, organizationId, creatorUserId: userId, kind: "new_sales", state: "draft", revision: 3,
  header: { jobLabel: "Saved entry", customerContact: { organizationId, customerId } },
  lines: [{ id: lineId, workspaceId, position: 0, revision: 1, input: lineInput }],
  createdAt: now, updatedAt: now, expiresAt: new Date(Date.now() + 86400000).toISOString(),
});
const configuration: ProductConfiguration = { productId, displayName: "Sign", measurementMode: "quantity_only", requiresDimensions: false,
  supportedDimensionUnits: ["in"], effectiveSelections: { finish: "matte" },
  fields: [{ selectionKey: "finish", label: "Finish", inputType: "select", required: true,
    choices: [{ value: "matte", label: "Matte" }, { value: "gloss", label: "Gloss" }] }] };
const copy = <T,>(value: T): T => structuredClone(value);
const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
};

/** Only the wire is mocked: bootstrap, adapter, request headers and UI are production code. */
function server(initial?: WorkspaceView, capabilities: UiBootstrap["capabilities"] = { quoteView: false, quoteCreate: false, quoteOverridePrice: false, orderCreate: true }) {
  const state = {
    saved: initial && copy(initial), actor: userId as string | undefined, csrfToken: "csrf-user-a", capabilities,
    bootstrapDenied: false, promotionDenied: false,
    saveGate: undefined as ReturnType<typeof deferred> | undefined,
    promotionGate: undefined as ReturnType<typeof deferred> | undefined,
  };
  const calls: { method: string; url: URL; headers: Headers; body: unknown; actor: string | undefined }[] = [];
  const canonical: { documentId: string; target: "quote" | "order" }[] = [];
  const unexpected: string[] = [];
  const ok = (data: unknown) => new Response(JSON.stringify({ ok: true, data }), { status: 200,
    headers: { "content-type": "application/json", "x-v2-session-scope": sessionScope } });
  const forbidden = (message: string) => new Response(JSON.stringify({ ok: false, error: { code: "FORBIDDEN", message } }), { status: 403,
    headers: { "content-type": "application/json", "x-v2-session-scope": sessionScope } });
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const rawUrl = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const url = new URL(rawUrl, window.location.origin);
    assert.equal(url.origin, window.location.origin, "Every call remains same-origin");
    assert.equal(init?.credentials, "include");
    assert.equal(init?.cache, "no-store");
    const headers = new Headers(init?.headers);
    const multipart = init?.body instanceof FormData;
    assert.equal(headers.get("content-type"), multipart ? null : "application/json");
    const body = multipart ? init!.body as FormData : typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
    const method = init?.method ?? "GET";
    calls.push({ method, url, headers, body, actor: state.actor });
    if (url.pathname === `/v2/organizations/${organizationId}/ui-bootstrap` && method === "GET") {
      return state.bootstrapDenied ? forbidden("Bootstrap denied") : ok({ organizationId, userId: state.actor, sessionScope, csrfToken: state.csrfToken, capabilities: state.capabilities } satisfies UiBootstrap);
    }
    if (method !== "GET") assert.equal(headers.get("x-v2-csrf-token"), state.csrfToken, "The freshly bootstrapped CSRF token survives transport composition");
    if (url.pathname === base && method === "GET") return ok(state.saved && state.saved.creatorUserId === state.actor ? [state.saved] : []);
    if (url.pathname === base && method === "POST") {
      assert.equal(body.kind, "new_sales");
      assert.ok(body.requestId);
      state.saved = { ...savedWorkspace(), creatorUserId: state.actor!, header: body.header, lines: [], revision: 1 };
      return ok(state.saved);
    }
    const segments = url.pathname.slice(base.length).split("/").filter(Boolean);
    if (!url.pathname.startsWith(`${base}/`) || segments[0] !== workspaceId) {
      unexpected.push(`${method} ${url.pathname}`);
      throw new Error(`Unexpected endpoint: ${method} ${url.pathname}`);
    }
    if (!state.saved || state.saved.creatorUserId !== state.actor) return forbidden("Workspace belongs to another creator.");
    if (segments.length === 1 && method === "GET") return ok(state.saved);
    if (segments.length === 1 && method === "PATCH") {
      assert.equal(body.expectedRevision, state.saved.revision);
      assert.ok(body.requestId);
      await state.saveGate?.promise;
      state.saved = { ...state.saved, header: body.header as WorkspaceHeader, revision: state.saved.revision + 1 };
      return ok(state.saved);
    }
    if (segments[1] === "customers" && method === "GET") return ok([{ customerId, displayName: "Customer" }]);
    if (segments[1] === "contacts" && method === "GET") {
      const rows = [{ organizationId, linkedCustomerId: customerId, id: contactId, label: "Saved Customer contact" }];
      const eligible = rows.filter(row => row.organizationId === state.saved!.organizationId && (!url.searchParams.has("customerId") || row.linkedCustomerId === url.searchParams.get("customerId")));
      const choices = eligible.map(({ id, label }) => ({ id, label }));
      return ok({ items: choices.filter(row => row.label.toLowerCase().includes(url.searchParams.get("search")?.trim().toLowerCase() ?? "")).slice(0, Number(url.searchParams.get("limit") ?? 25)),
        selectedContact: choices.find(row => row.id === url.searchParams.get("selectedContactId")) ?? null });
    }
    if (segments[1] === "products") {
      if (segments.length === 2 && method === "GET") return ok([{ productId, displayName: "Sign" }]);
      assert.equal(segments[2], productId);
      if (segments[3] === "configuration" && method === "GET") return ok(configuration);
      if (segments[3] === "resolve" && method === "POST") return ok({ ...configuration, effectiveSelections: body.selections });
      if (segments[3] === "preview" && method === "POST") return ok({ calculatedUnitAmount: { cents: 150, currency: "USD" },
        calculatedLineAmount: { cents: 300, currency: "USD" }, currency: "USD", explanation: { optionImpacts: [], minimumChargeApplied: false } });
    }
    if (segments[1] === "lines" && segments.length === 2 && method === "POST") {
      assert.equal(body.expectedRevision, state.saved.revision);
      state.saved = { ...state.saved, header: body.header, revision: state.saved.revision + 1,
        lines: [...state.saved.lines, { id: lineId, workspaceId, position: state.saved.lines.length, revision: 1, input: body.line }] };
      return ok(state.saved);
    }
    if (segments[1] === "artwork" && method === "GET") return ok([]);
    if (segments[1] === "artwork" && method === "POST") {
      assert.ok(body instanceof FormData);
      assert.deepEqual([...body.keys()].sort(), ["expectedRevision", "file", "requestId", "workspaceLineId"]);
      assert.equal(body.get("expectedRevision"), String(state.saved.revision));
      assert.equal(body.get("workspaceLineId"), lineId);
      const file = body.get("file");
      assert.ok(file instanceof File);
      assert.equal(file.name, "staged.pdf");
      assert.equal(file.size, 12);
      assert.ok(body.get("requestId"));
      state.saved = { ...state.saved, revision: state.saved.revision + 1 };
      return ok({ claim: { id: randomUUID(), workspaceId, workspaceLineId: lineId, filename: file.name, contentType: "application/pdf",
        byteSize: file.size, checksumSha256: "fixture-checksum", state: "uploaded", artworkFileId: null, assignmentId: null }, workspaceRevision: state.saved.revision });
    }
    if (segments[1] === "promote" && method === "POST") {
      assert.equal(body.expectedRevision, state.saved.revision);
      assert.ok(body.requestId);
      assert.ok(body.target === "quote" || body.target === "order");
      await state.promotionGate?.promise;
      if (state.promotionDenied) return forbidden("Promotion capability was revoked.");
      // No canonical result exists until the explicit promotion request arrives.
      const documentId = randomUUID();
      canonical.push({ documentId, target: body.target });
      const receipt: WorkspacePromotionView["receipt"] = { workspaceId, organizationId, requestId: body.requestId,
        inputRevision: body.expectedRevision, fingerprint: "server-receipt", target: body.target, documentId, documentRevision: "1",
        header: copy(state.saved.header), lineMap: state.saved.lines.map((line) => ({ workspaceLineId: line.id, canonicalLineId: randomUUID(), position: line.position })),
        promotedAt: now, result: {}, artworkPromoted: false };
      state.saved = { ...state.saved, state: "promoted", revision: state.saved.revision + 1, promotion: receipt };
      return ok({ receipt, replayed: false, promotedWorkspaceHeader: receipt.header } satisfies WorkspacePromotionView);
    }
    unexpected.push(`${method} ${url.pathname}`);
    throw new Error(`Unexpected endpoint: ${method} ${url.pathname}`);
  };
  return { state, calls, canonical, unexpected, fetch };
}

const dom = new JSDOM("<!doctype html><html><body><div id='root'></div></body></html>", { url: "https://ui.invalid/quotes/new" });
const globals = { window: dom.window, document: dom.window.document, navigator: dom.window.navigator,
  HTMLElement: dom.window.HTMLElement, Event: dom.window.Event, PopStateEvent: dom.window.PopStateEvent,
  FormData: dom.window.FormData, File: dom.window.File, Blob: dom.window.Blob, IS_REACT_ACT_ENVIRONMENT: true };
const previous = new Map(Object.keys(globals).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
const originalFetch = globalThis.fetch;
const { createRoot } = await import("react-dom/client");
const { Simulate } = await import("react-dom/test-utils");
let root = createRoot(document.getElementById("root")!);
const newCache = () => new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity, staleTime: Infinity }, mutations: { retry: false } } });
let cache = newCache();
let activeServer: ReturnType<typeof server>;
let exits = 0;
let navigations: string[] = [];
const navigation = () => { navigations.push(window.location.pathname); };
window.addEventListener("popstate", navigation);
const text = () => document.body.textContent ?? "";
const findButton = (label: string) => [...document.querySelectorAll("button")].find((node) => node.textContent === label);
const button = (label: string) => { const node = findButton(label); assert.ok(node, `${label} exists`); return node; };
const field = (label: string) => {
  const node = [...document.querySelectorAll("label")].find((item) => item.textContent?.trim().startsWith(label))?.querySelector("input,select,textarea");
  assert.ok(node, `${label} exists`);
  return node as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
};
const settle = async (predicate: () => boolean = () => true) => {
  for (let attempt = 0; attempt < 150; attempt++) {
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 5)); });
    if (predicate()) return;
  }
  assert.ok(predicate(), `UI did not settle: ${text()}`);
};
const click = async (label: string) => { await act(async () => button(label).click()); await settle(); };
const change = async (label: string, value: string) => { await act(async () => { const control = field(label); control.value = value; Simulate.change(control); }); await settle(); };
const render = async () => {
  await act(async () => root.render(<StrictMode><QueryClientProvider client={cache}>
    <PersistedSalesEntry organizationId={organizationId} sessionScope={sessionScope} onBack={() => { exits++; }} />
  </QueryClientProvider></StrictMode>));
  await settle();
};
const mount = async (mock: ReturnType<typeof server>, resume = true) => {
  await act(async () => root.unmount()); cache.clear(); clearV2ApiSessionState();
  root = createRoot(document.getElementById("root")!); cache = newCache(); activeServer = mock;
  globalThis.fetch = mock.fetch; exits = 0; navigations = [];
  window.history.replaceState({}, "", `/quotes/new${resume ? `?workspaceId=${workspaceId}` : ""}`);
  await render();
  await settle(() => text().includes(resume ? "Draft revision" : "Resume Draft") || Boolean(document.querySelector('[role="alert"]')) || text().includes("verified staff session is required"));
};
const callsTo = (mock: ReturnType<typeof server>, method: string, path: string) => mock.calls.filter((call) => call.method === method && call.url.pathname === path);
let scenarios = 0;
const scenario = async (name: string, work: () => Promise<void>) => {
  await work(); assert.deepEqual(activeServer.unexpected, []); scenarios++; console.log(`PASS ${name}`);
};

try {
  await scenario("fresh order-only bootstrap enables neutral TEMP creation and real configuration transport, never an early Quote write", async () => {
    const mock = server(); await mount(mock, false);
    assert.equal(callsTo(mock, "GET", `/v2/organizations/${organizationId}/ui-bootstrap`).length, 1);
    assert.deepEqual(cache.getQueryData<UiBootstrap>(["v2", sessionScope, organizationId, "ui-bootstrap"])?.capabilities, mock.state.capabilities);
    assert.equal(mock.calls.filter((call) => call.method !== "GET").length, 0);
    assert.doesNotMatch(text(), /Save Quote|Save Order|New Quote|New Order/);
    assert.ok(findButton("Back to list"));
    await click("New Sales Entry"); await settle(() => text().includes("Draft revision 1"));
    assert.equal(new URLSearchParams(window.location.search).get("workspaceId"), workspaceId);
    assert.equal(findButton("Back to list"), undefined, "The wrapper tracks the child's new active workspace");
    assert.ok(button("Save Quote").disabled); assert.equal(button("Save Order").disabled, false);
    await click("Add Item"); await change("Product", productId);
    await settle(() => text().includes("Finish")); await change("Finish", "gloss");
    await settle(() => callsTo(mock, "POST", `${base}/${workspaceId}/products/${productId}/preview`).length > 0);
    assert.equal(callsTo(mock, "GET", `${base}/${workspaceId}/products/${productId}/configuration`).length, 1);
    assert.ok(callsTo(mock, "POST", `${base}/${workspaceId}/products/${productId}/resolve`).length > 0);
    assert.equal(mock.calls.some((call) => /\/quotes\/form\//.test(call.url.pathname)), false);
    assert.equal(callsTo(mock, "POST", `${base}/${workspaceId}/lines`).length, 0, "Editor changes are local");
    assert.equal(mock.canonical.length, 0);
    await click("Store line"); await settle(() => mock.state.saved?.lines.length === 1 && !findButton("Store line"));
    assert.equal(mock.state.saved?.lines[0]?.input.selections?.finish, "gloss");
    assert.equal(mock.canonical.length, 0, "Store line writes only the TEMP route");
  });

  await scenario("dirty header and pending Save Draft cannot escape; reload reads the same workspace", async () => {
    const mock = server(savedWorkspace()); await mount(mock);
    await change("Job Label", "Unsaved local label");
    assert.equal(findButton("Back to list"), undefined); assert.ok(button("Back to drafts").disabled);
    await click("Back to drafts");
    assert.equal(exits, 0); assert.equal(field("Job Label").value, "Unsaved local label");
    assert.equal(callsTo(mock, "PATCH", `${base}/${workspaceId}`).length, 0);
    mock.state.saveGate = deferred(); await click("Save Draft");
    assert.ok(button("Back to drafts").disabled); assert.equal(findButton("Back to list"), undefined);
    assert.equal(mock.state.saved?.header.jobLabel, "Saved entry");
    await click("Back to drafts"); assert.equal(exits, 0);
    await act(async () => mock.state.saveGate!.resolve()); await settle(() => text().includes("Draft saved."));
    assert.equal(mock.state.saved?.header.jobLabel, "Unsaved local label"); assert.equal(mock.canonical.length, 0);
    const reads = callsTo(mock, "GET", `${base}/${workspaceId}`).length;
    await mount(mock);
    assert.ok(callsTo(mock, "GET", `${base}/${workspaceId}`).length > reads);
    assert.equal(field("Job Label").value, "Unsaved local label");
    assert.equal(callsTo(mock, "POST", base).length, 0, "Reload does not create a replacement draft");
    await click("Back to drafts"); await settle(() => Boolean(findButton("Back to list")));
    assert.equal(new URLSearchParams(window.location.search).has("workspaceId"), false);
    await click("Back to list"); assert.equal(exits, 1);
  });

  for (const target of ["quote", "order"] as const) await scenario(`only explicit Save ${target} promotes, blocks pending exits, and publishes the canonical URL/popstate`, async () => {
    const mock = server(savedWorkspace(), { quoteOverridePrice: false, quoteView: false, quoteCreate: target === "quote", orderCreate: target === "order" });
    await mount(mock); await change("Job Label", `${target} metadata`);
    assert.equal(mock.canonical.length, 0); assert.deepEqual(navigations, []);
    mock.state.promotionGate = deferred();
    await click(target === "quote" ? "Save Quote" : "Save Order");
    await settle(() => callsTo(mock, "POST", `${base}/${workspaceId}/promote`).length === 1);
    assert.equal(mock.state.saved?.header.jobLabel, `${target} metadata`, "The explicit save acknowledges its dirty header first");
    assert.equal(findButton("Back to list"), undefined); assert.ok(button("Back to drafts").disabled);
    await click("Back to drafts"); assert.equal(exits, 0); assert.equal(mock.canonical.length, 0);
    assert.equal(window.location.pathname, "/quotes/new");
    await act(async () => mock.state.promotionGate!.resolve()); await settle(() => navigations.length === 1);
    const created = mock.canonical[0]!;
    assert.equal(created.target, target);
    assert.deepEqual(navigations, [`/${target === "quote" ? "quotes" : "orders"}/${created.documentId}`]);
    assert.equal(window.location.pathname, navigations[0]); assert.equal(window.location.search, "");
    assert.equal(mock.canonical.length, 1);
    assert.equal(mock.calls.some((call) => call.method === "POST" && /\/(quotes|orders)$/.test(call.url.pathname)), false);
  });

  await scenario("same organization and retained infinite cache never expose another freshly bootstrapped principal's workspace", async () => {
    const mock = server(savedWorkspace()); await mount(mock);
    await change("Job Label", "User A private unsaved label");
    const oldKey = salesWorkspaceKeys.workspace(sessionScope, organizationId, userId, workspaceId);
    assert.equal(cache.getQueryData<WorkspaceView>(oldKey)?.creatorUserId, userId);
    mock.state.actor = otherUserId; mock.state.csrfToken = "csrf-user-b";
    // Keep both cache and opaque scope: verified userId itself must partition TEMP data.
    await act(async () => { await cache.invalidateQueries({ queryKey: ["v2", sessionScope, organizationId, "ui-bootstrap"] }); });
    await settle(() => text().includes("Workspace belongs to another creator."));
    assert.doesNotMatch(text(), /User A private unsaved label|Saved entry/);
    assert.equal(findButton("Save Order"), undefined);
    assert.ok(callsTo(mock, "GET", `${base}/${workspaceId}`).some((call) => call.actor === otherUserId));
    const newKey = salesWorkspaceKeys.workspace(sessionScope, organizationId, otherUserId, workspaceId);
    assert.notDeepEqual(oldKey, newKey); assert.equal(cache.getQueryData(newKey), undefined);
    assert.equal(cache.getQueryData<WorkspaceView>(oldKey)?.creatorUserId, userId, "Retained old cache is not rendered under the new principal");
    assert.equal(mock.canonical.length, 0); assert.deepEqual(navigations, []);
  });

  await scenario("owner FORBIDDEN response retains local context and never emits canonical navigation", async () => {
    const mock = server(savedWorkspace()); mock.state.promotionDenied = true; await mount(mock);
    await change("Job Label", "Retained on denial"); await click("Save Order");
    await settle(() => text().includes("Promotion capability was revoked."));
    assert.equal(field("Job Label").value, "Retained on denial"); assert.equal(mock.canonical.length, 0);
    assert.deepEqual(navigations, []); assert.equal(window.location.pathname, "/quotes/new");
    assert.equal(new URLSearchParams(window.location.search).get("workspaceId"), workspaceId);
  });

  await scenario("actual workspace multipart transport preserves browser boundary and fresh CSRF without a JSON override", async () => {
    const mock = server(savedWorkspace(), { quoteOverridePrice: false, orderCreate: true, artworkView: true, artworkAdopt: true, artworkAssign: true });
    await mount(mock); await change("Attach to", lineId);
    await act(async () => {
      const input = field("PDF file");
      Object.defineProperty(input, "files", { configurable: true, value: [new File(["%PDF-fixture"], "staged.pdf", { type: "application/pdf" })] });
      Simulate.change(input);
    });
    assert.equal(findButton("Back to list"), undefined); assert.ok(button("Back to drafts").disabled);
    await click("Upload staged PDF"); await settle(() => text().includes("PDF staged in the workspace."));
    const upload = callsTo(mock, "POST", `${base}/${workspaceId}/artwork`);
    assert.equal(upload.length, 1); assert.equal(upload[0]!.headers.has("content-type"), false);
    assert.equal(upload[0]!.headers.get("x-v2-csrf-token"), mock.state.csrfToken);
    assert.equal(mock.canonical.length, 0);
  });

  await scenario("failed or missing verified bootstrap identity never loads or creates a workspace", async () => {
    for (const denied of [false, true]) {
      const mock = server(savedWorkspace()); mock.state.actor = undefined; mock.state.bootstrapDenied = denied;
      await mount(mock);
      assert.match(text(), denied ? /access could not be verified/ : /verified staff session is required/);
      assert.equal(mock.calls.length, 1); assert.equal(mock.canonical.length, 0);
      assert.equal(findButton("Save Order"), undefined); assert.equal(findButton("New Sales Entry"), undefined);
    }
  });
  console.log(`Persisted Sales entry integration: ${scenarios}/${scenarios} scenarios passed.`);
} finally {
  await act(async () => root.unmount()); cache.clear(); clearV2ApiSessionState();
  window.removeEventListener("popstate", navigation);
  globalThis.fetch = originalFetch;
  dom.window.close();
  for (const [key, descriptor] of previous) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else Reflect.deleteProperty(globalThis, key);
  }
}
