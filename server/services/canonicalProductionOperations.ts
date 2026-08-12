import { and, eq } from "drizzle-orm";

import { productionJobs } from "@shared/schema";
import { db } from "../db";
import { appendEvent, getTimerStateForJob } from "../routes/production.shared";
import { isTerminalProductionStatus } from "@shared/operationalState";
import { assertParentOrderInProductionForJob } from "./orderProductionGate";
import { canonicalPrepressOperations } from "./canonicalPrepressOperations";
import { scheduleOrderLineItemsForProduction } from "./productionScheduling";

export class CanonicalProductionOperationError extends Error {
  constructor(message: string, readonly statusCode = 409, readonly code = "PRODUCTION_OPERATION_BLOCKED") {
    super(message);
  }
}

/** Shared production operation family for UI and confirmed Assistant adapters. */
export class CanonicalProductionOperations {
  async intakeLineItems(input: Parameters<typeof scheduleOrderLineItemsForProduction>[0]) {
    return scheduleOrderLineItemsForProduction(input);
  }

  async startJob(input: { organizationId: string; actorUserId?: string | null; jobId: string }) {
    return db.transaction((tx) => this.startJobInTransaction(tx, input));
  }

  async startJobInTransaction(tx: any, input: { organizationId: string; actorUserId?: string | null; jobId: string }) {
    const [job] = await tx.select().from(productionJobs).where(and(
      eq(productionJobs.organizationId, input.organizationId),
      eq(productionJobs.id, input.jobId),
    )).limit(1);
    if (!job) throw new CanonicalProductionOperationError("Production job not found.", 404, "PRODUCTION_JOB_NOT_FOUND");
    if (!job.orderId || !job.lineItemId) throw new CanonicalProductionOperationError("Production job is missing its order line item.", 409, "PRODUCTION_JOB_LINE_ITEM_MISSING");
    if (isTerminalProductionStatus(job.status)) throw new CanonicalProductionOperationError("Job is terminal; reopen or restore first.", 409, "PRODUCTION_JOB_TERMINAL");
    await assertParentOrderInProductionForJob(tx, { organizationId: input.organizationId, job, action: "start production job" });
    const timerState = await getTimerStateForJob(input.organizationId, input.jobId, tx);
    if (timerState.isRunning) return job;
    const now = new Date();
    await appendEvent({ tx, organizationId: input.organizationId, productionJobId: job.id, type: "timer_started", actorUserId: input.actorUserId ?? null });
    await tx.update(productionJobs).set({
      status: job.status === "queued" ? "in_progress" : job.status,
      startedAt: job.startedAt ?? now,
      updatedAt: now,
    }).where(and(eq(productionJobs.organizationId, input.organizationId), eq(productionJobs.id, job.id)));
    const [updated] = await tx.select().from(productionJobs).where(and(eq(productionJobs.organizationId, input.organizationId), eq(productionJobs.id, job.id))).limit(1);
    return updated;
  }

  async addJobNote(input: { organizationId: string; actorUserId: string; jobId: string; note: string; source: "ui" | "assistant" }) {
    return db.transaction(async (tx) => {
      const [job] = await tx.select({ id: productionJobs.id }).from(productionJobs).where(and(eq(productionJobs.organizationId, input.organizationId), eq(productionJobs.id, input.jobId))).limit(1);
      if (!job) throw new CanonicalProductionOperationError("Production job not found.", 404, "PRODUCTION_JOB_NOT_FOUND");
      await appendEvent({ tx, organizationId: input.organizationId, productionJobId: job.id, type: "note", actorUserId: input.actorUserId, payload: { text: input.note, actorUserId: input.actorUserId, source: input.source } });
      await tx.update(productionJobs).set({ updatedAt: new Date() }).where(and(eq(productionJobs.organizationId, input.organizationId), eq(productionJobs.id, job.id)));
      return job;
    });
  }

  returnLineItemToPrepress(input: { organizationId: string; actorUserId: string; lineItemId: string; reason: string }) {
    return canonicalPrepressOperations.returnLineItemFromProduction(input);
  }
}

export const canonicalProductionOperations = new CanonicalProductionOperations();

export function renderCanonicalProductionOperationMigrationMarkdown() {
  return `# Shared canonical Production operations\n\n| Operation | Shared users | State owner | AI scope |\n|---|---|---|---|\n| \`production.intake_line_items.v1\` | Production UI and Assistant | Existing scheduler/routing services | GO-confirmed existing command |\n| \`production.start_job.v1\` | Production UI and Assistant | Parent-order gate, timer state, job event stream | GO-confirmed queued-job start only |\n| \`production.add_job_note.v1\` | Assistant adapter | Existing production event stream | GO-confirmed append-only note |\n| \`prepress.return_from_production.v1\` | Production board and Assistant | Combined-run-safe return service | GO-confirmed one-line edit return only |\n\nCompletion, reopen/recovery, station assignment, and combined-run management retain their existing specialized UI services and are not broadened to AI.\n`;
}
