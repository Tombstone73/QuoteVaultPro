import { productDraftIntentFingerprint, type ProductDraftIntent, type UnresolvedQuestionAnswer } from "@shared/productDraftIntent";
import type { ProductIntentIssue } from "./productIntentResolver";
import type { ProductIntentCandidateAction, ProductIntentRecommendation } from "./productIntentInteractions";

export type CanonicalProductIntentProposalDto = {
  kind: "canonical_product_intent_proposal";
  revision: number;
  fingerprint: string;
  title: string;
  readiness: { ready: boolean; blockers: string[]; questions: string[] };
  requiredQuestions: Array<{ id: string; question: string; path: string; answer?: UnresolvedQuestionAnswer }>;
  candidateResolutions: ProductIntentCandidateAction[];
  optionalRecommendations: ProductIntentRecommendation[];
  fields: Record<string, string | string[]>;
};

function money(cents: number): string { return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100); }
function reference(value: ProductDraftIntent["material"], unresolvedLabel = "Not selected"): string { return value.state === "resolved" ? value.label : value.state === "explicitly_unset" ? unresolvedLabel : `Unresolved: ${value.label}`; }
function pricing(intent: ProductDraftIntent): string {
  const value = intent.pricing;
  if (value.model === "scalar") return `${money(value.priceCents)} ${value.unit === "per_square_foot" ? "per square foot" : value.unit === "per_piece" ? "per piece" : value.unit === "per_hour" ? "per hour" : "flat fee"}${value.minimumChargeCents == null ? "" : `; minimum ${money(value.minimumChargeCents)}`}`;
  if (value.model === "quantity_tiers") return `Quantity tiers ${value.unit === "per_piece" ? "per piece" : "per square foot"}: ${value.tiers.map((tier) => `${tier.minimumQuantity}${tier.maximumQuantity == null ? "+" : `–${tier.maximumQuantity}`}: ${money(tier.priceCents)}`).join(", ")}`;
  if (value.model === "option_quantity_tiers") return `${value.unit === "per_piece" ? "Per piece" : "Per square foot"} option quantity tiers (${value.rows.length} schedules)`;
  if (value.model === "one_dimensional_matrix" || value.model === "two_dimensional_matrix") return value.unit === "unresolved" ? `Matrix — pricing unit not selected (${value.cells.length} prices)` : `${value.unit === "per_square_foot" ? "Per square foot" : "Per piece"} matrix (${value.cells.length} prices)`;
  return "Unresolved";
}
function answerContract(intent: ProductDraftIntent, issue: ProductIntentIssue): UnresolvedQuestionAnswer | undefined {
  if (issue.id == null || issue.path !== "pricing.matrix.unit" || issue.code !== "PRICING_UNIT_UNRESOLVED" || (intent.pricing.model !== "one_dimensional_matrix" && intent.pricing.model !== "two_dimensional_matrix") || intent.pricing.unit !== "unresolved") return undefined;
  return { issueId: issue.id, canonicalPath: "pricing.matrix.unit", answerType: "choice", allowedChoices: [{ displayLabel: "Per piece", canonicalValue: "per_piece", safeAliases: ["per piece", "piece"] }, { displayLabel: "Per square foot", canonicalValue: "per_square_foot", safeAliases: ["per square foot", "square foot", "per sqft"] }], baseRevision: intent.revision };
}
/** Presentation is intentionally a pure projection of the canonical revision;
 * it never sees source text, legacy briefs, or a PBV2 tree. */
export function presentProductDraftIntent(intent: ProductDraftIntent, issues: readonly ProductIntentIssue[], interactions: { candidateResolutions?: ProductIntentCandidateAction[]; optionalRecommendations?: ProductIntentRecommendation[] } = {}): CanonicalProductIntentProposalDto {
  const candidateIssueIds = new Set((interactions.candidateResolutions ?? []).filter((action) => action.blocksConfirmation).map((action) => action.issueId));
  const visibleQuestions = issues.filter((issue) => issue.severity === "question" && !candidateIssueIds.has(issue.id ?? issue.code));
  const questions = visibleQuestions.map((issue) => issue.message);
  const blockers = issues.filter((issue) => issue.severity === "blocker").map((issue) => issue.message);
  const optionGroups = intent.optionGroups.map((group) => {
    const selectedDefault = group.values.find((value) => value.isDefault);
    const values = group.values.map((value) => `${value.label}${value.isDefault ? " (default)" : ""}`).join(", ");
    return group.selectionMode === "single" ? `${group.label}: ${values}; Default: ${selectedDefault?.label ?? "Not selected"}` : `${group.label}: ${values}`;
  });
  const deferredRequirements = [
    ...(intent.fieldMetadata["unsupportedDetails.customer_specific_availability"] ? ["Customer-specific availability (customer not yet resolved; no canonical Product operation is available)"] : []),
    ...(intent.fieldMetadata["unsupportedDetails.grommet_quantity"] ? ["Counted grommet quantity (not represented by the current Product option contract)"] : []),
  ];
  return {
    kind: "canonical_product_intent_proposal", revision: intent.revision, fingerprint: productDraftIntentFingerprint(intent), title: `Create inactive draft: ${intent.identity.name}`,
    readiness: { ready: blockers.length === 0 && questions.length === 0 && intent.state === "ready_for_review", blockers, questions },
    requiredQuestions: visibleQuestions.map((issue) => {
      const answer = answerContract(intent, issue);
      return { id: issue.id ?? issue.code, question: issue.message, path: issue.path, ...(answer ? { answer } : {}) };
    }),
    candidateResolutions: interactions.candidateResolutions ?? [], optionalRecommendations: interactions.optionalRecommendations ?? [],
    fields: {
      Product: intent.identity.name, Category: intent.identity.category.state === "resolved" ? intent.identity.category.label : "Not selected",
      Measurement: intent.fieldMetadata["measurement.mode"]?.source === "unresolved" ? "Not selected" : intent.measurement.mode === "fixed_size" ? `Fixed size: ${intent.measurement.dimensions.widthIn} × ${intent.measurement.dimensions.heightIn} in` : intent.measurement.mode === "dimensions_required" ? "Width and height required" : "Quantity only",
      Quantity: intent.quantity.behavior === "customer_entered" ? "Customer enters quantity" : intent.quantity.behavior === "fixed" ? `Fixed quantity: ${intent.quantity.quantity}` : "Not applicable",
      Pricing: pricing(intent), Material: reference(intent.material), Options: optionGroups,
      ...(deferredRequirements.length ? { "Deferred requirements": deferredRequirements } : {}),
      Proof: intent.workflow.requiresProofApproval ? "Required" : "Not required", "Production job": intent.workflow.requiresProductionJob ? "Required" : "Not required",
      "Production route": reference(intent.production.route, "Not set"), Lifecycle: "Inactive draft", Visibility: intent.visibility.catalogVisible ? "Visible" : "Hidden",
    },
  };
}
