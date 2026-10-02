import express from "express";
import request from "supertest";
import { describe, expect, jest, test } from "@jest/globals";
import { createActionCenterRouter } from "../../src/interfaces/http/actionCenterRoutes";
import type { StaffPrincipal } from "../../src/authorization/principals";
import type { Capability } from "../../src/authorization/capabilities";
import { PermissionSetPrincipalIssuer } from "../../src/authorization/permissionSets";
import { IssuedV2PrincipalProvider } from "../../infrastructure/authentication/trustedHostPrincipalProvider";
import { V2ApplicationError } from "../../src/errors/applicationError";

const staff = (organizationId: string, capabilities: readonly Capability[]): StaffPrincipal => ({
  kind: "staff", organizationId, userId: "staff-a", authority: { membershipId: "membership-a", capabilities },
});
const identity = { subjectId: "staff-a", authenticationMethod: "session" as const, authenticatedAt: new Date("2026-10-01T00:00:00Z") };
const issued = (capabilities: readonly Capability[], authority: "active" | "inactive" | "missing" | "foreign" = "active") => new IssuedV2PrincipalProvider(
  { authenticatedIdentity: async () => identity },
  new PermissionSetPrincipalIssuer({
    resolveStaff: async (userId, organizationId) => authority === "missing" ? null : ({
      organizationId: authority === "foreign" ? "org-other" : organizationId, organizationActive: true, authorityRevision: "1",
      staff: { userId, membershipId: "membership-a", membershipActive: authority !== "inactive", teamAccessManagement: false,
        permissionSets: [{ id: "set-a", name: "Assigned permissions", active: true, revision: 1 }], capabilities },
    }),
    resolvePortal: async () => null,
  }),
);
const denied = { ok: false, error: { code: "FORBIDDEN", message: "Authenticated access is required." } };
const unavailable = { ok: false, error: { code: "INTERNAL_ERROR", message: "The action summary is unavailable." } };

describe("M7.5K action-center HTTP projection", () => {
  test("returns only canonical categories the scoped principal may view", async () => {
    const calls: unknown[] = [];
    const app = express().use("/v2/organizations/:organizationId/action-center", createActionCenterRouter({
      principals: issued(["inbound.view"]),
      reader: { summary: async (organizationId, visible) => { calls.push({ organizationId, visible }); return [{ kind: "inbound", label: "Inbound needs review", count: 2, href: "/inbound-orders" }]; } },
    }));
    await request(app).get("/v2/organizations/org-a/action-center").expect(200, {
      ok: true, data: { items: [{ kind: "inbound", label: "Inbound needs review", count: 2, href: "/inbound-orders" }] },
    });
    expect(calls).toEqual([{ organizationId: "org-a", visible: ["inbound"] }]);
  });

  test("fails closed before reading a foreign organization", async () => {
    let read = false;
    const app = express().use("/v2/organizations/:organizationId/action-center", createActionCenterRouter({
      principals: { principal: async () => staff("org-a", ["inbound.view"]) },
      reader: { summary: async () => { read = true; return []; } },
    }));
    await request(app).get("/v2/organizations/org-b/action-center").expect(403);
    expect(read).toBe(false);
  });

  test("real unauthenticated principal denial never issues authority or reads counts", async () => {
    const issue = jest.fn(async () => staff("org-a", ["inbound.view"]));
    const summary = jest.fn(async () => []);
    const app = express().use("/v2/organizations/:organizationId/action-center", createActionCenterRouter({
      principals: new IssuedV2PrincipalProvider({ authenticatedIdentity: async () => null }, { issue }), reader: { summary },
    }));
    await request(app).get("/v2/organizations/org-a/action-center").expect(403, denied);
    expect(issue).not.toHaveBeenCalled(); expect(summary).not.toHaveBeenCalled();
  });

  test.each(["inactive", "missing", "foreign"] as const)("real %s principal authority denial never reads counts", async (authority) => {
    const summary = jest.fn(async () => []);
    const app = express().use("/v2/organizations/:organizationId/action-center", createActionCenterRouter({
      principals: issued(["inbound.view"], authority), reader: { summary },
    }));
    await request(app).get("/v2/organizations/org-a/action-center").expect(403, denied);
    expect(summary).not.toHaveBeenCalled();
  });

  test("real provider WRONG_TENANT denial remains a sanitized 403", async () => {
    const summary = jest.fn(async () => []);
    const app = express().use("/v2/organizations/:organizationId/action-center", createActionCenterRouter({
      principals: new IssuedV2PrincipalProvider({ authenticatedIdentity: async () => identity }, { issue: async () => staff("org-other", ["inbound.view"]) }),
      reader: { summary },
    }));
    await request(app).get("/v2/organizations/org-a/action-center").expect(403, denied);
    expect(summary).not.toHaveBeenCalled();
  });

  test.each([
    new Error("PRIVATE_READER_DETAIL: connection unavailable"),
    Object.assign(new Error("PRIVATE_READER_DETAIL: SQL permission denied"), { code: "FORBIDDEN" }),
    new V2ApplicationError("FORBIDDEN", "PRIVATE_READER_DETAIL: reader failure is not principal denial"),
    new V2ApplicationError("RETRYABLE_FAILURE", "PRIVATE_READER_DETAIL: backend unavailable"),
  ])("reader infrastructure failure is a sanitized 500, never a principal denial (%#)", async (error) => {
    const summary = jest.fn(async () => { throw error; });
    const app = express().use("/v2/organizations/:organizationId/action-center", createActionCenterRouter({ principals: issued(["production.view"]), reader: { summary } }));
    await request(app).get("/v2/organizations/org-a/action-center").expect(500, unavailable);
    expect(summary).toHaveBeenCalledTimes(1); expect(summary).toHaveBeenCalledWith("org-a", ["production"]);
  });

  test("untyped principal infrastructure failure is sanitized and never reads counts", async () => {
    const summary = jest.fn(async () => []);
    const app = express().use("/v2/organizations/:organizationId/action-center", createActionCenterRouter({
      principals: { principal: async () => { throw Object.assign(new Error("PRIVATE_AUTH_DETAIL"), { code: "FORBIDDEN" }); } }, reader: { summary },
    }));
    await request(app).get("/v2/organizations/org-a/action-center").expect(500, unavailable);
    expect(summary).not.toHaveBeenCalled();
  });

  test("authorized account without operational grants receives an empty permitted category list", async () => {
    const summary = jest.fn(async () => []);
    const app = express().use("/v2/organizations/:organizationId/action-center", createActionCenterRouter({ principals: issued(["quote.view"]), reader: { summary } }));
    await request(app).get("/v2/organizations/org-a/action-center").expect(200, { ok: true, data: { items: [] } });
    expect(summary).toHaveBeenCalledWith("org-a", []);
  });

  test("all existing category grants are preserved and legitimate zero is returned unchanged", async () => {
    const items = [{ kind: "inbound", label: "Inbound needs review", count: 0, href: "/inbound-orders" }];
    const summary = jest.fn(async () => items);
    const app = express().use("/v2/organizations/:organizationId/action-center", createActionCenterRouter({
      principals: issued(["inbound.view", "proof.view", "prepress.view", "production.view", "invoice.view"]), reader: { summary },
    }));
    await request(app).get("/v2/organizations/org-a/action-center").expect(200, { ok: true, data: { items } });
    expect(summary).toHaveBeenCalledWith("org-a", ["inbound", "proofs", "prepress", "production", "invoices"]);
  });
});
