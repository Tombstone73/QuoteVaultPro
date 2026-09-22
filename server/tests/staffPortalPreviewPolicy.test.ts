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

let buildStaffPortalPreviewSession: any;
let canStartStaffPortalPreview: any;
let isCustomerInPreviewOrganization: any;
let isStaffPortalPreviewExpired: any;
let isStaffPortalPreviewReadMethod: any;
let sanitizeStaffPortalPreviewReturnTo: any;
let isStaffPortalPreviewPaymentActor: any;
let createAuthorizeStaffPreviewPayment: any;

beforeAll(async () => {
  const service = await import("../services/staffPortalPreviewService");
  buildStaffPortalPreviewSession = service.buildStaffPortalPreviewSession;
  canStartStaffPortalPreview = service.canStartStaffPortalPreview;
  isCustomerInPreviewOrganization = service.isCustomerInPreviewOrganization;
  isStaffPortalPreviewExpired = service.isStaffPortalPreviewExpired;
  isStaffPortalPreviewReadMethod = service.isStaffPortalPreviewReadMethod;
  sanitizeStaffPortalPreviewReturnTo = service.sanitizeStaffPortalPreviewReturnTo;
  isStaffPortalPreviewPaymentActor = service.isStaffPortalPreviewPaymentActor;
  createAuthorizeStaffPreviewPayment = (await import("../middleware/authorizeStaffPreviewPayment")).createAuthorizeStaffPreviewPayment;
});

