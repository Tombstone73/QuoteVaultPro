import { z } from 'zod';

/** Business fields accepted by the staff Quote model. IDs must come from
 * tenant-scoped reads; no model-supplied price or tax snapshot is trusted. */
export const quoteCreateRequestSchema = z.object({
  customerId: z.string().min(1).max(128),
  contactId: z.string().min(1).max(128).nullable().optional(),
  poReference: z.string().trim().min(1).max(100).optional(),
  label: z.string().trim().max(255).nullable().optional(),
  customerNotes: z.string().max(4000).nullable().optional(),
  requestedDueDate: z.string().datetime({ offset: true }).nullable().optional(),
  validUntil: z.string().datetime({ offset: true }).nullable().optional(),
  shippingMethod: z.enum(["pickup", "ship", "deliver"]).nullable().optional(),
  shippingInstructions: z.string().max(2000).nullable().optional(),
  shippingCents: z.number().int().min(0).max(100_000_000).nullable().optional(),
  discountAmountCents: z.number().int().min(0).max(100_000_000).optional(),
  lines: z.array(z.object({
    productId: z.string().min(1).max(128),
    quantity: z.number().int().min(1).max(100_000),
    width: z.number().positive().max(10_000),
    height: z.number().positive().max(10_000),
    optionSelections: z.record(z.union([z.string(), z.number(), z.boolean(), z.array(z.string())])).default({}),
    description: z.string().max(2000).nullable().optional(),
    productionNotes: z.string().max(2000).nullable().optional(),
    overridePriceCents: z.number().int().min(0).max(100_000_000).optional(),
    overrideReason: z.string().trim().min(1).max(500).optional(),
  }).strict().refine((line) => line.overridePriceCents === undefined || Boolean(line.overrideReason), "A manual price requires a reason.")).min(1).max(100),
}).strict();
export type QuoteCreateRequest = z.infer<typeof quoteCreateRequestSchema>;

export const createInputSchema = {
  type: "object", additionalProperties: false, required: ["customerId", "lines"],
  properties: {
    customerId: { type: "string", description: "Exact customer ID from a tenant-scoped search." },
    contactId: { type: ["string", "null"], description: "Contact ID for that customer, when selected." },
    poReference: { type: "string", description: "Customer PO reference; stored in the Quote label because Quotes have no dedicated PO field." },
    label: { type: ["string", "null"] }, customerNotes: { type: ["string", "null"] },
    requestedDueDate: { type: ["string", "null"], format: "date-time" }, validUntil: { type: ["string", "null"], format: "date-time" },
    shippingMethod: { enum: ["pickup", "ship", "deliver", null] }, shippingInstructions: { type: ["string", "null"], description: "Preserve customer pickup or delivery instructions, including arrival times from a PO; requestedDueDate remains a calendar date." }, shippingCents: { type: ["integer", "null"] }, discountAmountCents: { type: "integer" },
    lines: { type: "array", minItems: 1, maxItems: 100, items: { type: "object", additionalProperties: false,
      required: ["productId", "quantity", "width", "height"], properties: {
        productId: { type: "string" }, quantity: { type: "integer", minimum: 1 }, width: { type: "number", exclusiveMinimum: 0, description: "Finished width in inches; use 1 for quantity-only products." },
        height: { type: "number", exclusiveMinimum: 0, description: "Finished height in inches; use 1 for quantity-only products." },
        optionSelections: { type: "object", description: "PBV2 selection keys and values returned by quotes.inspect_configuration." },
        description: { type: ["string", "null"] }, productionNotes: { type: ["string", "null"] },
        overridePriceCents: { type: "integer", minimum: 0, description: "Optional staff manual TOTAL price for this line, in cents." },
        overrideReason: { type: "string", description: "Required when overriding the calculated line total." },
      } } },
  },
} as const;
