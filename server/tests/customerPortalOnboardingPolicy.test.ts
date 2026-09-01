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

let buildPortalOnboardingRows: any;
let filterPortalOnboardingRows: any;

beforeAll(async () => {
  const service = await import("../services/customerPortalOnboardingService");
  buildPortalOnboardingRows = service.buildPortalOnboardingRows;
  filterPortalOnboardingRows = service.filterPortalOnboardingRows;
});

const now = new Date("2026-07-14T12:00:00.000Z");

function buildRows(overrides: Record<string, unknown> = {}) {
  return buildPortalOnboardingRows({
    now,
    customers: [
      { id: "cust_1", companyName: "Adapt Media", status: "active" },
      { id: "cust_2", companyName: "Metro Placeholder", status: "active" },
      { id: "cust_3", companyName: "Archived Co", status: "archived" },
    ],
    contacts: [
      { id: "contact_primary", firstName: "Ada", lastName: "Owner", email: "ada@adapt.example.org", status: "active", flags: [] },
      { id: "contact_billing", firstName: "Bill", lastName: "Buyer", email: "billing@adapt.example.org", status: "active", flags: [] },
      { id: "contact_invalid", firstName: "Invalid", lastName: "Email", email: "not-an-email", status: "active", flags: [] },
      { id: "contact_rejected", firstName: "Rejected", lastName: "Person", email: "rejected@adapt.example.org", status: "active", flags: ["migration_rejected"] },
      { id: "contact_duplicate", firstName: "Dana", lastName: "Duplicate", email: "shared@example.org", status: "active", flags: [] },
      { id: "contact_duplicate_two", firstName: "Dee", lastName: "Duplicate", email: "shared@example.org", status: "active", flags: [] },
      { id: "contact_internal", firstName: "Titan", lastName: "Vendor", email: "support@titan.example", status: "active", flags: [] },
      { id: "contact_archived", firstName: "Archive", lastName: "User", email: "archive@example.org", status: "active", flags: [] },
    ],
    relationships: [
      { customerId: "cust_1", contactId: "contact_primary", status: "active", isPrimary: true, isBilling: false, role: "Owner" },
      { customerId: "cust_1", contactId: "contact_billing", status: "active", isPrimary: false, isBilling: true, role: "Billing" },
      { customerId: "cust_1", contactId: "contact_invalid", status: "active", isPrimary: false, isBilling: false, role: "Viewer" },
      { customerId: "cust_1", contactId: "contact_rejected", status: "active", isPrimary: false, isBilling: false, role: "Viewer" },
      { customerId: "cust_1", contactId: "contact_duplicate", status: "active", isPrimary: false, isBilling: false, role: "Viewer" },
      { customerId: "cust_2", contactId: "contact_duplicate_two", status: "active", isPrimary: true, isBilling: false, role: "Owner" },
      { customerId: "cust_2", contactId: "contact_internal", status: "active", isPrimary: false, isBilling: false, role: "Vendor" },
      { customerId: "cust_3", contactId: "contact_archived", status: "active", isPrimary: true, isBilling: false, role: "Owner" },
    ],
    accesses: [],
    inviteTokens: [],
    companySettings: [
      { customerId: "cust_1", state: "enabled" },
      { customerId: "cust_2", state: "disabled" },
      { customerId: "cust_3", state: "suspended" },
    ],
    ...overrides,
  });
}

