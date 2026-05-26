import express from "express";
import request from "supertest";
import { beforeAll, beforeEach, describe, expect, jest, test } from "@jest/globals";

const sendEmailMock = jest.fn();

const dbMock = {
  select: jest.fn(),
  insert: jest.fn(),
  update: jest.fn(),
  delete: jest.fn(),
  transaction: jest.fn(),
};

jest.unstable_mockModule("../db", () => ({ db: dbMock }));
jest.unstable_mockModule("../tenantContext", () => ({
  getRequestOrganizationId: (req: any) => req.organizationId ?? "org_1",
}));
jest.unstable_mockModule("../emailService", () => ({
  emailService: { sendEmail: sendEmailMock },
}));
jest.unstable_mockModule("../lib/appRuntimeConfig", () => ({
  getPublicWebOrigin: () => "https://app.example.test",
}));

let registerUsersRoutes: any;

function chainResult<T>(result: T): any {
  const promise = Promise.resolve(result);
  return new Proxy(
    {},
    {
      get(_target, prop) {
        if (prop === "then") return promise.then.bind(promise);
        if (prop === "catch") return promise.catch.bind(promise);
        if (prop === "finally") return promise.finally.bind(promise);
        return () => chainResult(result);
      },
    },
  );
}

function buildApp(opts: { actorRole?: string; rejectAdmin?: boolean } = {}) {
  const app = express();
  app.use(express.json());

  registerUsersRoutes(app, {
    isAuthenticated: (req: any, _res: any, next: any) => {
      req.user = { id: "user_owner" };
      next();
    },
    tenantContext: (req: any, _res: any, next: any) => {
      req.organizationId = "org_1";
      req.orgRole = opts.actorRole ?? "owner";
      next();
    },
    requireOrgOwnerAdmin: (req: any, res: any, next: any) => {
      if (opts.rejectAdmin) {
        return res.status(403).json({ message: "Access denied. Organization Owner or Admin role required." });
      }
      req.actorOrgRole = opts.actorRole ?? "owner";
      next();
    },
    requireOrgCanInvite: (_req: any, _res: any, next: any) => next(),
    isAdminOrOwner: (_req: any, _res: any, next: any) => next(),
  });

  return app;
}

const ownerUser = {
  id: "user_owner",
  email: "owner@example.test",
  firstName: "Owner",
  lastName: "User",
  role: "employee",
  orgRole: "owner",
  isInvited: false,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

describe("users.routes organization member management", () => {
  beforeAll(async () => {
    const mod = await import("../routes/users.routes");
    registerUsersRoutes = mod.registerUsersRoutes;
  });

  beforeEach(() => {
    dbMock.select.mockReset();
    dbMock.insert.mockReset();
    dbMock.update.mockReset();
    dbMock.delete.mockReset();
    dbMock.transaction.mockReset();
    sendEmailMock.mockReset();
  });

  test("members list returns all users for the current organization", async () => {
    const rows = [
      ownerUser,
      { ...ownerUser, id: "user_admin", email: "admin@example.test", orgRole: "admin" },
      { ...ownerUser, id: "user_member", email: "member@example.test", orgRole: "member" },
    ];
    dbMock.select.mockReturnValue(chainResult(rows) as never);

    const res = await request(buildApp()).get("/api/users");

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(3);
    expect(res.body.map((row: any) => row.email)).toEqual([
      "owner@example.test",
      "admin@example.test",
      "member@example.test",
    ]);
  });

  test("invite path persists user, auth identity, and org membership in one transaction", async () => {
    const txMock = {
      select: jest.fn().mockReturnValue(chainResult([])),
      insert: jest.fn().mockReturnValue(chainResult([])),
    };
    dbMock.transaction.mockImplementation(async (callback: any) => callback(txMock));

    const res = await request(buildApp({ actorRole: "admin" }))
      .post("/api/users/invite")
      .send({ email: "new-user@example.test", orgRole: "member" });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(dbMock.transaction).toHaveBeenCalledTimes(1);
    expect(txMock.insert).toHaveBeenCalledTimes(3);
  });

  test("cannot demote the last owner", async () => {
    dbMock.select
      .mockReturnValueOnce(chainResult([{ userId: "user_owner", organizationId: "org_1", role: "owner" }]) as never)
      .mockReturnValueOnce(chainResult([{ count: 1 }]) as never);

    const res = await request(buildApp({ actorRole: "owner" }))
      .patch("/api/users/user_other_owner")
      .send({ orgRole: "admin" });

    expect(res.status).toBe(400);
    expect(res.body.message).toBe("Cannot remove the last owner");
    expect(dbMock.update).not.toHaveBeenCalled();
  });

  test("cannot remove the last owner", async () => {
    dbMock.select
      .mockReturnValueOnce(chainResult([{ userId: "user_other_owner", organizationId: "org_1", role: "owner" }]) as never)
      .mockReturnValueOnce(chainResult([{ count: 1 }]) as never);

    const res = await request(buildApp({ actorRole: "owner" }))
      .delete("/api/users/user_other_owner");

    expect(res.status).toBe(400);
    expect(res.body.message).toBe("Cannot remove the last owner");
    expect(dbMock.delete).not.toHaveBeenCalled();
  });

  test("unauthorized role changes are rejected before mutation", async () => {
    const res = await request(buildApp({ rejectAdmin: true }))
      .patch("/api/users/user_member")
      .send({ orgRole: "admin" });

    expect(res.status).toBe(403);
    expect(dbMock.update).not.toHaveBeenCalled();
  });
});
