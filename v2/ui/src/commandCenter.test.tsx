import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import React, { act } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { JSDOM } from "jsdom";
import { CommandCenter } from "./CommandCenter";
import { clearV2ApiSessionState, type ActionCenterItem } from "./api";

assert.equal(process.env.V2_VALIDATION_MODE, "deterministic", "Use the sanitized deterministic runner.");
const dom = new JSDOM("<!doctype html><html><body><div id='root'></div></body></html>", { url: "https://ui.invalid/" });
const globals = { React, window: dom.window, document: dom.window.document, navigator: dom.window.navigator,
  HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true };
const previous = new Map(Object.keys(globals).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
const originalFetch = globalThis.fetch;
const { createRoot } = await import("react-dom/client");
const newClient = () => new QueryClient({ defaultOptions: { queries: {
  gcTime: Infinity, staleTime: Infinity,
  // Even a host's keep-previous-data default must not cross session/tenant keys.
  placeholderData: (previousData: unknown) => previousData,
} } });
let client = newClient();
let root = createRoot(document.getElementById("root")!);
const calls: { path: string; method: string; body: unknown; resolve: (response: Response) => void }[] = [];
const unexpected: string[] = [];
globalThis.fetch = async (input, init) => {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, window.location.origin);
  const method = init?.method ?? "GET";
  if (url.origin !== window.location.origin || !/^\/v2\/organizations\/org-[ab]\/action-center$/.test(url.pathname) || method !== "GET") {
    unexpected.push(`${method} ${url.href}`);
    throw new Error("Only the inert action-summary GET is allowed.");
  }
  assert.equal(init?.credentials, "include");
  assert.equal(init?.cache, "no-store");
  return new Promise<Response>((resolve) => { calls.push({ path: url.pathname, method, body: init?.body, resolve }); });
};
const item = (count: number, label = "Inbound needs review"): ActionCenterItem => ({ kind: "inbound", label, count, href: "/inbound-orders" });
const text = () => document.body.textContent ?? "";
const counts = () => [...document.querySelectorAll("article b")].map((node) => node.textContent);
const queryKey = (scope = "scope-a", org = "org-a") => ["v2", scope, org, "action-center"];
async function settle(predicate: () => boolean) {
  for (let attempt = 0; attempt < 150 && !predicate(); attempt++) await act(async () => { await new Promise((resolve) => setTimeout(resolve, 5)); });
  assert.ok(predicate(), `Command Center did not settle: ${text()}`);
}
async function render(scope = "scope-a", org = "org-a") {
  await act(async () => root.render(<QueryClientProvider client={client}><CommandCenter organizationId={org} sessionScope={scope} /></QueryClientProvider>));
}
async function mount(scope = "scope-a", org = "org-a") {
  await act(async () => root.unmount()); client.clear(); clearV2ApiSessionState();
  root = createRoot(document.getElementById("root")!); client = newClient();
  await render(scope, org);
}
async function respond(index: number, items: readonly ActionCenterItem[] = [], status = 200) {
  const body = status === 200 ? { ok: true, data: { items } } : { ok: false, error: {
    code: status === 403 ? "FORBIDDEN" : "INTERNAL_ERROR", message: "PRIVATE_READER_DETAIL must not be displayed",
  } };
  await act(async () => calls[index].resolve(new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })));
}
async function click(label: string) {
  const button = [...document.querySelectorAll("button")].find((node) => node.textContent === label);
  assert.ok(button, `Missing ${label}`); assert.equal(button.disabled, false);
  await act(async () => button.click());
  await settle(() => button.disabled);
}
let cases = 0;
async function check(name: string, action: () => Promise<void>) {
  await action(); cases++; console.log(`PASS ${name}`);
}

