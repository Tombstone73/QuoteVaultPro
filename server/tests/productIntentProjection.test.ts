import { productDraftIntentFingerprint } from "@shared/productDraftIntent";
import { extractProductOptionPricingMatrix, resolveProductOptionPricingMatrix } from "@shared/productOptionPricingMatrix";
import { optionTreeV2Schema, validateOptionTreeV2 } from "@shared/optionTreeV2";
import { buildNumericSelectionFormulaVariables } from "@shared/pbv2/numericSelectionFormulaVariables";
import { validatePricingPreviewRequest } from "../services/pricing/pricingPreviewValidation";
import { ProductIntentProjectionError, projectProductDraftIntentToProductBuilderDraft } from "../services/productIntentCompiler/productIntentProjection";
import { evaluateOptionTreeV2 } from "../services/optionTreeV2Evaluator";

function intent(overrides: Record<string, unknown> = {}) {
  const base = {
    contractVersion: 1, intentId: "intent-1", organizationId: "org-1", revision: 1, state: "ready_for_review", operation: "new_product",
    identity: { name: "Yard Signs", description: "", category: { state: "resolved", id: "category-1", label: "Signs" } },
    lifecycle: { productStatus: "inactive", published: false }, measurement: { mode: "dimensions_required" }, quantity: { behavior: "customer_entered", minimum: 1 },
    pricing: { model: "scalar", unit: "per_square_foot", priceCents: 500 }, material: { state: "explicitly_unset" }, optionGroups: [],
    workflow: { kind: "standard_production", requiresProofApproval: true, requiresProductionJob: true }, production: { route: { state: "resolved", id: "route-1", label: "Flatbed" }, configuration: {} },
    visibility: { catalogVisible: false }, unresolvedFields: [], fieldMetadata: { "pricing.unit": { source: "explicit_user", confidence: 1 } }, revisionMetadata: { parentRevision: 0 }, operationContext: {},
  };
  return { ...base, ...overrides };
}

function perPieceMatrixIntent(overrides: Record<string, unknown> = {}) {
  return intent({
    measurement: { mode: "quantity_only" },
    pricing: { model: "two_dimensional_matrix", unit: "per_piece", rowOptionKey: "thickness", columnOptionKey: "sides", cells: [
      { row: "3mm", column: "single", priceCents: 1200 }, { row: "3mm", column: "double", priceCents: 1800 },
      { row: "6mm", column: "single", priceCents: 1600 }, { row: "6mm", column: "double", priceCents: 2200 },
    ] },
    optionGroups: [
      { key: "thickness", label: "Thickness", required: true, selectionMode: "single", values: [{ key: "3mm", label: "3mm", isDefault: true }, { key: "6mm", label: "6mm", isDefault: false }] },
      { key: "sides", label: "Sides", required: true, selectionMode: "single", values: [{ key: "single", label: "Single-sided", isDefault: true }, { key: "double", label: "Double-sided", isDefault: false }] },
    ],
    production: { route: { state: "explicitly_unset" }, configuration: {} },
    ...overrides,
  });
}

function translucentVinylIntent(overrides: Record<string, unknown> = {}) {
  return intent({
    identity: { name: "Translucent Vinyl - Multilayer Print Test 6", description: "", category: { state: "resolved", id: "category-1", label: "Signs" } },
    pricing: { model: "two_dimensional_matrix", unit: "per_square_foot", rowOptionKey: "layers", columnOptionKey: "surface", cells: [
      { row: "3_layers", column: "first_surface", priceCents: 500 }, { row: "3_layers", column: "second_surface", priceCents: 500 },
      { row: "5_layers", column: "first_surface", priceCents: 600 }, { row: "5_layers", column: "second_surface", priceCents: 600 },
    ] },
    material: { state: "explicitly_unset" },
    optionGroups: [
      { key: "surface", label: "Surface", required: true, selectionMode: "single", values: [{ key: "first_surface", label: "1st Surface (Right Reading)", isDefault: true }, { key: "second_surface", label: "2nd Surface (Reverse Printed)", isDefault: false }] },
      { key: "layers", label: "Layers", required: true, selectionMode: "single", values: [{ key: "3_layers", label: "3 Layers", isDefault: true }, { key: "5_layers", label: "5 Layers", isDefault: false }] },
      { key: "finishing", label: "Finishing", required: false, selectionMode: "single", values: [{ key: "none", label: "None", isDefault: true, priceImpact: { kind: "percentage_of_base", percent: 0 } }, { key: "contour_cutting", label: "Contour Cutting", isDefault: false, priceImpact: { kind: "percentage_of_base", percent: 10 } }, { key: "contour_cutting_weed_tape", label: "Contour Cutting + Weed and Tape", isDefault: false, priceImpact: { kind: "percentage_of_base", percent: 30 } }] },
    ],
    workflow: { kind: "standard_production", requiresProofApproval: false, requiresProductionJob: true },
    production: { route: { state: "explicitly_unset" }, configuration: {} },
    ...overrides,
  });
}

