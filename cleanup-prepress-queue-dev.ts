/**
 * cleanup-prepress-queue-dev.ts
 *
 * ONE-TIME DEV data cleanup: aligns orders.state with historical orders.status so that
 * the Prepress queue no longer shows stale/historical orders.
 *
 * SAFE: read the diagnostic output first. All UPDATE statements are guarded.
 *
 * BACKGROUND
 * ----------
 * The canonical TitanOS state column (`orders.state`: open/production_complete/closed/canceled)
 * was added after many DEV orders were created. Those orders still have `state='open'` even
 * though they were completed or produced long ago. The Prepress queue now filters on `orders.state`
 * (as well as `orders.status`), so stale `state='open'` records will show up unless fixed.
 *
 * WHAT THIS SCRIPT DOES
 * ---------------------
 * Step 1  DIAGNOSE: print counts of (state × status) combinations for requiresPrepress orders.
 * Step 2  FIX A: set state='closed'  where state='open' AND status='completed'
 * Step 3  FIX B: set state='production_complete'  where state='open' AND productionCompletedAt IS NOT NULL
 *                AND closedAt IS NULL AND no active production_jobs exist for the order
 * Step 4  Re-print counts as confirmation.
 *
 * USAGE
 * -----
 *   npx tsx cleanup-prepress-queue-dev.ts [--org <orgId>] [--dry-run]
 *
 *   --org      Organization ID to target (default: org_titan_001)
 *   --dry-run  Print what would change without writing anything
 *
 * IMPORTANT
 * ---------
 * DEV data only. Do NOT run in production.
 */

import "dotenv/config";
import { pool } from "./server/db";

