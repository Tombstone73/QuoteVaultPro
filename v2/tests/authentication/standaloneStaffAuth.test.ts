import { describe, expect, test } from "@jest/globals";
import express from "express";
import session from "express-session";
import request from "supertest";
import { PermissionSetPrincipalIssuer } from "../../src/authorization/permissionSets";
import {
  createStandaloneStaffAuthentication,
  loadV2StandaloneAuthConfig,
  safePortalReturnTo,
  type V2AuthenticatedStaff,
  type V2PortalCredentialLifecycle,
  type V2PortalCredentialVerifier,
  type V2StaffCredentialVerifier,
} from "../../infrastructure/authentication/standaloneStaffAuth";
import { requireV2CsrfToken } from "../../infrastructure/authentication/sessionCsrf";

const staff: V2AuthenticatedStaff = { id: "staff-a", email: "staff@example.test", displayName: "Staff A" };
const organizations = [{ id: "org-a", name: "Alpha" }, { id: "org-b", name: "Bravo" }];

const createVerifier = (): V2StaffCredentialVerifier & { revoked: boolean; organizations: readonly { id: string; name: string }[] } => ({
  revoked: false,
  organizations,
  async authenticate(email, password) { return email === staff.email && password === "correct-password" && !this.revoked ? staff : null; },
  async currentStaff(userId) { return userId === staff.id && !this.revoked ? staff : null; },
  async eligibleOrganizations() { return this.revoked ? [] : this.organizations; },
});

const appFor = (verifier = createVerifier(), config = loadV2StandaloneAuthConfig({ SESSION_SECRET: "x".repeat(32), NODE_ENV: "test" })) => {
  const app = express(); app.use(express.json());
  const auth = createStandaloneStaffAuthentication({
    verifier,
    config,
    sessionMiddleware: session({ name: "v2.sid", secret: "x".repeat(32), resave: false, saveUninitialized: false }),
  });
  auth.install(app);
  app.get("/v2/organizations/:organizationId/protected", auth.trustedHostMiddleware, async (req, res) => {
    const identity = await auth.trustedHostIdentity.authenticatedIdentity(req);
    res.json({ ok: true, data: { subjectId: identity?.subjectId } });
  });
  app.post("/v2/organizations/:organizationId/protected", auth.trustedHostMiddleware, requireV2CsrfToken, (_req, res) => res.json({ ok: true }));
  return { app, verifier };
};

