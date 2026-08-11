/**
 * A second fresh-context normal login. Together with auth.setup.ts this proves
 * the fixture does not rely on any prior browser session.
 */
import { expect, test } from "@playwright/test";
import { authenticateDevQaUser } from "./devQaAuth";

test.use({ storageState: { cookies: [], origins: [] } });

test("dedicated DEV QA user can log in from a second fresh browser", async ({ page }) => {
  await authenticateDevQaUser(page);
  await expect(page).toHaveURL(/\/dashboard(?:[?#].*)?$/);
  await expect(page.locator('[data-sidebar], nav, [role="navigation"]').first()).toBeVisible({ timeout: 10_000 });
});
