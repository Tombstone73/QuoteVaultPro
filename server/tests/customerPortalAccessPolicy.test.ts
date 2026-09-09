import { beforeAll, describe, expect, jest, test } from "@jest/globals";

jest.unstable_mockModule("../db", () => ({
  db: {},
}));

jest.unstable_mockModule("../emailService", () => ({
  emailService: { sendEmail: jest.fn() },
}));

jest.unstable_mockModule("../lib/appRuntimeConfig", () => ({
  getPublicWebOrigin: () => "https://app.example.test",
}));

let assertCustomerPortalTransition: any;
let isAllowedPortalCustomerApiPath: any;
let isPortalCustomerIdentity: any;
let getPortalInviteExpiry: any;
let normalizePortalEmail: any;

beforeAll(async () => {
  const service = await import("../services/customerPortalAccessService");
  assertCustomerPortalTransition = service.assertCustomerPortalTransition;
  isAllowedPortalCustomerApiPath = service.isAllowedPortalCustomerApiPath;
  isPortalCustomerIdentity = service.isPortalCustomerIdentity;
  getPortalInviteExpiry = service.getPortalInviteExpiry;
  normalizePortalEmail = service.normalizePortalEmail;
});

describe("customer portal access policy", () => {
  test("allows only explicit portal access state transitions", () => {
    expect(() => assertCustomerPortalTransition("DISABLED", "PENDING_INVITE")).not.toThrow();
    expect(() => assertCustomerPortalTransition("PENDING_INVITE", "ACTIVE")).not.toThrow();
    expect(() => assertCustomerPortalTransition("ACTIVE", "SUSPENDED")).not.toThrow();
    expect(() => assertCustomerPortalTransition("SUSPENDED", "ACTIVE")).not.toThrow();
    expect(() => assertCustomerPortalTransition("ACTIVE", "DISABLED")).not.toThrow();

    expect(() => assertCustomerPortalTransition("DISABLED", "ACTIVE")).toThrow();
    expect(() => assertCustomerPortalTransition("PENDING_INVITE", "SUSPENDED")).toThrow();
    expect(() => assertCustomerPortalTransition("SUSPENDED", "DISABLED")).toThrow();
  });

  test("identifies portal customers independently from internal users", () => {
    expect(isPortalCustomerIdentity({ accountType: "PORTAL_CUSTOMER", role: "customer" })).toBe(true);
    expect(isPortalCustomerIdentity({ accountType: "INTERNAL_USER", role: "admin" })).toBe(false);
    expect(isPortalCustomerIdentity({ role: "customer" })).toBe(true);
  });

  test("deny-by-default API allowlist excludes internal APIs", () => {
    expect(isAllowedPortalCustomerApiPath("/api/portal/orders")).toBe(true);
    expect(isAllowedPortalCustomerApiPath("/api/auth/session")).toBe(true);
    expect(isAllowedPortalCustomerApiPath("/api/customer-portal/request-access")).toBe(true);

    expect(isAllowedPortalCustomerApiPath("/api/portal/preview/start")).toBe(false);
    expect(isAllowedPortalCustomerApiPath("/api/portal/preview/session")).toBe(false);
    expect(isAllowedPortalCustomerApiPath("/api/orders")).toBe(false);
    expect(isAllowedPortalCustomerApiPath("/api/customers")).toBe(false);
    expect(isAllowedPortalCustomerApiPath("/api/settings/company")).toBe(false);
    expect(isAllowedPortalCustomerApiPath("/api/production/jobs")).toBe(false);
  });

  test("uses one seven-day expiration calculation and canonical email normalization", () => {
    const issuedAt = new Date("2026-09-09T12:00:00.000Z");
    expect(getPortalInviteExpiry(issuedAt).toISOString()).toBe("2026-09-16T12:00:00.000Z");
    expect(normalizePortalEmail("  Contact@Example.test ")).toBe("contact@example.test");
    expect(normalizePortalEmail("not-an-email")).toBeNull();
  });
});
