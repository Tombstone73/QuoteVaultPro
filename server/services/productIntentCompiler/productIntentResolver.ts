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
  const tiers = [...intent.pricing.tiers].sort((a, b) => a.minQuantity - b.minQuantity);
  let expected = 1;
  tiers.forEach((tier, index) => {
    if (tier.minQuantity !== expected) issues.push({ code: "QUANTITY_TIER_GAP", path: `pricing.tiers.${index}`, severity: "blocker", message: `Quantity tiers must start at ${expected} without a gap.` });
    if (tier.maxQuantity != null && tier.maxQuantity < tier.minQuantity) issues.push({ code: "QUANTITY_TIER_RANGE", path: `pricing.tiers.${index}`, severity: "blocker", message: "A tier maximum cannot be below its minimum." });
    if (index < tiers.length - 1 && tier.maxQuantity == null) issues.push({ code: "QUANTITY_TIER_OPEN_ENDED", path: `pricing.tiers.${index}`, severity: "blocker", message: "Only the final quantity tier may be open ended." });
    expected = tier.maxQuantity == null ? Number.MAX_SAFE_INTEGER : tier.maxQuantity + 1;
  });
}

/** Deterministic only: no source-text parsing, inference, provider call, or DB write. */
export async function resolveAndValidateProductDraftIntent(rawIntent: unknown, context: ProductIntentResolutionContext): Promise<{ intent: ProductDraftIntent; issues: ProductIntentIssue[]; ready: boolean }> {
  const intent = productDraftIntentSchema.parse(rawIntent);
  const issues: ProductIntentIssue[] = [];
  if (!intent.identity.category) issues.push({ code: "CATEGORY_UNRESOLVED", path: "identity.category", severity: "question", message: "Which product category should this use?" });
  else if (!includesLabel(context.categoryLabels, intent.identity.category.label)) issues.push({ code: "CATEGORY_NOT_FOUND", path: "identity.category", severity: "question", message: `The category ${intent.identity.category.label} is not available for this tenant.` });
  if (intent.material.state === "resolved" && !includesLabel(context.materialLabels, intent.material.material.label)) issues.push({ code: "MATERIAL_NOT_FOUND", path: "material", severity: "question", message: `The material ${intent.material.material.label} is not available for this tenant.` });
  if (intent.workflow.productionRoute && !includesLabel(context.productionRouteLabels, intent.workflow.productionRoute.label)) issues.push({ code: "ROUTE_NOT_FOUND", path: "workflow.productionRoute", severity: "question", message: `The production route ${intent.workflow.productionRoute.label} is not available for this tenant.` });
  if (intent.pricing.model === "unresolved") issues.push({ code: "PRICING_UNRESOLVED", path: "pricing.model", severity: "question", message: "Should pricing be per piece, per square foot, a matrix, or quantity tiers?" });
  if (intent.measurement.mode === "unresolved") issues.push({ code: "MEASUREMENT_UNRESOLVED", path: "measurement.mode", severity: "question", message: "Does this product require dimensions, use a fixed size, or use quantity only?" });
  for (const field of intent.unresolvedFields) issues.push({ code: "UNRESOLVED_FIELD", path: field.path, severity: field.operationallySignificant ? "blocker" : "question", message: field.reason });
  validateTiers(intent, issues);
  if (await context.duplicateName?.(intent.identity.name.label)) issues.push({ code: "DUPLICATE_PRODUCT_NAME", path: "identity.name", severity: "blocker", message: "A product with this name already exists; select it or explicitly request a clone." });
  issues.push(...(await context.validatePbv2Compatibility?.(intent) ?? []));
  return { intent, issues, ready: issues.length === 0 };
}
