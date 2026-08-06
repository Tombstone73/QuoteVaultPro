import { productDraftIntentSchema, type ProductDraftIntent } from "@shared/productDraftIntent";

export type TenantIntentReference = { id: string; label: string };

export type ProductIntentIssue = {
  /** Stable per-revision semantic identity used by persistence and presentation. */
  id?: string;
  code: string;
  path: string;
  severity: "blocker" | "question";
  message: string;
};

export type ProductIntentResolutionContext = {
  categoryLabels: readonly string[];
  materialLabels?: readonly string[];
  productionRouteLabels?: readonly string[];
  /** A server-owned Product Builder rule. This must be a pure, deterministic
   * decision based on the canonical intent; a material search hint, tenant
   * inventory, or production-job flag alone must never make material required. */
  requiresMaterial?: (intent: ProductDraftIntent) => boolean;
  duplicateName?: (name: string) => Promise<boolean> | boolean;
  /** Reuse the existing PBV2/Product Builder validator without granting the
   * resolver write access. */
  validatePbv2Compatibility?: (intent: ProductDraftIntent) => Promise<ProductIntentIssue[]> | ProductIntentIssue[];
};

type ReferenceField = "identity.category" | "material" | "production.route";
const genericReferenceLabels = new Set(["product category", "category", "material", "production route", "route", "default category", "unknown", "unspecified"]);

function normalizedLabel(value: string): string { return value.trim().replace(/\s+/g, " ").toLocaleLowerCase(); }
function isGenericReferenceLabel(value: string): boolean { return genericReferenceLabels.has(normalizedLabel(value)); }
function includesLabel(labels: readonly string[] | undefined, label: string): boolean { return (labels ?? []).some((candidate) => candidate.localeCompare(label, undefined, { sensitivity: "accent" }) === 0); }

function mayResolveOperationalReference(intent: ProductDraftIntent, field: ReferenceField): boolean {
  const metadata = intent.fieldMetadata[field];
  if (!metadata) return false;
  if (["explicit_user", "selected_template", "canonical_default"].includes(metadata.source)) return true;
  return metadata.source === "ai_interpreted" && (metadata.confidence ?? 0) >= 0.95;
}

function canonicalIssuePath(path: string): string { return path === "pricing.unit" ? "pricing.matrix.unit" : path; }
function semanticIssueId(revision: number, issue: ProductIntentIssue): string {
  const resolution = ["CATEGORY_UNRESOLVED", "CATEGORY_NOT_FOUND", "MATERIAL_UNRESOLVED", "MATERIAL_NOT_FOUND", "ROUTE_UNRESOLVED", "ROUTE_NOT_FOUND"].includes(issue.code) ? "candidate" : "required";
  return `${revision}:${canonicalIssuePath(issue.path)}:${resolution}`;
}

/** Deduplicate only semantically identical field-resolution issues. Different
 * fields with the same wording remain separate. */
export function aggregateProductIntentIssues(intent: ProductDraftIntent, issues: readonly ProductIntentIssue[]): ProductIntentIssue[] {
  const byId = new Map<string, ProductIntentIssue>();
  for (const issue of issues) {
    const id = issue.id ?? semanticIssueId(intent.revision, issue);
    if (!byId.has(id)) byId.set(id, { ...issue, id, path: canonicalIssuePath(issue.path) });
  }
  return Array.from(byId.values());
}

/** The canonical contract permits a material-free draft by default. Product
 * Builder integrations may opt in only with an established deterministic rule
 * (for example, a selected template whose evaluator requires material). */
export function isMaterialRequired(intent: ProductDraftIntent, context: Pick<ProductIntentResolutionContext, "requiresMaterial"> = {}): boolean {
  return context.requiresMaterial?.(intent) === true;
}

/** Resolves only exact, tenant-owned labels with an allowed field source. A
 * provider cannot select operations-critical tenant references by guessing an
 * ID, by fuzzy similarity, or from option values. */
export function resolveProductDraftIntentReferences(rawIntent: unknown, candidates: {
  categories: readonly TenantIntentReference[];
  materials: readonly TenantIntentReference[];
  productionRoutes: readonly TenantIntentReference[];
}): ProductDraftIntent {
  const intent = structuredClone(productDraftIntentSchema.parse(rawIntent));
  const resolve = (reference: any, values: readonly TenantIntentReference[], field: ReferenceField, fallback: "unresolved" | "explicitly_unset") => {
    if (reference.state === "explicitly_unset") return reference;
    const label = String(reference.label ?? "").trim();
    const matches = !label || isGenericReferenceLabel(label) ? [] : values.filter((value) => value.label.localeCompare(label, undefined, { sensitivity: "accent" }) === 0);
    if (matches.length === 1 && mayResolveOperationalReference(intent, field)) return { state: "resolved", id: matches[0]!.id, label: matches[0]!.label };
    return fallback === "explicitly_unset" ? { state: "explicitly_unset" } : { state: "unresolved", label: label || "Not selected" };
  };
  intent.identity.category = resolve(intent.identity.category, candidates.categories, "identity.category", "unresolved");
  // Retain an unresolved material hint. It is distinct from an explicit choice
  // to leave material unset and can safely drive a nonblocking, relevant
  // suggestion when material is optional.
  intent.material = resolve(intent.material, candidates.materials, "material", "unresolved");
  intent.production.route = resolve(intent.production.route, candidates.productionRoutes, "production.route", "explicitly_unset");
  return productDraftIntentSchema.parse(intent);
}

