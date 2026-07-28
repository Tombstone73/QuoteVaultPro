import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { aiProductDraftBulkUpdateRows, aiProductDraftBulkUpdates } from "@shared/schema";
import { db } from "../../db";
import { aggregateProductDraftBulkUpdateState, productDraftBulkUpdateResumeEligibility, type ProductDraftBulkUpdateChildState } from "./productInactiveDraftBulkUpdateRecovery";

type RowInput = { sourceOrder: number; productId: string; sessionId: string; productName: string; category: string | null; beforeSnapshot: Record<string, unknown>; beforeFingerprint: string; patch: Record<string, unknown>; patchDomain: string; provenance: Record<string, unknown>; fingerprint: string; eligibilityState: string; executionState: ProductDraftBulkUpdateChildState; warnings?: string[]; readinessBefore?: Record<string, unknown> | null };

export class ProductInactiveDraftBulkUpdateHistoryService {
  async createProposal(input: { organizationId: string; actorUserId: string; conversationId?: string; sourceTurnId?: string; sourceBatchId?: string; selectionDescription: string; sharedPatch: Record<string, unknown>; overrides: Record<string, unknown>; provenance: Record<string, unknown>; fingerprint: string; rows: RowInput[] }) {
    return db.transaction(async (tx) => {
      const eligibleCount = input.rows.filter((row) => row.executionState === "pending").length;
      const noChangeCount = input.rows.filter((row) => row.executionState === "no_change").length;
      const [proposal] = await tx.insert(aiProductDraftBulkUpdates).values({ orgId: input.organizationId, actorUserId: input.actorUserId, ...(input.conversationId ? { conversationId: input.conversationId } : {}), ...(input.sourceTurnId ? { sourceTurnId: input.sourceTurnId } : {}), ...(input.sourceBatchId ? { sourceBatchId: input.sourceBatchId } : {}), commandName: "products.update_inactive_draft_batch", commandVersion: "v1", selectionDescription: input.selectionDescription, sharedPatch: input.sharedPatch, overrides: input.overrides, provenance: input.provenance, fingerprint: input.fingerprint, targetCount: input.rows.length, eligibleCount, noChangeCount, blockedCount: input.rows.length - eligibleCount - noChangeCount, updatedAt: new Date() }).returning();
      if (!proposal) throw new Error("Failed to persist the bulk update proposal.");
      if (input.rows.length) await tx.insert(aiProductDraftBulkUpdateRows).values(input.rows.map((row) => ({ ...row, bulkUpdateId: proposal.id, orgId: input.organizationId, idempotencyKey: `${proposal.id}:row:${row.sourceOrder}`, warnings: row.warnings ?? [], readinessBefore: row.readinessBefore ?? null, updatedAt: new Date() })));
      return proposal;
    });
  }

  async getDetail(organizationId: string, bulkUpdateId: string) {
    const [proposal] = await db.select().from(aiProductDraftBulkUpdates).where(and(eq(aiProductDraftBulkUpdates.orgId, organizationId), eq(aiProductDraftBulkUpdates.id, bulkUpdateId))).limit(1);
    if (!proposal) return null;
    const rows = await db.select().from(aiProductDraftBulkUpdateRows).where(and(eq(aiProductDraftBulkUpdateRows.orgId, organizationId), eq(aiProductDraftBulkUpdateRows.bulkUpdateId, bulkUpdateId))).orderBy(aiProductDraftBulkUpdateRows.sourceOrder);
    return { proposal, rows, resume: productDraftBulkUpdateResumeEligibility(rows as Array<{ executionState: ProductDraftBulkUpdateChildState }>) };
  }

