import { createHash } from "node:crypto";
import { z } from "zod";

/** Server-owned V1 revision/resolver compatibility envelope for an inactive
 * Product Builder draft. Canonical proposal state owns migrated Product,
 * PBV2, pricing, and primary-material fields; the current creation transport
 * still projects through this historical shape. */
export const PRODUCT_DRAFT_INTENT_VERSION = 1 as const;

const nonEmpty = z.string().trim().min(1);
const centsSchema = z.number().int().min(0);
const positiveNumber = z.number().finite().positive();
export const fieldSourceSchema = z.enum(["explicit_user", "structured_candidate", "ai_interpreted", "semantic_inference", "selected_template", "canonical_default", "unresolved"]);
export const fieldMetadataSchema = z.object({ source: fieldSourceSchema, confidence: z.number().min(0).max(1).optional() }).strict();
export const unresolvedFieldSchema = z.object({ path: nonEmpty, code: nonEmpty, question: nonEmpty.optional() }).strict();

const resolvedReferenceSchema = z.object({ state: z.literal("resolved"), id: nonEmpty, label: nonEmpty }).strict();
const unresolvedReferenceSchema = z.object({ state: z.literal("unresolved"), label: nonEmpty }).strict();
export const tenantReferenceSchema = z.union([resolvedReferenceSchema, unresolvedReferenceSchema]);
export const explicitlyUnsetSchema = z.object({ state: z.literal("explicitly_unset") }).strict();

const materialSchema = z.union([resolvedReferenceSchema, unresolvedReferenceSchema, explicitlyUnsetSchema]);
const productionRouteSchema = z.union([resolvedReferenceSchema, unresolvedReferenceSchema, explicitlyUnsetSchema]);
const dimensionsSchema = z.object({ widthIn: positiveNumber, heightIn: positiveNumber, allowRotation: z.boolean().default(false) }).strict();
const measurementSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("dimensions_required"), dimensions: z.undefined().optional() }).strict(),
  z.object({ mode: z.literal("fixed_size"), dimensions: dimensionsSchema }).strict(),
  z.object({ mode: z.literal("quantity_only"), dimensions: z.undefined().optional() }).strict(),
]);
const quantitySchema = z.discriminatedUnion("behavior", [
  z.object({ behavior: z.literal("customer_entered"), minimum: z.number().int().positive().default(1), maximum: z.number().int().positive().optional() }).strict(),
  z.object({ behavior: z.literal("fixed"), quantity: z.number().int().positive() }).strict(),
  z.object({ behavior: z.literal("not_applicable") }).strict(),
]);
/** A canonical, base-relative option adjustment. Projection maps this to the
 * existing PBV2 choice-level addPercent impact; it is not a second pricing
 * engine and cannot carry arbitrary provider formulas. */
const optionPriceImpactSchema = z.object({ kind: z.literal("percentage_of_base"), percent: z.number().finite().min(-100).max(100) }).strict();
/** A total impact is a business semantic: projection derives the incremental
 * PBV2 adjustment after checking its prerequisite. This prevents an AI from
 * accidentally representing Contour 10% + Weed/Tape total 30% as 40%. */
const totalPercentImpactSchema = z.object({ percent: z.number().finite().min(-100).max(100), prerequisite: z.object({ optionGroupKey: nonEmpty, optionValueKey: nonEmpty }).strict() }).strict();
const optionAvailabilitySchema = z.object({ optionGroupKey: nonEmpty, optionValueKey: nonEmpty }).strict();
const optionValueSchema = z.object({ key: nonEmpty, label: nonEmpty, isDefault: z.boolean().default(false), priceImpact: optionPriceImpactSchema.optional(), totalPercentOfBaseWhenEnabled: totalPercentImpactSchema.optional() }).strict();
/** Unfinished server-owned drafts may contain an empty option group while the
 * Operator is still assembling it. Resolver readiness turns that temporary
 * state into a business question; PBV2 projection never sees it as ready. */