function validateTiers(intent: ProductDraftIntent, issues: ProductIntentIssue[]) {
  if (intent.pricing.model !== "quantity_tiers") return;
  const tiers = intent.pricing.tiers;
  let expected = 1;
  tiers.forEach((tier, index) => {
    if (tier.minimumQuantity < expected) issues.push({ code: "QUANTITY_TIER_OVERLAP", path: `pricing.tiers.${index}`, severity: "blocker", message: "Quantity tiers overlap or are out of order." });
    else if (tier.minimumQuantity !== expected) issues.push({ code: "QUANTITY_TIER_GAP", path: `pricing.tiers.${index}`, severity: "blocker", message: `Quantity tiers must start at ${expected} without a gap.` });
    if (tier.maximumQuantity != null && tier.maximumQuantity < tier.minimumQuantity) issues.push({ code: "QUANTITY_TIER_RANGE", path: `pricing.tiers.${index}`, severity: "blocker", message: "A tier maximum cannot be below its minimum." });
    if (index < tiers.length - 1 && tier.maximumQuantity == null) issues.push({ code: "QUANTITY_TIER_OPEN_ENDED", path: `pricing.tiers.${index}`, severity: "blocker", message: "Only the final quantity tier may be open ended." });
    if (index === tiers.length - 1 && tier.maximumQuantity != null) issues.push({ code: "QUANTITY_TIER_FINAL_OPEN_ENDED", path: `pricing.tiers.${index}`, severity: "blocker", message: "The final quantity tier must be open ended." });
    expected = tier.maximumQuantity == null ? Number.MAX_SAFE_INTEGER : tier.maximumQuantity + 1;
  });
}

/** Deterministic only: no source-text parsing, inference, provider call, or DB write. */
export async function resolveAndValidateProductDraftIntent(rawIntent: unknown, context: ProductIntentResolutionContext): Promise<{ intent: ProductDraftIntent; issues: ProductIntentIssue[]; ready: boolean }> {
  const intent = productDraftIntentSchema.parse(rawIntent);
  const issues: ProductIntentIssue[] = [];
  if (intent.identity.category.state === "unresolved") issues.push({ code: "CATEGORY_UNRESOLVED", path: "identity.category", severity: "question", message: "Choose a product category." });
  else if (!includesLabel(context.categoryLabels, intent.identity.category.label)) issues.push({ code: "CATEGORY_NOT_FOUND", path: "identity.category", severity: "question", message: `The category ${intent.identity.category.label} is not available for this tenant.` });
  const materialRequired = isMaterialRequired(intent, context);
  if (intent.material.state === "unresolved" && materialRequired) issues.push({ code: "MATERIAL_UNRESOLVED", path: "material", severity: "question", message: "Which material should this product use?" });
  if (intent.material.state === "resolved" && !includesLabel(context.materialLabels, intent.material.label)) issues.push({ code: "MATERIAL_NOT_FOUND", path: "material", severity: "question", message: `The material ${intent.material.label} is not available for this tenant.` });
  if (intent.production.route.state === "unresolved") issues.push({ code: "ROUTE_UNRESOLVED", path: "production.route", severity: "question", message: "Which production route should this product use?" });
  if (intent.production.route.state === "resolved" && !includesLabel(context.productionRouteLabels, intent.production.route.label)) issues.push({ code: "ROUTE_NOT_FOUND", path: "production.route", severity: "question", message: `The production route ${intent.production.route.label} is not available for this tenant.` });
  if (intent.pricing.model === "unresolved") issues.push({ code: "PRICING_UNRESOLVED", path: "pricing.model", severity: "question", message: "Should pricing be per piece, per square foot, a matrix, or quantity tiers?" });
  if (intent.pricing.model === "two_dimensional_matrix" && intent.pricing.unit === "unresolved") issues.push({ code: "PRICING_UNIT_UNRESOLVED", path: "pricing.unit", severity: "question", message: "Are these matrix prices per piece or per square foot?" });
  for (const field of intent.unresolvedFields) {
    // The material reference above owns material readiness. An optional
    // unresolved material must not reappear as a generic blocking question.
    if (field.path === "material") continue;
    issues.push({ code: field.code || "UNRESOLVED_FIELD", path: field.path, severity: "question", message: field.question ?? "This field needs a decision." });
  }
  validateTiers(intent, issues);
  if (await context.duplicateName?.(intent.identity.name)) issues.push({ code: "DUPLICATE_PRODUCT_NAME", path: "identity.name", severity: "blocker", message: "A product with this name already exists; select it or explicitly request a clone." });
  // PBV2 projection is meaningful only after canonical resolution succeeds;
  // otherwise it repeats ordinary unanswered-field feedback as a blocker.
  if (issues.length === 0) issues.push(...(await context.validatePbv2Compatibility?.(intent) ?? []));
  const aggregated = aggregateProductIntentIssues(intent, issues);
  return { intent, issues: aggregated, ready: aggregated.length === 0 };
}
