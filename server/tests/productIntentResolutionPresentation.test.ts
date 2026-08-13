import { productDraftIntentFingerprint } from "@shared/productDraftIntent";
import { generateProductIntentCandidateActions, generateProductIntentRecommendations } from "../services/productIntentCompiler/productIntentInteractions";
import { presentProductDraftIntent } from "../services/productIntentCompiler/productIntentPresentation";
import { aggregateProductIntentIssues, resolveAndValidateProductDraftIntent, resolveProductDraftIntentReferences, type ProductIntentIssue } from "../services/productIntentCompiler/productIntentResolver";

const candidates = {
  categories: [{ id: "flatbed-printing", label: "Flatbed Printing" }, { id: "roll-printing", label: "Roll Printing" }, { id: "fees", label: "Fees" }, { id: "stock", label: "Stock Item" }],
  materials: [{ id: "pvc-3", label: "PVC - 3mm (Foamed PVC Sheets)" }],
  productionRoutes: [{ id: "flatbed", label: "Flatbed" }],
};

function yardSignsIntent(overrides: Record<string, unknown> = {}) {
  const base = {
    contractVersion: 1, intentId: "yard-signs-3", organizationId: "org-1", revision: 1, state: "compiling", operation: "new_product",
    identity: { name: "Yard Signs Test 3", description: "", category: { state: "unresolved", label: "Product category" } },
    lifecycle: { productStatus: "inactive", published: false }, measurement: { mode: "quantity_only" }, quantity: { behavior: "customer_entered", minimum: 1 },
    pricing: { model: "two_dimensional_matrix", unit: "unresolved", rowOptionKey: "thickness", columnOptionKey: "sides", cells: [{ row: "3mm", column: "single", priceCents: 1200 }, { row: "3mm", column: "double", priceCents: 1800 }, { row: "6mm", column: "single", priceCents: 1600 }, { row: "6mm", column: "double", priceCents: 2200 }] },
    material: { state: "resolved", id: "provider-guessed-pvc", label: "PVC - 3mm (Foamed PVC Sheets)" },
    optionGroups: [
      { key: "thickness", label: "Thickness", required: true, selectionMode: "single", values: [{ key: "3mm", label: "3mm", isDefault: true }, { key: "6mm", label: "6mm", isDefault: false }] },
      { key: "sides", label: "Sides", required: true, selectionMode: "single", values: [{ key: "single", label: "Single-sided", isDefault: true }, { key: "double", label: "Double-sided", isDefault: false }] },
    ],
    workflow: { kind: "standard_production", requiresProofApproval: false, requiresProductionJob: true }, production: { route: { state: "resolved", id: "provider-guessed-flatbed", label: "Flatbed" }, configuration: {} }, visibility: { catalogVisible: false },
    unresolvedFields: [{ path: "pricing.unit", code: "PRICING_UNIT_UNRESOLVED", question: "Are these matrix prices per piece or per square foot?" }],
    fieldMetadata: { "identity.category": { source: "ai_interpreted", confidence: 0.5 }, material: { source: "ai_interpreted", confidence: 0.5 }, "production.route": { source: "ai_interpreted", confidence: 0.5 }, "pricing.unit": { source: "unresolved" } },
    revisionMetadata: { parentRevision: 0 }, operationContext: {},
  };
  return { ...base, ...overrides };
}

