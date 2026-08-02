export const ACTIVE_PRODUCTION_RUN_STATUSES = [
  "draft",
  "ready_for_production",
  "in_production",
  "partially_completed",
] as const;

export type ActiveProductionRunStatus = (typeof ACTIVE_PRODUCTION_RUN_STATUSES)[number];

type RunLifecycleMember = {
  successfulQuantity?: number | null;
  completedQuantity?: number | null;
  damagedQuantity?: number | null;
  remainingQuantity?: number | null;
  allocatedQuantity?: number | null;
  jobStartedAt?: Date | string | null;
  jobStatus?: string | null;
};

/**
 * A recovery must not claim that a physical run is in progress without both a
 * persisted run start and an active started member job. Legacy recoveries can
 * use an existing job start timestamp; otherwise they return to the existing
 * ready state and require an explicit operator start.
 */
export function resolveCanonicalReopenedRunState(input: {
  status: string;
  startedAt?: Date | string | null;
  members: RunLifecycleMember[];
}): { status: "ready_for_production" | "in_production"; startedAt: Date | string | null; normalized: boolean } {
  if (String(input.status).toLowerCase() !== "in_production") {
    return { status: "ready_for_production", startedAt: input.startedAt ?? null, normalized: false };
  }
  const startedMember = input.members.find((member) =>
    Boolean(member.jobStartedAt) && ["in_progress", "in_production"].includes(String(member.jobStatus || "").toLowerCase()),
  );
  if (input.startedAt && startedMember) {
    return { status: "in_production", startedAt: input.startedAt, normalized: false };
  }
  if (startedMember?.jobStartedAt) {
    return { status: "in_production", startedAt: startedMember.jobStartedAt, normalized: true };
  }
  return { status: "ready_for_production", startedAt: null, normalized: true };
}

export function isActiveProductionRunStatus(status: unknown): status is ActiveProductionRunStatus {
  return ACTIVE_PRODUCTION_RUN_STATUSES.includes(String(status || "").trim().toLowerCase() as ActiveProductionRunStatus);
}

/**
 * A run may suppress a standalone job only while it still has unfinished work.
 * Historical memberships intentionally remain query-visible for traceability.
 */
export function isUnfinishedProductionRunMember(member: {
  allocatedQuantity?: number | null;
  completedQuantity?: number | null;
  successfulQuantity?: number | null;
  damagedQuantity?: number | null;
  remainingQuantity?: number | null;
}): boolean {
  const allocatedQuantity = Math.max(0, Number(member.allocatedQuantity) || 0);
  const completedQuantity = Math.max(Number(member.completedQuantity) || 0, Number(member.successfulQuantity) || 0);
  const damagedQuantity = Math.max(0, Number(member.damagedQuantity) || 0);
  const calculatedRemaining = Math.max(0, allocatedQuantity - completedQuantity - damagedQuantity);
  const persistedRemaining = Math.max(0, Number(member.remainingQuantity) || 0);
  return Math.max(calculatedRemaining, persistedRemaining) > 0;
}