describe("standalone V2 Staff authentication", () => {
  test("only preserves canonical internal V2 portal destinations", () => {
    expect(safePortalReturnTo("/portal")).toBe("/portal");
    expect(safePortalReturnTo("/portal/orders")).toBe("/portal/orders");
    expect(safePortalReturnTo("/portal/orders/order_1")).toBe("/portal/orders/order_1");
    expect(safePortalReturnTo("/portal/account")).toBe("/portal/account");
    expect(safePortalReturnTo("/portal/invoices")).toBe("/portal/invoices");
    expect(safePortalReturnTo("/portal/invoices/invoice_1")).toBe("/portal/invoices/invoice_1");
    expect(safePortalReturnTo("/portal/proofs")).toBe("/portal/proofs");
    expect(safePortalReturnTo("/portal/proofs/proof_1")).toBe("/portal/proofs/proof_1");
    for (const unsafe of ["https://attacker.invalid", "//attacker.invalid", "/\\attacker", "/staff", "/portal/orders/1/extra"]) expect(safePortalReturnTo(unsafe)).toBe("/portal");
  });
  test("rejects bad, unknown, inactive, and no-membership login without account enumeration", async () => {
    const { app, verifier } = appFor();
    for (const body of [{ email: staff.email, password: "wrong" }, { email: "unknown@example.test", password: "wrong" }]) {
      await request(app).post("/v2/auth/login").send(body).expect(401, { ok: false, error: { code: "INVALID_CREDENTIALS", message: "Invalid credentials." } });
    }
    verifier.revoked = true;
    await request(app).post("/v2/auth/login").send({ email: staff.email, password: "correct-password" }).expect(401, { ok: false, error: { code: "INVALID_CREDENTIALS", message: "Invalid credentials." } });
    verifier.revoked = false; verifier.organizations = [];
    await request(app).post("/v2/auth/login").send({ email: staff.email, password: "correct-password" }).expect(401, { ok: false, error: { code: "INVALID_CREDENTIALS", message: "Invalid credentials." } });
  });

  test("establishes, restores, switches, and destroys a minimal Staff session", async () => {
    const { app } = appFor(); const agent = request.agent(app);
    const login = await agent.post("/v2/auth/login").send({ email: staff.email, password: "correct-password" }).expect(200);
    expect(login.body.data.activeOrganizationId).toBeNull();
    expect(login.headers["set-cookie"][0]).toContain("v2.sid=");
    expect(login.headers["set-cookie"][0]).toContain("HttpOnly");
    const csrf = login.body.data.csrfToken as string;
    await agent.get("/v2/auth/session").expect(200).expect((response) => expect(response.body.data.staff).toEqual(staff));
    await agent.get("/v2/organizations/org-a/protected").expect(403);
    await agent.post("/v2/auth/active-organization").send({ organizationId: "org-missing" }).set("x-v2-csrf-token", csrf).expect(403);
    const selected = await agent.post("/v2/auth/active-organization").send({ organizationId: "org-a" }).set("x-v2-csrf-token", csrf).expect(200);
    await agent.get("/v2/organizations/org-a/protected").expect(200, { ok: true, data: { subjectId: "staff-a" } });
    await agent.post("/v2/organizations/org-a/protected").send({}).expect(403);
    await agent.post("/v2/organizations/org-a/protected").set("x-v2-csrf-token", selected.body.data.csrfToken).send({}).expect(200, { ok: true });
    await agent.get("/v2/organizations/org-b/protected").expect(403);
    const switched = await agent.post("/v2/auth/active-organization").send({ organizationId: "org-b" }).set("x-v2-csrf-token", selected.body.data.csrfToken).expect(200);
    await agent.get("/v2/auth/session").expect(200).expect((response) => expect(response.body.data.activeOrganizationId).toBe("org-b"));
    await agent.get("/v2/organizations/org-a/protected").expect(403);
    await agent.get("/v2/organizations/org-b/protected").expect(200, { ok: true, data: { subjectId: "staff-a" } });
    await agent.post("/v2/auth/logout").send({}).expect(403);
    await agent.post("/v2/auth/logout").send({}).set("x-v2-csrf-token", switched.body.data.csrfToken).expect(200);
    await agent.get("/v2/auth/session").expect(401);
  });

  test("revokes a session when the canonical Staff identity is no longer current", async () => {
    const { app, verifier } = appFor(); const agent = request.agent(app);
    await agent.post("/v2/auth/login").send({ email: staff.email, password: "correct-password" }).expect(200);
    verifier.revoked = true;
    await agent.get("/v2/organizations/org-a/protected").expect(401);
    await agent.get("/v2/auth/session").expect(401);
  });

  test("uses secure, host-only, SameSite=Lax cookies in production and rejects an untrusted origin", async () => {
    const config = loadV2StandaloneAuthConfig({ NODE_ENV: "production", SESSION_SECRET: "x".repeat(32), APP_PUBLIC_WEB_ORIGIN: "https://dev.printershero.com" });
    expect(config).toMatchObject({ secureCookies: true, publicWebOrigin: "https://dev.printershero.com" });
    const { app } = appFor(createVerifier(), config);
    await request(app).post("/v2/auth/login").set("origin", "https://attacker.invalid").send({ email: staff.email, password: "correct-password" }).expect(403);
    expect(() => loadV2StandaloneAuthConfig({ NODE_ENV: "production", SESSION_SECRET: "short" })).toThrow(/SESSION_SECRET/);
  });
});

