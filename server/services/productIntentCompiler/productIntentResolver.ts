import { productDraftIntentSchema, type ProductDraftIntent } from "@shared/productDraftIntent";

export type ProductIntentIssue = {
  code: string;
  path: string;
  severity: "blocker" | "question";
  message: string;
};

export type ProductIntentResolutionContext = {
  categoryLabels: readonly string[];
  materialLabels?: readonly string[];
  productionRouteLabels?: readonly string[];
  duplicateName?: (name: string) => Promise<boolean> | boolean;
  /** Reuse the existing PBV2/Product Builder validator without granting the
   * resolver write access. */
  validatePbv2Compatibility?: (intent: ProductDraftIntent) => Promise<ProductIntentIssue[]> | ProductIntentIssue[];
};

function includesLabel(labels: readonly string[] | undefined, label: string): boolean {
  return (labels ?? []).some((candidate) => candidate.localeCompare(label, undefined, { sensitivity: "accent" }) === 0);
}

function validateTiers(intent: ProductDraftIntent, issues: ProductIntentIssue[]) {
  if (intent.pricing.model !== "quantity_tiers") return;
  const tiers = [...intent.pricing.tiers].sort((a, b) => a.minimumQuantity - b.minimumQuantity);
  let expected = 1;
  tiers.forEach((tier, index) => {
    if (tier.minimumQuantity !== expected) issues.push({ code: "QUANTITY_TIER_GAP", path: `pricing.tiers.${index}`, severity: "blocker", message: `Quantity tiers must start at ${expected} without a gap.` });
    if (tier.maximumQuantity != null && tier.maximumQuantity < tier.minimumQuantity) issues.push({ code: "QUANTITY_TIER_RANGE", path: `pricing.tiers.${index}`, severity: "blocker", message: "A tier maximum cannot be below its minimum." });
    if (index < tiers.length - 1 && tier.maximumQuantity == null) issues.push({ code: "QUANTITY_TIER_OPEN_ENDED", path: `pricing.tiers.${index}`, severity: "blocker", message: "Only the final quantity tier may be open ended." });
    expected = tier.maximumQuantity == null ? Number.MAX_SAFE_INTEGER : tier.maximumQuantity + 1;
  });
}

/** Deterministic only: no source-text parsing, inference, provider call, or DB write. */
export async function resolveAndValidateProductDraftIntent(rawIntent: unknown, context: ProductIntentResolutionContext): Promise<{ intent: ProductDraftIntent; issues: ProductIntentIssue[]; ready: boolean }> {
  const intent = productDraftIntentSchema.parse(rawIntent);
  const issues: ProductIntentIssue[] = [];
  if (intent.identity.category.state === "unresolved") issues.push({ code: "CATEGORY_UNRESOLVED", path: "identity.category", severity: "question", message: "Which product category should this use?" });
  else if (!includesLabel(context.categoryLabels, intent.identity.category.label)) issues.push({ code: "CATEGORY_NOT_FOUND", path: "identity.category", severity: "question", message: `The category ${intent.identity.category.label} is not available for this tenant.` });
  if (intent.material.state === "unresolved") issues.push({ code: "MATERIAL_UNRESOLVED", path: "material", severity: "question", message: "Which material should this product use?" });
  if (intent.material.state === "resolved" && !includesLabel(context.materialLabels, intent.material.label)) issues.push({ code: "MATERIAL_NOT_FOUND", path: "material", severity: "question", message: `The material ${intent.material.label} is not available for this tenant.` });
  if (intent.production.route.state === "unresolved") issues.push({ code: "ROUTE_UNRESOLVED", path: "production.route", severity: "question", message: "Which production route should this product use?" });
  if (intent.production.route.state === "resolved" && !includesLabel(context.productionRouteLabels, intent.production.route.label)) issues.push({ code: "ROUTE_NOT_FOUND", path: "production.route", severity: "question", message: `The production route ${intent.production.route.label} is not available for this tenant.` });
  if (intent.pricing.model === "unresolved") issues.push({ code: "PRICING_UNRESOLVED", path: "pricing.model", severity: "question", message: "Should pricing be per piece, per square foot, a matrix, or quantity tiers?" });
  for (const field of intent.unresolvedFields) issues.push({ code: field.code || "UNRESOLVED_FIELD", path: field.path, severity: "question", message: field.question ?? "This field needs a decision." });
  validateTiers(intent, issues);
  if (await context.duplicateName?.(intent.identity.name)) issues.push({ code: "DUPLICATE_PRODUCT_NAME", path: "identity.name", severity: "blocker", message: "A product with this name already exists; select it or explicitly request a clone." });
  issues.push(...(await context.validatePbv2Compatibility?.(intent) ?? []));
  return { intent, issues, ready: issues.length === 0 };
}