const optionGroupSchema = z.object({ key: nonEmpty, label: nonEmpty, required: z.boolean(), selectionMode: z.enum(["single", "multiple"]), inputType: z.enum(["text", "textarea"]).optional(), parentGroupKey: nonEmpty.optional(), values: z.array(optionValueSchema), availableWhen: optionAvailabilitySchema.optional() }).strict().superRefine((group, ctx) => {
  if (group.parentGroupKey && !group.inputType) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Only free-form inputs may declare a parent group.", path: ["parentGroupKey"] });
  if (new Set(group.values.map((value) => value.key.toLocaleLowerCase())).size !== group.values.length) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Option value keys must be unique.", path: ["values"] });
  if (group.selectionMode === "single" && group.values.filter((value) => value.isDefault).length > 1) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Single-select groups may have one default.", path: ["values"] });
  // PBV2 supports required choices without a preselected value. Do not invent
  // a default merely to make an AI-authored product executable.
});
const matrixCellSchema = z.object({ row: nonEmpty, column: nonEmpty, priceCents: centsSchema }).strict();
/** A single customer choice can select an authoritative base rate. This
 * preserves stated rates without inventing another customer-facing axis. */
const oneDimensionalMatrixCellSchema = z.object({ option: nonEmpty, priceCents: centsSchema }).strict();
const pricingSchema = z.discriminatedUnion("model", [
  z.object({ model: z.literal("scalar"), unit: z.enum(["per_piece", "per_square_foot", "per_hour", "flat_fee"]), priceCents: centsSchema, minimumChargeCents: centsSchema.optional() }).strict(),
  // A matrix can be fully captured before its pricing basis is known.  The
  // explicit sentinel preserves the typed cells without inventing a unit; the
  // resolver and projection gate keep it non-executable until it is answered.
  z.object({ model: z.literal("two_dimensional_matrix"), unit: z.enum(["per_piece", "per_square_foot", "unresolved"]), rowOptionKey: nonEmpty, columnOptionKey: nonEmpty, cells: z.array(matrixCellSchema), minimumChargeCents: centsSchema.optional() }).strict(),
  z.object({ model: z.literal("one_dimensional_matrix"), unit: z.enum(["per_piece", "per_square_foot", "unresolved"]), optionKey: nonEmpty, cells: z.array(oneDimensionalMatrixCellSchema), minimumChargeCents: centsSchema.optional() }).strict(),
  z.object({ model: z.literal("quantity_tiers"), unit: z.enum(["per_piece", "per_square_foot"]), tiers: z.array(z.object({ minimumQuantity: z.number().int().positive(), maximumQuantity: z.number().int().positive().nullable(), priceCents: z.number().int().positive() }).strict()).min(1), minimumChargeCents: centsSchema.optional() }).strict(),
  z.object({ model: z.literal("option_quantity_tiers"), unit: z.enum(["per_piece", "per_square_foot"]), optionKey: nonEmpty, rows: z.array(z.object({ option: nonEmpty, tiers: z.array(z.object({ minimumQuantity: z.number().int().positive(), maximumQuantity: z.number().int().positive().nullable(), priceCents: z.number().int().positive() }).strict()).min(1) }).strict()).min(1), minimumChargeCents: centsSchema.optional() }).strict(),
  // A known pricing basis is useful business state even before the user has
  // supplied enough information to choose a pricing structure or amount.
  // Keeping it here avoids discarding an explicit square-foot decision while
  // the draft remains safely non-executable.
  z.object({ model: z.literal("unresolved"), unit: z.enum(["per_piece", "per_square_foot", "per_hour"]).optional() }).strict(),
]).superRefine((pricing, ctx) => {
  if (pricing.model === "two_dimensional_matrix" && pricing.rowOptionKey === pricing.columnOptionKey) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Matrix axes must use different option groups.", path: ["columnOptionKey"] });
  if (pricing.model === "quantity_tiers") pricing.tiers.forEach((tier, index) => { if (tier.maximumQuantity !== null && tier.maximumQuantity < tier.minimumQuantity) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Tier maximum cannot precede its minimum.", path: ["tiers", index, "maximumQuantity"] }); });
  if (pricing.model === "option_quantity_tiers") pricing.rows.forEach((row, rowIndex) => row.tiers.forEach((tier, tierIndex) => { if (tier.maximumQuantity !== null && tier.maximumQuantity < tier.minimumQuantity) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Tier maximum cannot precede its minimum.", path: ["rows", rowIndex, "tiers", tierIndex, "maximumQuantity"] }); }));
});
const workflowSchema = z.object({ kind: z.enum(["standard_production", "fulfillment_only", "service_fee"]), requiresProofApproval: z.boolean(), requiresProductionJob: z.boolean() }).strict().superRefine((workflow, ctx) => {
  if (workflow.kind === "service_fee" && workflow.requiresProductionJob) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Service-fee products cannot require a production job.", path: ["requiresProductionJob"] });
});
const revisionMetadataSchema = z.object({ parentRevision: z.number().int().nonnegative().nullable(), createdAt: z.string().datetime().optional(), actorUserId: nonEmpty.nullable().optional() }).strict();
const identitySchema = z.object({ name: nonEmpty, description: z.string().trim().max(10000).default(""), category: tenantReferenceSchema }).strict();
const productionSchema = z.object({ route: productionRouteSchema, configuration: z.record(z.unknown()).default({}) }).strict();
const visibilitySchema = z.object({ catalogVisible: z.boolean().default(false) }).strict();

export const productDraftIntentSchema = z.object({
  contractVersion: z.literal(PRODUCT_DRAFT_INTENT_VERSION), intentId: nonEmpty, organizationId: nonEmpty, revision: z.number().int().nonnegative(),
  state: z.enum(["compiling", "needs_resolution", "needs_answers", "ready_for_review", "awaiting_confirmation", "executed", "expired", "abandoned"]),
  operation: z.enum(["new_product", "clone_to_inactive_draft", "edit_inactive_draft"]),
  identity: identitySchema,
  lifecycle: z.object({ productStatus: z.literal("inactive"), published: z.literal(false) }).strict(),
  measurement: measurementSchema, quantity: quantitySchema, pricing: pricingSchema, material: materialSchema,
  optionGroups: z.array(optionGroupSchema), workflow: workflowSchema,
  production: productionSchema,
  visibility: visibilitySchema,
  unresolvedFields: z.array(unresolvedFieldSchema).default([]), fieldMetadata: z.record(fieldMetadataSchema).default({}),
  revisionMetadata: revisionMetadataSchema, operationContext: z.object({ sourceProductId: nonEmpty.optional(), requestId: nonEmpty.optional() }).strict().default({}),
}).strict().superRefine((intent, ctx) => {
  if (new Set(intent.optionGroups.map((group) => group.key.toLocaleLowerCase())).size !== intent.optionGroups.length) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Option group keys must be unique.", path: ["optionGroups"] });
  if (new Set(intent.unresolvedFields.map((field) => field.path)).size !== intent.unresolvedFields.length) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Unresolved fields must use unique paths.", path: ["unresolvedFields"] });
  if (intent.operation === "new_product" && intent.operationContext.sourceProductId) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "New products cannot declare a source product.", path: ["operationContext", "sourceProductId"] });
  if (intent.operation !== "new_product" && !intent.operationContext.sourceProductId) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Clone and edit operations require a source product.", path: ["operationContext", "sourceProductId"] });
});
export type ProductDraftIntent = z.infer<typeof productDraftIntentSchema>;

const patchOperationSchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("set_identity"), value: identitySchema }).strict(),
  z.object({ op: z.literal("set_measurement"), value: measurementSchema }).strict(), z.object({ op: z.literal("set_quantity"), value: quantitySchema }).strict(),
  z.object({ op: z.literal("set_pricing"), value: pricingSchema }).strict(), z.object({ op: z.literal("set_material"), value: materialSchema }).strict(),
  z.object({ op: z.literal("replace_option_groups"), value: z.array(optionGroupSchema) }).strict(), z.object({ op: z.literal("set_workflow"), value: workflowSchema }).strict(),
  z.object({ op: z.literal("set_production"), value: productionSchema }).strict(), z.object({ op: z.literal("set_visibility"), value: visibilitySchema }).strict(),
  z.object({ op: z.literal("set_unresolved_fields"), value: z.array(unresolvedFieldSchema) }).strict(), z.object({ op: z.literal("merge_field_metadata"), value: z.record(fieldMetadataSchema) }).strict(),
  z.object({ op: z.literal("set_state"), value: z.enum(["compiling", "needs_resolution", "needs_answers", "ready_for_review", "awaiting_confirmation", "expired", "abandoned"]) }).strict(),
]);
export const productDraftIntentPatchSchema = z.object({ contractVersion: z.literal(PRODUCT_DRAFT_INTENT_VERSION), baseRevision: z.number().int().nonnegative(), preserveUnchanged: z.literal(true).default(true), operations: z.array(patchOperationSchema).min(1) }).strict();
export type ProductDraftIntentPatch = z.infer<typeof productDraftIntentPatchSchema>;

