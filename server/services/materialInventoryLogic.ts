import type { InventoryMovementType, MaterialReorderRequestStatus } from "@shared/materialInventory";

export type InventoryAdjustmentDetailType =
  | "manual_increase"
  | "manual_decrease"
  | "waste"
  | "shrinkage"
  | "job_usage"
  | "purchase_receipt"
  | "manual_set"
  | "manual_add"
  | "manual_subtract"
  | "reorder_receipt";

export type ManualInventoryAdjustmentInput = {
  currentQuantity: number;
  adjustmentMode: "set_quantity" | "add_quantity" | "subtract_quantity";
  quantity: number;
  reason: "damage" | "miscount" | "scrap" | "correction" | "received_outside_reorder" | "other";
  otherReason?: string;
  notes?: string;
};

export type InventoryMovementSnapshot = {
  movementType: InventoryMovementType;
  detailType: InventoryAdjustmentDetailType;
  quantityDelta: number;
  quantityBefore: number;
  quantityAfter: number;
  reason?: string;
  notes?: string;
};

export function buildInventoryMovementSnapshot(args: {
  movementType: InventoryMovementType;
  detailType: InventoryAdjustmentDetailType;
  currentQuantity: number;
  quantityDelta: number;
  reason?: string;
  notes?: string;
}): InventoryMovementSnapshot {
  const quantityAfter = args.currentQuantity + args.quantityDelta;
  if (quantityAfter < 0) {
    throw new Error("Adjustment would make stock negative");
  }

  return {
    movementType: args.movementType,
    detailType: args.detailType,
    quantityDelta: args.quantityDelta,
    quantityBefore: args.currentQuantity,
    quantityAfter,
    reason: args.reason,
    notes: args.notes,
  };
}

export function buildManualInventoryAdjustment(input: ManualInventoryAdjustmentInput): InventoryMovementSnapshot {
  const reason = input.reason === "other" ? input.otherReason?.trim() : input.reason;
  const quantityDelta = input.adjustmentMode === "set_quantity"
    ? input.quantity - input.currentQuantity
    : input.adjustmentMode === "add_quantity"
      ? input.quantity
      : -input.quantity;

  const detailType: InventoryAdjustmentDetailType = input.adjustmentMode === "set_quantity"
    ? "manual_set"
    : input.adjustmentMode === "add_quantity"
      ? "manual_add"
      : "manual_subtract";

  return buildInventoryMovementSnapshot({
    movementType: "adjustment",
    detailType,
    currentQuantity: input.currentQuantity,
    quantityDelta,
    reason,
    notes: input.notes,
  });
}

export function assertNoOpenReorderRequest(existingStatus?: MaterialReorderRequestStatus | null) {
  if (existingStatus === "requested" || existingStatus === "ordered") {
    throw new Error("Open reorder request already exists for this material");
  }
}

export function transitionMaterialReorderRequest(args: {
  currentStatus: MaterialReorderRequestStatus;
  action: "mark_ordered" | "cancel" | "receive";
}) {
  if (args.action === "mark_ordered") {
    if (args.currentStatus !== "requested") {
      throw new Error("Only requested reorder requests can be marked ordered");
    }
    return "ordered" as const;
  }

  if (args.action === "cancel") {
    if (args.currentStatus !== "requested" && args.currentStatus !== "ordered") {
      throw new Error("Only requested or ordered reorder requests can be cancelled");
    }
    return "cancelled" as const;
  }

  if (args.currentStatus !== "requested" && args.currentStatus !== "ordered") {
    throw new Error("Only requested or ordered reorder requests can be received");
  }
  return "received" as const;
}