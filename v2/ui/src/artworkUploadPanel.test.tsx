import assert from "node:assert/strict";
import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { artworkApi } from "./api";
import { ArtworkUploadPanel, currentArtworkAssignmentId, type ArtworkUploadTarget } from "./ArtworkUploadPanel";

const target: ArtworkUploadTarget = {
  orderId: "order-a",
  orderLineId: "line-a",
  orderNumber: "ORD-1007",
  lineDescription: "Reflective Vinyl - Nikkalite",
};

const markup = renderToStaticMarkup(<QueryClientProvider client={new QueryClient()}><ArtworkUploadPanel organizationId="org-a" target={target} onUploaded={() => undefined} /></QueryClientProvider>);
assert.match(markup, /Upload Artwork/);
assert.match(markup, /#ORD-1007/);
assert.match(markup, /Reflective Vinyl - Nikkalite/);
assert.match(markup, /Drag a PDF here or click to select/);
assert.match(markup, /accept="application\/pdf,.pdf"/);
assert.match(markup, /aria-label="Artwork side"/);
assert.doesNotMatch(markup, />Upload Artwork<\/button>/);
assert.doesNotMatch(markup, /Artwork Order ID|Artwork Order line ID/);

const assignments = [
  { id: "assignment-front", artworkFileId: "file-front", orderId: "order-a", orderLineId: "line-a", purpose: "customer_supplied" as const, side: "front" as const, createdAt: "2026-09-03T00:00:00.000Z" },
  { id: "assignment-back", artworkFileId: "file-back", orderId: "order-a", orderLineId: "line-a", purpose: "customer_supplied" as const, side: "back" as const, createdAt: "2026-09-03T00:00:00.000Z" },
];
assert.equal(currentArtworkAssignmentId(assignments, "customer_supplied", "front"), "assignment-front");
assert.equal(currentArtworkAssignmentId(assignments, "customer_supplied", "back"), "assignment-back");
assert.equal(currentArtworkAssignmentId(assignments, "proof", "front"), undefined);

const originalFetch = globalThis.fetch;
const seen: { url?: string; headers?: HeadersInit; body?: BodyInit | null } = {};
globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
  seen.url = String(url); seen.headers = init?.headers; seen.body = init?.body;
  return new Response(JSON.stringify({ ok: true, data: {} }), { status: 200, headers: { "content-type": "application/json" } });
}) as typeof fetch;
try {
  const file = new File(["%PDF-1.4\nqa"], "qa-artwork.pdf", { type: "application/pdf" });
  await artworkApi.upload("org a", "request-a", { orderId: target.orderId, orderLineId: target.orderLineId, purpose: "customer_supplied", side: "front", supersedesArtworkAssignmentId: "assignment-front", file });
} finally { globalThis.fetch = originalFetch; }
assert.equal(seen.url, "/v2/organizations/org%20a/artwork/uploads");
assert.equal((seen.headers as Record<string, string>)["content-type"], undefined, "browser must supply the multipart boundary");
assert.ok(seen.body instanceof FormData);
const body = seen.body as FormData;
assert.equal(body.get("orderId"), "order-a");
assert.equal(body.get("orderLineId"), "line-a");
assert.equal(body.get("purpose"), "customer_supplied");
assert.equal(body.get("side"), "front");
assert.equal(body.get("supersedesArtworkAssignmentId"), "assignment-front");
assert.equal((body.get("file") as File).name, "qa-artwork.pdf");
console.log("Artwork upload panel visual and multipart contracts passed.");
