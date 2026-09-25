import express from "express";
import request from "supertest";
import { describe, expect, test } from "@jest/globals";
import { createArtworkRouter } from "../../src/interfaces/http/artworkRoutes";
import { ArtworkApplicationService, type ArtworkTransaction } from "../../src/modules/artwork/artworkApplication";
import type { Principal } from "../../src/authorization/principals";
import { V2ApplicationError } from "../../src/errors/applicationError";

const principal: Principal = { kind: "staff", organizationId: "org-a", userId: "staff", authority: { membershipId: "membership", capabilities: ["artwork.assign"] } };
const fixture = (actor = principal, blocked = false) => {
  const calls: unknown[] = [], audits: unknown[] = [];
  const service = new ArtworkApplicationService({ transaction: async (action) => action({
    reserve: async () => ({ kind: "new", request: { id: "operation", resultJson: null } }),
    attribute: async () => undefined, audit: async (value: unknown) => { audits.push(value); }, succeed: async () => undefined,
    removeAssignment: async (input: { artworkAssignmentId: string; orderId: string; orderLineId: string }) => {
      calls.push(input);
      if (blocked) throw new V2ApplicationError("CONFLICT", "Artwork is in use by the current Proof");
      if (input.artworkAssignmentId !== "assignment-b" || input.orderId !== "order-a" || input.orderLineId !== "line-a") throw new V2ApplicationError("NOT_FOUND", "Assignment not found");
      return { artworkFile: { id: "file-shared" }, assignment: { id: input.artworkAssignmentId, orderId: input.orderId, orderLineId: input.orderLineId }, removal: { removedAt: "2026-09-25T00:00:00Z", removedByUserId: "staff" } };
    },
  } as unknown as ArtworkTransaction) });
  const app = express().use(express.json()).use("/v2/organizations/:organizationId/artwork", createArtworkRouter({ service, principals: { principal: async () => actor }, workspace: { list: async () => [], get: async () => null } }));
  return { app, calls, audits };
};
const body = { businessRequestId: "remove-b", orderId: "order-a", orderLineId: "line-a" };
const endpoint = "/v2/organizations/org-a/artwork/assignments/assignment-b/remove";
describe("canonical assignment removal HTTP boundary", () => {
  test("uses exact route assignment and canonical envelope, with assignment audit", async () => {
    const f = fixture();
    const response = await request(f.app).post(endpoint).send({ ...body, artworkAssignmentId: "body-cannot-override-route", artworkFileId: "not-the-target" }).expect(200);
    expect(response.body).toMatchObject({ ok: true, data: { assignment: { id: "assignment-b" }, removal: { removedByUserId: "staff" } } });
    expect(f.calls).toEqual([expect.objectContaining({ organizationId: "org-a", artworkAssignmentId: "assignment-b", orderLineId: "line-a" })]);
    expect(f.audits).toEqual([expect.objectContaining({ eventType: "artwork_assignment_removed", resourceId: "assignment-b" })]);
  });
  test("adopt/view alone cannot remove; tenant mismatch is blocked before work", async () => {
    const f = fixture({ ...principal, authority: { membershipId: "membership", capabilities: ["artwork.view", "artwork.adopt"] } } as Principal);
    await request(f.app).post(endpoint).send(body).expect(403);
    expect(f.calls).toEqual([]);
    const foreign = fixture();
    const response = await request(foreign.app).post(endpoint.replace("org-a", "org-b")).send(body);
    expect(response.body.ok).toBe(false); expect(foreign.calls).toEqual([]);
  });
  test("wrong line, missing request and active workflow fail safely", async () => {
    const f = fixture();
    await request(f.app).post(endpoint).send({ ...body, orderLineId: "other-line" }).expect(404);
    await request(f.app).post(endpoint).send({ orderId: "order-a" }).expect(400);
    const blocked = fixture(principal, true);
    await request(blocked.app).post(endpoint).send(body).expect(409);
    expect(blocked.audits).toEqual([]);
  });
});
