import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { JSDOM } from "jsdom";
import type { PrepressQueueItem, UiBootstrap } from "./api";
import type { V2AuthSession } from "./auth";
import type { WorkspacePromotionView, WorkspaceView } from "./salesWorkspaceApi";

// Match the existing actual-App fixture: one React/query graph, CSS ignored only.
const require = createRequire(import.meta.url);
const previousCss = require.extensions[".css"];
require.extensions[".css"] = () => {};
const React: typeof import("react") = require("react");
const { act, useEffect } = React;
const { QueryClient, QueryClientProvider }: typeof import("@tanstack/react-query") = require("@tanstack/react-query");
const dom = new JSDOM("<!doctype html><html><body><div id='root'></div></body></html>", { url: "https://ui.invalid/prepress" });
const globals = { React, window: dom.window, document: dom.window.document, navigator: dom.window.navigator,
  HTMLElement: dom.window.HTMLElement, sessionStorage: dom.window.sessionStorage, localStorage: dom.window.localStorage,
  IS_REACT_ACT_ENVIRONMENT: true };
const previous = new Map(Object.keys(globals).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
const originalFetch = globalThis.fetch;
const { createRoot }: typeof import("react-dom/client") = require("react-dom/client");
const { Simulate }: typeof import("react-dom/test-utils") = require("react-dom/test-utils");
const { App }: typeof import("./App") = require("./App");
const { AuthGate }: typeof import("./AuthGate") = require("./AuthGate");
const { clearV2ApiSessionState, salesWorkspaceTransport }: typeof import("./api") = require("./api");
const { defaultVisualAppearance }: typeof import("./appearance") = require("./appearance");
const authSession = (org = "org-a", scope = "scope-a"): V2AuthSession => ({
  staff: { id: "staff-a", displayName: "Verified Staff", email: "staff@example.test" },
  organizations: [{ id: "org-a", name: "Organization Alpha" }, { id: "org-b", name: "Organization Bravo" }],
  activeOrganizationId: org, sessionScope: scope, csrfToken: `auth-csrf-${scope}`,
});
const marker = (session: V2AuthSession) => `TENANT-${session.activeOrganizationId}-${session.sessionScope}`;
const queueItem = (session: V2AuthSession): PrepressQueueItem => ({
  orderId: `order-${session.activeOrganizationId}`, orderNumber: `ORD-${session.activeOrganizationId}`, customerDisplayName: `Customer ${session.activeOrganizationId}`,
  orderLineId: `line-${session.activeOrganizationId}`, lineDescription: marker(session), quantity: 1, routingStepKind: "prepress",
  coverage: { state: "configured", productionArtworkComplete: false, allRequiredPrepressUnitsComplete: false,
    requirements: [{ requirement: { key: "front", side: "front" }, artworkAssignmentIds: [], prepressUnits: [], productionArtworkCovered: false, prepressComplete: false }] },
});
const wire = (data: unknown, scope?: string) => new Response(JSON.stringify({ ok: true, data }), { status: 200,
  headers: { "content-type": "application/json", ...(scope ? { "x-v2-session-scope": scope } : {}) } });
const denied = (scope?: string) => new Response(JSON.stringify({ ok: false, error: { code: "UNAUTHORIZED", message: "Session unavailable" } }), { status: 401,
  headers: { "content-type": "application/json", ...(scope ? { "x-v2-session-scope": scope } : {}) } });
type Held = { response: Response; resolve: (response: Response) => void; scopeHeaderReads: number };
const server = (session: V2AuthSession | null = authSession()) => {
  const state = { session, epoch: session?.sessionScope ?? "revoked-epoch", canView: true, holdQueues: false, holdSessions: false,
    holdLogout: false, holdLogin: false, holdSelection: false, holdPromotion: false, restorationFailure: false, selectionFailure: false, logoutFailure: false, commits: 0, workspace: undefined as WorkspaceView | undefined };
  const calls: { method: string; path: string; headers: Headers; body?: Record<string, unknown> }[] = [];
  const queues: Held[] = []; const sessions: Held[] = []; const logouts: Held[] = []; const logins: Held[] = []; const selections: Held[] = []; const promotions: Held[] = []; const unexpected: string[] = [];
  const hold = (list: Held[], response: Response) => new Promise<Response>((resolve) => {
    const held = { response, resolve, scopeHeaderReads: 0 };
    const getHeader = response.headers.get.bind(response.headers);
    response.headers.get = (name: string) => { if (name === "x-v2-session-scope") held.scopeHeaderReads++; return getHeader(name); };
    list.push(held);
  });
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, window.location.origin);
    assert.equal(url.origin, window.location.origin, "No external providers or live hosts");
    assert.equal(init?.credentials, "include"); assert.equal(init?.cache, "no-store");
    const method = init?.method ?? "GET"; const headers = new Headers(init?.headers);
    const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : undefined;
    calls.push({ method, path: url.pathname, headers, body });
    const current = state.session && structuredClone(state.session);
    const scope = current?.sessionScope ?? state.epoch;
    if (url.pathname === "/v2/auth/session") {
      assert.equal(method, "GET");
      if (state.restorationFailure) throw new TypeError("Session restoration transport unavailable");
      const response = current ? wire(current, scope) : denied(scope);
      return state.holdSessions ? hold(sessions, response) : response;
    }
    if (url.pathname === "/v2/auth/login") {
      assert.equal(method, "POST"); assert.deepEqual(body, { email: "staff@example.test", password: "test-password" });
      state.session = authSession("org-a", "scope-login"); state.epoch = state.session.sessionScope;
      const response = wire(state.session, state.epoch);
      return state.holdLogin ? hold(logins, response) : response;
    }
    if (url.pathname === "/v2/auth/active-organization") {
      assert.equal(method, "POST"); assert.equal(headers.get("x-v2-csrf-token"), current?.csrfToken);
      if (state.selectionFailure) throw new TypeError("Organization selection transport unavailable");
      assert.ok(current); assert.ok(current.organizations.some((org) => org.id === body?.organizationId));
      state.session = authSession(String(body!.organizationId), `scope-${String(body!.organizationId).slice(-1)}`);
      state.epoch = state.session.sessionScope;
      const response = wire(state.session, state.epoch);
      return state.holdSelection ? hold(selections, response) : response;
    }
    if (url.pathname === "/v2/auth/logout") {
      assert.equal(method, "POST"); assert.equal(headers.get("x-v2-csrf-token"), current?.csrfToken);
      if (state.logoutFailure) throw new TypeError("Sign out transport unavailable");
      state.session = null; state.epoch = "logged-out";
      const response = wire({ loggedOut: true });
      return state.holdLogout ? hold(logouts, response) : response;
    }
    if (url.pathname.endsWith("/probe")) return wire({ secret: "response-must-not-restore-a-session" }, scope);
    if (url.pathname.endsWith("/ui-bootstrap")) {
      if (!current || !url.pathname.includes(`/${current.activeOrganizationId}/`)) return denied(scope);
      const capabilities: UiBootstrap["capabilities"] = { quoteOverridePrice: false, prepressView: state.canView, quoteView: Boolean(state.workspace), orderCreate: Boolean(state.workspace) };
      return wire({ organizationId: current.activeOrganizationId, userId: current.staff.id, sessionScope: scope, csrfToken: `api-csrf-${scope}`, capabilities }, scope);
    }
    if (url.pathname.endsWith("/prepress/queue")) {
      assert.equal(method, "GET"); assert.ok(current); assert.ok(url.pathname.includes(`/${current.activeOrganizationId}/`));
      const items = url.searchParams.get("requirementState") === "unconfigured" ? [] : [queueItem(current)];
      const response = wire({ items, pagination: { page: 1, pageSize: 25, totalCount: items.length, totalPages: items.length ? 1 : 0 } }, scope);
      return state.holdQueues ? hold(queues, response) : response;
    }
    if (url.pathname.endsWith("/action-center")) return wire({ items: [] }, scope);
    if (state.workspace && url.pathname.includes("/sales-workspaces/")) {
      if (url.pathname.endsWith("/promote")) {
        assert.equal(method, "POST"); assert.equal(headers.get("x-v2-csrf-token"), `api-csrf-${scope}`);
        assert.equal(body?.expectedRevision, state.workspace.revision); assert.equal(body?.target, "order"); assert.ok(body.requestId);
        state.commits++;
        const receipt: WorkspacePromotionView["receipt"] = { workspaceId: state.workspace.id, organizationId: state.workspace.organizationId,
          requestId: String(body.requestId), inputRevision: state.workspace.revision, fingerprint: "server-committed-receipt", target: "order", documentId: "order-committed", displayNumber: "ORD-SAVED",
          documentRevision: "1", header: state.workspace.header, lineMap: state.workspace.lines.map((line) => ({ workspaceLineId: line.id, canonicalLineId: `canonical-${line.id}`, position: line.position })),
          promotedAt: "2026-10-01T00:00:00Z", artworkPromoted: false, result: {} };
        state.workspace = { ...state.workspace, state: "promoted", promotion: receipt };
        const response = wire({ receipt, replayed: false, promotedWorkspaceHeader: receipt.header } satisfies WorkspacePromotionView, scope);
        return state.holdPromotion ? hold(promotions, response) : response;
      }
      assert.equal(method, "GET", "Forced auth teardown must not save/discard/promote the dirty workspace");
      if (url.pathname.endsWith(`/${state.workspace.id}`)) return wire(state.workspace, scope);
      if (url.pathname.endsWith("/contacts")) return wire({ items: [], selectedContact: null }, scope);
      if (/\/(customers|products|artwork)$/.test(url.pathname)) return wire([], scope);
    }
    unexpected.push(`${method} ${url.pathname}`); throw new Error(`Unexpected mocked endpoint: ${method} ${url.pathname}`);
  };
  return { state, calls, queues, sessions, logouts, logins, selections, promotions, unexpected, fetch };
};
const release = (list: Held[]) => { for (const held of list.splice(0)) held.resolve(held.response); };
const cache = () => new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity, staleTime: Infinity }, mutations: { retry: false } } });
let client = cache(); let root = createRoot(document.getElementById("root")!);
let mock!: ReturnType<typeof server>; let mounts = 0; let teardowns = 0; let events = 0;
const eventListener = (event: Event) => { assert.ok(event instanceof window.Event); events++; };
window.addEventListener("v2:session-context-changed", eventListener);
const TrackedApplication = () => {
  useEffect(() => { mounts++; return () => { teardowns++; }; }, []);
  return <App appearance={defaultVisualAppearance} setAppearance={() => undefined} />;
};
const text = () => document.body.textContent ?? "";
const settle = async (predicate: () => boolean, explanation: string) => {
  for (let attempt = 0; attempt < 150 && !predicate(); attempt++) await act(async () => { await new Promise((resolve) => setTimeout(resolve, 5)); });
  assert.ok(predicate(), `${explanation}: ${text()}`);
};
const render = async () => { await act(async () => root.render(<QueryClientProvider client={client}><AuthGate><TrackedApplication /></AuthGate></QueryClientProvider>)); };
const mount = async (next: ReturnType<typeof server>, path = "/prepress") => {
  await act(async () => root.unmount()); client.clear(); clearV2ApiSessionState();
  if (mock) { release(mock.queues); release(mock.sessions); release(mock.logouts); release(mock.logins); release(mock.selections); release(mock.promotions); }
  root = createRoot(document.getElementById("root")!); client = cache(); mock = next; globalThis.fetch = next.fetch;
  sessionStorage.clear(); localStorage.clear(); window.history.replaceState({}, "", path);
  mounts = 0; teardowns = 0; events = 0; await render();
};
const button = (name: string) => {
  const node = [...document.querySelectorAll("button")].find((item) => item.textContent?.trim() === name);
  assert.ok(node, `Button ${name} is present`); return node;
};
const click = async (name: string) => { await act(async () => { button(name).click(); }); };
const account = async () => { await click("Verified Staff"); };
const sessionReads = () => mock.calls.filter((call) => call.path === "/v2/auth/session").length;
const writes = () => mock.calls.filter((call) => call.method !== "GET");
const invalidate = async (next: V2AuthSession | null, epoch = "revoked-epoch") => {
  const prior = mock.state.session?.activeOrganizationId ?? "org-a";
  mock.state.session = next; mock.state.epoch = next?.sessionScope ?? epoch;
  await act(async () => { await assert.rejects(salesWorkspaceTransport.request(`/v2/organizations/${prior}/probe`), (reason: unknown) => (reason as { code?: string }).code === "SESSION_CONTEXT_CHANGED"); });
};
const assertNoOldCache = (scope: string, org = "org-a") => {
  assert.ok(!client.getQueryCache().getAll().some((query) => query.queryKey[0] === "v2" && (query.queryKey[1] === scope || query.queryKey[2] === org)), "Old tenant/scope cache is removed, not merely hidden");
};
let scenarios = 0;
const scenario = async (name: string, work: () => Promise<void>) => {
  await work(); assert.deepEqual(mock.unexpected, []); scenarios++; console.log(`PASS ${name}`);
};

