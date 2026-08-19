import express from "express";
import request from "supertest";
import { describe, expect, test } from "@jest/globals";
import { createArtworkRouter, type ArtworkHttpDependencies } from "../../src/interfaces/http/artworkRoutes";

const principal = { kind: "staff" as const, organizationId: "org-a", userId: "staff", authority: { membershipId: "member", capabilities: ["artwork.view", "artwork.adopt"] as const } };
const seen: unknown[] = [];
const app = () => express().use("/v2/organizations/:organizationId/artwork", createArtworkRouter({ principals: { principal: async () => principal }, workspace: { list: async () => [] }, service: { listForOrder: async () => ({ ok: true as const, value: [] }), assign: async () => ({ ok: true as const, value: {} }) }, upload: { upload: async (_context, input) => { seen.push(input); return { ok: true as const, value: { artworkFile: { id: "file-a" }, assignment: { id: "assignment-a" } } }; } } as unknown as ArtworkHttpDependencies["upload"] } as ArtworkHttpDependencies));

describe("Artwork upload HTTP transport", () => {
  test("parses a scoped multipart PDF into the authenticated Artwork operation", async () => {
    seen.length = 0;
    await request(app()).post("/v2/organizations/org-a/artwork/uploads").field("businessRequestId", "request-a").field("orderId", "order-a").field("orderLineId", "line-a").field("purpose", "customer_supplied").field("side", "front").attach("file", Buffer.from("%PDF-1.4\nqa"), { filename: "qa.pdf", contentType: "application/pdf" }).expect(200, { ok: true, data: { artworkFile: { id: "file-a" }, assignment: { id: "assignment-a" } } });
    expect(seen).toEqual([expect.objectContaining({ businessRequestId: "request-a", orderId: "order-a", orderLineId: "line-a", purpose: "customer_supplied", side: "front", filename: "qa.pdf", contentType: "application/pdf" })]);
  });

  test("rejects missing multipart binary before mutation", async () => {
    await request(app()).post("/v2/organizations/org-a/artwork/uploads").field("businessRequestId", "request-a").expect(400);
  });
});