describe("customer portal bulk onboarding policy", () => {
  test("recommends eligible primary contact before billing or other contacts", () => {
    const rows = buildRows();
    const adapt = rows.find((row: any) => row.customerId === "cust_1");

    expect(adapt.recommendedContactId).toBe("contact_primary");
    const primary = adapt.contacts.find((contact: any) => contact.contactId === "contact_primary");
    expect(primary.recommended).toBe(true);
    expect(primary.accessRole).toBe("COMPANY_ADMIN");
  });

  test("invalid email and rejected migration contact are excluded", () => {
    const adapt = buildRows().find((row: any) => row.customerId === "cust_1");

    expect(adapt.contacts.find((contact: any) => contact.contactId === "contact_invalid")).toMatchObject({
      eligible: false,
      eligibilityReasons: expect.arrayContaining(["invalid_email"]),
    });
    expect(adapt.contacts.find((contact: any) => contact.contactId === "contact_rejected")).toMatchObject({
      eligible: false,
      eligibilityReasons: expect.arrayContaining(["flagged_email_or_contact"]),
    });
  });

  test("duplicate email handling warns review and blocks incompatible existing portal identity", () => {
    const rows = buildRows({
      accesses: [{ id: "access_other", customerId: "cust_2", contactId: "contact_duplicate_two", email: "shared@example.org", status: "ACTIVE" }],
    });
    const duplicate = rows.find((row: any) => row.customerId === "cust_1").contacts.find((contact: any) => contact.contactId === "contact_duplicate");

    expect(duplicate.warnings).toContain("duplicate_email_in_review");
    expect(duplicate.eligible).toBe(false);
    expect(duplicate.eligibilityReasons).toContain("email_used_by_another_portal_identity");
  });

  test("permissions and active access stay company-scoped", () => {
    const rows = buildRows({
      accesses: [{ id: "access_primary", customerId: "cust_1", contactId: "contact_primary", email: "ada@adapt.example.org", status: "ACTIVE", accessRole: "COMPANY_ADMIN" }],
    });
    const adapt = rows.find((row: any) => row.customerId === "cust_1");
    const metro = rows.find((row: any) => row.customerId === "cust_2");

    expect(adapt.activeCount).toBe(1);
    expect(metro.activeCount).toBe(0);
    expect(adapt.contacts.find((contact: any) => contact.contactId === "contact_primary").contactPortalState).toBe("active");
  });

  test("company portal access defaults to enabled without selecting or inviting contacts", () => {
    const rows = buildRows({ companySettings: [{ customerId: "cust_1", state: "enabled" }] });

    expect(rows.find((row: any) => row.customerId === "cust_1").companyPortalState).toBe("enabled");
    expect(rows.find((row: any) => row.customerId === "cust_2").companyPortalState).toBe("enabled");
  });

  test("active pending invitation is idempotently shown as invited", () => {
    const rows = buildRows({
      accesses: [{ id: "access_pending", customerId: "cust_1", contactId: "contact_primary", email: "ada@adapt.example.org", status: "PENDING_INVITE", accessRole: "COMPANY_ADMIN" }],
      inviteTokens: [{ accessId: "access_pending", expiresAt: "2026-07-15T12:00:00.000Z" }],
    });
    const primary = rows.find((row: any) => row.customerId === "cust_1").contacts.find((contact: any) => contact.contactId === "contact_primary");

    expect(primary.contactPortalState).toBe("invited");
    expect(primary.invitationState).toBe("sent");
  });

  test("expired invitation is eligible for resend while accepted user is not reinvited", () => {
    const rows = buildRows({
      accesses: [
        { id: "access_expired", customerId: "cust_1", contactId: "contact_billing", email: "billing@adapt.example.org", status: "PENDING_INVITE", accessRole: "BILLING" },
        { id: "access_active", customerId: "cust_1", contactId: "contact_primary", email: "ada@adapt.example.org", status: "ACTIVE", accessRole: "COMPANY_ADMIN", inviteAcceptedAt: "2026-07-14T11:00:00.000Z" },
      ],
      inviteTokens: [{ accessId: "access_expired", expiresAt: "2026-07-13T12:00:00.000Z" }],
    });
    const adapt = rows.find((row: any) => row.customerId === "cust_1");

    expect(adapt.contacts.find((contact: any) => contact.contactId === "contact_billing").contactPortalState).toBe("invitation_expired");
    expect(adapt.contacts.find((contact: any) => contact.contactId === "contact_primary").contactPortalState).toBe("active");
  });

  test("partial email failure is represented as a failed invitation filter state", () => {
    const rows = buildRows({
      companySettings: [{ customerId: "cust_1", state: "enabled" }],
    });
    rows[0].warnings.push("invitation_failed");

    expect(filterPortalOnboardingRows(rows, "invitation_failed", "")).toHaveLength(1);
  });

  test("suspended company remains visible and blocks normal enablement assumptions", () => {
    const archived = buildRows().find((row: any) => row.customerId === "cust_3");

    expect(archived.companyPortalState).toBe("suspended");
    expect(archived.contacts[0]).toMatchObject({
      eligible: false,
      eligibilityReasons: expect.arrayContaining(["company_archived", "company_portal_suspended"]),
    });
  });

  test("contacts without a permanent company relationship are not surfaced as portal users", () => {
    const rows = buildPortalOnboardingRows({
      now,
      customers: [{ id: "cust_1", companyName: "Adapt Media", status: "active" }],
      contacts: [{ id: "orphan_contact", firstName: "Orphan", lastName: "Contact", email: "orphan@example.org", status: "active", flags: [] }],
      relationships: [],
      accesses: [],
      inviteTokens: [],
      companySettings: [],
    });

    expect(rows[0].contacts).toHaveLength(0);
    expect(rows[0].warnings).toContain("no_contacts");
  });

  test("surfaces a sole emailed contact as auto eligible and multi-contact companies for review", () => {
    const rows = buildPortalOnboardingRows({
      now,
      customers: [
        { id: "single", companyName: "Single Contact", status: "active" },
        { id: "multiple", companyName: "Multiple Contacts", status: "active" },
      ],
      contacts: [
        { id: "single_contact", email: "single@acme.co", status: "active", flags: [] },
        { id: "multi_one", email: "one@acme.co", status: "active", flags: [] },
        { id: "multi_two", email: "two@acme.co", status: "active", flags: [] },
      ],
      relationships: [
        { customerId: "single", contactId: "single_contact", status: "active" },
        { customerId: "multiple", contactId: "multi_one", status: "active" },
        { customerId: "multiple", contactId: "multi_two", status: "active" },
      ],
      accesses: [],
      inviteTokens: [],
      companySettings: [],
    });

    expect(rows.find((row: any) => row.customerId === "single").rolloutStatus).toBe("auto_eligible");
    expect(rows.find((row: any) => row.customerId === "multiple").rolloutStatus).toBe("needs_contact_review");
    expect(filterPortalOnboardingRows(rows, "auto_eligible", "")).toHaveLength(1);
  });

  test("no-contact and no-email companies remain ineligible even though company access defaults on", () => {
    const rows = buildPortalOnboardingRows({
      now,
      customers: [{ id: "missing", companyName: "Missing Email", status: "active" }],
      contacts: [{ id: "missing_contact", email: null, status: "active", flags: [] }],
      relationships: [{ customerId: "missing", contactId: "missing_contact", status: "active" }],
      accesses: [],
      inviteTokens: [],
      companySettings: [],
    });

    expect(rows[0].rolloutStatus).toBe("missing_email");
    expect(rows[0].companyPortalState).toBe("enabled");
  });
});