describe("standalone V2 Customer Portal authentication", () => {
  const portal = { id: "portal-user", email: "customer@example.test", displayName: "Customer", organizationId: "org-a", customerId: "customer-a", credentialVersion: "2026-01-01T00:00:00.000Z" };
  const portalVerifier: V2PortalCredentialVerifier = {
    authenticatePortal: async (email, password) => email === portal.email && password === "correct-password" ? portal : null,
    currentPortal: async (userId, organizationId) => userId === portal.id && organizationId === portal.organizationId ? portal : null,
  };
  const lifecycle: V2PortalCredentialLifecycle & { setup: string[]; reset: string[]; requested: string[] } = {
    setup: [], reset: [], requested: [],
    async establishCredentials(token, password) { if (token !== "setup-token" || password.length < 12) throw new Error("This setup link is invalid or expired."); this.setup.push(token); },
    async requestPasswordReset(email) { this.requested.push(email); },
    async resetPassword(token, password) { if (token !== "reset-token" || password.length < 12) throw new Error("This password reset link is invalid or expired."); this.reset.push(token); },
  };
  const app = (state: { credentialVersion?: string; accessActive?: boolean; issuer?: boolean } = {}) => {
    const value = express(); value.use(express.json());
    const portalIssuer = new PermissionSetPrincipalIssuer({
      resolveStaff: async () => null,
      resolvePortal: async (userId, organizationId) => userId === portal.id && organizationId === portal.organizationId ? {
        organizationId: portal.organizationId,
        organizationActive: true,
        authorityRevision: "1",
        portal: {
          userId: portal.id, portalAccessId: "portal-access-a", customerId: portal.customerId,
          accessActive: state.accessActive ?? true,
          permissionSets: [{ id: "portal-set-a", name: "Portal", active: true, revision: 1 }],
          assignedCapabilities: ["invoice.view"], ceilingCapabilities: ["invoice.view"],
        },
      } : null,
    });
    createStandaloneStaffAuthentication({
      verifier: createVerifier(),
      portalVerifier: {
        ...portalVerifier,
        currentPortal: async (userId, organizationId) => {
          const current = await portalVerifier.currentPortal(userId, organizationId);
          return current && { ...current, credentialVersion: state.credentialVersion ?? current.credentialVersion };
        },
      },
      portalIssuer: state.issuer === false ? undefined : portalIssuer,
      portalLifecycle: lifecycle,
      config: loadV2StandaloneAuthConfig({ SESSION_SECRET: "x".repeat(32), NODE_ENV: "test" }),
      sessionMiddleware: session({ name: "v2.sid", secret: "x".repeat(32), resave: false, saveUninitialized: false }),
    }).install(value);
    return value;
  };
  test("uses one-time lifecycle endpoints without account enumeration and preserves safe deep links", async () => {
    await request(app()).post("/v2/portal/auth/setup").send({ token: "setup-token", password: "correct-password" }).expect(200);
    await request(app()).post("/v2/portal/auth/setup").send({ token: "bad", password: "correct-password" }).expect(400);
    const unknown = await request(app()).post("/v2/portal/auth/forgot-password").send({ email: "unknown@example.test" }).expect(202);
    expect(unknown.body.data).toEqual({ accepted: true });
    await request(app()).post("/v2/portal/auth/reset-password").send({ token: "reset-token", password: "correct-password" }).expect(200);
    const agent = request.agent(app());
    const login = await agent.post("/v2/portal/auth/login").send({ email: portal.email, password: "correct-password", returnTo: "//attacker.invalid" }).expect(200);
    expect(login.body.data.returnTo).toBe("/portal");
    const restored = await agent.get("/v2/portal/auth/session").expect(200);
    expect(restored.body.data.portal).toEqual({ displayName: portal.id, customerId: portal.customerId });
    expect(restored.body.data.returnTo).toBe("/portal");
  });
  test("rejects an existing Portal session after the credential version changes", async () => {
    const state = { credentialVersion: portal.credentialVersion };
    const agent = request.agent(app(state));
    await agent.post("/v2/portal/auth/login").send({ email: portal.email, password: "correct-password" }).expect(200);
    await agent.get("/v2/portal/auth/session").expect(200);
    state.credentialVersion = "2026-01-02T00:00:00.000Z";
    await agent.get("/v2/portal/auth/session").expect(401, { ok: false, error: { code: "UNAUTHENTICATED", message: "Portal authentication is required." } });
  });
  test("revalidates Portal authority after login", async () => {
    const state = { accessActive: true };
    const agent = request.agent(app(state));
    await agent.post("/v2/portal/auth/login").send({ email: portal.email, password: "correct-password" }).expect(200);
    await agent.get("/v2/portal/auth/session").expect(200);
    state.accessActive = false;
    await agent.get("/v2/portal/auth/session").expect(401, { ok: false, error: { code: "UNAUTHENTICATED", message: "Portal authentication is required." } });
  });
  test("cannot restore a Portal session without an authority issuer", async () => {
    const agent = request.agent(app({ issuer: false }));
    await agent.post("/v2/portal/auth/login").send({ email: portal.email, password: "correct-password" }).expect(200);
    await agent.get("/v2/portal/auth/session").expect(401, { ok: false, error: { code: "UNAUTHENTICATED", message: "Portal authentication is required." } });
  });
});
