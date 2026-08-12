import { jest } from "@jest/globals";
import { z } from "zod";
import { CanonicalProductIntentService } from "../services/productIntentCompiler/canonicalProductIntentService";
import { ProductIntentCompiler } from "../services/productIntentCompiler/productIntentCompiler";
import { ProductIntentPersistenceService, type CanonicalProductIntentProposalRow, type CanonicalProductIntentProposalStore } from "../services/productIntentCompiler/productIntentPersistence";

const yardSignsPayload = {
  kind: "complete_intent",
  intent: {
    operation: "new_product",
    identity: { name: "Yard Signs Test 3", description: "", category: { state: "unresolved", label: "Product category" } },
    lifecycle: { productStatus: "inactive", published: false }, measurement: { mode: "quantity_only" }, quantity: { behavior: "customer_entered", minimum: 1 },
    pricing: { model: "two_dimensional_matrix", unit: "unresolved", rowOptionKey: "thickness", columnOptionKey: "sides", cells: [{ row: "3mm", column: "single", priceCents: 1200 }, { row: "3mm", column: "double", priceCents: 1800 }, { row: "6mm", column: "single", priceCents: 1600 }, { row: "6mm", column: "double", priceCents: 2200 }] },
    material: { state: "resolved", id: "provider-guessed-pvc", label: "PVC - 3mm (Foamed PVC Sheets)" },
    optionGroups: [{ key: "thickness", label: "Thickness", required: true, selectionMode: "single", values: [{ key: "3mm", label: "3mm", isDefault: true }, { key: "6mm", label: "6mm", isDefault: false }] }, { key: "sides", label: "Sides", required: true, selectionMode: "single", values: [{ key: "single", label: "Single-sided", isDefault: true }, { key: "double", label: "Double-sided", isDefault: false }] }],
    workflow: { kind: "standard_production", requiresProofApproval: false, requiresProductionJob: true }, production: { route: { state: "resolved", id: "provider-guessed-flatbed", label: "Flatbed" }, configuration: {} }, visibility: { catalogVisible: false },
    unresolvedFields: [{ path: "pricing.unit", code: "PRICING_UNIT_UNRESOLVED", question: "Are these matrix prices per piece or per square foot?" }],
    fieldMetadata: { "identity.category": { source: "ai_interpreted", confidence: 0.5 }, material: { source: "ai_interpreted", confidence: 0.5 }, "production.route": { source: "ai_interpreted", confidence: 0.5 }, "pricing.unit": { source: "unresolved" }, "optionGroups.thickness.default": { source: "selected_template" }, "optionGroups.sides.default": { source: "selected_template" } },
  },
};

const translucentVinylPayload = {
  kind: "complete_intent",
  intent: {
    operation: "new_product",
    identity: { name: "Translucent Vinyl - Multilayer Print Test 6", description: "", category: { state: "unresolved", label: "Product category" } },
    lifecycle: { productStatus: "inactive", published: false }, measurement: { mode: "dimensions_required" }, quantity: { behavior: "customer_entered", minimum: 1 },
    pricing: { model: "two_dimensional_matrix", unit: "per_square_foot", rowOptionKey: "layers", columnOptionKey: "surface", cells: [
      { row: "3_layers", column: "first_surface", priceCents: 500 }, { row: "3_layers", column: "second_surface", priceCents: 500 },
      { row: "5_layers", column: "first_surface", priceCents: 600 }, { row: "5_layers", column: "second_surface", priceCents: 600 },
    ] },
    material: { state: "explicitly_unset" },
    optionGroups: [
      { key: "surface", label: "Surface", required: true, selectionMode: "single", values: [{ key: "first_surface", label: "1st Surface (Right Reading)", isDefault: false }, { key: "second_surface", label: "2nd Surface (Reverse Printed)", isDefault: false }] },
      { key: "layers", label: "Layers", required: true, selectionMode: "single", values: [{ key: "3_layers", label: "3 Layers", isDefault: false }, { key: "5_layers", label: "5 Layers", isDefault: false }] },
      { key: "finishing", label: "Finishing", required: true, selectionMode: "single", values: [{ key: "none", label: "None", isDefault: false, priceImpact: { kind: "percentage_of_base", percent: 0 } }, { key: "contour_cutting", label: "Contour Cutting", isDefault: false, priceImpact: { kind: "percentage_of_base", percent: 10 } }, { key: "contour_cutting_weed_tape", label: "Contour Cutting + Weed and Tape", isDefault: false, priceImpact: { kind: "percentage_of_base", percent: 30 } }] },
    ],
    workflow: { kind: "standard_production", requiresProofApproval: false, requiresProductionJob: true }, production: { route: { state: "explicitly_unset" }, configuration: {} }, visibility: { catalogVisible: false },
    unresolvedFields: [], fieldMetadata: { material: { source: "unresolved" }, "production.route": { source: "unresolved" } },
  },
};

class MemoryStore implements CanonicalProductIntentProposalStore {
  rows = new Map<string, CanonicalProductIntentProposalRow>();
  async insert(input: Omit<CanonicalProductIntentProposalRow, "createdAt" | "updatedAt">) { const row = { ...structuredClone(input), createdAt: new Date(), updatedAt: new Date() }; this.rows.set(row.id, row); return structuredClone(row); }
  async getById(input: { organizationId: string; proposalId: string }) { const row = this.rows.get(input.proposalId); return row?.organizationId === input.organizationId ? structuredClone(row) : null; }
  async getByConversation(input: { organizationId: string; conversationId: string }) { return structuredClone(Array.from(this.rows.values()).find((row) => row.organizationId === input.organizationId && row.conversationId === input.conversationId) ?? null); }
  async compareAndSet(input: Parameters<CanonicalProductIntentProposalStore["compareAndSet"]>[0]) { const row = this.rows.get(input.proposalId); if (!row) return null; const next = { ...row, specification: structuredClone(input.specification), fingerprint: input.fingerprint, status: input.status, updatedAt: new Date() }; this.rows.set(next.id, next); return structuredClone(next); }
}

function compilerInput() {
  return { orgId: "org-1", request: "Create Yard Signs Test 3", operationContext: { operation: "new_product" }, schemaDescription: "Product intent", allowedEnums: {}, supportedArchetypes: [], serverConstraints: [] };
}