describe("staff portal preview policy", () => {
  test("allows internal users and denies portal customers as preview actors", () => {
    expect(canStartStaffPortalPreview({ id: "staff_1", accountType: "INTERNAL_USER", role: "member" })).toBe(true);
    expect(canStartStaffPortalPreview({ id: "staff_2", role: "admin" })).toBe(true);

    expect(canStartStaffPortalPreview({ id: "portal_1", accountType: "PORTAL_CUSTOMER" })).toBe(false);
    expect(canStartStaffPortalPreview({ id: "portal_2", role: "customer" })).toBe(false);
    expect(canStartStaffPortalPreview({ accountType: "INTERNAL_USER" })).toBe(false);
  });

  test("builds a temporary active session with a thirty minute TTL", () => {
    const now = new Date("2026-06-01T12:00:00.000Z");
    const preview = buildStaffPortalPreviewSession({
      actorUserId: "staff_1",
      organizationId: "org_1",
      customerId: "cust_1",
      customerName: "Acme",
      returnTo: "/customers/cust_1",
      now,
    });

    expect(preview).toMatchObject({
      state: "ACTIVE",
      actorUserId: "staff_1",
      organizationId: "org_1",
      customerId: "cust_1",
      customerName: "Acme",
      returnTo: "/customers/cust_1",
    });
    expect(preview.startedAt).toBe("2026-06-01T12:00:00.000Z");
    expect(preview.expiresAt).toBe("2026-06-01T12:30:00.000Z");
  });

  test("expires sessions at TTL and keeps active sessions usable before TTL", () => {
    const preview = buildStaffPortalPreviewSession({
      actorUserId: "staff_1",
      organizationId: "org_1",
      customerId: "cust_1",
      customerName: "Acme",
      now: new Date("2026-06-01T12:00:00.000Z"),
    });

    expect(isStaffPortalPreviewExpired(preview, new Date("2026-06-01T12:29:59.000Z"))).toBe(false);
    expect(isStaffPortalPreviewExpired(preview, new Date("2026-06-01T12:30:00.000Z"))).toBe(true);
  });

  test("requires preview customer to belong to the active organization", () => {
    expect(isCustomerInPreviewOrganization({ organizationId: "org_1" }, "org_1")).toBe(true);
    expect(isCustomerInPreviewOrganization({ organizationId: "org_2" }, "org_1")).toBe(false);
    expect(isCustomerInPreviewOrganization(null, "org_1")).toBe(false);
  });

  test("sanitizes return targets and refuses portal/open-redirect targets", () => {
    expect(sanitizeStaffPortalPreviewReturnTo("/customers/cust_1", "cust_1")).toBe("/customers/cust_1");
    expect(sanitizeStaffPortalPreviewReturnTo("/portal", "cust_1")).toBe("/customers/cust_1");
    expect(sanitizeStaffPortalPreviewReturnTo("//evil.example", "cust_1")).toBe("/customers/cust_1");
    expect(sanitizeStaffPortalPreviewReturnTo("https://evil.example", "cust_1")).toBe("/customers/cust_1");
  });

  test("keeps staff preview read-only for portal APIs", () => {
    expect(isStaffPortalPreviewReadMethod("GET")).toBe(true);
    expect(isStaffPortalPreviewReadMethod("HEAD")).toBe(true);

    expect(isStaffPortalPreviewReadMethod("POST")).toBe(false);
    expect(isStaffPortalPreviewReadMethod("PATCH")).toBe(false);
    expect(isStaffPortalPreviewReadMethod("DELETE")).toBe(false);
  });

  test("grants payment execution only to an explicit platform developer in the exact active preview scope", () => {
    const preview = buildStaffPortalPreviewSession({
      actorUserId: "developer_1", organizationId: "org_1", customerId: "cust_1", customerName: "Acme",
      now: new Date("2026-06-01T12:00:00.000Z"),
    });
    // Keep the fixture active relative to the predicate's current clock.
    preview.expiresAt = new Date(Date.now() + 60_000).toISOString();
    const valid = { preview, user: { id: "developer_1", accountType: "INTERNAL_USER", role: "employee" }, organizationId: "org_1", customerId: "cust_1", isPlatformDeveloper: true, hasActiveOrganizationMembership: true };
    expect(isStaffPortalPreviewPaymentActor(valid)).toBe(true);
    expect(isStaffPortalPreviewPaymentActor({ ...valid, isPlatformDeveloper: false, user: { id: "developer_1", role: "admin" } })).toBe(false);
    expect(isStaffPortalPreviewPaymentActor({ ...valid, user: { id: "developer_1", role: "owner" }, isPlatformDeveloper: false })).toBe(false);
    expect(isStaffPortalPreviewPaymentActor({ ...valid, user: { id: "portal_1", accountType: "PORTAL_CUSTOMER" } })).toBe(false);
    expect(isStaffPortalPreviewPaymentActor({ ...valid, organizationId: "org_2" })).toBe(false);
    expect(isStaffPortalPreviewPaymentActor({ ...valid, customerId: "cust_2" })).toBe(false);
    expect(isStaffPortalPreviewPaymentActor({ ...valid, hasActiveOrganizationMembership: false })).toBe(false);
    expect(isStaffPortalPreviewPaymentActor({ ...valid, preview: { ...preview, expiresAt: "2020-01-01T00:00:00Z" } })).toBe(false);
  });

  test("direct preview payment API mutation fails closed without capability", async () => {
    const response: any = { status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() };
    const next = jest.fn();
    const previewRequest = { staffPortalPreview: { actorUserId: "staff_1" } } as any;
    await createAuthorizeStaffPreviewPayment(async () => false)(previewRequest, response, next);
    expect(response.status).toHaveBeenCalledWith(403);
    expect(response.json).toHaveBeenCalledWith(expect.objectContaining({ code: "STAFF_PORTAL_PREVIEW_PAYMENT_FORBIDDEN" }));
    expect(next).not.toHaveBeenCalled();

    await createAuthorizeStaffPreviewPayment(async () => true)(previewRequest, response, next);
    expect(next).toHaveBeenCalledTimes(1);
    next.mockClear();
    await createAuthorizeStaffPreviewPayment(async () => false)({} as any, response, next);
    expect(next).toHaveBeenCalledTimes(1); // ordinary customer portal path
  });
});
