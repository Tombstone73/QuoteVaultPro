import { z } from 'zod';

/** Canonical route identity for an order-centric fulfillment workspace. */
export const fulfillmentOrderIdSchema = z.string().uuid('Invalid order ID');

const queryBooleanSchema = z.preprocess((value) => {
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true' || normalized === '1' || normalized === 'yes' || normalized === 'on') return true;
    if (normalized === 'false' || normalized === '0' || normalized === 'no' || normalized === 'off' || normalized === '') return false;
  }
  return value;
}, z.boolean().optional().default(false));

export const listQueueQuerySchema = z.object({
  type: z.enum(['all', 'ship', 'pickup']).optional().default('all'),
  status: z.string().optional().default('all'),
  showArchived: queryBooleanSchema,
  overdueOnly: queryBooleanSchema,
  search: z.string().optional().default(''),
  printer: z.string().trim().max(200).optional().default('all'),
  page: z.coerce.number().int().positive().optional().default(1),
  pageSize: z.coerce.number().int().positive().max(200).optional().default(50),
  sortBy: z.enum(['orderNumber', 'customer', 'fulfillmentType', 'status', 'dueDate', 'createdAt', 'readyQuantity', 'destination']).optional().default('createdAt'),
  sortDirection: z.enum(['asc', 'desc']).optional().default('asc'),
});

export const createShipmentSchema = z.object({
  scope: z.enum(['SINGLE_ORDER', 'MULTI_ORDER']),
  orderIds: z.array(z.string().min(1)).min(1),
  primaryOrderId: z.string().min(1).optional(),
});

export const shipmentItemInputSchema = z.object({
  orderId: z.string().min(1),
  orderLineItemId: z.string().min(1),
  quantity: z.coerce.number().int().positive(),
  packageId: z.string().min(1).optional().nullable(),
});

export const shipmentPackageInputSchema = z.object({
  id: z.string().min(1).optional(),
  ordinal: z.coerce.number().int().positive().optional(),
  weightLbs: z.coerce.number().min(0).optional().nullable(),
  dims: z.object({
    length: z.coerce.number().min(0).optional().nullable(),
    width: z.coerce.number().min(0).optional().nullable(),
    height: z.coerce.number().min(0).optional().nullable(),
  }).optional(),
  notes: z.string().trim().max(2000).optional().nullable(),
});

export const patchShipmentSchema = z.object({
  carrier: z.string().trim().min(1).optional().nullable(),
  serviceLevel: z.string().trim().min(1).optional().nullable(),
  trackingNumber: z.string().trim().min(1).optional().nullable(),
  shipDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Ship date must use YYYY-MM-DD').optional().nullable(),
  boxCount: z.coerce.number().int().min(0).optional().nullable(),
  weight: z.coerce.number().min(0).optional().nullable(),
  dims: z.object({
    length: z.coerce.number().min(0).optional().nullable(),
    width: z.coerce.number().min(0).optional().nullable(),
    height: z.coerce.number().min(0).optional().nullable(),
  }).optional(),
  internalNotes: z.string().optional().nullable(),
  shipmentItems: z.array(shipmentItemInputSchema).optional(),
  packages: z.array(shipmentPackageInputSchema.extend({ id: z.string().min(1) })).optional(),
});

export const pickupReadySchema = z.object({
  stagingLocation: z.string().optional().nullable(),
  pickupNotes: z.string().optional().nullable(),
  contactName: z.string().optional().nullable(),
  contactEmail: z.string().email().optional().nullable(),
  contactPhone: z.string().optional().nullable(),
  overrideProductionComplete: z.coerce.boolean().optional().default(false),
});

export const pickupHandoffSchema = z.object({
  items: z.array(z.object({
    orderLineItemId: z.string().min(1),
    quantity: z.coerce.number().int().positive(),
  })).min(1),
  notes: z.string().trim().max(2000).optional().nullable(),
});

export const fulfillmentNoteSchema = z.object({
  note: z.string().trim().min(1).max(2000),
});

export const fulfillmentChecklistItemSchema = z.object({
  checked: z.boolean().optional(),
  verified: z.boolean().optional(),
  fulfilledQuantity: z.coerce.number().int().min(0).optional(),
  notes: z.string().trim().max(2000).optional().nullable(),
}).superRefine((value, ctx) => {
  if (typeof value.checked !== 'boolean' && typeof value.verified !== 'boolean' && value.fulfilledQuantity === undefined) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'checked is required',
      path: ['checked'],
    });
  }
}).transform((value) => ({
  checked: value.checked ?? value.verified ?? false,
  fulfilledQuantity: value.fulfilledQuantity,
  notes: value.notes ?? null,
}));

export const fulfillmentUnreadySchema = z.object({
  reason: z.string().trim().min(1, "Reason is required").max(2000),
});

export type ListQueueQueryInput = z.infer<typeof listQueueQuerySchema>;
export type CreateShipmentInput = z.infer<typeof createShipmentSchema>;
export type PatchShipmentInput = z.infer<typeof patchShipmentSchema>;
export type PickupReadyInput = z.infer<typeof pickupReadySchema>;
export type PickupHandoffInput = z.infer<typeof pickupHandoffSchema>;
export type FulfillmentNoteInput = z.infer<typeof fulfillmentNoteSchema>;
export type FulfillmentChecklistItemInput = z.infer<typeof fulfillmentChecklistItemSchema>;
export type FulfillmentUnreadyInput = z.infer<typeof fulfillmentUnreadySchema>;