describe("CanonicalProductIntentService compiler failures", () => {
  test("persists nothing and has no legacy fallback when both compiler attempts fail", async () => {
    const compiler = new ProductIntentCompiler({
      generateJson: jest.fn(async () => ({ rawText: "not-json", provider: "openai_compatible", model: "deepseek-test", requestMetadata: {} })),
    });
    const persistence = { create: jest.fn() } as any;
    const service = new CanonicalProductIntentService(compiler, persistence, { categories: [], materials: [], productionRoutes: [] });

    const result = await service.create({
      organizationId: "org-1", actorUserId: "user-1", conversationId: "conversation-1",
      compilerInput: {
        orgId: "org-1", request: "Create Yard Signs Test", operationContext: { operation: "new_product" }, schemaDescription: "Product intent", allowedEnums: {}, supportedArchetypes: [], serverConstraints: [],
      },
    });

    expect(result).toMatchObject({ ok: false, code: "invalid_json" });
    expect(persistence.create).not.toHaveBeenCalled();
  });

  test("persists the complex translucent-vinyl intent at revision zero without creating a product before GO", async () => {
    const store = new MemoryStore();
    const service = new CanonicalProductIntentService(new ProductIntentCompiler({
      generateJson: jest.fn(async () => ({ rawText: JSON.stringify(translucentVinylPayload), provider: "openai_compatible", model: "deepseek-test", requestMetadata: {} })),
    }), new ProductIntentPersistenceService(store), {
      categories: [{ id: "signs", label: "Signs" }], materials: [{ id: "translucent-vinyl", label: "Translucent Vinyl" }], productionRoutes: [{ id: "roll", label: "Roll Printing" }],
    });

    const result = await service.create({ organizationId: "org-1", actorUserId: "user-1", conversationId: "translucent-vinyl-6", compilerInput: { ...compilerInput(), request: "Create Translucent Vinyl - Multilayer Print Test 6 with surface, 3/5 layer square-foot pricing, contour cutting, and weed/tape." } });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("Expected the complex canonical session to persist.");
    const persisted = result.session.specification.session.revisions[0]!.intent;
    expect(result.session.specification.session.currentRevision).toBe(0);
    expect(result.session.specification.session.revisions).toHaveLength(1);
    expect(store.rows.size).toBe(1);
    expect(persisted).toMatchObject({ state: "needs_answers", measurement: { mode: "dimensions_required" }, quantity: { behavior: "customer_entered" }, material: { state: "explicitly_unset" }, production: { route: { state: "explicitly_unset" } }, workflow: { requiresProductionJob: true, requiresProofApproval: false } });
    expect(persisted.optionGroups.map((group) => group.key)).toEqual(["surface", "layers", "finishing"]);
    expect(persisted.optionGroups.find((group) => group.key === "surface")?.values.every((value) => !value.isDefault)).toBe(true);
    expect(persisted.optionGroups.find((group) => group.key === "layers")?.values.every((value) => !value.isDefault)).toBe(true);
    expect(persisted.optionGroups.find((group) => group.key === "finishing")?.required).toBe(false);
    expect(persisted.optionGroups.find((group) => group.key === "finishing")?.values.find((value) => value.isDefault)?.key).toBe("none");
    expect(persisted.fieldMetadata["optionGroups.finishing.default"]).toEqual({ source: "canonical_default" });
    expect(persisted.fieldMetadata["workflow.requiresProofApproval"]).toEqual({ source: "canonical_default" });
    expect(persisted.fieldMetadata["workflow.requiresProductionJob"]).toEqual({ source: "canonical_default" });
    expect(result.card.fields).toMatchObject({ "Proof provenance": "Authoritative server default", "Production-job provenance": "Authoritative server default" });
    expect(result.issues).toEqual(expect.arrayContaining([expect.objectContaining({ code: "CATEGORY_UNRESOLVED", path: "identity.category" }), expect.objectContaining({ code: "OPTION_DEFAULT_UNRESOLVED", path: "optionGroups.surface.default" }), expect.objectContaining({ code: "OPTION_DEFAULT_UNRESOLVED", path: "optionGroups.layers.default" })]));
    expect(result.card.requiredQuestions).toEqual(expect.arrayContaining([expect.objectContaining({ path: "optionGroups.surface.default" }), expect.objectContaining({ path: "optionGroups.layers.default" })]));
    expect(result.card.requiredQuestions).not.toEqual(expect.arrayContaining([expect.objectContaining({ path: "optionGroups.finishing.default" })]));
    expect(result.card.fields.Options).toEqual(expect.arrayContaining([
      expect.stringContaining("Surface: 1st Surface (Right Reading), 2nd Surface (Reverse Printed); Default: Not selected"),
      expect.stringContaining("Layers: 3 Layers, 5 Layers; Default: Not selected"),
      expect.stringContaining("Finishing: None (default), Contour Cutting, Contour Cutting + Weed and Tape; Default: None"),
    ]));
    expect(result.card.candidateResolutions.filter((action) => action.kind === "select_category")).toHaveLength(1);
  });

  test("builds the exact Translucent Vinyl draft through direct Operator business operations without a compiler", async () => {
    const store = new MemoryStore();
    const service = new CanonicalProductIntentService(null, new ProductIntentPersistenceService(store), {
      categories: [{ id: "flatbed", label: "Flatbed Printing" }, { id: "roll", label: "Roll Printing" }], materials: [], productionRoutes: [],
    });
    const begun = await service.begin({ organizationId: "org-1", actorUserId: "user-1", conversationId: "operator-translucent-vinyl" });
    expect(begun).toMatchObject({ ok: true, card: { readiness: { ready: false } } });
    if (!begun.ok) throw new Error("Expected a server-owned unfinished draft.");
    expect(begun.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: "identity.name" }),
      expect.objectContaining({ path: "measurement.mode" }),
      expect.objectContaining({ path: "identity.category" }),
      expect.objectContaining({ path: "pricing.model" }),
    ]));

    const request = "Let's add a new product called \"Translucent Vinyl - backlit with multilayer printing\". Layers are 3 Layer and 5 Layer. 3 Layer is $4 per square foot and 5 Layer is $5 per square foot. Contour Cutting adds 10%. Weeding and Taping appears only when Contour Cutting is Yes, and is 30% total instead of the 10% increase.";
    const created = await service.applySemanticOperations({
      organizationId: "org-1", actorUserId: "user-1", proposalId: begun.session.proposalId, request,
      operations: [
        { op: "set_product_name", name: "Translucent Vinyl - backlit" },
        { op: "add_option_group", optionGroup: "Layers", required: true, selectionMode: "single" },
        { op: "add_option_value", optionGroup: "Layers", value: "3 Layer" },
        { op: "add_option_value", optionGroup: "Layers", value: "5 Layer" },
        { op: "set_option_rate", optionGroup: "Layers", value: "3 Layer", priceCents: 400, basis: "per_square_foot" },
        { op: "set_option_rate", optionGroup: "Layers", value: "5 Layer", priceCents: 500, basis: "per_square_foot" },
        { op: "add_option_group", optionGroup: "Contour Cutting", required: false, selectionMode: "single" },
        { op: "add_option_value", optionGroup: "Contour Cutting", value: "No" },
        { op: "add_option_value", optionGroup: "Contour Cutting", value: "Yes" },
        { op: "set_option_price_impact", optionGroup: "Contour Cutting", value: "Yes", percent: 10 },
        { op: "add_option_group", optionGroup: "Weeding and Taping", required: false, selectionMode: "single" },
        { op: "add_option_value", optionGroup: "Weeding and Taping", value: "No" },
        { op: "add_option_value", optionGroup: "Weeding and Taping", value: "Yes" },
        { op: "set_option_group_availability", optionGroup: "Weeding and Taping", whenOptionGroup: "Contour Cutting", whenValue: "Yes" },
        { op: "set_option_price_impact", optionGroup: "Weeding and Taping", value: "Yes", percent: 30, replacesPercentageWhen: { optionGroup: "Contour Cutting", value: "Yes" } },
      ],
    });
    expect(created.ok).toBe(true);
    if (!created.ok) throw new Error("Expected direct business operations to persist.");
    const intent = created.session.specification.session.revisions.at(-1)!.intent;
    expect(intent).toMatchObject({
      identity: { name: "Translucent Vinyl - backlit with multilayer printing", category: { state: "unresolved", label: "Product category" } },
      lifecycle: { productStatus: "inactive", published: false },
      measurement: { mode: "dimensions_required" },
      pricing: { model: "one_dimensional_matrix", unit: "per_square_foot", optionKey: "layers", cells: [{ option: "3_layer", priceCents: 400 }, { option: "5_layer", priceCents: 500 }] },
      material: { state: "explicitly_unset" }, production: { route: { state: "explicitly_unset" } },
    });
    const contour = intent.optionGroups.find((group) => group.key === "contour_cutting");
    const weedTape = intent.optionGroups.find((group) => group.key === "weeding_and_taping");
    expect(contour?.values.find((value) => value.key === "yes")?.priceImpact).toEqual({ kind: "percentage_of_base", percent: 10 });
    expect(weedTape).toMatchObject({ availableWhen: { optionGroupKey: "contour_cutting", optionValueKey: "yes" } });
    expect(weedTape?.values.find((value) => value.key === "yes")).toMatchObject({
      totalPercentOfBaseWhenEnabled: { percent: 30, prerequisite: { optionGroupKey: "contour_cutting", optionValueKey: "yes" } },
    });
    expect(weedTape?.values.find((value) => value.key === "yes")?.priceImpact).toBeUndefined();
    expect(created.issues.map((issue) => issue.path)).toEqual(expect.arrayContaining(["identity.category", "optionGroups.layers.default"]));
    expect(created.issues.map((issue) => issue.path)).not.toEqual(expect.arrayContaining(["identity.name", "measurement.mode", "pricing.model", "pricing.unit", "material", "production.route"]));

    const defaulted = await service.applySemanticOperations({ organizationId: "org-1", actorUserId: "user-1", proposalId: begun.session.proposalId, request: "3 layer is default", operations: [{ op: "set_option_default", optionGroup: "Layers", value: "3 Layer" }] });
    expect(defaulted.ok).toBe(true);
    if (!defaulted.ok) throw new Error("Expected the outstanding Layers default to persist directly.");
    const afterDefault = defaulted.session.specification.session.revisions.at(-1)!.intent;
    expect(afterDefault.optionGroups.find((group) => group.key === "layers")?.values.find((value) => value.isDefault)?.label).toBe("3 Layer");
    expect(afterDefault.pricing).toEqual(intent.pricing);
    expect(afterDefault.optionGroups.find((group) => group.key === "contour_cutting")).toEqual(intent.optionGroups.find((group) => group.key === "contour_cutting"));

    const flatbed = await service.applySemanticOperations({ organizationId: "org-1", actorUserId: "user-1", proposalId: begun.session.proposalId, request: "Use Flatbed Printing.", operations: [{ op: "set_category", category: "Flatbed Printing" }] });
    expect(flatbed.ok).toBe(true);
    const corrected = await service.applySemanticOperations({ organizationId: "org-1", actorUserId: "user-1", proposalId: begun.session.proposalId, request: "I accidentally selected Flatbed Printing; use Roll Printing.", operations: [{ op: "set_category", category: "Roll Printing" }] });
    expect(corrected.ok).toBe(true);
    if (!corrected.ok) throw new Error("Expected direct Roll correction to persist.");
    expect(corrected.session.specification.session.revisions).toHaveLength(5);
    expect(corrected.session.specification.session.revisions.at(-1)!.intent.identity.category).toEqual({ state: "resolved", id: "roll", label: "Roll Printing" });
  });

  test("creates the exact live one-axis Translucent Vinyl intent and asks only genuine missing decisions", async () => {
    const payload = structuredClone(translucentVinylPayload);
    payload.intent.identity.name = "Translucent Vinyl - backlit with multilayer printing";
    payload.intent.pricing = { model: "one_dimensional_matrix", unit: "per_square_foot", optionKey: "layers", cells: [{ option: "three", priceCents: 400 }, { option: "five", priceCents: 500 }] } as any;
    payload.intent.optionGroups = [
      { key: "layers", label: "Layers", required: true, selectionMode: "single", values: [{ key: "three", label: "3 Layer", isDefault: false }, { key: "five", label: "5 Layer", isDefault: false }] },
      { key: "contour", label: "Contour Cutting", required: true, selectionMode: "single", values: [{ key: "no", label: "No", isDefault: false }, { key: "yes", label: "Yes", isDefault: false, priceImpact: { kind: "percentage_of_base", percent: 10 } }] },
      { key: "weed_tape", label: "Weeding and Taping", required: false, selectionMode: "single", availableWhen: { optionGroupKey: "contour", optionValueKey: "yes" }, values: [{ key: "no", label: "No", isDefault: false }, { key: "yes", label: "Yes", isDefault: false, totalPercentOfBaseWhenEnabled: { percent: 30, prerequisite: { optionGroupKey: "contour", optionValueKey: "yes" } } }] },
    ] as any;
    payload.intent.fieldMetadata = { material: { source: "unresolved" }, "production.route": { source: "unresolved" } };
    const service = new CanonicalProductIntentService(new ProductIntentCompiler({ generateJson: jest.fn(async () => ({ rawText: JSON.stringify(payload), provider: "openai_compatible", model: "deepseek-v4-flash", requestMetadata: {} })) }), new ProductIntentPersistenceService(new MemoryStore()), { categories: [{ id: "print-products", label: "Print Products" }], materials: [], productionRoutes: [] });
    const request = "Let's add a new product called \"Translucent Vinyl - backlit with multilayer printing\". It should have an option for 3 layer or 5 layer. 3 layer is $4 sq ft and 5 layer is $5 sq ft. Another option is contour cutting. Contour cutting adds 10% to the total price. If the answer is yes, then an additional option appears that is for weeding and taping. If they want weeding and taping, instead of a 10% increase, the price increase 30%.";

    const result = await service.create({ organizationId: "org-1", actorUserId: "user-1", conversationId: "exact-live-translucent", compilerInput: { ...compilerInput(), request } });

    expect(result).toMatchObject({ ok: true, card: { readiness: { ready: false } } });
    if (!result.ok) throw new Error("Expected a canonical intent.");
    const intent = result.session.specification.session.revisions[0]!.intent;
    expect(intent).toMatchObject({ state: "needs_answers", lifecycle: { productStatus: "inactive", published: false }, measurement: { mode: "dimensions_required" }, pricing: { model: "one_dimensional_matrix", unit: "per_square_foot", optionKey: "layers", cells: [{ option: "three", priceCents: 400 }, { option: "five", priceCents: 500 }] }, material: { state: "explicitly_unset" }, production: { route: { state: "explicitly_unset" } } });
    expect(intent.optionGroups.map((group) => group.key)).toEqual(["layers", "contour", "weed_tape"]);
    expect(result.issues).toEqual(expect.arrayContaining([expect.objectContaining({ code: "CATEGORY_UNRESOLVED" }), expect.objectContaining({ path: "optionGroups.layers.default" }), expect.objectContaining({ path: "optionGroups.contour.default" })]));
    expect(result.issues).not.toEqual(expect.arrayContaining([expect.objectContaining({ path: "optionGroups.weed_tape.default" })]));

    const followUp = await service.continue({ organizationId: "org-1", actorUserId: "user-1", proposalId: result.session.proposalId, request: "3 layer should be the default and contour cutting should default to no.", compilerInput: compilerInput() });
    expect(followUp).toMatchObject({ ok: true });
    if (!followUp.ok) throw new Error("Expected both requested defaults to persist.");
    const revised = followUp.session.specification.session.revisions.at(-1)!.intent;
    expect(followUp.session.specification.session.revisions).toHaveLength(2);
    expect(revised.optionGroups.find((group) => group.key === "layers")?.values.find((value) => value.isDefault)?.key).toBe("three");
    expect(revised.optionGroups.find((group) => group.key === "contour")?.values.find((value) => value.isDefault)?.key).toBe("no");
    expect(revised.optionGroups.find((group) => group.key === "weed_tape")?.values.some((value) => value.isDefault)).toBe(false);
  });

  test("does not turn an AI-suggested category into canonical state when the user did not name that capability", async () => {
    const payload = structuredClone(translucentVinylPayload);
    payload.intent.identity.category = { state: "resolved", id: "flatbed-printing", label: "Flatbed Printing" };
    payload.intent.fieldMetadata["identity.category"] = { source: "ai_interpreted", confidence: 1 };
    const service = new CanonicalProductIntentService(new ProductIntentCompiler({
      generateJson: async () => ({ rawText: JSON.stringify(payload), provider: "openai_compatible", model: "provider-bound-test", requestMetadata: {} }),
    }), new ProductIntentPersistenceService(new MemoryStore()), {
      categories: [{ id: "flatbed-printing", label: "Flatbed Printing" }], materials: [], productionRoutes: [],
    });
    const result = await service.create({ organizationId: "org-1", actorUserId: "user-1", conversationId: "ai-category-guard", compilerInput: { ...compilerInput(), request: "Create a translucent vinyl product with layered printing." } });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("Expected a saved canonical intent.");
    const intent = result.session.specification.session.revisions[0]!.intent;
    expect(intent.identity.category).toMatchObject({ state: "unresolved", label: "Flatbed Printing" });
    expect(intent.fieldMetadata["identity.category"]).toEqual({ source: "unresolved" });
    expect(result.card.fields["Category provenance"]).toBe("Unresolved");
  });

  test("does not mislabel a provider-invented category as user supplied", async () => {
    const payload = structuredClone(translucentVinylPayload);
    payload.intent.identity.category = { state: "resolved", id: "flatbed-printing", label: "Flatbed Printing" };
    payload.intent.fieldMetadata["identity.category"] = { source: "explicit_user" };
    const service = new CanonicalProductIntentService(new ProductIntentCompiler({ generateJson: async () => ({ rawText: JSON.stringify(payload), provider: "openai_compatible", model: "provider-bound-test", requestMetadata: {} }) }), new ProductIntentPersistenceService(new MemoryStore()), { categories: [{ id: "flatbed-printing", label: "Flatbed Printing" }], materials: [], productionRoutes: [] });

    const result = await service.create({ organizationId: "org-1", actorUserId: "user-1", conversationId: "invented-category", compilerInput: { ...compilerInput(), request: "Create translucent vinyl with layered printing." } });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("Expected a canonical intent.");
    expect(result.session.specification.session.revisions[0]!.intent.fieldMetadata["identity.category"]).toEqual({ source: "unresolved" });
    expect(result.card.fields["Category provenance"]).toBe("Unresolved");
  });

  test("continues the same canonical product with an explicit roll-printing category correction", async () => {
    const payload = structuredClone(translucentVinylPayload);
    payload.intent.identity.category = { state: "resolved", id: "flatbed", label: "Flatbed Printing" };
    payload.intent.fieldMetadata["identity.category"] = { source: "explicit_user" };
    const provider = jest.fn(async (input: any) => {
      const request = JSON.parse(input.user);
      return request.currentBusinessContext
        ? { rawText: JSON.stringify({ kind: "semantic_operations", operations: [{ op: "set_category", category: "Roll Printing" }] }), provider: "openai_compatible", model: "deepseek-test", requestMetadata: {} }
        : { rawText: JSON.stringify(payload), provider: "openai_compatible", model: "deepseek-test", requestMetadata: {} };
    });
    const store = new MemoryStore();
    const service = new CanonicalProductIntentService(new ProductIntentCompiler({ generateJson: provider }), new ProductIntentPersistenceService(store), { categories: [{ id: "flatbed", label: "Flatbed Printing" }, { id: "roll", label: "Roll Printing" }], materials: [], productionRoutes: [] });
    const created = await service.create({ organizationId: "org-1", actorUserId: "user-1", conversationId: "roll-correction", compilerInput: { ...compilerInput(), request: "Create Translucent Vinyl - Multilayer Print Test 6 using Flatbed Printing." } });
    if (!created.ok) throw new Error("Expected the active canonical product.");
    const before = created.session.specification.session.revisions[0]!.intent;

    const corrected = await service.continue({ organizationId: "org-1", actorUserId: "user-1", proposalId: created.session.proposalId, request: "I accidentally selected flatbed printing, but this would be roll printing.", compilerInput: compilerInput() });

    expect(corrected.ok).toBe(true);
    if (!corrected.ok) throw new Error("Expected category correction to persist.");
    const after = corrected.session.specification.session.revisions.at(-1)!.intent;
    expect(corrected.session.proposalId).toBe(created.session.proposalId);
    expect(corrected.session.specification.session.revisions).toHaveLength(2);
    expect(after.identity.category).toEqual({ state: "resolved", id: "roll", label: "Roll Printing" });
    expect(after.fieldMetadata["identity.category"]).toEqual({ source: "explicit_user" });
    expect(after.optionGroups).toEqual(before.optionGroups);
    expect(after.pricing).toEqual(before.pricing);
    expect(after.material).toEqual(before.material);
    expect(after.production).toEqual(before.production);
    expect(corrected.card.fields["Category provenance"]).toBe("User supplied");
  });

  test("preserves a trusted Flatbed UI selection, then applies a natural-language Roll correction as one next revision", async () => {
    const payload = structuredClone(translucentVinylPayload);
    const provider = jest.fn(async (input: any) => {
      const request = JSON.parse(input.user);
      return request.currentBusinessContext
        ? { rawText: JSON.stringify({ kind: "semantic_operations", operations: [{ op: "set_category", category: "roll" }] }), provider: "openai_compatible", model: "deepseek-v4-flash", requestMetadata: {} }
        : { rawText: JSON.stringify(payload), provider: "openai_compatible", model: "deepseek-v4-flash", requestMetadata: {} };
    });
    const service = new CanonicalProductIntentService(new ProductIntentCompiler({ generateJson: provider }), new ProductIntentPersistenceService(new MemoryStore()), {
      categories: [{ id: "flatbed", label: "Flatbed Printing" }, { id: "roll", label: "Roll Printing" }], materials: [], productionRoutes: [],
    });
    const created = await service.create({ organizationId: "org-1", actorUserId: "user-1", conversationId: "trusted-ui-roll-correction", compilerInput: { ...compilerInput(), request: "Create Translucent Vinyl - Multilayer Print Test 6." } });
    if (!created.ok) throw new Error("Expected active product proposal.");
    const flatbedAction = created.card.candidateResolutions.find((action) => action.kind === "select_category" && action.candidate?.id === "flatbed");
    if (!flatbedAction) throw new Error("Expected signed Flatbed UI action.");
    const selected = await service.applyCandidateAction({ organizationId: "org-1", actorUserId: "user-1", proposalId: created.session.proposalId, actionId: flatbedAction.id });
    if (!selected.outcome?.ok) throw new Error("Expected trusted Flatbed selection.");
    const before = selected.outcome.session.specification.session.revisions.at(-1)!.intent;
    expect(before.identity.category).toEqual({ state: "resolved", id: "flatbed", label: "Flatbed Printing" });
    expect(before.fieldMetadata["identity.category"]).toEqual({ source: "explicit_user" });

    const corrected = await service.continue({ organizationId: "org-1", actorUserId: "user-1", proposalId: created.session.proposalId, request: "I accidentally selected flatbed and it is supposed to be roll", compilerInput: { ...compilerInput(), candidateLabels: { categories: ["Flatbed Printing", "Roll Printing"] } } });
    if (!corrected.ok) throw new Error("Expected Roll correction.");
    const revisions = corrected.session.specification.session.revisions;
    const after = revisions.at(-1)!.intent;
    expect(corrected.session.proposalId).toBe(created.session.proposalId);
    expect(revisions).toHaveLength(3);
    expect(after.revision).toBe(2);
    expect(after.identity.category).toEqual({ state: "resolved", id: "roll", label: "Roll Printing" });
    expect(after.fieldMetadata["identity.category"]).toEqual({ source: "explicit_user" });
    expect(after.pricing).toEqual(before.pricing);
    expect(after.optionGroups).toEqual(before.optionGroups);
    expect(after.material).toEqual(before.material);
    expect(after.production).toEqual(before.production);
    expect(corrected.card.fields["Category provenance"]).toBe("User supplied");
  });

  test("applies mixed explicit semantic corrections while unrelated questions remain open", async () => {
    const payload = structuredClone(translucentVinylPayload);
    payload.intent.optionGroups.push({ key: "weed_tape", label: "Weeding and Taping", required: false, selectionMode: "single", values: [{ key: "none", label: "None", isDefault: true }, { key: "yes", label: "Yes", isDefault: false }] } as any);
    const provider = jest.fn(async (input: any) => JSON.parse(input.user).currentBusinessContext
      ? { rawText: JSON.stringify({ kind: "semantic_operations", operations: [{ op: "set_matrix_rate", optionGroup: "Layers", value: "3 Layers", priceCents: 450 }, { op: "set_option_default", optionGroup: "Layers", value: "5 Layers" }, { op: "remove_option_group", optionGroup: "Weeding and Taping" }, { op: "set_product_name", name: "Backlit Multilayer Vinyl" }, { op: "set_proof_requirement", requiresProofApproval: true }] }), provider: "openai_compatible", model: "deepseek-v4-flash", requestMetadata: {} }
      : { rawText: JSON.stringify(payload), provider: "openai_compatible", model: "deepseek-v4-flash", requestMetadata: {} });
    const service = new CanonicalProductIntentService(new ProductIntentCompiler({ generateJson: provider }), new ProductIntentPersistenceService(new MemoryStore()), { categories: [], materials: [], productionRoutes: [] });
    const created = await service.create({ organizationId: "org-1", actorUserId: "user-1", conversationId: "mixed-semantic-corrections", compilerInput: compilerInput() });
    if (!created.ok) throw new Error("Expected active product proposal.");
    const corrected = await service.continue({ organizationId: "org-1", actorUserId: "user-1", proposalId: created.session.proposalId, request: "Make 3 Layer $4.50 instead. Make 5 Layer the default. Remove Weeding and Taping. Change product name to Backlit Multilayer Vinyl. Actually require proof approval.", compilerInput: compilerInput() });
    if (!corrected.ok) throw new Error("Expected mixed semantic correction.");
    const next = corrected.session.specification.session.revisions.at(-1)!.intent;
    expect(corrected.session.specification.session.revisions).toHaveLength(2);
    if (next.pricing.model !== "two_dimensional_matrix") throw new Error("Expected matrix pricing.");
    expect(next.pricing.cells.filter((cell) => cell.row === "3_layers").map((cell) => cell.priceCents)).toEqual([450, 450]);
    expect(next.optionGroups.find((group) => group.key === "layers")?.values.find((value) => value.isDefault)?.key).toBe("5_layers");
    expect(next.optionGroups.some((group) => group.key === "weed_tape")).toBe(false);
    expect(next.identity.name).toBe("Backlit Multilayer Vinyl");
    expect(next.workflow.requiresProofApproval).toBe(true);
  });

  test("answers one option-default question with a revision-bound patch and preserves all unrelated complex pricing", async () => {
    const payload = structuredClone(translucentVinylPayload);
    payload.intent.identity.category = { state: "resolved", id: "signs", label: "Signs" };
    payload.intent.fieldMetadata["identity.category"] = { source: "explicit_user" };
    const provider = jest.fn(async () => ({ rawText: JSON.stringify(payload), provider: "openai_compatible", model: "deepseek-test", requestMetadata: {} }));
    const service = new CanonicalProductIntentService(new ProductIntentCompiler({ generateJson: provider }), new ProductIntentPersistenceService(new MemoryStore()), {
      categories: [{ id: "signs", label: "Signs" }], materials: [], productionRoutes: [],
    });
    const created = await service.create({ organizationId: "org-1", actorUserId: "user-1", conversationId: "translucent-defaults", compilerInput: { ...compilerInput(), request: "Create Translucent Vinyl - Multilayer Print Test 8 in Signs." } });
    if (!created.ok) throw new Error("Expected a canonical complex-product session.");

    const layersAnswer = await service.continue({ organizationId: "org-1", actorUserId: "user-1", proposalId: created.session.proposalId, request: "3 Layers", compilerInput: compilerInput() });
    expect(layersAnswer.ok).toBe(true);
    if (!layersAnswer.ok) throw new Error("Expected the Layers default answer to apply.");
    const layerRevision = layersAnswer.session.specification.session.revisions.at(-1)!.intent;
    expect(layerRevision.revision).toBe(1);
    expect(layerRevision.optionGroups.find((group) => group.key === "layers")?.values.find((value) => value.isDefault)?.key).toBe("3_layers");
    expect(layerRevision.optionGroups.find((group) => group.key === "surface")?.values.every((value) => !value.isDefault)).toBe(true);
    expect(layerRevision.optionGroups.find((group) => group.key === "finishing")?.values.find((value) => value.isDefault)?.key).toBe("none");
    expect(layerRevision.pricing).toEqual(created.session.specification.session.revisions[0]!.intent.pricing);
    expect(layersAnswer.issues).toEqual(expect.arrayContaining([expect.objectContaining({ path: "optionGroups.surface.default" })]));
    expect(layersAnswer.issues).not.toEqual(expect.arrayContaining([expect.objectContaining({ path: "optionGroups.layers.default" })]));
    expect(provider).toHaveBeenCalledTimes(1);

    const surfaceAnswer = await service.continue({ organizationId: "org-1", actorUserId: "user-1", proposalId: created.session.proposalId, request: "1st Surface (Right Reading)", compilerInput: compilerInput() });
    expect(surfaceAnswer).toMatchObject({ ok: true, card: { readiness: { ready: true }, requiredQuestions: [] } });
    if (surfaceAnswer.ok) {
      const resolved = surfaceAnswer.session.specification.session.revisions.at(-1)!.intent;
      expect(resolved.revision).toBe(2);
      expect(resolved.optionGroups.find((group) => group.key === "surface")?.values.find((value) => value.isDefault)?.key).toBe("first_surface");
      expect(resolved.fieldMetadata["optionGroups.surface.default"]).toEqual({ source: "explicit_user" });
    }
  });

  test("applies two unambiguous option-default answers atomically in one canonical revision", async () => {
    const payload = structuredClone(translucentVinylPayload);
    payload.intent.identity.category = { state: "resolved", id: "signs", label: "Signs" };
    payload.intent.fieldMetadata["identity.category"] = { source: "explicit_user" };
    const provider = jest.fn(async () => ({ rawText: JSON.stringify(payload), provider: "openai_compatible", model: "deepseek-test", requestMetadata: {} }));
    const service = new CanonicalProductIntentService(new ProductIntentCompiler({ generateJson: provider }), new ProductIntentPersistenceService(new MemoryStore()), {
      categories: [{ id: "signs", label: "Signs" }], materials: [], productionRoutes: [],
    });
    const created = await service.create({ organizationId: "org-1", actorUserId: "user-1", conversationId: "translucent-multi-defaults", compilerInput: compilerInput() });
    if (!created.ok) throw new Error("Expected a canonical complex-product session.");
    const before = created.session.specification.session.revisions[0]!.intent;

    const continued = await service.continue({ organizationId: "org-1", actorUserId: "user-1", proposalId: created.session.proposalId, request: "1st surface and 3 layer printing should be defaults", compilerInput: compilerInput() });

    expect(continued).toMatchObject({ ok: true, card: { readiness: { ready: true }, requiredQuestions: [] } });
    if (!continued.ok) throw new Error("Expected both defaults to be applied.");
    const after = continued.session.specification.session.revisions.at(-1)!.intent;
    expect(continued.session.specification.session.revisions).toHaveLength(2);
    expect(after.revision).toBe(1);
    expect(after.optionGroups.find((group) => group.key === "surface")?.values.find((value) => value.isDefault)?.key).toBe("first_surface");
    expect(after.optionGroups.find((group) => group.key === "layers")?.values.find((value) => value.isDefault)?.key).toBe("3_layers");
    expect(after.optionGroups.find((group) => group.key === "finishing")?.values.find((value) => value.isDefault)?.key).toBe("none");
    expect(after.pricing).toEqual(before.pricing);
    expect(after.identity.category).toEqual(before.identity.category);
    expect(after.material).toEqual(before.material);
    expect(after.production.route).toEqual(before.production.route);
    // The server resolves both exact, allowed business values in the compound
    // reply. The configured provider remains needed for initial interpretation
    // but cannot drop one answer during continuation.
    expect(provider).toHaveBeenCalledTimes(1);
  });

  test("applies three scoped option-default answers atomically and rejects an invalid selection without a revision", async () => {
    const payload = structuredClone(translucentVinylPayload);
    payload.intent.identity.category = { state: "resolved", id: "signs", label: "Signs" };
    payload.intent.fieldMetadata["identity.category"] = { source: "explicit_user" };
    payload.intent.optionGroups.push({ key: "mounting", label: "Mounting", required: true, selectionMode: "single", values: [{ key: "permanent", label: "Permanent Mount", isDefault: false }, { key: "removable", label: "Removable Mount", isDefault: false }] });
    let continuationCount = 0;
    const provider = jest.fn(async (input: any) => {
      const compilerRequest = JSON.parse(input.user);
      if (!compilerRequest.currentBusinessContext) return { rawText: JSON.stringify(payload), provider: "openai_compatible", model: "deepseek-test", requestMetadata: {} };
      continuationCount += 1;
      const selectedByGroup: Record<string, string> = continuationCount === 1
        ? { surface: "not_a_choice" }
        : { surface: "first_surface", layers: "3_layers", mounting: "permanent" };
      return {
        rawText: JSON.stringify({ kind: "semantic_operations", operations: Object.entries(selectedByGroup).map(([optionGroup, value]) => ({ op: "set_option_default", optionGroup: optionGroup === "surface" ? "Surface" : optionGroup === "layers" ? "Layers" : "Mounting", value })) }), provider: "openai_compatible", model: "deepseek-test", requestMetadata: {} };
    });
    const store = new MemoryStore();
    const service = new CanonicalProductIntentService(new ProductIntentCompiler({ generateJson: provider }), new ProductIntentPersistenceService(store), {
      categories: [{ id: "signs", label: "Signs" }], materials: [], productionRoutes: [],
    });
    const created = await service.create({ organizationId: "org-1", actorUserId: "user-1", conversationId: "translucent-three-defaults", compilerInput: compilerInput() });
    if (!created.ok) throw new Error("Expected a canonical complex-product session.");
    expect(created.card.requiredQuestions).toEqual(expect.arrayContaining([expect.objectContaining({ path: "optionGroups.surface.default" }), expect.objectContaining({ path: "optionGroups.layers.default" }), expect.objectContaining({ path: "optionGroups.mounting.default" })]));

    const invalid = await service.continue({ organizationId: "org-1", actorUserId: "user-1", proposalId: created.session.proposalId, request: "Change the surface default to an unsupported choice.", compilerInput: compilerInput() });
    expect(invalid).toMatchObject({ ok: false, code: "invalid_contract" });
    expect(store.rows.get(created.session.proposalId)?.specification.session.revisions).toHaveLength(1);

    const continued = await service.continue({ organizationId: "org-1", actorUserId: "user-1", proposalId: created.session.proposalId, request: "Use 1st Surface, 3 Layers, and Permanent Mount as the defaults.", compilerInput: compilerInput() });
    expect(continued).toMatchObject({ ok: true, card: { readiness: { ready: true }, requiredQuestions: [] } });
    if (!continued.ok) throw new Error("Expected three defaults to be applied.");
    expect(continued.session.specification.session.revisions).toHaveLength(2);
    expect(continued.session.specification.session.revisions.at(-1)!.intent.optionGroups.find((group) => group.key === "mounting")?.values.find((value) => value.isDefault)?.key).toBe("permanent");
  });

  test("persists the Yard Signs unresolved matrix as initial revision zero", async () => {
    const compiler = new ProductIntentCompiler({
      generateJson: jest.fn(async () => ({ rawText: JSON.stringify(yardSignsPayload), provider: "openai_compatible", model: "deepseek-test", requestMetadata: { providerRequestId: "req_yard_signs" } })),
    });
    const service = new CanonicalProductIntentService(compiler, new ProductIntentPersistenceService(new MemoryStore()), {
      categories: [{ id: "flatbed-printing", label: "Flatbed Printing" }, { id: "roll-printing", label: "Roll Printing" }],
      materials: [{ id: "pvc-3", label: "PVC - 3mm (Foamed PVC Sheets)" }],
      productionRoutes: [{ id: "flatbed", label: "Flatbed" }],
    });

    const result = await service.create({ organizationId: "org-1", actorUserId: "user-1", conversationId: "yard-signs-3", compilerInput: compilerInput() });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("Expected the Yard Signs canonical session to persist.");
    const persistedIntent = result.session.specification.session.revisions[0]!.intent;
    expect(result.session.status).toBe("needs_answers");
    expect(result.session.specification.session.currentRevision).toBe(0);
    expect(persistedIntent).toMatchObject({ state: "needs_answers", identity: { category: { state: "unresolved", label: "Product category" } }, material: { state: "unresolved" }, production: { route: { state: "explicitly_unset" } }, pricing: { unit: "unresolved" } });
    expect(result.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "0:identity.category:candidate", code: "CATEGORY_UNRESOLVED" }),
      expect.objectContaining({ id: "0:pricing.matrix.unit:required", code: "PRICING_UNIT_UNRESOLVED", path: "pricing.matrix.unit" }),
    ]));
    expect(result.card.candidateResolutions.filter((action) => action.kind === "select_category")).toHaveLength(2);
    expect(result.card.requiredQuestions).toEqual([expect.objectContaining({ id: "0:pricing.matrix.unit:required", path: "pricing.matrix.unit", answer: expect.objectContaining({ answerType: "choice", allowedChoices: expect.arrayContaining([expect.objectContaining({ canonicalValue: "per_piece" }), expect.objectContaining({ canonicalValue: "per_square_foot" })]) }) })]);
    expect(result.session.specification.latestUnresolvedQuestions).toEqual({ baseRevision: 0, questions: expect.arrayContaining([
      expect.objectContaining({ id: "0:identity.category:candidate", path: "identity.category" }),
      expect.objectContaining({ id: "0:pricing.matrix.unit:required", path: "pricing.matrix.unit", answer: expect.objectContaining({ issueId: "0:pricing.matrix.unit:required", canonicalPath: "pricing.matrix.unit", baseRevision: 0 }) }),
    ]) });
  });

  test("returns a safe correlated failure when persistence rejects a canonical session", async () => {
    const compiler = new ProductIntentCompiler({
      generateJson: jest.fn(async () => ({ rawText: JSON.stringify(yardSignsPayload), provider: "openai_compatible", model: "deepseek-test", requestMetadata: {} })),
    });
    const persistence = { create: jest.fn(async () => z.object({ persisted: z.literal(true) }).parse({ persisted: false })) } as any;
    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => undefined);
    const service = new CanonicalProductIntentService(compiler, persistence, { categories: [], materials: [], productionRoutes: [] });

    const result = await service.create({ organizationId: "org-1", actorUserId: "user-1", conversationId: "yard-signs-3", compilerInput: compilerInput() });

    expect(result).toMatchObject({ ok: false, code: "PRODUCT_INTENT_SESSION_CREATION_FAILED", message: expect.stringMatching(/^The canonical product intent could not be prepared safely\. Nothing was created\. Reference: pic-/) });
    expect(errorSpy).toHaveBeenCalledWith("[PRODUCT_INTENT_PIPELINE] Initial canonical session failed.", expect.objectContaining({ stage: "persistence_preparation", code: "PRODUCT_INTENT_SCHEMA_REJECTION", schemaIssuePaths: ["persisted"] }));
    errorSpy.mockRestore();
  });

  test.each(["Per piece.", "PIECE", "Per sqft"])('resolves the active matrix-unit question for "%s" without calling the provider', async (answer) => {
    const provider = jest.fn(async () => ({ rawText: JSON.stringify(yardSignsPayload), provider: "openai_compatible", model: "deepseek-test", requestMetadata: {} }));
    const service = new CanonicalProductIntentService(new ProductIntentCompiler({ generateJson: provider }), new ProductIntentPersistenceService(new MemoryStore()), {
      categories: [{ id: "flatbed-printing", label: "Flatbed Printing" }], materials: [{ id: "pvc-3", label: "PVC - 3mm (Foamed PVC Sheets)" }], productionRoutes: [{ id: "flatbed", label: "Flatbed" }],
    });
    const created = await service.create({ organizationId: "org-1", actorUserId: "user-1", conversationId: `yard-${answer}`, compilerInput: compilerInput() });
    expect(created.ok).toBe(true);
    if (!created.ok) throw new Error("Expected canonical session creation.");

    const continued = await service.continue({ organizationId: "org-1", actorUserId: "user-1", proposalId: created.session.proposalId, request: answer, compilerInput: compilerInput() });

    expect(continued.ok).toBe(true);
    if (!continued.ok) throw new Error("Expected deterministic required-answer continuation.");
    const intent = continued.session.specification.session.revisions.at(-1)!.intent;
    expect(provider).toHaveBeenCalledTimes(1);
    expect(intent.revision).toBe(1);
    expect(intent.pricing).toMatchObject({ model: "two_dimensional_matrix", unit: answer.toLocaleLowerCase().includes("sqft") ? "per_square_foot" : "per_piece", cells: expect.arrayContaining([{ row: "3mm", column: "single", priceCents: 1200 }, { row: "6mm", column: "double", priceCents: 2200 }]) });
    expect(intent.identity.category).toMatchObject({ state: "unresolved" });
    expect(intent.material).toMatchObject({ state: "unresolved" });
    expect(intent.production.route).toEqual({ state: "explicitly_unset" });
    expect(continued.issues).toEqual([expect.objectContaining({ code: "CATEGORY_UNRESOLVED", id: "1:identity.category:candidate" })]);
    expect(continued.card.requiredQuestions).toEqual([]);
    expect(continued.card.candidateResolutions.filter((action) => action.kind === "select_category")).toHaveLength(1);
  });

  test("does not turn unrelated or already-resolved answers into a deterministic patch", async () => {
    const provider = jest.fn(async () => ({ rawText: JSON.stringify(yardSignsPayload), provider: "openai_compatible", model: "deepseek-test", requestMetadata: {} }));
    const service = new CanonicalProductIntentService(new ProductIntentCompiler({ generateJson: provider }), new ProductIntentPersistenceService(new MemoryStore()), { categories: [], materials: [], productionRoutes: [] });
    const created = await service.create({ organizationId: "org-1", actorUserId: "user-1", conversationId: "yard-unmatched", compilerInput: compilerInput() });
    if (!created.ok) throw new Error("Expected canonical session creation.");
    const unrelated = await service.continue({ organizationId: "org-1", actorUserId: "user-1", proposalId: created.session.proposalId, request: "Make it excellent", compilerInput: compilerInput() });
    expect(unrelated).toMatchObject({ ok: false, code: "invalid_contract" });
    expect(provider).toHaveBeenCalledTimes(3);
  });

  test("uses a scoped provider patch fallback when an answer is not an exact server alias", async () => {
    let calls = 0;
    const provider = jest.fn(async (request) => {
      calls += 1;
      if (calls === 1) return { rawText: JSON.stringify(yardSignsPayload), provider: "openai_compatible", model: "deepseek-test", requestMetadata: {} };
      return { rawText: JSON.stringify({ kind: "semantic_operations", operations: [{ op: "set_pricing_basis", basis: "per_piece" }] }), provider: "openai_compatible", model: "deepseek-test", requestMetadata: {} };
    });
    const service = new CanonicalProductIntentService(new ProductIntentCompiler({ generateJson: provider }), new ProductIntentPersistenceService(new MemoryStore()), { categories: [], materials: [], productionRoutes: [] });
    const created = await service.create({ organizationId: "org-1", actorUserId: "user-1", conversationId: "yard-provider-patch", compilerInput: compilerInput() });
    if (!created.ok) throw new Error("Expected canonical session creation.");

    const continued = await service.continue({ organizationId: "org-1", actorUserId: "user-1", proposalId: created.session.proposalId, request: "Use the standard basis", compilerInput: compilerInput() });

    expect(continued).toMatchObject({ ok: true, session: { specification: { session: { currentRevision: 1 } } } });
    expect(provider).toHaveBeenCalledTimes(2);
    if (continued.ok) expect(continued.session.specification.session.revisions.at(-1)!.intent.pricing).toMatchObject({ unit: "per_piece", cells: expect.arrayContaining([{ row: "3mm", column: "single", priceCents: 1200 }]) });
  });

  test("persists a selected tenant category without changing the independent pricing or route fields", async () => {
    const service = new CanonicalProductIntentService(new ProductIntentCompiler({
      generateJson: jest.fn(async () => ({ rawText: JSON.stringify(yardSignsPayload), provider: "openai_compatible", model: "deepseek-test", requestMetadata: {} })),
    }), new ProductIntentPersistenceService(new MemoryStore()), {
      categories: [{ id: "flatbed-printing", label: "Flatbed Printing" }, { id: "roll-printing", label: "Roll Printing" }],
      materials: [{ id: "pvc-3", label: "PVC - 3mm (Foamed PVC Sheets)" }], productionRoutes: [{ id: "flatbed", label: "Flatbed" }],
    });
    const created = await service.create({ organizationId: "org-1", actorUserId: "user-1", conversationId: "yard-category-first", compilerInput: compilerInput() });
    if (!created.ok) throw new Error("Expected canonical session creation.");
    const categoryAction = created.card.candidateResolutions.find((action) => action.kind === "select_category" && action.candidate?.id === "flatbed-printing");
    if (!categoryAction) throw new Error("Expected Flatbed Printing candidate action.");

    const selected = await service.applyCandidateAction({ organizationId: "org-1", actorUserId: "user-1", proposalId: created.session.proposalId, actionId: categoryAction.id });
    expect(selected.outcome).toMatchObject({ ok: true, session: { specification: { session: { currentRevision: 1 } } } });
    if (!selected.outcome?.ok) throw new Error("Expected category selection to persist.");
    const selectedIntent = selected.outcome.session.specification.session.revisions.at(-1)!.intent;
    expect(selectedIntent.identity.category).toEqual({ state: "resolved", id: "flatbed-printing", label: "Flatbed Printing" });
    expect(selectedIntent.fieldMetadata["identity.category"]).toEqual(expect.objectContaining({ source: "explicit_user" }));
    expect(selectedIntent.pricing).toMatchObject({ model: "two_dimensional_matrix", unit: "unresolved", cells: yardSignsPayload.intent.pricing.cells });
    expect(selectedIntent.optionGroups).toEqual(yardSignsPayload.intent.optionGroups);
    expect(selectedIntent.material).toMatchObject({ state: "unresolved" });
    expect(selectedIntent.production.route).toEqual({ state: "explicitly_unset" });
    expect(selected.outcome.issues).not.toEqual(expect.arrayContaining([expect.objectContaining({ code: "CATEGORY_UNRESOLVED" })]));
    expect(selected.outcome.card.candidateResolutions.filter((action) => action.kind === "select_category")).toEqual([]);
    expect(selected.outcome.card.requiredQuestions).toEqual([expect.objectContaining({ path: "pricing.matrix.unit" })]);

    const finished = await service.continue({ organizationId: "org-1", actorUserId: "user-1", proposalId: created.session.proposalId, request: "Per piece", compilerInput: compilerInput() });
    expect(finished).toMatchObject({ ok: true, session: { specification: { session: { currentRevision: 2 } } }, card: { readiness: { ready: true }, requiredQuestions: [] } });
    if (finished.ok) expect(finished.session.specification.session.revisions.at(-1)!.intent).toMatchObject({ identity: { category: { state: "resolved", id: "flatbed-printing", label: "Flatbed Printing" } }, pricing: { model: "two_dimensional_matrix", unit: "per_piece", cells: yardSignsPayload.intent.pricing.cells }, production: { route: { state: "explicitly_unset" } } });
  });

  test("resolves category after pricing and rejects reused category actions without appending another revision", async () => {
    const service = new CanonicalProductIntentService(new ProductIntentCompiler({
      generateJson: jest.fn(async () => ({ rawText: JSON.stringify(yardSignsPayload), provider: "openai_compatible", model: "deepseek-test", requestMetadata: {} })),
    }), new ProductIntentPersistenceService(new MemoryStore()), {
      categories: [{ id: "flatbed-printing", label: "Flatbed Printing" }], materials: [], productionRoutes: [],
    });
    const created = await service.create({ organizationId: "org-1", actorUserId: "user-1", conversationId: "yard-pricing-first", compilerInput: compilerInput() });
    if (!created.ok) throw new Error("Expected canonical session creation.");
    const priced = await service.continue({ organizationId: "org-1", actorUserId: "user-1", proposalId: created.session.proposalId, request: "piece", compilerInput: compilerInput() });
    if (!priced.ok) throw new Error("Expected pricing continuation.");
    const categoryAction = priced.card.candidateResolutions.find((action) => action.kind === "select_category" && action.candidate?.id === "flatbed-printing");
    if (!categoryAction) throw new Error("Expected current Flatbed Printing candidate action.");

    const selected = await service.applyCandidateAction({ organizationId: "org-1", actorUserId: "user-1", proposalId: created.session.proposalId, actionId: categoryAction.id });
    expect(selected.outcome).toMatchObject({ ok: true, session: { specification: { session: { currentRevision: 2 } } }, card: { readiness: { ready: true }, requiredQuestions: [] } });
    if (!selected.outcome?.ok) throw new Error("Expected category selection to persist.");
    expect(selected.outcome.session.specification.session.revisions).toHaveLength(3);
    expect(selected.outcome.session.specification.session.revisions.at(-1)!.intent).toMatchObject({ identity: { category: { state: "resolved", id: "flatbed-printing", label: "Flatbed Printing" } }, pricing: { unit: "per_piece", cells: yardSignsPayload.intent.pricing.cells } });

    await expect(service.applyCandidateAction({ organizationId: "org-1", actorUserId: "user-1", proposalId: created.session.proposalId, actionId: categoryAction.id })).rejects.toThrow("PRODUCT_INTENT_INTERACTION_STALE");
    const current = selected.outcome.session.specification.session;
    expect(current.currentRevision).toBe(2);
    expect(current.revisions).toHaveLength(3);
  });

  test("rejects a server-issued candidate patch with no semantic change without appending a revision", async () => {
    const store = new MemoryStore();
    const persistence = new ProductIntentPersistenceService(store);
    const service = new CanonicalProductIntentService(new ProductIntentCompiler({
      generateJson: jest.fn(async () => ({ rawText: JSON.stringify(yardSignsPayload), provider: "openai_compatible", model: "deepseek-test", requestMetadata: {} })),
    }), persistence, { categories: [{ id: "flatbed-printing", label: "Flatbed Printing" }], materials: [], productionRoutes: [] });
    const created = await service.create({ organizationId: "org-1", actorUserId: "user-1", conversationId: "yard-no-op", compilerInput: compilerInput() });
    if (!created.ok) throw new Error("Expected canonical session creation.");
    const categoryAction = created.card.candidateResolutions.find((action) => action.kind === "select_category");
    if (!categoryAction) throw new Error("Expected category candidate action.");
    const originalPresentation = (service as any).presentation.bind(service);
    (service as any).presentation = async (currentIntent: any, currentIssues: any[]) => ({
      ...(await originalPresentation(currentIntent, currentIssues)),
      candidateResolutions: [{ ...categoryAction, patch: { contractVersion: 1, baseRevision: currentIntent.revision, preserveUnchanged: true, operations: [{ op: "set_identity", value: currentIntent.identity }] } }],
    });

    const result = await service.applyCandidateAction({ organizationId: "org-1", actorUserId: "user-1", proposalId: created.session.proposalId, actionId: categoryAction.id });
    expect(result.outcome).toMatchObject({ ok: false, code: "PRODUCT_INTENT_ACTION_NO_CHANGE" });
    const persisted = await persistence.load({ organizationId: "org-1", actorUserId: "user-1", proposalId: created.session.proposalId });
    expect(persisted.specification.session.currentRevision).toBe(0);
    expect(persisted.specification.session.revisions).toHaveLength(1);
  });

  test("inspects the latest ready revision without a compiler, patch validation, persistence write, or fingerprint change", async () => {
    const provider = jest.fn(async () => ({ rawText: JSON.stringify(yardSignsPayload), provider: "openai_compatible", model: "deepseek-test", requestMetadata: {} }));
    const persistence = new ProductIntentPersistenceService(new MemoryStore());
    const candidates = { categories: [{ id: "flatbed-printing", label: "Flatbed Printing" }], materials: [], productionRoutes: [] };
    const writer = new CanonicalProductIntentService(new ProductIntentCompiler({ generateJson: provider }), persistence, candidates);
    const created = await writer.create({ organizationId: "org-1", actorUserId: "user-1", conversationId: "yard-read-only", compilerInput: compilerInput() });
    if (!created.ok) throw new Error("Expected canonical session creation.");
    const category = created.card.candidateResolutions.find((action) => action.kind === "select_category");
    if (!category) throw new Error("Expected category candidate.");
    const selected = await writer.applyCandidateAction({ organizationId: "org-1", actorUserId: "user-1", proposalId: created.session.proposalId, actionId: category.id });
    if (!selected.outcome?.ok) throw new Error("Expected category selection.");
    const ready = await writer.continue({ organizationId: "org-1", actorUserId: "user-1", proposalId: created.session.proposalId, request: "Per piece", compilerInput: compilerInput() });
    if (!ready.ok) throw new Error("Expected deterministic pricing answer.");
    const before = await persistence.load({ organizationId: "org-1", actorUserId: "user-1", proposalId: created.session.proposalId });

    const reader = new CanonicalProductIntentService(null, persistence, candidates);
    const inspected = await reader.inspect({ organizationId: "org-1", actorUserId: "user-1", proposalId: created.session.proposalId });
    const after = await persistence.load({ organizationId: "org-1", actorUserId: "user-1", proposalId: created.session.proposalId });

    expect(inspected).toMatchObject({ session: { fingerprint: before.fingerprint, specification: { session: { currentRevision: 2 } } }, card: { readiness: { ready: true }, optionalRecommendations: [expect.objectContaining({ kind: "enable_proof_approval" })] } });
    expect(inspected.card.fields).toMatchObject({ Category: "Flatbed Printing", Proof: "Not required", "Production route": "Not set" });
    expect(after.fingerprint).toBe(before.fingerprint);
    expect(after.specification.session.revisions).toHaveLength(before.specification.session.revisions.length);
    expect(provider).toHaveBeenCalledTimes(1);
  });

  test("applies an Operator semantic category correction without a continuation compiler call or canonical model patch", async () => {
    const payload = structuredClone(translucentVinylPayload);
    payload.intent.identity.category = { state: "resolved", id: "flatbed", label: "Flatbed Printing" };
    payload.intent.fieldMetadata["identity.category"] = { source: "explicit_user" };
    const provider = jest.fn(async () => ({ rawText: JSON.stringify(payload), provider: "openai_compatible", model: "deepseek-test", requestMetadata: {} }));
    const persistence = new ProductIntentPersistenceService(new MemoryStore());
    const service = new CanonicalProductIntentService(new ProductIntentCompiler({ generateJson: provider }), persistence, {
      categories: [{ id: "flatbed", label: "Flatbed Printing" }, { id: "roll", label: "Roll Printing" }], materials: [], productionRoutes: [],
    });
    const created = await service.create({
      organizationId: "org-1", actorUserId: "user-1", conversationId: "semantic-category-correction",
      compilerInput: { ...compilerInput(), request: "Create this product in Flatbed Printing." },
    });
    if (!created.ok) throw new Error("Expected canonical session creation.");
    const before = created.session.specification.session.revisions.at(-1)!.intent;

    const corrected = await service.applySemanticOperations({
      organizationId: "org-1", actorUserId: "user-1", proposalId: created.session.proposalId,
      request: "I accidentally selected flatbed when it should have been roll.",
      operations: [{ op: "set_category", category: "roll" }],
    });

    expect(corrected).toMatchObject({ ok: true, session: { specification: { session: { currentRevision: 1 } } } });
    if (!corrected.ok) throw new Error("Expected semantic correction to persist.");
    const after = corrected.session.specification.session.revisions.at(-1)!.intent;
    expect(after.identity.category).toEqual({ state: "resolved", id: "roll", label: "Roll Printing" });
    expect(after.fieldMetadata["identity.category"]).toEqual({ source: "explicit_user" });
    expect(after.optionGroups).toEqual(before.optionGroups);
    expect(after.pricing).toEqual(before.pricing);
    expect(provider).toHaveBeenCalledTimes(1);
  });

  test("atomically repairs the exact yes-only Weed/Tape draft through ordered Operator operations", async () => {
    const store = new MemoryStore();
    const service = new CanonicalProductIntentService(null, new ProductIntentPersistenceService(store), {
      categories: [{ id: "print-products", label: "Print Products" }], materials: [], productionRoutes: [],
    });
    const begun = await service.begin({ organizationId: "org-1", actorUserId: "user-1", conversationId: "ordered-weed-tape-correction" });
    if (!begun.ok) throw new Error("Expected an unfinished draft.");
    const initial = await service.applySemanticOperations({
      organizationId: "org-1", actorUserId: "user-1", proposalId: begun.session.proposalId,
      request: "Create Translucent Vinyl with Layers, Contour Cutting, and Weeding and Taping.",
      operations: [
        { op: "set_product_name", name: "Translucent Vinyl" },
        { op: "set_pricing_basis", basis: "per_square_foot" },
        { op: "add_option_group", optionGroup: "Layers", required: true, selectionMode: "single" },
        { op: "add_option_value", optionGroup: "Layers", value: "3 Layer" },
        { op: "add_option_value", optionGroup: "Layers", value: "5 Layer" },
        { op: "set_option_rate", optionGroup: "Layers", value: "3 Layer", priceCents: 400, basis: "per_square_foot" },
        { op: "set_option_rate", optionGroup: "Layers", value: "5 Layer", priceCents: 500, basis: "per_square_foot" },
        { op: "add_option_group", optionGroup: "Contour Cutting", required: true, selectionMode: "single" },
        { op: "add_option_value", optionGroup: "Contour Cutting", value: "No" },
        { op: "add_option_value", optionGroup: "Contour Cutting", value: "Yes" },
        { op: "add_option_group", optionGroup: "Weeding and Taping", required: false, selectionMode: "single" },
        { op: "add_option_value", optionGroup: "Weeding and Taping", value: "Yes" },
        { op: "set_option_group_availability", optionGroup: "Weeding and Taping", whenOptionGroup: "Contour Cutting", whenValue: "Yes" },
      ],
    });
    if (!initial.ok) throw new Error("Expected the yes-only draft to persist.");
    const before = initial.session.specification.session.revisions.at(-1)!.intent;
    expect(before.optionGroups.find((group) => group.label === "Weeding and Taping")?.values.map((value) => value.label)).toEqual(["Yes"]);

    const corrected = await service.applySemanticOperations({
      organizationId: "org-1", actorUserId: "user-1", proposalId: begun.session.proposalId,
      request: "3 layer should be the default. Contour cutting should default to no, and weeding and taping should default to no. Weeding and taping should only be available when contour cutting is yes.",
      operations: [
        { op: "set_option_default", optionGroup: "Layers", value: "3 Layer" },
        { op: "set_option_default", optionGroup: "Contour Cutting", value: "No" },
        { op: "add_option_value", optionGroup: "Weeding and Taping", value: "No" },
        { op: "set_option_default", optionGroup: "Weeding and Taping", value: "No" },
        { op: "set_option_group_availability", optionGroup: "Weeding and Taping", whenOptionGroup: "Contour Cutting", whenValue: "Yes" },
      ],
    });

    expect(corrected).toMatchObject({ ok: true, session: { specification: { session: { currentRevision: 2 } } } });
    if (!corrected.ok) throw new Error("Expected one atomic correction revision.");
    const intent = corrected.session.specification.session.revisions.at(-1)!.intent;
    const layers = intent.optionGroups.find((group) => group.label === "Layers");
    const contour = intent.optionGroups.find((group) => group.label === "Contour Cutting");
    const weedTape = intent.optionGroups.find((group) => group.label === "Weeding and Taping");
    expect(layers?.values.find((value) => value.isDefault)?.label).toBe("3 Layer");
    expect(contour?.values.find((value) => value.isDefault)?.label).toBe("No");
    expect(weedTape).toMatchObject({ availableWhen: { optionGroupKey: contour?.key, optionValueKey: contour?.values.find((value) => value.label === "Yes")?.key } });
    expect(weedTape?.values.map((value) => value.label)).toEqual(["Yes", "No"]);
    expect(weedTape?.values.find((value) => value.isDefault)?.label).toBe("No");
    expect(corrected.session.specification.session.revisions).toHaveLength(3);
    expect(corrected.issues.map((issue) => issue.path)).not.toEqual(expect.arrayContaining([
      "optionGroups.layers.default", "optionGroups.contour_cutting.default", "optionGroups.weeding_and_taping.default",
    ]));

    const failed = await service.applySemanticOperations({
      organizationId: "org-1", actorUserId: "user-1", proposalId: begun.session.proposalId,
      request: "Add another option, then select a value that does not exist.",
      operations: [
        { op: "add_option_value", optionGroup: "Weeding and Taping", value: "Maybe" },
        { op: "set_option_default", optionGroup: "Weeding and Taping", value: "Missing" },
      ],
    });
    expect(failed).toMatchObject({ ok: false, code: "PRODUCT_SEMANTIC_OPERATION_REJECTED" });
    const afterFailure = await service.inspect({ organizationId: "org-1", actorUserId: "user-1", proposalId: begun.session.proposalId });
    expect(afterFailure.session.specification.session.currentRevision).toBe(2);
    expect(afterFailure.session.specification.session.revisions).toHaveLength(3);
    expect(afterFailure.session.specification.session.revisions.at(-1)!.intent.optionGroups.find((group) => group.label === "Weeding and Taping")?.values.map((value) => value.label)).toEqual(["Yes", "No"]);
  });

  test("accepts new groups, values, rates, defaults, and prerequisites in one ordered revision", async () => {
    const service = new CanonicalProductIntentService(null, new ProductIntentPersistenceService(new MemoryStore()), {
      categories: [], materials: [], productionRoutes: [],
    });
    const begun = await service.begin({ organizationId: "org-1", actorUserId: "user-1", conversationId: "ordered-semantic-creation" });
    if (!begun.ok) throw new Error("Expected an unfinished draft.");

    const created = await service.applySemanticOperations({
      organizationId: "org-1", actorUserId: "user-1", proposalId: begun.session.proposalId,
      request: "Create Atomic Vinyl with Layers, Contour Cutting, and Weeding and Taping.",
      operations: [
        { op: "set_product_name", name: "Atomic Vinyl" },
        { op: "set_pricing_basis", basis: "per_square_foot" },
        { op: "add_option_group", optionGroup: "Layers", required: true, selectionMode: "single" },
        { op: "add_option_value", optionGroup: "Layers", value: "3 Layer" },
        { op: "set_option_rate", optionGroup: "Layers", value: "3 Layer", priceCents: 400, basis: "per_square_foot" },
        { op: "set_option_default", optionGroup: "Layers", value: "3 Layer" },
        { op: "add_option_group", optionGroup: "Contour Cutting", required: false, selectionMode: "single" },
        { op: "add_option_value", optionGroup: "Contour Cutting", value: "Yes" },
        { op: "add_option_group", optionGroup: "Weeding and Taping", required: false, selectionMode: "single" },
        { op: "set_option_group_availability", optionGroup: "Weeding and Taping", whenOptionGroup: "Contour Cutting", whenValue: "Yes" },
      ],
    });

    expect(created).toMatchObject({ ok: true, session: { specification: { session: { currentRevision: 1, revisions: expect.any(Array) } } } });
    if (!created.ok) throw new Error("Expected the ordered batch to persist.");
    const intent = created.session.specification.session.revisions.at(-1)!.intent;
    const layers = intent.optionGroups.find((group) => group.label === "Layers");
    const contour = intent.optionGroups.find((group) => group.label === "Contour Cutting");
    const weedTape = intent.optionGroups.find((group) => group.label === "Weeding and Taping");
    expect(layers?.values.find((value) => value.isDefault)?.label).toBe("3 Layer");
    expect(intent.pricing).toMatchObject({ model: "one_dimensional_matrix", unit: "per_square_foot", cells: [{ priceCents: 400 }] });
    expect(weedTape?.availableWhen).toEqual({ optionGroupKey: contour?.key, optionValueKey: contour?.values[0]?.key });
  });

  test("retains the exact two-turn Reflective Pole Signs conversation while customer-specific availability stays unsupported", async () => {
    const service = new CanonicalProductIntentService(null, new ProductIntentPersistenceService(new MemoryStore()), {
      categories: [{ id: "rigid-signs", label: "Rigid Signs" }], materials: [], productionRoutes: [],
    });
    const begun = await service.begin({ organizationId: "org-1", actorUserId: "user-1", conversationId: "reflective-pole-signs" });
    if (!begun.ok) throw new Error("Expected an unfinished draft.");

    const created = await service.applySemanticOperations({
      organizationId: "org-1", actorUserId: "user-1", proposalId: begun.session.proposalId,
      request: 'Add a product for "Relective Pole Signs" and it will be a product that we only use for a certain customer. The options will be grommets with placement, they will be logged as single sided as the only option for sides and they will be on coroplast with reflective vinyl mounted to them. They are priced at $9 each.',
      operations: [
        { op: "set_product_description", description: "Coroplast signs with reflective vinyl mounted to them." },
        { op: "set_category", category: "Rigid Signs" },
        { op: "set_material", material: "Coroplast" },
        { op: "set_measurement_mode", mode: "dimensions_required" },
        { op: "set_scalar_price", priceCents: 900, basis: "per_piece" },
        { op: "add_option_group", optionGroup: "Sides", required: true, selectionMode: "single" },
        { op: "add_option_value", optionGroup: "Sides", value: "Single Sided" },
        { op: "set_option_default", optionGroup: "Sides", value: "Single Sided" },
        { op: "add_option_group", optionGroup: "Grommets", required: false, selectionMode: "single" },
        { op: "add_option_group", optionGroup: "Grommet Placement", required: false, selectionMode: "single" },
        { op: "record_unsupported_detail", detail: "customer_specific_availability" },
      ],
    });

    expect(created).toMatchObject({ ok: true });
    if (!created.ok) throw new Error("Expected supported Reflective Pole Signs details to persist.");
    const intent = created.session.specification.session.revisions.at(-1)!.intent;
    expect(intent).toMatchObject({
      identity: { name: "Relective Pole Signs", description: "Coroplast signs with reflective vinyl mounted to them.\nConstruction: Coroplast", category: { state: "resolved", id: "rigid-signs", label: "Rigid Signs" } },
      material: { state: "unresolved", label: "Coroplast" },
      measurement: { mode: "dimensions_required" },
      pricing: { model: "scalar", unit: "per_piece", priceCents: 900 },
    });
    expect(intent.optionGroups.find((group) => group.label === "Sides")?.values).toEqual([{ key: "single_sided", label: "Single Sided", isDefault: true }]);
    expect(intent.optionGroups.find((group) => group.label === "Grommets")?.values).toEqual([]);
    expect(intent.optionGroups.find((group) => group.label === "Grommet Placement")?.values).toEqual([]);
    expect(created.issues).toEqual(expect.arrayContaining([expect.objectContaining({ path: "optionGroups.grommet_placement.values", code: "OPTION_GROUP_VALUES_UNRESOLVED" })]));
    expect(created.issues).not.toEqual(expect.arrayContaining([expect.objectContaining({ path: "identity.name" }), expect.objectContaining({ path: "pricing.model" })]));

    const followUp = await service.applySemanticOperations({
      organizationId: "org-1", actorUserId: "user-1", proposalId: begun.session.proposalId,
      request: "Grommets would be default, top and bottom. 1 each so each one gets 2 grommets. Product is called Reflective Pole Signs - Rick",
      // Reproduces the historical Operator omission: the only emitted
      // operation was the already-recorded unsupported count. The explicit
      // user facts must still reconcile atomically into the next revision.
      operations: [{ op: "record_unsupported_detail", detail: "grommet_quantity" }],
    });
    expect(followUp).toMatchObject({ ok: true });
    if (!followUp.ok) throw new Error("Expected the supported follow-up details to persist.");
    const followedIntent = followUp.session.specification.session.revisions.at(-1)!.intent;
    expect(followedIntent.identity.name).toBe("Reflective Pole Signs - Rick");
    expect(followedIntent.optionGroups.find((group) => group.label === "Grommets")?.values).toEqual(expect.arrayContaining([
      { key: "yes", label: "Yes", isDefault: true },
      { key: "no", label: "No", isDefault: false },
    ]));
    expect(followedIntent.optionGroups.find((group) => group.label === "Grommet Placement")?.values).toEqual([{ key: "top_and_bottom", label: "Top and Bottom", isDefault: true }]);
    expect(followedIntent.unresolvedFields).toEqual(expect.arrayContaining([expect.objectContaining({ path: "optionGroups.grommets.quantity", code: "GROMMET_QUANTITY_UNRESOLVED" })]));
  });

  test("does not blame set_product_name when a later unsupported operation fails schema validation", async () => {
    const service = new CanonicalProductIntentService(null, new ProductIntentPersistenceService(new MemoryStore()), { categories: [], materials: [], productionRoutes: [] });
    const begun = await service.begin({ organizationId: "org-1", actorUserId: "user-1", conversationId: "semantic-schema-attribution" });
    if (!begun.ok) throw new Error("Expected an unfinished draft.");

    const outcome = await service.applySemanticOperations({
      organizationId: "org-1", actorUserId: "user-1", proposalId: begun.session.proposalId,
      request: "Create Reflective Pole Signs for a specific customer.",
      operations: [
        { op: "set_product_name", name: "Reflective Pole Signs" },
        { op: "set_customer_specific_availability", customer: "Acme" },
      ],
    });

    expect(outcome).toMatchObject({ ok: false, code: "PRODUCT_SEMANTIC_OPERATION_REJECTED" });
    if (outcome.ok) throw new Error("Expected schema rejection.");
    expect(outcome.message).toContain("set_customer_specific_availability");
    expect(outcome.message).not.toContain("set_product_name product operation");
  });
});
