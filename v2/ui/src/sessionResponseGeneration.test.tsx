import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { clearV2ApiSessionState, prepressApi, quoteApi, salesWorkspaceTransport, type ApiError } from "./api";
import { createSalesWorkspaceClient, workspaceError } from "./salesWorkspaceApi";

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "https://ui.invalid/prepress" });
const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
Object.defineProperty(globalThis, "window", { configurable: true, value: dom.window });
const originalFetch = globalThis.fetch;
const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
};
const ok = (data: unknown, scope?: string) => new Response(JSON.stringify({ ok: true, data }), {
  headers: { "content-type": "application/json", ...(scope ? { "x-v2-session-scope": scope } : {}) },
});
const bootstrap = (org: string, scope: string, csrf = `csrf-${scope}`) => ({ organizationId: org, userId: "staff", sessionScope: scope, csrfToken: csrf, capabilities: { quoteOverridePrice: false } });
let events = 0;
const changed = (event: Event) => {
  assert.ok(event instanceof dom.window.Event, "Session events use the receiving window's realm, not Node's global Event");
  events++;
};
window.addEventListener("v2:session-context-changed", changed);
const obsolete = (reason: unknown) => {
  assert.equal((reason as ApiError).code, "SESSION_CONTEXT_CHANGED");
  assert.doesNotMatch((reason as ApiError).message, /no (?:write|change)|not (?:saved|committed)|nothing was/i);
  return true;
};
let scenarios = 0;
const scenario = async (name: string, work: () => Promise<void>) => {
  clearV2ApiSessionState(); events = 0;
  await work(); scenarios++; console.log(`PASS ${name}`);
};
const establish = async (org: string, scope: string) => {
  globalThis.fetch = async () => ok(bootstrap(org, scope), scope);
  await quoteApi.bootstrap(org);
};

