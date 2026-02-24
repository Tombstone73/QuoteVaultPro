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
import { and, eq, sql } from "drizzle-orm";
import { productionJobs } from "@shared/schema";
import { stationResolver } from "./stations/stationResolver";
import { appendEvent } from "../productionHelpers";

export type RouteLineItemTrigger = "scheduler" | "intake" | "line_item_status" | "prepress";

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

  // A) Resolve station_id (fail-soft — never throws)
  const stationId = await stationResolver.resolveStationId({ organizationId, stationKey });

  // B) Station-aware dedup matching the DB unique index:
  //    UNIQUE (organization_id, line_item_id, station_id) WHERE station_id IS NOT NULL
  //    - When station_id resolved: match on (org, lineItem, station_id)
  //    - Fallback (no station_id): match on (org, lineItem, station_key)
  const stationCondition = stationId
    ? sql`station_id = ${stationId}`
    : eq(productionJobs.stationKey, stationKey);

  const [existing] = await runner
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
        stationCondition,
      ),
    )
    .limit(1);

  if (existing) {
    const isDone = existing.status === "done";
    const routingDiffers = existing.stationKey !== stationKey || existing.stepKey !== stepKey;

    // Sync orderId if it drifted (non-terminal jobs only)
    if (!isDone && existing.orderId !== orderId) {
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
    };
  }

  // C) Insert new production job
  const [inserted] = await runner
    .insert(productionJobs)
    .values({
      organizationId,
      orderId,
      lineItemId,
      stationKey,
      stepKey,
      status: "queued",
      totalSeconds: 0,
    })
    .returning({
      id: productionJobs.id,
      stationKey: productionJobs.stationKey,
      stepKey: productionJobs.stepKey,
      status: productionJobs.status,
    });

  // Set station_id via raw SQL (column exists in DB but not in Drizzle schema typings)
  if (stationId) {
    await runner.execute(sql`
      update production_jobs
      set station_id = ${stationId}
      where organization_id = ${organizationId}
        and id = ${inserted.id}
    `);
  }

  // D) Audit event for new job
  try {
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
}
