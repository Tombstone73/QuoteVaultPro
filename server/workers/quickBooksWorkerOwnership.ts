/**
 * QuickBooks automation ownership.
 *
 * There are two historical automation paths in this application:
 *
 * - QB_SYNC: `accounting_sync_jobs`, used for legacy bulk pull/push jobs.
 * - QB_QUEUE: the retired legacy invoice/payment table scanner.
 *
 * Neither legacy worker owns `queue`. That value is reserved for the V2
 * deployment's `v2_quickbooks_sync_jobs` worker. `legacy_jobs` is retained
 * solely for a controlled compatibility/import deployment.
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
  return owner === "legacy_jobs" && worker === "QB_SYNC";
}

export function getQuickBooksWorkerOwnershipReason(worker: QuickBooksWorkerName): string {
  const owner = getQuickBooksAutomationOwner();
  if (isQuickBooksWorkerOwnedHere(worker)) {
    return "temporary owner: legacy accounting_sync_jobs processor";
  }

  return owner === "queue"
    ? "disabled: QUICKBOOKS_AUTOMATION_OWNER=queue reserves automation for the V2 Billing queue"
    : "disabled: this legacy worker is not the selected accounting_sync_jobs processor";
}
