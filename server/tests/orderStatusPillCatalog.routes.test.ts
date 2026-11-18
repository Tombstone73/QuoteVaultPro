import { readFileSync } from "node:fs";
import { beforeAll, beforeEach, describe, expect, jest, test } from "@jest/globals";
import express from "express";
import request from "supertest";

const calls: string[] = [];
const pill = { id: "pill-1", name: "New", notificationRules: { enabled: true } };
const service = {
  seedDefaultPillsForOrg: jest.fn(async () => ({ created: 0, skipped: true })),
  listStatusPills: jest.fn(async () => [pill]),
  createStatusPill: jest.fn(async () => pill),
  updateStatusPill: jest.fn(async () => pill),
  deleteStatusPill: jest.fn(async () => undefined),
  setDefaultPill: jest.fn(async () => undefined),
};

jest.unstable_mockModule("../tenantContext", () => ({
  getRequestOrganizationId: (req: { organizationId?: string }) => {
    if (!req.organizationId) throw new Error("Organization context not available. Ensure tenantContext middleware is applied.");
    return req.organizationId;
  },
}));
jest.unstable_mockModule("../services/orderStatusPillService", () => service);

let registerOrderStatusPillCatalogRoutes: typeof import("../routes/orderStatusPillCatalog.routes").registerOrderStatusPillCatalogRoutes;
beforeAll(async () => {
  ({ registerOrderStatusPillCatalogRoutes } = await import("../routes/orderStatusPillCatalog.routes"));
});
beforeEach(() => {
  calls.length = 0;
  jest.clearAllMocks();
});

function appWithCatalog(includeEarlierOrderDetail = false) {
  const app = express();
  app.use(express.json());
  const isAuthenticated = (req: any, res: any, next: any) => {
    calls.push("auth");
    if (req.header("x-auth") !== "yes") return res.status(401).json({ blocked: "auth" });
    next();
  };
  const tenantContext = (req: any, _res: any, next: any) => {
    calls.push("tenant");
    req.organizationId = req.header("x-org") || undefined;
    next();
  };
  const isAdminOrOwner = (req: any, res: any, next: any) => {
    calls.push("admin");
    if (req.header("x-role") !== "admin") return res.status(403).json({ blocked: "admin" });
    next();
  };
  if (includeEarlierOrderDetail) {
    app.get("/api/orders/:id", isAuthenticated, tenantContext, (req, res) => res.status(404).json({ message: "Order not found" }));
  }
  registerOrderStatusPillCatalogRoutes(app, { isAuthenticated, tenantContext, isAdminOrOwner });
  return app;
}

