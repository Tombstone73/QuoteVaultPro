import {
  focusSettingsTarget,
  nextSettingsSearchIndex,
  searchSettings,
  settingsSearchDestination,
} from "./settingsSearch";

describe("settings search registry", () => {
  test.each(["proof", "proofing"])("finds Proofing Policy for %s", (query) => {
    expect(searchSettings(query, "admin")[0]).toMatchObject({ id: "proofing-policy", kind: "setting" });
  });

  test("ranks an exact page label first", () => {
    expect(searchSettings("Storage", "admin")[0]).toMatchObject({ id: "storage", kind: "page" });
  });

  test("finds individual settings and explicit aliases", () => {
    expect(searchSettings("Company Info & Branding", "admin")[0]).toMatchObject({ id: "company-info-branding" });
    expect(searchSettings("logo", "admin")[0]).toMatchObject({ id: "company-info-branding" });
  });

  test("does not expose owner-only entries to organization admins", () => {
    expect(searchSettings("admin tools", "admin").map((result) => result.id)).not.toContain("admin-tools");
    expect(searchSettings("admin tools", "owner").map((result) => result.id)).toContain("admin-tools");
  });

  test("builds a deep link for an individual setting", () => {
    const policy = searchSettings("proof", "admin")[0];
    expect(settingsSearchDestination(policy)).toBe("/settings/production#proofing-policy");
  });

  test("wraps keyboard result navigation in both directions", () => {
    expect(nextSettingsSearchIndex(0, 3, 1)).toBe(1);
    expect(nextSettingsSearchIndex(2, 3, 1)).toBe(0);
    expect(nextSettingsSearchIndex(0, 3, -1)).toBe(2);
  });

  test("focuses and scrolls an anchored target", () => {
    document.body.innerHTML = '<section id="proofing-policy" tabIndex="-1"></section>';
    const target = document.getElementById("proofing-policy") as HTMLElement & { scrollIntoView: jest.Mock };
    target.scrollIntoView = jest.fn();

    expect(focusSettingsTarget("proofing-policy")).toBe(true);
    expect(target.scrollIntoView).toHaveBeenCalledWith({ behavior: "smooth", block: "center" });
    expect(document.activeElement).toBe(target);
  });

  test("returns no results for no match or cleared query", () => {
    expect(searchSettings("unrelated setting phrase", "admin")).toEqual([]);
    expect(searchSettings("", "admin")).toEqual([]);
  });
});
