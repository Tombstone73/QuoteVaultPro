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

function requireEnv(name: string) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} must be set in .env.playwright`);
  }
  return value;
}

test("login page: renders, accepts credentials, loads app shell", async ({
  page,
}) => {
  const baseUrl = requireEnv("PLAYWRIGHT_BASE_URL");
  const email = requireEnv("PLAYWRIGHT_EMAIL");
  const password = requireEnv("PLAYWRIGHT_PASSWORD");

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
  // 3. Verify a real deployed session was established on the same origin
  // ------------------------------------------------------------------
  await page.waitForURL((url) => {
    const pathname = url.pathname.toLowerCase();
    return url.origin === new URL(baseUrl).origin && pathname !== "/login";
  }, { timeout: 30_000 });

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

  // Must not be back on login — confirms session was established.
  await expect(page).not.toHaveURL(/\/login/);

  await page.goto("/dashboard", { waitUntil: "networkidle" });

  // Something from the authenticated shell must be visible.
  // The app renders a sidebar nav; fall back to checking the page title if the
  // exact selector changes.
  await expect(
    page.locator('[data-sidebar], nav, [role="navigation"]').first()
  ).toBeVisible({ timeout: 10_000 });
});
