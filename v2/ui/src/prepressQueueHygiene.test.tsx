import assert from "node:assert/strict";
import React, { act } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { JSDOM } from "jsdom";
import { PrepressWorkspace } from "./PrepressWorkspace";
import { prepressApi, type PrepressQueueItem } from "./api";

const dom = new JSDOM("<!doctype html><html><body><div id='root'></div></body></html>");
Object.assign(globalThis, { window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, Event: dom.window.Event, IS_REACT_ACT_ENVIRONMENT: true });
Object.defineProperty(globalThis, "navigator", { value: dom.window.navigator, configurable: true });
const { createRoot } = await import("react-dom/client");
const configured: PrepressQueueItem = { orderId: "order-active", orderNumber: "ORD-ACTIVE", customerDisplayName: "Current Customer", orderLineId: "line-active", lineDescription: "Configured sign", quantity: 1, routingStepKind: "prepress", coverage: { state: "configured", productionArtworkComplete: false, allRequiredPrepressUnitsComplete: false, requirements: [{ requirement: { key: "front", side: "front" }, artworkAssignmentIds: [], prepressUnits: [], productionArtworkCovered: false, prepressComplete: false }] } };
const historical: PrepressQueueItem = { orderId: "order-history", orderNumber: "ORD-HISTORY", customerDisplayName: "QA Customer", orderLineId: "line-history", lineDescription: "Historical unconfigured sign", quantity: 1, routingStepKind: "prepress", coverage: { state: "unconfigured", requirements: [], productionArtworkComplete: false, allRequiredPrepressUnitsComplete: false } };
const reads: URL[] = [];
const methods: string[] = [];
const originalFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = new URL(String(input), "http://localhost");
  reads.push(url); methods.push(init?.method ?? "GET");
  let data: unknown = [];
  if (url.pathname.endsWith("/queue")) {
    const state = url.searchParams.get("requirementState") ?? "all";
    const search = url.searchParams.get("q")?.toLowerCase() ?? "";
    const items = url.pathname.includes("/org-a/") ? [configured, historical].filter(item => (state === "all" || item.coverage.state === state) && `${item.orderNumber} ${item.customerDisplayName} ${item.lineDescription}`.toLowerCase().includes(search)) : [];
    data = { items, pagination: { page: 1, pageSize: 25, totalCount: items.length, totalPages: items.length ? 1 : 0 } };
  } else if (url.pathname.endsWith("/units/unit-history")) {
    data = { prepressUnitId: "unit-history", organizationId: "org-a", orderId: historical.orderId, orderLineId: historical.orderLineId, artworkAssignmentId: "assignment-history", artworkFileId: "file-history", createdAt: "2026-01-01", createdPrincipalKind: "staff", createdPrincipalSubject: "staff-a" };
  }
  return new Response(JSON.stringify({ ok: true, data }), { status: 200, headers: { "content-type": "application/json" } });
};
const props = { organizationId: "org-a", sessionScope: "scope-a", canView: true, canArtworkAssign: true, canWork: true, canComplete: true };
const root = createRoot(document.getElementById("root")!);
let client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
const openedOrders: string[] = [];
const render = async (overrides: Partial<React.ComponentProps<typeof PrepressWorkspace>> = {}, key = "default") => {
  await act(async () => { root.render(<QueryClientProvider client={client}><PrepressWorkspace key={key} {...props} {...overrides} openOrder={id => openedOrders.push(id)} /></QueryClientProvider>); });
};
const settle = async (predicate: () => boolean) => {
  for (let i = 0; i < 30 && !predicate(); i++) await act(async () => { await new Promise(resolve => setTimeout(resolve, 5)); });
  assert.ok(predicate(), "the expected Prepress view must finish loading");
};
const text = () => document.body.textContent ?? "";
const button = (name: string) => {
  const element = [...document.querySelectorAll("button")].find(item => item.textContent === name);
  assert.ok(element, `Button ${name} is visible`);
  return element;
};
const click = async (name: string) => { await act(async () => { button(name).click(); }); };
const search = async (value: string) => {
  await act(async () => {
    const input = document.querySelector('input[aria-label="Search Prepress queue"]')!;
    Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
  });
};
try {
  await render({ canView: false });
  assert.match(text(), /do not have permission/);
  assert.equal(reads.length, 0, "no queue requests without prepress.view");
  await render();
  await settle(() => text().includes("Configured sign") && text().includes("Needs configuration (1)"));
  assert.equal(button("Active work").getAttribute("aria-pressed"), "true");
  assert.doesNotMatch(text(), /Historical unconfigured sign/);
  assert.ok(reads.some(url => url.searchParams.get("requirementState") === "configured"));
  assert.ok(reads.some(url => url.searchParams.get("requirementState") === "unconfigured"));

  await search("unrelated");
  await settle(() => text().includes("No Prepress work matches this search."));
  assert.ok(reads.some(url => url.searchParams.get("q") === "unrelated" && url.searchParams.get("requirementState") === "configured" && url.searchParams.get("page") === "1"), "search is sent to the canonical paged API");
  await search("");
  await settle(() => text().includes("Configured sign") && text().includes("Needs configuration (1)"));

  await click("Needs configuration (1)");
  await settle(() => text().includes("Historical unconfigured sign"));
  assert.equal(button("Needs configuration (1)").getAttribute("aria-pressed"), "true");
  assert.doesNotMatch(text(), /Configured sign|Start Prepress|Complete Prepress|Use customer Artwork for Production/);
  assert.match(text(), /no frozen production requirements/);
  assert.match(text(), /Requirements unconfigured/);
  assert.doesNotMatch(text(), /This required unit remains visible/);
  await click("Open Order");
  assert.deepEqual(openedOrders, ["order-history"], "recovery keeps the canonical Order available");

  await click("All routed work");
  await settle(() => text().includes("Configured sign") && text().includes("Historical unconfigured sign"));
  await click("Active work");
  await settle(() => !text().includes("Historical unconfigured sign"));
  await render({ organizationId: "org-b", sessionScope: "scope-b" });
  await settle(() => text().includes("No active Prepress work"));
  assert.doesNotMatch(text(), /ORD-ACTIVE|ORD-HISTORY/);

  for (const deepLink of [{ lineId: "line-history" }, { prepressUnitId: "unit-history" }]) {
    client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
    await render(deepLink, JSON.stringify(deepLink));
    await settle(() => document.querySelector(".v2-prepress-main h1")?.textContent === "Historical unconfigured sign");
    assert.equal(button("All routed work").getAttribute("aria-pressed"), "true", "existing line and unit deep links include historical work");
    assert.doesNotMatch(text(), /selected Prepress work is unavailable/);
    assert.doesNotMatch(text(), /Start Prepress|Complete Prepress|Use customer Artwork for Production/);
  }
  await act(async () => { root.unmount(); });
  reads.length = 0;
  await prepressApi.list("org-a");
  assert.equal(reads[0]?.searchParams.has("requirementState"), false, "Production and old API consumers keep their unfiltered request");
  const all = await prepressApi.list("org-a", { requirementState: "all" });
  assert.equal(all.items.length, 2);
  await prepressApi.list("org-a", { requirementState: "unconfigured", page: 2, pageSize: 50, search: " QA " });
  assert.equal(reads.at(-1)?.searchParams.get("requirementState"), "unconfigured");
  assert.equal(reads.at(-1)?.searchParams.get("q"), "QA");
  assert.equal(reads.at(-1)?.searchParams.get("page"), "2");
  assert.equal(reads.at(-1)?.searchParams.get("pageSize"), "50");
  assert.ok(methods.every(method => method === "GET"), "reviewing recovery never writes or fabricates requirements");
} finally {
  globalThis.fetch = originalFetch;
  client.clear();
  dom.window.close();
}
console.log("Prepress active/recovery UI, safe deep links, permission/tenant transitions and API compatibility regressions passed.");
