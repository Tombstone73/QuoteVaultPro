import fs from "node:fs";
import path from "node:path";

describe("Proofing Policy settings", () => {
  test("offers both operational modes without disabling proofing", () => {
    const page = fs.readFileSync(path.join(process.cwd(), "client/src/pages/settings/SettingsLayout.tsx"), "utf8");
    expect(page).toContain("Proofing Policy");
    expect(page).toContain("Automatic Proofing");
    expect(page).toContain("Manual / Requested Only");
    expect(page).toContain("product settings remain saved");
  });
});
