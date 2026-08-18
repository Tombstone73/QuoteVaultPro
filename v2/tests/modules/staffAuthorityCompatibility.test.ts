import { describe, expect, test } from "@jest/globals";
import { readFile } from "node:fs/promises";
import { AuthorityPolicy } from "../../src/authorization/authorityPolicy";
import { PostgresStaffMembershipAuthorityReader } from "../../infrastructure/compatibility/postgresStaffMembershipRead";
import { TemporaryStaffCompatibilityPrincipalIssuer, type StaffMembershipAuthorityReader, type TrustedStaffMembership } from "../../src/authorization/temporaryStaffPrincipalIssuer";
import { TEMPORARY_STAFF_AUTHORITY_REPLACEMENT_MILESTONE, TEMPORARY_STAFF_AUTHORITY_SOURCE } from "../../src/authorization/staffAuthorityCompatibility";

const identity = { subjectId: "staff-a", authenticatedAt: new Date("2026-08-15T00:00:00.000Z"), authenticationMethod: "session" as const };
const membership = (organizationId: string, role: string, overrides: Partial<TrustedStaffMembership> = {}): TrustedStaffMembership => ({
  userId: "staff-a", organizationId, role, active: true, organizationActive: true, authorityRevision: `revision:${organizationId}:${role}`, ...overrides,
});

class MutableMembershipReader implements StaffMembershipAuthorityReader {
  readonly rows = new Map<string, TrustedStaffMembership>();
  calls = 0;
  async findForStaffAuthority(userId: string, organizationId: string): Promise<TrustedStaffMembership | null> {
    this.calls += 1;
    const row = this.rows.get(`${userId}:${organizationId}`);
    return row ? { ...row } : null;
  }
}

const issue = async (reader: MutableMembershipReader, organizationId = "org-a") =>
  new TemporaryStaffCompatibilityPrincipalIssuer(reader).issueStaff({ identity, requestedOrganizationId: organizationId });

const expected = {
  owner: ["customer.view", "invoice.editDraft", "invoice.issue", "invoice.view", "order.cancel", "order.create", "order.edit", "order.view", "pricing.preview", "product.edit", "product.view", "quote.convert", "quote.create", "quote.edit", "quote.send", "quote.view"],
  admin: ["customer.view", "invoice.editDraft", "invoice.issue", "invoice.view", "order.cancel", "order.create", "order.edit", "order.view", "pricing.preview", "product.edit", "product.view", "quote.convert", "quote.create", "quote.edit", "quote.send", "quote.view"],
  manager: ["customer.view", "invoice.editDraft", "invoice.view", "order.create", "order.edit", "order.view", "pricing.preview", "product.view", "quote.convert", "quote.create", "quote.edit", "quote.send", "quote.view"],
  member: ["customer.view", "invoice.view", "order.view", "pricing.preview", "product.view", "quote.view"],
} as const;

