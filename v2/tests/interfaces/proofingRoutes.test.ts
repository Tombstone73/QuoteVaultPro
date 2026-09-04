import express from "express";
import request from "supertest";
import { describe, expect, test } from "@jest/globals";
import { createProofingRouter, type ProofingHttpDependencies } from "../../src/interfaces/http/proofingRoutes";
import type { StaffPrincipal } from "../../src/authorization/principals";
import { V2ApplicationError } from "../../src/errors/applicationError";

const staff = (organizationId: string): StaffPrincipal => ({
  kind: "staff",
  organizationId,
  userId: "staff-a",
  authority: { membershipId: "membership-a", capabilities: ["proof.view", "proof.prepare", "proof.issue", "proof.respond"] },
});

const work = { proofWorkId: "proof-a", orderId: "order-a", orderLineId: "line-a", createdAt: "2026-08-25T00:00:00.000Z" };
const projection = { work, versions: [], recipients:[] };

const app = (principal: StaffPrincipal, calls: unknown[] = []) => express().use(express.json()).use(
  "/v2/organizations/:organizationId/proofing",
  createProofingRouter({
    principals: {
      principal: async (_request, organizationId) => {
        if (organizationId !== principal.organizationId)
          throw new V2ApplicationError("WRONG_TENANT", "Foreign tenant.");
        return principal;
      },
    },
    service: {
      listWorkQueue: async (context, page) => {
        calls.push({ kind: "list", context, page });
        return { ok: true as const, value: { items: [{ work, orderNumber: "SO-100", customerDisplayName: "Acme", lineDescription: "Signs" }], pagination: { page: 2, pageSize: 25 as const, totalCount: 59, totalPages: 3 } } };
      },
      getWork: async (context, proofWorkId) => {
        calls.push({ kind: "get", context, proofWorkId });
        return proofWorkId === "proof-a"
          ? { ok: true as const, value: projection }
          : { ok: false as const, error: new V2ApplicationError("NOT_FOUND", "Proof work was not found.") };
      },
      start: async (context, input) => {
        calls.push({ kind: "start", context, input });
        return { ok: true as const, value: { work } };
      },
      createVersion: async (context, input) => {
        calls.push({ kind: "createVersion", context, input });
        return { ok: true as const, value: { work, version: { proofVersionId: "version-a" } } };
      },
      issue: async (context, input) => {
        calls.push({ kind: "issue", context, input });
        return { ok: true as const, value: { work, version: { proofVersionId: "version-a" } } };
      },
      retryDelivery: async(context,input)=>{calls.push({kind:"retryDelivery",context,input});return{ok:true as const,value:{work,version:{proofVersionId:"version-a"}}};},
      respond: async (context, input) => {
        calls.push({ kind: "respond", context, input });
        return { ok: true as const, value: { work, response: { proofResponseId: "response-a" } } };
      },
    },
  } satisfies ProofingHttpDependencies),
);

describe("Proofing HTTP transport", () => {
  test("returns canonical queue and detail envelopes only in the authenticated tenant", async () => {
    const calls: any[] = [];
    const server = app(staff("org-a"), calls);
    await request(server).get("/v2/organizations/org-a/proofing/works?page=2&pageSize=25&q=SO-100").expect(200, {
      ok: true,
      data: { items: [{ work, orderNumber: "SO-100", customerDisplayName: "Acme", lineDescription: "Signs" }], pagination: { page: 2, pageSize: 25, totalCount: 59, totalPages: 3 } },
    });
    await request(server).get("/v2/organizations/org-a/proofing/works/proof-a").expect(200, { ok: true, data: projection });
    expect(calls).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "list", page: { page: 2, pageSize: 25, search: "SO-100" }, context: expect.objectContaining({ organizationId: "org-a" }) }),
      expect.objectContaining({ kind: "get", proofWorkId: "proof-a", context: expect.objectContaining({ organizationId: "org-a" }) }),
    ]));
  });

  test("uses a consistent not-found envelope for missing or foreign proof work", async () => {
    const server = app(staff("org-a"));
    await request(server).get("/v2/organizations/org-a/proofing/works/missing").expect(404, {
      ok: false,
      error: { code: "NOT_FOUND", message: "Proof work was not found." },
    });
    await request(server).get("/v2/organizations/org-b/proofing/works/proof-a").expect(404, {
      ok: false,
      error: { code: "WRONG_TENANT", message: "Foreign tenant." },
    });
  });

  test("requires a durable request identity and lets path identity override forged body identity", async () => {
    const calls: any[] = [];
    const server = app(staff("org-a"), calls);
    await request(server).post("/v2/organizations/org-a/proofing/works/proof-a/versions").send({ artworkAssignmentIds: ["art-a"] }).expect(400);
    await request(server).post("/v2/organizations/org-a/proofing/works/proof-a/versions").send({ businessRequestId: "version-1", proofWorkId: "forged-work", artworkAssignmentIds: ["art-a"] }).expect(200);
    expect(calls.find((call) => call.kind === "createVersion")).toMatchObject({
      input: { businessRequestId: "version-1", proofWorkId: "proof-a", artworkAssignmentIds: ["art-a"] },
      context: { organizationId: "org-a", businessRequest: { id: "version-1" } },
    });
    await request(server).post("/v2/organizations/org-a/proofing/versions/version-a/delivery/retry").send({businessRequestId:"retry-a"}).expect(200);
    expect(calls.find((call)=>call.kind==="retryDelivery")).toMatchObject({input:{businessRequestId:"retry-a",proofVersionId:"version-a"}});
  });
});
