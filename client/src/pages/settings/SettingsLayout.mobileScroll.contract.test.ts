import { readFileSync } from "node:fs";

const source = readFileSync("client/src/pages/settings/SettingsLayout.tsx", "utf8");

describe("Settings mobile scroll layout", () => {
  test("keeps Settings in the application scroll owner rather than imposing a viewport height", () => {
    expect(source).toContain('data-testid="settings-page-scroll-content"');
    expect(source).toMatch(/data-testid="settings-page-scroll-content"\s+className="min-h-full bg-titan-bg-app/);
    expect(source).not.toMatch(/data-testid="settings-page-scroll-content"\s+className="min-h-screen/);
  });

  test("does not make the full Settings navigation sticky on mobile", () => {
    expect(source).toContain('className="h-fit p-3 lg:sticky lg:top-6"');
    expect(source).not.toContain('className="p-3 h-fit sticky top-6"');
  });

  test("leaves safe-area-aware space after the final Appearance controls", () => {
    expect(source).toContain("pb-[calc(1.5rem+env(safe-area-inset-bottom))]");
    expect(source).toContain("export function AppearanceSettings()");
    expect(source).toContain("availableThemes.map");
  });
});
