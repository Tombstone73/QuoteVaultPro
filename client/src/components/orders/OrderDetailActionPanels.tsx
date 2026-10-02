import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CompleteOrderButton, CompleteProductionButton } from "@/components/StateTransitionButtons";
import { Ban, Check, Copy, MoreHorizontal } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

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
            variant="secondary"
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
          <Check className="w-4 h-4 mr-2" />
          Mark Completed
        </Button>
      )}

      {canCompleteProduction && (
        <CompleteProductionButton orderId={orderId} className="h-10 rounded-md px-3 text-xs font-semibold" />
      )}

      {canCompleteOrder && <CompleteOrderButton orderId={orderId} className="h-10 rounded-md px-3 text-xs font-semibold" />}

      {(canShowCancelOrder || canDuplicateOrder) ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button type="button" variant="outline" size="icon" className="h-10 w-10 rounded-md" aria-label="More order actions">
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-[210px]">
            <DropdownMenuLabel>Order actions</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {canDuplicateOrder ? (
              <DropdownMenuItem
                onSelect={onDuplicateOrder}
                disabled={isDuplicatingOrder}
                title="Creates a new order with the same commercial configuration. Historical operations are not copied."
              >
                <Copy className="mr-2 h-4 w-4" />
                {isDuplicatingOrder ? "Duplicating..." : "Duplicate Order"}
              </DropdownMenuItem>
            ) : null}
            {canShowCancelOrder ? (
              <DropdownMenuItem
                onSelect={onCancelOrder}
                disabled={!canCancelOrder || isCancelingOrder}
                className="text-destructive focus:text-destructive"
                title={!canCancelOrder ? cancelOrderUnavailableReason ?? "Cancellation is unavailable for this order." : undefined}
              >
                <Ban className="mr-2 h-4 w-4" />
                {isCancelingOrder ? "Cancelling..." : "Cancel Order"}
              </DropdownMenuItem>
            ) : null}
            {!canCancelOrder && cancelOrderUnavailableReason ? (
              <p className="px-2 pb-1.5 text-xs leading-snug text-muted-foreground">{cancelOrderUnavailableReason}</p>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
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
