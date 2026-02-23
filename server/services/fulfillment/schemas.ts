import { z } from 'zod';

export const listQueueQuerySchema = z.object({
  type: z.enum(['all', 'ship', 'pickup']).optional().default('all'),
  status: z.string().optional().default('all'),
  showArchived: z.coerce.boolean().optional().default(false),
  overdueOnly: z.coerce.boolean().optional().default(false),
  search: z.string().optional().default(''),
  page: z.coerce.number().int().positive().optional().default(1),
  pageSize: z.coerce.number().int().positive().max(200).optional().default(50),
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
});

export const patchShipmentSchema = z.object({
  carrier: z.string().trim().min(1).optional().nullable(),
  serviceLevel: z.string().trim().min(1).optional().nullable(),
  trackingNumber: z.string().trim().min(1).optional().nullable(),
  shipDate: z.string().optional().nullable(),
  boxCount: z.coerce.number().int().min(0).optional().nullable(),
  weight: z.coerce.number().min(0).optional().nullable(),
  dims: z.object({
    length: z.coerce.number().min(0).optional().nullable(),
    width: z.coerce.number().min(0).optional().nullable(),
    height: z.coerce.number().min(0).optional().nullable(),
  }).optional(),
  internalNotes: z.string().optional().nullable(),
  shipmentItems: z.array(shipmentItemInputSchema).optional(),
});

export const pickupReadySchema = z.object({
  stagingLocation: z.string().optional().nullable(),
  pickupNotes: z.string().optional().nullable(),
  contactName: z.string().optional().nullable(),
  contactEmail: z.string().email().optional().nullable(),
  contactPhone: z.string().optional().nullable(),
  overrideProductionComplete: z.coerce.boolean().optional().default(false),
});

export type ListQueueQueryInput = z.infer<typeof listQueueQuerySchema>;
export type CreateShipmentInput = z.infer<typeof createShipmentSchema>;
export type PatchShipmentInput = z.infer<typeof patchShipmentSchema>;
export type PickupReadyInput = z.infer<typeof pickupReadySchema>;