describe("canonical Product Intent issue aggregation and presentation", () => {
  test("keeps the Yard Signs matrix while deduplicating its pricing-unit issue", async () => {
    const resolved = resolveProductDraftIntentReferences(yardSignsIntent(), candidates);
    const validation = await resolveAndValidateProductDraftIntent(resolved, { categoryLabels: candidates.categories.map((item) => item.label), materialLabels: candidates.materials.map((item) => item.label), productionRouteLabels: candidates.productionRoutes.map((item) => item.label) });
    const pricingIssues = validation.issues.filter((issue) => issue.path === "pricing.matrix.unit");
    expect(pricingIssues).toHaveLength(1);
    expect(pricingIssues[0]).toMatchObject({ id: "1:pricing.matrix.unit:required", code: "PRICING_UNIT_UNRESOLVED" });
    expect(validation.intent.pricing).toMatchObject({ unit: "unresolved", cells: expect.arrayContaining([{ row: "3mm", column: "single", priceCents: 1200 }, { row: "6mm", column: "double", priceCents: 2200 }]) });
  });

  test("renders a candidate-backed category issue once, not as a free-text question", async () => {
    const resolved = resolveProductDraftIntentReferences(yardSignsIntent(), candidates);
    const validation = await resolveAndValidateProductDraftIntent(resolved, { categoryLabels: candidates.categories.map((item) => item.label), materialLabels: candidates.materials.map((item) => item.label), productionRouteLabels: candidates.productionRoutes.map((item) => item.label) });
    const fingerprint = productDraftIntentFingerprint(validation.intent);
    const actions = generateProductIntentCandidateActions(validation.intent, fingerprint, validation.issues, candidates);
    const card = presentProductDraftIntent(validation.intent, validation.issues, { candidateResolutions: actions, optionalRecommendations: generateProductIntentRecommendations(validation.intent, fingerprint) });
    expect(card.fields).toMatchObject({ Category: "Not selected", Material: "PVC - 3mm (Foamed PVC Sheets)", "Production route": "Not set", Pricing: "Matrix — pricing unit not selected (4 prices)" });
    expect(card.candidateResolutions.filter((action) => action.kind === "select_category")).toHaveLength(candidates.categories.length);
    expect(card.requiredQuestions).toEqual([expect.objectContaining({ id: "1:pricing.matrix.unit:required", path: "pricing.matrix.unit" })]);
    expect(card.readiness.ready).toBe(false);
    expect(card.optionalRecommendations).toEqual(expect.arrayContaining([expect.objectContaining({ kind: "enable_proof_approval" })]));
  });

  test("resolves a unique exact material through server candidates but not a low-confidence route guess", () => {
    const resolved = resolveProductDraftIntentReferences(yardSignsIntent(), candidates);
    expect(resolved.material).toEqual({ state: "resolved", id: "pvc-3", label: "PVC - 3mm (Foamed PVC Sheets)" });
    expect(resolved.production.route).toEqual({ state: "explicitly_unset" });
    expect(resolved.optionGroups[0]!.values.map((value) => value.key)).toEqual(["3mm", "6mm"]);
  });

  test("allows an exact tenant template route but not a generic category placeholder", () => {
    const raw = yardSignsIntent({ production: { route: { state: "unresolved", label: "Flatbed" }, configuration: {} }, fieldMetadata: { "identity.category": { source: "ai_interpreted", confidence: 0.5 }, material: { source: "unresolved" }, "production.route": { source: "selected_template" }, "pricing.unit": { source: "unresolved" } } });
    const resolved = resolveProductDraftIntentReferences(raw, candidates);
    expect(resolved.production.route).toEqual({ state: "resolved", id: "flatbed", label: "Flatbed" });
    expect(resolved.identity.category).toEqual({ state: "unresolved", label: "Product category" });
  });

  test("does not merge unrelated issues that merely share display text", () => {
    const intent = resolveProductDraftIntentReferences(yardSignsIntent(), candidates);
    const issues: ProductIntentIssue[] = [
      { code: "FIRST", path: "identity.category", severity: "question", message: "Choose a value." },
      { code: "SECOND", path: "production.route", severity: "question", message: "Choose a value." },
    ];
    expect(aggregateProductIntentIssues(intent, issues)).toHaveLength(2);
  });

  test("keeps unsupported customer-specific availability visible without inventing an executable operation", () => {
    const intent = resolveProductDraftIntentReferences(yardSignsIntent({
      fieldMetadata: { ...yardSignsIntent().fieldMetadata, "unsupportedDetails.customer_specific_availability": { source: "explicit_user" } },
    }), candidates);
    const card = presentProductDraftIntent(intent as any, []);
    expect(card.fields["Deferred requirements"]).toEqual([expect.stringContaining("Customer-specific availability")]);
    expect(card.readiness.ready).toBe(false);
  });
});
