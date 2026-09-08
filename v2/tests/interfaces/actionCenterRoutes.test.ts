import express from "express";
import request from "supertest";
import { describe, expect, test } from "@jest/globals";
import { createActionCenterRouter } from "../../src/interfaces/http/actionCenterRoutes";
import type { StaffPrincipal } from "../../src/authorization/principals";

const staff = (organizationId: string, capabilities: readonly string[]): StaffPrincipal => ({
  kind: "staff", organizationId, userId: "staff-a", authority: { membershipId: "membership-a", capabilities: capabilities as any },
});

describe("M7.5K action-center HTTP projection", () => {
  test("returns only canonical categories the scoped principal may view", async () => {
    const calls: unknown[] = [];
    const app = express().use("/v2/organizations/:organizationId/action-center", createActionCenterRouter({
      principals: { principal: async () => staff("org-a", ["inbound.view"]) },
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
});
