import { createHash } from "crypto";
import { z } from "zod";

/**
 * Provider-neutral product state. This deliberately describes business intent,
 * not PBV2 persistence nodes. IDs are resolved by the tenant-aware server.
 */
export const productIntentFieldSourceSchema = z.enum([
  "explicit_user", "ai_interpreted", "selected_template", "canonical_default", "unresolved",
]);

const confidenceSchema = z.number().min(0).max(1).nullable().default(null);
const sourceSchema = z.object({ source: productIntentFieldSourceSchema, confidence: confidenceSchema }).strict();
const labelRefSchema = z.object({ label: z.string().trim().min(1).max(160), ...sourceSchema.shape }).strict();

const unresolvedFieldSchema = z.object({
  path: z.string().trim().min(1).max(160),
  reason: z.string().trim().min(1).max(500),
  operationallySignificant: z.boolean().default(false),
}).strict();

const lifecycleSchema = z.object({ inactive: z.literal(true), published: z.literal(false) }).strict();
const dimensionsSchema = z.object({ widthIn: z.number().positive(), heightIn: z.number().positive() }).strict();
const measurementSchema = z.object({
  mode: z.enum(["dimensions_required", "fixed_size", "quantity_only", "unresolved"]),
  fixedDimensions: dimensionsSchema.nullable().default(null),
  source: productIntentFieldSourceSchema,
  confidence: confidenceSchema,
}).strict().superRefine((value, context) => {
  if (value.mode === "fixed_size" && !value.fixedDimensions) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "fixed_size requires fixedDimensions", path: ["fixedDimensions"] });
  }
  if (value.mode !== "fixed_size" && value.fixedDimensions) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "fixedDimensions only applies to fixed_size", path: ["fixedDimensions"] });
  }
});

const quantitySchema = z.object({
  behavior: z.enum(["customer_entered", "fixed", "unresolved"]),
  fixedQuantity: z.number().int().positive().nullable().default(null),
  source: productIntentFieldSourceSchema,
  confidence: confidenceSchema,
}).strict().superRefine((value, context) => {
  if (value.behavior === "fixed" && value.fixedQuantity == null) context.addIssue({ code: z.ZodIssueCode.custom, message: "fixed quantity behavior requires fixedQuantity", path: ["fixedQuantity"] });
  if (value.behavior !== "fixed" && value.fixedQuantity != null) context.addIssue({ code: z.ZodIssueCode.custom, message: "fixedQuantity only applies to fixed behavior", path: ["fixedQuantity"] });
});

const moneySchema = z.number().int().nonnegative();
const matrixAxisSchema = z.object({ key: z.string().trim().min(1).max(80), label: z.string().trim().min(1).max(120), values: z.array(z.string().trim().min(1).max(120)).min(1).max(50) }).strict();
const pricingSchema = z.object({
  model: z.enum(["per_piece", "per_square_foot", "matrix", "quantity_tiers", "unresolved"]),
  perPieceCents: moneySchema.nullable().default(null),
  perSquareFootCents: moneySchema.nullable().default(null),
  minimumChargeCents: moneySchema.nullable().default(null),
  matrix: z.object({ axes: z.array(matrixAxisSchema).length(2), cells: z.record(moneySchema) }).strict().nullable().default(null),
  tiers: z.array(z.object({ minQuantity: z.number().int().positive(), maxQuantity: z.number().int().positive().nullable(), perPieceCents: moneySchema }).strict()).default([]),
  source: productIntentFieldSourceSchema,
  confidence: confidenceSchema,
}).strict().superRefine((value, context) => {
  if (value.model === "per_piece" && value.perPieceCents == null) context.addIssue({ code: z.ZodIssueCode.custom, message: "per_piece requires perPieceCents", path: ["perPieceCents"] });
  if (value.model === "per_square_foot" && value.perSquareFootCents == null) context.addIssue({ code: z.ZodIssueCode.custom, message: "per_square_foot requires perSquareFootCents", path: ["perSquareFootCents"] });
  if (value.model === "matrix" && !value.matrix) context.addIssue({ code: z.ZodIssueCode.custom, message: "matrix pricing requires matrix data", path: ["matrix"] });
  if (value.model !== "matrix" && value.matrix) context.addIssue({ code: z.ZodIssueCode.custom, message: "matrix data only applies to matrix pricing", path: ["matrix"] });
  if (value.model === "quantity_tiers" && value.tiers.length === 0) context.addIssue({ code: z.ZodIssueCode.custom, message: "quantity_tiers requires tiers", path: ["tiers"] });
  if (value.model !== "quantity_tiers" && value.tiers.length) context.addIssue({ code: z.ZodIssueCode.custom, message: "tiers only apply to quantity_tiers", path: ["tiers"] });
});

const materialSchema = z.discriminatedUnion("state", [
  z.object({ state: z.literal("resolved"), material: labelRefSchema }).strict(),
  z.object({ state: z.literal("explicitly_unset"), source: z.literal("explicit_user"), confidence: z.null().default(null) }).strict(),
  z.object({ state: z.literal("unresolved"), source: z.literal("unresolved"), confidence: z.null().default(null) }).strict(),
]);
const optionGroupSchema = z.object({ key: z.string().trim().min(1).max(80), label: z.string().trim().min(1).max(120), required: z.boolean(), selectionMode: z.enum(["single", "multiple"]), values: z.array(z.string().trim().min(1).max(120)).min(1).max(100), defaultValue: z.string().trim().min(1).nullable().default(null), source: productIntentFieldSourceSchema, confidence: confidenceSchema }).strict();
const workflowSchema = z.object({ proofRequired: z.boolean(), productionJobRequired: z.boolean(), productionRoute: z.union([labelRefSchema, z.null()]), source: productIntentFieldSourceSchema, confidence: confidenceSchema }).strict().superRefine((value, context) => {
  if (!value.productionJobRequired && value.productionRoute) context.addIssue({ code: z.ZodIssueCode.custom, message: "productionRoute requires productionJobRequired", path: ["productionRoute"] });
});

