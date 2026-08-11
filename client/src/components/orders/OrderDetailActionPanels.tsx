import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CompleteOrderButton, CompleteProductionButton } from "@/components/StateTransitionButtons";
import { Ban, Check } from "lucide-react";

type MaybePromise = void | Promise<void>;

interface OrderDetailPrimaryActionsProps {
  canEditOrder: boolean;
  canShowCancelOrder: boolean;
  canCancelOrder: boolean;
  canMarkCompleted: boolean;
  canCompleteProduction: boolean;
  canCompleteOrder: boolean;
  orderId: string;
  isDirty: boolean;
  isSavingOrder: boolean;
  isUpdatingOrder: boolean;
  isTransitioningStatus: boolean;
  isCancelingOrder: boolean;
  hasDirtyLineItem: boolean;
  cancelOrderUnavailableReason?: string | null;
  onSaveOrder: () => MaybePromise;
  onSaveAndRoute: () => MaybePromise;
  onDiscardChanges: () => MaybePromise;
  onCancelOrder: () => void;
  onMarkCompleted: () => void;
}

export function OrderDetailPrimaryActions({
  canEditOrder,
  canShowCancelOrder,
  canCancelOrder,
  canMarkCompleted,
  canCompleteProduction,
  canCompleteOrder,
  orderId,
  isDirty,
  isSavingOrder,
  isUpdatingOrder,
  isTransitioningStatus,
  isCancelingOrder,
  hasDirtyLineItem,
  cancelOrderUnavailableReason,
  onSaveOrder,
  onSaveAndRoute,
  onDiscardChanges,
  onCancelOrder,
  onMarkCompleted,
}: OrderDetailPrimaryActionsProps) {
  return (
    <>
      {canEditOrder && (
        <>
          <Button
            variant="default"
            size="sm"
            onClick={() => void onSaveOrder()}
            disabled={!isDirty || isUpdatingOrder || isSavingOrder}
            className="rounded-titan-md"
            title={hasDirtyLineItem ? "Saves open line item changes too" : undefined}
          >
            {isUpdatingOrder || isSavingOrder ? "Saving..." : "Save Order"}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => void onSaveAndRoute()}
            disabled={isUpdatingOrder || isSavingOrder}
            className="rounded-titan-md"
            title="Saves changes, then moves eligible line items to Design, Proofing, or Prepress as needed."
          >
            {isUpdatingOrder || isSavingOrder ? "Saving..." : "Save & Route Jobs"}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void onDiscardChanges()}
            disabled={!isDirty || isUpdatingOrder || isSavingOrder}
            className="rounded-titan-md"
          >
            Discard changes
          </Button>
        </>
      )}

      {canShowCancelOrder && (
        <div className="flex max-w-[260px] flex-col items-start gap-1">
          <Button
            variant="outline"
            size="sm"
            onClick={onCancelOrder}
            disabled={!canCancelOrder || isCancelingOrder}
            className="rounded-titan-md border-destructive/60 text-destructive hover:bg-destructive/10"
            title={!canCancelOrder ? cancelOrderUnavailableReason ?? "Cancellation is unavailable for this order." : undefined}
          >
            <Ban className="w-4 h-4 mr-2" />
            {isCancelingOrder ? "Cancelling..." : "Cancel Order"}
          </Button>
          {!canCancelOrder && cancelOrderUnavailableReason ? (
            <span className="text-xs leading-snug text-muted-foreground">{cancelOrderUnavailableReason}</span>
          ) : null}
        </div>
      )}

      {canMarkCompleted && (
        <Button
          variant="default"
          size="sm"
          onClick={onMarkCompleted}
          disabled={isTransitioningStatus}
          className="rounded-titan-md bg-green-600 hover:bg-green-700 text-white"
        >
          <Check className="w-4 h-4 mr-2" />
          Mark Completed
        </Button>
      )}

      {canCompleteProduction && (
        <CompleteProductionButton orderId={orderId} />
      )}

      {canCompleteOrder && <CompleteOrderButton orderId={orderId} />}
    </>
  );
}

interface OrderDetailSecondaryActionsProps {
  canManageProofPolicy: boolean;
  proofBypassed: boolean;
  proofBypassReason: string;
  isUpdatingProofPolicy: boolean;
  onProofBypassReasonChange: (value: string) => void;
  onBypassProof: () => void;
  onRequireProofDefaults: () => void;
}

export function hasOrderDetailSecondaryActions({
  canManageProofPolicy,
  proofBypassed,
}: Pick<OrderDetailSecondaryActionsProps, "canManageProofPolicy" | "proofBypassed">) {
  return canManageProofPolicy || proofBypassed;
}

export function OrderDetailSecondaryActions({
  canManageProofPolicy,
  proofBypassed,
  proofBypassReason,
  isUpdatingProofPolicy,
  onProofBypassReasonChange,
  onBypassProof,
  onRequireProofDefaults,
}: OrderDetailSecondaryActionsProps) {
  return (
    <div className="space-y-3">
      {proofBypassed ? (
        <Badge variant="outline" className="border-amber-500/50 bg-amber-500/10 text-amber-700">
          Proof Bypassed
        </Badge>
      ) : null}

      {canManageProofPolicy && (
        proofBypassed ? (
          <Button
            variant="outline"
            size="sm"
            onClick={onRequireProofDefaults}
            disabled={isUpdatingProofPolicy}
            className="w-full justify-start"
          >
            Require Proof Defaults
          </Button>
        ) : (
          <div className="flex items-center gap-2">
            <Input
              value={proofBypassReason}
              onChange={(event) => onProofBypassReasonChange(event.target.value)}
              placeholder="Bypass reason"
              className="h-9 min-w-0 flex-1"
            />
            <Button
              variant="outline"
              size="sm"
              onClick={onBypassProof}
              disabled={isUpdatingProofPolicy}
            >
              Bypass Proof
            </Button>
          </div>
        )
      )}
    </div>
  );
}
