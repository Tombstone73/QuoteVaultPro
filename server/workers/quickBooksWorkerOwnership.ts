/**
 * QuickBooks automation ownership.
 *
 * There are two historical automation paths in this application:
 *
 * - QB_SYNC: `accounting_sync_jobs`, used for legacy bulk pull/push jobs.
 * - QB_QUEUE: the invoice/payment derived outbox worker.
 *
 * They must never both be started by the same deployment. The derived queue
 * is the cutover default because native invoice/payment records enqueue there.
 * The legacy processor can be selected temporarily for a controlled migration,
 * but that is an explicit deployment decision rather than an accidental result
 * of two old enable flags being true.
 *
 * Direct, operator-initiated single-record sync remains available. It uses the
 * same provider adapter but is not an autonomous queue owner.
 */

export type QuickBooksAutomationOwner = "queue" | "legacy_jobs";
export type QuickBooksWorkerName = "QB_SYNC" | "QB_QUEUE";

export const DEFAULT_QUICKBOOKS_AUTOMATION_OWNER: QuickBooksAutomationOwner = "queue";

function normalizedOwner(value: string | undefined): QuickBooksAutomationOwner | undefined {
  const candidate = String(value || "").trim().toLowerCase();
  if (candidate === "queue") return "queue";
  if (candidate === "legacy_jobs") return "legacy_jobs";
  return undefined;
}

/**
 * The deployment-level owner. Invalid or absent configuration fails closed to
 * the V2-derived queue; it never enables both workers as a compatibility
 * fallback.
 */
export function getQuickBooksAutomationOwner(): QuickBooksAutomationOwner {
  return normalizedOwner(process.env.QUICKBOOKS_AUTOMATION_OWNER)
    ?? DEFAULT_QUICKBOOKS_AUTOMATION_OWNER;
}

export function isQuickBooksWorkerOwnedHere(worker: QuickBooksWorkerName): boolean {
  const owner = getQuickBooksAutomationOwner();
  return (owner === "queue" && worker === "QB_QUEUE")
    || (owner === "legacy_jobs" && worker === "QB_SYNC");
}

export function getQuickBooksWorkerOwnershipReason(worker: QuickBooksWorkerName): string {
  const owner = getQuickBooksAutomationOwner();
  if (isQuickBooksWorkerOwnedHere(worker)) {
    return owner === "queue"
      ? "canonical owner: derived invoice/payment queue"
      : "temporary owner: legacy accounting_sync_jobs processor";
  }

  return owner === "queue"
    ? "disabled: QUICKBOOKS_AUTOMATION_OWNER=queue assigns automation to the derived queue"
    : "disabled: QUICKBOOKS_AUTOMATION_OWNER=legacy_jobs assigns automation to accounting_sync_jobs";
}
