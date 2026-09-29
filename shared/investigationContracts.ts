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
  "shipment",
  "invoice",
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
  "fulfills_order",
  "invoices_order",
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
  z.object({ type: z.literal("shipment"), resource: investigationResourceReferenceSchema, current: currentSchema, order: investigationResourceReferenceSchema, status: shortText, trackingNumber: shortText.nullable(), carrier: shortText.nullable() }).strict(),
  z.object({ type: z.literal("invoice"), resource: investigationResourceReferenceSchema, current: currentSchema, order: investigationResourceReferenceSchema.nullable(), customer: investigationResourceReferenceSchema.nullable(), invoiceNumber: shortText, status: shortText, total: z.number().finite().nonnegative() }).strict(),
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
    provenance: z.object({ source: z.enum(["order_audit_log", "production_events", "shipments", "invoices", "current_record"]), recorded: z.boolean() }).strict(),
  }).strict()).max(20),
  limit: z.number().int().min(1).max(20),
}).strict();
