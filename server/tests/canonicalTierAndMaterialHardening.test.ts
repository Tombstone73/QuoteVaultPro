import { jest } from "@jest/globals";
import { resolvePricingV2BaseRates } from "@shared/pbv2/pricingAdapter";
import { productDraftIntentSchema } from "@shared/productDraftIntent";
import { CanonicalProductIntentService } from "../services/productIntentCompiler/canonicalProductIntentService";
import { ProductIntentCompiler } from "../services/productIntentCompiler/productIntentCompiler";
import { generateProductIntentCandidateActions } from "../services/productIntentCompiler/productIntentInteractions";
import { ProductIntentPersistenceService, type CanonicalProductIntentProposalRow, type CanonicalProductIntentProposalStore } from "../services/productIntentCompiler/productIntentPersistence";
import { projectProductDraftIntentToProductBuilderDraft } from "../services/productIntentCompiler/productIntentProjection";
import { resolveAndValidateProductDraftIntent } from "../services/productIntentCompiler/productIntentResolver";

class MemoryStore implements CanonicalProductIntentProposalStore {
  rows = new Map<string, CanonicalProductIntentProposalRow>();
  async insert(input: Omit<CanonicalProductIntentProposalRow, "createdAt" | "updatedAt">) { const row = { ...structuredClone(input), createdAt: new Date(), updatedAt: new Date() }; this.rows.set(row.id, row); return structuredClone(row); }
  async getById(input: { organizationId: string; proposalId: string }) { const row = this.rows.get(input.proposalId); return row?.organizationId === input.organizationId ? structuredClone(row) : null; }
  async getByConversation(input: { organizationId: string; conversationId: string }) { return structuredClone(Array.from(this.rows.values()).find((row) => row.organizationId === input.organizationId && row.conversationId === input.conversationId) ?? null); }
  async compareAndSet(input: Parameters<CanonicalProductIntentProposalStore["compareAndSet"]>[0]) { const row = this.rows.get(input.proposalId); if (!row) return null; const next = { ...row, specification: structuredClone(input.specification), fingerprint: input.fingerprint, status: input.status, updatedAt: new Date() }; this.rows.set(next.id, next); return structuredClone(next); }
}

const compilerInput = (request: string) => ({ orgId: "org-1", request, operationContext: { operation: "new_product" }, schemaDescription: "Product intent", allowedEnums: {}, supportedArchetypes: [], serverConstraints: [] });

function tierPayload() {
  return {
    kind: "complete_intent",
    intent: {
      operation: "new_product", identity: { name: "Sticker Tier Test", description: "", category: { state: "unresolved", label: "Product category" } }, lifecycle: { productStatus: "inactive", published: false },
      measurement: { mode: "quantity_only" }, quantity: { behavior: "customer_entered", minimum: 1 },
      // Deliberately PBV2-shaped: the compiler boundary must translate these
      // structural aliases without accepting a different canonical contract.
      pricing: { model: "quantity_tiers", unit: "per_piece", tiers: [{ minQty: 1, maxQty: 24, perPieceCents: 300 }, { minQty: 25, maxQty: 49, perPieceCents: 250 }, { minQty: 50, perPieceCents: 200 }] },
      material: { state: "explicitly_unset" }, optionGroups: [], workflow: { kind: "standard_production", requiresProofApproval: false, requiresProductionJob: true }, production: { route: { state: "explicitly_unset" }, configuration: {} }, visibility: { catalogVisible: false }, unresolvedFields: [], fieldMetadata: { "identity.category": { source: "unresolved" }, material: { source: "unresolved" } },
    },
  };
}

