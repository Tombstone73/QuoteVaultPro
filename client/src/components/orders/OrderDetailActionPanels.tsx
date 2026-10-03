import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CompleteOrderButton, CompleteProductionButton } from "@/components/StateTransitionButtons";
import { ORDER_DETAIL_SECONDARY_ACTION_CLASS } from "@/components/orders/orderDetailActionStyles";

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
  canDuplicateOrder: boolean;
  isDuplicatingOrder: boolean;
  hasDirtyLineItem: boolean;
  cancelOrderUnavailableReason?: string | null;
  onSaveOrder: () => MaybePromise;
  onSaveAndRoute: () => MaybePromise;
  onDiscardChanges: () => MaybePromise;
  onCancelOrder: () => void;
  onDuplicateOrder: () => void;
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
  canDuplicateOrder,
  isDuplicatingOrder,
  hasDirtyLineItem,
  cancelOrderUnavailableReason,
  onSaveOrder,
  onSaveAndRoute,
  onDiscardChanges,
  onCancelOrder,
  onDuplicateOrder,
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
            className="h-10 rounded-md px-3 text-xs font-semibold"
            title={hasDirtyLineItem ? "Saves open line item changes too" : undefined}
          >
            {isUpdatingOrder || isSavingOrder ? "Saving..." : "Save Order"}
          </Button>
          <Button
            variant="default"
            size="sm"
            onClick={() => void onSaveAndRoute()}
            disabled={isUpdatingOrder || isSavingOrder}
            className="h-10 rounded-md px-3 text-xs font-semibold"
            title="Saves changes, then moves eligible line items to Design, Proofing, or Prepress as needed."
          >
            {isUpdatingOrder || isSavingOrder ? "Saving..." : "Save & Route Jobs"}
          </Button>
          {isDirty ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void onDiscardChanges()}
              disabled={isUpdatingOrder || isSavingOrder}
              className="h-10 rounded-md px-3 text-xs"
            >
              Discard
            </Button>
          ) : null}
        </>
      )}

      {canMarkCompleted && (
        <Button
          variant="default"
          size="sm"
          onClick={onMarkCompleted}
          disabled={isTransitioningStatus}
            className="h-10 rounded-md bg-green-600 px-3 text-xs font-semibold text-white hover:bg-green-700"
        >
          Mark Completed
        </Button>
      )}

      {canCompleteProduction && (
        <CompleteProductionButton orderId={orderId} showIcon={false} className="h-10 rounded-md px-3 text-xs font-semibold" />
      )}

      {canCompleteOrder && <CompleteOrderButton orderId={orderId} showIcon={false} className="h-10 rounded-md px-3 text-xs font-semibold" />}

      {canDuplicateOrder ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className={ORDER_DETAIL_SECONDARY_ACTION_CLASS}
          onClick={onDuplicateOrder}
          disabled={isDuplicatingOrder}
          title="Creates a new order with the same commercial configuration. Historical operations are not copied."
        >
          {isDuplicatingOrder ? "Duplicating..." : "Duplicate Order"}
        </Button>
      ) : null}

      {canShowCancelOrder ? (
        !canCancelOrder ? (
          <span
            tabIndex={0}
            title={cancelOrderUnavailableReason ?? "Cancellation is unavailable for this order."}
            className="inline-flex cursor-not-allowed"
          >
            <Button
              type="button"
              variant="destructive"
              size="sm"
              className="h-10 rounded-md px-3 text-xs font-semibold"
              onClick={onCancelOrder}
              disabled
            >
              Cancel Order
            </Button>
          </span>
        ) : (
        <Button
          type="button"
          variant="destructive"
          size="sm"
          className="h-10 rounded-md px-3 text-xs font-semibold"
          onClick={onCancelOrder}
          disabled={isCancelingOrder}
        >
          {isCancelingOrder ? "Cancelling..." : "Cancel Order"}
        </Button>
        )
      ) : null}
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
