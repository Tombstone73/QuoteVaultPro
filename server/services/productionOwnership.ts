/**
 * productionOwnership.ts
 *
 * Canonical shared helpers for production job ownership.
 * Single source of truth for determining the active non-terminal production job
 * for a line item, and for performing canonical close/create station transitions.
 *
 * Rules:
 * - A production job is "terminal" if its status is one of: done, void, canceled, cancelled
 * - A line item may have at most one active (non-terminal) production job at any time
 * - Board ownership is derived exclusively from the active non-terminal production job
 * - Station changes are modeled as close-current/create-next (historical chain), not in-place rewrites
 */

import { and, eq, notInArray, desc, sql } from "drizzle-orm";
import { productionJobs } from "@shared/schema";
import { appendEvent } from "../productionHelpers";

// ────────────────────────────────────────────────────────────
// Constants
// ────────────────────────────────────────────────────────────

/** Statuses considered terminal (job is no longer active). */
export const TERMINAL_JOB_STATUSES = ["done", "void", "canceled", "cancelled"] as const;

/** The lifecycle-only statuses allowed on order_line_items.status. */
export const LINE_ITEM_LIFECYCLE_STATUSES = ["new", "in_production", "complete", "canceled"] as const;

/**
 * Station-like statuses that must NEVER be written to order_line_items.status.
 * Kept for reference and defensive read-path guards.
 */
export const LEGACY_STATION_STATUSES = [
  "pending_prepress",
  "in_prepress",
  "prepress_complete",
  "print_ready",
  "queued",
  "printing",
  "finishing",
] as const;

// ────────────────────────────────────────────────────────────
// Type Exports
// ────────────────────────────────────────────────────────────

export type TerminalJobStatus = (typeof TERMINAL_JOB_STATUSES)[number];