function fixedSizePayload(materialLabel: string) {
  return {
    kind: "complete_intent",
    intent: {
      operation: "new_product", identity: { name: "18x24 Coroplast Test", description: "", category: { state: "unresolved", label: "Product category" } }, lifecycle: { productStatus: "inactive", published: false },
      measurement: { mode: "fixed_size", dimensions: { widthIn: 18, heightIn: 24, allowRotation: false } }, quantity: { behavior: "customer_entered", minimum: 1 }, pricing: { model: "scalar", unit: "per_piece", priceCents: 1500 },
      material: { state: "resolved", id: "provider-coroplast", label: materialLabel }, optionGroups: [], workflow: { kind: "standard_production", requiresProofApproval: false, requiresProductionJob: true }, production: { route: { state: "explicitly_unset" }, configuration: {} }, visibility: { catalogVisible: false }, unresolvedFields: [], fieldMetadata: { "identity.category": { source: "unresolved" }, material: { source: "explicit_user", confidence: 1 } },
    },
  };
}

describe("canonical quantity-tier and material hardening", () => {
  test("normalizes the Sticker Tier provider fixture, persists revision zero, and keeps category resolution separate", async () => {
    const provider = jest.fn(async () => ({ rawText: JSON.stringify(tierPayload()), provider: "openai_compatible", model: "deepseek-test", requestMetadata: {} }));
    const service = new CanonicalProductIntentService(new ProductIntentCompiler({ generateJson: provider }), new ProductIntentPersistenceService(new MemoryStore()), { categories: [{ id: "signs", label: "Signs" }], materials: [], productionRoutes: [] });
    const result = await service.create({ organizationId: "org-1", actorUserId: "user-1", conversationId: "sticker-tiers", compilerInput: compilerInput("Create Sticker Tier Test at $3 each for quantities 1 through 24, $2.50 each for 25 through 49, and $2 each for 50 or more. Customer-entered quantity.") });

    expect(result).toMatchObject({ ok: true, session: { specification: { session: { currentRevision: 0 } } } });
    if (!result.ok) throw new Error("Expected tier session.");
    expect(result.session.specification.session.revisions).toHaveLength(1);
    expect(result.session.specification.session.revisions[0]!.intent).toMatchObject({ measurement: { mode: "quantity_only" }, quantity: { behavior: "customer_entered" }, material: { state: "explicitly_unset" }, pricing: { model: "quantity_tiers", unit: "per_piece", tiers: [{ minimumQuantity: 1, maximumQuantity: 24, priceCents: 300 }, { minimumQuantity: 25, maximumQuantity: 49, priceCents: 250 }, { minimumQuantity: 50, maximumQuantity: null, priceCents: 200 }] } });
    expect(result.card.fields.Pricing).toContain("Quantity tiers per piece");
    expect(result.issues).toEqual([expect.objectContaining({ code: "CATEGORY_UNRESOLVED" })]);
    expect(provider).toHaveBeenCalledTimes(1);
  });

  test.each([
    [1, 300, 300], [24, 300, 7200], [25, 250, 6250], [49, 250, 12250], [50, 200, 10000], [100, 200, 20000],
  ])("projects quantity tiers and evaluates quantity %i at the correct all-units rate", (quantity, unitCents, totalCents) => {
    const source = productDraftIntentSchema.parse({
      contractVersion: 1, intentId: "tier-intent", organizationId: "org-1", revision: 0, state: "ready_for_review", operation: "new_product", identity: { name: "Sticker Tier Test", description: "", category: { state: "resolved", id: "signs", label: "Signs" } }, lifecycle: { productStatus: "inactive", published: false }, measurement: { mode: "quantity_only" }, quantity: { behavior: "customer_entered", minimum: 1 }, pricing: { model: "quantity_tiers", unit: "per_piece", tiers: [{ minimumQuantity: 1, maximumQuantity: 24, priceCents: 300 }, { minimumQuantity: 25, maximumQuantity: 49, priceCents: 250 }, { minimumQuantity: 50, maximumQuantity: null, priceCents: 200 }] }, material: { state: "explicitly_unset" }, optionGroups: [], workflow: { kind: "standard_production", requiresProofApproval: false, requiresProductionJob: true }, production: { route: { state: "explicitly_unset" }, configuration: {} }, visibility: { catalogVisible: false }, unresolvedFields: [], fieldMetadata: {}, revisionMetadata: { parentRevision: null }, operationContext: {},
    });
    const projected = projectProductDraftIntentToProductBuilderDraft(source);
    expect(projected.product).toMatchObject({ measurementMode: "quantity_only", pricingProfileKey: "qty_only" });
    expect((projected.treeJson.meta as any).productIntake.quantity).toMatchObject({ configured: true, behavior: "customer_entered", mapping: { pricingBehavior: "quantity_tiers", variable: "q" } });
    const evaluated = resolvePricingV2BaseRates(projected.treeJson, {}, { quantity, widthIn: 0, heightIn: 0, sqft: 0 });
    expect(evaluated.perPieceCents).toBe(unitCents);
    expect(evaluated.perPieceCents * quantity).toBe(totalCents);
  });

  test("rejects quantity-tier overlap and non-final open ranges", async () => {
    const base = productDraftIntentSchema.parse({
      contractVersion: 1, intentId: "invalid-tier-intent", organizationId: "org-1", revision: 0, state: "compiling", operation: "new_product", identity: { name: "Invalid tiers", description: "", category: { state: "resolved", id: "signs", label: "Signs" } }, lifecycle: { productStatus: "inactive", published: false }, measurement: { mode: "quantity_only" }, quantity: { behavior: "customer_entered", minimum: 1 }, pricing: { model: "quantity_tiers", unit: "per_piece", tiers: [{ minimumQuantity: 1, maximumQuantity: 24, priceCents: 300 }, { minimumQuantity: 25, maximumQuantity: null, priceCents: 250 }, { minimumQuantity: 50, maximumQuantity: 99, priceCents: 200 }] }, material: { state: "explicitly_unset" }, optionGroups: [], workflow: { kind: "standard_production", requiresProofApproval: false, requiresProductionJob: true }, production: { route: { state: "explicitly_unset" }, configuration: {} }, visibility: { catalogVisible: false }, unresolvedFields: [], fieldMetadata: {}, revisionMetadata: { parentRevision: null }, operationContext: {},
    });
    const validation = await resolveAndValidateProductDraftIntent(base, { categoryLabels: ["Signs"] });
    expect(validation.issues.map((issue) => issue.code)).toEqual(expect.arrayContaining(["QUANTITY_TIER_OPEN_ENDED", "QUANTITY_TIER_OVERLAP"]));
  });

  test("rejects a finite final quantity tier", async () => {
    const source = productDraftIntentSchema.parse({
      contractVersion: 1, intentId: "finite-final-tier", organizationId: "org-1", revision: 0, state: "compiling", operation: "new_product", identity: { name: "Finite final", description: "", category: { state: "resolved", id: "signs", label: "Signs" } }, lifecycle: { productStatus: "inactive", published: false }, measurement: { mode: "quantity_only" }, quantity: { behavior: "customer_entered", minimum: 1 }, pricing: { model: "quantity_tiers", unit: "per_piece", tiers: [{ minimumQuantity: 1, maximumQuantity: 24, priceCents: 300 }, { minimumQuantity: 25, maximumQuantity: 49, priceCents: 250 }] }, material: { state: "explicitly_unset" }, optionGroups: [], workflow: { kind: "standard_production", requiresProofApproval: false, requiresProductionJob: true }, production: { route: { state: "explicitly_unset" }, configuration: {} }, visibility: { catalogVisible: false }, unresolvedFields: [], fieldMetadata: {}, revisionMetadata: { parentRevision: null }, operationContext: {},
    });
    const validation = await resolveAndValidateProductDraftIntent(source, { categoryLabels: ["Signs"] });
    expect(validation.issues).toEqual(expect.arrayContaining([expect.objectContaining({ code: "QUANTITY_TIER_FINAL_OPEN_ENDED" })]));
  });

  test("does not let generic Coroplast wording select Coroplast 4mm, while explicit 4mm wording remains eligible for exact tenant resolution", async () => {
    const candidates = { categories: [], materials: [{ id: "coroplast-4", label: "Coroplast 4mm" }], productionRoutes: [] };
    const generic = new CanonicalProductIntentService(new ProductIntentCompiler({ generateJson: jest.fn(async () => ({ rawText: JSON.stringify(fixedSizePayload("Coroplast 4mm")), provider: "openai_compatible", model: "deepseek-test", requestMetadata: {} })) }), new ProductIntentPersistenceService(new MemoryStore()), candidates);
    const genericResult = await generic.create({ organizationId: "org-1", actorUserId: "user-1", conversationId: "generic-coroplast", compilerInput: compilerInput("Create 18x24 Coroplast Test. It is a fixed 18 inch by 24 inch product priced at $15 per piece with customer-entered quantity.") });
    if (!genericResult.ok) throw new Error("Expected generic material session.");
    expect(genericResult.session.specification.session.revisions[0]!.intent).toMatchObject({ material: { state: "unresolved" }, measurement: { mode: "fixed_size", dimensions: { widthIn: 18, heightIn: 24 } }, pricing: { model: "scalar", unit: "per_piece", priceCents: 1500 } });

    const explicit = new CanonicalProductIntentService(new ProductIntentCompiler({ generateJson: jest.fn(async () => ({ rawText: JSON.stringify(fixedSizePayload("Coroplast 4mm")), provider: "openai_compatible", model: "deepseek-test", requestMetadata: {} })) }), new ProductIntentPersistenceService(new MemoryStore()), candidates);
    const explicitResult = await explicit.create({ organizationId: "org-1", actorUserId: "user-1", conversationId: "explicit-coroplast", compilerInput: compilerInput("Create a fixed 18 by 24 inch 4mm Coroplast product at $15 per piece with customer-entered quantity.") });
    if (!explicitResult.ok) throw new Error("Expected explicit material session.");
    expect(explicitResult.session.specification.session.revisions[0]!.intent.material).toEqual({ state: "resolved", id: "coroplast-4", label: "Coroplast 4mm" });
  });

  test.each([
    ["Vinyl", "Gloss Vinyl", "Create a Vinyl Test at $15 per piece with customer-entered quantity."],
    ["Acrylic", "Acrylic 1/8", "Create an Acrylic Test at $15 per piece with customer-entered quantity."],
  ])("does not let generic %s wording select the specific tenant material %s", async (_family, label, request) => {
    const service = new CanonicalProductIntentService(new ProductIntentCompiler({ generateJson: jest.fn(async () => ({ rawText: JSON.stringify(fixedSizePayload(label)), provider: "openai_compatible", model: "deepseek-test", requestMetadata: {} })) }), new ProductIntentPersistenceService(new MemoryStore()), { categories: [], materials: [{ id: "specific-material", label }], productionRoutes: [] });
    const result = await service.create({ organizationId: "org-1", actorUserId: "user-1", conversationId: `generic-${_family}`, compilerInput: compilerInput(request) });
    if (!result.ok) throw new Error("Expected generic material session.");
    expect(result.session.specification.session.revisions[0]!.intent.material).toMatchObject({ state: "unresolved" });
  });

  test("keeps generic Coroplast material optional, suggests only relevant capped choices, and persists an explicit recommendation selection", async () => {
    const materials = [
      { id: "coroplast-10", label: "Coroplast 10mm" }, { id: "coroplast-4", label: "Coroplast 4mm" }, { id: "coroplast-3", label: "Coroplast 3mm" },
      { id: "coroplast-6", label: "Coroplast 6mm" }, { id: "coroplast-white", label: "Coroplast White" }, { id: "coroplast-black", label: "Coroplast Black" },
      { id: "banner", label: "Banner Material" }, { id: "laminate", label: "Gloss Laminate" }, { id: "vinyl", label: "Adhesive Vinyl" }, { id: "pvc", label: "PVC 3mm" },
    ];
    const service = new CanonicalProductIntentService(new ProductIntentCompiler({
      generateJson: jest.fn(async () => ({ rawText: JSON.stringify(fixedSizePayload("Coroplast 4mm")), provider: "openai_compatible", model: "deepseek-test", requestMetadata: {} })),
    }), new ProductIntentPersistenceService(new MemoryStore()), { categories: [{ id: "signs", label: "Signs" }], materials, productionRoutes: [] });
    const created = await service.create({ organizationId: "org-1", actorUserId: "user-1", conversationId: "coroplast-optional", compilerInput: compilerInput("Create a new product called 18x24 Coroplast Test 3. It is a fixed 18 inch by 24 inch product priced at $15 per piece with customer-entered quantity.") });
    if (!created.ok) throw new Error("Expected Coroplast session.");
    expect(created.session.specification.session.revisions[0]!.intent).toMatchObject({
      material: { state: "unresolved" }, measurement: { mode: "fixed_size", dimensions: { widthIn: 18, heightIn: 24 } },
      quantity: { behavior: "customer_entered" }, pricing: { model: "scalar", unit: "per_piece", priceCents: 1500 }, production: { route: { state: "explicitly_unset" } },
    });
    expect(created.issues).toEqual([expect.objectContaining({ code: "CATEGORY_UNRESOLVED" })]);
    expect(created.card.candidateResolutions.map((action) => action.kind)).toEqual(["select_category"]);
    const materialRecommendations = created.card.optionalRecommendations.filter((item) => item.kind === "select_material");
    expect(materialRecommendations).toHaveLength(5);
    expect(materialRecommendations.map((item) => item.title)).toEqual([
      "Select Coroplast 3mm", "Select Coroplast 4mm", "Select Coroplast 6mm", "Select Coroplast 10mm", "Select Coroplast Black",
    ]);
    expect(materialRecommendations.map((item) => item.title).join(" ")).not.toMatch(/Banner|Laminate|Vinyl|PVC/);

    const category = created.card.candidateResolutions[0]!;
    const categorized = await service.applyCandidateAction({ organizationId: "org-1", actorUserId: "user-1", proposalId: created.session.proposalId, actionId: category.id });
    if (!categorized.outcome?.ok) throw new Error("Expected category selection.");
    expect(categorized.outcome.card.readiness).toEqual({ ready: true, blockers: [], questions: [] });
    expect(categorized.outcome.session.specification.session.revisions.at(-1)!.intent.material).toMatchObject({ state: "unresolved" });

    const secondSuggestion = categorized.outcome.card.optionalRecommendations.find((item) => item.kind === "select_material" && item.title === "Select Coroplast 10mm");
    if (!secondSuggestion) throw new Error("Expected optional Coroplast 10mm suggestion.");
    const dismissed = await service.dismissRecommendation({ organizationId: "org-1", actorUserId: "user-1", proposalId: created.session.proposalId, recommendationId: secondSuggestion.id });
    expect(dismissed.ok).toBe(true);
    expect(dismissed.session.specification.session.currentRevision).toBe(1);

    const selectedSuggestion = dismissed.card.optionalRecommendations.find((item) => item.kind === "select_material" && item.title === "Select Coroplast 4mm");
    if (!selectedSuggestion) throw new Error("Expected optional Coroplast 4mm suggestion.");
    const selected = await service.acceptRecommendation({ organizationId: "org-1", actorUserId: "user-1", proposalId: created.session.proposalId, recommendationId: selectedSuggestion.id });
    if (!selected.ok) throw new Error("Expected material selection to persist.");
    const selectedIntent = selected.session.specification.session.revisions.at(-1)!.intent;
    expect(selected.session.specification.session.currentRevision).toBe(2);
    expect(selectedIntent).toMatchObject({
      material: { state: "resolved", id: "coroplast-4", label: "Coroplast 4mm" }, fieldMetadata: { material: { source: "explicit_user" } },
      measurement: { mode: "fixed_size", dimensions: { widthIn: 18, heightIn: 24 } }, pricing: { model: "scalar", unit: "per_piece", priceCents: 1500 }, production: { route: { state: "explicitly_unset" } },
    });
  });

  test("blocks unresolved material only when a server-owned deterministic requirement says it is needed", async () => {
    const intent = productDraftIntentSchema.parse({
      contractVersion: 1, intentId: "required-material", organizationId: "org-1", revision: 0, state: "compiling", operation: "new_product",
      identity: { name: "Coroplast Sign", description: "", category: { state: "resolved", id: "signs", label: "Signs" } }, lifecycle: { productStatus: "inactive", published: false },
      measurement: { mode: "fixed_size", dimensions: { widthIn: 18, heightIn: 24, allowRotation: false } }, quantity: { behavior: "customer_entered", minimum: 1 }, pricing: { model: "scalar", unit: "per_piece", priceCents: 1500 },
      material: { state: "unresolved", label: "Coroplast" }, optionGroups: [], workflow: { kind: "standard_production", requiresProofApproval: false, requiresProductionJob: true }, production: { route: { state: "explicitly_unset" }, configuration: { materialDependentEvaluator: true } }, visibility: { catalogVisible: false }, unresolvedFields: [], fieldMetadata: { material: { source: "unresolved" } }, revisionMetadata: { parentRevision: null }, operationContext: {},
    });
    const materials = [{ id: "c4", label: "Coroplast 4mm" }, { id: "c10", label: "Coroplast 10mm" }, { id: "banner", label: "Banner Material" }, { id: "vinyl", label: "Adhesive Vinyl" }];
    const context = { categoryLabels: ["Signs"], materialLabels: materials.map((item) => item.label), requiresMaterial: (value: typeof intent) => value.production.configuration.materialDependentEvaluator === true };
    const validation = await resolveAndValidateProductDraftIntent(intent, context);
    expect(validation.ready).toBe(false);
    expect(validation.issues).toEqual([expect.objectContaining({ code: "MATERIAL_UNRESOLVED", path: "material" })]);
    const actions = generateProductIntentCandidateActions(validation.intent, "a".repeat(64), validation.issues, { categories: [], materials, productionRoutes: [] });
    expect(actions.map((action) => action.candidate?.label)).toEqual(["Coroplast 4mm", "Coroplast 10mm"]);

    const explicitlyUnset = await resolveAndValidateProductDraftIntent({ ...intent, material: { state: "explicitly_unset" } }, context);
    expect(explicitlyUnset.issues).toEqual([]);
  });

  test("preserves a selected-template material and rejects zero-cent tier prices at the canonical schema boundary", async () => {
    const payload = fixedSizePayload("Coroplast 4mm");
    payload.intent.fieldMetadata.material = { source: "selected_template" };
    const service = new CanonicalProductIntentService(new ProductIntentCompiler({ generateJson: jest.fn(async () => ({ rawText: JSON.stringify(payload), provider: "openai_compatible", model: "deepseek-test", requestMetadata: {} })) }), new ProductIntentPersistenceService(new MemoryStore()), { categories: [], materials: [{ id: "coroplast-4", label: "Coroplast 4mm" }], productionRoutes: [] });
    const result = await service.create({ organizationId: "org-1", actorUserId: "user-1", conversationId: "template-coroplast", compilerInput: compilerInput("Create a Coroplast product at $15 per piece.") });
    if (!result.ok) throw new Error("Expected template material session.");
    expect(result.session.specification.session.revisions[0]!.intent.material).toEqual({ state: "resolved", id: "coroplast-4", label: "Coroplast 4mm" });
    expect(() => productDraftIntentSchema.parse({ ...result.session.specification.session.revisions[0]!.intent, pricing: { model: "quantity_tiers", unit: "per_piece", tiers: [{ minimumQuantity: 1, maximumQuantity: null, priceCents: 0 }] } })).toThrow();
  });
});
