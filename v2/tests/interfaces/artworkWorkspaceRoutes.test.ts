import express from "express";
import request from "supertest";
import { describe, expect, test } from "@jest/globals";
import { createArtworkRouter, type ArtworkHttpDependencies } from "../../src/interfaces/http/artworkRoutes";
import type { StaffPrincipal } from "../../src/authorization/principals";
import { V2ApplicationError } from "../../src/errors/applicationError";

const staff = (organizationId: string, capabilities: readonly ("artwork.view")[] = ["artwork.view"]): StaffPrincipal => ({ kind: "staff", organizationId, userId: "staff", authority: { membershipId: "membership", capabilities } });
const item = { assignment: { id: "assignment-a", artworkFileId: "file-a", orderId: "order-a", orderLineId: "line-a", purpose: "production" as const, side: "front" as const, createdAt: "2026-08-17T00:00:00.000Z" }, file: { id: "file-a", displayFilename: "front.pdf", contentType: "application/pdf", byteSize: 12, source: "prepress_derived" as const, createdAt: "2026-08-17T00:00:00.000Z" }, orderNumber: "SO-100", customerDisplayName: "Acme", lineDescription: "Signs" };
const detail = { file: item.file, assignments: [{ ...item.assignment, orderNumber: item.orderNumber, customerId: "customer-a", customerDisplayName: item.customerDisplayName, lineDescription: item.lineDescription }] };
const app = (principal: StaffPrincipal) => express().use("/v2/organizations/:organizationId/artwork", createArtworkRouter({ principals: { principal: async () => principal }, workspace: { list: async (org, query) => org === "org-a" && query === "front" ? [item] : [], get: async (org, fileId) => org === "org-a" && fileId === "file-a" ? detail : null }, service: { listForOrder: async () => ({ ok: true, value: [] }), assign: async () => ({ ok: true, value: {} }) } } as ArtworkHttpDependencies));

describe("M4 Artwork workspace route", () => {
  test("forwards optional expected-empty slot to the owner and exposes stale occupancy as 409", async () => {
    const seen: unknown[] = [];
    const server = express().use(express.json()).use("/v2/organizations/:organizationId/artwork", createArtworkRouter({
      principals: { principal: async () => staff("org-a") }, workspace: { list: async () => [], get: async () => null },
      service: { listForOrder: async () => ({ ok: true, value: [] }), assign: async (_context, input) => {
        seen.push(input);
        return input.expectedEmptyProductionSlot ? { ok: false, error: new V2ApplicationError("CONFLICT", "Slot occupied.") } : { ok: true, value: {} };
      } },
    }));
    const body = { businessRequestId: "assign", usage: { orderId: "order", orderLineId: "line", purpose: "production" }, expectedEmptyProductionSlot: { requirementKey: "front" } };
    await request(server).post("/v2/organizations/org-a/artwork/files/file-a/assign").send(body).expect(409);
    expect(seen[0]).toEqual({ ...body, artworkFileId: "file-a" });
    await request(server).post("/v2/organizations/org-a/artwork/files/file-a/assign").send({ ...body, expectedEmptyProductionSlot: null }).expect(400);
    expect(seen).toHaveLength(1);
    await request(server).post("/v2/organizations/org-a/artwork/files/file-a/assign").send({ businessRequestId: "generic", usage: body.usage }).expect(200);
    expect(seen[1]).not.toHaveProperty("expectedEmptyProductionSlot");
  });
  test("returns only the authenticated tenant's canonical assignment rows", async () => { await request(app(staff("org-a"))).get("/v2/organizations/org-a/artwork/workspace?q=front").expect(200, { ok: true, data: { items: [item] } }); });
  test("fails closed for another tenant and absent artwork.view", async () => { await request(app(staff("org-a"))).get("/v2/organizations/org-b/artwork/workspace?q=front").expect(403); await request(app(staff("org-a", []))).get("/v2/organizations/org-a/artwork/workspace").expect(403); });
  test("reads one tenant-scoped Artwork file with every canonical assignment and hides foreign/missing files", async () => {
    await request(app(staff("org-a"))).get("/v2/organizations/org-a/artwork/workspace/files/file-a").expect(200, { ok: true, data: detail });
    await request(app(staff("org-a"))).get("/v2/organizations/org-a/artwork/workspace/files/file-b").expect(404);
    await request(app(staff("org-a"))).get("/v2/organizations/org-b/artwork/workspace/files/file-a").expect(403);
  });
});
