import "dotenv/config";
import { pool } from "./server/db";

const DEFAULT_ORG_ID = "org_titan_001";

function getArg(flag: string): string | null {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] ?? null : null;
}

function hasFlag(flag: string): boolean {
  return process.argv.includes(flag);
}

function printDivider(title: string) {
  console.log(`\n${title}`);
  console.log("-".repeat(title.length));
}

async function main() {
  const organizationId = getArg("--org") || DEFAULT_ORG_ID;
  const normalize = hasFlag("--normalize");
  const dryRun = hasFlag("--dry-run");

  if ((process.env.NODE_ENV || "").toLowerCase() === "production") {
    console.error("Refusing to run DEV routing audit in production.");
    process.exit(1);
  }

  console.log("[DEV Production Routing Audit]");
  console.log(`orgId      : ${organizationId}`);
  console.log(`normalize  : ${normalize}`);
  console.log(`dryRun     : ${dryRun}`);

  const client = await pool.connect();
  try {
    const multiOwnerRows = await client.query<{
      line_item_id: string;
      active_count: string;
      owner_job_id: string;
      owner_station_key: string | null;
      owner_step_key: string | null;
      active_job_ids: string[];
      active_routes: string[];
    }>(
      `
      WITH active_jobs AS (
        SELECT
          pj.id,
          pj.line_item_id,
          pj.station_key,
          pj.step_key,
          pj.status,
          pj.updated_at,
          pj.created_at,
          ROW_NUMBER() OVER (
            PARTITION BY pj.line_item_id
            ORDER BY pj.updated_at DESC NULLS LAST, pj.created_at DESC NULLS LAST, pj.id DESC
          ) AS rn,
          COUNT(*) OVER (PARTITION BY pj.line_item_id) AS active_count
        FROM production_jobs pj
        WHERE pj.organization_id = $1
          AND pj.line_item_id IS NOT NULL
          AND lower(coalesce(pj.status, '')) NOT IN ('done', 'void', 'canceled', 'cancelled')
      )
      SELECT
        aj.line_item_id,
        MAX(aj.active_count)::text AS active_count,
        MAX(CASE WHEN aj.rn = 1 THEN aj.id END) AS owner_job_id,
        MAX(CASE WHEN aj.rn = 1 THEN aj.station_key END) AS owner_station_key,
        MAX(CASE WHEN aj.rn = 1 THEN aj.step_key END) AS owner_step_key,
        ARRAY_AGG(aj.id ORDER BY aj.rn) AS active_job_ids,
        ARRAY_AGG(coalesce(aj.station_key, '') || '/' || coalesce(aj.step_key, '') ORDER BY aj.rn) AS active_routes
      FROM active_jobs aj
      GROUP BY aj.line_item_id
      HAVING MAX(aj.active_count) > 1
      ORDER BY MAX(aj.active_count) DESC, aj.line_item_id
      `,
      [organizationId],
    );

    printDivider("1) Line items with more than one non-done production job");
    if (multiOwnerRows.rows.length === 0) {
      console.log("None.");
    } else {
      for (const row of multiOwnerRows.rows) {
        console.log(
          `${row.line_item_id} | active=${row.active_count} | owner=${row.owner_job_id} | ownerRoute=${row.owner_station_key}/${row.owner_step_key} | jobs=${row.active_job_ids.join(", ")} | routes=${row.active_routes.join(", ")}`,
        );
      }
    }

    printDivider("2) Prepress-owned jobs left open after downstream routing");
    const stalePrepress = multiOwnerRows.rows.filter((row) => {
      const routes = row.active_routes.map((value) => String(value || "").toLowerCase());
      return routes.some((value) => value.endsWith("/prepress") || value.startsWith("prepress/"))
        && routes.some((value) => !(value.endsWith("/prepress") || value.startsWith("prepress/")));
    });
    if (stalePrepress.length === 0) {
      console.log("None.");
    } else {
      for (const row of stalePrepress) {
        console.log(`${row.line_item_id} | routes=${row.active_routes.join(", ")}`);
      }
    }

    printDivider("3) Downstream jobs left open after send-back-to-prepress");
    const staleDownstream = stalePrepress.filter((row) => {
      const ownerRoute = `${String(row.owner_station_key || "").toLowerCase()}/${String(row.owner_step_key || "").toLowerCase()}`;
      return ownerRoute.endsWith("/prepress") || ownerRoute.startsWith("prepress/");
    });
    if (staleDownstream.length === 0) {
      console.log("None.");
    } else {
      for (const row of staleDownstream) {
        console.log(`${row.line_item_id} | owner=${row.owner_job_id} | routes=${row.active_routes.join(", ")}`);
      }
    }

    const statusConflictRows = await client.query<{
      line_item_id: string;
      current_status: string;
      desired_status: string;
      owner_job_id: string;
      owner_station_key: string | null;
      owner_step_key: string | null;
    }>(
      `
      WITH ranked AS (
        SELECT
          pj.id,
          pj.line_item_id,
          pj.station_key,
          pj.step_key,
          pj.updated_at,
          pj.created_at,
          ROW_NUMBER() OVER (
            PARTITION BY pj.line_item_id
            ORDER BY pj.updated_at DESC NULLS LAST, pj.created_at DESC NULLS LAST, pj.id DESC
          ) AS rn
        FROM production_jobs pj
        WHERE pj.organization_id = $1
          AND pj.line_item_id IS NOT NULL
          AND lower(coalesce(pj.status, '')) NOT IN ('done', 'void', 'canceled', 'cancelled')
      ),
      owner_jobs AS (
        SELECT *
        FROM ranked
        WHERE rn = 1
      ),
      desired AS (
        SELECT
          oli.id AS line_item_id,
          oli.status AS current_status,
          oj.id AS owner_job_id,
          oj.station_key AS owner_station_key,
          oj.step_key AS owner_step_key,
          CASE
            WHEN lower(coalesce(oj.step_key, '')) = 'prepress' OR lower(coalesce(oj.station_key, '')) = 'prepress' THEN
              CASE
                WHEN EXISTS (
                  SELECT 1
                  FROM prepress_sessions ps
                  WHERE ps.organization_id = $1
                    AND ps.line_item_id = oli.id
                    AND ps.status = 'active'
                ) THEN 'in_prepress'
                WHEN EXISTS (
                  SELECT 1
                  FROM prepress_sessions ps
                  WHERE ps.organization_id = $1
                    AND ps.line_item_id = oli.id
                    AND ps.status = 'complete'
                ) THEN 'prepress_complete'
                ELSE 'pending_prepress'
              END
            ELSE
              CASE
                WHEN lower(coalesce(oli.status, '')) IN ('printing', 'finishing', 'complete', 'canceled') THEN oli.status
                ELSE 'print_ready'
              END
          END AS desired_status
        FROM order_line_items oli
        INNER JOIN orders o ON o.id = oli.order_id
        INNER JOIN owner_jobs oj ON oj.line_item_id = oli.id
        WHERE o.organization_id = $1
      )
      SELECT *
      FROM desired
      WHERE coalesce(current_status, '') <> coalesce(desired_status, '')
      ORDER BY line_item_id
      `,
      [organizationId],
    );

    printDivider("4) Lifecycle status conflicts vs resolved active owner");
    if (statusConflictRows.rows.length === 0) {
      console.log("None.");
    } else {
      for (const row of statusConflictRows.rows) {
        console.log(
          `${row.line_item_id} | current=${row.current_status} | desired=${row.desired_status} | owner=${row.owner_job_id} | route=${row.owner_station_key}/${row.owner_step_key}`,
        );
      }
    }

    if (normalize) {
      printDivider("5) Normalization");
      if (dryRun) {
        console.log(
          `Would mark ${multiOwnerRows.rows.reduce((sum, row) => sum + Math.max(Number(row.active_count) - 1, 0), 0)} stale active job(s) done and align ${statusConflictRows.rows.length} line-item status value(s).`,
        );
      } else {
        await client.query("BEGIN");

        const closeResult = await client.query<{ id: string }>(
          `
          WITH ranked AS (
            SELECT
              pj.id,
              ROW_NUMBER() OVER (
                PARTITION BY pj.line_item_id
                ORDER BY pj.updated_at DESC NULLS LAST, pj.created_at DESC NULLS LAST, pj.id DESC
              ) AS rn
            FROM production_jobs pj
            WHERE pj.organization_id = $1
              AND pj.line_item_id IS NOT NULL
              AND lower(coalesce(pj.status, '')) NOT IN ('done', 'void', 'canceled', 'cancelled')
          )
          UPDATE production_jobs pj
          SET
            status = 'done',
            completed_at = COALESCE(pj.completed_at, NOW()),
            updated_at = NOW()
          FROM ranked r
          WHERE pj.id = r.id
            AND r.rn > 1
          RETURNING pj.id
          `,
          [organizationId],
        );

        const statusNormalizeResult = await client.query<{ id: string }>(
          `
          WITH ranked AS (
            SELECT
              pj.id,
              pj.line_item_id,
              pj.station_key,
              pj.step_key,
              pj.updated_at,
              pj.created_at,
              ROW_NUMBER() OVER (
                PARTITION BY pj.line_item_id
                ORDER BY pj.updated_at DESC NULLS LAST, pj.created_at DESC NULLS LAST, pj.id DESC
              ) AS rn
            FROM production_jobs pj
            WHERE pj.organization_id = $1
              AND pj.line_item_id IS NOT NULL
              AND lower(coalesce(pj.status, '')) NOT IN ('done', 'void', 'canceled', 'cancelled')
          ),
          owner_jobs AS (
            SELECT *
            FROM ranked
            WHERE rn = 1
          ),
          desired AS (
            SELECT
              oli.id AS line_item_id,
              CASE
                WHEN lower(coalesce(oj.step_key, '')) = 'prepress' OR lower(coalesce(oj.station_key, '')) = 'prepress' THEN
                  CASE
                    WHEN EXISTS (
                      SELECT 1
                      FROM prepress_sessions ps
                      WHERE ps.organization_id = $1
                        AND ps.line_item_id = oli.id
                        AND ps.status = 'active'
                    ) THEN 'in_prepress'
                    WHEN EXISTS (
                      SELECT 1
                      FROM prepress_sessions ps
                      WHERE ps.organization_id = $1
                        AND ps.line_item_id = oli.id
                        AND ps.status = 'complete'
                    ) THEN 'prepress_complete'
                    ELSE 'pending_prepress'
                  END
                ELSE
                  CASE
                    WHEN lower(coalesce(oli.status, '')) IN ('printing', 'finishing', 'complete', 'canceled') THEN oli.status
                    ELSE 'print_ready'
                  END
              END AS desired_status
            FROM order_line_items oli
            INNER JOIN orders o ON o.id = oli.order_id
            INNER JOIN owner_jobs oj ON oj.line_item_id = oli.id
            WHERE o.organization_id = $1
          )
          UPDATE order_line_items oli
          SET
            status = desired.desired_status,
            updated_at = NOW()
          FROM desired
          WHERE oli.id = desired.line_item_id
            AND coalesce(oli.status, '') <> coalesce(desired.desired_status, '')
          RETURNING oli.id
          `,
          [organizationId],
        );

        await client.query("COMMIT");
        console.log(`Closed stale active jobs: ${closeResult.rowCount ?? 0}`);
        console.log(`Aligned lifecycle statuses: ${statusNormalizeResult.rowCount ?? 0}`);
      }
    }
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // ignore rollback errors in diagnostics script
    }
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error) => {
  console.error("[DEV Production Routing Audit] Fatal error", error);
  process.exit(1);
});
