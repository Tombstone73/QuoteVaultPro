/**
 * auth.setup.ts
 *
 * Runs once before all spec files (via the "setup" project in playwright.config.ts).
 * Logs in to the deployed DEV app and persists the session state to
 * e2e/.auth/user.json so all subsequent tests reuse the cookie without
 * needing to log in again.
 *
 * Required env vars (set in .env.playwright):
 *   PLAYWRIGHT_BASE_URL     - e.g. https://your-dev-app.railway.app
 *   PLAYWRIGHT_EMAIL        - test account email
 *   PLAYWRIGHT_PASSWORD     - test account password
 */

import { test as setup, expect } from "@playwright/test";
import path from "path";
import fs from "fs";

const AUTH_FILE = path.join(process.cwd(), "e2e", ".auth", "user.json");

setup("authenticate", async ({ page }) => {
  const email = process.env.PLAYWRIGHT_EMAIL;
  const password = process.env.PLAYWRIGHT_PASSWORD;

  if (!email || !password) {
    throw new Error(
      "PLAYWRIGHT_EMAIL and PLAYWRIGHT_PASSWORD must be set in .env.playwright"
    );
  }

  // Ensure the .auth directory exists before Playwright tries to write to it.
  const authDir = path.dirname(AUTH_FILE);
  if (!fs.existsSync(authDir)) {
    fs.mkdirSync(authDir, { recursive: true });
  }

  await page.goto("/login");
  await page.waitForLoadState("networkidle");

  // Fill credentials using the stable id attributes on the login form.
  await page.locator("#email").fill(email);
  await page.locator("#password").fill(password);
  await page.locator('button[type="submit"]').click();

  await expect
    .poll(
      async () =>
        page.evaluate(async () => {
          try {
            const response = await fetch("/api/auth/session", {
              credentials: "include",
            });

            if (!response.ok) {
              return false;
            }

            const json = await response.json().catch(() => ({}));
            return json?.authenticated === true;
          } catch {
            return false;
          }
        }),
      { timeout: 25_000 }
    )
    .toBe(true);

  await page.goto("/dashboard", { waitUntil: "networkidle" });

  // Verify the app shell rendered (not bounced back to login).
  await expect(page).not.toHaveURL(/\/login/, { timeout: 5_000 });

  // Persist the authenticated session (cookies + localStorage) for all subsequent tests.
  await page.context().storageState({ path: AUTH_FILE });
});
