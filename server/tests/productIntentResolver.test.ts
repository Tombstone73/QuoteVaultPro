import { resolveAndValidateProductDraftIntent, resolveProductDraftIntentReferences } from "../services/productIntentCompiler/productIntentResolver";

function yardSignsIntent() {
  return {
    contractVersion: 1, intentId: "yard-signs-1", organizationId: "org-1", revision: 0, state: "compiling", operation: "new_product",
    identity: { name: "Yard Signs Test", description: "", category: { state: "resolved", id: "signs", label: "Signs" } },
    lifecycle: { productStatus: "inactive", published: false }, measurement: { mode: "quantity_only" }, quantity: { behavior: "customer_entered", minimum: 1 },
    pricing: { model: "two_dimensional_matrix", unit: "unresolved", rowOptionKey: "thickness", columnOptionKey: "sides", cells: [{ row: "3mm", column: "single", priceCents: 1200 }, { row: "3mm", column: "double", priceCents: 1800 }, { row: "6mm", column: "single", priceCents: 1600 }, { row: "6mm", column: "double", priceCents: 2200 }] },
    material: { state: "explicitly_unset" }, optionGroups: [
      { key: "thickness", label: "Thickness", required: true, selectionMode: "single", values: [{ key: "3mm", label: "3mm", isDefault: true }, { key: "6mm", label: "6mm", isDefault: false }] },
      { key: "sides", label: "Sides", required: true, selectionMode: "single", values: [{ key: "single", label: "Single-sided", isDefault: true }, { key: "double", label: "Double-sided", isDefault: false }] },
    ],
    workflow: { kind: "standard_production", requiresProofApproval: false, requiresProductionJob: true }, production: { route: { state: "explicitly_unset" }, configuration: {} }, visibility: { catalogVisible: false },
    unresolvedFields: [{ path: "pricing.unit", code: "PRICING_UNIT_UNRESOLVED", question: "Are these matrix prices per piece or per square foot?" }], fieldMetadata: { "pricing.unit": { source: "unresolved" } }, revisionMetadata: { parentRevision: null }, operationContext: {},
  };
}

describe("Product Intent resolver", () => {
  test("canonical resolved provenance suppresses a stale measurement question while unresolved provenance keeps it", async () => {
    const stale = { ...yardSignsIntent(), pricing: { model: "scalar", unit: "per_piece", priceCents: 100 }, unresolvedFields: [{ path: "measurement.mode", code: "MEASUREMENT_UNRESOLVED", question: "Dimensions or quantity only?" }], fieldMetadata: { "measurement.mode": { source: "explicit_user" } } };
    const resolved = await resolveAndValidateProductDraftIntent(stale, { categoryLabels: ["Signs"] });
    expect(resolved.issues.some((issue) => issue.path === "measurement.mode")).toBe(false);
    const reopened = await resolveAndValidateProductDraftIntent({ ...stale, fieldMetadata: { "measurement.mode": { source: "unresolved" } } }, { categoryLabels: ["Signs"] });
    expect(reopened.issues).toEqual(expect.arrayContaining([expect.objectContaining({ path: "measurement.mode" })]));
  });
  test("keeps every Yard Signs matrix value while making the pricing unit a required question", async () => {
    const result = await resolveAndValidateProductDraftIntent(yardSignsIntent(), { categoryLabels: ["Signs"] });
    expect(result.ready).toBe(false);
    expect(result.intent.pricing).toMatchObject({ model: "two_dimensional_matrix", unit: "unresolved", cells: expect.arrayContaining([{ row: "3mm", column: "single", priceCents: 1200 }, { row: "6mm", column: "double", priceCents: 2200 }]) });
    expect(result.issues).toEqual(expect.arrayContaining([expect.objectContaining({ code: "PRICING_UNIT_UNRESOLVED", id: "0:pricing.matrix.unit:required", path: "pricing.matrix.unit", severity: "question" })]));
  });

  test("resolves the single tenant Fees capability for an inferred service fee without selecting physical categories", () => {
    const raw = yardSignsIntent();
    raw.identity.category = { state: "unresolved", label: "Fees" } as any;
    raw.measurement = { mode: "quantity_only" } as any;
    raw.quantity = { behavior: "not_applicable" } as any;
    raw.pricing = { model: "scalar", unit: "per_hour", priceCents: 6000 } as any;
    raw.material = { state: "explicitly_unset" } as any;
    raw.optionGroups = [];
    raw.workflow = { kind: "service_fee", requiresProofApproval: false, requiresProductionJob: false } as any;
    raw.production = { route: { state: "explicitly_unset" }, configuration: {} } as any;
    raw.unresolvedFields = [];
    raw.fieldMetadata = { "identity.category": { source: "semantic_inference" }, pricing: { source: "semantic_inference" } } as any;
    const resolved = resolveProductDraftIntentReferences(raw, { categories: [{ id: "roll", label: "Roll" }, { id: "fees", label: "Fees" }], materials: [], productionRoutes: [] });
    expect(resolved.identity.category).toEqual({ state: "resolved", id: "fees", label: "Fees" });
    expect(resolved.workflow).toEqual({ kind: "service_fee", requiresProofApproval: false, requiresProductionJob: false });
  });
});
