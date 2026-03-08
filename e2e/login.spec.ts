/**
 * login.spec.ts — Test 1
 *
 * Validates the login page renders, accepts credentials, and loads the app shell.
 *
 * This test deliberately bypasses the shared session state (auth.setup.ts) so it
 * exercises the real login flow from an unauthenticated starting point.
 */

import { test, expect } from "@playwright/test";

// Override the project-level storageState so this test starts unauthenticated.
test.use({ storageState: { cookies: [], origins: [] } });

test("login page: renders, accepts credentials, loads app shell", async ({
  page,
}) => {
  const email = process.env.PLAYWRIGHT_EMAIL;
  const password = process.env.PLAYWRIGHT_PASSWORD;

  if (!email || !password) {
    test.skip(
      "PLAYWRIGHT_EMAIL and PLAYWRIGHT_PASSWORD not set — skipping login test"
    );
  }

  // ------------------------------------------------------------------
  // 1. Login page renders
  // ------------------------------------------------------------------
  await page.goto("/login");
  await page.waitForLoadState("networkidle");

  await expect(page.locator("#email")).toBeVisible();
  await expect(page.locator("#password")).toBeVisible();
  await expect(page.locator('button[type="submit"]')).toBeVisible();

  // ------------------------------------------------------------------
  // 2. Fill credentials and submit
  // ------------------------------------------------------------------
  await page.locator("#email").fill(email!);
  await page.locator("#password").fill(password!);
  await page.locator('button[type="submit"]').click();

  // ------------------------------------------------------------------
  // 3. Verify redirect to dashboard — app shell has loaded
  // ------------------------------------------------------------------
  await page.waitForURL("**/dashboard", { timeout: 25_000 });

  // Must not be back on login — confirms session was established.
  await expect(page).not.toHaveURL(/\/login/);

  // Something from the authenticated shell must be visible.
  // The app renders a sidebar nav; fall back to checking the page title if the
  // exact selector changes.
  await expect(
    page.locator('[data-sidebar], nav, [role="navigation"]').first()
  ).toBeVisible({ timeout: 10_000 });
});
