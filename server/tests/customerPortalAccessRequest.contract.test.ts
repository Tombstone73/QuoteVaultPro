import { describe, expect, test } from "@jest/globals";
import { readFileSync } from "node:fs";
import path from "node:path";

const source = (file: string) => readFileSync(path.join(process.cwd(), file), "utf8");

describe("public customer portal access requests", () => {
  const routes = source("server/routes/customerPortalAccess.routes.ts");
  const service = source("server/services/customerPortalAccessService.ts");
  const login = source("client/src/pages/login.tsx");
  const app = source("client/src/App.tsx");
  const acceptInvite = source("client/src/pages/accept-invite.tsx");

  test("uses a generic browser response with both IP and normalized-email throttles", () => {
    expect(routes).toContain('"/api/customer-portal/request-access"');
    expect(routes).toContain("GENERIC_PORTAL_ACCESS_RESPONSE");
    expect(routes).toContain("portalAccessIpLimiter");
    expect(routes).toContain("portalAccessEmailLimiter");
    expect(routes).toContain("sha256Hex(normalizePortalEmail(req.body?.email)");
    expect(routes).toContain("res.status(200).json(GENERIC_PORTAL_ACCESS_RESPONSE)");
  });

  test("is tenant-scoped, exact-email only, and fails closed for ambiguous or disabled records", () => {
    const requestFlow = service.slice(service.indexOf("export async function requestCustomerPortalAccess"), service.indexOf("/**\n * Backward-compatible URL-only form"));
    expect(requestFlow).toContain("eq(customerContactLinks.organizationId, input.organizationId)");
    expect(requestFlow).toContain("sql`lower(${customerContacts.email}) = ${email}`");
    expect(requestFlow).toContain("matches.length !== 1");
    expect(requestFlow).toContain('existing?.status === "DISABLED"');
    expect(requestFlow).toContain('existing?.status === "SUSPENDED"');
    expect(requestFlow).toContain("requestCustomerPortalAccess");
  });

  test("refreshes pending invitations, reuses active recovery, and preserves one-time token revocation", () => {
    const resendFlow = service.slice(service.indexOf("export async function resendCustomerPortalInvite"), service.indexOf("export async function cancelCustomerPortalInvite"));
    expect(service).toContain('existing?.status === "PENDING_INVITE"');
    expect(service).toContain("resendCustomerPortalInvite({");
    expect(service).toContain('existing?.status === "ACTIVE"');
    expect(service).toContain("issueCustomerPortalPasswordReset");
    expect(resendFlow).toContain("createInviteToken");
    expect(service).toContain("isNull(customerPortalInviteTokens.revokedAt)");
  });

  test("exposes the self-service entry point from login", () => {
    expect(login).toContain("Request Portal Access");
    expect(login).toContain('href="/request-portal-access"');
    expect(app).toContain('path="/request-portal-access"');
    expect(acceptInvite).toContain("Request a new access link");
  });
});
