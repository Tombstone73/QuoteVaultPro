/**
 * routing-prepress-to-roll.spec.ts
 *
 * Validates one production routing transition: Prepress → Roll
 *
 * WHAT THIS TESTS
 * ---------------
 * 1. Order is visible in the Prepress queue
 * 2. "Send to Production" button is enabled (prepress_complete + final files present)
 * 3. Clicking "Send to Production" succeeds (toast fires)
 * 4. Order is REMOVED from the Prepress queue
 * 5. Order APPEARS on the Roll production board
 * 6. Fails clearly if the order appears in both places or neither place
 *
 * TEST DATA REQUIREMENTS (must be true before running this test)
 * ---------------------------------------------------------------
 * The order specified in PLAYWRIGHT_ROUTING_TEST_ORDER_NUMBER must:
 *   - Exist in the DEV environment and not be canceled or completed
 *   - Have requiresPrepress=true on at least one line item
 *   - Have an active prepress production job (stationKey='flatbed', stepKey='prepress')
 *   - Have canonical workflowState='in_prepress' with at least one completed prepress session
 *   - Have at least one active "final" file uploaded to the line item
 *   - NOT have an existing active downstream production job
 *   - Have a product type whose defaultStationKey='roll' OR whose name contains "roll"
 *     (this controls which board the item lands on after Send to Production)
 *
 * ENV VARS
 * --------
 *   PLAYWRIGHT_ROUTING_TEST_ORDER_NUMBER  e.g. "1042"  (required, no # prefix)
 *
 * ARTIFACTS
 * ---------
 *   test-results/routing-*.png  screenshots saved on any failure step
 */

import { test, expect } from "@playwright/test";

