import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { artworkApi } from "./api";
import { ArtworkUploadPanel, newArtworkUploadRequest, type ArtworkUploadTarget } from "./ArtworkUploadPanel";

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

const firstRequest = newArtworkUploadRequest(new File(["%PDF-1.4\nfirst"], "first.pdf", { type: "application/pdf" }), "customer_supplied", "front");
const secondRequest = newArtworkUploadRequest(new File(["%PDF-1.4\nsecond"], "second.pdf", { type: "application/pdf" }), "customer_supplied", "front");
const thirdRequest = newArtworkUploadRequest(new File(["%PDF-1.4\nthird"], "third.pdf", { type: "application/pdf" }), "customer_supplied", "front");
assert.notEqual(firstRequest.businessRequestId, secondRequest.businessRequestId, "each new upload receives a fresh request identity");
assert.notEqual(secondRequest.businessRequestId, thirdRequest.businessRequestId, "a third ordinary selection remains a new additive request without a page refresh");
assert.equal(firstRequest.file.name, "first.pdf");
assert.equal(secondRequest.file.name, "second.pdf");
assert.equal(thirdRequest.file.name, "third.pdf");
const panelSource = await readFile(new URL("./ArtworkUploadPanel.tsx", import.meta.url), "utf8");
assert.doesNotMatch(panelSource, /supersedesArtworkAssignmentId/, "ordinary Artwork upload must never infer replacement lineage from purpose or side");
assert.match(panelSource, /setRequest\(undefined\);\s*upload\.reset\(\);\s*onUploaded\(\);/, "successful upload clears request and mutation state for the next upload");
assert.match(panelSource, /onRetry=\{request \? \(\) => upload\.mutate\(request\) : undefined\}/, "retry keeps the same request identity and semantic upload");

const originalFetch = globalThis.fetch;
const seen: { url?: string; headers?: HeadersInit; body?: BodyInit | null } = {};
globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
  seen.url = String(url); seen.headers = init?.headers; seen.body = init?.body;
  return new Response(JSON.stringify({ ok: true, data: {} }), { status: 200, headers: { "content-type": "application/json" } });
}) as typeof fetch;
try {
  const file = new File(["%PDF-1.4\nqa"], "qa-artwork.pdf", { type: "application/pdf" });
  await artworkApi.upload("org a", "request-a", { orderId: target.orderId, orderLineId: target.orderLineId, purpose: "customer_supplied", side: "front", file });
} finally { globalThis.fetch = originalFetch; }
assert.equal(seen.url, "/v2/organizations/org%20a/artwork/uploads");
assert.equal((seen.headers as Record<string, string>)["content-type"], undefined, "browser must supply the multipart boundary");
assert.ok(seen.body instanceof FormData);
const body = seen.body as FormData;
assert.equal(body.get("orderId"), "order-a");
assert.equal(body.get("orderLineId"), "line-a");
assert.equal(body.get("purpose"), "customer_supplied");
assert.equal(body.get("side"), "front");
assert.equal(body.get("supersedesArtworkAssignmentId"), null, "ordinary upload is additive and never sends replacement lineage");
assert.equal((body.get("file") as File).name, "qa-artwork.pdf");

const productionFile = new File(["%PDF-1.4\nprint"], "print-ready.pdf", { type: "application/pdf" });
globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
  seen.url = String(url); seen.headers = init?.headers; seen.body = init?.body;
  return new Response(JSON.stringify({ ok: true, data: {} }), { status: 200, headers: { "content-type": "application/json" } });
}) as typeof fetch;
try {
  await artworkApi.uploadProductionForPrepress("org a", "request-prepress", { orderId: target.orderId, orderLineId: target.orderLineId, side: "front", supersedesArtworkAssignmentId: "assignment-production-front", file: productionFile });
} finally { globalThis.fetch = originalFetch; }
assert.equal(seen.url, "/v2/organizations/org%20a/artwork/prepress/production-uploads");
const productionBody = seen.body as FormData;
assert.equal(productionBody.get("purpose"), "production");
assert.equal(productionBody.get("supersedesArtworkAssignmentId"), "assignment-production-front");
console.log("Artwork upload panel visual and multipart contracts passed.");
