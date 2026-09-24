/** V1's operational completion is distinct from final financial closure.
 * `state` retains the existing production_complete lifecycle; `status` is its
 * persisted operational projection once canonical obligations reach zero. */
export const OPERATIONALLY_COMPLETE_STATUS = 'operationally_complete' as const;

export function operationalCompletionOrderPatch(order: { state?: string | null }) {
  if (order.state === 'closed') return {};
  return {
    state: 'production_complete' as const,
    status: OPERATIONALLY_COMPLETE_STATUS,
    canonicalState: 'completed' as const,
    routingTarget: null,
  };
}