describe("projectProductDraftIntentToProductBuilderDraft", () => {
  it("projects a deterministic scalar PBV2 draft with resolved relationships", () => {
    const source = intent();
    const first = projectProductDraftIntentToProductBuilderDraft(source);
    const second = projectProductDraftIntentToProductBuilderDraft(structuredClone(source));
    expect(first).toEqual(second);
    expect(first.product).toMatchObject({ pricingMode: "area", isActive: false, requiresProofApproval: true });
    expect(first.relationships.productionRoute).toEqual({ id: "route-1", label: "Flatbed" });
    expect(first.audit.fingerprint).toBe(productDraftIntentFingerprint(source));
    expect((first.treeJson.meta as any).pricingV2.base).toEqual({ perSqftCents: 500, perPieceCents: null, minimumChargeCents: null });
  });

  it("projects an exact two-dimensional matrix without recreating its prices", () => {
    const source = perPieceMatrixIntent();
    const result = projectProductDraftIntentToProductBuilderDraft(source);
    const matrix = result.treeJson.pricingMatrix as any;
    expect(matrix.dimensions).toEqual(["thickness", "sides"]);
    expect(matrix.rows).toHaveLength(4);
    expect(matrix.rows.map((row: any) => row.variables.base_price).sort((a: number, b: number) => a - b)).toEqual([1200, 1600, 1800, 2200]);
    expect((result.treeJson.meta as any).pricingV2.optionMatrixPricingUnit).toBe("per_piece");
    expect(result.product).toMatchObject({ pricingMode: "quantity", measurementMode: "quantity_only", pricingProfileKey: "qty_only", isActive: false });
    expect(result.treeJson.meta).toMatchObject({ pricingProfileKey: "qty_only", requiresDimensions: false });
    expect((result.treeJson.meta as any).pricingFormula).toBeUndefined();
    expect(JSON.stringify(result.treeJson)).not.toContain("total_sqft");
    expect((result.treeJson.meta as any).productIntake.quantity).toEqual(expect.objectContaining({
      configured: true,
      behavior: "customer_entered",
      notes: "Quantity is entered on the quote or order line item.",
      lineItemQuantitySource: true,
      customerFacingOptionGenerated: false,
      sourceOptions: [],
      mapping: {
        source: "line_item_quantity",
        variable: "q",
        pricingBehavior: "per_piece",
        pricingPreviewField: "quantity",
        quoteLineItemField: "quantity",
        orderLineItemField: "quantity",
        matrixAxes: ["thickness", "sides"],
      },
    }));
    expect(optionTreeV2Schema.safeParse(result.treeJson).success).toBe(true);
  });

  it("rejects canonical tree metadata when any required quantity field is omitted while keeping legacy trees compatible", () => {
    const projected = projectProductDraftIntentToProductBuilderDraft(perPieceMatrixIntent());
    const missingMapping = structuredClone(projected.treeJson) as any;
    delete missingMapping.meta.productIntake.quantity.mapping;
    const rejected = optionTreeV2Schema.safeParse(missingMapping);
    expect(rejected.success).toBe(false);
    if (!rejected.success) expect(rejected.error.issues.map((issue) => issue.path.join("."))).toContain("meta.productIntake.quantity.mapping");

    const legacy = structuredClone(projected.treeJson) as any;
    delete legacy.meta.productIntake.architecture;
    delete legacy.meta.productIntake.quantity.mapping;
    delete legacy.meta.productIntake.quantity.configured;
    expect(optionTreeV2Schema.safeParse(legacy).success).toBe(true);
  });

  it.each([
    ["3mm", "single", 1, 12], ["3mm", "double", 1, 18], ["6mm", "single", 1, 16], ["6mm", "double", 1, 22], ["6mm", "double", 3, 66],
  ])("evaluates the quantity-only per-piece matrix for %s / %s at quantity %i", (thickness, sides, quantity, expectedTotal) => {
    const projected = projectProductDraftIntentToProductBuilderDraft(perPieceMatrixIntent());
    const request = validatePricingPreviewRequest({ treeJson: projected.treeJson, quantity, optionSelectionsJson: { thickness: { value: thickness }, sides: { value: sides } } });
    expect(request).toMatchObject({ ok: true, normalized: { widthNum: 0, heightNum: 0, quantityNum: quantity } });
    if (!request.ok) throw new Error("Expected a dimension-free pricing preview request.");
    const matrix = extractProductOptionPricingMatrix(projected.treeJson);
    const resolved = resolveProductOptionPricingMatrix({ pricingMatrix: matrix, selections: { thickness, sides } });
    expect(resolved.errors).toEqual([]);
    expect(resolved.variables.base_price).toBe(expectedTotal / quantity);
    expect(resolved.variables.base_price * request.normalized.quantityNum).toBe(expectedTotal);
  });

  it("keeps square-foot matrices dimensional while assigning every per-piece pricing family to the quantity profile", () => {
    const perSqftMatrix = projectProductDraftIntentToProductBuilderDraft(intent({
      pricing: { model: "two_dimensional_matrix", unit: "per_square_foot", rowOptionKey: "thickness", columnOptionKey: "sides", cells: [{ row: "3mm", column: "single", priceCents: 1200 }] },
      optionGroups: [{ key: "thickness", label: "Thickness", required: true, selectionMode: "single", values: [{ key: "3mm", label: "3mm", isDefault: true }] }, { key: "sides", label: "Sides", required: true, selectionMode: "single", values: [{ key: "single", label: "Single-sided", isDefault: true }] }],
    }));
    expect(perSqftMatrix.product).toMatchObject({ pricingMode: "area", pricingProfileKey: "default", measurementMode: "dimensions_required" });
    expect((perSqftMatrix.treeJson.meta as any).requiresDimensions).toBe(true);
    const scalar = projectProductDraftIntentToProductBuilderDraft(intent({ measurement: { mode: "quantity_only" }, pricing: { model: "scalar", unit: "per_piece", priceCents: 1200 } }));
    expect(scalar.product.pricingProfileKey).toBe("qty_only");
    expect((scalar.treeJson.meta as any).productIntake.quantity.mapping).toMatchObject({ variable: "q", pricingBehavior: "per_piece", matrixAxes: [] });
    const tiers = projectProductDraftIntentToProductBuilderDraft(intent({ measurement: { mode: "quantity_only" }, pricing: { model: "quantity_tiers", unit: "per_piece", tiers: [{ minimumQuantity: 1, maximumQuantity: null, priceCents: 1200 }] } }));
    expect(tiers.product.pricingProfileKey).toBe("qty_only");
    expect((tiers.treeJson.meta as any).productIntake.quantity.mapping).toMatchObject({ variable: "q", pricingBehavior: "quantity_tiers" });
    const fee = projectProductDraftIntentToProductBuilderDraft(intent({ measurement: { mode: "quantity_only" }, workflow: { kind: "service_fee", requiresProofApproval: false, requiresProductionJob: false }, production: { route: { state: "explicitly_unset" }, configuration: {} }, pricing: { model: "scalar", unit: "flat_fee", priceCents: 1200 } }));
    expect(fee.product.pricingProfileKey).toBe("fee");
    expect((fee.treeJson.meta as any).productIntake.quantity.mapping).toMatchObject({ pricingBehavior: "flat_fee", variable: null });
    expect((perSqftMatrix.treeJson.meta as any).productIntake.quantity.mapping).toMatchObject({ pricingBehavior: "per_square_foot", variable: null });
  });

  it.each([
    ["3_layers", "none", 5000],
    ["3_layers", "contour_cutting", 5500],
    ["3_layers", "contour_cutting_weed_tape", 6500],
    ["5_layers", "none", 6000],
    ["5_layers", "contour_cutting", 6600],
    ["5_layers", "contour_cutting_weed_tape", 7800],
  ])("projects option-controlled square-foot pricing for %s / %s", (layers, finishing, expectedCents) => {
    const projected = projectProductDraftIntentToProductBuilderDraft(translucentVinylIntent());
    const matrix = extractProductOptionPricingMatrix(projected.treeJson);
    const selections = { surface: "first_surface", layers, finishing };
    const resolved = resolveProductOptionPricingMatrix({ pricingMatrix: matrix, selections });
    expect(resolved.errors).toEqual([]);
    const basePrice = (resolved.variables.base_price ?? 0) * 10;
    const evaluation = evaluateOptionTreeV2({
      tree: projected.treeJson,
      selections: { schemaVersion: 2, selected: Object.fromEntries(Object.entries(selections).map(([key, value]) => [key, { value }])) },
      width: 120,
      height: 12,
      quantity: 1,
      basePrice,
    });
    expect(Math.round((basePrice + evaluation.optionsPrice) * 100)).toBe(expectedCents);
    expect(projected.product).toMatchObject({ pricingMode: "area", measurementMode: "dimensions_required", pricingProfileKey: "default", requiresProductionJob: true, requiresProofApproval: false });
    expect(projected.relationships).toEqual({ material: { state: "explicitly_unset" }, productionRoute: null });
  });

  it("uses one exclusive finishing choice, preventing a 30% total from stacking to 40%", () => {
    const projected = projectProductDraftIntentToProductBuilderDraft(translucentVinylIntent());
    const surface = Object.values((projected.treeJson as any).nodes).find((node: any) => node.key === "surface") as any;
    const finishing = Object.values((projected.treeJson as any).nodes).find((node: any) => node.key === "finishing") as any;
    expect(surface.choices.map((choice: any) => choice.label)).toEqual(["1st Surface (Right Reading)", "2nd Surface (Reverse Printed)"]);
    expect(surface.choices.every((choice: any) => choice.pricingImpact === undefined)).toBe(true);
    expect(finishing.input).toMatchObject({ type: "select", required: false, selectionKey: "finishing" });
    expect(finishing.choices.map((choice: any) => choice.value)).toEqual(["none", "contour_cutting", "contour_cutting_weed_tape"]);
    expect(finishing.choices.find((choice: any) => choice.value === "contour_cutting")?.pricingImpact).toEqual([expect.objectContaining({ mode: "addPercent", percent: 10, basis: "base" })]);
    expect(finishing.choices.find((choice: any) => choice.value === "contour_cutting_weed_tape")?.pricingImpact).toEqual([expect.objectContaining({ mode: "addPercent", percent: 30, basis: "base" })]);
    expect(finishing.choices.some((choice: any) => choice.value === "weed_tape")).toBe(false);
    expect(optionTreeV2Schema.safeParse(projected.treeJson).success).toBe(true);
    const missingDimensions = validatePricingPreviewRequest({ treeJson: projected.treeJson, quantity: 1, optionSelectionsJson: { surface: { value: "first_surface" }, layers: { value: "3_layers" }, finishing: { value: "none" } } });
    expect(missingDimensions).toMatchObject({ ok: false, envelope: { details: expect.arrayContaining([expect.objectContaining({ path: "width" }), expect.objectContaining({ path: "height" })]) } });
  });

  it("multiplies the resolved square-foot base and its exclusive finishing impact by quantity", () => {
    const projected = projectProductDraftIntentToProductBuilderDraft(translucentVinylIntent());
    const resolved = resolveProductOptionPricingMatrix({ pricingMatrix: extractProductOptionPricingMatrix(projected.treeJson), selections: { surface: "second_surface", layers: "5_layers", finishing: "contour_cutting" } });
    const basePrice = (resolved.variables.base_price ?? 0) * 10 * 2;
    const evaluation = evaluateOptionTreeV2({ tree: projected.treeJson, selections: { schemaVersion: 2, selected: { surface: { value: "second_surface" }, layers: { value: "5_layers" }, finishing: { value: "contour_cutting" } } }, width: 120, height: 12, quantity: 2, basePrice });
    expect(Math.round((basePrice + evaluation.optionsPrice) * 100)).toBe(13200);
  });

  it("keeps fixed-size quantity behavior explicit and blocks quantity-only products with no quantity behavior", () => {
    const fixed = projectProductDraftIntentToProductBuilderDraft(intent({
      measurement: { mode: "fixed_size", dimensions: { widthIn: 24, heightIn: 18, allowRotation: false } },
      quantity: { behavior: "fixed", quantity: 2 },
      pricing: { model: "scalar", unit: "per_piece", priceCents: 1200 },
    }));
    expect((fixed.treeJson.meta as any).productIntake.quantity).toMatchObject({ configured: true, lineItemQuantitySource: false, mapping: { source: "fixed_quantity", variable: "q", fixedQuantity: 2 } });
    expect(() => projectProductDraftIntentToProductBuilderDraft(intent({ measurement: { mode: "quantity_only" }, quantity: { behavior: "not_applicable" }, pricing: { model: "scalar", unit: "per_piece", priceCents: 1200 } }))).toThrow(ProductIntentProjectionError);
  });

  it("projects hourly service pricing as fractional billable hours, never per-piece pricing", () => {
    const projected = projectProductDraftIntentToProductBuilderDraft(intent({
      identity: { name: "Design", description: "", category: { state: "resolved", id: "fees", label: "Fees" } },
      measurement: { mode: "quantity_only" },
      quantity: { behavior: "not_applicable" },
      pricing: { model: "scalar", unit: "per_hour", priceCents: 6000 },
      material: { state: "explicitly_unset" }, optionGroups: [],
      workflow: { kind: "service_fee", requiresProofApproval: false, requiresProductionJob: false },
      production: { route: { state: "explicitly_unset" }, configuration: {} },
    }));
    expect(projected.product).toMatchObject({ category: "Fees", pricingProfileKey: "hourly", pricingFormula: "hours * hourly_rate", pricingProfileConfig: { formulaVariables: { hourly_rate: 60 } }, measurementMode: "quantity_only", requiresProductionJob: false, requiresProofApproval: false, isService: true });
    expect((projected.treeJson.meta as any)).toMatchObject({ pricingFormula: "hours * hourly_rate", pricingFormulaVariables: { hourly_rate: 60 }, billingUnit: { kind: "hour", selectionKey: "hours", step: 0.25 } });
    expect((projected.treeJson.meta as any).pricingV2.base).toEqual({ perSqftCents: null, perPieceCents: null, minimumChargeCents: null });
    const hours = Object.values(projected.treeJson.nodes as Record<string, any>).find((node: any) => node.input?.selectionKey === "hours");
    expect(hours?.input).toMatchObject({ type: "number", required: true, constraints: { number: { min: 0.25, step: 0.25 } } });
    const variables = buildNumericSelectionFormulaVariables({ treeJson: projected.treeJson, selections: { hours: { value: 2.5 } } });
    expect(variables.hours).toBe(2.5);
    expect(variables.hours * (projected.treeJson.meta as any).pricingFormulaVariables.hourly_rate * 100).toBe(15000);

    for (const [hoursValue, total] of [[0.25, 15], [0.5, 30], [1, 60], [1.25, 75], [2.5, 150]] as const) {
      expect(hoursValue * (projected.product.pricingProfileConfig!.formulaVariables.hourly_rate)!).toBe(total);
    }
  });

  it("projects a flat service fee as the canonical zero-option tree", () => {
    const projected = projectProductDraftIntentToProductBuilderDraft(intent({
      identity: { name: "Setup Fee", description: "", category: { state: "resolved", id: "fees", label: "Fees" } },
      measurement: { mode: "quantity_only" }, quantity: { behavior: "not_applicable" },
      pricing: { model: "scalar", unit: "flat_fee", priceCents: 6000 }, material: { state: "explicitly_unset" }, optionGroups: [],
      workflow: { kind: "service_fee", requiresProofApproval: false, requiresProductionJob: false },
      production: { route: { state: "explicitly_unset" }, configuration: {} },
    }));
    expect(projected.treeJson).toMatchObject({ schemaVersion: 2, status: "DRAFT", rootNodeIds: [], nodes: {}, edges: [] });
    expect(validateOptionTreeV2(projected.treeJson).ok).toBe(true);
    expect(validatePricingPreviewRequest({ treeJson: projected.treeJson, measurementMode: "quantity_only", quantity: 1, optionSelectionsJson: {} })).toMatchObject({ ok: true });
  });

  it("projects continuous quantity tiers into PBV2 lower-bound tiers", () => {
    const source = intent({ measurement: { mode: "quantity_only" }, pricing: { model: "quantity_tiers", unit: "per_piece", tiers: [
      { minimumQuantity: 1, maximumQuantity: 24, priceCents: 300 }, { minimumQuantity: 25, maximumQuantity: 49, priceCents: 250 }, { minimumQuantity: 50, maximumQuantity: null, priceCents: 200 },
    ] } });
    const result = projectProductDraftIntentToProductBuilderDraft(source);
    expect((result.treeJson.meta as any).pricingV2.qtyTiers).toEqual(expect.arrayContaining([
      expect.objectContaining({ minQty: 1, maxQty: 24, perPieceCents: 300 }), expect.objectContaining({ minQty: 50, maxQty: null, perPieceCents: 200 }),
    ]));
  });

  it("rejects unresolved operational state before returning any draft", () => {
    expect(() => projectProductDraftIntentToProductBuilderDraft(intent({ material: { state: "unresolved", label: "Acrylic" } }))).toThrow(ProductIntentProjectionError);
  });

  it("blocks projection when a required meaningful option default remains unresolved", () => {
    const source = translucentVinylIntent({
      optionGroups: translucentVinylIntent().optionGroups.map((group: any) => group.key === "surface" ? { ...group, values: group.values.map((value: any) => ({ ...value, isDefault: false })) } : group),
    });
    expect(() => projectProductDraftIntentToProductBuilderDraft(source)).toThrow(expect.objectContaining({ code: "OPTION_DEFAULT_UNRESOLVED", path: "optionGroups.surface.default" }));
  });

  it("preserves an unresolved matrix unit in the contract but blocks PBV2 projection", () => {
    const source = intent({
      state: "needs_answers",
      pricing: { model: "two_dimensional_matrix", unit: "unresolved", rowOptionKey: "thickness", columnOptionKey: "sides", cells: [{ row: "3mm", column: "single", priceCents: 1200 }] },
      optionGroups: [
        { key: "thickness", label: "Thickness", required: true, selectionMode: "single", values: [{ key: "3mm", label: "3mm", isDefault: true }] },
        { key: "sides", label: "Sides", required: true, selectionMode: "single", values: [{ key: "single", label: "Single-sided", isDefault: true }] },
      ],
      unresolvedFields: [{ path: "pricing.unit", code: "PRICING_UNIT_UNRESOLVED", question: "Are these matrix prices per piece or per square foot?" }],
    });
    try {
      projectProductDraftIntentToProductBuilderDraft(source);
      throw new Error("Expected projection to reject an unresolved intent.");
    } catch (error) {
      expect(error).toMatchObject({ code: "INTENT_NOT_READY" });
    }
    try {
      projectProductDraftIntentToProductBuilderDraft({ ...source, state: "ready_for_review", unresolvedFields: [] });
      throw new Error("Expected projection to reject an unresolved pricing unit.");
    } catch (error) {
      expect(error).toMatchObject({ code: "PRICING_UNIT_UNRESOLVED" });
    }
  });
});
