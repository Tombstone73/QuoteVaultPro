import { describe, expect, test } from "@jest/globals";
import {
  hasAdminOrOwnerOperationalRole,
  hasOwnerOnlyAdminToolsRole,
  normalizeRole,
} from "../roleAccess";

describe("role access helpers", () => {
  test("normalizes role strings before permission checks", () => {
    expect(normalizeRole(" Owner ")).toBe("owner");
    expect(normalizeRole(null)).toBe("");
  });

  test("allows owner and admin for normal operational owner/admin work", () => {
    expect(hasAdminOrOwnerOperationalRole({ role: "owner" })).toBe(true);
    expect(hasAdminOrOwnerOperationalRole({ role: "admin" })).toBe(true);
    expect(hasAdminOrOwnerOperationalRole({ orgRole: "admin" })).toBe(true);
    expect(hasAdminOrOwnerOperationalRole({ role: "employee", isAdmin: true })).toBe(true);
  });

  test("blocks non-privileged roles from owner/admin operational work", () => {
    expect(hasAdminOrOwnerOperationalRole({ role: "manager" })).toBe(false);
    expect(hasAdminOrOwnerOperationalRole({ role: "employee" })).toBe(false);
    expect(hasAdminOrOwnerOperationalRole(null)).toBe(false);
  });

  test("keeps Admin Tools owner-only without promoting admin users to owner", () => {
    expect(hasOwnerOnlyAdminToolsRole({ role: "owner" })).toBe(true);
    expect(hasOwnerOnlyAdminToolsRole({ orgRole: "owner" })).toBe(true);
    expect(hasOwnerOnlyAdminToolsRole({ role: "admin" })).toBe(false);
    expect(hasOwnerOnlyAdminToolsRole({ role: "employee", isAdmin: true })).toBe(false);
  });
});
