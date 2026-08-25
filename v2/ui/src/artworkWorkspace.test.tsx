import assert from "node:assert/strict";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ArtworkWorkspace } from "./ArtworkWorkspace";

const client = new QueryClient();
client.setQueryData(["v2", "scope-a", "org-a", "artwork", "file", "file-a"], {
  file: { id: "file-a", originalFilename: "front-original.pdf", displayFilename: "front.pdf", contentType: "application/pdf", byteSize: 1200, source: "prepress_derived", pageCount: 2, detectedWidthMicrons: 100000, detectedHeightMicrons: 200000, derivedFromArtworkFileId: "file-source", createdAt: "2026-08-17T00:00:00.000Z" },
  assignments: [
    { id: "assignment-a", artworkFileId: "file-a", orderId: "order-a", orderLineId: "line-a", purpose: "production", side: "front", sourcePageIndex: 0, layerKey: "ink", layerOrder: 1, createdAt: "2026-08-17T00:00:00.000Z", orderNumber: "SO-100", customerId: "customer-a", customerDisplayName: "Acme", lineDescription: "Signs" },
    { id: "assignment-b", artworkFileId: "file-a", orderId: "order-b", orderLineId: "line-b", purpose: "proof", side: "back", createdAt: "2026-08-17T00:00:00.000Z", orderNumber: "SO-101", customerDisplayName: "Beta", lineDescription: "Banners" },
  ],
});
const markup = renderToStaticMarkup(<QueryClientProvider client={client}><ArtworkWorkspace organizationId="org-a" sessionScope="scope-a" canView artworkFileId="file-a" openArtwork={() => {}} openCustomer={() => {}} openOrder={() => {}} backToCatalog={() => {}} /></QueryClientProvider>);
for (const text of ["front.pdf", "No preview available", "File metadata", "front-original.pdf", "2 pages", "100.0 × 200.0 mm", "Assignments", "SO-100", "SO-101", "Proofing, Prepress, and Production own their workflow records."]) assert.match(markup, new RegExp(text));
assert.doesNotMatch(markup, /Send Proof|Production Ready|Approved|Delete Artwork/);
assert.doesNotMatch(markup, /file-a|assignment-a|customer-a/);
console.log("Artwork workspace visual contract tests passed.");
