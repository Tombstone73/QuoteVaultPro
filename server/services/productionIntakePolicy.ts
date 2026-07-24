/**
 * Controls whether order creation is allowed to immediately hand work into
 * production ownership.  The default preserves the legacy application
 * behavior; deferred is intentionally opt-in for workflows that must keep a
 * newly created order out of production until an explicit later action.
 */
export type ProductionIntakePolicy = "default" | "deferred";

const PRE_PRODUCTION_WORKFLOW_STATES = new Set([
  "new",
  "needs_design",
  "in_design",
  "awaiting_proof_approval",
]);

export function isProductionIntakeDeferred(policy?: ProductionIntakePolicy): boolean {
  if (policy !== undefined && policy !== "default" && policy !== "deferred") {
    throw new Error("Unknown production intake policy.");
  }
  return policy === "deferred";
}

export function shouldCreateLegacyProductionJob(args: {
  policy?: ProductionIntakePolicy;
  lineItemRole?: string | null;
  workflowState?: string | null;
}): boolean {
  if (isProductionIntakeDeferred(args.policy)) return false;
  if (args.lineItemRole === "parent") return false;

  return !PRE_PRODUCTION_WORKFLOW_STATES.has(String(args.workflowState ?? "new").trim().toLowerCase());
}

/** Quote conversion normally applies workflow ownership after creating lines. */
export function shouldApplyQuoteConversionProductionIntake(policy?: ProductionIntakePolicy): boolean {
  return !isProductionIntakeDeferred(policy);
}
