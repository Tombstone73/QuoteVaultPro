import express from "express";
import request from "supertest";
import { describe, expect, test } from "@jest/globals";
import { createArtworkRouter, type ArtworkHttpDependencies } from "../../src/interfaces/http/artworkRoutes";

const principal = { kind: "staff" as const, organizationId: "org-a", userId: "staff", authority: { membershipId: "member", capabilities: ["artwork.view", "artwork.adopt", "prepress.work"] as const } };
const seen: unknown[] = [];
const app = (actor = principal) => express().use("/v2/organizations/:organizationId/artwork", createArtworkRouter({ principals: { principal: async () => actor }, workspace: { list: async () => [] }, service: { listForOrder: async () => ({ ok: true as const, value: [] }), assign: async () => ({ ok: true as const, value: {} }) }, upload: { upload: async (_context, input) => { seen.push(input); return { ok: true as const, value: { artworkFile: { id: "file-a" }, assignment: { id: "assignment-a" } } }; } } as unknown as ArtworkHttpDependencies["upload"] } as ArtworkHttpDependencies));

describe("Artwork upload HTTP transport", () => {
  test("parses a scoped multipart PDF into the authenticated Artwork operation", async () => {
    seen.length = 0;
    await request(app()).post("/v2/organizations/org-a/artwork/uploads").field("businessRequestId", "request-a").field("orderId", "order-a").field("orderLineId", "line-a").field("purpose", "customer_supplied").field("side", "front").attach("file", Buffer.from("%PDF-1.4\nqa"), { filename: "qa.pdf", contentType: "application/pdf" }).expect(200, { ok: true, data: { artworkFile: { id: "file-a" }, assignment: { id: "assignment-a" } } });
    expect(seen).toEqual([expect.objectContaining({ businessRequestId: "request-a", orderId: "order-a", orderLineId: "line-a", purpose: "customer_supplied", side: "front", filename: "qa.pdf", contentType: "application/pdf" })]);
  });

  test("rejects missing multipart binary before mutation", async () => {
    await request(app()).post("/v2/organizations/org-a/artwork/uploads").field("businessRequestId", "request-a").expect(400);
  });

  test("uses the canonical Artwork upload only after Prepress authority accepts a production-art command", async () => {
    seen.length = 0;
    await request(app()).post("/v2/organizations/org-a/artwork/prepress/production-uploads").field("businessRequestId", "request-prepress").field("orderId", "order-a").field("orderLineId", "line-a").field("purpose", "production").field("side", "front").attach("file", Buffer.from("%PDF-1.4\nqa"), { filename: "print-ready.pdf", contentType: "application/pdf" }).expect(200);
    expect(seen).toEqual([expect.objectContaining({ businessRequestId: "request-prepress", purpose: "production", orderId: "order-a", orderLineId: "line-a", side: "front" })]);
  });

  test("fails closed when the dedicated Prepress path is asked to adopt non-production Artwork", async () => {
    seen.length = 0;
    await request(app()).post("/v2/organizations/org-a/artwork/prepress/production-uploads").field("businessRequestId", "request-prepress").field("orderId", "order-a").field("orderLineId", "line-a").field("purpose", "customer_supplied").attach("file", Buffer.from("%PDF-1.4\nqa"), { filename: "source.pdf", contentType: "application/pdf" }).expect(400);
    expect(seen).toEqual([]);
  });

  test("requires both existing Prepress work and Artwork adoption authority", async () => {
    const withoutPrepress = { ...principal, authority: { ...principal.authority, capabilities: ["artwork.view", "artwork.adopt"] as const } };
    await request(app(withoutPrepress)).post("/v2/organizations/org-a/artwork/prepress/production-uploads").field("businessRequestId", "request-prepress").field("orderId", "order-a").field("orderLineId", "line-a").field("purpose", "production").attach("file", Buffer.from("%PDF-1.4\nqa"), { filename: "print-ready.pdf", contentType: "application/pdf" }).expect(403);
    const withoutArtwork = { ...principal, authority: { ...principal.authority, capabilities: ["artwork.view", "prepress.work"] as const } };
    await request(app(withoutArtwork)).post("/v2/organizations/org-a/artwork/prepress/production-uploads").field("businessRequestId", "request-prepress-two").field("orderId", "order-a").field("orderLineId", "line-a").field("purpose", "production").attach("file", Buffer.from("%PDF-1.4\nqa"), { filename: "print-ready.pdf", contentType: "application/pdf" }).expect(403);
  });
});
