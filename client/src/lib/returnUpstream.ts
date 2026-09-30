import { apiFetch } from "@/lib/queryClient";
import type { PrepressQueueItem } from "@/hooks/useOrders";

export type ReturnUpstreamDestination = "proofing" | "design";
export type ReturnUpstreamTarget = Pick<PrepressQueueItem,
  "lineItemId" | "orderId" | "workflowState" | "activeOwnerJobId" | "lineItemUpdatedAt" | "isActivelyOwnedByPrepress"
>;

export function canReturnUpstream(target: ReturnUpstreamTarget | null | undefined, isAdminOrOwner: boolean): target is ReturnUpstreamTarget & { activeOwnerJobId: string } {
  return Boolean(isAdminOrOwner && target?.isActivelyOwnedByPrepress && target.activeOwnerJobId &&
    target.lineItemUpdatedAt && (target.workflowState === "ready_for_prepress" || target.workflowState === "in_prepress"));
}

export class ReturnUpstreamError extends Error {
  constructor(public status: number, public code: string | null, message: string) {
    super(message);
  }
}

export async function returnUpstream(target: ReturnUpstreamTarget, destination: ReturnUpstreamDestination, reason: string): Promise<void> {
  const response = await apiFetch(`/api/line-items/${encodeURIComponent(target.lineItemId)}/return-upstream`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      destination,
      reason: reason.trim(),
      expectedWorkflowState: target.workflowState,
      expectedOwnerJobId: target.activeOwnerJobId,
      expectedUpdatedAt: target.lineItemUpdatedAt,
    }),
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new ReturnUpstreamError(response.status, payload?.code ?? null,
      typeof payload?.message === "string" ? payload.message : "Return upstream failed. Refresh and try again.");
  }
}
