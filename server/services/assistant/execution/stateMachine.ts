import { ExecutionPlanError, type ExecutionPlanState } from "./types";

export const validExecutionPlanTransitions: Readonly<Record<ExecutionPlanState, readonly ExecutionPlanState[]>> = {
  draft: ["resolving", "cancelled", "expired"],
  resolving: ["awaiting_input", "preview_ready", "failed", "cancelled", "expired"],
  awaiting_input: ["resolving", "cancelled", "expired"],
  preview_ready: ["awaiting_confirmation", "cancelled", "expired", "invalidated"],
  awaiting_confirmation: ["confirmed", "cancelled", "expired", "invalidated"],
  confirmed: ["revalidating", "cancelled", "expired", "invalidated"],
  revalidating: ["executing", "invalidated", "failed"],
  executing: ["succeeded", "partially_failed", "failed"],
  succeeded: [],
  partially_failed: [],
  failed: [],
  cancelled: [],
  expired: [],
  invalidated: [],
};

export function canTransition(from: ExecutionPlanState, to: ExecutionPlanState): boolean {
  return validExecutionPlanTransitions[from].includes(to);
}

export function assertTransition(from: ExecutionPlanState, to: ExecutionPlanState): void {
  if (!canTransition(from, to)) {
    throw new ExecutionPlanError("INVALID_PLAN_TRANSITION", `Cannot transition execution plan from ${from} to ${to}.`);
  }
}

export function isTerminalExecutionPlanState(state: ExecutionPlanState): boolean {
  return validExecutionPlanTransitions[state].length === 0;
}

export function isExpired(plan: { expiresAt: Date }, now: Date): boolean {
  return plan.expiresAt.getTime() <= now.getTime();
}
