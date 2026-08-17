import express from "express";
import request from "supertest";
import { describe, expect, test } from "@jest/globals";
import { createArtworkRouter, type ArtworkHttpDependencies } from "../../src/interfaces/http/artworkRoutes";
import type { StaffPrincipal } from "../../src/authorization/principals";

const staff = (organizationId: string, capabilities: readonly ("artwork.view")[] = ["artwork.view"]): StaffPrincipal => ({ kind: "staff", organizationId, userId: "staff", authority: { membershipId: "membership", capabilities } });
const item = { assignment: { id: "assignment-a", artworkFileId: "file-a", orderId: "order-a", orderLineId: "line-a", purpose: "production" as const, side: "front" as const, createdAt: "2026-08-17T00:00:00.000Z" }, file: { id: "file-a", displayFilename: "front.pdf", contentType: "application/pdf", byteSize: 12, source: "prepress_derived" as const, createdAt: "2026-08-17T00:00:00.000Z" }, orderNumber: "SO-100", customerDisplayName: "Acme", lineDescription: "Signs" };
const app = (principal: StaffPrincipal) => express().use("/v2/organizations/:organizationId/artwork", createArtworkRouter({ principals: { principal: async () => principal }, workspace: { list: async (org, query) => org === "org-a" && query === "front" ? [item] : [] }, service: { listForOrder: async () => ({ ok: true, value: [] }), assign: async () => ({ ok: true, value: {} }) } } as ArtworkHttpDependencies));

describe("M4 Artwork workspace route", () => {
  test("returns only the authenticated tenant's canonical assignment rows", async () => { await request(app(staff("org-a"))).get("/v2/organizations/org-a/artwork/workspace?q=front").expect(200, { ok: true, data: { items: [item] } }); });
  test("fails closed for another tenant and absent artwork.view", async () => { await request(app(staff("org-a"))).get("/v2/organizations/org-b/artwork/workspace?q=front").expect(403); await request(app(staff("org-a", []))).get("/v2/organizations/org-a/artwork/workspace").expect(403); });
});
