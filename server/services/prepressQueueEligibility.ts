import { and, eq, inArray, notInArray, or, sql } from "drizzle-orm";

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
        or(inArray(orderLineItems.workflowState, [...PREPRESS_QUEUE_WORKFLOW_STATES] as any),
          and(eq(orderLineItems.workflowState, "awaiting_proof_approval"), eq(orderLineItems.requiresPrepress, true),
            sql`not exists (select 1 from prepress_sessions s where s.organization_id = ${args.organizationId} and s.line_item_id = ${orderLineItems.id} and s.status = 'complete' and s.completed_at >= coalesce((select max(v.created_at) from line_item_proof_versions v where v.organization_id = ${args.organizationId} and (v.line_item_id = ${orderLineItems.id} or exists(select 1 from proof_version_line_items m where m.proof_version_id=v.id and m.line_item_id=${orderLineItems.id}))), 'epoch'::timestamptz))`)),
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
