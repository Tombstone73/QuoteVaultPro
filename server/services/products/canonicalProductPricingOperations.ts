import { createHash } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import {
  pricingV2BaseSchema,
  pricingV2Schema,
  pricingV2TierSchema,
  pricingImpactSchema,
  type PricingV2Tier,
} from "@shared/optionTreeV2";
import type { ProductOptionPricingMatrix, ProductOptionPricingMatrixRow } from "@shared/productOptionPricingMatrix";
import { sanitizePbv2PricingMatrix } from "@shared/pbv2/pricingMatrixSanitizer";
import { DEFAULT_VALIDATE_OPTS, validateTreeForPublish } from "@shared/pbv2/validator";
import { validateTreeHasBasePrice } from "@shared/pbv2/validator/validateBasePrice";
import { getProductAllowRotation } from "@shared/pbv2/productPricingRotation";
import { pbv2TreeVersions, pricingFormulas, products } from "@shared/schema";
import { normalizeProductRotationForWrite } from "../../lib/productPricingRotationWrite";
import { getDefaultFormula } from "@shared/pricingProfiles";
import { CanonicalProductPublishError, canonicalProductPublishOperations } from "./canonicalProductPublishOperations";

const nonEmpty = z.string().trim().min(1);
const cents = z.number().int().min(0);

/** Canonical pre-persistence Product pricing contract. It intentionally mirrors
 * the currently supported Product Builder models without introducing new math. */
export const canonicalProductPricingConfigurationSchema = z.discriminatedUnion("model", [
  z.object({ model: z.literal("scalar"), unit: z.enum(["per_piece", "per_square_foot", "per_hour", "flat_fee"]), priceCents: cents, minimumChargeCents: cents.optional() }).strict(),
  z.object({ model: z.literal("one_dimensional_matrix"), unit: z.enum(["per_piece", "per_square_foot", "unresolved"]), optionKey: nonEmpty, cells: z.array(z.object({ option: nonEmpty, priceCents: cents }).strict()), minimumChargeCents: cents.optional() }).strict(),
  z.object({ model: z.literal("two_dimensional_matrix"), unit: z.enum(["per_piece", "per_square_foot", "unresolved"]), rowOptionKey: nonEmpty, columnOptionKey: nonEmpty, cells: z.array(z.object({ row: nonEmpty, column: nonEmpty, priceCents: cents }).strict()), minimumChargeCents: cents.optional() }).strict(),
  z.object({ model: z.literal("quantity_tiers"), unit: z.enum(["per_piece", "per_square_foot"]), tiers: z.array(z.object({ minimumQuantity: z.number().int().positive(), maximumQuantity: z.number().int().positive().nullable(), priceCents: z.number().int().positive() }).strict()).min(1), minimumChargeCents: cents.optional() }).strict(),
  z.object({ model: z.literal("option_quantity_tiers"), unit: z.enum(["per_piece", "per_square_foot"]), optionKey: nonEmpty, rows: z.array(z.object({ option: nonEmpty, tiers: z.array(z.object({ minimumQuantity: z.number().int().positive(), maximumQuantity: z.number().int().positive().nullable(), priceCents: z.number().int().positive() }).strict()).min(1) }).strict()).min(1), minimumChargeCents: cents.optional() }).strict(),
  z.object({ model: z.literal("unresolved"), unit: z.enum(["per_piece", "per_square_foot", "per_hour"]).optional() }).strict(),
]).superRefine((pricing, ctx) => {
  if (pricing.model === "two_dimensional_matrix" && pricing.rowOptionKey === pricing.columnOptionKey) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["columnOptionKey"], message: "Matrix axes must use different option groups." });
  }
  if (pricing.model === "one_dimensional_matrix") {
    const keys = pricing.cells.map((cell) => cell.option);
    if (new Set(keys).size !== keys.length) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["cells"], message: "Matrix option keys must be unique." });
  }
  if (pricing.model === "two_dimensional_matrix") {
    const keys = pricing.cells.map((cell) => `${cell.row}\u0000${cell.column}`);
    if (new Set(keys).size !== keys.length) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["cells"], message: "Matrix row/column keys must be unique." });
  }
  if (pricing.model === "quantity_tiers") {
    let expected = 1;
    pricing.tiers.forEach((tier, index) => {
      if (tier.minimumQuantity !== expected) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["tiers", index], message: tier.minimumQuantity < expected ? "Quantity tiers overlap or are out of order." : `Quantity tiers must start at ${expected} without a gap.` });
      if (tier.maximumQuantity !== null && tier.maximumQuantity < tier.minimumQuantity) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["tiers", index, "maximumQuantity"], message: "Tier maximum cannot precede its minimum." });
      if (index < pricing.tiers.length - 1 && tier.maximumQuantity === null) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["tiers", index, "maximumQuantity"], message: "Only the final quantity tier may be open ended." });
      if (index === pricing.tiers.length - 1 && tier.maximumQuantity !== null) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["tiers", index, "maximumQuantity"], message: "The final quantity tier must be open ended." });
      expected = tier.maximumQuantity === null ? Number.MAX_SAFE_INTEGER : tier.maximumQuantity + 1;
    });
  }
  if (pricing.model === "option_quantity_tiers") {
    const options = pricing.rows.map((row) => row.option);
    if (new Set(options).size !== options.length) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["rows"], message: "Option tier rows must be unique." });
    pricing.rows.forEach((row, rowIndex) => { let expected = 1; row.tiers.forEach((tier, tierIndex) => { if (tier.minimumQuantity !== expected) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["rows", rowIndex, "tiers", tierIndex], message: `Quantity tiers must start at ${expected} without a gap.` }); if (tier.maximumQuantity !== null && tier.maximumQuantity < tier.minimumQuantity) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["rows", rowIndex, "tiers", tierIndex], message: "Tier maximum cannot precede its minimum." }); if (tierIndex < row.tiers.length - 1 && tier.maximumQuantity === null) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["rows", rowIndex, "tiers", tierIndex], message: "Only the final tier may be open ended." }); if (tierIndex === row.tiers.length - 1 && tier.maximumQuantity !== null) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["rows", rowIndex, "tiers", tierIndex], message: "The final tier must be open ended." }); expected = tier.maximumQuantity === null ? Number.MAX_SAFE_INTEGER : tier.maximumQuantity + 1; }); });
  }
});
export type CanonicalProductPricingConfiguration = z.infer<typeof canonicalProductPricingConfigurationSchema>;

