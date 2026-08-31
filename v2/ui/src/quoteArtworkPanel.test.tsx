import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { quoteApi, type QuoteRead } from "./api";
import { QuoteArtworkPanel } from "./QuoteArtworkPanel";
import { ArtworkUploadPanel } from "./ArtworkUploadPanel";
import { isArtworkPdf } from "./ArtworkAutoUploadDropzone";

const quote = (deliveryState: "not_sent" | "sent" = "not_sent"): QuoteRead => ({
  quote: {
    quoteId: "quote-a",
    customerContact: { organizationId: "org-a", customerId: "customer-a" },
    terms: {},
    currency: "USD",
    deliveryState,
    acceptanceState: "not_accepted",
    lifecycleState: "open",
    lines: [{ lineId: "line-a", position: 1, productId: "product-a", description: "Banner", quantity: 1, resolvedConfiguration: {}, calculatedUnitAmount: { cents: 100, currency: "USD" }, calculatedLineAmount: { cents: 100, currency: "USD" }, sellingUnitAmount: { cents: 100, currency: "USD" }, sellingLineAmount: { cents: 100, currency: "USD" }, sellingPriceDecision: { kind: "calculated" } }],
  },
  number: { display: "QT-1", core: "1" },
  revision: "3",
  checkpoints: [],
  totals: { currency: "USD", calculatedLineAmount: { cents: 100, currency: "USD" }, sellingLineAmount: { cents: 100, currency: "USD" } },
});

const render = (deliveryState: "not_sent" | "sent") => renderToStaticMarkup(
  <QueryClientProvider client={new QueryClient()}>
    <QuoteArtworkPanel organizationId="org-a" sessionScope="scope-a" quote={quote(deliveryState)} canEdit csrfReady onQuoteRefresh={() => undefined} onError={() => undefined} />
  </QueryClientProvider>,
);

assert.match(render("not_sent"), /Canonical files are associated with this Quote line/);
assert.match(render("not_sent"), /aria-label="Quote artwork line"/);
assert.match(render("not_sent"), /Drag a PDF here or click to select/);
assert.match(render("not_sent"), /aria-label="Quote artwork side"/);
assert.doesNotMatch(render("not_sent"), />Upload Artwork<\/button>/);
assert.match(render("sent"), /Quote artwork is read only/);
assert.doesNotMatch(render("sent"), /Drag a PDF here or click to select/);

const originalFetch = globalThis.fetch;
const seen: { url?: string; init?: RequestInit } = {};
globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
  seen.url = String(url);
  seen.init = init;
  return new Response(JSON.stringify({ ok: true, data: { artworkFile: {}, assignment: {}, quoteRevision: "4" } }), { status: 200, headers: { "content-type": "application/json" } });
}) as typeof fetch;
try {
  await quoteApi.uploadArtwork("org a", "quote a", "request-a", { quoteLineId: "line-a", expectedRevision: "3", side: "front", file: new File(["%PDF-1.4"], "qa.pdf", { type: "application/pdf" }) });
} finally {
  globalThis.fetch = originalFetch;
}
assert.equal(seen.url, "/v2/organizations/org%20a/quotes/quote%20a/artwork/uploads");
assert.equal((seen.init?.headers as Record<string, string>)["content-type"], undefined);
assert.ok(seen.init?.body instanceof FormData);
const body = seen.init!.body as FormData;
assert.equal(body.get("businessRequestId"), "request-a");
assert.equal(body.get("quoteLineId"), "line-a");
assert.equal(body.get("expectedRevision"), "3");
assert.equal(body.get("purpose"), "customer_supplied");
assert.equal(body.get("side"), "front");

const orderMarkup = renderToStaticMarkup(<QueryClientProvider client={new QueryClient()}><ArtworkUploadPanel organizationId="org-a" target={{ orderId: "order-a", orderLineId: "line-a", orderNumber: "ORD-1", lineDescription: "Banner" }} onUploaded={() => undefined} /></QueryClientProvider>);
assert.match(orderMarkup, /Drag a PDF here or click to select/);
assert.match(orderMarkup, /aria-label="Artwork side"/);
assert.doesNotMatch(orderMarkup, />Upload Artwork<\/button>/);
assert.equal(isArtworkPdf(new File(["%PDF"], "proof.pdf", { type: "application/pdf" })), true);
assert.equal(isArtworkPdf(new File(["png"], "proof.png", { type: "image/png" })), false);
const dropzoneSource = await readFile(new URL("./ArtworkAutoUploadDropzone.tsx", import.meta.url), "utf8");
assert.match(dropzoneSource, /onDrop=/);
assert.match(dropzoneSource, /onFileSelected\(file\)/);
assert.match(dropzoneSource, /Retry upload/);
console.log("Quote artwork panel visual and multipart contracts passed.");
