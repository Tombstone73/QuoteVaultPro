import { z } from "zod";

/**
 * Resource contracts shared by the internal investigation service and the
 * Operator tool boundary. These are deliberately small, navigable records;
 * they are not a generic record serializer or query language.
 */
export const investigationResourceTypeValues = [
  "order",
  "customer",
  "order_line",
  "production_job",
  "fulfillment",
  "shipment",
  "invoice",
  "contact",
  "quote",
  "artwork",
] as const;
export type InvestigationResourceType = (typeof investigationResourceTypeValues)[number];

const identifier = z.string().trim().min(1).max(128).regex(/^[A-Za-z0-9:_-]+$/);
const isoDateTime = z.string().datetime({ offset: true });
const shortText = z.string().trim().min(1).max(240);

export const investigationResourceReferenceSchema = z.object({
  type: z.enum(investigationResourceTypeValues),
  id: identifier,
  label: shortText,
  href: z.string().startsWith("/").max(300),
}).strict();
export type InvestigationResourceReference = z.infer<typeof investigationResourceReferenceSchema>;

export const investigationResourceInputSchema = z.object({
  type: z.enum(investigationResourceTypeValues),
  id: identifier,
}).strict();
export type InvestigationResourceInput = z.infer<typeof investigationResourceInputSchema>;

const relationshipValues = [
  "belongs_to_customer",
  "contains_line",
  "has_production_job",
  "has_fulfillment_workspace",
  "fulfills_order",
  "invoices_order",
  "has_contact",
  "originated_from_quote",
  "has_artwork",
  "supersedes_artwork",
] as const;
export type InvestigationRelationship = (typeof relationshipValues)[number];

export const investigationSearchInputSchema = z.object({
  query: z.string().trim().min(1).max(160),
  resourceTypes: z.array(z.enum(investigationResourceTypeValues)).min(1).max(6).optional(),
  limit: z.number().int().min(1).max(20).default(8),
}).strict();

export const investigationGetInputSchema = z.object({ resource: investigationResourceInputSchema }).strict();

export const investigationRelatedInputSchema = z.object({
  resource: investigationResourceInputSchema,
  relationships: z.array(z.enum(relationshipValues)).min(1).max(5).optional(),
  depth: z.number().int().min(1).max(2).default(1),
  limit: z.number().int().min(1).max(20).default(12),
}).strict();

export const investigationHistoryInputSchema = z.object({
  resource: investigationResourceInputSchema,
  limit: z.number().int().min(1).max(20).default(12),
}).strict();

const currentSchema = z.object({
  status: shortText.optional(),
  updatedAt: isoDateTime.optional(),
}).strict();

