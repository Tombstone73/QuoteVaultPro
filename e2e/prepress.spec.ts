/**
 * prepress.spec.ts — Test 2
 *
 * Verifies that a known test order appears in the Prepress production queue.
 *
 * Requires:
 *   PLAYWRIGHT_TEST_ORDER_NUMBER  - The order number (e.g. "1042") that should
 *                                   be visible in the prepress queue at the time
 *                                   this test runs. The order must have
 *                                   requiresPrepress=true and an active
 *                                   production job with stepKey='prepress'.
 *
 * Limitation (first pass):
 *   This test only confirms the order IS visible in the prepress queue.
 *   It does not assert the order is absent from flatbed/roll boards —
 *   that cross-board assertion is left for a future pass once the routing
 *   stabilization is confirmed in production.
 *
 * Setup:
 *   This test runs with the saved session from auth.setup.ts (no re-login needed).
 */

import { test, expect } from "@playwright/test";

test("prepress queue: known test order is visible", async ({ page }) => {
  const orderNumber = process.env.PLAYWRIGHT_TEST_ORDER_NUMBER;

  if (!orderNumber) {
    test.skip(
      true,
      "PLAYWRIGHT_TEST_ORDER_NUMBER not set — " +
        "set this to a known order number that should appear in the prepress queue"
    );
    return; // TypeScript narrowing
  }

  // ------------------------------------------------------------------
  // 1. Navigate to the Prepress production queue
  // ------------------------------------------------------------------
  await page.goto("/production/prepress");
  await page.waitForLoadState("networkidle");

  // The page should not redirect to login (confirms session is valid).
  await expect(page).not.toHaveURL(/\/login/);

  // ------------------------------------------------------------------
  // 2. Wait for the queue list to render
  //    The prepress queue renders a list/table of line items. We wait
  //    for any content to appear before searching for the order.
  // ------------------------------------------------------------------
  // Give the API call time to complete and items to render.
  await page.waitForTimeout(2_000);

  // ------------------------------------------------------------------
  // 3. Assert the test order number is visible somewhere on the page
  // ------------------------------------------------------------------
  // The queue renders the order number as text (e.g., "#1042" or "1042").
  // Try both the plain number and the hash-prefixed format used by the UI.
  const plainLocator = page.getByText(orderNumber!, { exact: false });
  const prefixedLocator = page.getByText(`#${orderNumber}`, { exact: false });

  const plainVisible = await plainLocator.first().isVisible().catch(() => false);
  const prefixedVisible = await prefixedLocator.first().isVisible().catch(() => false);

  if (!plainVisible && !prefixedVisible) {
    // Capture a screenshot for debugging before failing.
    await page.screenshot({ path: `test-results/prepress-not-found-${orderNumber}.png` });
    throw new Error(
      `Order ${orderNumber} was not found in the prepress queue at /production/prepress. ` +
        "Ensure the order exists, has requiresPrepress=true, and its active production " +
        "job has stepKey='prepress' (not yet sent to print)."
    );
  }

  // At least one format is visible — test passes.
  expect(plainVisible || prefixedVisible).toBe(true);
});
