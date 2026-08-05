import { productDraftIntentFingerprint, type ProductDraftIntent } from "@shared/productDraftIntent";
import type { ProductIntentIssue } from "./productIntentResolver";
import type { ProductIntentCandidateAction, ProductIntentRecommendation } from "./productIntentInteractions";

export type CanonicalProductIntentProposalDto = {
  kind: "canonical_product_intent_proposal";
  revision: number;
  fingerprint: string;
  title: string;
  readiness: { ready: boolean; blockers: string[]; questions: string[] };
  requiredQuestions: Array<{ id: string; question: string; path: string }>;
  candidateResolutions: ProductIntentCandidateAction[];
  optionalRecommendations: ProductIntentRecommendation[];
  fields: Record<string, string | string[]>;
};

function money(cents: number): string { return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100); }
function reference(value: ProductDraftIntent["material"]): string { return value.state === "resolved" ? value.label : value.state === "explicitly_unset" ? "No material selected" : "Unresolved"; }
function pricing(intent: ProductDraftIntent): string {
  const value = intent.pricing;
  if (value.model === "scalar") return `${money(value.priceCents)} ${value.unit === "per_square_foot" ? "per square foot" : value.unit === "per_piece" ? "per piece" : "flat fee"}${value.minimumChargeCents == null ? "" : `; minimum ${money(value.minimumChargeCents)}`}`;
  if (value.model === "quantity_tiers") return value.tiers.map((tier) => `${tier.minimumQuantity}${tier.maximumQuantity == null ? "+" : `–${tier.maximumQuantity}`}: ${money(tier.priceCents)}`).join(", ");
  if (value.model === "two_dimensional_matrix") return `${value.unit === "unresolved" ? "Pricing unit unresolved" : value.unit === "per_square_foot" ? "Per square foot" : "Per piece"} matrix (${value.cells.length} prices)`;
  return "Unresolved";
}

/** Presentation is intentionally a pure projection of the canonical revision;
 * it never sees source text, legacy briefs, or a PBV2 tree. */
export function presentProductDraftIntent(intent: ProductDraftIntent, issues: readonly ProductIntentIssue[], interactions: { candidateResolutions?: ProductIntentCandidateAction[]; optionalRecommendations?: ProductIntentRecommendation[] } = {}): CanonicalProductIntentProposalDto {
  const questions = issues.filter((issue) => issue.severity === "question").map((issue) => issue.message);
  const blockers = issues.filter((issue) => issue.severity === "blocker").map((issue) => issue.message);
  const optionGroups = intent.optionGroups.map((group) => `${group.label}: ${group.values.map((value) => `${value.label}${value.isDefault ? " (default)" : ""}`).join(", ")}`);
  return {
    kind: "canonical_product_intent_proposal", revision: intent.revision, fingerprint: productDraftIntentFingerprint(intent), title: `Create inactive draft: ${intent.identity.name}`,
    readiness: { ready: blockers.length === 0 && questions.length === 0 && intent.state === "ready_for_review", blockers, questions },
    requiredQuestions: issues.filter((issue) => issue.severity === "question").map((issue) => ({ id: issue.code, question: issue.message, path: issue.path })),
    candidateResolutions: interactions.candidateResolutions ?? [], optionalRecommendations: interactions.optionalRecommendations ?? [],
    fields: {
      Product: intent.identity.name, Category: intent.identity.category.label,
      Measurement: intent.measurement.mode === "fixed_size" ? `Fixed size: ${intent.measurement.dimensions.widthIn} × ${intent.measurement.dimensions.heightIn} in` : intent.measurement.mode === "dimensions_required" ? "Width and height required" : "Quantity only",
      Quantity: intent.quantity.behavior === "customer_entered" ? "Customer enters quantity" : intent.quantity.behavior === "fixed" ? `Fixed quantity: ${intent.quantity.quantity}` : "Not applicable",
      Pricing: pricing(intent), Material: reference(intent.material), Options: optionGroups,
      Proof: intent.workflow.requiresProofApproval ? "Required" : "Not required", "Production job": intent.workflow.requiresProductionJob ? "Required" : "Not required",
      "Production route": reference(intent.production.route), Lifecycle: "Inactive draft", Visibility: intent.visibility.catalogVisible ? "Visible" : "Hidden",
    },
  };
}