export const investigationSnapshotSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("order"), resource: investigationResourceReferenceSchema, current: currentSchema, orderNumber: shortText, customer: investigationResourceReferenceSchema.optional(), state: shortText, fulfillmentStatus: shortText, dueDate: isoDateTime.optional() }).strict(),
  z.object({ type: z.literal("customer"), resource: investigationResourceReferenceSchema, current: currentSchema, companyName: shortText, active: z.boolean().nullable() }).strict(),
  z.object({ type: z.literal("order_line"), resource: investigationResourceReferenceSchema, current: currentSchema, description: shortText, quantity: z.number().int().nonnegative(), order: investigationResourceReferenceSchema, workflowState: shortText }).strict(),
  z.object({ type: z.literal("production_job"), resource: investigationResourceReferenceSchema, current: currentSchema, order: investigationResourceReferenceSchema, line: investigationResourceReferenceSchema.nullable(), station: shortText, step: shortText, status: shortText }).strict(),
  // Fulfillment is an Order-owned workspace, not a separate mutable record.
  // Its quantities and pickup evidence are a bounded projection of the
  // canonical fulfillment detail read model.
  z.object({ type: z.literal("fulfillment"), resource: investigationResourceReferenceSchema, current: currentSchema, order: investigationResourceReferenceSchema, status: shortText, fulfillmentType: z.enum(["SHIP", "PICKUP"]), quantities: z.object({ physicalLineCount: z.number().int().nonnegative(), orderedQuantity: z.number().finite().nonnegative(), fulfilledQuantity: z.number().finite().nonnegative(), shippedQuantity: z.number().finite().nonnegative(), pickedUpQuantity: z.number().finite().nonnegative(), readyWaitingQuantity: z.number().finite().nonnegative(), notReadyQuantity: z.number().finite().nonnegative(), remainingQuantity: z.number().finite().nonnegative() }).strict(), pickup: z.object({ status: shortText, readyAt: isoDateTime.nullable(), pickedUpAt: isoDateTime.nullable(), handoffCount: z.number().int().nonnegative() }).strict().nullable(), shipments: z.array(investigationResourceReferenceSchema).max(20) }).strict(),
  z.object({ type: z.literal("shipment"), resource: investigationResourceReferenceSchema, current: currentSchema, order: investigationResourceReferenceSchema, status: shortText, trackingNumber: shortText.nullable(), carrier: shortText.nullable() }).strict(),
  z.object({ type: z.literal("invoice"), resource: investigationResourceReferenceSchema, current: currentSchema, order: investigationResourceReferenceSchema.nullable(), customer: investigationResourceReferenceSchema.nullable(), invoiceNumber: shortText, status: shortText, total: z.number().finite().nonnegative(), quickbooksSyncStatus: shortText.nullable(), emailStatus: shortText.nullable() }).strict(),
  // Deliberately excludes email, phone, CRM notes, and link notes. The
  // investigation graph establishes identity and membership, not a contact
  // record export.
  z.object({ type: z.literal("contact"), resource: investigationResourceReferenceSchema, current: currentSchema, fullName: shortText, title: shortText.nullable(), customer: investigationResourceReferenceSchema.nullable() }).strict(),
  z.object({ type: z.literal("quote"), resource: investigationResourceReferenceSchema, current: currentSchema, quoteNumber: shortText, customer: investigationResourceReferenceSchema.nullable(), relatedOrder: investigationResourceReferenceSchema.nullable(), status: shortText }).strict(),
  // File identity and availability only. Object keys, signed URLs, previews,
  // binary contents, and checksums remain outside the model boundary.
  z.object({ type: z.literal("artwork"), resource: investigationResourceReferenceSchema, current: currentSchema, order: investigationResourceReferenceSchema, line: investigationResourceReferenceSchema, fileRecordId: identifier, filename: shortText, mimeType: shortText, storageState: shortText, originalAvailable: z.boolean(), previewAvailable: z.boolean(), role: shortText, artworkStatus: shortText, side: shortText, supersedesArtwork: investigationResourceReferenceSchema.nullable() }).strict(),
]);
export type InvestigationSnapshot = z.infer<typeof investigationSnapshotSchema>;

export const investigationSearchResultSchema = z.object({
  resolution: z.enum(["resolved", "ambiguous"]),
  matches: z.array(z.object({ resource: investigationResourceReferenceSchema, summary: shortText, match: z.enum(["exact", "partial"]) }).strict()).min(1).max(20),
  limit: z.number().int().min(1).max(20),
}).strict();

export const investigationGetResultSchema = z.object({ snapshot: investigationSnapshotSchema }).strict();

export const investigationRelatedResultSchema = z.object({
  root: investigationResourceReferenceSchema,
  edges: z.array(z.object({
    from: investigationResourceReferenceSchema,
    to: investigationResourceReferenceSchema,
    relationship: z.enum(relationshipValues),
    depth: z.number().int().min(1).max(2),
  }).strict()).max(40),
  returnedDepth: z.number().int().min(1).max(2),
  truncated: z.boolean(),
}).strict();

export const investigationHistoryResultSchema = z.object({
  resource: investigationResourceReferenceSchema,
  events: z.array(z.object({
    eventId: identifier,
    occurredAt: isoDateTime,
    kind: z.enum(["recorded_event", "current_snapshot"]),
    summary: z.string().trim().min(1).max(500),
    resource: investigationResourceReferenceSchema,
    provenance: z.object({ source: z.enum(["order_audit_log", "production_events", "shipments", "fulfillment_events", "invoices", "invoice_email_logs", "invoice_email_delivery_jobs", "line_item_artwork", "current_record"]), recorded: z.boolean() }).strict(),
  }).strict()).max(20),
  limit: z.number().int().min(1).max(20),
}).strict();