try {
  await scenario("Direct URL, hard remount and real sidebar navigation use server-verified session only", async () => {
    const next = server(authSession("org-b", "scope-b")); next.state.holdSessions = true;
    await mount(next);
    sessionStorage.setItem("ph.v2.organization-id", "org-a"); localStorage.setItem("ph.v2.organization-id", "org-a");
    assert.match(text(), /Restoring secure session/); assert.equal(mounts, 0);
    assert.equal(mock.calls.some((call) => call.path.includes("/organizations/")), false);
    await act(async () => { mock.state.holdSessions = false; release(mock.sessions); });
    await settle(() => text().includes(marker(mock.state.session!)), "Direct /prepress restores Bravo");
    assert.equal(window.location.pathname, "/prepress"); assert.equal(sessionReads(), 1);
    assert.ok(mock.calls.filter((call) => call.path.includes("/organizations/")).every((call) => call.path.includes("/org-b/")));
    await click("Themes / Appearance"); await click("Prepress");
    await settle(() => text().includes(marker(mock.state.session!)), "Sidebar navigation returns to loaded Prepress");
    await act(async () => root.unmount()); root = createRoot(document.getElementById("root")!); await render();
    await settle(() => text().includes(marker(mock.state.session!)), "Hard remount independently restores server session");
    assert.equal(sessionReads(), 2); assert.equal(writes().length, 0);
  });

  await scenario("Actual account switch rotates scope/CSRF and old Alpha queue headers cannot blank Bravo", async () => {
    const next = server(); next.state.holdQueues = true; await mount(next);
    await settle(() => mock.queues.length === 2, "Both Alpha queue responses are held");
    const oldQueues = [...mock.queues];
    assert.match(text(), /Loading authenticated Prepress queue/);
    mock.state.holdQueues = false; await account(); await click("Organization Bravo");
    await settle(() => text().includes("Command Center") && text().includes("Organization Bravo") && mock.calls.some((call) => call.path === "/v2/organizations/org-b/ui-bootstrap"), "Account switch mounts Bravo");
    await click("Prepress"); await settle(() => text().includes(marker(authSession("org-b", "scope-b"))), "Bravo Prepress renders");
    await act(async () => release(mock.queues));
    assert.ok(oldQueues.every((held) => held.scopeHeaderReads === 0), "Old responses are fenced before even reading their actual Alpha scope headers");
    await settle(() => text().includes(marker(authSession("org-b", "scope-b"))), "Late Alpha headers leave Bravo intact");
    await act(async () => { window.dispatchEvent(new window.Event("focus")); });
    await click("Themes / Appearance"); await click("Prepress");
    await settle(() => text().includes(marker(authSession("org-b", "scope-b"))), "Focus and navigation stay recoverable");
    assert.equal(events, 0); assert.equal(sessionReads(), 1); assert.equal(window.location.pathname, "/prepress");
    assert.doesNotMatch(text(), /TENANT-org-a/); assertNoOldCache("scope-a");
    assert.equal(salesWorkspaceTransport.commandHeaders("org-b")["x-v2-csrf-token"], "api-csrf-scope-b");
    assert.deepEqual(writes().map((call) => call.path), ["/v2/auth/active-organization"]);
  });

  await scenario("Genuine current epoch replacement gates old App and recovers same direct URL without loops", async () => {
    await mount(server()); await settle(() => text().includes(marker(authSession())), "Alpha loads");
    mock.state.holdSessions = true;
    await invalidate(authSession("org-b", "scope-renewed"));
    await settle(() => mock.sessions.length === 1, "One server revalidation begins");
    assert.match(text(), /Restoring secure session/); assert.doesNotMatch(text(), /TENANT-org-a|Prepress Queue/);
    assert.equal(teardowns, 1); assertNoOldCache("scope-a");
    await act(async () => { mock.state.holdSessions = false; release(mock.sessions); });
    await settle(() => text().includes(marker(mock.state.session!)), "Verified replacement remounts actual App");
    assert.equal(window.location.pathname, "/prepress"); assert.equal(events, 1); assert.equal(sessionReads(), 2); assert.equal(mounts, 2);
    assert.equal(salesWorkspaceTransport.commandHeaders("org-b")["x-v2-csrf-token"], "api-csrf-scope-renewed");
    assert.equal(writes().length, 0); assert.doesNotMatch(text(), /TENANT-org-a/);
  });

  await scenario("Rapid context events coalesce and out-of-order older restoration cannot replace newer identity", async () => {
    await mount(server()); await settle(() => text().includes(marker(authSession())), "Alpha loads");
    mock.state.holdSessions = true;
    await invalidate(authSession("org-a", "scope-older"));
    await settle(() => mock.sessions.length === 1, "Older server snapshot is pending");
    const old = mock.sessions.shift()!;
    mock.state.session = { ...authSession("org-b", "scope-newest"), staff: { id: "staff-b", email: "new@example.test", displayName: "Verified New Staff" } };
    await act(async () => { for (let index = 0; index < 5; index++) window.dispatchEvent(new window.Event("v2:session-context-changed")); });
    await settle(() => mock.sessions.length === 1, "One newer request for the rapid event burst");
    assert.equal(sessionReads(), 3);
    await act(async () => { mock.state.holdSessions = false; release(mock.sessions); });
    await settle(() => text().includes(marker(mock.state.session!)), "Newest server identity wins");
    const acceptedMounts = mounts;
    await act(async () => old.resolve(old.response));
    assert.equal(mounts, acceptedMounts); assert.equal(sessionReads(), 3);
    assert.match(text(), /Verified New Staff/); assert.doesNotMatch(text(), /TENANT-org-a|scope-older/);
    assert.equal(sessionStorage.getItem("ph.v2.organization-id"), "org-b"); assertNoOldCache("scope-older");
    assert.equal(salesWorkspaceTransport.commandHeaders("org-b")["x-v2-csrf-token"], "api-csrf-scope-newest");
    assert.equal(writes().length, 0);
  });

  await scenario("Unauthorized restoration returns sign in and never trusts stale browser organization", async () => {
    await mount(server()); await settle(() => text().includes(marker(authSession())), "Alpha loads");
    sessionStorage.setItem("ph.v2.organization-id", "org-a"); localStorage.setItem("ph.v2.organization-id", "org-a");
    await invalidate(null);
    await settle(() => text().includes("Staff sign in"), "Rejected server session returns sign in");
    assert.doesNotMatch(text(), /TENANT-org-a|Prepress Queue/); assert.equal(sessionStorage.getItem("ph.v2.organization-id"), null);
    assertNoOldCache("scope-a"); assert.equal(sessionReads(), 2); assert.equal(writes().length, 0);
    await act(async () => { window.dispatchEvent(new window.Event("focus")); });
    assert.match(text(), /Staff sign in/);
  });

  await scenario("Initial unauthorized state and a transient restoration error return actionable sign in", async () => {
    await mount(server(null)); await settle(() => text().includes("Staff sign in"), "Unauthorized direct load shows login");
    assert.equal(mounts, 0); assert.equal(mock.calls.length, 1); assert.equal(writes().length, 0);
    await mount(server()); await settle(() => text().includes(marker(authSession())), "Alpha loads");
    mock.state.restorationFailure = true;
    await invalidate(authSession("org-b", "scope-new"));
    await settle(() => text().includes("Staff sign in"), "Transient session GET failure cannot strand empty App");
    assertNoOldCache("scope-a"); assert.equal(sessionStorage.getItem("ph.v2.organization-id"), null); assert.equal(writes().length, 0);
  });

  await scenario("A delayed login cannot replace a newer server-verified restoration", async () => {
    const next = server(null); next.state.holdLogin = true; await mount(next);
    await settle(() => text().includes("Staff sign in"), "Login available");
    await act(async () => {
      const email = document.querySelector<HTMLInputElement>('input[type="email"]')!;
      const password = document.querySelector<HTMLInputElement>('input[type="password"]')!;
      email.value = "staff@example.test"; Simulate.change(email);
      password.value = "test-password"; Simulate.change(password);
    });
    await act(async () => { document.querySelector("form")!.dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true })); });
    await settle(() => mock.logins.length === 1, "Login response is pending");
    mock.state.session = authSession("org-b", "scope-new-login");
    await act(async () => window.dispatchEvent(new window.Event("v2:session-context-changed")));
    await settle(() => text().includes(marker(mock.state.session!)), "Newer verified context supersedes login");
    await act(async () => release(mock.logins));
    assert.match(text(), /TENANT-org-b-scope-new-login/); assert.doesNotMatch(text(), /TENANT-org-a/);
    assert.equal(sessionStorage.getItem("ph.v2.organization-id"), "org-b"); assert.equal(sessionReads(), 2);
    assert.deepEqual(writes().map((call) => call.path), ["/v2/auth/login"]);
  });

  await scenario("A delayed organization mutation cannot overwrite a later verified epoch", async () => {
    await mount(server()); await settle(() => text().includes(marker(authSession())), "Alpha loads");
    mock.state.holdSelection = true; await account(); await click("Organization Bravo");
    await settle(() => mock.selections.length === 1, "Accepted selection wire response is delayed");
    assert.match(text(), /Restoring secure session/);
    mock.state.session = authSession("org-a", "scope-later-selection");
    await act(async () => window.dispatchEvent(new window.Event("v2:session-context-changed")));
    await settle(() => text().includes(marker(mock.state.session!)), "Later trusted epoch restores Alpha");
    await act(async () => release(mock.selections));
    assert.match(text(), /TENANT-org-a-scope-later-selection/); assert.doesNotMatch(text(), /TENANT-org-b/);
    assert.equal(window.location.pathname, "/prepress", "Superseded selection must not perform its late URL reset");
    assert.equal(sessionStorage.getItem("ph.v2.organization-id"), "org-a"); assert.equal(sessionReads(), 2); assert.equal(writes().length, 1);
  });

  await scenario("Verified empty organization is selection, not a permanently disabled App", async () => {
    await mount(server()); await settle(() => text().includes(marker(authSession())), "Alpha loads");
    await invalidate({ ...authSession(), activeOrganizationId: null, sessionScope: "scope-no-org" });
    await settle(() => text().includes("Select organization"), "Server session with no active org enters selection");
    assert.doesNotMatch(text(), /Prepress Queue|TENANT-org-a/); assert.equal(sessionStorage.getItem("ph.v2.organization-id"), null);
    await click("Organization Bravo"); await settle(() => text().includes("Organization Bravo") && mock.calls.some((call) => call.path === "/v2/organizations/org-b/ui-bootstrap"), "Verified selection restores application");
    await click("Prepress"); await settle(() => text().includes(marker(mock.state.session!)), "Selected Bravo loads Prepress");
    assert.equal(writes().length, 1); assertNoOldCache("scope-a");
    await mount(server({ ...authSession(), activeOrganizationId: null, organizations: [] }));
    await settle(() => text().includes("Select organization"), "Empty membership list also gates App");
    assert.equal(mounts, 0); assert.equal(mock.calls.length, 1); assert.equal(writes().length, 0);
  });

  await scenario("Direct unauthorized capability state renders no queue reads or previous tenant data", async () => {
    const next = server(); next.state.canView = false; await mount(next);
    await settle(() => mock.calls.some((call) => call.path.endsWith("/ui-bootstrap")), "Bootstrap verifies restricted capabilities");
    assert.match(text(), /do not have permission to view Prepress/);
    assert.equal(mock.calls.some((call) => call.path.endsWith("/queue")), false); assert.equal(writes().length, 0);
  });

  await scenario("Sign out clears pending old data before server logout completes and old headers cannot restore it", async () => {
    const next = server(); next.state.holdQueues = true; next.state.holdLogout = true; await mount(next);
    await settle(() => mock.queues.length === 2, "Alpha queues remain in flight");
    await account(); await click("Sign out");
    assert.doesNotMatch(text(), /Prepress Queue|TENANT-org-a/); assertNoOldCache("scope-a");
    await act(async () => release(mock.queues));
    assert.equal(events, 0); assert.equal(sessionReads(), 1);
    await act(async () => window.dispatchEvent(new window.Event("v2:session-context-changed")));
    assert.equal(sessionReads(), 1, "Context notifications during explicit signout cannot reinstall a session");
    await act(async () => release(mock.logouts)); await settle(() => text().includes("Staff sign in"), "Logout completes at sign in");
    assert.equal(sessionStorage.getItem("ph.v2.organization-id"), null); assert.equal(salesWorkspaceTransport.commandHeaders("org-a")["x-v2-csrf-token"], "");
    assert.deepEqual(writes().map((call) => call.path), ["/v2/auth/logout"]);
  });

  await scenario("Unmounted pending restoration cannot overwrite a newer mount, org switch or logout", async () => {
    const next = server(); next.state.holdSessions = true; await mount(next);
    await settle(() => mock.sessions.length === 1, "Old mount has a pending session read"); const old = mock.sessions.shift()!;
    await act(async () => root.unmount()); root = createRoot(document.getElementById("root")!);
    mock.state.holdSessions = false; mock.state.session = authSession("org-b", "scope-b"); await render();
    await settle(() => text().includes(marker(mock.state.session!)), "New mount restores Bravo");
    await account(); await click("Organization Alpha");
    await settle(() => text().includes("Organization Alpha") && mock.calls.some((call) => call.path === "/v2/organizations/org-a/ui-bootstrap"), "New org selection accepted");
    await account(); await click("Sign out"); await settle(() => text().includes("Staff sign in"), "New mount signs out");
    const acceptedMounts = mounts;
    await act(async () => old.resolve(old.response));
    assert.match(text(), /Staff sign in/); assert.equal(mounts, acceptedMounts); assert.equal(sessionStorage.getItem("ph.v2.organization-id"), null);
    assert.equal(sessionReads(), 2); assert.equal(writes().length, 2);
  });

  await scenario("Selection and signout transport errors clear stale UI/cache without automatic auth writes", async () => {
    await mount(server()); await settle(() => text().includes(marker(authSession())), "Alpha loads"); mock.state.selectionFailure = true;
    await account(); await click("Organization Bravo"); await settle(() => text().includes("Staff sign in"), "Failed selection gates stale App");
    assertNoOldCache("scope-a"); assert.doesNotMatch(text(), /TENANT-org-a|Prepress Queue/); assert.equal(writes().length, 1);
    await mount(server()); await settle(() => text().includes(marker(authSession())), "Alpha loads again"); mock.state.logoutFailure = true;
    await account(); await click("Sign out"); await settle(() => text().includes("Staff sign in"), "Failed logout still clears client data");
    assertNoOldCache("scope-a"); assert.equal(writes().length, 1); assert.equal(sessionReads(), 1);
  });

  await scenario("Existing dirty workspace blocks voluntary navigation but not forced server auth teardown", async () => {
    const next = server(); next.state.workspace = { id: "workspace-a", organizationId: "org-a", creatorUserId: "staff-a", kind: "new_sales", state: "draft", revision: 1,
      header: { jobLabel: "Saved draft" }, lines: [], createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z", expiresAt: "2026-12-01T00:00:00Z" };
    await mount(next, "/quotes/new?workspaceId=workspace-a");
    await settle(() => text().includes("Draft revision 1"), "Actual App loads existing Sales workspace");
    const field = [...document.querySelectorAll("label")].find((node) => node.textContent?.startsWith("Job Label"))?.querySelector("input");
    assert.ok(field); await act(async () => { field.value = "Unsaved private Alpha draft"; Simulate.change(field); });
    await click("Prepress"); assert.equal(window.location.pathname, "/quotes/new"); assert.match(text(), /Local edits or an uncertain Save/);
    assert.equal(field.value, "Unsaved private Alpha draft"); assert.equal(writes().length, 0);
    mock.state.holdSessions = true; await invalidate(authSession("org-b", "scope-b"));
    assert.match(text(), /Restoring secure session/); assert.doesNotMatch(text(), /Unsaved private Alpha draft|Saved draft/); assertNoOldCache("scope-a");
    await act(async () => { window.history.replaceState({}, "", "/prepress"); mock.state.holdSessions = false; release(mock.sessions); });
    await settle(() => text().includes(marker(mock.state.session!)), "Forced auth teardown remounts clean Bravo App");
    assert.equal(writes().length, 0); assert.equal(teardowns, 1); assert.doesNotMatch(text(), /Unsaved private Alpha draft/);
  });

  await scenario("A committed Save's obsolete response is recovered from its durable workspace receipt without another write", async () => {
    const next = server(); next.state.holdPromotion = true;
    next.state.workspace = { id: "workspace-a", organizationId: "org-a", creatorUserId: "staff-a", kind: "new_sales", state: "draft", revision: 1,
      header: { jobLabel: "Valid saved draft", customerContact: { organizationId: "org-a", customerId: "customer-a" } },
      lines: [{ id: "line-a", workspaceId: "workspace-a", position: 0, revision: 1, input: { productId: "product-a", description: "Saved sign", quantity: 1, selections: {} } }],
      createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z", expiresAt: "2026-12-01T00:00:00Z" };
    await mount(next, "/quotes/new?workspaceId=workspace-a"); await settle(() => text().includes("Draft revision 1"), "Actual App loads a durable draft");
    await click("Save Order"); await settle(() => mock.promotions.length === 1, "Owner commits Save before its response is released");
    assert.equal(mock.state.commits, 1); const oldResponse = mock.promotions[0];
    const requestId = writes()[0].body?.requestId;
    assert.equal(mock.state.workspace?.promotion?.requestId, requestId); assert.equal(mock.state.workspace?.state, "promoted");
    await invalidate(authSession("org-a", "scope-after-save"));
    await settle(() => text().includes("Saved as order ORD-SAVED"), "Verified same-tenant reload reads the durable receipt");
    await act(async () => release(mock.promotions));
    assert.equal(oldResponse.scopeHeaderReads, 0); assert.equal(events, 1); assert.equal(sessionReads(), 2);
    assert.equal(mock.state.commits, 1); assert.equal(writes().length, 1, "Session recovery neither retries Save nor creates a replacement request identity");
    assert.match(text(), /Saved as order ORD-SAVED/); assert.equal(window.location.pathname, "/quotes/new");
    assert.equal(salesWorkspaceTransport.commandHeaders("org-a")["x-v2-csrf-token"], "api-csrf-scope-after-save");
  });
} finally {
  await act(async () => root.unmount());
  if (mock) { release(mock.queues); release(mock.sessions); release(mock.logouts); release(mock.logins); release(mock.selections); release(mock.promotions); }
  client.clear(); clearV2ApiSessionState(); window.removeEventListener("v2:session-context-changed", eventListener);
  globalThis.fetch = originalFetch;
  if (previousCss) require.extensions[".css"] = previousCss; else delete require.extensions[".css"];
  for (const [key, descriptor] of previous) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); }
  dom.window.close();
}
console.log(`Actual App/AuthGate Prepress session-recovery regressions passed: ${scenarios} scenarios.`);
