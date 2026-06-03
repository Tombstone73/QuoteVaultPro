import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CompleteProductionButton } from "@/components/StateTransitionButtons";
import { Ban, Check } from "lucide-react";

type MaybePromise = void | Promise<void>;

interface OrderDetailPrimaryActionsProps {
  canEditOrder: boolean;
  canMarkCompleted: boolean;
  canCompleteProduction: boolean;
  orderId: string;
  isDirty: boolean;
  isSavingOrder: boolean;
  isUpdatingOrder: boolean;
  isTransitioningStatus: boolean;
  hasDirtyLineItem: boolean;
  onSaveOrder: () => MaybePromise;
  onDiscardChanges: () => MaybePromise;
  onMarkCompleted: () => void;
}

export function OrderDetailPrimaryActions({
  canEditOrder,
  canMarkCompleted,
  canCompleteProduction,
  orderId,
  isDirty,
  isSavingOrder,
  isUpdatingOrder,
  isTransitioningStatus,
  hasDirtyLineItem,
  onSaveOrder,
  onDiscardChanges,
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
    </>
  );
}

interface OrderDetailSecondaryActionsProps {
  canCancelOrder: boolean;
  canManageProofPolicy: boolean;
  proofBypassed: boolean;
  proofBypassReason: string;
  isCancelingOrder: boolean;
  isUpdatingProofPolicy: boolean;
  onCancelOrder: () => void;
  onProofBypassReasonChange: (value: string) => void;
  onBypassProof: () => void;
  onRequireProofDefaults: () => void;
}

export function hasOrderDetailSecondaryActions({
  canCancelOrder,
  canManageProofPolicy,
  proofBypassed,
}: Pick<OrderDetailSecondaryActionsProps, "canCancelOrder" | "canManageProofPolicy" | "proofBypassed">) {
  return canCancelOrder || canManageProofPolicy || proofBypassed;
}

export function OrderDetailSecondaryActions({
  canCancelOrder,
  canManageProofPolicy,
  proofBypassed,
  proofBypassReason,
  isCancelingOrder,
  isUpdatingProofPolicy,
  onCancelOrder,
  onProofBypassReasonChange,
  onBypassProof,
  onRequireProofDefaults,
}: OrderDetailSecondaryActionsProps) {
  return (
    <div className="space-y-3">
      {canCancelOrder && (
        <Button
          variant="outline"
          size="sm"
          onClick={onCancelOrder}
          disabled={isCancelingOrder}
          className="w-full justify-start rounded-titan-md border-destructive/60 text-destructive hover:bg-destructive/10"
        >
          <Ban className="w-4 h-4 mr-2" />
          Cancel Order
        </Button>
      )}

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