export const productDraftIntentSchema = z.object({
  contractVersion: z.literal(1),
  operation: z.enum(["create", "clone", "edit"]),
  revision: z.number().int().positive(),
  identity: z.object({ name: labelRefSchema, category: z.union([labelRefSchema, z.null()]) }).strict(),
  lifecycle: lifecycleSchema,
  measurement: measurementSchema,
  quantity: quantitySchema,
  pricing: pricingSchema,
  material: materialSchema,
  optionGroups: z.array(optionGroupSchema).max(100),
  workflow: workflowSchema,
  visibility: z.object({ customerVisible: z.boolean(), source: productIntentFieldSourceSchema }).strict(),
  unresolvedFields: z.array(unresolvedFieldSchema).max(100),
  explicitConstraints: z.array(z.string().trim().min(1).max(500)).max(100).default([]),
  compatibility: z.object({ productBuilder: z.literal("pbv2"), archetype: z.string().trim().min(1).max(80) }).strict(),
}).strict().superRefine((value, context) => {
  const duplicate = value.optionGroups.find((group, index) => value.optionGroups.findIndex((other) => other.key.toLowerCase() === group.key.toLowerCase()) !== index);
  if (duplicate) context.addIssue({ code: z.ZodIssueCode.custom, message: "Option group keys must be unique", path: ["optionGroups"] });
});

export type ProductDraftIntent = z.infer<typeof productDraftIntentSchema>;

const patchValueSchema = z.object({ set: z.unknown().optional(), clear: z.literal(true).optional() }).strict().superRefine((value, context) => {
  if (("set" in value) === (value.clear === true)) context.addIssue({ code: z.ZodIssueCode.custom, message: "patch must have exactly one of set or clear" });
});
export const productDraftIntentPatchSchema = z.object({
  baseRevision: z.number().int().positive(),
  preserveUnspecifiedFields: z.literal(true).default(true),
  changes: z.record(patchValueSchema).refine((changes) => Object.keys(changes).length > 0, "A patch must change at least one field"),
}).strict();
export type ProductDraftIntentPatch = z.infer<typeof productDraftIntentPatchSchema>;

export const unresolvedQuestionSetSchema = z.object({ kind: z.literal("unresolved_questions"), questions: z.array(z.object({ field: z.string().min(1), question: z.string().min(1), reason: z.string().min(1) }).strict()).min(1) }).strict();
export const structuredCompilerErrorSchema = z.object({ kind: z.literal("compiler_error"), code: z.string().min(1), message: z.string().min(1), retryable: z.boolean() }).strict();
export const productIntentCompilerResultSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("complete_intent"), intent: productDraftIntentSchema }).strict(),
  z.object({ kind: z.literal("intent_patch"), patch: productDraftIntentPatchSchema }).strict(),
  unresolvedQuestionSetSchema,
  structuredCompilerErrorSchema,
]);
export type ProductIntentCompilerResult = z.infer<typeof productIntentCompilerResultSchema>;

export function parseProductDraftIntent(value: unknown): ProductDraftIntent { return productDraftIntentSchema.parse(value); }

/** Only known top-level intent paths are patchable; unknown paths are rejected. */
const patchableFields = new Set(["identity", "measurement", "quantity", "pricing", "material", "optionGroups", "workflow", "visibility", "unresolvedFields", "explicitConstraints", "compatibility"]);
export function applyProductDraftIntentPatch(intent: ProductDraftIntent, rawPatch: unknown): ProductDraftIntent {
  const patch = productDraftIntentPatchSchema.parse(rawPatch);
  if (patch.baseRevision !== intent.revision) throw new Error("PRODUCT_INTENT_STALE_REVISION");
  const next: Record<string, unknown> = { ...intent, revision: intent.revision + 1 };
  for (const [path, operation] of Object.entries(patch.changes)) {
    if (!patchableFields.has(path)) throw new Error(`PRODUCT_INTENT_PATCH_PATH_FORBIDDEN:${path}`);
    if (operation.clear) {
      if (path === "optionGroups" || path === "unresolvedFields" || path === "explicitConstraints") next[path] = [];
      else if (path === "material") next[path] = { state: "explicitly_unset", source: "explicit_user", confidence: null };
      else throw new Error(`PRODUCT_INTENT_PATCH_CLEAR_FORBIDDEN:${path}`);
    } else next[path] = operation.set;
  }
  return productDraftIntentSchema.parse(next);
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => [key, canonicalize(child)]));
  return value;
}
export function normalizeProductDraftIntent(intent: ProductDraftIntent): string { return JSON.stringify(canonicalize(productDraftIntentSchema.parse(intent))); }
export function productDraftIntentFingerprint(intent: ProductDraftIntent): string { return createHash("sha256").update(normalizeProductDraftIntent(intent)).digest("hex"); }
