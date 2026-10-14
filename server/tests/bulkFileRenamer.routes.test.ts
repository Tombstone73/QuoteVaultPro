import express from "express";
import request from "supertest";
import { jest } from "@jest/globals";

jest.unstable_mockModule("../db", () => ({ db: {} }));
jest.unstable_mockModule("../tenantContext", () => ({ getRequestOrganizationId: (req: any) => req.organizationId }));

const { registerBulkFileRenamerRoutes } = await import("../routes/bulkFileRenamer.routes");

describe("Bulk File Renamer authorization boundary", () => {
  const oldSecret = process.env.SESSION_SECRET;
  beforeAll(() => { process.env.SESSION_SECRET = "bulk-renamer-route-test-secret"; });
  afterAll(() => {
    if (oldSecret === undefined) delete process.env.SESSION_SECRET;
    else process.env.SESSION_SECRET = oldSecret;
  });

  test("tenant A can approve while tenant B and disabled tenant A cannot execute", async () => {
    const enabled = new Map([["tenant-a", true], ["tenant-b", false]]);
    const app = express();
    app.use(express.json());
    registerBulkFileRenamerRoutes(app, {
      isAuthenticated: (req: any, _res: any, next: any) => { req.user = { id: "staff" }; next(); },
      tenantContext: (req: any, _res: any, next: any) => { req.organizationId = req.headers["x-test-org"]; next(); },
      assertInternalUser: () => true,
    }, { isEnabled: async (organizationId) => enabled.get(organizationId) === true });

    expect((await request(app).get("/api/tools/bulk-file-renamer/status").set("x-test-org", "tenant-b")).body.enabled).toBe(false);
    expect((await request(app).post("/api/tools/bulk-file-renamer/plan").set("x-test-org", "tenant-b")
      .send({ prefix: "20685", filenames: ["Banner.pdf"] })).status).toBe(403);
    const approved = await request(app).post("/api/tools/bulk-file-renamer/plan").set("x-test-org", "tenant-a")
      .send({ prefix: "20685", filenames: ["Banner.pdf", "20685  Cut.pdf"] }).expect(200);
    expect(approved.body.entries.map((entry: any) => entry.status)).toEqual(["ready", "already_prefixed"]);
    const body = {
      authorizationToken: approved.body.authorizationToken,
      prefix: approved.body.prefix,
      entries: approved.body.entries,
    };
    expect((await request(app).post("/api/tools/bulk-file-renamer/authorize").send(body)).body.authorized).toBe(true);
    expect((await request(app).post("/api/tools/bulk-file-renamer/authorize")
      .send({ ...body, entries: [{ ...body.entries[0], proposedName: "wrong.pdf" }, body.entries[1]] })).status).toBe(403);
    enabled.set("tenant-a", false);
    expect((await request(app).post("/api/tools/bulk-file-renamer/authorize").send(body)).status).toBe(403);
  });

  test("invalid selected names receive no executable plan", async () => {
    const app = express(); app.use(express.json());
    registerBulkFileRenamerRoutes(app, {
      isAuthenticated: (_req: any, _res: any, next: any) => next(),
      tenantContext: (req: any, _res: any, next: any) => { req.organizationId = "tenant-a"; next(); },
      assertInternalUser: () => true,
    }, { isEnabled: async () => true });
    const response = await request(app).post("/api/tools/bulk-file-renamer/plan")
      .send({ prefix: "20685", filenames: ["Banner.pdf", "20685  Banner.pdf"] });
    expect(response.status).toBe(422);
    expect(response.body.authorizationToken).toBeUndefined();
    expect((await request(app).post("/api/tools/bulk-file-renamer/plan")
      .send({ prefix: "20685", filenames: ["Banner.pdf"], fileContents: "must not transfer" })).status).toBe(400);
  });

  test("portal identities cannot view status or request plans", async () => {
    const app = express(); app.use(express.json());
    registerBulkFileRenamerRoutes(app, {
      isAuthenticated: (_req: any, _res: any, next: any) => next(),
      tenantContext: (req: any, _res: any, next: any) => { req.organizationId = "tenant-a"; next(); },
      assertInternalUser: (_req: any, res: any) => { res.status(403).json({ error: "staff only" }); return false; },
    }, { isEnabled: async () => true });
    expect((await request(app).get("/api/tools/bulk-file-renamer/status")).status).toBe(403);
    expect((await request(app).post("/api/tools/bulk-file-renamer/plan")
      .send({ prefix: "20685", filenames: ["Banner.pdf"] })).status).toBe(403);
  });
});