export const unresolvedQuestionAnswerSchema = z.object({
  issueId: nonEmpty,
  canonicalPath: nonEmpty,
  answerType: z.literal("choice"),
  allowedChoices: z.array(z.object({ displayLabel: nonEmpty, canonicalValue: nonEmpty, safeAliases: z.array(nonEmpty).min(1) }).strict()).min(1),
  baseRevision: z.number().int().nonnegative(),
}).strict();
export type UnresolvedQuestionAnswer = z.infer<typeof unresolvedQuestionAnswerSchema>;
export const unresolvedQuestionSchema = z.object({ id: nonEmpty, path: nonEmpty, question: nonEmpty, required: z.boolean(), options: z.array(z.object({ label: nonEmpty, value: z.union([z.string(), z.number(), z.boolean()]) }).strict()).optional(), answer: unresolvedQuestionAnswerSchema.optional() }).strict();
export const unresolvedQuestionSetSchema = z.object({ baseRevision: z.number().int().nonnegative().optional(), questions: z.array(unresolvedQuestionSchema).min(1) }).strict();
export const structuredCompilerErrorSchema = z.object({ code: nonEmpty, message: nonEmpty, retryable: z.boolean(), details: z.array(nonEmpty).default([]) }).strict();
export const productIntentCompilerResultSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("complete_intent"), intent: productDraftIntentSchema }).strict(), z.object({ kind: z.literal("intent_patch"), patch: productDraftIntentPatchSchema }).strict(),
  z.object({ kind: z.literal("unresolved_questions"), unresolved: unresolvedQuestionSetSchema }).strict(), z.object({ kind: z.literal("compiler_error"), error: structuredCompilerErrorSchema }).strict(),
]);
export type ProductIntentCompilerResult = z.infer<typeof productIntentCompilerResultSchema>;

