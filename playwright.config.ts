import { defineConfig, devices } from "@playwright/test";
import { config as loadDotenv } from "dotenv";
import { resolve } from "path";

// Load the dedicated Playwright env file only. This keeps deployed DEV validation
// isolated from unrelated app/runtime env files.
loadDotenv({ path: resolve(process.cwd(), ".env.playwright") });

const DEV_QA_BASE_URL = "https://dev.printershero.com";

// The dedicated DEV QA fixture owns the preferred credential names. Preserve
// the existing PLAYWRIGHT_* aliases so current specs do not duplicate secrets.
// Browser QA is always cloud DEV; it must never silently target localhost.
process.env.PLAYWRIGHT_BASE_URL ??= DEV_QA_BASE_URL;
process.env.PRINTERSHERO_DEV_QA_ALLOWED_ORIGIN ??= DEV_QA_BASE_URL;
process.env.PLAYWRIGHT_EMAIL ??= process.env.PRINTERSHERO_DEV_QA_EMAIL;
process.env.PLAYWRIGHT_PASSWORD ??= process.env.PRINTERSHERO_DEV_QA_PASSWORD;

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL;

export default defineConfig({
  testDir: "./e2e",

  // Run tests sequentially to avoid session conflicts on the shared DEV server.
  fullyParallel: false,
  workers: 1,

  // Retry once on CI; no retries locally.
  retries: process.env.CI ? 1 : 0,
  forbidOnly: !!process.env.CI,

  reporter: [
    ["list"],
    ["html", { outputFolder: "playwright-report", open: "never" }],
  ],

  use: {
    baseURL: BASE_URL,
    // Capture trace and screenshot only on failures to keep test runs lean.
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    // Generous timeout for deployed DEV (network latency).
    actionTimeout: 20_000,
    navigationTimeout: 30_000,
  },

  projects: [
    // Step 1: authenticate once and save session state.
    {
      name: "setup",
      testMatch: "**/auth.setup.ts",
    },

    // Step 2: all spec files run with the saved session state.
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        storageState: "e2e/.auth/user.json",
      },
      dependencies: ["setup"],
      testMatch: "**/*.spec.ts",
    },
  ],
});