export const canonicalProductPercentageImpactSchema = z.object({
  optionGroupKey: nonEmpty,
  optionValueKey: nonEmpty,
  impact: z.union([
    z.object({ kind: z.literal("percentage_of_base"), percent: z.number().finite().min(-100).max(100) }).strict(),
    z.object({ kind: z.literal("total_percentage_of_base"), percent: z.number().finite().min(-100).max(100), prerequisite: z.object({ optionGroupKey: nonEmpty, optionValueKey: nonEmpty }).strict() }).strict(),
  ]),
}).strict();

export const canonicalProductPricingProposalSchema = z.object({
  operationReference: z.literal("products.update_pricing.v1"),
  configuration: canonicalProductPricingConfigurationSchema,
  percentageImpacts: z.array(canonicalProductPercentageImpactSchema),
  missingInformation: z.array(z.object({
    path: z.string().trim().min(1),
    code: z.string().trim().min(1),
    question: z.string().trim().min(1).optional(),
  }).strict()).default([]),
}).strict();
export type CanonicalProductPricingProposal = z.infer<typeof canonicalProductPricingProposalSchema>;

export const productPricingMetadataChangesSchema = z.object({
  pricingMode: z.enum(["area", "quantity", "flat"]).optional(),
  pricingFormula: z.string().nullable().optional(),
  pricingProfileKey: z.string().trim().min(1).max(100).optional(),
  pricingProfileConfig: z.record(z.any()).nullable().optional(),
  pricingEngine: z.enum(["formulaLibrary", "pricingProfile", "pricingFormula"]).nullable().optional(),
  pricingFormulaId: z.string().trim().min(1).nullable().optional(),
  minPricePerItem: z.coerce.number().positive().nullable().optional(),
  allowZeroPrice: z.boolean().optional(),
}).strict().refine((value) => Object.keys(value).length > 0, "At least one Product pricing metadata field is required.");
export type ProductPricingMetadataChanges = z.infer<typeof productPricingMetadataChangesSchema>;
export const canonicalProductPricingMetadataFieldNames = ["pricingMode", "pricingFormula", "pricingProfileKey", "pricingProfileConfig", "pricingEngine", "pricingFormulaId", "minPricePerItem", "allowZeroPrice"] as const satisfies readonly (keyof ProductPricingMetadataChanges)[];

export function takeCanonicalProductPricingMetadataChanges(value: Record<string, unknown>): ProductPricingMetadataChanges | null {
  const changes = Object.fromEntries(canonicalProductPricingMetadataFieldNames.flatMap((field) => Object.prototype.hasOwnProperty.call(value, field) ? [[field, value[field]]] : []));
  for (const field of canonicalProductPricingMetadataFieldNames) delete value[field];
  return Object.keys(changes).length ? productPricingMetadataChangesSchema.parse(changes) : null;
}

export type CanonicalPricingFinding = { code: string; message: string; path?: string };
export class CanonicalProductPricingError extends Error {
  constructor(readonly code: string, message: string, readonly findings: readonly CanonicalPricingFinding[] = []) {
    super(message); this.name = "CanonicalProductPricingError";
  }
}