export function parseProductDraftIntent(input: unknown): ProductDraftIntent { return productDraftIntentSchema.parse(input); }
export function applyProductDraftIntentPatch(intentInput: unknown, patchInput: unknown, metadata: Partial<z.infer<typeof revisionMetadataSchema>> = {}): ProductDraftIntent {
  const intent = productDraftIntentSchema.parse(intentInput); const patch = productDraftIntentPatchSchema.parse(patchInput);
  if (patch.baseRevision !== intent.revision) throw new Error(`Product intent patch is stale (expected revision ${intent.revision}, got ${patch.baseRevision}).`);
  const next: ProductDraftIntent = JSON.parse(JSON.stringify(intent));
  for (const operation of patch.operations) { switch (operation.op) {
    case "set_identity": next.identity = operation.value; break; case "set_measurement": next.measurement = operation.value; break; case "set_quantity": next.quantity = operation.value; break;
    case "set_pricing": next.pricing = operation.value; break; case "set_material": next.material = operation.value; break; case "replace_option_groups": next.optionGroups = operation.value; break;
    case "set_workflow": next.workflow = operation.value; break; case "set_production": next.production = operation.value; break; case "set_visibility": next.visibility = operation.value; break;
    case "set_unresolved_fields": next.unresolvedFields = operation.value; break; case "merge_field_metadata": next.fieldMetadata = { ...next.fieldMetadata, ...operation.value }; break; case "set_state": next.state = operation.value; break;
  } }
  next.revision = intent.revision + 1; next.revisionMetadata = { parentRevision: intent.revision, ...metadata };
  return productDraftIntentSchema.parse(next);
}

function canonical(value: unknown, omit = new Set<string>()): unknown { if (value === null || value === undefined) return null; if (Array.isArray(value)) return value.map((item) => canonical(item, omit)); if (typeof value !== "object") return value; const record = value as Record<string, unknown>; return Object.fromEntries(Object.keys(record).filter((key) => !omit.has(key) && record[key] !== undefined).sort().map((key) => [key, canonical(record[key], omit)])); }
/** Deterministic semantic representation. Revision identifiers and timestamps bind persistence, not product meaning. */
export function normalizeProductDraftIntent(input: unknown): Record<string, unknown> { const intent = productDraftIntentSchema.parse(input); const { intentId: _intentId, revision: _revision, revisionMetadata, ...semantic } = intent; const { createdAt: _createdAt, actorUserId: _actorUserId, parentRevision: _parentRevision } = revisionMetadata; return canonical(semantic) as Record<string, unknown>; }
export function productDraftIntentFingerprint(input: unknown): string { return createHash("sha256").update(JSON.stringify(normalizeProductDraftIntent(input))).digest("hex"); }
