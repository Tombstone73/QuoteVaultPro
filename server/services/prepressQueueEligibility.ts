import { and, eq, inArray, notInArray } from "drizzle-orm";

import { orderLineItems, orders } from "@shared/schema";
import {
  isPrepressOwnershipJob,
  resolveActiveProductionOwners,
  type ActiveProductionJob,
} from "./productionOwnership";

export const PREPRESS_QUEUE_WORKFLOW_STATES = ["ready_for_prepress", "in_prepress"] as const;
export const PREPRESS_QUEUE_TERMINAL_ORDER_STATUSES = ["completed", "canceled"] as const;
export const PREPRESS_QUEUE_TERMINAL_ORDER_STATES = ["closed", "canceled", "production_complete"] as const;

export function filterPrepressOwnedLineItemIds(
  lineItemIds: string[],
  activeOwnerByLineItem: Map<string, Pick<ActiveProductionJob, "stationKey" | "stepKey">>,
): string[] {
  return lineItemIds.filter((lineItemId) => isPrepressOwnershipJob(activeOwnerByLineItem.get(lineItemId)));
}

/**
 * Resolves default Prepress queue membership before user-specific view filters.
 * The queue endpoint and sidebar badge share this resolver so stale workflow state
 * without an active Prepress ownership job cannot inflate the navigation count.
 */
export async function resolvePrepressQueueEligibility(
  runner: any,
  args: { organizationId: string; debugLabel?: string },
): Promise<{
  lineItemIds: string[];
  activeOwnerByLineItem: Map<string, ActiveProductionJob>;
}> {
  const candidates = await runner
    .select({ lineItemId: orderLineItems.id })
    .from(orderLineItems)
    .innerJoin(orders, eq(orderLineItems.orderId, orders.id))
    .where(
      and(
        eq(orders.organizationId, args.organizationId),
        inArray(orderLineItems.workflowState, [...PREPRESS_QUEUE_WORKFLOW_STATES] as any),
        notInArray(orders.status, [...PREPRESS_QUEUE_TERMINAL_ORDER_STATUSES] as any),
        notInArray(orders.state, [...PREPRESS_QUEUE_TERMINAL_ORDER_STATES] as any),
      ),
    );

  const candidateIds = candidates.map((candidate: { lineItemId: string }) => candidate.lineItemId);
  const activeOwnerByLineItem = candidateIds.length > 0
    ? await resolveActiveProductionOwners(runner, {
        organizationId: args.organizationId,
        lineItemIds: candidateIds,
        debugLabel: args.debugLabel ?? "prepress-queue-eligibility",
      })
    : new Map<string, ActiveProductionJob>();

  return {
    lineItemIds: filterPrepressOwnedLineItemIds(candidateIds, activeOwnerByLineItem),
    activeOwnerByLineItem,
  };
}
