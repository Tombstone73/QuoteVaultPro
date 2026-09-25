import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { OrderArtworkPanel } from "./OrderWorkspace";
import { OrderLineArtworkCompact, OrderLineArtworkDetail } from "./OrderLineArtwork";
import { artworkApi, type ArtworkOrderProjection, type ArtworkRemovalResult } from "./api";
import { cacheOrderArtworkRemoval, cacheOrderArtworkUpload, confirmArtworkProjection, orderArtworkKey } from "./orderArtworkCache";

const dom = new JSDOM("<div id='root'></div>", { url: "https://qa.invalid" });
Object.assign(globalThis, { window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true });
dom.window.HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
dom.window.HTMLDialogElement.prototype.close = function () { this.removeAttribute("open"); };
const container = document.getElementById("root")!, root = createRoot(container);
const key = orderArtworkKey("session", "org-a", "order-a");
const entry = (id: string): ArtworkOrderProjection => ({
  file: { id: `file-${id}`, originalFilename: `${id}.pdf`, displayFilename: `${id}.pdf`, contentType: "application/pdf", byteSize: 12, source: "customer_upload", createdAt: "2026-09-25T00:00:00Z" },
  assignment: { id: `assignment-${id}`, artworkFileId: `file-${id}`, orderId: "order-a", orderLineId: "line-a", purpose: "customer_supplied", side: "front", createdAt: "2026-09-25T00:00:00Z" },
});
const other = { ...entry("b"), assignment: { ...entry("b").assignment, id: "b-other", orderLineId: "line-other" } };
let backend: readonly ArtworkOrderProjection[] = [entry("a"), entry("b"), entry("c"), other];
const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
client.setQueryData(key, backend);
const removed = new Set<string>();
const load = async () => confirmArtworkProjection(backend, [], [...removed]);
let refreshFailed = false;
const complete = async (result: ArtworkRemovalResult) => {
  removed.add(result.assignment.id);
  await cacheOrderArtworkRemoval(client, key, result.assignment.id);
  try { await client.fetchQuery({ queryKey: key, queryFn: load, staleTime: 0 }); removed.delete(result.assignment.id); }
  catch { refreshFailed = true; }
};
const Harness = ({ canRemove = true, canView = true }: { canRemove?: boolean; canView?: boolean }) => {
  const query = useQuery({ queryKey: key, queryFn: load, staleTime: Infinity });
  const artwork = query.data ?? [], removal = canRemove ? { orderNumber: "ORD-1018", onRemoved: complete } : undefined;
  return <>
    <div data-view="items"><OrderLineArtworkCompact organizationId="org-a" orderLineId="line-a" artwork={artwork} loading={false} canView={canView} onOpen={() => undefined} /></div>
    <div data-view="line"><OrderLineArtworkDetail organizationId="org-a" orderLineId="line-a" artwork={artwork} loading={false} canView={canView} onOpen={() => undefined} removal={removal} /></div>
    <div data-view="order"><OrderArtworkPanel organizationId="org-a" orderId="order-a" orderNumber="ORD-1018" lines={[{ lineId: "line-a", description: "Banner" }]} artwork={artwork} loading={false} canView={canView} canUpload={false} onOpen={() => undefined} onUploaded={async () => undefined} removal={removal} /></div>
  </>;
};
const render = (canRemove = true, canView = true) => act(async () => { root.render(<QueryClientProvider client={client}><Harness canRemove={canRemove} canView={canView} /></QueryClientProvider>); });
const view = (name: string) => container.querySelector(`[data-view="${name}"]`)!;
const flush = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
const click = async (name: string, label: string) => { await act(async () => { view(name).querySelector<HTMLButtonElement>(`[aria-label="${label}"]`)!.click(); }); await flush(); };
let confirmed = false, confirmation = "", status = 409;
window.confirm = (message) => { confirmation = String(message); return confirmed; };
const requests: { url: string; body: Record<string, string>; method: string }[] = [];
const originalFetch = globalThis.fetch, originalCreate = URL.createObjectURL, originalRevoke = URL.revokeObjectURL;
const revoked: string[] = [];
URL.createObjectURL = () => "blob:remaining";
URL.revokeObjectURL = (url) => { revoked.push(url); };
let response: unknown = { ok: false, error: { code: "CONFLICT", message: "Artwork is in use by the current Proof" } };
globalThis.fetch = (async (url, init) => {
  requests.push({ url: String(url), body: typeof init?.body === "string" ? JSON.parse(init.body) : {}, method: init?.method ?? "GET" });
  if (!init?.method) return new Response("%PDF-1.4\nremaining", { headers: { "content-type": "application/pdf" } });
  return new Response(JSON.stringify(response), { status, headers: { "content-type": "application/json" } });
}) as typeof fetch;
try {
  await render(false);
  assert.equal(container.querySelectorAll('[aria-label^="Remove Artwork:"]').length, 0, "view/adopt alone cannot remove");
  await render(true, false);
  assert.equal(container.querySelectorAll('[aria-label^="Remove Artwork:"],iframe').length, 0);
  await render();
  assert.equal(container.querySelectorAll('[aria-label^="Remove Artwork:"]').length, 6);
  await click("line", "Remove Artwork: b.pdf");
  assert.match(confirmation, /b.pdf.*Order #ORD-1018.*current job.*retained/);
  assert.equal(requests.length, 0, "cancel must not mutate");
  confirmed = true;
  await click("line", "Remove Artwork: b.pdf");
  assert.match(view("line").textContent!, /in use by the current Proof/);
  assert.equal(client.getQueryData<readonly ArtworkOrderProjection[]>(key)!.length, 4, "failed removal leaves every assignment");
  const retryId = requests.at(-1)!.body.businessRequestId;
  status = 200;
  response = { ok: true, data: { artworkFile: entry("b").file, assignment: entry("b").assignment, removal: { removedAt: "2026-09-25T00:00:00Z", removedByUserId: "staff" } } };
  // Leave canonical read stale: the committed B removal must not be resurrected.
  await click("line", "Remove Artwork: b.pdf");
  assert.equal(requests.at(-1)!.body.businessRequestId, retryId);
  assert.match(requests.at(-1)!.url, /\/artwork\/assignments\/assignment-b\/remove$/);
  assert.deepEqual(Object.keys(requests.at(-1)!.body).sort(), ["businessRequestId", "orderId", "orderLineId"]);
  assert.ok(refreshFailed);
  assert.ok(client.getQueryData<readonly ArtworkOrderProjection[]>(key)!.some((item) => item.assignment.id === "b-other"));
  for (const name of ["line", "order"]) {
    assert.doesNotMatch(view(name).textContent!, /b\.pdf/);
    assert.match(view(name).textContent!, /a\.pdf.*c\.pdf/s);
  }
  assert.match(view("items").textContent!, /2 files/);
  backend = [entry("a"), entry("c"), other];
  await act(async () => { await client.refetchQueries({ queryKey: key }); });
  // A fresh canonical read retains exactly A/C; no frontend-only removal.
  assert.deepEqual(client.getQueryData(key), backend);
  removed.clear();
  backend = [entry("a"), entry("c"), other, entry("d")];
  await act(async () => { await cacheOrderArtworkUpload(client, key, { artworkFile: entry("d").file, assignment: entry("d").assignment }); });
  await flush();
  for (const name of ["line", "order"]) assert.match(view(name).textContent!, /a\.pdf.*c\.pdf.*d\.pdf/s);
  assert.match(view("items").textContent!, /3 files/);
  const writes = requests.filter((r) => r.method === "POST").length;
  await click("order", "View Artwork: c.pdf");
  assert.ok(container.querySelector("object"));
  assert.match(requests.at(-1)!.url, /files\/file-c\/content$/);
  await act(async () => { [...container.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent === "Close Artwork viewer")!.click(); });
  assert.deepEqual(revoked, ["blob:remaining"]);
  assert.equal(requests.filter((r) => r.method === "POST").length, writes, "viewer cannot mutate");
  // Order-wide action uses the same exact-assignment operation.
  response = { ok: true, data: { artworkFile: entry("d").file, assignment: entry("d").assignment, removal: { removedAt: "2026-09-25T00:00:00Z", removedByUserId: "staff" } } };
  backend = [entry("a"), entry("c"), other];
  await click("order", "Remove Artwork: d.pdf");
  assert.match(requests.at(-1)!.url, /assignments\/assignment-d\/remove$/);
  assert.doesNotMatch(view("line").textContent!, /d\.pdf/);
  // An invalid success envelope must never cause cache removal.
  response = { ok: true, data: { assignment: entry("b").assignment, removal: { removedAt: "now" } } };
  await assert.rejects(artworkApi.remove("org-a", "invalid", entry("c").assignment));
  assert.deepEqual(client.getQueryData(key), backend);
} finally {
  await act(async () => { root.unmount(); });
  client.clear(); dom.window.close();
  globalThis.fetch = originalFetch; URL.createObjectURL = originalCreate; URL.revokeObjectURL = originalRevoke;
}
console.log("Order Artwork removal confirmation, authorization, assignment identity, shared views, refetch, additive upload and viewer: PASS");
