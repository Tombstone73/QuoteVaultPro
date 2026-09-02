import { readFileSync } from "node:fs";

const read = (path: string) => readFileSync(path, "utf8");
const sidebar = read("client/src/components/layout/TitanSidebarNav.tsx");
const appLayout = read("client/src/components/layout/AppLayout.tsx");

describe("mobile application navigation", () => {
  test("renders the canonical sidebar in the portrait drawer instead of hiding it at the desktop breakpoint", () => {
    expect(appLayout).toContain('data-testid="mobile-navigation-drawer"');
    expect(appLayout).toContain("<TitanSidebarNav isCollapsed={false} mobile />");
    expect(sidebar).toContain('data-testid={mobile ? "mobile-sidebar-navigation" : "desktop-sidebar-navigation"}');
    expect(sidebar).toContain('mobile ? "flex" : "hidden md:flex"');
    expect(sidebar).toContain("filterNavByRole(NAV_CONFIG, role");
  });

  test("keeps the navigation body scrollable while retaining the footer and theme control", () => {
    expect(sidebar).toContain('className="min-h-0 flex-1 overflow-y-auto overscroll-contain py-1"');
    expect(sidebar).toContain("ThemeToggle />");
    expect(sidebar).toContain("safe-area-inset-bottom");
    expect(sidebar).toContain("shrink-0 items-center border-t");
  });

  test("uses the app shell dynamic viewport and preserves the desktop-only sidebar breakpoint", () => {
    expect(appLayout).toContain('className="fixed left-0 top-0 z-50 h-dvh w-64 md:hidden"');
    expect(appLayout).toContain('aria-label="Close navigation"');
    expect(sidebar).toContain('mobile ? "flex" : "hidden md:flex"');
    expect(sidebar).not.toContain('"hidden h-screen shrink-0 flex-col');
  });
});
