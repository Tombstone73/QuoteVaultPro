import fs from "node:fs";
import path from "node:path";
import { describe, expect, test } from "@jest/globals";

const sidebarSource = fs.readFileSync(
  path.join(process.cwd(), "client/src/components/layout/TitanSidebarNav.tsx"),
  "utf8",
);

describe("TitanSidebarNav organization role sourcing", () => {
  test("filters navigation with the active organization role instead of the global user role", () => {
    expect(sidebarSource).toContain('useActiveOrganizationRole({ enabled: Boolean(user) })');
    expect(sidebarSource).toContain("filterNavByRole(NAV_CONFIG, role");
    expect(sidebarSource).not.toContain("const role = user?.role ?? null");
  });
});
