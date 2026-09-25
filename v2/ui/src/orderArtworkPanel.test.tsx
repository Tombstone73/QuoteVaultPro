import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { OrderArtworkPanel } from "./OrderWorkspace";
import type { ArtworkOrderProjection } from "./api";

const artwork: readonly ArtworkOrderProjection[] = [{
  file: { id: "file-a", originalFilename: "front-original.pdf", displayFilename: "front.pdf", contentType: "application/pdf", byteSize: 1200, source: "customer_upload", createdAt: "2026-09-22T00:00:00.000Z" },
  assignment: { id: "assignment-a", artworkFileId: "file-a", orderId: "order-a", orderLineId: "line-a", purpose: "customer_supplied", side: "front", createdAt: "2026-09-22T00:00:00.000Z" },
}, {
  file: { id: "file-b", originalFilename: "additional-original.pdf", displayFilename: "additional.pdf", contentType: "application/pdf", byteSize: 1300, source: "customer_upload", createdAt: "2026-09-22T00:01:00.000Z" },
  assignment: { id: "assignment-b", artworkFileId: "file-b", orderId: "order-a", orderLineId: "line-a", purpose: "customer_supplied", side: "front", createdAt: "2026-09-22T00:01:00.000Z" },
}, {
  file: { id: "file-c", originalFilename: "back-original.pdf", displayFilename: "back.pdf", contentType: "application/pdf", byteSize: 1400, source: "customer_upload", createdAt: "2026-09-22T00:02:00.000Z" },
  assignment: { id: "assignment-c", artworkFileId: "file-c", orderId: "order-a", orderLineId: "line-b", purpose: "customer_supplied", side: "front", createdAt: "2026-09-22T00:02:00.000Z" },
}];
const lines = [{ lineId: "line-a", position: 1, description: "Front banner" }, { lineId: "line-b", position: 2, description: "Back banner" }];
const render = (canView: boolean, canUpload: boolean) => renderToStaticMarkup(
  <QueryClientProvider client={new QueryClient()}>
    <OrderArtworkPanel organizationId="org-a" orderId="order-a" orderNumber="ORD-1001" lines={lines} artwork={artwork} loading={false} canView={canView} canUpload={canUpload} onOpen={() => undefined} onUploaded={() => undefined} />
  </QueryClientProvider>,
);

const viewOnly = render(true, false);
assert.match(viewOnly, /front\.pdf/);
assert.match(viewOnly, /View Artwork/);
assert.doesNotMatch(viewOnly, />Upload Artwork</);

const adopter = render(true, true);
assert.match(adopter, /Upload Artwork/);
assert.match(adopter, /Line 1 · Front banner/);
assert.match(adopter, /Line 2 · Back banner/);
assert.match(adopter, /front\.pdf/);
assert.match(adopter, /additional\.pdf/);
assert.match(adopter, /back\.pdf/);
assert.match(adopter, /Order-wide overview/);
assert.equal((adopter.match(/>Upload Artwork</g) ?? []).length, 2, "each top-level upload action must remain under an explicit line group");
const panelSource = await readFile(new URL("./OrderWorkspace.tsx", import.meta.url), "utf8");
assert.match(panelSource, /setUploadLineId\(activeUpload \? undefined : line\.lineId\)/, "top-level multi-line upload must require an explicit line selection");

const unauthorized = render(false, false);
assert.match(unauthorized, /Artwork access is unavailable/);
assert.doesNotMatch(unauthorized, /front\.pdf|Upload Artwork/);

const adoptionOnly = render(false, true);
assert.match(adoptionOnly, /Upload Artwork/);
assert.doesNotMatch(adoptionOnly, /front\.pdf/);

console.log("Order Artwork permission presentation tests passed.");