function clone<T>(value: T): T { return structuredClone(value); }
function asRecord(value: unknown): Record<string, any> | null { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : null; }
function stable(value: unknown): string { if (value === null || typeof value !== "object") return JSON.stringify(value); if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`; const record = value as Record<string, unknown>; return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stable(record[key])}`).join(",")}}`; }
export function canonicalProductPricingFingerprint(value: unknown): string { return createHash("sha256").update(stable(value)).digest("hex"); }

export function normalizeCanonicalProductPricingConfiguration(raw: unknown): CanonicalProductPricingConfiguration {
  return canonicalProductPricingConfigurationSchema.parse(raw);
}

function zodFindings(error: z.ZodError, prefix = "tree.meta.pricingV2"): CanonicalPricingFinding[] {
  return error.issues.map((issue) => ({ code: "PBV2_PRICING_SCHEMA_INVALID", message: issue.message, path: [prefix, ...issue.path.map(String)].filter(Boolean).join(".") }));
}

/** Shared Product Editor/AI DRAFT validation. It preserves the tree byte-for-
 * byte except for the established stale-matrix sanitizer. Incomplete empty
 * matrices remain legal while the Product Editor is drafting. */
export function normalizeCanonicalProductPricingTree(raw: unknown, options: { allowIncompleteMatrix?: boolean } = {}): { tree: Record<string, any>; sanitizerChanges: readonly unknown[] } {
  if (!asRecord(raw)) throw new CanonicalProductPricingError("PBV2_PRICING_INVALID", "PBV2 pricing must be part of a tree object.");
  const candidate = clone(raw as Record<string, any>);
  const sanitized = sanitizePbv2PricingMatrix(candidate, { allowIncompleteMatrix: options.allowIncompleteMatrix === true });
  const pricingV2 = asRecord(sanitized.tree.meta)?.pricingV2;
  if (pricingV2 !== undefined) {
    const parsed = pricingV2Schema.safeParse(pricingV2);
    if (!parsed.success) throw new CanonicalProductPricingError("PBV2_PRICING_INVALID", "PBV2 base pricing, basis, or tiers are invalid.", zodFindings(parsed.error));
    for (const [tierType, bound] of [["qtyTiers", "minQty"], ["sqftTiers", "minSqft"]] as const) {
      const tiers = parsed.data[tierType] ?? [];
      const values = tiers.map((tier) => tier[bound]);
      if (values.some((value) => value === undefined) || values.some((value, index) => index > 0 && Number(value) <= Number(values[index - 1]))) {
        throw new CanonicalProductPricingError("PBV2_TIER_INVALID", `${tierType} bounds must be present, unique, and strictly increasing.`, [{ code: "PBV2_TIER_ORDER_INVALID", message: `${tierType} bounds must be present, unique, and strictly increasing.`, path: `tree.meta.pricingV2.${tierType}` }]);
      }
    }
  }
  const pricingFindings = validateTreeForPublish(sanitized.tree as any, DEFAULT_VALIDATE_OPTS).errors.filter((finding: any) => {
    const code = String(finding?.code ?? "");
    if (!code.includes("PRICING") && !code.includes("PRICE") && !code.includes("TIER")) return false;
    if (options.allowIncompleteMatrix && code === "PBV2_E_PRICING_MATRIX_INVALID_STRUCTURE" && String(finding?.path ?? "").endsWith(".rows")) {
      const matrix = String(finding.path).startsWith("tree.meta.") ? sanitized.tree?.meta?.pricingMatrix : sanitized.tree?.pricingMatrix;
      if (Array.isArray(matrix?.dimensions) && matrix.dimensions.length > 0 && Array.isArray(matrix?.rows) && matrix.rows.length === 0) return false;
    }
    return true;
  });
  if (pricingFindings.length) throw new CanonicalProductPricingError("PBV2_PRICING_INVALID", "PBV2 pricing configuration is invalid.", pricingFindings.map((finding: any) => ({ code: String(finding.code), message: String(finding.message), ...(finding.path ? { path: String(finding.path) } : {}) })));
  return { tree: sanitized.tree, sanitizerChanges: sanitized.changes };
}

export const canonicalPricingMatrixRowSchema = z.object({
  id: z.string().trim().min(1).max(255).optional(), when: z.record(z.unknown()).optional(), match: z.record(z.unknown()).optional(), combination: z.record(z.unknown()).optional(), variables: z.record(z.unknown()).optional(), values: z.record(z.unknown()).optional(), qtyTiers: z.array(z.record(z.unknown())).max(10_000).optional(), tierBasis: z.enum(["line_item_quantity", "computed_sheet_usage", "product_default"]).optional(),
}).passthrough().superRefine((row, ctx) => { if ([row.when, row.match, row.combination].filter((value) => value !== undefined).length !== 1) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Each pricing matrix row must specify exactly one of when, match, or combination." }); });
export const canonicalPricingMatrixReplacementSchema = z.object({ id: z.string().trim().min(1).max(255).optional(), dimensions: z.array(z.string().trim().min(1).max(128)).min(1).max(12), rows: z.array(canonicalPricingMatrixRowSchema).min(1).max(10_000) }).strict().superRefine((matrix, ctx) => { if (new Set(matrix.dimensions).size !== matrix.dimensions.length) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["dimensions"], message: "Pricing matrix dimensions must be unique." }); });
export type CanonicalPricingMatrixReplacement = z.infer<typeof canonicalPricingMatrixReplacementSchema>;

function inputChoiceValues(treeJson: Record<string, unknown>, dimensions: string[]): Map<string, unknown[]> {
  const rawNodes = treeJson.nodes; const nodes = Array.isArray(rawNodes) ? rawNodes : Object.values(asRecord(rawNodes) ?? {}); const wanted = new Set(dimensions); const found = new Map<string, unknown[]>();
  for (const node of nodes) { const record = asRecord(node); const input = asRecord(record?.input) ?? asRecord(record?.data); const key = typeof input?.selectionKey === "string" ? input.selectionKey : ""; if (!wanted.has(key)) continue; const values = (Array.isArray(record?.choices) ? record.choices : []).flatMap((choice: unknown) => { const item = asRecord(choice); return item && Object.prototype.hasOwnProperty.call(item, "value") ? [item.value] : []; }); if (values.length) found.set(key, values); }
  return found;
}
function matrixMatch(row: ProductOptionPricingMatrixRow): Record<string, unknown> { return (row.when ?? row.match ?? row.combination ?? {}) as Record<string, unknown>; }
function combinationKey(dimensions: string[], match: Record<string, unknown>): string { return stable(dimensions.map((dimension) => [dimension, match[dimension]])); }

export function validateCanonicalPricingMatrixReplacement(treeJson: Record<string, unknown>, raw: unknown): ProductOptionPricingMatrix {
  const replacement = canonicalPricingMatrixReplacementSchema.parse(raw); const candidate = clone(replacement) as ProductOptionPricingMatrix;
  const sanitized = sanitizePbv2PricingMatrix({ ...clone(treeJson), pricingMatrix: candidate });
  if (sanitized.changed || !(sanitized.tree as Record<string, unknown>).pricingMatrix) throw new CanonicalProductPricingError("PBV2_MATRIX_INVALID", "The replacement matrix contains dimensions, choices, or rows that are not valid for this PBV2 DRAFT.");
  const choiceValues = inputChoiceValues(treeJson, candidate.dimensions); if (choiceValues.size !== candidate.dimensions.length) throw new CanonicalProductPricingError("PBV2_MATRIX_DIMENSIONS_UNRESOLVABLE", "Every pricing matrix dimension must be an INPUT with explicit PBV2 choices.");
  const expected = new Set<string>(); const combinations = candidate.dimensions.reduce<unknown[][]>((all, dimension) => all.flatMap((prefix) => (choiceValues.get(dimension) ?? []).map((value) => [...prefix, value])), [[]]);
  for (const values of combinations) expected.add(combinationKey(candidate.dimensions, Object.fromEntries(candidate.dimensions.map((dimension, index) => [dimension, values[index]]))));
  const seen = new Set<string>();
  for (const row of candidate.rows) { const match = matrixMatch(row); if (Object.keys(match).length !== candidate.dimensions.length || candidate.dimensions.some((dimension) => !Object.prototype.hasOwnProperty.call(match, dimension))) throw new CanonicalProductPricingError("PBV2_MATRIX_CELL_INCOMPLETE", "Every replacement row must specify exactly one complete pricing-matrix cell."); const key = combinationKey(candidate.dimensions, match); if (!expected.has(key)) throw new CanonicalProductPricingError("PBV2_MATRIX_CELL_UNKNOWN", "A replacement row references an option combination outside the bound PBV2 DRAFT."); if (seen.has(key)) throw new CanonicalProductPricingError("PBV2_MATRIX_CELL_DUPLICATE", "A replacement pricing matrix contains the same option combination more than once."); seen.add(key); }
  if (seen.size !== expected.size) throw new CanonicalProductPricingError("PBV2_MATRIX_CELLS_MISSING", "A complete pricing-matrix replacement must include every option combination exactly once.");
  return candidate;
}

export const canonicalPricingTierSetSchema = z.object({ tierType: z.enum(["qtyTiers", "sqftTiers"]), tiers: z.array(pricingV2TierSchema).min(1).max(1_000) }).strict();
export type CanonicalPricingTierSet = z.infer<typeof canonicalPricingTierSetSchema>;
export function validateCanonicalPricingTierReplacement(raw: unknown): CanonicalPricingTierSet {
  const set = canonicalPricingTierSetSchema.parse(raw); const tiers = set.tiers as PricingV2Tier[]; const bound = set.tierType === "qtyTiers" ? "minQty" : "minSqft"; const values = tiers.map((tier) => tier[bound]);
  if (values.some((value) => typeof value !== "number" || !Number.isFinite(value))) throw new CanonicalProductPricingError("PBV2_TIER_BOUND_MISSING", `Every ${set.tierType} tier must provide ${bound}.`);
  if (values[0] !== 1) throw new CanonicalProductPricingError("PBV2_TIER_COVERAGE_INVALID", `${set.tierType} must begin at 1.`);
  for (let index = 1; index < values.length; index += 1) if (Number(values[index]) <= Number(values[index - 1])) throw new CanonicalProductPricingError("PBV2_TIER_ORDER_INVALID", `${set.tierType} bounds must be strictly increasing without duplicates or overlap.`);
  for (const tier of tiers) { if (!["perSqftCents", "perPieceCents", "minimumChargeCents"].some((field) => typeof (tier as any)[field] === "number" && Number.isFinite((tier as any)[field]))) throw new CanonicalProductPricingError("PBV2_TIER_RATE_MISSING", "Every replacement quantity tier must define at least one finite PBV2 price field."); const foreign = set.tierType === "qtyTiers" ? tier.minSqft : tier.minQty; if (foreign !== undefined) throw new CanonicalProductPricingError("PBV2_TIER_BASIS_MIXED", "A tier set cannot mix quantity and square-foot lower bounds."); }
  return clone(set);
}

export function validateCanonicalPercentageImpact(raw: unknown) {
  const parsed = pricingImpactSchema.parse(raw);
  if (parsed.mode !== "addPercent" && parsed.mode !== "percentOfBase") throw new CanonicalProductPricingError("PBV2_PERCENTAGE_IMPACT_INVALID", "This operation supports only established percentage option impacts.");
  if (!Number.isFinite(parsed.percent) || parsed.percent < -100 || parsed.percent > 100) throw new CanonicalProductPricingError("PBV2_PERCENTAGE_IMPACT_INVALID", "Percentage option impacts must be between -100 and 100.");
  return parsed;
}

type ProductRow = typeof products.$inferSelect;
export const canonicalProductPricingScalarFields = ["perSqftCents", "perPieceCents", "minimumChargeCents"] as const;
export type CanonicalProductPricingScalarValues = Partial<Record<(typeof canonicalProductPricingScalarFields)[number], number | null>>;
function scalarBase(tree: any): CanonicalProductPricingScalarValues { const base = tree?.meta?.pricingV2?.base; return { perSqftCents: Number.isInteger(base?.perSqftCents) ? base.perSqftCents : null, perPieceCents: Number.isInteger(base?.perPieceCents) ? base.perPieceCents : null, minimumChargeCents: Number.isInteger(base?.minimumChargeCents) ? base.minimumChargeCents : null }; }
function scalarTargetFingerprint(input: { productId: string; active: boolean; activeTreeVersionId: string | null; pricing: CanonicalProductPricingScalarValues }) { return canonicalProductPricingFingerprint(input); }
function numericFormulaVariables(value: unknown): Record<string, number> { const record = asRecord(value); if (!record) return {}; return Object.fromEntries(Object.entries(record).flatMap(([key, raw]) => { const numeric = Number(raw); return key && Number.isFinite(numeric) ? [[key, numeric]] : []; })); }
function formulaVariablesFromProductConfig(config: unknown): Record<string, number> { const record = asRecord(config); if (!record) return {}; const variables = numericFormulaVariables(record.formulaVariables); const allowRotation = getProductAllowRotation(record); if (allowRotation !== null) variables.allow_rotation = Number(allowRotation); return variables; }
function formulaMeta(product: ProductRow, draftTree: any) { const meta = asRecord(draftTree)?.meta ?? {}; const pricingProfileKey = String(product.pricingProfileKey || meta.pricingProfileKey || "default"); const pricingFormula = String(meta.pricingFormula || product.pricingFormula || getDefaultFormula(pricingProfileKey) || "").trim(); const formulaVariables = { ...numericFormulaVariables(meta.pricingFormulaVariables), ...numericFormulaVariables(meta.formulaVariables), ...formulaVariablesFromProductConfig(product.pricingProfileConfig) }; return { pricingProfileKey, pricingFormula, formulaVariables }; }

/** Active scalar changes create a replacement immutable tree, so they must not
 * be an escape hatch around the same canonical pricing-source rule used for
 * publication.  This intentionally checks only the domain changed here; full
 * publish validation remains the lifecycle operation's responsibility. */
function assertActiveScalarPricingIsValid(treeJson: unknown): void {
  const result = validateTreeHasBasePrice(treeJson);
  if (!result.ok) {
    throw new CanonicalProductPricingError(
      "PBV2_PRICING_INVALID",
      result.errors[0]?.message ?? "The active Product must retain a valid PBV2 pricing source.",
    );
  }
}

/** An immutable ACTIVE replacement must never repair or perpetuate an older
 * unvalidated tree.  Validate the current pointer at the canonical boundary
 * before changing only its scalar/formula fields. */
async function assertCurrentActiveTreeIsPublishable(input: { organizationId: string; productId: string; treeVersionId: string }): Promise<void> {
  try {
    await canonicalProductPublishOperations.propose(input);
  } catch (error) {
    if (error instanceof CanonicalProductPublishError) {
      throw new CanonicalProductPricingError("PBV2_PRICING_INVALID", error.message);
    }
    throw error;
  }
}

export class CanonicalProductPricingOperations {
  async updateProductMetadata(input: { organizationId: string; actorUserId: string; productId: string; changes: unknown; expectedUpdatedAt?: string }) {
    if (!input.actorUserId) throw new CanonicalProductPricingError("ACTOR_REQUIRED", "An authenticated actor is required.");
    const changes = productPricingMetadataChangesSchema.parse(input.changes); const { db } = await import("../../db");
    const [current] = await db.select().from(products).where(and(eq(products.organizationId, input.organizationId), eq(products.id, input.productId))).limit(1);
    if (!current) throw new CanonicalProductPricingError("PRODUCT_NOT_FOUND", "The product is no longer available.");
    if (input.expectedUpdatedAt && new Date(current.updatedAt).toISOString() !== input.expectedUpdatedAt) throw new CanonicalProductPricingError("PRODUCT_PRICING_STALE", "Product pricing changed before this update could be applied.");
    const normalized = normalizeProductRotationForWrite(changes, current) as ProductPricingMetadataChanges;
    const changed = Object.fromEntries(Object.entries(normalized).filter(([field, value]) => (current as any)[field] !== value));
    if (!Object.keys(changed).length) return { product: current, operationReference: "products.update_pricing.v1" as const, appliedChanges: [] };
    const effectiveEngine = (changed.pricingEngine ?? current.pricingEngine) as string | null;
    const effectiveFormulaId = (changed.pricingFormulaId ?? current.pricingFormulaId) as string | null;
    if (effectiveEngine === "formulaLibrary") {
      const [formula] = effectiveFormulaId
        ? await db.select({ id: pricingFormulas.id, isActive: pricingFormulas.isActive }).from(pricingFormulas).where(and(eq(pricingFormulas.organizationId, input.organizationId), eq(pricingFormulas.id, effectiveFormulaId))).limit(1)
        : [];
      if (!formula?.isActive) throw new CanonicalProductPricingError("PBV2_PRICING_INVALID", "Formula Library pricing requires an active Formula Library entry in this organization.");
    }
    const [updated] = await db.update(products).set({ ...changed, updatedAt: new Date() }).where(and(eq(products.organizationId, input.organizationId), eq(products.id, input.productId), ...(input.expectedUpdatedAt ? [eq(products.updatedAt, new Date(input.expectedUpdatedAt))] : []))).returning();
    if (!updated) throw new CanonicalProductPricingError("PRODUCT_PRICING_STALE", "Product pricing changed before this update could be applied.");
    return { product: updated, operationReference: "products.update_pricing.v1" as const, appliedChanges: Object.keys(changed) };
  }

  /** Canonical scalar persistence used by pricing change sets and rollback.
   * The caller's persisted change set remains the snapshot/audit owner. */
  async applyScalarPricing(input: { organizationId: string; actorUserId: string; productId: string; expectedFingerprint: string; values: CanonicalProductPricingScalarValues; correlationId: string }) {
    if (!input.actorUserId) throw new CanonicalProductPricingError("ACTOR_REQUIRED", "An authenticated actor is required.");
    const parsedValues = z.record(z.enum(canonicalProductPricingScalarFields), z.number().int().min(0).nullable()).parse(input.values);
    if (!Object.keys(parsedValues).length) throw new CanonicalProductPricingError("NO_PRODUCT_PRICING_CHANGES", "A Product pricing update requires at least one scalar field.");
    const { db } = await import("../../db");
    const [product] = await db.select().from(products).where(and(eq(products.organizationId, input.organizationId), eq(products.id, input.productId))).limit(1);
    if (!product) throw new CanonicalProductPricingError("PRODUCT_NOT_FOUND", "The Product is no longer available.");
    const [tree] = product.pbv2ActiveTreeVersionId
      ? await db.select().from(pbv2TreeVersions).where(and(eq(pbv2TreeVersions.organizationId, input.organizationId), eq(pbv2TreeVersions.id, product.pbv2ActiveTreeVersionId), eq(pbv2TreeVersions.status, "ACTIVE"))).limit(1)
      : await db.select().from(pbv2TreeVersions).where(and(eq(pbv2TreeVersions.organizationId, input.organizationId), eq(pbv2TreeVersions.productId, input.productId), eq(pbv2TreeVersions.status, "DRAFT"))).orderBy(desc(pbv2TreeVersions.updatedAt)).limit(1);
    if (!tree) throw new CanonicalProductPricingError("PBV2_PRICING_INVALID", "The canonical PBV2 pricing tree is no longer available.");
    const currentPricing = scalarBase(tree.treeJson); const currentTreeId = tree.id;
    const currentFingerprint = scalarTargetFingerprint({ productId: product.id, active: product.isActive, activeTreeVersionId: currentTreeId, pricing: currentPricing });
    if (currentFingerprint !== input.expectedFingerprint) throw new CanonicalProductPricingError("PRODUCT_PRICING_STALE", "The Product pricing or active-tree identity changed after proposal confirmation.");
    const nextBase = pricingV2BaseSchema.parse({ ...currentPricing, ...parsedValues }); const treeJson = clone(tree.treeJson as any); treeJson.meta ??= {}; treeJson.meta.pricingV2 ??= {}; treeJson.meta.pricingV2.base = nextBase;
    if (product.isActive) {
      await assertCurrentActiveTreeIsPublishable({ organizationId: input.organizationId, productId: input.productId, treeVersionId: tree.id });
      assertActiveScalarPricingIsValid(treeJson);
    }
    const now = new Date();
    const result = await db.transaction(async (tx) => {
      let activeTreeVersionId = tree.id;
      if (product.isActive) {
        const deprecated = await tx.update(pbv2TreeVersions).set({ status: "DEPRECATED", updatedAt: now, updatedByUserId: input.actorUserId }).where(and(eq(pbv2TreeVersions.organizationId, input.organizationId), eq(pbv2TreeVersions.id, tree.id), eq(pbv2TreeVersions.status, "ACTIVE"))).returning({ id: pbv2TreeVersions.id });
        if (!deprecated.length) throw new CanonicalProductPricingError("PRODUCT_PRICING_STALE", "The active Product pricing tree changed during execution.");
        const [replacement] = await tx.insert(pbv2TreeVersions).values({ organizationId: input.organizationId, productId: input.productId, status: "ACTIVE", schemaVersion: tree.schemaVersion, treeJson, publishedAt: now, createdByUserId: input.actorUserId, updatedByUserId: input.actorUserId }).returning();
        if (!replacement) throw new CanonicalProductPricingError("PBV2_PRICING_INVALID", "Failed to create the replacement active pricing tree.");
        activeTreeVersionId = replacement.id;
        const updated = await tx.update(products).set({ pbv2ActiveTreeVersionId: replacement.id, optionTreeJson: treeJson, updatedAt: now }).where(and(eq(products.organizationId, input.organizationId), eq(products.id, input.productId), eq(products.isActive, true), eq(products.pbv2ActiveTreeVersionId, tree.id))).returning({ id: products.id });
        if (!updated.length) throw new CanonicalProductPricingError("PRODUCT_PRICING_STALE", "The Product lifecycle or active pricing tree changed during execution.");
      } else {
        const updated = await tx.update(pbv2TreeVersions).set({ treeJson, updatedAt: now, updatedByUserId: input.actorUserId }).where(and(eq(pbv2TreeVersions.organizationId, input.organizationId), eq(pbv2TreeVersions.id, tree.id), eq(pbv2TreeVersions.status, "DRAFT"), eq(pbv2TreeVersions.updatedAt, tree.updatedAt))).returning({ id: pbv2TreeVersions.id });
        if (!updated.length) throw new CanonicalProductPricingError("PRODUCT_PRICING_STALE", "The Product pricing DRAFT changed during execution.");
      }
      return activeTreeVersionId;
    });
    return { fingerprint: scalarTargetFingerprint({ productId: product.id, active: product.isActive, activeTreeVersionId: result, pricing: nextBase }), values: parsedValues, active: product.isActive, activeTreeVersionId: result, operationReference: "products.update_pricing.v1" as const, auditReference: input.correlationId };
  }

  /** Preserves the Product Editor's established scalar/formula propagation
   * behavior. It creates an immutable replacement ACTIVE version atomically;
   * matrices, tiers, option impacts, lifecycle, and customer pricing are not
   * broadened by this compatibility operation. */
  async propagateEditorDraftBaseToActive(input: { organizationId: string; actorUserId: string; productId: string }) {
    if (!input.actorUserId) throw new CanonicalProductPricingError("ACTOR_REQUIRED", "An authenticated actor is required."); const { db } = await import("../../db");
    const [product] = await db.select().from(products).where(and(eq(products.organizationId, input.organizationId), eq(products.id, input.productId))).limit(1); if (!product) throw new CanonicalProductPricingError("PRODUCT_NOT_FOUND", "The product is no longer available."); if (!product.pbv2ActiveTreeVersionId) return { changed: false, product };
    const [draft] = await db.select().from(pbv2TreeVersions).where(and(eq(pbv2TreeVersions.organizationId, input.organizationId), eq(pbv2TreeVersions.productId, input.productId), eq(pbv2TreeVersions.status, "DRAFT"))).orderBy(desc(pbv2TreeVersions.updatedAt)).limit(1); if (!draft) return { changed: false, product };
    const [active] = await db.select().from(pbv2TreeVersions).where(and(eq(pbv2TreeVersions.organizationId, input.organizationId), eq(pbv2TreeVersions.id, product.pbv2ActiveTreeVersionId), eq(pbv2TreeVersions.status, "ACTIVE"))).limit(1); if (!active) return { changed: false, product };
    const draftTree = clone(draft.treeJson as any); const activeTree = clone(active.treeJson as any); const draftBase = draftTree?.meta?.pricingV2?.base; const activeBase = activeTree?.meta?.pricingV2?.base; const nextMeta = formulaMeta(product, draftTree); const currentMeta = { pricingProfileKey: activeTree?.meta?.pricingProfileKey ?? null, pricingFormula: activeTree?.meta?.pricingFormula ?? null, formulaVariables: activeTree?.meta?.formulaVariables ?? {}, pricingFormulaVariables: activeTree?.meta?.pricingFormulaVariables ?? {} }; const desiredMeta = { ...nextMeta, pricingFormulaVariables: nextMeta.formulaVariables };
    if (!((draftBase && stable(draftBase) !== stable(activeBase)) || stable(currentMeta) !== stable(desiredMeta))) return { changed: false, product };
    activeTree.meta ??= {}; if (draftBase) { activeTree.meta.pricingV2 ??= {}; activeTree.meta.pricingV2.base = draftBase; } activeTree.meta.pricingProfileKey = nextMeta.pricingProfileKey; activeTree.meta.pricingFormula = nextMeta.pricingFormula; activeTree.meta.formulaVariables = nextMeta.formulaVariables; activeTree.meta.pricingFormulaVariables = nextMeta.formulaVariables;
    await assertCurrentActiveTreeIsPublishable({ organizationId: input.organizationId, productId: input.productId, treeVersionId: active.id });
    assertActiveScalarPricingIsValid(activeTree);
    const now = new Date();
    const replacement = await db.transaction(async (tx) => { await tx.update(pbv2TreeVersions).set({ status: "DEPRECATED", updatedAt: now, updatedByUserId: input.actorUserId }).where(and(eq(pbv2TreeVersions.organizationId, input.organizationId), eq(pbv2TreeVersions.id, active.id), eq(pbv2TreeVersions.status, "ACTIVE"))); const [created] = await tx.insert(pbv2TreeVersions).values({ organizationId: input.organizationId, productId: input.productId, status: "ACTIVE", schemaVersion: active.schemaVersion, treeJson: activeTree, publishedAt: now, createdByUserId: input.actorUserId, updatedByUserId: input.actorUserId }).returning(); if (!created) throw new CanonicalProductPricingError("PRODUCT_PRICING_STALE", "The replacement active pricing tree could not be created."); const [updated] = await tx.update(products).set({ pbv2ActiveTreeVersionId: created.id, optionTreeJson: activeTree, updatedAt: now }).where(and(eq(products.organizationId, input.organizationId), eq(products.id, input.productId), eq(products.pbv2ActiveTreeVersionId, active.id))).returning(); if (!updated) throw new CanonicalProductPricingError("PRODUCT_PRICING_STALE", "The active pricing tree changed during propagation."); return { created, updated }; });
    return { changed: true, product: replacement.updated, activeTreeVersionId: replacement.created.id };
  }
}

export const canonicalProductPricingOperations = new CanonicalProductPricingOperations();

export function renderCanonicalProductPricingMigrationMarkdown(): string {
  return `# Shared canonical Product pricing migration\n\n> Generated from \`server/services/products/canonicalProductPricingOperations.ts\`. This is one completed slice of original migration item 9.\n\n| Pricing family | Canonical operation | UI usage | AI usage | Persistence / audit | Status |\n|---|---|---|---|---|---|\n| Product pricing metadata and PBV2 scalar base/basis | \`products.update_pricing.v1\` | Product Editor PATCH plus PBV2 DRAFT save | \`products.adjust_pricing\` for persisted scalar changes; canonical Product-intent proposal for basis | Existing PBV2 version replacement and pricing change sets | \`shared_canonical\` |\n| Complete PBV2 pricing matrix | \`products.replace_pricing_matrix.v1\` | Product Editor PBV2 DRAFT save | \`products.replace_inactive_matrix\` compatibility command | Exact inactive DRAFT transaction/idempotency | \`shared_canonical\` |\n| Complete PBV2 tier family | \`products.replace_quantity_tiers.v1\` | Product Editor PBV2 DRAFT save | \`products.replace_inactive_quantity_tiers\` compatibility command | Exact inactive DRAFT transaction/idempotency | \`shared_canonical\` |\n| PBV2 percentage option impact | \`products.update_option_percentage_impact.v1\` | Product Editor PBV2 DRAFT save | Canonical new-Product intent proposal; no broadened persisted-Product command | Existing PBV2 DRAFT persistence; quote evaluation unchanged | \`shared_canonical\` |\n| Persisted scalar pricing change set / rollback | compatibility IDs delegate to \`products.update_pricing.v1\` | No separate UI snapshot surface | \`products.adjust_pricing\`; \`products.rollback_pricing_change_set\` | Existing atomic snapshot/change-set records retained | \`compatibility_only\` identifier, shared handler |\n| Customer-specific pricing | deferred | Existing customer paths | Not broadened | Separate existing ownership | \`ui_only_not_migrated\` |\n\n## Pricing ownership\n\nPricing configuration and explicit missing-information state are validated here and persisted through Product/PBV2 operations. Quote and order pricing continue to be evaluated by the existing PBV2 pricing engine. No calculation formulas, rounding rules, matrix lookup, tier selection, minimum-charge behavior, percentage stacking order, or customer override behavior are reimplemented here.\n\n## Lifecycle and rollback\n\nMatrix and tier compatibility commands remain exact inactive-DRAFT operations. Scalar ACTIVE changes continue to create immutable replacement ACTIVE tree versions. Existing persisted pricing change sets, stale fingerprints, confirmation/GO, idempotency, audit attribution, and compensating rollback remain authoritative; this migration creates no second snapshot system.\n`;
}
