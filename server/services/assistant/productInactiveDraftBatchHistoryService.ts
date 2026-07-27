import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { aiProductDraftBatches, aiProductDraftBatchRows } from "@shared/schema";
import { db } from "../../db";

export type ProductDraftBatchRowState = "pending" | "running" | "created" | "failed_retryable" | "failed_terminal" | "skipped" | "excluded" | "already_completed";
export type ProductDraftBatchState = "proposed" | "confirmed" | "running" | "partially_completed" | "completed" | "completed_with_failures" | "failed" | "cancelled";

export class ProductInactiveDraftBatchHistoryService {
  async beginExecution(input: { organizationId: string; batchId: string; planId: string; correlationId: string; idempotencyKey: string }) {
    await db.update(aiProductDraftBatches).set({ planId: input.planId, correlationId: input.correlationId, idempotencyKey: input.idempotencyKey, proposalStatus: "confirmed", executionStatus: "running", confirmedAt: new Date(), startedAt: new Date(), updatedAt: new Date() }).where(and(eq(aiProductDraftBatches.orgId, input.organizationId), eq(aiProductDraftBatches.id, input.batchId)));
  }
  async markRowCreated(input: { organizationId: string; batchId: string; rowNumber: number; productId: string; readinessResult: Record<string, unknown> }) {
    await db.update(aiProductDraftBatchRows).set({ executionState: "created", productId: input.productId, readinessResult: input.readinessResult, attemptCount: sql`${aiProductDraftBatchRows.attemptCount} + 1`, retryable: false, lastErrorCode: null, lastErrorMessage: null, completedAt: new Date(), updatedAt: new Date() }).where(and(eq(aiProductDraftBatchRows.orgId, input.organizationId), eq(aiProductDraftBatchRows.batchId, input.batchId), eq(aiProductDraftBatchRows.sourceRowNumber, input.rowNumber)));
  }
  async markRowFailure(input: { organizationId: string; batchId: string; rowNumber: number; code: string; message: string; retryable: boolean }) {
    await db.update(aiProductDraftBatchRows).set({ executionState: input.retryable ? "failed_retryable" : "failed_terminal", attemptCount: sql`${aiProductDraftBatchRows.attemptCount} + 1`, lastErrorCode: input.code, lastErrorMessage: input.message.slice(0, 1000), retryable: input.retryable, completedAt: new Date(), updatedAt: new Date() }).where(and(eq(aiProductDraftBatchRows.orgId, input.organizationId), eq(aiProductDraftBatchRows.batchId, input.batchId), eq(aiProductDraftBatchRows.sourceRowNumber, input.rowNumber)));
  }
  async completeExecution(input: { organizationId: string; batchId: string; hadFailures: boolean }) {
    await db.update(aiProductDraftBatches).set({ executionStatus: input.hadFailures ? "completed_with_failures" : "completed", completedAt: new Date(), updatedAt: new Date() }).where(and(eq(aiProductDraftBatches.orgId, input.organizationId), eq(aiProductDraftBatches.id, input.batchId)));
  }
  async createProposal(input: { organizationId: string; conversationId: string; sourceTurnId?: string; actorUserId: string; label: string; sourceFormat: string; sharedDefaults: Record<string, unknown>; fingerprint: string; rows: Array<{ sourceRowNumber: number; productName: string; intakeSessionId: string; proposalFingerprint: string; resolvedPayload: Record<string, unknown>; provenance: Record<string, unknown> }> }) {
    return db.transaction(async (tx) => {
      const [batch] = await tx.insert(aiProductDraftBatches).values({ orgId: input.organizationId, conversationId: input.conversationId, ...(input.sourceTurnId ? { sourceTurnId: input.sourceTurnId } : {}), actorUserId: input.actorUserId, commandName: "products.create_inactive_draft_batch", commandVersion: "v1", label: input.label, sourceFormat: input.sourceFormat, sharedDefaults: input.sharedDefaults, fingerprint: input.fingerprint, submittedCount: input.rows.length, includedCount: input.rows.length, excludedCount: 0, updatedAt: new Date() }).returning();
      if (!batch) throw new Error("Failed to persist product draft batch proposal.");
      await tx.insert(aiProductDraftBatchRows).values(input.rows.map((row) => ({ batchId: batch.id, orgId: input.organizationId, sourceRowNumber: row.sourceRowNumber, productName: row.productName, resolvedPayload: row.resolvedPayload, provenance: row.provenance, fingerprint: row.proposalFingerprint, idempotencyKey: `${batch.id}:row:${row.sourceRowNumber}`, updatedAt: new Date() })));
      return batch;
    });
  }

  async getDetail(organizationId: string, batchId: string) {
    const [batch] = await db.select().from(aiProductDraftBatches).where(and(eq(aiProductDraftBatches.orgId, organizationId), eq(aiProductDraftBatches.id, batchId))).limit(1);
    if (!batch) return null;
    const rows = await db.select().from(aiProductDraftBatchRows).where(and(eq(aiProductDraftBatchRows.orgId, organizationId), eq(aiProductDraftBatchRows.batchId, batchId))).orderBy(aiProductDraftBatchRows.sourceRowNumber);
    return { batch, rows };
  }

  async list(organizationId: string, input: { conversationId?: string; states?: ProductDraftBatchState[]; limit?: number } = {}) {
    const limit = Math.max(1, Math.min(input.limit ?? 25, 25));
    const clauses = [eq(aiProductDraftBatches.orgId, organizationId), ...(input.conversationId ? [eq(aiProductDraftBatches.conversationId, input.conversationId)] : []), ...(input.states?.length ? [inArray(aiProductDraftBatches.executionStatus, input.states)] : [])];
    return db.select().from(aiProductDraftBatches).where(and(...clauses)).orderBy(desc(aiProductDraftBatches.createdAt)).limit(limit);
  }
}

export const productInactiveDraftBatchHistoryService = new ProductInactiveDraftBatchHistoryService();
