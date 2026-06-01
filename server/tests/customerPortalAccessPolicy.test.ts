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

beforeAll(async () => {
  const service = await import("../services/customerPortalAccessService");
  assertCustomerPortalTransition = service.assertCustomerPortalTransition;
  isAllowedPortalCustomerApiPath = service.isAllowedPortalCustomerApiPath;
  isPortalCustomerIdentity = service.isPortalCustomerIdentity;
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

    expect(isAllowedPortalCustomerApiPath("/api/orders")).toBe(false);
    expect(isAllowedPortalCustomerApiPath("/api/customers")).toBe(false);
    expect(isAllowedPortalCustomerApiPath("/api/settings/company")).toBe(false);
    expect(isAllowedPortalCustomerApiPath("/api/production/jobs")).toBe(false);
  });
});
