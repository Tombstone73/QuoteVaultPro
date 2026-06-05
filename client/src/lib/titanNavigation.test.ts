import { describe, expect, test } from "@jest/globals";
import { filterNavByRole, NAV_CONFIG } from "./titanNavigation";

function visibleSection(sectionKey: string, role: string, isPlatformAdmin = false, isPlatformDeveloper = false) {
  return filterNavByRole(NAV_CONFIG, role, undefined, isPlatformAdmin, isPlatformDeveloper)
    .find((section) => section.sectionKey === sectionKey);
}

function itemIds(sectionKey: string, role: string, isPlatformAdmin = false, isPlatformDeveloper = false): string[] {
  return visibleSection(sectionKey, role, isPlatformAdmin, isPlatformDeveloper)?.items.map((item) => item.id) ?? [];
}

describe("Titan navigation platform placement", () => {
  test("shows Product Planning under Platform for existing allowed product-planning users", () => {
    expect(itemIds("platform", "admin")).toContain("product-planning");
    expect(itemIds("system", "admin")).not.toContain("product-planning");
  });

  test("shows Bug Reports under Platform for existing allowed bug-report users", () => {
    expect(itemIds("platform", "admin")).toContain("bug-reports");
    expect(itemIds("system", "admin")).not.toContain("bug-reports");
  });

  test("hides restricted Platform entries from tenant users without access", () => {
    expect(itemIds("platform", "employee")).toEqual([]);
  });

  test("keeps Platform Tools platform-admin/developer only", () => {
    expect(itemIds("platform", "admin")).not.toContain("platform-tools");
    expect(itemIds("platform", "employee", false, true)).toContain("platform-tools");
    expect(itemIds("platform", "employee", true, false)).toContain("platform-tools");
  });
});
