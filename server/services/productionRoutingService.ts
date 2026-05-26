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
import { and, eq, notInArray, sql } from "drizzle-orm";
import { orders, productionJobs } from "@shared/schema";
import { appendEvent } from "../productionHelpers";
import { TERMINAL_JOB_STATUSES } from "./productionOwnership";
import { isCanceledOrder } from "@shared/operationalState";
import { normalizeProductionStationKey } from "@shared/productionStations";

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
    stationKey: rawStationKey,
    stepKey,
    trigger,
    actorUserId = null,
    extraEventPayload = {},
  } = args;

  const runner = passedTx ?? db;
  const stationKey = normalizeProductionStationKey(rawStationKey) ?? rawStationKey;
  let step = "start";

  try {
    // Resolve station_id from station_key. Fail closed: a missing or
    // misconfigured station must block job creation rather than allow a
    // station_id-null row that the unique index cannot protect against.
    if (!stationKey) {
      throw Object.assign(
        new Error("[productionRoutingService] stationKey is required; refusing to create production job without a station target"),
        { statusCode: 400, stationKey, lineItemId },
      );
    }

    const [order] = await runner
      .select({ id: orders.id, state: orders.state, status: orders.status, canceledAt: orders.canceledAt })
      .from(orders)
      .where(and(eq(orders.organizationId, organizationId), eq(orders.id, orderId)))
      .limit(1);

    if (!order) {
      throw Object.assign(new Error("[productionRoutingService] parent order not found"), { statusCode: 404, orderId, lineItemId });
    }

    if (isCanceledOrder(order)) {
      throw Object.assign(
        new Error("[productionRoutingService] cancelled orders cannot receive production jobs"),
        { statusCode: 409, code: "ORDER_CANCELLED", orderId, lineItemId },
      );
    }

    step = "resolve_station_id";
    let stationId: string;
    try {
      const stationResult = await runner.execute(sql`
        select id
        from stations
        where organization_id = ${organizationId}
          and key = ${stationKey}
        limit 1
      `);
      const stationRow = stationResult.rows[0] as { id?: string } | undefined;
      if (!stationRow?.id) {
        throw Object.assign(
          new Error(
            `[productionRoutingService] station row not found for key="${stationKey}" in org="${organizationId}". ` +
            `Ensure the station exists in the stations table before routing jobs to it. ` +
            `Refusing to create production_job with no station identity.`,
          ),
          { statusCode: 409, stationKey, organizationId, lineItemId },
        );
      }
      stationId = String(stationRow.id);
    } catch (error: any) {
      // Re-throw our own sentinel errors without wrapping
      if (error?.statusCode) throw error;
      // Unexpected DB error — rethrow with context
      throw Object.assign(
        new Error(`[productionRoutingService] station_id resolution DB error for key="${stationKey}": ${(error as Error).message}`),
        { statusCode: 500, cause: error, stationKey, lineItemId },
      );
    }

    // B) Active-owner idempotency guard: historical done jobs must not block a new owner.
    step = "dedupe_check";
    const existingActiveJobs = await runner
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
          notInArray(productionJobs.status, [...TERMINAL_JOB_STATUSES]),
        ),
      );

    const filteredActiveJobs = existingActiveJobs;

    const existingExact = filteredActiveJobs.find((job: any) => {
      return job.stationKey === stationKey && job.stepKey === stepKey;
    });

    const existing = existingExact ?? filteredActiveJobs[0];

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

    step = "residual_active_guard";
    const residualActiveJobs = await runner
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
          notInArray(productionJobs.status, [...TERMINAL_JOB_STATUSES]),
        ),
      );

    const residualFilteredActiveJobs = residualActiveJobs;

    const residualExistingExact = residualFilteredActiveJobs.find((job: any) => {
      return job.stationKey === stationKey && job.stepKey === stepKey;
    });

    const residualExisting = residualExistingExact ?? residualFilteredActiveJobs[0];

    if (residualExisting) {
      const isDone = residualExisting.status === "done";
      const routingDiffers = residualExisting.stationKey !== stationKey || residualExisting.stepKey !== stepKey;
      const reason = routingDiffers
        ? `existing_non_void_job_with_different_route:${residualExisting.stationKey}/${residualExisting.stepKey}`
        : "existing_non_void_job_same_route";

      if (!isDone && residualExisting.orderId !== orderId) {
        step = "residual_guard_sync_order_id";
        await runner
          .update(productionJobs)
          .set({ orderId, updatedAt: new Date() })
          .where(
            and(
              eq(productionJobs.organizationId, organizationId),
              eq(productionJobs.id, residualExisting.id),
            ),
          );
      }

      console.warn("[productionRoutingService] existing active job prevented duplicate insert", {
        organizationId,
        lineItemId,
        stationKey,
        stepKey,
        existingJobId: residualExisting.id,
        existingStationKey: residualExisting.stationKey,
        existingStepKey: residualExisting.stepKey,
      });

      return {
        jobId: residualExisting.id,
        outcome: "existing",
        stationKey: residualExisting.stationKey,
        stepKey: residualExisting.stepKey,
        status: residualExisting.status,
        stationId,
        ignoredDueToDone: isDone,
        ignoredDueToExistingRouting: !isDone && routingDiffers,
        reason,
      };
    }

    // C) Insert new production job (stationId guaranteed non-null — fail-closed above)
    step = "insert_production_job";
    const insertedResult = await runner.execute(sql`
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
          stationId,
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