describe("M1.4 temporary Staff authority compatibility", () => {
  test.each(Object.entries(expected))("%s receives the exact bounded early-M1 capability set", async (role, capabilities) => {
    const reader = new MutableMembershipReader();
    reader.rows.set("staff-a:org-a", membership("org-a", role));
    const result = await issue(reader);
    expect(result).toMatchObject({ ok: true, value: { kind: "staff", organizationId: "org-a", userId: "staff-a", authority: { role, capabilities, source: TEMPORARY_STAFF_AUTHORITY_SOURCE, replacementMilestone: TEMPORARY_STAFF_AUTHORITY_REPLACEMENT_MILESTONE } } });
    expect(result.ok && result.value.authority.capabilities).toEqual(capabilities);
    expect(result.ok && result.value.authority.capabilities).not.toContain("orders.create");
    expect(result.ok && result.value.authority.capabilities).not.toContain("quotes.convert");
  });

  test("unknown, global-only, and malformed legacy roles fail closed", async () => {
    for (const role of ["employee", "admin ", "Admin", "", "developer"]) {
      const reader = new MutableMembershipReader();
      reader.rows.set("staff-a:org-a", membership("org-a", role));
      await expect(issue(reader)).resolves.toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
    }
  });

  test("global isAdmin, platform flags, and users.role extras never substitute for membership", async () => {
    const reader = new MutableMembershipReader();
    const issuer = new TemporaryStaffCompatibilityPrincipalIssuer(reader);
    const globalFlaggedIdentity = { ...identity, role: "owner", isAdmin: true, isPlatformAdmin: true, isPlatformDeveloper: true } as typeof identity;
    await expect(issuer.issueStaff({ identity: globalFlaggedIdentity, requestedOrganizationId: "org-a" })).resolves.toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });
    expect(reader.calls).toBe(1);
  });

  test("only a Staff session can issue a Staff principal", async () => {
    const reader = new MutableMembershipReader();
    reader.rows.set("staff-a:org-a", membership("org-a", "admin"));
    const issuer = new TemporaryStaffCompatibilityPrincipalIssuer(reader);
    await expect(issuer.issueStaff({ identity: { ...identity, authenticationMethod: "portal_session" }, requestedOrganizationId: "org-a" })).resolves.toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
    await expect(issuer.issueStaff({ identity: { ...identity, authenticationMethod: "service_credential" }, requestedOrganizationId: "org-a" })).resolves.toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
  });

  test("issuance is fresh, organization-bound, and reflects role/membership changes", async () => {
    const reader = new MutableMembershipReader();
    const issuer = new TemporaryStaffCompatibilityPrincipalIssuer(reader);
    reader.rows.set("staff-a:org-a", membership("org-a", "admin"));
    reader.rows.set("staff-a:org-b", membership("org-b", "member"));
    const first = await issuer.issueStaff({ identity, requestedOrganizationId: "org-a" });
    reader.rows.set("staff-a:org-a", membership("org-a", "member", { authorityRevision: "revision:changed" }));
    const changed = await issuer.issueStaff({ identity, requestedOrganizationId: "org-a" });
    const orgB = await issuer.issueStaff({ identity, requestedOrganizationId: "org-b" });
    reader.rows.delete("staff-a:org-a");
    const removed = await issuer.issueStaff({ identity, requestedOrganizationId: "org-a" });
    expect(first.ok && first.value.authority.capabilities).toContain("invoice.issue");
    expect(changed.ok && changed.value.authority.capabilities).not.toContain("invoice.issue");
    expect(changed.ok && changed.value.authority.authorityRevision).toBe("revision:changed");
    expect(orgB.ok && orgB.value.authority.capabilities).toEqual(expected.member);
    expect(removed).toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });
    expect(reader.calls).toBe(4);
  });

  test("a membership for Org A cannot issue a Staff principal for Org B", async () => {
    const reader = new MutableMembershipReader();
    reader.rows.set("staff-a:org-a", membership("org-a", "admin"));
    await expect(issue(reader, "org-b")).resolves.toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });
  });

  test("inactive membership and disabled organization fail on the next issuance", async () => {
    const reader = new MutableMembershipReader();
    reader.rows.set("staff-a:org-a", membership("org-a", "admin", { active: false }));
    await expect(issue(reader)).resolves.toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
    reader.rows.set("staff-a:org-a", membership("org-a", "admin", { organizationActive: false }));
    await expect(issue(reader)).resolves.toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
  });

  test("AuthorityPolicy, not the compatibility issuer, decides capability and organization scope", async () => {
    const reader = new MutableMembershipReader();
    reader.rows.set("staff-a:org-a", membership("org-a", "member"));
    const result = await issue(reader);
    if (!result.ok) throw result.error;
    const policy = new AuthorityPolicy();
    expect(policy.decide(result.value, { capability: "customer.view", resource: { organizationId: "org-a" } })).toEqual({ allowed: true });
    expect(policy.decide(result.value, { capability: "product.view", resource: { organizationId: "org-a" } })).toEqual({ allowed: true });
    expect(policy.decide(result.value, { capability: "pricing.preview", resource: { organizationId: "org-a" } })).toEqual({ allowed: true });
    expect(policy.decide(result.value, { capability: "invoice.issue", resource: { organizationId: "org-a" } })).toEqual({ allowed: false, reason: "CAPABILITY_NOT_GRANTED" });
    expect(policy.decide(result.value, { capability: "customer.view", resource: { organizationId: "org-b" } })).toEqual({ allowed: false, reason: "ORGANIZATION_OUT_OF_SCOPE" });
  });

  test("issued Staff authority is immutable and carries a non-raw compatibility membership reference", async () => {
    const reader = new MutableMembershipReader();
    reader.rows.set("staff-a:org-a", membership("org-a", "admin"));
    const result = await issue(reader);
    if (!result.ok) throw result.error;
    expect(Object.isFrozen(result.value)).toBe(true);
    expect(Object.isFrozen(result.value.authority)).toBe(true);
    expect(Object.isFrozen(result.value.authority.capabilities)).toBe(true);
    expect(result.value.authority.membershipId).toMatch(/^v1_user_organizations:sha256:/);
    expect(result.value.authority.membershipId).not.toContain("staff-a");
    expect(() => (result.value.authority.capabilities as string[]).push("invoice.issue")).toThrow();
  });

  test("PostgreSQL membership reader scopes the composite membership and never reads global user flags", async () => {
    const calls: { text: string; values?: readonly unknown[] }[] = [];
    const reader = new PostgresStaffMembershipAuthorityReader({ query: async <T>(text: string, values?: readonly unknown[]) => {
      calls.push({ text, values });
      return { rows: [{ user_id: "staff-a", organization_id: "org-a", role: "admin", membership_updated_at: new Date("2026-08-15T00:00:00.000Z"), organization_updated_at: new Date("2026-08-15T01:00:00.000Z"), organization_status: "active", delete_state: "active", is_archived: false }] as T[] };
    } } as any);
    await expect(reader.findForStaffAuthority("staff-a", "org-a")).resolves.toMatchObject({ active: true, organizationActive: true, authorityRevision: "2026-08-15T00:00:00.000Z:2026-08-15T01:00:00.000Z" });
    expect(calls[0]!.text).toContain("uo.user_id = $1 AND uo.organization_id = $2");
    expect(calls[0]!.text).not.toMatch(/FROM users|is_admin|is_platform|users\.role/i);
    expect(calls[0]!.values).toEqual(["staff-a", "org-a"]);
  });

  test("PostgreSQL reader treats suspended, canceled, archived, and deleting organizations as disabled", async () => {
    for (const row of [
      { organization_status: "suspended", delete_state: "active", is_archived: false },
      { organization_status: "canceled", delete_state: "active", is_archived: false },
      { organization_status: "active", delete_state: "pending_delete", is_archived: false },
      { organization_status: "trial", delete_state: "active", is_archived: true },
    ]) {
      const reader = new PostgresStaffMembershipAuthorityReader({ query: async <T>() => ({ rows: [{ user_id: "staff-a", organization_id: "org-a", role: "admin", membership_updated_at: new Date(), organization_updated_at: new Date(), ...row }] as T[] }) } as any);
      await expect(reader.findForStaffAuthority("staff-a", "org-a")).resolves.toMatchObject({ organizationActive: false });
    }
  });

  test("temporary resolver has a mechanical M1.5 retirement marker and only its issuer imports it", async () => {
    expect(TEMPORARY_STAFF_AUTHORITY_REPLACEMENT_MILESTONE).toBe("M1.5 — Permission-Set Foundation");
    const boundary = await readFile("v2/scripts/check-import-boundaries.mjs", "utf8");
    expect(boundary).toContain("temporary Staff compatibility resolver may only be consumed through its PrincipalIssuer");
    expect(boundary).toContain("!relativeFilename.startsWith(\"tests/\")");
  });
});
