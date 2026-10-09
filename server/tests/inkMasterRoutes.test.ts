import { beforeAll, describe, expect, jest, test } from "@jest/globals";
import express from "express";
import request from "supertest";

// The injected service makes these HTTP authorization and tenant-boundary
// tests independent of a hosted database. No connection is opened.
process.env.DATABASE_URL ||= "postgresql://ink-master-test:ink-master-test@localhost:5432/ink-master-test";

let registerInkMasterRoutes: typeof import("../routes/inkMaster.routes").registerInkMasterRoutes;
let InkMasterError: typeof import("../services/inkMasterService").InkMasterError;

beforeAll(async () => {
  ({ registerInkMasterRoutes } = await import("../routes/inkMaster.routes"));
  ({ InkMasterError } = await import("../services/inkMasterService"));
});

function makeApp() {
  const app = express();
  app.use(express.json());
  const service = {
    listInkMasterPrinters: jest.fn(async (org: string) => [{ id: `${org}-printer`, organizationId: org }]),
    createInkMasterPrinter: jest.fn(async (org: string) => ({ id: `${org}-new`, organizationId: org })),
    updateInkMasterPrinter: jest.fn(async () => ({ id: "updated" })),
    setInkMasterPrinterActive: jest.fn(async () => ({ id: "deactivated" })),
    listInkMasterSpecs: jest.fn(async (org: string) => [{ id: `${org}-spec`, organizationId: org }]),
    createInkMasterSpec: jest.fn(async (org: string) => ({ id: `${org}-new-spec`, organizationId: org })),
    updateInkMasterSpec: jest.fn(async () => ({ id: "updated" })),
    deleteInkMasterSpec: jest.fn(async () => ({ deleted: true })),
  };
  registerInkMasterRoutes(app, {
    isAuthenticated: (req: any, res: any, next: any) => req.header("x-test-user") === "staff"
      ? next() : res.status(401).json({ error: "Unauthorized" }),
    tenantContext: (req: any, res: any, next: any) => {
      const org = req.header("x-test-org");
      if (!org) return res.status(403).json({ error: "Organization required" });
      req.organizationId = org;
      return next();
    },
  }, service as any);
  return { app, service };
}

const printer = { name: "Test", containerSizeLiters: 1, containerPriceCents: 10000, restockTargetLiters: 2 };
const usage = { cyan: 1, magenta: 0, yellow: 0, black: 0, white: 0 };

describe("Ink Master API boundaries", () => {
  test("all writes reject unauthenticated requests before reaching persistence", async () => {
    const { app, service } = makeApp();
    const base = "/api/mini-apps/ink-master";
    const responses = await Promise.all([
      request(app).post(`${base}/printers`).send(printer),
      request(app).patch(`${base}/printers/p1`).send({ name: "Updated" }),
      request(app).delete(`${base}/printers/p1`),
      request(app).post(`${base}/printers/p1/activate`),
      request(app).post(`${base}/specs`).send({ name: "Spec", printerId: "p1", printSides: "single", usageMlPerSheetSide: usage }),
      request(app).patch(`${base}/specs/s1`).send({ name: "Updated" }),
      request(app).delete(`${base}/specs/s1`),
    ]);
    expect(responses.map((response) => response.status)).toEqual(Array(7).fill(401));
    expect(service.createInkMasterPrinter).not.toHaveBeenCalled();
    expect(service.createInkMasterSpec).not.toHaveBeenCalled();
    expect(service.setInkMasterPrinterActive).not.toHaveBeenCalled();
  });

  test("staff requests require organization context and carry the resolved tenant to reads", async () => {
    const { app, service } = makeApp();
    const base = "/api/mini-apps/ink-master";
    expect((await request(app).get(`${base}/printers`).set("x-test-user", "staff")).status).toBe(403);
    const first = await request(app).get(`${base}/printers`).set("x-test-user", "staff").set("x-test-org", "org-a");
    const second = await request(app).get(`${base}/specs`).set("x-test-user", "staff").set("x-test-org", "org-b");
    expect(first.body.data).toEqual([{ id: "org-a-printer", organizationId: "org-a" }]);
    expect(second.body.data).toEqual([{ id: "org-b-spec", organizationId: "org-b" }]);
    expect(service.listInkMasterPrinters).toHaveBeenCalledWith("org-a");
    expect(service.listInkMasterSpecs).toHaveBeenCalledWith("org-b");
  });

  test("client-supplied organization and manual inventory cannot enter persisted records", async () => {
    const { app, service } = makeApp();
    const base = "/api/mini-apps/ink-master";
    const headers = { "x-test-user": "staff", "x-test-org": "org-a" };
    expect((await request(app).post(`${base}/printers`).set(headers).send({ ...printer, organizationId: "org-b" })).status).toBe(400);
    expect((await request(app).post(`${base}/specs`).set(headers).send({ name: "Spec", printerId: "p1", printSides: "single", usageMlPerSheetSide: usage, currentInventoryLiters: usage })).status).toBe(400);
    expect(service.createInkMasterPrinter).not.toHaveBeenCalled();
    expect(service.createInkMasterSpec).not.toHaveBeenCalled();
    const valid = await request(app).post(`${base}/printers`).set(headers).send(printer);
    expect(valid.status).toBe(201);
    expect(service.createInkMasterPrinter).toHaveBeenCalledWith("org-a", printer);
  });

  test("last-printer protection returns a conflict instead of success", async () => {
    const { app, service } = makeApp();
    service.setInkMasterPrinterActive.mockRejectedValueOnce(new InkMasterError("The last active printer cannot be deleted", 409));
    const response = await request(app).delete("/api/mini-apps/ink-master/printers/p1")
      .set("x-test-user", "staff").set("x-test-org", "org-a");
    expect(response.status).toBe(409);
    expect(response.body.success).toBe(false);
    expect(service.setInkMasterPrinterActive).toHaveBeenCalledWith("org-a", "p1", false);
  });
});
