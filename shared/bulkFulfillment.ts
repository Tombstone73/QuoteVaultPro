import { z } from 'zod';

export const bulkFulfillmentActions = {
  ready: 'Mark Ready', picked_up: 'Mark Picked Up', shipped: 'Mark Shipped',
  delivered: 'Mark Delivered', archive: 'Archive Completed', legacy: 'Reconcile Historical Fulfillment',
} as const;
export const bulkFulfillmentActionSchema = z.enum(['ready', 'picked_up', 'shipped', 'delivered', 'archive', 'legacy']);
export type BulkFulfillmentAction = z.infer<typeof bulkFulfillmentActionSchema>;
export const bulkFulfillmentSelectionSchema = z.array(z.object({
  orderId: z.string().min(1),
  items: z.array(z.object({ orderLineItemId: z.string().min(1), quantity: z.number().int().positive().optional(), shipmentId: z.string().min(1).optional() }).strict()).min(1).max(200).optional(),
}).strict()).min(1).max(200);
export type BulkFulfillmentSelection = z.infer<typeof bulkFulfillmentSelectionSchema>;
export const bulkFulfillmentPreviewSchema = z.object({ action: bulkFulfillmentActionSchema, selection: bulkFulfillmentSelectionSchema }).strict();
export const bulkFulfillmentExecuteSchema = bulkFulfillmentPreviewSchema.extend({
  requestId: z.string().uuid(), previewToken: z.string().length(64), confirmed: z.literal(true),
  legacyConfirmed: z.boolean().optional(), reason: z.string().trim().min(10).max(500),
  effectivePickupDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
}).strict();
export type BulkFulfillmentExecute = z.infer<typeof bulkFulfillmentExecuteSchema>;
export type BulkFulfillmentItem = {
  orderLineItemId: string; label: string; quantity: number; eligible: boolean; requirements: string[]; shipmentId?: string;
};
export type BulkFulfillmentUnit = {
  key: string; orderIds: string[]; orderNumber: string; shipmentId?: string;
  items: Array<BulkFulfillmentItem & { orderId: string }>;
  eligible: boolean; requirements: string[]; historicalPreviewToken?: string;
  shipmentUpdatedAt?: string; readyBefore?: Record<string, number>; deliveredBefore?: Record<string, number>;
};
export type BulkFulfillmentPreview = {
  action: BulkFulfillmentAction; previewToken: string; units: BulkFulfillmentUnit[];
  eligibleCount: number; skippedCount: number; selectedOrderCount: number;
};
export type BulkFulfillmentResult = {
  requestId: string; results: Array<{ key: string; orderIds: string[]; items: Array<{ orderId: string; orderLineItemId: string }>;
    status: 'succeeded' | 'skipped' | 'failed'; message: string; code?: string; replayed?: boolean }>;
};
export type BulkFulfillmentOrderContext = {
  orderId: string; orderNumber: string; fulfillmentType: 'SHIP' | 'PICKUP'; canReconcileLegacy: boolean;
  lines: Array<{ orderLineItemId: string; label: string; orderedQuantity: number; remainingQuantity: number;
    readyQuantity: number; productionCompleteQuantity: number; shippedQuantity: number; pickedUpQuantity: number;
    deliveredQuantity: number; pendingDeliveryQuantity: number; availableQuantity: number; completed?: boolean;
    deliverySources?: Array<{ shipmentId: string; label: string; pendingQuantity: number }> }>;
};
