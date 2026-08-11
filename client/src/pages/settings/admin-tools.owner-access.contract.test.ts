import { describe, expect, test } from "@jest/globals";
import fs from "node:fs";
import path from "node:path";

const read = (file: string) => fs.readFileSync(path.join(process.cwd(), file), "utf8");

describe("Admin Tools owner-only frontend boundary", () => {
  test("hides Admin Tools from tenant admins while preserving Settings for admins", () => {
    const settings = read("client/src/pages/settings/SettingsLayout.tsx");

    expect(settings).toContain('activeOrgRole === "owner" || activeOrgRole === "admin"');
    expect(settings).toContain("ownerOnly: true");
    expect(settings).toContain("hasOwnerOnlyAdminToolsRole(activeOrgRole)");
    expect(settings).toContain("Admin Tools are only available to organization Owners.");
    expect(settings).toContain("SETTINGS_NAV_ITEMS.filter");
  });

  test("order detail uses the shared owner/admin operational helper for saved line-item editability", () => {
    const detail = read("client/src/pages/order-detail.tsx");

    expect(detail).toContain("hasAdminOrOwnerOperationalRole(user)");
    expect(detail).toContain("readOnly={!(isAdminOrOwner && canEditOrder)}");
  });
});