  async bindConfirmation(input: { organizationId: string; bulkUpdateId: string; planId: string; correlationId: string; idempotencyKey: string }) {
    await db.update(aiProductDraftBulkUpdates).set({ planId: input.planId, proposalStatus: "confirmed", confirmationStatus: "consumed", executionStatus: "running", correlationId: input.correlationId, idempotencyKey: input.idempotencyKey, confirmedAt: new Date(), startedAt: new Date(), updatedAt: new Date() }).where(and(eq(aiProductDraftBulkUpdates.orgId, input.organizationId), eq(aiProductDraftBulkUpdates.id, input.bulkUpdateId), eq(aiProductDraftBulkUpdates.confirmationStatus, "pending")));
  }

  async markRowRunning(input: { organizationId: string; bulkUpdateId: string; rowId: string }) { await db.update(aiProductDraftBulkUpdateRows).set({ executionState: "running", attemptCount: sql`${aiProductDraftBulkUpdateRows.attemptCount} + 1`, lastAttemptedAt: new Date(), updatedAt: new Date() }).where(and(eq(aiProductDraftBulkUpdateRows.orgId, input.organizationId), eq(aiProductDraftBulkUpdateRows.bulkUpdateId, input.bulkUpdateId), eq(aiProductDraftBulkUpdateRows.id, input.rowId))); }
  async markRowSuccess(input: { organizationId: string; bulkUpdateId: string; rowId: string; readinessAfter: Record<string, unknown>; afterSnapshot: Record<string, unknown> }) { await db.update(aiProductDraftBulkUpdateRows).set({ executionState: "updated", readinessAfter: input.readinessAfter, afterSnapshot: input.afterSnapshot, retryable: false, lastErrorCode: null, lastErrorMessage: null, completedAt: new Date(), updatedAt: new Date() }).where(and(eq(aiProductDraftBulkUpdateRows.orgId, input.organizationId), eq(aiProductDraftBulkUpdateRows.bulkUpdateId, input.bulkUpdateId), eq(aiProductDraftBulkUpdateRows.id, input.rowId))); }
  async markRowFailure(input: { organizationId: string; bulkUpdateId: string; rowId: string; state: "failed_retryable" | "failed_terminal" | "stale"; code: string; message: string; retryable: boolean }) { await db.update(aiProductDraftBulkUpdateRows).set({ executionState: input.state, retryable: input.retryable, lastErrorCode: input.code, lastErrorMessage: input.message.slice(0, 1000), completedAt: new Date(), updatedAt: new Date() }).where(and(eq(aiProductDraftBulkUpdateRows.orgId, input.organizationId), eq(aiProductDraftBulkUpdateRows.bulkUpdateId, input.bulkUpdateId), eq(aiProductDraftBulkUpdateRows.id, input.rowId))); }
  async complete(organizationId: string, bulkUpdateId: string) { const detail = await this.getDetail(organizationId, bulkUpdateId); if (!detail) return; const state = aggregateProductDraftBulkUpdateState(detail.rows as Array<{ executionState: ProductDraftBulkUpdateChildState }>); await db.update(aiProductDraftBulkUpdates).set({ executionStatus: state, completedAt: new Date(), updatedAt: new Date() }).where(and(eq(aiProductDraftBulkUpdates.orgId, organizationId), eq(aiProductDraftBulkUpdates.id, bulkUpdateId))); }
  async list(organizationId: string, input: { conversationId?: string; states?: string[]; limit?: number } = {}) { const limit = Math.max(1, Math.min(input.limit ?? 25, 25)); const clauses = [eq(aiProductDraftBulkUpdates.orgId, organizationId), ...(input.conversationId ? [eq(aiProductDraftBulkUpdates.conversationId, input.conversationId)] : []), ...(input.states?.length ? [inArray(aiProductDraftBulkUpdates.executionStatus, input.states)] : [])]; return db.select().from(aiProductDraftBulkUpdates).where(and(...clauses)).orderBy(desc(aiProductDraftBulkUpdates.createdAt)).limit(limit); }
}
export const productInactiveDraftBulkUpdateHistoryService = new ProductInactiveDraftBulkUpdateHistoryService();
