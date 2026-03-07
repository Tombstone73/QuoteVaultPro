/**
 * productionRoutingService.ts
 *
 * Canonical single code path for inserting production_jobs.
 * All code that previously inserted production_jobs directly now calls routeLineItemToProduction.
 *
 * Guarantees:
 * - station_key is always set
 * - station_id is set when resolvable (fail-soft via StationResolver)
 * - Dedup is station-aware matching the DB unique index:
 *     UNIQUE (organization_id, line_item_id, station_id) WHERE station_id IS NOT NULL
 * - Exactly one audit event is emitted per call (outcome: "created" or "existing")
 */

import { db } from "../db";
import { and, eq, ne, sql } from "drizzle-orm";
import { productionJobs } from "@shared/schema";
import { appendEvent } from "../productionHelpers";

export type RouteLineItemTrigger = "scheduler" | "intake" | "line_item_status" | "prepress" | "prepress_handoff";

export interface RouteLineItemArgs {
  /**
   * Pass an active Drizzle transaction to participate in an existing txn.
   * If omitted, db is used directly (no wrapping transaction is created).
   * In practice all callers pass their own tx.
   */
  tx?: any;
  organizationId: string;
  orderId: string;
  lineItemId: string;
  stationKey: string;
  stepKey: string;
  trigger: RouteLineItemTrigger;
  actorUserId?: string | null;
  traceId?: string;
  /** Extra key/value pairs merged into the audit event payload (e.g. fromStatus, toStatus). */
  extraEventPayload?: Record<string, any>;
}

export interface RouteLineItemResult {
  jobId: string;
  outcome: "created" | "existing";
  /** Applied station key — from the existing job when outcome=existing. */
  stationKey: string;
  /** Applied step key — from the existing job when outcome=existing. */
  stepKey: string;
  status: string;
  stationId: string | null;
  ignoredDueToDone: boolean;
  ignoredDueToExistingRouting: boolean;
  reason?: string;
}

