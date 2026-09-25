import assert from "node:assert/strict";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { JSDOM } from "jsdom";
import { OrderArtworkFile } from "./OrderArtworkFile";
import type { ArtworkOrderProjection } from "./api";

const dom = new JSDOM("<main id='order'><div id='root'></div></main>", { url: "https://qa.invalid/orders/order-a" });
Object.assign(globalThis, { window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true });
dom.window.HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
dom.window.HTMLDialogElement.prototype.close = function () { this.removeAttribute("open"); };
const root = createRoot(document.getElementById("root")!);
const entries: ArtworkOrderProjection[] = ["a", "b", "c"].map((id) => ({
  file: { id: `file-${id}`, originalFilename: `${id}.pdf`, displayFilename: `${id}.pdf`, contentType: "application/pdf", byteSize: 12, source: "customer_upload", createdAt: "now" },
  assignment: { id: `assignment-${id}`, artworkFileId: `file-${id}`, orderId: "order-a", orderLineId: "line-a", purpose: "customer_supplied", side: "front", createdAt: "now" },
}));
const before = JSON.stringify(entries);
const requests: { url: string; method: string; credentials?: RequestCredentials }[] = [];
const revoked: string[] = [];
const blobs: Blob[] = [];
const originalFetch = globalThis.fetch, originalCreate = URL.createObjectURL, originalRevoke = URL.revokeObjectURL;
let status = 200;
URL.createObjectURL = (blob) => { blobs.push(blob as Blob); return `blob:qa-${blobs.length}`; };
URL.revokeObjectURL = (url) => { revoked.push(url); };
globalThis.fetch = (async (url, init) => {
  requests.push({ url: String(url), method: init?.method ?? "GET", credentials: init?.credentials });
  return new Response(status === 200 ? `%PDF-1.4\n${url}` : "private failure details must not appear", { status, headers: { "content-type": status === 200 ? "application/pdf" : "application/json" } });
}) as typeof fetch;
const render = async (canView: boolean) => act(async () => { root.render(<>{entries.map((entry) => <OrderArtworkFile key={entry.assignment.id} organizationId="org/a" entry={entry} canView={canView} />)}</>); });
const click = async (button: HTMLButtonElement) => act(async () => { button.focus(); button.click(); await new Promise((resolve) => setTimeout(resolve, 10)); });
const close = () => [...document.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "Close Artwork viewer")!;
try {
  await render(false);
  assert.equal(document.querySelectorAll("button,iframe").length, 0);
  assert.equal(requests.length, 0);
  await render(true);
  assert.equal(document.querySelectorAll('[aria-label^="View Artwork:"]').length, 3);
  const actions = [
    '[aria-label="View thumbnail: b.pdf"]',
    '[aria-label="View Artwork: c.pdf"]',
    'button.v2-sales-inline-button',
  ];
  const expected = ["b", "c", "a"];
  for (let i = 0; i < actions.length; i += 1) {
    const action = document.querySelector<HTMLButtonElement>(actions[i]!)!;
    await click(action);
    assert.match(requests.at(-1)!.url, new RegExp(`/artwork/files/file-${expected[i]}/content$`));
    assert.ok(requests.at(-1)!.url.startsWith("/v2/organizations/org%2Fa/"));
    assert.equal(requests.at(-1)!.credentials, "include");
    assert.equal(document.querySelector("dialog h2")!.textContent, `${expected[i]}.pdf`);
    assert.equal(document.querySelector("object")!.getAttribute("type"), "application/pdf");
    assert.match(document.querySelector("object")!.getAttribute("data")!, /#page=1&view=FitH/);
    assert.match(await blobs.at(-1)!.text(), new RegExp(`file-${expected[i]}/content`), "the viewer receives the selected file's bytes, not a thumbnail");
    await click(close());
    assert.equal(document.querySelector("dialog"), null);
    assert.equal(document.activeElement, action, "close restores the originating control");
    assert.equal(window.location.pathname, "/orders/order-a");
  }
  status = 403;
  await click(document.querySelector<HTMLButtonElement>('[aria-label="View Artwork: b.pdf"]')!);
  assert.match(document.querySelector('[role="alert"]')!.textContent!, /could not be opened/);
  assert.doesNotMatch(document.body.textContent!, /private failure/);
  assert.equal(document.querySelector("object"), null);
  status = 200;
  await click([...document.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "Retry preview")!);
  assert.equal(document.querySelector('[role="alert"]'), null);
  assert.ok(document.querySelector("object"));
  await click(close());
  assert.ok(requests.every((request) => request.method === "GET"), "viewer is read-only");
  assert.equal(JSON.stringify(entries), before);
  assert.equal(revoked.length, blobs.length, "private blob URLs are revoked on close");
} finally {
  await act(async () => { root.unmount(); });
  globalThis.fetch = originalFetch; URL.createObjectURL = originalCreate; URL.revokeObjectURL = originalRevoke;
  dom.window.close();
}
console.log("Order Artwork per-file viewer, authorized access, errors, focus and cleanup: PASS");