try {
  await check("missing session or organization issues no read and displays no counts", async () => {
    const before = calls.length;
    for (const [scope, org] of [["", "org-a"], ["scope-a", ""]]) {
      await mount(scope, org);
      assert.match(text(), /Enter an authenticated organization/);
      assert.deepEqual(counts(), []); assert.equal(document.querySelector("button"), null);
    }
    assert.equal(calls.length, before);
  });
  await check("initial loading, successful zero, refresh and no permitted categories are distinct", async () => {
    const before = calls.length;
    await mount(); await settle(() => calls.length === before + 1);
    assert.match(document.querySelector('[role="status"]')!.textContent!, /Loading action summary/);
    assert.deepEqual(counts(), []); assert.doesNotMatch(text(), /No permitted|items need attention|unavailable|denied/);
    assert.equal(document.querySelector("button")!.disabled, true);
    await respond(before, [item(0)]); await settle(() => counts().length === 1);
    assert.deepEqual(counts(), ["0"]); assert.match(text(), /items need attention/);
    assert.equal(document.querySelector("article a")!.getAttribute("href"), "/inbound-orders");
    assert.doesNotMatch(text(), /No permitted|Loading action summary/);
    await click("Refresh action summary"); await settle(() => calls.length === before + 2);
    assert.match(text(), /Refreshing action summary/); assert.deepEqual(counts(), []);
    await respond(before + 1); await settle(() => text().includes("No permitted operational action categories"));
    assert.deepEqual(counts(), []); assert.doesNotMatch(text(), /items need attention|unavailable|denied/);
  });
  for (const status of [403, 500]) {
    await check(`cached success then ${status} hides counts until explicit read-only retry succeeds`, async () => {
      const before = calls.length;
      await mount(); await settle(() => calls.length === before + 1);
      await respond(before, [item(23)]); await settle(() => counts()[0] === "23");
      // Exercise a background refetch, not just the new refresh button.
      await act(async () => { void client.invalidateQueries({ queryKey: queryKey() }); });
      await settle(() => calls.length === before + 2 && text().includes("Refreshing action summary"));
      assert.deepEqual(counts(), []);
      await respond(before + 1, [], status); await settle(() => Boolean(document.querySelector('[role="alert"]')));
      assert.match(text(), status === 403 ? /Access to the action summary was denied/ : /action summary service is unavailable/);
      assert.deepEqual(counts(), []); assert.doesNotMatch(text(), /Inbound needs review|PRIVATE_READER_DETAIL|No permitted/);
      assert.deepEqual(client.getQueryData(queryKey()), { items: [item(23)] }, "The test must actually retain stale React Query data");
      assert.equal(client.getQueryState(queryKey())!.status, "error");
      assert.equal(calls.length, before + 2, "Failures do not automatically retry");
      await click("Retry action summary"); await settle(() => calls.length === before + 3);
      assert.deepEqual(counts(), []); assert.equal(document.querySelector("button")!.disabled, true);
      await respond(before + 2, [item(7, "Recovered permitted category")]); await settle(() => counts()[0] === "7");
      assert.match(text(), /Recovered permitted category/); assert.doesNotMatch(text(), /Inbound needs review|unavailable|denied|PRIVATE_READER_DETAIL/);
      assert.equal(document.querySelector('[role="alert"]'), null);
      assert.equal(document.querySelector("button")!.textContent, "Refresh action summary");
      assert.equal(calls.length, before + 3);
    });
  }
  for (const [scope, org] of [["scope-b", "org-a"], ["scope-a", "org-b"]]) {
    await check(`replacement ${scope}/${org} never displays prior data or a late prior response`, async () => {
      const before = calls.length;
      await mount(); await settle(() => calls.length === before + 1);
      await respond(before, [item(41, "OLD_SCOPE_COUNT")]); await settle(() => counts()[0] === "41");
      await click("Refresh action summary"); await settle(() => calls.length === before + 2);
      if (scope !== "scope-a") clearV2ApiSessionState();
      await render(scope, org); await settle(() => calls.length === before + 3);
      assert.deepEqual(counts(), []); assert.doesNotMatch(text(), /OLD_SCOPE_COUNT/);
      assert.equal(calls[before + 2].path, `/v2/organizations/${org}/action-center`);
      await respond(before + 1, [item(99, "LATE_OLD_SCOPE_COUNT")]);
      await settle(() => client.getQueryState(queryKey())!.fetchStatus === "idle");
      assert.deepEqual(counts(), []); assert.doesNotMatch(text(), /OLD_SCOPE_COUNT/);
      await respond(before + 2, [item(3, "NEW_SCOPE_COUNT")]); await settle(() => counts()[0] === "3");
      assert.match(text(), /NEW_SCOPE_COUNT/); assert.doesNotMatch(text(), /OLD_SCOPE_COUNT/);
      assert.deepEqual(client.getQueryData(queryKey(scope, org)), { items: [item(3, "NEW_SCOPE_COUNT")] });
    });
  }
  assert.deepEqual(unexpected, []);
  assert.ok(calls.length > 0 && calls.every((call) => call.method === "GET" && call.body === undefined));
  assert.equal(client.getMutationCache().getAll().length, 0, "Recovery must never create mutations");

  const source = readFileSync(new URL("./CommandCenter.tsx", import.meta.url), "utf8");
  assert.match(source, /actionCenterApi\.summary\(organizationId\)/, "Command Center must use the server-owned action summary.");
  assert.doesNotMatch(source, /quoteApi|orderApi|financeApi/, "Command Center must not fan out into client workspace reads.");
  assert.doesNotMatch(source.split("function PaymentSummaryCard")[0], /dataUpdatedAt|new Date|as of|snapshot time/i, "Client retrieval must not masquerade as canonical snapshot time.");

  console.log(`Command Center: ${cases} mounted React Query/action-summary transport scenarios passed; GET-only recovery.`);
} finally {
  await act(async () => root.unmount()); client.clear(); clearV2ApiSessionState(); globalThis.fetch = originalFetch; dom.window.close();
  for (const [key, descriptor] of previous) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key);
  }
}
