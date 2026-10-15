import { effectiveOrderFulfillmentMethod, type CanonicalOrderFulfillmentMethod } from "@shared/orderFulfillmentMethod";

export type FulfillmentMethodChangePlan =
  | { allowed: false; code: string; message: string }
  | { allowed: true; unchanged: boolean; draftIdsToVoid: string[]; shippingCents: number; shippingChargeChanged: boolean };

export function planFulfillmentMethodChange(input: {
  currentMethod: string | null;
  targetMethod: CanonicalOrderFulfillmentMethod;
  shippingCents: number | null;
  draftShipments: Array<{ id: string; orderCount: number }>;
  hasNetTerminalQuantity: boolean;
  fulfillmentStatus: string | null;
  canceled: boolean;
  pickupReady: boolean;
}): FulfillmentMethodChangePlan {
  const current = effectiveOrderFulfillmentMethod(input.currentMethod);
  const previousCharge = Math.max(0, Number(input.shippingCents || 0));
  if (current === input.targetMethod) return { allowed: true, unchanged: true, draftIdsToVoid: [], shippingCents: previousCharge, shippingChargeChanged: false };
  if (input.canceled) return { allowed: false, code: "ORDER_CANCELED", message: "Reopen the canceled Order through its recovery workflow before changing fulfillment method." };
  if (input.hasNetTerminalQuantity || ["shipped", "delivered"].includes(String(input.fulfillmentStatus || "").toLowerCase())) {
    return { allowed: false, code: "FULFILLMENT_METHOD_TERMINAL", message: "Completed fulfillment requires the authorized reversal workflow before changing method." };
  }
  if (input.pickupReady) return { allowed: false, code: "PICKUP_READY", message: "Remove ready-for-pickup status through the supported readiness workflow before changing method." };
  if (input.draftShipments.some(shipment => shipment.orderCount !== 1)) {
    return { allowed: false, code: "COMBINED_DRAFT", message: "This Order is in a combined DRAFT shipment. Review that shared shipment and separate the Orders before changing this method." };
  }
  const shippingCents = input.targetMethod === "pickup" ? 0 : previousCharge;
  return { allowed: true, unchanged: false, draftIdsToVoid: input.draftShipments.map(shipment => shipment.id),
    shippingCents, shippingChargeChanged: shippingCents !== previousCharge };
}

/** Preserve known billing-review responses without exposing unexpected errors. */
export function methodChangeAccountingBlock(error: unknown): { status: 409; code: string; message: string } | null {
  if (!error || typeof error !== "object") return null;
  const candidate = error as { statusCode?: unknown; code?: unknown; message?: unknown };
  if (candidate.statusCode !== 409 ||
    (candidate.code !== "ORDER_INVOICE_SYNC_BLOCKED" && candidate.code !== "ORDER_NOT_EDITABLE")) return null;
  return {
    status: 409,
    code: candidate.code,
    message: typeof candidate.message === "string" && candidate.message.trim()
      ? candidate.message
      : "The linked Invoice needs billing review before changing fulfillment method.",
  };
}