test("routing: Prepress → Roll", async ({ page }) => {
  const orderNumber = process.env.PLAYWRIGHT_ROUTING_TEST_ORDER_NUMBER;

  if (!orderNumber) {
    test.skip(
      true,
      "PLAYWRIGHT_ROUTING_TEST_ORDER_NUMBER not set — " +
        "set this to an order number that is in prepress_complete state with final files " +
        "and a product type that routes to the roll station"
    );
    return; // TypeScript narrowing — test.skip() throws before this, but TS doesn't know that
  }

  const ON = String(orderNumber);

  // ── Step 1: Confirm order is in the prepress queue via API ──────────────
  // page.request shares the browser session (auth cookies from storageState).
  const queueRes = await page.request.get("/api/prepress/queue");
  if (!queueRes.ok()) {
    throw new Error(
      `GET /api/prepress/queue returned HTTP ${queueRes.status()}. ` +
        "Check that you are authenticated and have internal-user access."
    );
  }

  const queueBody = await queueRes.json();
  const queueItems: any[] = queueBody?.data ?? [];

  const targetItem = queueItems.find((item: any) => String(item.jobNumber) === ON);

  if (!targetItem) {
    await page.goto("/production/prepress");
    await page.waitForLoadState("networkidle");
    await page.screenshot({
      path: `test-results/routing-order-not-in-prepress-${ON}.png`,
    });
    const found = queueItems.map((i: any) => i.jobNumber).join(", ") || "(empty queue)";
    throw new Error(
      `Order ${ON} not found in the prepress queue.\n` +
        "Check: requiresPrepress=true, order not canceled/completed, " +
        "active prepress production job exists (stationKey='flatbed', stepKey='prepress').\n" +
        `Queue currently contains: ${found}`
    );
  }

  // Guard: if already has a downstream active job, routing already happened.
  if (targetItem.hasDownstreamActiveJob) {
    throw new Error(
      `Order ${ON} already has an active downstream production job. ` +
        "It cannot be sent to production again until that job is resolved. " +
        "Use a different test order that is still in pure prepress state."
    );
  }

  const workflowState: string = targetItem.workflowState ?? "unknown";
  const hasCompletedSession = targetItem.hasCompletedSession === true;

  // ── Step 2: Open the prepress queue page ───────────────────────────────
  await page.goto("/production/prepress");
  await page.waitForLoadState("networkidle");

  // Fail immediately if redirected to login — session is not valid
  await expect(page, "Should not be redirected to login").not.toHaveURL(/\/login/);

  // Allow the React query to hydrate and render cards
  await page.waitForTimeout(2_000);

  // ── Step 3: Click the order card in the left sidebar ───────────────────
  // JobCard renders item.jobNumber as a bold span in the <aside> sidebar.
  // The order number is a plain number, e.g. "1042" (no # prefix).
  const cardText = page.locator("aside").getByText(ON, { exact: true }).first();

  const cardVisible = await cardText.isVisible().catch(() => false);
  if (!cardVisible) {
    await page.screenshot({
      path: `test-results/routing-card-not-visible-${ON}.png`,
    });
    throw new Error(
      `Order ${ON} was returned by the API but its card is not visible in the UI sidebar. ` +
        "The queue may be filtered or the card may be outside the visible scroll area."
    );
  }

  await cardText.click();

  // ── Step 4: Confirm the right-panel header shows this order ────────────
  // The workspace <main> h2 shows selectedItem.jobNumber (= order number) when an item is selected.
  await expect(page.locator("main h2"), "Right panel should show selected order number").toContainText(
    ON,
    { timeout: 10_000 }
  );

  // ── Step 5: Check "Send to Production" button state ────────────────────
  const sendBtn = page.getByRole("button", { name: /send to production/i });

  await expect(sendBtn, '"Send to Production" button should be present').toBeVisible({
    timeout: 5_000,
  });

  const isEnabled = await sendBtn.isEnabled();

  if (!isEnabled) {
    await page.screenshot({
      path: `test-results/routing-send-btn-disabled-${ON}.png`,
    });
    throw new Error(
      `"Send to Production" button is disabled for order ${ON} (workflowState=${workflowState}, hasCompletedSession=${String(hasCompletedSession)}).\n` +
        "All three conditions must be true before the button enables:\n" +
        "  (1) workflowState must still be 'in_prepress' and at least one completed prepress session must exist\n" +
        "  (2) At least one final file must be uploaded to the line item\n" +
        "  (3) No active downstream production job may exist\n" +
        `Current API truth: workflowState=${workflowState}, hasCompletedSession=${String(hasCompletedSession)}`
    );
  }

  // ── Step 6: Click "Send to Production" ─────────────────────────────────
  await sendBtn.click();

  // Wait for the success toast confirming the mutation completed
  await expect(
    page.getByText("Sent to print queue"),
    'Expected success toast "Sent to print queue" after clicking Send to Production'
  ).toBeVisible({ timeout: 15_000 });

  // Allow the prepress queue to re-fetch and update
  await page.waitForTimeout(3_000);

  // ── Step 7: Verify order is GONE from the prepress queue ───────────────
  // Check via API (ground truth) — not just UI rendering
  const postSendRes = await page.request.get("/api/prepress/queue");
  const postSendBody = await postSendRes.json();
  const postSendItems: any[] = postSendBody?.data ?? [];
  const stillInPrepress = postSendItems.find((i: any) => String(i.jobNumber) === ON);

  if (stillInPrepress) {
    await page.screenshot({
      path: `test-results/routing-still-in-prepress-after-send-${ON}.png`,
    });
    throw new Error(
      `Order ${ON} is STILL in the prepress queue after Send to Production.\n` +
        `API says workflowState=${stillInPrepress.workflowState}, hasCompletedSession=${String(stillInPrepress.hasCompletedSession)}, ` +
        `hasDownstreamActiveJob=${stillInPrepress.hasDownstreamActiveJob}.\n` +
        "The routing transition may not have persisted — check production_jobs table."
    );
  }

  // Double-check in the UI — the card should have disappeared from the sidebar
  const cardStillVisible = await page
    .locator("aside")
    .getByText(ON, { exact: true })
    .first()
    .isVisible()
    .catch(() => false);

  if (cardStillVisible) {
    await page.screenshot({
      path: `test-results/routing-card-still-visible-after-send-${ON}.png`,
    });
    throw new Error(
      `Order ${ON} card is STILL visible in the prepress sidebar after Send to Production, ` +
        "even though the API confirmed it left the queue. " +
        "This is a UI re-render issue — the React Query invalidation may not have triggered."
    );
  }

  // ── Step 8: Verify order APPEARS on the Roll board ─────────────────────
  await page.goto("/production/roll");
  await page.waitForLoadState("networkidle");

  await expect(page, "Roll board should not redirect to login").not.toHaveURL(/\/login/);

  // Allow the roll board to load its production jobs
  await page.waitForTimeout(3_000);

  // Check if roll module is not enabled in settings — give a helpful error
  const rollModuleDisabled = await page
    .getByText("No production views enabled")
    .isVisible()
    .catch(() => false);

  if (rollModuleDisabled) {
    await page.screenshot({
      path: `test-results/routing-roll-module-not-enabled-${ON}.png`,
    });
    throw new Error(
      "The Roll production module is not enabled. " +
        "Go to /settings/production and enable the Roll view, then re-run."
    );
  }

  // Roll board renders order numbers as "Order #<number>" in each job card
  const rollOrderLocator = page.getByText(`Order #${ON}`, { exact: false });
  const onRoll = await rollOrderLocator.first().isVisible().catch(() => false);

  if (!onRoll) {
    // Check if any roll content is visible at all (helps distinguish "empty board" from wrong station)
    const anyJobCard = await page.locator('[class*="border"]').count();
    await page.screenshot({
      path: `test-results/routing-not-on-roll-board-${ON}.png`,
    });
    throw new Error(
      `Order ${ON} is NOT visible on the Roll board (/production/roll).\n` +
        `Expected to find "Order #${ON}" after routing from prepress.\n` +
        "Possible causes:\n" +
        "  (1) Product type defaultStationKey is not 'roll' — check the product type in settings\n" +
        "  (2) Product type name does not contain 'roll' — routing infers station from name if no defaultStationKey is set\n" +
        "  (3) The roll board is filtered to a status that excludes this job (try status=all)\n" +
        `  (4) Roll board rendered ${anyJobCard} card-like elements — the board may be empty or loading`
    );
  }

  // ── PASS ────────────────────────────────────────────────────────────────
  // Both assertions confirmed:
  //   ✓ Order removed from prepress queue (API + UI)
  //   ✓ Order visible on Roll board
  expect(onRoll, `Order #${ON} should be visible on the Roll board`).toBe(true);
});
