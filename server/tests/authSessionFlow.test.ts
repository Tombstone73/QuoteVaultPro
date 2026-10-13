import { afterAll, beforeAll, beforeEach, describe, expect, jest, test } from "@jest/globals";
import express from "express";
import request from "supertest";
import session from "express-session";
import bcrypt from "bcryptjs";

const staff = { id: "staff-1", email: "staff@example.test", role: "owner", accountType: "INTERNAL_USER" };
const portal = { id: "portal-1", email: "portal@example.test", role: "customer", accountType: "PORTAL_CUSTOMER" };
const passwordHash = bcrypt.hashSync("correct-password", 4);
const rows = new Map<string, any>();
let failSave = false;

jest.unstable_mockModule("connect-pg-simple", () => ({
  default: () => class TestStore extends session.Store {
    get(sid: string, callback: (error: Error | null, value?: any) => void) {
      callback(null, rows.get(sid));
    }
    set(sid: string, value: any, callback: (error?: Error | null) => void) {
      if (failSave) return callback(new Error("test store unavailable"));
      rows.set(sid, value);
      callback(null);
    }
    destroy(sid: string, callback: (error?: Error | null) => void) {
      rows.delete(sid);
      callback(null);
    }
  },
}));
jest.unstable_mockModule("../storage", () => ({
  storage: {
    getUserByEmail: async (email: string) => email === staff.email ? staff : email === portal.email ? portal : undefined,
    getUser: async (id: string) => id === staff.id ? staff : id === portal.id ? portal : undefined,
  },
}));
jest.unstable_mockModule("../db", () => ({
  db: {
    select: () => ({ from: () => ({ where: () => ({ limit: async () => [{ passwordHash, passwordSetAt: new Date() }] }) }) }),
    update: () => ({ set: () => ({ where: async () => [] }) }),
  },
}));
jest.unstable_mockModule("../tenantContext", () => ({ getUserOrganizations: async () => [] }));
jest.unstable_mockModule("../emailService", () => ({ emailService: {} }));
jest.unstable_mockModule("../services/customerPortalAccessService", () => ({
  getPortalAccessForLogin: async () => ({ status: "ACTIVE" }),
  isPortalCustomerIdentity: (user: any) => user?.accountType === "PORTAL_CUSTOMER",
  recordPortalLogin: async () => {},
  startDefaultPortalPasswordSetup: async () => {},
}));

let app: express.Express;
const originalEnv = {
  NODE_ENV: process.env.NODE_ENV,
  APP_ENV: process.env.APP_ENV,
  APP_PUBLIC_WEB_ORIGIN: process.env.APP_PUBLIC_WEB_ORIGIN,
  APP_COOKIE_DOMAIN: process.env.APP_COOKIE_DOMAIN,
  SESSION_SECRET: process.env.SESSION_SECRET,
};

beforeAll(async () => {
  process.env.NODE_ENV = "production";
  process.env.APP_ENV = "development";
  process.env.APP_PUBLIC_WEB_ORIGIN = "http://localhost:3000";
  delete process.env.APP_COOKIE_DOMAIN;
  process.env.SESSION_SECRET = "test-only-auth-session-secret";
  const { setupAuth } = await import("../localAuth");
  app = express();
  app.use(express.json());
  await setupAuth(app);
});

afterAll(() => {
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

beforeEach(() => {
  rows.clear();
  failSave = false;
});

describe("staff and portal HTTP sessions", () => {
  test("a valid staff login survives session reads and navigation even with a stale legacy cookie", async () => {
    const agent = request.agent(app);
    const login = await agent.post("/api/auth/login").send({ email: staff.email, password: "correct-password" });
    expect(login.status).toBe(200);
    expect(login.headers["set-cookie"]?.[0]).toContain("connect.sid.dev=");
    expect(rows.size).toBe(1);

    const sidCookie = login.headers["set-cookie"][0].split(";")[0];
    const withLegacyCookie = await request(app).get("/api/auth/session")
      .set("Cookie", `connect.sid=stale-main-cookie; ${sidCookie}`);
    expect(withLegacyCookie.status).toBe(200);
    expect(withLegacyCookie.body.user.id).toBe(staff.id);

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const refreshed = await agent.get("/api/auth/session");
      expect(refreshed.status).toBe(200);
      expect(refreshed.body.authenticated).toBe(true);
    }

    const logout = await agent.post("/api/auth/logout");
    expect(logout.status).toBe(200);
    expect(logout.headers["set-cookie"]?.[0]).toContain("connect.sid.dev=");
    expect((await agent.get("/api/auth/session")).status).toBe(401);
    expect((await agent.post("/api/auth/login").send({ email: staff.email, password: "correct-password" })).status).toBe(200);
    expect((await agent.get("/api/auth/session")).status).toBe(200);
  });

  test("rejects an invalid password and does not create a session", async () => {
    const agent = request.agent(app);
    expect((await agent.post("/api/auth/login").send({ email: staff.email, password: "wrong" })).status).toBe(401);
    expect((await agent.get("/api/auth/session")).status).toBe(401);
    expect(rows.size).toBe(0);
  });

  test("does not return success when the session store rejects a save", async () => {
    failSave = true;
    const agent = request.agent(app);
    const result = await agent.post("/api/auth/login").send({ email: staff.email, password: "correct-password" });
    expect(result.status).not.toBe(200);
    expect((await agent.get("/api/auth/session")).status).toBe(401);
  });

  test("portal login retains its portal identity", async () => {
    const agent = request.agent(app);
    const login = await agent.post("/api/auth/login").send({ email: portal.email, password: "correct-password" });
    expect(login.status).toBe(200);
    const checked = await agent.get("/api/auth/session");
    expect(checked.status).toBe(200);
    expect(checked.body.user.accountType).toBe("PORTAL_CUSTOMER");
  });

  test("DEV and MAIN use different cookie names without changing MAIN security policy", async () => {
    const { getSessionCookieConfig, getSessionCookieName } = await import("../lib/appRuntimeConfig");
    expect(getSessionCookieName()).toBe("connect.sid.dev");
    process.env.APP_PUBLIC_WEB_ORIGIN = "https://dev.printershero.com";
    process.env.APP_COOKIE_DOMAIN = "api-dev.printershero.com";
    try {
      expect(getSessionCookieConfig(1000)).toMatchObject({
        domain: "api-dev.printershero.com", secure: true, httpOnly: true, sameSite: "lax",
      });
      process.env.APP_ENV = "production";
      process.env.APP_PUBLIC_WEB_ORIGIN = "https://www.printershero.com";
      delete process.env.APP_COOKIE_DOMAIN;
      expect(getSessionCookieName()).toBe("connect.sid");
      expect(getSessionCookieConfig(1000)).toMatchObject({ secure: true, httpOnly: true, sameSite: "lax" });
    } finally {
      process.env.APP_ENV = "development";
      process.env.APP_PUBLIC_WEB_ORIGIN = "http://localhost:3000";
      delete process.env.APP_COOKIE_DOMAIN;
    }
  });
});