export interface ActiveProductionJob {
  id: string;
  orderId: string;
  lineItemId: string | null;
  stationKey: string;
  stepKey: string;
  status: string;
  stationId: string | null;
  totalSeconds: number;
  startedAt: Date | null;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface StationTransitionResult {
  closedJobId: string;
  createdJobId: string;
  newStationKey: string;
  newStepKey: string;
  newStatus: string;
}

// ────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────

/**
 * Returns true if the given status is terminal (job is no longer active).
 */
export function isTerminalStatus(status: string | null | undefined): boolean {
  if (!status) return false;
  return (TERMINAL_JOB_STATUSES as readonly string[]).includes(
    status.toLowerCase().trim(),
  );
}

/**
 * Returns true if the given status is a non-terminal (active) production job status.
 */
export function isActiveJobStatus(status: string | null | undefined): boolean {
  return !!status && !isTerminalStatus(status);
}

// ────────────────────────────────────────────────────────────
// Core Ownership Queries
// ────────────────────────────────────────────────────────────

/**
 * Find the single active (non-terminal) production job for a line item.
 * Returns null if no active job exists.
 *
 * This is the CANONICAL way to check board ownership.
 * If multiple active jobs exist (should not happen), returns the most recently updated.
 *
 * @param runner - Drizzle db or transaction handle
 */
export async function findActiveJobForLineItem(
  runner: any,
  args: { organizationId: string; lineItemId: string },
): Promise<ActiveProductionJob | null> {
  const rows = await runner
    .select({
      id: productionJobs.id,
      orderId: productionJobs.orderId,
      lineItemId: productionJobs.lineItemId,
      stationKey: productionJobs.stationKey,
      stepKey: productionJobs.stepKey,
      status: productionJobs.status,
      stationId: sql<string | null>`production_jobs.station_id`,
      totalSeconds: productionJobs.totalSeconds,
      startedAt: productionJobs.startedAt,
      completedAt: productionJobs.completedAt,
      createdAt: productionJobs.createdAt,
      updatedAt: productionJobs.updatedAt,
    })
    .from(productionJobs)
    .where(
      and(
        eq(productionJobs.organizationId, args.organizationId),
        eq(productionJobs.lineItemId, args.lineItemId),
        notInArray(productionJobs.status, [...TERMINAL_JOB_STATUSES]),
      ),
    )
    .orderBy(desc(productionJobs.updatedAt))
    .limit(1);

  return rows[0] ?? null;
}

/**
 * Find ALL active (non-terminal) production jobs for a given line item.
 * Normally this should return 0 or 1. If it returns >1, there's a data integrity issue.
 */
export async function findAllActiveJobsForLineItem(
  runner: any,
  args: { organizationId: string; lineItemId: string },
): Promise<ActiveProductionJob[]> {
  return runner
    .select({
      id: productionJobs.id,
      orderId: productionJobs.orderId,
      lineItemId: productionJobs.lineItemId,
      stationKey: productionJobs.stationKey,
      stepKey: productionJobs.stepKey,
      status: productionJobs.status,
      stationId: sql<string | null>`production_jobs.station_id`,
      totalSeconds: productionJobs.totalSeconds,
      startedAt: productionJobs.startedAt,
      completedAt: productionJobs.completedAt,
      createdAt: productionJobs.createdAt,
      updatedAt: productionJobs.updatedAt,
    })
    .from(productionJobs)
    .where(
      and(
        eq(productionJobs.organizationId, args.organizationId),
        eq(productionJobs.lineItemId, args.lineItemId),
        notInArray(productionJobs.status, [...TERMINAL_JOB_STATUSES]),
      ),
    )
    .orderBy(desc(productionJobs.updatedAt));
}

/**
 * Returns true if the line item currently has active board ownership
 * (i.e., at least one non-terminal production job exists).
 */
export async function hasActiveBoardOwnership(
  runner: any,
  args: { organizationId: string; lineItemId: string },
): Promise<boolean> {
  const job = await findActiveJobForLineItem(runner, args);
  return job !== null;
}

// ────────────────────────────────────────────────────────────
// Canonical Transition: Close Current → Create Next
// ────────────────────────────────────────────────────────────

/**
 * Atomically completes the current active job and creates a new job at the target station.
 * This is the canonical way to perform a station change.
 *
 * Must be called within a transaction (pass tx).
 *
 * Returns the closed job ID, created job ID, and new station info.
 * Throws if no active job exists.
 */
export async function transitionToStation(
  tx: any,
  args: {
    organizationId: string;
    orderId: string;
    lineItemId: string;
    targetStationKey: string;
    targetStepKey: string;
    reason: string;
    actorUserId?: string | null;
  },
): Promise<StationTransitionResult> {
  const now = new Date();

  // 1. Find active job
  const activeJob = await findActiveJobForLineItem(tx, {
    organizationId: args.organizationId,
    lineItemId: args.lineItemId,
  });

  if (!activeJob) {
    throw Object.assign(
      new Error(`No active production job found for line item ${args.lineItemId}`),
      { statusCode: 404 },
    );
  }

  // 2. Complete (close) the current active job
  await tx
    .update(productionJobs)
    .set({
      status: "done",
      completedAt: now,
      updatedAt: now,
    })
    .where(
      and(
        eq(productionJobs.organizationId, args.organizationId),
        eq(productionJobs.id, activeJob.id),
      ),
    );

  // 3. Emit routing_override event on the closed job
  await appendEvent({
    tx,
    organizationId: args.organizationId,
    productionJobId: activeJob.id,
    type: "routing_override",
    payload: {
      action: "station_transition_close",
      from: {
        stationKey: activeJob.stationKey,
        stepKey: activeJob.stepKey,
        status: activeJob.status,
      },
      to: {
        stationKey: args.targetStationKey,
        stepKey: args.targetStepKey,
      },
      reason: args.reason,
      actorUserId: args.actorUserId ?? null,
    },
  });

  // 5. Guard: ensure no orphan active jobs remain before inserting
  //    The partial unique index (migration 0059) will catch this at DB level too,
  //    but an explicit check gives a clearer error message.
  const residualActive = await findActiveJobForLineItem(tx, {
    organizationId: args.organizationId,
    lineItemId: args.lineItemId,
  });
  if (residualActive) {
    throw Object.assign(
      new Error(
        `Cannot create new job: line item ${args.lineItemId} still has active job ${residualActive.id} after close attempt`,
      ),
      { statusCode: 409 },
    );
  }

  // 6. Resolve station_id for the target station
  let stationId: string | null = null;
  try {
    const stationResult = await tx.execute(sql`
      SELECT id FROM stations
      WHERE organization_id = ${args.organizationId}
        AND key = ${args.targetStationKey}
      LIMIT 1
    `);
    stationId = stationResult.rows[0]?.id
      ? String(stationResult.rows[0].id)
      : null;
  } catch {
    stationId = null;
  }

  // 7. Create new job at target station
  const insertResult = stationId
    ? await tx.execute(sql`
        INSERT INTO production_jobs (
          organization_id, order_id, line_item_id, station_id,
          station_key, step_key, status, total_seconds
        ) VALUES (
          ${args.organizationId}, ${args.orderId}, ${args.lineItemId}, ${stationId},
          ${args.targetStationKey}, ${args.targetStepKey}, ${"queued"}, ${0}
        )
        RETURNING id, station_key AS "stationKey", step_key AS "stepKey", status
      `)
    : await tx.execute(sql`
        INSERT INTO production_jobs (
          organization_id, order_id, line_item_id,
          station_key, step_key, status, total_seconds
        ) VALUES (
          ${args.organizationId}, ${args.orderId}, ${args.lineItemId},
          ${args.targetStationKey}, ${args.targetStepKey}, ${"queued"}, ${0}
        )
        RETURNING id, station_key AS "stationKey", step_key AS "stepKey", status
      `);

  const newJob = insertResult.rows[0] as {
    id: string;
    stationKey: string;
    stepKey: string;
    status: string;
  };

  // 8. Emit intake event on the new job
  await appendEvent({
    tx,
    organizationId: args.organizationId,
    productionJobId: newJob.id,
    type: "intake",
    payload: {
      trigger: "station_transition",
      previousJobId: activeJob.id,
      previousStationKey: activeJob.stationKey,
      previousStepKey: activeJob.stepKey,
      stationKey: args.targetStationKey,
      stepKey: args.targetStepKey,
      reason: args.reason,
      actorUserId: args.actorUserId ?? null,
    },
  });

  return {
    closedJobId: activeJob.id,
    createdJobId: newJob.id,
    newStationKey: newJob.stationKey,
    newStepKey: newJob.stepKey,
    newStatus: newJob.status,
  };
}

/**
 * Completes the current active job without creating a successor.
 * Used for terminal completions (e.g., final production step done).
 * Returns the closed job, or null if no active job existed.
 */
export async function completeActiveJob(
  tx: any,
  args: {
    organizationId: string;
    lineItemId: string;
    reason?: string;
  },
): Promise<ActiveProductionJob | null> {
  const now = new Date();

  const activeJob = await findActiveJobForLineItem(tx, {
    organizationId: args.organizationId,
    lineItemId: args.lineItemId,
  });

  if (!activeJob) return null;

  await tx
    .update(productionJobs)
    .set({
      status: "done",
      completedAt: now,
      updatedAt: now,
    })
    .where(
      and(
        eq(productionJobs.organizationId, args.organizationId),
        eq(productionJobs.id, activeJob.id),
      ),
    );

  return activeJob;
}
