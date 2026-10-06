import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { JSDOM } from "jsdom";
import type { QuoteRead, UiBootstrap } from "./api";

assert.equal(process.env.V2_VALIDATION_MODE, "deterministic");

// Actual App and central client, with inert transport fixtures. These assertions
// prove UI correlation, not M0 persistence or provider delivery.
const require = createRequire(import.meta.url);
const previousCss = require.extensions[".css"];
require.extensions[".css"] = () => {};
const React: typeof import("react") = require("react");
const { act } = React;
const { QueryClient, QueryClientProvider }: typeof import("@tanstack/react-query") = require("@tanstack/react-query");
const dom = new JSDOM("<!doctype html><html><body><div id='root'></div></body></html>", { url: "https://ui.invalid/quotes/quote-a" });
const globalKeys = ["React", "window", "document", "navigator", "sessionStorage", "HTMLElement", "Event", "PopStateEvent", "IS_REACT_ACT_ENVIRONMENT"] as const;
const previousGlobals = new Map(globalKeys.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
Object.assign(globalThis, { React, window: dom.window, document: dom.window.document, navigator: dom.window.navigator, sessionStorage: dom.window.sessionStorage, HTMLElement: dom.window.HTMLElement, Event: dom.window.Event, PopStateEvent: dom.window.PopStateEvent, IS_REACT_ACT_ENVIRONMENT: true });
const { createRoot }: typeof import("react-dom/client") = require("react-dom/client");
const { Simulate }: typeof import("react-dom/test-utils") = require("react-dom/test-utils");
const { App }: typeof import("./App") = require("./App");
const { defaultVisualAppearance }: typeof import("./appearance") = require("./appearance");
const { clearV2ApiSessionState, quoteApi, authenticatedWorkspaceTransport }: typeof import("./api") = require("./api");
const { quoteKeys }: typeof import("./quoteFormQueries") = require("./quoteFormQueries");
const originalFetch = globalThis.fetch;
const org = "publication-org";
const initial: QuoteRead = {
  quote: { quoteId: "quote-a", customerContact: { organizationId: org, customerId: "customer-a", contactId: "contact-a" },
    jobLabel: "Internal label", terms: { commercialNotes: "Internal notes" }, currency: "USD", deliveryState: "sent", acceptanceState: "not_accepted", lifecycleState: "open", lines: [] },
  revision: "2", publishedCheckpointId: "published-a", publishedEvidenceStatus: "modern", number: { display: "QT1001", core: "1001" },
  checkpoints: [{ checkpointId: "published-a", kind: "quote_sent", occurredAt: "2026-10-01T00:00:00Z" }],
  totals: { currency: "USD", calculatedLineAmount: { cents: 1000, currency: "USD" }, sellingLineAmount: { cents: 1000, currency: "USD" } },
};
const publication = { checkpointId: "published-a", occurredAt: "2026-10-01T00:00:00Z", customerPresentation: { customerDisplayName: "Frozen customer", contactDisplayName: "Frozen contact" },
  sentEvidence: { recipientEmail: "frozen@example.invalid", documentSha256: "frozen-hash" }, commercial: { jobLabel: "Frozen publication label", terms: { commercialNotes: "Frozen publication notes" } } };
let quote = structuredClone(initial);
let bootstrap: UiBootstrap = { organizationId: org, userId: "staff-a", sessionScope: "publication-session-a", csrfToken: "fixture-csrf",
  capabilities: { quoteView: true, quoteEdit: true, quoteSend: true, quoteConvert: true, quoteCreate: false, quoteOverridePrice: false } };
const calls: { path: string; method: string; body?: Record<string, unknown>; headers?: HeadersInit }[] = [];
let loseSendResponse = false;
let suppressedReadiness = false;
let sendGate: Promise<void> | undefined;
let heldSendResult: QuoteRead | undefined;
let afterJson: (() => Promise<void>) | undefined;
let headersScope: string | undefined;
let denyHistory = false;
let historyParsing = 0;
let publishedItems: readonly import("./QuotePublicationPanel").Publication[] = [publication];
const publicationB = { ...publication, checkpointId: "published-b", commercial: { jobLabel: "Quote B publication label", terms: { commercialNotes: "Quote B frozen notes" } } };
globalThis.fetch = async (input, init) => {
  const url = new URL(String(input), window.location.origin), path = url.pathname, method = init?.method ?? "GET";
  assert.equal(url.origin, window.location.origin, "test transport cannot reach an external host");
  assert.ok(path.startsWith(`/v2/organizations/${org}/`), `unexpected tenant route ${path}`);
  const body = init?.body ? JSON.parse(String(init.body)) : undefined;
  calls.push({ path, method, body, headers: init?.headers });
  if (denyHistory && !afterJson && path.endsWith("/publications")) return new Response(JSON.stringify({ ok: false, error: { code: "FORBIDDEN", message: "History denied" } }), { status: 403 });
  if (method === "POST" && path.endsWith("/accept")) return new Response(JSON.stringify({ ok: false, error: { code: "RETRYABLE_FAILURE", message: "Inert acceptance response unavailable." } }), { status: 503 });
  let data: unknown;
  if (path.endsWith("/ui-bootstrap")) data = bootstrap;
  else if (path.endsWith("/publications")) data = { items: structuredClone(path.includes("/quote-b/") ? [publicationB] : publishedItems) };
  else if (method === "GET" && path.endsWith("/quotes")) data = { items: [], totalMatching: 0 };
  else if (path.endsWith("/form/customers")) data = [{ customerId: "customer-a", displayName: "Current customer" }];
  else if (path.endsWith("/form/customers/customer-a/contacts")) data = [{ contactId: "contact-a", displayName: "Current contact" }];
  else if (path.endsWith("/form/products") || path.endsWith("/artwork")) data = [];
  else if (path.endsWith("/contact-selection")) data = { id: "contact-a", label: "Current contact" };
  else if (path.endsWith("/contacts/contact-a")) data = { contactId: "contact-a", displayName: "Current contact" };
   else if (path.endsWith("/send-readiness")) data = { canSend: true, recipient: { status: "ready", email: suppressedReadiness ? "quote-final-four@example.invalid" : "current@example.invalid" }, tax: { status: "ready" }, routability: { status: "ready" }, email: suppressedReadiness ? { provider: "none", status: "suppressed", actionRequired: "DEV QA publication only; email suppressed." } : { provider: "gmail", status: "ready" } };
  else if (method === "POST" && path.endsWith("/revise")) {
    quote = { ...quote, revision: String(Number(quote.revision) + 1), quote: { ...quote.quote, deliveryState: "not_sent" } };
    data = { quote };
  } else if (method === "POST" && path.endsWith("/send")) {
    const result = { quote: structuredClone(heldSendResult ?? quote) };
    if (sendGate) await sendGate;
    if (loseSendResponse) { loseSendResponse = false; throw new TypeError("Lost inert response"); }
    data = result;
  } else if (method === "PATCH" && /\/quotes\/quote-a$/.test(path)) {
    quote = { ...quote, revision: String(Number(quote.revision) + 1), quote: { ...quote.quote, jobLabel: (body.patch as { jobLabel?: string }).jobLabel ?? quote.quote.jobLabel } };
    data = { quote };
  } else if (method === "GET" && /\/quotes\/quote-[ab]$/.test(path)) data = path.endsWith("quote-b") ? { ...quote, publishedCheckpointId: "published-b", quote: { ...quote.quote, quoteId: "quote-b" }, number: { display: "QT2002", core: "2002" } } : quote;
  else throw new Error(`Unexpected inert App request ${method} ${path}`);
  if (afterJson && path.endsWith("/publications")) {
    const finish = afterJson;
    const denied = denyHistory;
    return { ok: !denied, status: denied ? 403 : 200, headers: new Headers(headersScope ? { "x-v2-session-scope": headersScope } : {}), json: async () => { historyParsing++; await finish(); return denied ? { ok: false, error: { code: "FORBIDDEN", message: "Old history denied" } } : { ok: true, data }; } } as Response;
  }
  return new Response(JSON.stringify({ ok: true, data }), { headers: { "content-type": "application/json", ...(headersScope ? { "x-v2-session-scope": headersScope } : {}) } });
};
let cache = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false } } });
let root = createRoot(document.getElementById("root")!);
const text = () => document.body.textContent ?? "";
const button = (label: string) => { const value = [...document.querySelectorAll("button")].find(node => node.textContent === label); assert.ok(value, `button ${label}: ${text()}`); return value; };
const settle = async (predicate: () => boolean) => {
  for (let index = 0; index < 150; index++) { await act(async () => { await new Promise(resolve => setTimeout(resolve, 5)); }); if (predicate()) return; }
  assert.ok(predicate(), `App settled: ${text()}\n${JSON.stringify(cache.getQueryCache().getAll().map(query => ({ key: query.queryKey, status: query.state.status, error: query.state.error })))}\n${JSON.stringify(calls)}`);
};
const click = async (label: string) => { await act(async () => button(label).click()); };
const mount = async () => {
  await act(async () => root.unmount()); cache.clear(); clearV2ApiSessionState(); calls.length = 0;
  sessionStorage.clear(); sessionStorage.setItem("ph.v2.organization-id", org); window.history.replaceState({}, "", "/quotes/quote-a");
  cache = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false } } }); root = createRoot(document.getElementById("root")!);
  await act(async () => root.render(<QueryClientProvider client={cache}><App appearance={defaultVisualAppearance} setAppearance={() => {}} /></QueryClientProvider>));
  await settle(() => text().includes("QT1001"));
};
const history = async () => { await click("History"); await settle(() => text().includes("Frozen publication label")); };
let cases = 0;
const check = async (name: string, work: () => Promise<void>) => { await work(); cases++; console.log(`PASS ${name}`); };
try {
  await check("actual App reads frozen history and checkpoint document without mutation on render", async () => {
    await mount(); await history();
    assert.ok(!calls.some(call => call.method !== "GET"));
    const link = document.querySelector('.v2-sales-history a') as HTMLAnchorElement;
    assert.equal(link.getAttribute("href"), `/v2/organizations/${org}/quotes/quote-a/document.pdf?checkpointId=published-a`);
    assert.ok(text().includes("frozen@example.invalid")); assert.ok(!text().includes("Internal notes"));
  });
  await check("dirty internal edits require explicit cancel or Save before resend/revise", async () => {
    await act(async () => { const input = document.querySelector('[aria-label="Job Label"]') as HTMLInputElement; input.value = "Dirty label"; Simulate.change(input); });
    assert.equal(button("Resend Current Internal Revision").disabled, true); assert.equal(button("Start Internal Revision").disabled, true);
    await click("Cancel unsaved changes"); assert.equal(button("Resend Current Internal Revision").disabled, false);
    await act(async () => { const input = document.querySelector('[aria-label="Job Label"]') as HTMLInputElement; input.value = "Saved label"; Simulate.change(input); });
    await click("Save"); await settle(() => text().includes("Quote saved."));
    assert.equal(button("Resend Current Internal Revision").disabled, false);
    assert.equal(quote.publishedCheckpointId, "published-a");
  });
  await check("valid revise uses canonical CAS command and preserves publication during not_sent revision", async () => {
    await click("Start Internal Revision"); await settle(() => text().includes("Internal revision started."));
    const call = calls.find(call => call.path.endsWith("/revise"))!;
    assert.equal(call.method, "POST"); assert.equal(call.body?.expectedRevision, "3"); assert.equal(typeof call.body?.businessRequestId, "string");
    assert.equal(new Headers(call.headers).get("x-v2-csrf-token"), "fixture-csrf");
    assert.equal(quote.quote.deliveryState, "not_sent"); assert.equal(quote.publishedCheckpointId, "published-a");
    assert.ok(text().includes("A successful sent revision remains customer-visible."));
    assert.ok([...document.querySelectorAll("button")].some(node => node.textContent === "Accept Quote & Create Order"), "publication evidence, not current delivery flag, presents acceptance");
  });
  await check("lost resend response retries exact captured tenant/resource/revision/request identity", async () => {
    await click("Resend Current Internal Revision"); await settle(() => !button("Resend Current Internal Revision PDF").disabled);
    loseSendResponse = true; await click("Resend Current Internal Revision PDF"); await settle(() => text().includes("Lost inert response"));
    await click("Resend Current Internal Revision PDF"); await settle(() => !document.querySelector('[role="dialog"]'));
    const sends = calls.filter(call => call.path.endsWith("/send")); assert.equal(sends.length, 2); assert.deepEqual(sends[0].body, sends[1].body);
    assert.equal(sends[0].path, `/v2/organizations/${org}/quotes/quote-a/send`); assert.equal(sends[0].body?.expectedRevision, "4");
  });
  await check("late mutation result after editor unmount cannot apply old Quote or notice", async () => {
    let release!: () => void; sendGate = new Promise<void>(resolve => { release = resolve; });
    await click("Resend Current Internal Revision"); await settle(() => !button("Resend Current Internal Revision PDF").disabled); await click("Resend Current Internal Revision PDF");
    const previousQuote = cache.getQueryData(quoteKeys.quote(bootstrap.sessionScope, org, "quote-a"));
    await act(async () => root.unmount());
    await act(async () => { release(); await sendGate; });
    sendGate = undefined;
    await settle(() => cache.isMutating() === 0);
    assert.ok(!text().includes("Quote PDF delivered")); assert.equal(cache.getQueryData(quoteKeys.quote(bootstrap.sessionScope, org, "quote-a")), previousQuote);
  });
  await check("revoked edit disables revise; revoked View hides cached quote and publication", async () => {
    bootstrap = { ...bootstrap, capabilities: { ...bootstrap.capabilities, quoteEdit: false } }; await mount(); await history();
    assert.equal(button("Start Internal Revision").disabled, true); assert.ok(text().includes("Frozen publication label"));
    bootstrap = { ...bootstrap, capabilities: { ...bootstrap.capabilities, quoteView: false } };
    await act(async () => { await cache.invalidateQueries({ queryKey: quoteKeys.bootstrap(bootstrap.sessionScope, org) }); });
    await settle(() => text().includes("Quote viewing is unavailable")); assert.ok(!text().includes("Frozen publication label")); assert.ok(!text().includes("QT1001"));
  });
  await check("full App rejects paused history JSON after trusted session replacement and new actor", async () => {
    quote = structuredClone(initial); publishedItems = [publication];
    bootstrap = { ...bootstrap, userId: "staff-a", sessionScope: "publication-session-a", csrfToken: "fixture-csrf", capabilities: { ...bootstrap.capabilities, quoteView: true, quoteEdit: true, quoteSend: true } };
    await mount(); await history();
    await click("Resend Current Internal Revision"); await settle(() => !button("Resend Current Internal Revision PDF").disabled);
    const oldConfirm = button("Resend Current Internal Revision PDF");
    const oldScope = bootstrap.sessionScope;
    const oldKey = ["v2", oldScope, org, "quote-publications", "quote-a", quote.revision];
    let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; }); afterJson = () => gate;
    const parsing = historyParsing;
    await act(async () => { void cache.invalidateQueries({ queryKey: oldKey }); });
    await settle(() => historyParsing === parsing + 1);
    assert.ok(!text().includes("Frozen publication label"));
    afterJson = undefined;
    publishedItems = [{ ...publication, commercial: { jobLabel: "New actor publication label", terms: { commercialNotes: "New actor frozen notes" } } }];
    bootstrap = { ...bootstrap, userId: "staff-b", sessionScope: "publication-session-b", csrfToken: "fixture-csrf-b" };
    await act(async () => {
      window.dispatchEvent(new window.Event("v2:session-context-changed"));
    });
    assert.ok(text().includes("Quote viewing is unavailable"));
    assert.equal(cache.getQueryData(oldKey), undefined);
    assert.equal(cache.getQueryData(quoteKeys.bootstrap(oldScope, org)), undefined);
    // Trusted replacement clears the selected organization. A sign-in reload
    // mounts the actual App again; retain the same cache to prove quarantine.
    sessionStorage.setItem("ph.v2.organization-id", org);
    await act(async () => root.render(<QueryClientProvider client={cache}><App key={bootstrap.sessionScope} appearance={defaultVisualAppearance} setAppearance={() => {}} /></QueryClientProvider>));
    await settle(() => cache.getQueryData<UiBootstrap>(quoteKeys.bootstrap(bootstrap.sessionScope, org))?.userId === "staff-b" && text().includes("QT1001"));
    assert.ok(!document.querySelector('[role="dialog"]'), "new actor does not inherit the previous actor's captured command dialog");
    await click("History"); await settle(() => text().includes("New actor publication label"));
    await act(async () => { oldConfirm.click(); release(); await gate; });
    await settle(() => cache.isFetching() === 0);
    assert.ok(!text().includes("Frozen publication label")); assert.ok(text().includes("New actor publication label"));
    assert.equal(cache.getQueryData(oldKey), undefined, "cleared previous-session namespace stays absent after the old body completes");
    assert.equal(authenticatedWorkspaceTransport.commandHeaders(org)["x-v2-csrf-token"], "fixture-csrf-b");
    assert.ok(!calls.some(call => call.method !== "GET"), "history completion and detached old dialog cannot post under a new actor");
  });
  await check("full App View revocation fences an already-parsing successful history body", async () => {
    const key = ["v2", bootstrap.sessionScope, org, "quote-publications", "quote-a", quote.revision];
    const previousHistory = cache.getQueryData(key);
    publishedItems = [{ ...publication, commercial: { jobLabel: "REVOKED_HISTORY_SECRET", terms: {} } }];
    let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; }); afterJson = () => gate;
    const parsing = historyParsing;
    await act(async () => { void cache.invalidateQueries({ queryKey: key }); });
    await settle(() => historyParsing === parsing + 1); afterJson = undefined;
    bootstrap = { ...bootstrap, capabilities: { ...bootstrap.capabilities, quoteView: false } };
    await act(async () => { await cache.invalidateQueries({ queryKey: quoteKeys.bootstrap(bootstrap.sessionScope, org) }); });
    await settle(() => text().includes("Quote viewing is unavailable"));
    await act(async () => { release(); await gate; }); await settle(() => cache.isFetching() === 0);
    assert.ok(!text().includes("REVOKED_HISTORY_SECRET")); assert.ok(!text().includes("New actor publication label"));
    assert.equal(cache.getQueryData(key), previousHistory, "revoked read cannot replace retained cached evidence with the late body");
    assert.equal(authenticatedWorkspaceTransport.commandHeaders(org)["x-v2-csrf-token"], "fixture-csrf-b");
    assert.ok(!calls.some(call => call.method !== "GET"));
  });
  await check("full App unmount fences late scoped FORBIDDEN without reconciliation or CSRF teardown", async () => {
    bootstrap = { ...bootstrap, capabilities: { ...bootstrap.capabilities, quoteView: true } }; publishedItems = [publication];
    await mount(); await history();
    const key = ["v2", bootstrap.sessionScope, org, "quote-publications", "quote-a", quote.revision];
    let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; }); afterJson = () => gate; denyHistory = true;
    const parsing = historyParsing;
    await act(async () => { void cache.invalidateQueries({ queryKey: key }); });
    await settle(() => historyParsing === parsing + 1); afterJson = undefined; denyHistory = false;
    await act(async () => root.unmount()); const callCount = calls.length;
    await act(async () => { release(); await gate; }); await settle(() => cache.isFetching() === 0);
    assert.equal(calls.length, callCount, "old error does not invoke the current actor's authority reconciliation");
    assert.equal((cache.getQueryState(key)?.error as { code?: string })?.code, "FORBIDDEN", "unmount fence is exercised without relying on an API generation replacement");
    assert.equal(authenticatedWorkspaceTransport.commandHeaders(org)["x-v2-csrf-token"], bootstrap.csrfToken);
    assert.ok(!text().includes("Old history denied"));
    clearV2ApiSessionState(); bootstrap = { ...bootstrap, userId: "staff-c", sessionScope: "publication-session-c", csrfToken: "fixture-csrf-c" };
    await quoteApi.bootstrap(org); assert.equal(authenticatedWorkspaceTransport.commandHeaders(org)["x-v2-csrf-token"], "fixture-csrf-c");
  });
  await check("full App resource navigation cannot adopt paused previous-Quote history", async () => {
    quote = structuredClone(initial); publishedItems = [publication];
    await mount();
    const oldKey = ["v2", bootstrap.sessionScope, org, "quote-publications", "quote-a", quote.revision];
    let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; }); afterJson = () => gate;
    const parsing = historyParsing;
    await click("History"); await settle(() => historyParsing === parsing + 1); afterJson = undefined;
    await act(async () => { window.history.pushState({}, "", "/quotes/quote-b"); window.dispatchEvent(new window.PopStateEvent("popstate")); });
    await settle(() => text().includes("QT2002"));
    await click("History"); await settle(() => text().includes("Quote B publication label"));
    await act(async () => { release(); await gate; }); await settle(() => cache.isFetching() === 0);
    assert.equal(cache.getQueryData(oldKey), undefined); assert.ok(!text().includes("Frozen publication label"));
    const link = document.querySelector('.v2-sales-history a') as HTMLAnchorElement;
    assert.equal(link.getAttribute("href"), `/v2/organizations/${org}/quotes/quote-b/document.pdf?checkpointId=published-b`);
    assert.ok(!calls.some(call => call.method !== "GET"));
  });
  await check("full App resource navigation fences a late captured-send result and keeps the next Quote selected", async () => {
    quote = structuredClone(initial); publishedItems = [publication];
    await mount(); await history();
    const previousQuote = cache.getQueryData(quoteKeys.quote(bootstrap.sessionScope, org, "quote-a"));
    let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; }); sendGate = gate;
    heldSendResult = { ...initial, revision: "3", quote: { ...initial.quote, jobLabel: "Late previous Quote snapshot" } };
    try {
      await click("Resend Current Internal Revision"); await settle(() => !button("Resend Current Internal Revision PDF").disabled); await click("Resend Current Internal Revision PDF");
      await act(async () => { window.history.pushState({}, "", "/quotes/quote-b"); window.dispatchEvent(new window.PopStateEvent("popstate")); });
      await settle(() => text().includes("QT2002"));
      await act(async () => { release(); await gate; }); await settle(() => cache.isMutating() === 0);
      assert.ok(text().includes("QT2002")); assert.ok(!text().includes("Quote PDF delivered")); assert.ok(!text().includes("Late previous Quote snapshot"));
      assert.equal(cache.getQueryData(quoteKeys.quote(bootstrap.sessionScope, org, "quote-a")), previousQuote);
      const sends = calls.filter(call => call.path.endsWith("/send")); assert.equal(sends.length, 1);
      assert.equal(sends[0].path, `/v2/organizations/${org}/quotes/quote-a/send`); assert.equal(sends[0].body?.expectedRevision, "2");
      assert.equal(new Headers(sends[0].headers).get("x-v2-csrf-token"), bootstrap.csrfToken);
    } finally { release(); sendGate = undefined; heldSendResult = undefined; }
  });
  await check("central history rejects session change during JSON; replacement headers precede body", async () => {
    await act(async () => root.unmount()); cache.clear(); clearV2ApiSessionState();
    let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; }); afterJson = () => gate;
    const pending = quoteApi.publications(org, "quote-a"); const rejected = assert.rejects(pending, (error: { code?: string }) => error.code === "SESSION_CONTEXT_CHANGED");
    await new Promise(resolve => setTimeout(resolve, 0)); clearV2ApiSessionState(); release(); await rejected; afterJson = undefined;
    await quoteApi.bootstrap(org); let parsed = false; headersScope = "publication-session-replaced"; afterJson = async () => { parsed = true; };
    await assert.rejects(quoteApi.publications(org, "quote-a"), (error: { code?: string }) => error.code === "SESSION_CONTEXT_CHANGED");
    assert.equal(parsed, false, "replacement header is rejected before JSON interpretation"); afterJson = undefined; headersScope = undefined;
  });
  await check("a scoped history denial preserves FORBIDDEN and does not tear down CSRF/session state", async () => {
    clearV2ApiSessionState(); await quoteApi.bootstrap(org); denyHistory = true;
    await assert.rejects(quoteApi.publications(org, "quote-a"), (error: { code?: string }) => error.code === "FORBIDDEN");
    denyHistory = false;
    await quoteApi.action(org, "quote-a", "revise", "inert-request-after-denial", quote.revision);
    assert.equal(new Headers(calls.at(-1)!.headers).get("x-v2-csrf-token"), bootstrap.csrfToken);
  });
  await check("before a committed publication the existing send dialog labels a new send", async () => {
    quote = { ...initial, publishedCheckpointId: null, publishedEvidenceStatus: null, quote: { ...initial.quote, deliveryState: "not_sent" } };
    publishedItems = [];
    bootstrap = { ...bootstrap, capabilities: { ...bootstrap.capabilities, quoteView: true, quoteEdit: true } };
    await mount(); assert.ok(!calls.some(call => call.method !== "GET"));
    await click("Send Quote"); await settle(() => !button("Send Quote PDF").disabled);
    assert.ok(!text().includes("Resend Current Internal Revision PDF"));
    assert.ok(!calls.some(call => call.method !== "GET"));
    await click("Close"); await click("History"); await settle(() => text().includes("No canonical publication is confirmed."));
    assert.equal(button("Send Current Internal Revision").disabled, false);
    await click("Send Current Internal Revision"); await settle(() => !button("Send Quote PDF").disabled);
    assert.ok(!calls.some(call => call.method !== "GET"), "panel first-send callback opens the existing dialog only");
  });
  await check("published acceptance confirmation does not present divergent internal draft facts", async () => {
    quote = { ...initial, quote: { ...initial.quote, deliveryState: "not_sent" }, totals: { ...initial.totals, calculatedLineAmount: { cents: 2500, currency: "USD" }, sellingLineAmount: { cents: 2500, currency: "USD" } } };
    const committed = { ...publication, commercial: { ...publication.commercial, lines: [{ lineId: "published-line", description: "Published-only line", quantity: 2, sellingLineAmount: { cents: 10000, currency: "USD" } }] } };
    publishedItems = [committed];
    assert.notEqual(committed.customerPresentation.contactDisplayName, "Current contact");
    assert.notEqual(committed.commercial.lines.length, quote.quote.lines.length);
    assert.notEqual(committed.commercial.lines[0].sellingLineAmount.cents, quote.totals.sellingLineAmount.cents);
    await mount(); await history();
    assert.ok(text().includes("Frozen contact"));
    assert.ok(!calls.some(call => call.method !== "GET"));
    await click("Accept Quote & Create Order"); await settle(() => cache.isFetching() === 0);
    const dialog = document.querySelector('[role="dialog"][aria-label="Accept Quote and create Order"]'); assert.ok(dialog);
    assert.match(dialog.textContent ?? "", /last committed published revision/);
    assert.match(dialog.textContent ?? "", /not the current internal draft/);
    assert.doesNotMatch(dialog.textContent ?? "", /Current contact|Selected contact|\$25\.00|Quote total/);
    assert.equal(dialog.querySelector("dl"), null, "no internal contact, total, or line-count summary is presented as accepted facts");
    assert.ok(!calls.some(call => call.method !== "GET"), "opening the confirmation cannot accept or send automatically");
    await click("Accept & Create Order"); await settle(() => text().includes("Inert acceptance response unavailable."));
    const writes = calls.filter(call => call.method !== "GET"); assert.equal(writes.length, 1);
    assert.equal(writes[0].path, `/v2/organizations/${org}/quotes/quote-a/accept`);
    assert.deepEqual(Object.keys(writes[0].body!).sort(), ["businessRequestId", "expectedRevision"]);
    assert.equal(writes[0].body?.expectedRevision, initial.revision); assert.equal(typeof writes[0].body?.businessRequestId, "string");
    assert.equal(new Headers(writes[0].headers).get("x-v2-csrf-token"), bootstrap.csrfToken);
    assert.ok(!calls.some(call => call.path.endsWith("/send")), "acceptance never sends the internal draft");
  });
  await check("actual App suppressed readiness and result never claim Gmail or delivered", async () => {
    suppressedReadiness = true;
    quote = { ...initial, publicationDeliveryMode: "suppressed" };
    publishedItems = [{ ...publication, sentEvidence: { ...publication.sentEvidence, suppression: { deliveryMode: "suppressed" } } }];
    try {
      await mount(); await history();
      assert.match(text(), /Published in DEV QA; email suppressed/);
      await click("Resend Current Internal Revision");
      await settle(() => !button("Publish DEV QA PDF (Email Suppressed)").disabled);
      const dialog = document.querySelector('[role="dialog"][aria-label="Send Quote"]')!;
      assert.match(dialog.textContent ?? "", /no provider call or provider message identity/);
      assert.doesNotMatch(dialog.textContent ?? "", /configured tenant Gmail|Ready \(Gmail\)/);
      await click("Publish DEV QA PDF (Email Suppressed)");
      await settle(() => !document.querySelector('[role="dialog"]'));
      assert.match(text(), /Published in DEV QA; email suppressed/);
      assert.doesNotMatch(text(), /Quote PDF delivered/);
      const sends = calls.filter(call => call.path.endsWith("/send")); assert.equal(sends.length, 1);
      assert.deepEqual(Object.keys(sends[0].body!).sort(), ["businessRequestId", "expectedRevision"]);
    } finally { suppressedReadiness = false; }
  });
  console.log(`Quote publication shared integration: ${cases} cases passed (inert transport only; no DB/provider/M0 proof).`);
} finally {
  await act(async () => root.unmount()); cache.clear(); clearV2ApiSessionState(); globalThis.fetch = originalFetch;
  if (previousCss) require.extensions[".css"] = previousCss; else delete require.extensions[".css"];
  dom.window.close(); for (const key of globalKeys) { const descriptor = previousGlobals.get(key); if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); }
}
