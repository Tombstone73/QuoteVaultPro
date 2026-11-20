import { canOpenProofingFromOrderStatus, type OrderProofStatus } from "./orderProofStatus";

/** The fields consumed by the native Order Detail Operational Summary, not a
 * production/fulfillment eligibility command or a replacement workflow state.
 * Callers must obtain these fields through their authorized native Order read.
 */
export type OrderReadinessLightsInput = {
  lineItems?: readonly {
    status?: string | null;
    workflowState?: string | null;
    product?: {
      requiresProductionJob?: boolean | null;
      workflowIntent?: string | null;
    } | null;
  }[] | null;
  proofStatus?: OrderProofStatus | null;
  proofStatusLabel?: string | null;
  proofLineItemId?: string | null;
};

/** Presentation-only extraction of the existing native UI. In particular, zero
 * action-needed lines means "No immediate action needed", NOT "ready to ship".
 * Preserve the native status filter, workflow fallback, and server proof label.
 * Missing proof data retains the existing UI fallback; it is not an assertion
 * that an authoritative proof read succeeded.
 */
function activeLines<T extends NonNullable<OrderReadinessLightsInput['lineItems']>[number]>(lines: readonly T[]) {
  return lines.filter((lineItem) =>
    !["canceled", "cancelled", "void", "voided"].includes(String(lineItem?.status ?? "").trim().toLowerCase()),
  );
}

function actionState(line: NonNullable<OrderReadinessLightsInput['lineItems']>[number]) {
  const state = String(line?.workflowState || line?.status || "new").trim().toLowerCase();
  return ["new", "needs_design", "ready_for_prepress", "ready_for_production", "on_hold"].includes(state) ? state : null;
}

/** Identify the rows behind the native action count, without inferring a cause. */
export function orderActionNeededLines<T extends NonNullable<OrderReadinessLightsInput['lineItems']>[number]>(lines: readonly T[]) {
  return activeLines(lines).flatMap(line => {
    const state = actionState(line);
    return state ? [{ line, state }] : [];
  });
}

export function buildOrderReadinessLights(input: OrderReadinessLightsInput) {
  const lineItems = activeLines(input.lineItems ?? []);
  const proofStatus = input.proofStatus ?? "no_proof_required";

  return {
    totalItems: lineItems.length,
    productionRequiredCount: lineItems.filter((lineItem) =>
      lineItem?.product?.requiresProductionJob === true && lineItem.product.workflowIntent !== "service_fee",
    ).length,
    actionNeededCount: lineItems.filter(actionState).length,
    inProgressCount: lineItems.filter((lineItem) => {
      const workflowState = String(lineItem?.workflowState || lineItem?.status || "").trim().toLowerCase();
      return ["in_design", "in_prepress", "in_production"].includes(workflowState);
    }).length,
    proof: {
      status: proofStatus,
      label: input.proofStatusLabel ?? "No Proof Needed",
      lineItemId: input.proofLineItemId ?? null,
      openProofingAvailable: Boolean(input.proofLineItemId) && canOpenProofingFromOrderStatus(proofStatus),
    },
  };
}

export type OrderReadinessLights = ReturnType<typeof buildOrderReadinessLights>;
