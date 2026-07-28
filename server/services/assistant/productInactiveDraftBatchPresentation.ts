import { normalizeProductDraftBatchName } from "./productInactiveDraftBatchService";
import type { ProductDraftBatchChildState } from "./productInactiveDraftBatchRecovery";

export type ProductDraftBatchRowView = { id: string; sourceRowNumber: number; productName: string; executionState: ProductDraftBatchChildState; productId: string | null; attemptCount: number; retryable: boolean; readinessResult: Record<string, unknown> | null; lastErrorCode: string | null; lastErrorMessage: string | null; provenance: Record<string, unknown> };
export type ProductDraftBatchResumeEligibility = { available: boolean; pendingCount: number; retryableCount: number; terminalCount: number; createdCount: number; staleCount: number; requiresNewProposal: boolean };

export function productDraftBatchResumeEligibility(rows: readonly ProductDraftBatchRowView[]): ProductDraftBatchResumeEligibility {
  const pendingCount = rows.filter((row) => row.executionState === "pending").length;
  const retryableCount = rows.filter((row) => row.executionState === "failed_retryable").length;
  const terminalCount = rows.filter((row) => row.executionState === "failed_terminal").length;
  const createdCount = rows.filter((row) => row.executionState === "created" || row.executionState === "already_completed").length;
  const staleCount = rows.filter((row) => row.lastErrorCode?.includes("STALE") || row.lastErrorCode?.includes("FINGERPRINT")).length;
  return { available: pendingCount + retryableCount > 0, pendingCount, retryableCount, terminalCount, createdCount, staleCount, requiresNewProposal: terminalCount > 0 || staleCount > 0 };
}

export function summarizeProductDraftBatch(rows: readonly ProductDraftBatchRowView[]) {
  const resume = productDraftBatchResumeEligibility(rows);
  const created = rows.filter((row) => row.productId).map((row) => ({ id: row.productId!, name: row.productName, readiness: typeof row.readinessResult?.status === "string" ? row.readinessResult.status : "unknown" }));
  const readiness = created.reduce<Record<string, number>>((total, product) => ({ ...total, [product.readiness]: (total[product.readiness] ?? 0) + 1 }), {});
  return { ...resume, includedCount: rows.length, skippedCount: rows.filter((row) => row.executionState === "skipped" || row.executionState === "excluded").length, created, readiness, failures: rows.filter((row) => row.executionState === "failed_retryable" || row.executionState === "failed_terminal").map((row) => ({ rowNumber: row.sourceRowNumber, productName: row.productName, code: row.lastErrorCode, message: row.lastErrorMessage, retryable: row.retryable })) };
}

export type BatchReference = { id: string; label: string; conversationId: string | null; executionStatus: string; createdAt: Date };
export function resolveProductDraftBatchReference(batches: readonly BatchReference[], input: { explicitId?: string; label?: string; conversationId?: string; intent?: "last" | "completed" | "failed" | "incomplete" | "retryable" }): { kind: "resolved"; batchId: string } | { kind: "ambiguous" } | { kind: "not_found" } {
  if (input.explicitId) return batches.some((batch) => batch.id === input.explicitId) ? { kind: "resolved", batchId: input.explicitId } : { kind: "not_found" };
  let candidates = [...batches];
  if (input.conversationId) { const scoped = candidates.filter((batch) => batch.conversationId === input.conversationId); if (scoped.length) candidates = scoped; }
  if (input.intent === "completed") candidates = candidates.filter((batch) => batch.executionStatus === "completed");
  if (input.intent === "failed") candidates = candidates.filter((batch) => batch.executionStatus === "failed" || batch.executionStatus === "completed_with_failures");
  if (input.intent === "incomplete" || input.intent === "retryable") candidates = candidates.filter((batch) => batch.executionStatus === "running" || batch.executionStatus === "partially_completed" || batch.executionStatus === "confirmed");
  if (input.label) { const normalized = normalizeProductDraftBatchName(input.label); candidates = candidates.filter((batch) => normalizeProductDraftBatchName(batch.label) === normalized); if (candidates.length > 1) return { kind: "ambiguous" }; }
  return candidates[0] ? { kind: "resolved", batchId: candidates[0].id } : { kind: "not_found" };
}
