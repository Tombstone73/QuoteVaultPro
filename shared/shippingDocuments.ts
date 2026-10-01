import { z } from "zod";

const partyText = z.string().trim().max(250).nullable();
export const shippingPartySchema = z.object({
  name: partyText,
  company: partyText,
  address1: partyText,
  address2: partyText,
  city: partyText,
  state: partyText,
  postalCode: partyText,
  country: partyText,
  phone: partyText,
  email: z.string().trim().max(320).nullable(),
}).strict();
export type ShippingParty = z.infer<typeof shippingPartySchema>;

export const shipmentShippingContextSchema = z.object({
  version: z.literal(1),
  source: z.enum(["order", "legacy_order", "staff"]),
  sourceOrderId: z.string().min(1).nullable(),
  destination: shippingPartySchema,
  blindShipping: z.boolean(),
  blindSender: shippingPartySchema.nullable(),
  // Absent on existing drafts: their saved alternate sender remains custom.
  blindSenderSource: z.enum(["ordering_customer", "custom"]).optional(),
}).strict();
export type ShipmentShippingContext = z.infer<typeof shipmentShippingContextSchema>;

export const shippingDocumentTypes = ["packing_slip", "shipment_manifest", "package_ticket"] as const;
export const shippingDocumentTypeSchema = z.enum(shippingDocumentTypes);
export type ShippingDocumentType = z.infer<typeof shippingDocumentTypeSchema>;

export type ShippingDocumentLine = {
  orderId: string;
  orderLineItemId: string;
  description: string;
  quantity: number;
  size: string | null;
  material: string | null;
};

/** One immutable source; customer-facing renderers whitelist their fields. */
export type ShippingDocumentSource = {
  version: 1;
  basis: "draft" | "shipped";
  capturedAt: string;
  organizationId: string;
  shipmentId: string;
  shipmentReference: string;
  shipDate: string | null;
  carrier: string | null;
  serviceLevel: string | null;
  trackingNumber: string | null;
  destination: ShippingParty;
  blindShipping: boolean;
  sender: ShippingParty;
  orders: Array<{ id: string; orderNumber: string; customerId: string | null; customerName: string | null; poNumber: string | null }>;
  lines: ShippingDocumentLine[];
  packages: Array<{
    id: string;
    ordinal: number;
    packageReference: string;
    weightLbs: string | null;
    dimLengthIn: string | null;
    dimWidthIn: string | null;
    dimHeightIn: string | null;
    internalNotes: string | null;
    lines: ShippingDocumentLine[];
  }>;
  internalNotes: string | null;
};

const shippingDocumentLineSchema = z.object({
  orderId: z.string().min(1),
  orderLineItemId: z.string().min(1),
  description: z.string(),
  quantity: z.number().int().positive(),
  size: z.string().nullable(),
  material: z.string().nullable(),
}).strict();

export const shippingDocumentSourceSchema: z.ZodType<ShippingDocumentSource> = z.object({
  version: z.literal(1),
  basis: z.enum(["draft", "shipped"]),
  capturedAt: z.string().datetime(),
  organizationId: z.string().min(1),
  shipmentId: z.string().min(1),
  shipmentReference: z.string().min(1),
  shipDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  carrier: z.string().nullable(),
  serviceLevel: z.string().nullable(),
  trackingNumber: z.string().nullable(),
  destination: shippingPartySchema,
  blindShipping: z.boolean(),
  sender: shippingPartySchema,
  orders: z.array(z.object({
    id: z.string().min(1), orderNumber: z.string(), customerId: z.string().nullable(),
    customerName: z.string().nullable(), poNumber: z.string().nullable(),
  }).strict()),
  lines: z.array(shippingDocumentLineSchema),
  packages: z.array(z.object({
    id: z.string().min(1), ordinal: z.number().int().positive(), packageReference: z.string().min(1),
    weightLbs: z.string().nullable(), dimLengthIn: z.string().nullable(),
    dimWidthIn: z.string().nullable(), dimHeightIn: z.string().nullable(),
    internalNotes: z.string().nullable(), lines: z.array(shippingDocumentLineSchema),
  }).strict()),
  internalNotes: z.string().nullable(),
}).strict();

export function shippingPartyValidationErrors(party: ShippingParty): string[] {
  const missing: string[] = [];
  if (!party.name?.trim() && !party.company?.trim()) missing.push("recipient or company name");
  if (!party.address1?.trim()) missing.push("street address");
  if (!party.city?.trim()) missing.push("city");
  const country = party.country?.trim().toUpperCase();
  if ((!country || ["US", "USA", "UNITED STATES", "UNITED STATES OF AMERICA"].includes(country)) && !party.state?.trim()) {
    missing.push("state");
  }
  if (!party.postalCode?.trim()) missing.push("ZIP/postal code");
  return missing;
}

export function shippingPartyAddressLines(party: ShippingParty): string[] {
  return [party.name, party.company, party.address1, party.address2,
    [party.city, party.state, party.postalCode].filter(Boolean).join(" "), party.country]
    .filter((value): value is string => Boolean(value?.trim()));
}
