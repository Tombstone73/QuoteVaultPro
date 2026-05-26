import { z } from "zod";

export const orderCancellationReasonValues = [
  "customer_requested",
  "duplicate_order",
  "pricing_error",
  "artwork_issue",
  "inventory_unavailable",
  "internal_error",
  "test_order",
  "non_payment",
  "other",
] as const;

export const orderCancellationReasonSchema = z.enum(orderCancellationReasonValues);
export type OrderCancellationReason = (typeof orderCancellationReasonValues)[number];

export const orderCancellationReasonLabels: Record<OrderCancellationReason, string> = {
  customer_requested: "Customer requested",
  duplicate_order: "Duplicate order",
  pricing_error: "Pricing error",
  artwork_issue: "Artwork issue",
  inventory_unavailable: "Inventory unavailable",
  internal_error: "Internal error",
  test_order: "Test order",
  non_payment: "Non-payment",
  other: "Other",
};

export const cancelOrderRequestSchema = z.object({
  reason: orderCancellationReasonSchema,
  internalNote: z.string().trim().max(2000).optional().nullable(),
});

export type CancelOrderRequest = z.infer<typeof cancelOrderRequestSchema>;