describe("order status-pill catalog HTTP contract", () => {
  test("public catalog alias authenticates, scopes, validates, seeds, and removes notification rules", async () => {
    const app = appWithCatalog();
    const unauthorized = await request(app).get("/api/order-status-pills");
    expect(unauthorized.status).toBe(401);
    expect(service.seedDefaultPillsForOrg).not.toHaveBeenCalled();

    const invalid = await request(app).get("/api/order-status-pills?state=invalid").set("x-auth", "yes").set("x-org", "org-a");
    expect(invalid.status).toBe(400);
    expect(invalid.body).toEqual({ success: false, message: "Invalid state parameter" });
    expect(service.seedDefaultPillsForOrg).not.toHaveBeenCalled();

    calls.length = 0;
    const response = await request(app).get("/api/order-status-pills?state=open").set("x-auth", "yes").set("x-org", "org-a");
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ success: true, data: [{ id: "pill-1", name: "New" }], pills: [{ id: "pill-1", name: "New" }] });
    expect(calls).toEqual(["auth", "tenant"]);
    expect(service.seedDefaultPillsForOrg).toHaveBeenCalledWith("org-a");
    expect(service.listStatusPills).toHaveBeenCalledWith("org-a", "open", true);
    expect(service.seedDefaultPillsForOrg.mock.invocationCallOrder[0]).toBeLessThan(service.listStatusPills.mock.invocationCallOrder[0]);
  });

  test("settings catalog requires admin and retains notification rules", async () => {
    const app = appWithCatalog();
    const denied = await request(app).get("/api/settings/order-status-pills").set("x-auth", "yes").set("x-org", "org-b");
    expect(denied.status).toBe(403);
    expect(service.seedDefaultPillsForOrg).not.toHaveBeenCalled();

    calls.length = 0;
    const response = await request(app).get("/api/settings/order-status-pills").set("x-auth", "yes").set("x-org", "org-b").set("x-role", "admin");
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ success: true, data: [pill], pills: [pill] });
    expect(calls).toEqual(["auth", "tenant", "admin"]);
    expect(service.seedDefaultPillsForOrg).toHaveBeenCalledWith("org-b");
    expect(service.listStatusPills).toHaveBeenCalledWith("org-b", undefined, false);
  });

  test("all four catalog mutations keep method, path, tenant, body, and response", async () => {
    const app = appWithCatalog();
    const headers = { "x-auth": "yes", "x-org": "org-c", "x-role": "admin" };
    const created = await request(app).post("/api/orders/status-pills").set(headers).send({ name: "New" });
    expect(created.status).toBe(200);
    expect(created.body).toEqual({ success: true, data: pill });
    expect(service.createStatusPill).toHaveBeenCalledWith("org-c", { name: "New" });

    const updated = await request(app).patch("/api/orders/status-pills/pill-1").set(headers).send({ color: "blue" });
    expect(updated.status).toBe(200);
    expect(updated.body).toEqual({ success: true, data: pill });
    expect(service.updateStatusPill).toHaveBeenCalledWith("org-c", "pill-1", { color: "blue" });

    const deleted = await request(app).delete("/api/orders/status-pills/pill-1").set(headers);
    expect(deleted.status).toBe(200);
    expect(deleted.body).toEqual({ success: true });
    expect(service.deleteStatusPill).toHaveBeenCalledWith("org-c", "pill-1");

    const defaulted = await request(app).post("/api/orders/status-pills/pill-1/make-default").set(headers);
    expect(defaulted.status).toBe(200);
    expect(defaulted.body).toEqual({ success: true });
    expect(service.setDefaultPill).toHaveBeenCalledWith("org-c", "pill-1");
    expect(calls).toEqual(Array(4).fill(["auth", "tenant", "admin"]).flat());
  });

  test("service validation and missing tenant retain their existing error envelopes", async () => {
    const app = appWithCatalog();
    const missingTenant = await request(app).post("/api/orders/status-pills").set("x-auth", "yes").set("x-role", "admin").send({});
    expect(missingTenant.status).toBe(400);
    expect(missingTenant.body).toEqual({ success: false, message: "Organization context not available. Ensure tenantContext middleware is applied." });
    expect(service.createStatusPill).not.toHaveBeenCalled();

    service.createStatusPill.mockRejectedValueOnce(new Error("Invalid status pill"));
    const invalid = await request(app).post("/api/orders/status-pills").set("x-auth", "yes").set("x-org", "org-d").set("x-role", "admin").send({});
    expect(invalid.status).toBe(400);
    expect(invalid.body).toEqual({ success: false, message: "Invalid status pill" });
  });

  test("the earlier order-detail route still shadows GET /api/orders/status-pills", async () => {
    const source = readFileSync("server/routes/orders.routes.ts", "utf8");
    const detail = source.indexOf('app.get("/api/orders/:id"');
    const catalog = source.indexOf("registerOrderStatusPillCatalogRoutes(app, { isAuthenticated, tenantContext, isAdminOrOwner })");
    const notifications = source.indexOf('app.put("/api/settings/order-status-pills/:pillId/notifications"');
    expect(detail).toBeGreaterThan(-1);
    expect(catalog).toBeGreaterThan(detail);
    expect(notifications).toBeGreaterThan(catalog);

    const app = appWithCatalog(true);
    const shadowed = await request(app).get("/api/orders/status-pills").set("x-auth", "yes").set("x-org", "org-e");
    expect(shadowed.status).toBe(404);
    expect(shadowed.body).toEqual({ message: "Order not found" });
    expect(service.seedDefaultPillsForOrg).not.toHaveBeenCalled();

    const alias = await request(app).get("/api/order-status-pills").set("x-auth", "yes").set("x-org", "org-e");
    expect(alias.status).toBe(200);
    expect(service.seedDefaultPillsForOrg).toHaveBeenCalledWith("org-e");
  });
});
