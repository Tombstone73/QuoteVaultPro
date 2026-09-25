import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { OrderArtworkPanel } from "./OrderWorkspace";
import { OrderLineArtworkCompact, OrderLineArtworkDetail } from "./OrderLineArtwork";
import { artworkApi, type ArtworkOrderProjection, type ArtworkUploadResult } from "./api";
import { cacheOrderArtworkUpload, orderArtworkKey } from "./orderArtworkCache";

const dom = new JSDOM("<div id='root'></div>", { url: "https://qa.invalid" });
Object.assign(globalThis, { window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true });
const container = document.getElementById("root")!;
const root = createRoot(container);
const key = orderArtworkKey("session-a", "org-a", "order-a");
const entry = (id: string): ArtworkOrderProjection => ({
  file: { id: `file-${id}`, originalFilename: `${id}.pdf`, displayFilename: `${id}.pdf`, contentType: "application/pdf", byteSize: 12, source: "customer_upload", createdAt: "2026-09-25T00:00:00Z" },
  assignment: { id: `assignment-${id}`, artworkFileId: `file-${id}`, orderId: "order-a", orderLineId: "line-a", purpose: "customer_supplied", side: "front", createdAt: "2026-09-25T00:00:00Z" },
});
const result = (id: string): ArtworkUploadResult => ({ artworkFile: entry(id).file, assignment: entry(id).assignment });
const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
client.setQueryData(key, [entry("a")]);
let backend: readonly ArtworkOrderProjection[] = [entry("a")];
let refreshes = 0, completions = 0;
let beforeCache: (() => Promise<void>) | undefined;
const complete = async (value: ArtworkUploadResult) => {
  await beforeCache?.();
  await cacheOrderArtworkUpload(client, key, value);
  completions += 1;
  void client.invalidateQueries({ queryKey: key, exact: true });
};
const Harness = () => {
  const query = useQuery({ queryKey: key, queryFn: async () => { refreshes += 1; return backend; }, staleTime: Infinity });
  const artwork = query.data ?? [];
  return <>
    <div data-view="items"><OrderLineArtworkCompact organizationId="org-a" orderLineId="line-a" artwork={artwork} loading={false} canView onOpen={() => undefined} /></div>
    <div data-view="line"><OrderLineArtworkDetail organizationId="org-a" orderLineId="line-a" artwork={artwork} loading={false} canView canAdopt onOpen={() => undefined} uploadTarget={{ orderId: "order-a", orderLineId: "line-a", orderNumber: "ORD-1", lineDescription: "Banner" }} onUploaded={complete} /></div>
    <div data-view="order"><OrderArtworkPanel organizationId="org-a" orderId="order-a" orderNumber="ORD-1" lines={[{ lineId: "line-a", description: "Banner" }]} artwork={artwork} loading={false} canView canUpload onOpen={() => undefined} onUploaded={complete} /></div>
  </>;
};
const flush = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
const view = (name: string) => container.querySelector(`[data-view="${name}"]`)!;
const clickUpload = async (name: string) => {
  const button = [...view(name).querySelectorAll("button")].find((node) => node.textContent === "Upload Artwork")!;
  await act(async () => { button.click(); });
};
const select = async (name: string) => {
  const input = view(name).querySelector<HTMLInputElement>('input[type="file"]')!;
  Object.defineProperty(input, "files", { configurable: true, value: [new File(["%PDF-1.4\nsynthetic"], "test.pdf", { type: "application/pdf" })] });
  await act(async () => { input.dispatchEvent(new dom.window.Event("change", { bubbles: true })); });
  await flush();
};
const originalFetch = globalThis.fetch;
const requests: string[] = [];
let responseStatus = 200;
let responseBody: unknown;
globalThis.fetch = (async (_url, init) => {
  requests.push(String((init!.body as FormData).get("businessRequestId")));
  return new Response(JSON.stringify(responseBody), { status: responseStatus, headers: { "content-type": "application/json" } });
}) as typeof fetch;
try {
  await act(async () => { root.render(<QueryClientProvider client={client}><Harness /></QueryClientProvider>); });
  await clickUpload("line");
  for (const failure of [
    { status: 500, body: { ok: false, error: { code: "INTERNAL_ERROR" } } },
    { status: 200, body: { ok: false, error: { code: "VALIDATION_ERROR", message: "assignment failed" } } },
    { status: 400, body: { ok: false, error: { code: "VALIDATION_ERROR", message: "Artwork replacement must explicitly supersede the current customer-supplied Order-line slot" } } },
    { status: 200, body: { ok: true, data: {} } },
    { status: 200, body: { ok: true, data: { artworkFile: result("b").artworkFile } } },
    { status: 200, body: { ok: true, data: { ...result("b"), assignment: { ...result("b").assignment, orderLineId: "wrong-line" } } } },
  ]) {
    responseStatus = failure.status; responseBody = failure.body;
    await select("line");
    assert.ok(view("line").querySelector('input[type="file"]'), "failed operation must keep panel open");
    assert.ok(view("line").querySelector('[role="alert"]'), "failure must be visible");
    assert.equal(completions, 0);
    assert.deepEqual(client.getQueryData(key), [entry("a")], "failure cannot insert partial evidence or remove existing Artwork");
  }
  // Retry retains the exact request identity; a new selection does not.
  const retryId = requests.at(-1);
  await act(async () => { [...view("line").querySelectorAll("button")].find((node) => node.textContent === "Retry upload")!.click(); });
  await flush();
  assert.equal(requests.at(-1), retryId);
  assert.notEqual(requests[0], requests[1]);

  let release!: () => void;
  beforeCache = () => new Promise<void>((resolve) => { release = resolve; });
  responseStatus = 200; responseBody = { ok: true, data: result("b") };
  backend = [entry("a"), entry("b")];
  await select("line");
  assert.ok(view("line").querySelector('input[type="file"]'), "HTTP success alone cannot close before publication to the cache");
  await act(async () => { release(); });
  await flush();
  assert.equal(view("line").querySelector('input[type="file"]'), null);
  assert.match(view("line").textContent!, /a\.pdf.*b\.pdf/s);
  assert.match(view("order").textContent!, /a\.pdf.*b\.pdf/s);
  assert.match(view("items").textContent!, /2 files/);
  assert.ok(refreshes > 0);
  beforeCache = undefined;

  await clickUpload("order");
  responseBody = { ok: true, data: result("c") };
  backend = [entry("a"), entry("b"), entry("c")];
  await select("order");
  assert.equal(view("order").querySelector('input[type="file"]'), null);
  for (const name of ["line", "order"]) assert.match(view(name).textContent!, /a\.pdf.*b\.pdf.*c\.pdf/s);
  assert.match(view("items").textContent!, /3 files/);
  await act(async () => { assert.equal(await cacheOrderArtworkUpload(client, key, result("c")), true); });
  assert.equal(client.getQueryData<readonly ArtworkOrderProjection[]>(key)!.length, 3, "idempotent response must not duplicate assignments");

  // An in-flight pre-upload read is canceled before committed cache evidence is installed.
  let oldRead!: (value: readonly ArtworkOrderProjection[]) => void;
  const pending = client.fetchQuery({ queryKey: key, queryFn: () => new Promise<readonly ArtworkOrderProjection[]>((resolve) => { oldRead = resolve; }), staleTime: 0 }).catch(() => undefined);
  await act(async () => { await cacheOrderArtworkUpload(client, key, result("d")); oldRead([entry("a")]); await pending; });
  assert.equal(client.getQueryData<readonly ArtworkOrderProjection[]>(key)!.length, 4);

  // Canonical mismatch validation also applies outside the panel.
  responseBody = { ok: true, data: { ...result("b"), assignment: { ...result("b").assignment, artworkFileId: "other-file" } } };
  await assert.rejects(artworkApi.upload("org-a", "request", { orderId: "order-a", orderLineId: "line-a", purpose: "customer_supplied", side: "front", file: new File(["pdf"], "test.pdf") }), { code: "UPLOAD_RESULT_UNCONFIRMED" });
} finally {
  globalThis.fetch = originalFetch;
  await act(async () => { root.unmount(); });
  client.clear();
  dom.window.close();
}
console.log("Artwork upload interaction, error, additive cache and refetch tests passed.");
