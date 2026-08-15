import { defineConfig } from "@playwright/test";

/**
 * Clone-only Playwright configuration. It deliberately does not share the
 * repository's DEV-oriented browser configuration and inherits no database URL
 * fallback. The host itself fails closed unless V2_POSTGRES_INTEGRATION=1 and
 * TEST_DATABASE_URL are supplied by the operator.
 */
export default defineConfig({
  testDir: "./browser",
  testMatch: "m175b.authenticated-quote.spec.ts",
  fullyParallel: false,
  workers: 1,
  timeout: 45_000,
  use: { baseURL: "http://127.0.0.1:4174", trace: "retain-on-failure", screenshot: "only-on-failure" },
  webServer: {
    command: "cd .. && npm run v2:ui:build && cross-env V2_M175B_BROWSER_TEST=1 tsx v2/scripts/m175bBrowserHost.ts",
    url: "http://127.0.0.1:4174/health",
    reuseExistingServer: false,
    timeout: 90_000,
  },
});
