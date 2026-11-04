import { z } from "zod";
import { insertOrderSchema, insertOrderLineItemSchema } from "@shared/schema";

// An allowlist over the staff contracts, not a second Order model. Prices,
// lifecycle state, tenant, snapshots and approvals are always server-owned.
export const orderPreparationHeaderSchema = insertOrderSchema.pick({
  customerId: true, contactId: true, label: true, poNumber: true,
  notesInternal: true, priority: true, dueDate: true, deadlineJson: true,
  shippingMethod: true, shippingMode: true, shippingInstructions: true,
  shipToName: true, shipToCompany: true, shipToEmail: true, shipToPhone: true,
  shipToAddress1: true, shipToAddress2: true, shipToCity: true,
  shipToState: true, shipToPostalCode: true, shipToCountry: true,
  discount: true,
}).partial().strict();

export const orderPreparationLineSchema = insertOrderLineItemSchema.pick({
  productId: true, quantity: true, width: true, height: true,
  description: true, productionNotes: true, overridePriceCents: true,
}).partial().extend({
  optionSelections: z.record(z.union([z.string(), z.number(), z.boolean(), z.array(z.string())])).optional(),
  optionsText: z.string().max(2000).optional(),
  overrideReason: z.string().trim().min(1).max(500).optional(),
}).strict();

export const orderPreparationRequestSchema = z.object({
  sessionId: z.string().min(1).max(128).optional(),
  expectedIntakeVersion: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  header: orderPreparationHeaderSchema.optional(),
  customerPoTotalCents: z.number().int().nonnegative().max(100_000_000).nullable().optional(),
  lines: z.object({
    add: z.array(orderPreparationLineSchema).max(100).optional(),
    update: z.array(z.object({ index: z.number().int().min(0).max(99), changes: orderPreparationLineSchema }).strict()).max(100).optional(),
    remove: z.array(z.number().int().min(0).max(99)).max(100).optional(),
  }).strict().optional(),
}).strict().refine(value => Boolean(value.sessionId) === Boolean(value.expectedIntakeVersion),
  "Corrections require both sessionId and the current expectedIntakeVersion from orders.inspect_preparation.");

export type OrderPreparationRequest = z.infer<typeof orderPreparationRequestSchema>;
export type OrderPreparationHeader = z.infer<typeof orderPreparationHeaderSchema>;
export type OrderPreparationLine = z.infer<typeof orderPreparationLineSchema>;