export async function routeLineItemToProduction(args: RouteLineItemArgs): Promise<RouteLineItemResult> {
  const {
    tx: passedTx,
    organizationId,
    orderId,
    lineItemId,
    stationKey,
    stepKey,
    trigger,
    actorUserId = null,
    extraEventPayload = {},
  } = args;

  const runner = passedTx ?? db;
  let step = "start";

  try {
    // Resolve station_id from station_key for uniqueness alignment.
    let stationId: string | null = null;
    if (stationKey) {
      try {
        step = "resolve_station_id";
        const stationResult = await runner.execute(sql`
          select id
          from stations
          where organization_id = ${organizationId}
            and key = ${stationKey}
          limit 1
        `);
        const stationRow = stationResult.rows[0] as { id?: string } | undefined;
        stationId = stationRow?.id ? String(stationRow.id) : null;
      } catch (error) {
        if (process.env.NODE_ENV !== "production") {
          console.warn("[productionRoutingService] station_id resolution failed; continuing with station_key only", error);
        }
        stationId = null;
      }
    }

    // B) Non-void idempotency guard: if any active job exists for this line item, never create a second one silently.
    step = "dedupe_check";
    const existingNonVoidJobs = await runner
      .select({
        id: productionJobs.id,
        orderId: productionJobs.orderId,
        stationKey: productionJobs.stationKey,
        stepKey: productionJobs.stepKey,
        status: productionJobs.status,
      })
      .from(productionJobs)
      .where(
        and(
          eq(productionJobs.organizationId, organizationId),
          eq(productionJobs.lineItemId, lineItemId),
          ne(productionJobs.status, "void"),
        ),
      );

    const existingExact = existingNonVoidJobs.find((job: any) => {
      return job.stationKey === stationKey && job.stepKey === stepKey;
    });

    const existing = existingExact ?? existingNonVoidJobs[0];

    if (existing) {
      const isDone = existing.status === "done";
      const routingDiffers = existing.stationKey !== stationKey || existing.stepKey !== stepKey;
      const reason = routingDiffers
        ? `existing_non_void_job_with_different_route:${existing.stationKey}/${existing.stepKey}`
        : "existing_non_void_job_same_route";

      // Sync orderId if it drifted (non-terminal jobs only)
      if (!isDone && existing.orderId !== orderId) {
        step = "update_line_item";
        await runner
          .update(productionJobs)
          .set({ orderId, updatedAt: new Date() })
          .where(
            and(
              eq(productionJobs.organizationId, organizationId),
              eq(productionJobs.id, existing.id),
            ),
          );
      }

      // No audit event on no-op path — only emit when a new row is created (see below).

      return {
        jobId: existing.id,
        outcome: "existing",
        stationKey: existing.stationKey,
        stepKey: existing.stepKey,
        status: existing.status,
        stationId,
        ignoredDueToDone: isDone,
        ignoredDueToExistingRouting: !isDone && routingDiffers,
        reason,
      };
    }

    // C) Insert new production job
    step = "insert_production_job";
    const insertedResult = stationId
      ? await runner.execute(sql`
          insert into production_jobs (
            organization_id,
            order_id,
            line_item_id,
            station_id,
            station_key,
            step_key,
            status,
            total_seconds
          )
          values (
            ${organizationId},
            ${orderId},
            ${lineItemId},
            ${stationId},
            ${stationKey},
            ${stepKey},
            ${"queued"},
            ${0}
          )
          returning id, station_key as "stationKey", step_key as "stepKey", status
        `)
      : await runner.execute(sql`
          insert into production_jobs (
            organization_id,
            order_id,
            line_item_id,
            station_key,
            step_key,
            status,
            total_seconds
          )
          values (
            ${organizationId},
            ${orderId},
            ${lineItemId},
            ${stationKey},
            ${stepKey},
            ${"queued"},
            ${0}
          )
          returning id, station_key as "stationKey", step_key as "stepKey", status
        `);

    const inserted = insertedResult.rows[0] as {
      id: string;
      stationKey: string;
      stepKey: string;
      status: string;
    };

    // D) Audit event for new job
    try {
      step = "insert_production_event";
      await appendEvent({
        tx: runner,
        organizationId,
        productionJobId: inserted.id,
        type: "intake",
        payload: {
          trigger,
          stationKey,
          ...(stationId ? { stationId } : {}),
          stepKey,
          outcome: "created",
          actorUserId,
          ...extraEventPayload,
        },
      });
    } catch (e) {
      if (process.env.NODE_ENV !== "production") {
        console.warn("[productionRoutingService] appendEvent failed for new job", e);
      }
    }

    return {
      jobId: inserted.id,
      outcome: "created",
      stationKey: inserted.stationKey,
      stepKey: inserted.stepKey,
      status: inserted.status,
      stationId,
      ignoredDueToDone: false,
      ignoredDueToExistingRouting: false,
    };
  } catch (err: any) {
    console.error("[RouteLineItemFail] ENTER", { traceId: args.traceId, step });
    console.error("[RouteLineItemFail] SHAPE", {
      traceId: args.traceId,
      step,
      type: typeof err,
      name: (err as any)?.name,
      keys: Object.keys((err as any) || {}),
      message: (err as any)?.message,
    });
    console.error("[RouteLineItemFail]", {
      traceId: args.traceId,
      step,
      code: err?.code,
      constraint: err?.constraint,
      table: err?.table,
      detail: err?.detail,
      message: err?.message,
    });
    if (err?.cause) {
      console.error("[RouteLineItemFail.cause]", {
        traceId: args.traceId,
        step,
        code: err.cause?.code,
        constraint: err.cause?.constraint,
        table: err.cause?.table,
        detail: err.cause?.detail,
        message: err.cause?.message,
      });
    }
    throw err;
  }
}