const DEFAULT_ORG_ID = "org_titan_001";

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const orgIdx = args.indexOf("--org");
  const orgId = orgIdx !== -1 && args[orgIdx + 1] ? args[orgIdx + 1] : DEFAULT_ORG_ID;

  console.log(`\n[Prepress Queue DEV Cleanup]`);
  console.log(`  orgId    : ${orgId}`);
  console.log(`  dry-run  : ${dryRun}`);
  console.log("─".repeat(60));

  const client = await pool.connect();
  try {
    // ── STEP 1: DIAGNOSTIC ────────────────────────────────────────────────
    console.log("\n[Step 1] Diagnostic: order state × status breakdown for requiresPrepress orders\n");

    const diagResult = await client.query<{
      state: string;
      status: string;
      order_count: string;
      line_item_count: string;
    }>(
      `
      SELECT
        o.state,
        o.status,
        COUNT(DISTINCT o.id)   AS order_count,
        COUNT(oli.id)          AS line_item_count
      FROM orders o
      JOIN order_line_items oli ON oli.order_id = o.id
      WHERE o.organization_id = $1
        AND oli.requires_prepress = TRUE
      GROUP BY o.state, o.status
      ORDER BY o.state, o.status
      `,
      [orgId]
    );

    if (diagResult.rows.length === 0) {
      console.log("  No requiresPrepress line items found for this org.");
    } else {
      console.log(
        "  state                | status               | orders | line_items"
      );
      console.log(
        "  ---------------------|----------------------|--------|----------"
      );
      for (const row of diagResult.rows) {
        console.log(
          `  ${String(row.state).padEnd(20)} | ${String(row.status).padEnd(20)} | ${String(row.order_count).padStart(6)} | ${String(row.line_item_count).padStart(10)}`
        );
      }
    }

    // ── STEP 2: FIX A — status='completed' but state still 'open' ─────────
    // These orders were closed using the old status field before the state column existed.
    // Correct state: 'closed'
    const fixAPreview = await client.query<{ count: string }>(
      `
      SELECT COUNT(*) AS count
      FROM orders
      WHERE organization_id = $1
        AND state = 'open'
        AND status = 'completed'
      `,
      [orgId]
    );
    const fixACount = parseInt(fixAPreview.rows[0].count, 10);
    console.log(
      `\n[Step 2] Fix A: state='open' + status='completed' → state='closed'`
    );
    console.log(`  ${fixACount} order(s) would be updated.`);

    if (!dryRun && fixACount > 0) {
      const fixAResult = await client.query(
        `
        UPDATE orders
        SET state      = 'closed',
            updated_at = NOW()
        WHERE organization_id = $1
          AND state  = 'open'
          AND status = 'completed'
        `,
        [orgId]
      );
      console.log(`  ✓ Updated ${fixAResult.rowCount} order(s).`);
    } else if (dryRun && fixACount > 0) {
      console.log("  (dry-run: no changes written)");
    } else {
      console.log("  Nothing to do.");
    }

    // ── STEP 3: FIX B — productionCompletedAt set but state still 'open' ──
    // These orders were flagged complete via the TitanOS production flow but the state
    // field wasn't updated (edge case during migration period).
    // Guard: only update if no active production_jobs exist for the order.
    const fixBPreview = await client.query<{ count: string }>(
      `
      SELECT COUNT(*) AS count
      FROM orders o
      WHERE o.organization_id = $1
        AND o.state            = 'open'
        AND o.production_completed_at IS NOT NULL
        AND o.closed_at        IS NULL
        AND NOT EXISTS (
          SELECT 1
          FROM production_jobs pj
          WHERE pj.order_id = o.id
            AND pj.status NOT IN ('done', 'void', 'canceled', 'cancelled')
        )
      `,
      [orgId]
    );
    const fixBCount = parseInt(fixBPreview.rows[0].count, 10);
    console.log(
      `\n[Step 3] Fix B: state='open' + productionCompletedAt set + no active jobs → state='production_complete'`
    );
    console.log(`  ${fixBCount} order(s) would be updated.`);

    if (!dryRun && fixBCount > 0) {
      const fixBResult = await client.query(
        `
        UPDATE orders o
        SET state      = 'production_complete',
            updated_at = NOW()
        WHERE o.organization_id = $1
          AND o.state            = 'open'
          AND o.production_completed_at IS NOT NULL
          AND o.closed_at        IS NULL
          AND NOT EXISTS (
            SELECT 1
            FROM production_jobs pj
            WHERE pj.order_id = o.id
              AND pj.status NOT IN ('done', 'void', 'canceled', 'cancelled')
          )
        `,
        [orgId]
      );
      console.log(`  ✓ Updated ${fixBResult.rowCount} order(s).`);
    } else if (dryRun && fixBCount > 0) {
      console.log("  (dry-run: no changes written)");
    } else {
      console.log("  Nothing to do.");
    }

    // ── STEP 4: RESIDUAL REPORT ────────────────────────────────────────────
    // Show any remaining no-jobs items that will still appear in the queue
    // under the "no production jobs" fallback path.
    console.log(
      `\n[Step 4] Residual: requiresPrepress line items with NO production_jobs and state='open'\n` +
        "  These will still appear in the Prepress queue as pending_prepress (legitimate new work).\n" +
        "  If any are not real active work, close or cancel them via the UI.\n"
    );

    const residualResult = await client.query<{
      order_number: string;
      state: string;
      status: string;
      due_date: string | null;
      line_item_count: string;
    }>(
      `
      SELECT
        o.order_number,
        o.state,
        o.status,
        o.due_date::text,
        COUNT(oli.id) AS line_item_count
      FROM orders o
      JOIN order_line_items oli ON oli.order_id = o.id
      WHERE o.organization_id = $1
        AND o.state NOT IN ('closed', 'canceled', 'production_complete')
        AND o.status NOT IN ('completed', 'canceled')
        AND oli.requires_prepress = TRUE
        AND NOT EXISTS (
          SELECT 1
          FROM production_jobs pj
          WHERE pj.line_item_id = oli.id
        )
      GROUP BY o.id, o.order_number, o.state, o.status, o.due_date
      ORDER BY o.due_date DESC NULLS LAST
      LIMIT 30
      `,
      [orgId]
    );

    if (residualResult.rows.length === 0) {
      console.log("  None — queue should be clean.");
    } else {
      console.log(
        `  ${residualResult.rows.length} order(s) shown (max 30):`
      );
      console.log(
        "  order# | state                | status               | due_date   | li_count"
      );
      console.log(
        "  -------|----------------------|----------------------|------------|--------"
      );
      for (const row of residualResult.rows) {
        console.log(
          `  ${String(row.order_number).padEnd(6)} | ${String(row.state).padEnd(20)} | ${String(row.status).padEnd(20)} | ${String(row.due_date ?? "—").padEnd(10)} | ${row.line_item_count}`
        );
      }
      console.log(
        "\n  To remove non-active orders from this list: cancel or close them via the Orders UI."
      );
    }

    console.log("\n[Done]\n");
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error("[Fatal]", err);
  process.exit(1);
});