try {
  await scenario("Old tenant headers, successful bodies and errors cannot reset the accepted tenant or CSRF", async () => {
    await establish("org-a", "scope-a");
    const held = [deferred<Response>(), deferred<Response>()];
    let started = 0;
    globalThis.fetch = async () => held[started++].promise;
    const requests = [prepressApi.list("org-a"), prepressApi.list("org-a")];
    const results = requests.map((request) => assert.rejects(request, obsolete));
    assert.equal(started, 2);
    clearV2ApiSessionState();
    await establish("org-b", "scope-b");
    let parsed = 0;
    const staleSuccess = ok({ tenant: "org-a" }, "scope-a");
    staleSuccess.json = async () => { parsed++; return { ok: true, data: { tenant: "org-a" } }; };
    const staleError = new Response(JSON.stringify({ ok: false, error: { code: "FORBIDDEN", message: "Old rejection" } }), { status: 403, headers: { "x-v2-session-scope": "scope-a" } });
    staleError.json = async () => { parsed++; return { ok: false, error: { code: "FORBIDDEN" } }; };
    held[0].resolve(staleSuccess); held[1].resolve(staleError);
    await Promise.all(results);
    assert.equal(parsed, 0, "Obsolete fetch responses are rejected before body/error adoption");
    assert.equal(events, 0, "An obsolete response never emits a second invalidation");
    assert.equal(salesWorkspaceTransport.commandHeaders("org-b")["x-v2-csrf-token"], "csrf-scope-b");
    globalThis.fetch = async () => ok({ tenant: "org-b" }, "scope-b");
    assert.deepEqual(await salesWorkspaceTransport.request("/v2/organizations/org-b/read"), { tenant: "org-b" });
    assert.equal(events, 0);
  });

  await scenario("A bootstrap paused inside JSON cannot adopt its old body epoch or token", async () => {
    const body = deferred<unknown>();
    const parsing = deferred<void>();
    globalThis.fetch = async () => {
      const response = ok(null);
      response.json = () => { parsing.resolve(); return body.promise; };
      return response;
    };
    const old = quoteApi.bootstrap("org-a");
    const rejected = assert.rejects(old, obsolete);
    await parsing.promise;
    clearV2ApiSessionState();
    await establish("org-b", "scope-b");
    body.resolve({ ok: true, data: bootstrap("org-a", "scope-a", "obsolete-token") });
    await rejected;
    assert.equal(events, 0);
    assert.equal(salesWorkspaceTransport.commandHeaders("org-a")["x-v2-csrf-token"], "");
    assert.equal(salesWorkspaceTransport.commandHeaders("org-b")["x-v2-csrf-token"], "csrf-scope-b");
  });

  await scenario("A response already parsing when logout clears the generation cannot deliver data", async () => {
    await establish("org-a", "scope-a");
    const body = deferred<unknown>();
    const parsing = deferred<void>();
    globalThis.fetch = async () => {
      const response = ok(null, "scope-a");
      response.json = () => { parsing.resolve(); return body.promise; };
      return response;
    };
    const old = salesWorkspaceTransport.request("/v2/organizations/org-a/read");
    const rejected = assert.rejects(old, obsolete);
    await parsing.promise;
    clearV2ApiSessionState();
    body.resolve({ ok: true, data: { secret: "old-tenant" } });
    await rejected;
    assert.equal(events, 0);
    assert.equal(salesWorkspaceTransport.commandHeaders("org-a")["x-v2-csrf-token"], "");
  });

  await scenario("A genuine current response epoch invalidates once without accepting foreign data", async () => {
    await establish("org-a", "scope-a");
    const sibling = deferred<Response>();
    globalThis.fetch = async () => sibling.promise;
    const old = salesWorkspaceTransport.request("/v2/organizations/org-a/read");
    const rejectedSibling = assert.rejects(old, obsolete);
    let parsed = false;
    globalThis.fetch = async () => {
      const response = ok({ secret: "foreign" }, "scope-new");
      response.json = async () => { parsed = true; return { ok: true, data: { secret: "foreign" } }; };
      return response;
    };
    await assert.rejects(salesWorkspaceTransport.request("/v2/organizations/org-a/read"), obsolete);
    assert.equal(events, 1);
    assert.equal(parsed, false);
    assert.equal(salesWorkspaceTransport.commandHeaders("org-a")["x-v2-csrf-token"], "");
    sibling.resolve(ok({ secret: "older" }, "scope-a"));
    await rejectedSibling;
    assert.equal(events, 1);
    await establish("org-b", "scope-new");
    assert.equal(events, 1, "Server-verified renewal does not loop on bootstrap scope adoption");
    assert.equal(salesWorkspaceTransport.commandHeaders("org-b")["x-v2-csrf-token"], "csrf-scope-new");
  });

  await scenario("Bootstrap body-only epoch replacement is rejected rather than cached", async () => {
    await establish("org-a", "scope-a");
    globalThis.fetch = async () => ok(bootstrap("org-b", "scope-new"));
    await assert.rejects(quoteApi.bootstrap("org-a"), obsolete);
    assert.equal(events, 1);
    assert.equal(salesWorkspaceTransport.commandHeaders("org-a")["x-v2-csrf-token"], "");
  });

  await scenario("An obsolete committed workspace mutation stays unknown and existing receipt replay stays exact", async () => {
    await establish("org-a", "scope-a");
    const client = createSalesWorkspaceClient(salesWorkspaceTransport);
    const held = deferred<Response>();
    const calls: { method: string; body: unknown; csrf: string | null }[] = [];
    let commits = 0;
    const receipt = { receipt: { workspaceId: "workspace-a", organizationId: "org-a", requestId: "same-request", documentId: "order-a" }, replayed: false };
    globalThis.fetch = async (_input, init) => {
      calls.push({ method: init?.method ?? "GET", body: JSON.parse(String(init?.body)), csrf: new Headers(init?.headers).get("x-v2-csrf-token") });
      commits++;
      return held.promise;
    };
    const input = { workspaceId: "workspace-a", target: "order" as const, requestId: "same-request", expectedRevision: 3 };
    const submitted = client.promote("org-a", input);
    let failure: unknown;
    const finished = submitted.catch((reason) => { failure = reason; });
    clearV2ApiSessionState();
    await establish("org-a", "scope-renewed");
    held.resolve(ok(receipt, "scope-a"));
    await finished;
    assert.ok(obsolete(failure));
    assert.ok(!["VALIDATION_ERROR", "FORBIDDEN", "NOT_FOUND", "WRONG_TENANT", "CONFLICT", "STALE_STATE"].includes(workspaceError(failure).code), "Generation rejection is not a definitive owner/no-write rejection");
    assert.equal(commits, 1);
    assert.equal(calls.length, 1, "Transport never automatically retries a write");
    globalThis.fetch = async (_input, init) => {
      calls.push({ method: init?.method ?? "GET", body: JSON.parse(String(init?.body)), csrf: new Headers(init?.headers).get("x-v2-csrf-token") });
      return ok({ ...receipt, replayed: true }, "scope-renewed");
    };
    const replay = await client.promote("org-a", input);
    assert.equal(replay.replayed, true);
    assert.deepEqual(calls.map((call) => call.body), [{ target: "order", requestId: "same-request", expectedRevision: 3 }, { target: "order", requestId: "same-request", expectedRevision: 3 }]);
    assert.deepEqual(calls.map((call) => call.csrf), ["csrf-scope-a", "csrf-scope-renewed"]);
    assert.equal(commits, 1);
    assert.equal(events, 0);
  });
} finally {
  clearV2ApiSessionState();
  window.removeEventListener("v2:session-context-changed", changed);
  globalThis.fetch = originalFetch;
  if (previousWindow) Object.defineProperty(globalThis, "window", previousWindow); else Reflect.deleteProperty(globalThis, "window");
  dom.window.close();
}
console.log(`Session response-generation regressions passed: ${scenarios} scenarios.`);
