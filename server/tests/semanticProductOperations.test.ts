import { describe, expect, test } from "@jest/globals";
import { applyProductDraftIntentPatch, productDraftIntentSchema } from "@shared/productDraftIntent";
import { compileSemanticProductOperations } from "../services/productIntentCompiler/semanticProductOperations";
import { ProductIntentCompiler } from "../services/productIntentCompiler/productIntentCompiler";
import { projectProductDraftIntentToProductBuilderDraft } from "../services/productIntentCompiler/productIntentProjection";

const translucentIntent = productDraftIntentSchema.parse({
  contractVersion: 1, intentId: "intent_1", organizationId: "org_1", revision: 4, state: "needs_answers", operation: "new_product",
  identity: { name: "Translucent Vinyl - Multilayer Print", description: "", category: { state: "unresolved", label: "Product category" } }, lifecycle: { productStatus: "inactive", published: false },
  measurement: { mode: "dimensions_required" }, quantity: { behavior: "customer_entered", minimum: 1 }, pricing: { model: "two_dimensional_matrix", unit: "per_square_foot", rowOptionKey: "surface", columnOptionKey: "layers", cells: [{ row: "first-surface", column: "three-layer", priceCents: 500 }, { row: "first-surface", column: "five-layer", priceCents: 600 }, { row: "second-surface", column: "three-layer", priceCents: 500 }, { row: "second-surface", column: "five-layer", priceCents: 600 }] },
  material: { state: "explicitly_unset" }, optionGroups: [{ key: "surface", label: "Surface", required: true, selectionMode: "single", values: [{ key: "first-surface", label: "1st surface (right reading)", isDefault: false }, { key: "second-surface", label: "2nd surface (reverse printed)", isDefault: false }] }, { key: "layers", label: "Layers", required: true, selectionMode: "single", values: [{ key: "three-layer", label: "3 layers", isDefault: false }, { key: "five-layer", label: "5 layers", isDefault: false }] }],
  workflow: { kind: "standard_production", requiresProofApproval: false, requiresProductionJob: true }, production: { route: { state: "explicitly_unset" }, configuration: {} }, visibility: { catalogVisible: false }, unresolvedFields: [], fieldMetadata: {}, revisionMetadata: { parentRevision: 3 }, operationContext: {},
});

describe("semantic product operations", () => {
  test("projects complete option-dependent lower-bound tiers into canonical schedules", () => {
    const current = productDraftIntentSchema.parse({ ...translucentIntent, measurement: { mode: "quantity_only" }, pricing: { model: "unresolved", unit: "per_piece" }, optionGroups: [{ key: "sides", label: "Sides", required: true, selectionMode: "single", values: [{ key: "single", label: "Single Sided", isDefault: true }, { key: "double", label: "Double Sided", isDefault: false }] }] });
    const patch = compileSemanticProductOperations(current, { kind: "semantic_operations", operations: [{ op: "set_option_quantity_tiers", optionGroup: "Sides", basis: "per_piece", rows: [{ value: "Single Sided", tiers: [{ minimumQuantity: 1, priceCents: 440 }, { minimumQuantity: 100, priceCents: 330 }, { minimumQuantity: 500, priceCents: 300 }] }, { value: "Double Sided", tiers: [{ minimumQuantity: 1, priceCents: 550 }, { minimumQuantity: 100, priceCents: 440 }, { minimumQuantity: 500, priceCents: 400 }] }] }] }, 4);
    const next = applyProductDraftIntentPatch(current, patch);
    expect(next.pricing).toMatchObject({ model: "option_quantity_tiers", optionKey: "sides", rows: [{ option: "single", tiers: [{ minimumQuantity: 1, maximumQuantity: 99, priceCents: 440 }, { minimumQuantity: 100, maximumQuantity: 499, priceCents: 330 }, { minimumQuantity: 500, maximumQuantity: null, priceCents: 300 }] }, { option: "double" }] });
    const ready = productDraftIntentSchema.parse({ ...next, state: "ready_for_review", identity: { ...next.identity, category: { state: "resolved", id: "signs", label: "Signs" } }, unresolvedFields: [] });
    const projected = projectProductDraftIntentToProductBuilderDraft(ready);
    expect((projected.treeJson.pricingMatrix as any).rows).toEqual(expect.arrayContaining([expect.objectContaining({ when: { sides: "single" }, tierBasis: "line_item_quantity", qtyTiers: expect.arrayContaining([expect.objectContaining({ minQty: 100, maxQty: 499, perPieceCents: 330 })]) })]));
  });
  test("translates multiple natural default answers without provider patch paths", () => {
    const patch = compileSemanticProductOperations(translucentIntent, { kind: "semantic_operations", operations: [{ op: "set_option_default", optionGroup: "Surface", value: "1st surface (right reading)" }, { op: "set_option_default", optionGroup: "Layers", value: "3 layers" }] }, 4);
    expect(JSON.stringify(patch)).not.toContain("ProductDraftPatch");
    const next = applyProductDraftIntentPatch(translucentIntent, patch);
    expect(next.optionGroups[0]!.values.find((value) => value.isDefault)?.label).toBe("1st surface (right reading)");
    expect(next.optionGroups[1]!.values.find((value) => value.isDefault)?.label).toBe("3 layers");
    expect(next.revision).toBe(5);
  });

  test("rejects an ambiguous or unknown business label instead of guessing", () => {
    expect(() => compileSemanticProductOperations(translucentIntent, { kind: "semantic_operations", operations: [{ op: "set_option_default", optionGroup: "Surface", value: "Front" }] }, 4)).toThrow("OPTION_VALUE_UNRESOLVED");
  });

  test("compiles a natural layer-price correction across the matrix axis", () => {
    const patch = compileSemanticProductOperations(translucentIntent, { kind: "semantic_operations", operations: [{ op: "set_matrix_rate", optionGroup: "Layers", value: "3 layers", priceCents: 550 }] }, 4);
    const next = applyProductDraftIntentPatch(translucentIntent, patch);
    if (next.pricing.model !== "two_dimensional_matrix") throw new Error("Expected matrix pricing");
    expect(next.pricing.cells.filter((cell) => cell.column === "three-layer").map((cell) => cell.priceCents)).toEqual([550, 550]);
    expect(next.pricing.cells.filter((cell) => cell.column === "five-layer").map((cell) => cell.priceCents)).toEqual([600, 600]);
  });

  test("translates an explicit category correction while preserving the active product configuration", () => {
    const current = productDraftIntentSchema.parse({ ...translucentIntent, identity: { ...translucentIntent.identity, category: { state: "resolved", id: "flatbed", label: "Flatbed Printing" } }, fieldMetadata: { ...translucentIntent.fieldMetadata, "identity.category": { source: "explicit_user" } } });
    const patch = compileSemanticProductOperations(current, { kind: "semantic_operations", operations: [{ op: "set_category", category: "Roll Printing" }] }, 4, "I accidentally selected flatbed printing, but this would be roll printing.");
    const next = applyProductDraftIntentPatch(current, patch);
    expect(next.identity).toEqual({ ...current.identity, category: { state: "unresolved", label: "Roll Printing" } });
    expect(next.fieldMetadata["identity.category"]).toEqual({ source: "explicit_user" });
    expect(next.pricing).toEqual(current.pricing);
    expect(next.optionGroups).toEqual(current.optionGroups);
    expect(() => compileSemanticProductOperations(current, { kind: "semantic_operations", operations: [{ op: "set_category", category: "Roll Printing" }] }, 4, "Change the current product.")).toThrow("CATEGORY_UNRESOLVED");
  });

  test("resolves a short user category phrase only when one tenant candidate contains it", () => {
    const current = productDraftIntentSchema.parse({ ...translucentIntent, identity: { ...translucentIntent.identity, category: { state: "resolved", id: "flatbed", label: "Flatbed Printing" } }, fieldMetadata: { ...translucentIntent.fieldMetadata, "identity.category": { source: "explicit_user" } } });
    const patch = compileSemanticProductOperations(current, { kind: "semantic_operations", operations: [{ op: "set_category", category: "roll" }] }, 4, "I accidentally selected flatbed and it is supposed to be roll.", { categoryLabels: ["Flatbed Printing", "Roll Printing"] });
    const next = applyProductDraftIntentPatch(current, patch);
    expect(next.identity.category).toEqual({ state: "unresolved", label: "Roll Printing" });
    expect(next.fieldMetadata["identity.category"]).toEqual({ source: "explicit_user" });
    expect(() => compileSemanticProductOperations(current, { kind: "semantic_operations", operations: [{ op: "set_category", category: "roll" }] }, 4, "It is supposed to be roll.", { categoryLabels: ["Roll Printing", "Roll Labels"] })).toThrow("CATEGORY_AMBIGUOUS");
  });

  test("accepts a model-selected category label when the user uniquely identifies it in active context", () => {
    const current = productDraftIntentSchema.parse({ ...translucentIntent, identity: { ...translucentIntent.identity, category: { state: "resolved", id: "flatbed", label: "Flatbed Printing" } } });
    const patch = compileSemanticProductOperations(current, { kind: "semantic_operations", operations: [{ op: "set_category", category: "Roll Printing" }] }, 4, "I accidentally pressed flatbed. This is a roll product.", { categoryLabels: ["Flatbed Printing", "Roll Printing"] });
    const next = applyProductDraftIntentPatch(current, patch);
    expect(next.identity.category).toEqual({ state: "unresolved", label: "Roll Printing" });
    expect(next.material).toEqual(current.material);
    expect(next.pricing).toEqual(current.pricing);
  });

  test("accepts the exact ordered supplied-detail creation batch with a name followed by its category", () => {
    const current = productDraftIntentSchema.parse({
      ...translucentIntent,
      identity: { ...translucentIntent.identity, name: "Unfinished product draft", category: { state: "unresolved", label: "Product category" } },
      measurement: { mode: "quantity_only" }, pricing: { model: "unresolved" }, optionGroups: [],
      unresolvedFields: [{ path: "identity.name", code: "PRODUCT_NAME_UNRESOLVED" }, { path: "measurement.mode", code: "MEASUREMENT_UNRESOLVED" }],
      fieldMetadata: { "identity.name": { source: "unresolved" }, "measurement.mode": { source: "unresolved" }, "identity.category": { source: "unresolved" } },
    });
    const request = "Create a new inactive product named QA Browser Test Product 20260811130111. It is a test-only Roll Printing product that requires dimensions and uses per-square-foot pricing. Add a required single-select Finish option with Standard as its default. Prepare the Product Builder draft only; do not execute GO.";
    const patch = compileSemanticProductOperations(current, { kind: "semantic_operations", operations: [
      { op: "set_product_name", name: "QA Browser Test Product 20260811130111" },
      { op: "set_category", category: "Roll Printing" },
      { op: "set_measurement_mode", mode: "dimensions_required" },
      { op: "set_pricing_basis", basis: "per_square_foot" },
      { op: "add_option_group", optionGroup: "Finish", required: true, selectionMode: "single" },
      { op: "add_option_value", optionGroup: "Finish", value: "Standard" },
      { op: "set_option_default", optionGroup: "Finish", value: "Standard" },
    ] }, 4, request, { categoryLabels: ["Flatbed Printing", "Roll Printing", "Fees", "Stock Item"] });
    const next = applyProductDraftIntentPatch(current, patch);
    expect(next.identity).toMatchObject({ name: "QA Browser Test Product 20260811130111", category: { state: "unresolved", label: "Roll Printing" } });
    expect(next.measurement).toEqual({ mode: "dimensions_required" });
    expect(next.pricing).toEqual({ model: "unresolved", unit: "per_square_foot" });
    expect(next.optionGroups).toEqual([{ key: "finish", label: "Finish", required: true, selectionMode: "single", values: [{ key: "standard", label: "Standard", isDefault: true }] }]);
    expect(() => compileSemanticProductOperations(current, { kind: "semantic_operations", operations: [
      { op: "set_category", category: "Roll Printing" }, { op: "set_category", category: "Flatbed Printing" },
    ] }, 4, request, { categoryLabels: ["Flatbed Printing", "Roll Printing"] })).toThrow("CATEGORY_UNRESOLVED");
  });

  test("preserves an explicit quoted product name and infers dimensions from square-foot pricing", () => {
    const current = productDraftIntentSchema.parse({
      ...translucentIntent,
      identity: { ...translucentIntent.identity, name: "Unfinished product draft" },
      measurement: { mode: "quantity_only" }, pricing: { model: "unresolved" }, optionGroups: [],
      unresolvedFields: [{ path: "identity.name", code: "PRODUCT_NAME_UNRESOLVED" }, { path: "measurement.mode", code: "MEASUREMENT_UNRESOLVED" }],
      fieldMetadata: { "identity.name": { source: "unresolved" }, "measurement.mode": { source: "unresolved" } },
    });
    const request = "Let's add a new product called \"Translucent Vinyl - backlit with multilayer printing\". 3 Layer is $4 per square foot and 5 Layer is $5 per square foot.";
    const patch = compileSemanticProductOperations(current, { kind: "semantic_operations", operations: [
      { op: "set_product_name", name: "Translucent Vinyl - backlit" },
      { op: "add_option_group", optionGroup: "Layers", required: true, selectionMode: "single" },
      { op: "add_option_value", optionGroup: "Layers", value: "3 Layer" },
      { op: "add_option_value", optionGroup: "Layers", value: "5 Layer" },
      { op: "set_option_rate", optionGroup: "Layers", value: "3 Layer", priceCents: 400, basis: "per_square_foot" },
      { op: "set_option_rate", optionGroup: "Layers", value: "5 Layer", priceCents: 500, basis: "per_square_foot" },
    ] }, 4, request);
    const next = applyProductDraftIntentPatch(current, patch);
    expect(next.identity.name).toBe("Translucent Vinyl - backlit with multilayer printing");
    expect(next.measurement).toEqual({ mode: "dimensions_required" });
    expect(next.unresolvedFields.map((field) => field.path)).not.toEqual(expect.arrayContaining(["identity.name", "measurement.mode"]));
  });

  test("preserves missing matrix-rate questions across canonical pricing continuations", () => {
    const current = productDraftIntentSchema.parse({
      ...translucentIntent,
      pricing: { model: "unresolved" },
      optionGroups: [],
      unresolvedFields: [],
      fieldMetadata: {},
    });
    const first = applyProductDraftIntentPatch(current, compileSemanticProductOperations(current, { kind: "semantic_operations", operations: [
      { op: "add_option_group", optionGroup: "Layers", required: true, selectionMode: "single" },
      { op: "add_option_value", optionGroup: "Layers", value: "3 Layer" },
      { op: "add_option_value", optionGroup: "Layers", value: "5 Layer" },
      { op: "set_option_rate", optionGroup: "Layers", value: "3 Layer", priceCents: 400, basis: "per_square_foot" },
    ] }, current.revision));
    expect(first.unresolvedFields).toEqual(expect.arrayContaining([expect.objectContaining({ path: "pricing.optionRates.layers.5_layer", code: "OPTION_RATE_UNRESOLVED" })]));
    const completed = applyProductDraftIntentPatch(first, compileSemanticProductOperations(first, { kind: "semantic_operations", operations: [
      { op: "set_option_rate", optionGroup: "Layers", value: "5 Layer", priceCents: 500, basis: "per_square_foot" },
    ] }, first.revision));
    expect(completed.unresolvedFields.map((field) => field.path)).not.toContain("pricing.optionRates.layers.5_layer");
  });

  test("preserves the literal product-for name even when the initial operation batch omits a rename", () => {
    const current = productDraftIntentSchema.parse({
      ...translucentIntent,
      identity: { ...translucentIntent.identity, name: "Unfinished product draft" },
      pricing: { model: "unresolved" }, optionGroups: [],
      unresolvedFields: [{ path: "identity.name", code: "PRODUCT_NAME_UNRESOLVED" }],
      fieldMetadata: { "identity.name": { source: "unresolved" } },
    });
    const patch = compileSemanticProductOperations(current, { kind: "semantic_operations", operations: [
      { op: "set_scalar_price", priceCents: 900, basis: "per_piece" },
      { op: "add_option_group", optionGroup: "Sides", required: true, selectionMode: "single" },
      { op: "add_option_value", optionGroup: "Sides", value: "Single Sided" },
      { op: "set_option_default", optionGroup: "Sides", value: "Single Sided" },
    ] }, 4, 'Add a product for "Relective Pole Signs". It is $9 per piece.');
    const next = applyProductDraftIntentPatch(current, patch);
    expect(next.identity.name).toBe("Relective Pole Signs");
    expect(next.pricing).toEqual({ model: "scalar", unit: "per_piece", priceCents: 900 });
    expect(next.optionGroups[0]?.values.find((value) => value.isDefault)?.label).toBe("Single Sided");
  });

  test("retains independent name and per-piece pricing when one option reference is unresolved", () => {
    const current = productDraftIntentSchema.parse({
      ...translucentIntent,
      identity: { ...translucentIntent.identity, name: "Unfinished product draft" },
      measurement: { mode: "quantity_only" }, pricing: { model: "unresolved" }, optionGroups: [],
      unresolvedFields: [{ path: "identity.name", code: "PRODUCT_NAME_UNRESOLVED", question: "What should this product be called?" }, { path: "measurement.mode", code: "MEASUREMENT_UNRESOLVED", question: "Dimensions or quantity only?" }],
      fieldMetadata: { "identity.name": { source: "unresolved" }, "measurement.mode": { source: "unresolved" } },
    });
    const request = 'Add a product for "Reflective Directional Sign". It is $9 each, with a Finish option, and only a certain customer may use it.';
    const patch = compileSemanticProductOperations(current, { kind: "semantic_operations", operations: [
      { op: "set_product_name", name: "Reflective Directional Sign" },
      { op: "set_scalar_price", priceCents: 900, basis: "per_piece" },
      { op: "add_option_group", optionGroup: "Finish", required: true, selectionMode: "single" },
      { op: "set_option_default", optionGroup: "Finish", value: "Unspecified Choice" },
      { op: "record_unsupported_detail", detail: "customer_specific_availability" },
    ] }, current.revision, request);
    const next = applyProductDraftIntentPatch(current, patch);
    expect(next.identity.name).toBe("Reflective Directional Sign");
    expect(next.pricing).toEqual({ model: "scalar", unit: "per_piece", priceCents: 900 });
    expect(next.unresolvedFields).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: "measurement.mode", code: "MEASUREMENT_UNRESOLVED" }),
      expect.objectContaining({ path: "semanticOperations.set_option_default", code: expect.stringContaining("OPTION_VALUE_UNRESOLVED") }),
    ]));
    expect(next.fieldMetadata["unsupportedDetails.customer_specific_availability"]).toEqual({ source: "explicit_user" });
  });

  test("treats an already-established repeated name as a no-op during a pricing clarification", () => {
    const current = productDraftIntentSchema.parse({
      ...translucentIntent,
      identity: { ...translucentIntent.identity, name: "Established Product" },
      measurement: { mode: "quantity_only" }, pricing: { model: "unresolved" }, optionGroups: [],
      unresolvedFields: [{ path: "measurement.mode", code: "MEASUREMENT_UNRESOLVED", question: "Dimensions or quantity only?" }],
      fieldMetadata: { "identity.name": { source: "explicit_user" }, "measurement.mode": { source: "unresolved" } },
    });
    const patch = compileSemanticProductOperations(current, { kind: "semantic_operations", operations: [
      { op: "set_product_name", name: "Established Product" },
      { op: "set_scalar_price", priceCents: 900, basis: "per_piece" },
    ] }, current.revision, "Pricing is $9 each.");
    const next = applyProductDraftIntentPatch(current, patch);
    expect(next.identity.name).toBe("Established Product");
    expect(next.pricing).toEqual({ model: "scalar", unit: "per_piece", priceCents: 900 });
    expect(next.unresolvedFields).toEqual([expect.objectContaining({ path: "measurement.mode" })]);
  });

  test("preserves the literal product-for name over a conflicting model paraphrase", () => {
    const current = productDraftIntentSchema.parse({ ...translucentIntent, identity: { ...translucentIntent.identity, name: "Unfinished product draft" } });
    const patch = compileSemanticProductOperations(current, { kind: "semantic_operations", operations: [{ op: "set_product_name", name: "Reflective Pole Signs" }] }, 4, 'Add a product for "Relective Pole Signs".');
    expect(applyProductDraftIntentPatch(current, patch).identity.name).toBe("Relective Pole Signs");
  });

  test("applies out-of-order option operations generically without inventing vocabulary-specific values", () => {
    const current = productDraftIntentSchema.parse({
      ...translucentIntent,
      identity: { ...translucentIntent.identity, name: "Relective Pole Signs" },
      pricing: { model: "scalar", unit: "per_piece", priceCents: 900 },
      optionGroups: [
        { key: "sides", label: "Sides", required: true, selectionMode: "single", values: [{ key: "single_sided", label: "Single Sided", isDefault: true }] },
        { key: "grommets", label: "Grommets", required: false, selectionMode: "single", values: [] },
      ],
    });
    const patch = compileSemanticProductOperations(current, { kind: "semantic_operations", operations: [
      // Defaults deliberately precede their values and placement's group.
      { op: "set_option_default", optionGroup: "Grommets", value: "Yes" },
      { op: "add_option_value", optionGroup: "Grommets", value: "Yes" },
      { op: "add_option_value", optionGroup: "Grommets", value: "Yes" },
      { op: "set_option_default", optionGroup: "Grommet Placement", value: "Top and Bottom" },
      { op: "add_option_value", optionGroup: "Grommet Placement", value: "Top and Bottom" },
      { op: "add_option_group", optionGroup: "Grommet Placement", required: false, selectionMode: "single" },
      { op: "record_unsupported_detail", detail: "grommet_quantity" },
    ] }, 4, "Grommets would be default, top and bottom. 1 each so each one gets 2 grommets. Product is called Reflective Pole Signs - Rick.");
    const next = applyProductDraftIntentPatch(current, patch);
    expect(next.identity.name).toBe("Reflective Pole Signs - Rick");
    expect(next.optionGroups.find((group) => group.label === "Grommets")?.values).toEqual([
      { key: "yes", label: "Yes", isDefault: true },
    ]);
    expect(next.optionGroups.find((group) => group.label === "Grommet Placement")?.values).toEqual([{ key: "top_and_bottom", label: "Top and Bottom", isDefault: true }]);
    expect(next.unresolvedFields).toEqual(expect.arrayContaining([expect.objectContaining({ path: "optionGroups.grommets.quantity", code: "GROMMET_QUANTITY_UNRESOLVED" })]));
  });

  test("atomically retains a stated pricing basis while applying the exact multi-change follow-up", () => {
    const current = productDraftIntentSchema.parse({
      ...translucentIntent,
      identity: { ...translucentIntent.identity, name: "Unfinished product draft" },
      measurement: { mode: "quantity_only" }, pricing: { model: "unresolved" }, optionGroups: [],
      unresolvedFields: [{ path: "identity.name", code: "PRODUCT_NAME_UNRESOLVED" }, { path: "measurement.mode", code: "MEASUREMENT_UNRESOLVED" }],
      fieldMetadata: { "identity.name": { source: "unresolved" }, "measurement.mode": { source: "unresolved" } },
    });
    const request = "this is per square foot. It should be called 'Translucent Vinyl - Multilayer Print'. It does require width and height to compute the square footage";
    const patch = compileSemanticProductOperations(current, { kind: "semantic_operations", operations: [
      { op: "set_pricing_basis", basis: "per_square_foot" },
      { op: "set_product_name", name: "Translucent Vinyl - Multilayer Print" },
      { op: "set_measurement_mode", mode: "dimensions_required" },
    ] }, 4, request);
    const next = applyProductDraftIntentPatch(current, patch);
    expect(next.identity.name).toBe("Translucent Vinyl - Multilayer Print");
    expect(next.measurement).toEqual({ mode: "dimensions_required" });
    expect(next.pricing).toEqual({ model: "unresolved", unit: "per_square_foot" });
    expect(next.revision).toBe(5);
  });

  test("renames an option group without changing its pricing axis or values", () => {
    const patch = compileSemanticProductOperations(translucentIntent, { kind: "semantic_operations", operations: [{ op: "rename_option_group", optionGroup: "Layers", name: "Print Layers" }] }, 4, "Call the option Print Layers instead.");
    const next = applyProductDraftIntentPatch(translucentIntent, patch);
    expect(next.optionGroups.find((group) => group.key === "layers")?.label).toBe("Print Layers");
    expect(next.pricing).toEqual(translucentIntent.pricing);
  });

  test("compiles broad semantic corrections through the same continuation contract", () => {
    const current = productDraftIntentSchema.parse({
      ...translucentIntent,
      optionGroups: [...translucentIntent.optionGroups, { key: "weed_tape", label: "Weeding and Taping", required: false, selectionMode: "single", values: [{ key: "none", label: "None", isDefault: true }, { key: "yes", label: "Yes", isDefault: false }] }],
    });
    const patch = compileSemanticProductOperations(current, {
      kind: "semantic_operations",
      operations: [
        { op: "set_matrix_rate", optionGroup: "Layers", value: "3 layers", priceCents: 450 },
        { op: "set_option_default", optionGroup: "Layers", value: "5 layers" },
        { op: "remove_option_group", optionGroup: "Weeding and Taping" },
        { op: "set_product_name", name: "Backlit Multilayer Vinyl" },
        { op: "set_proof_requirement", requiresProofApproval: true },
      ],
    }, 4, "Make 3 Layer $4.50 instead. Make 5 Layer the default. Remove Weeding and Taping. Change product name to Backlit Multilayer Vinyl. Actually require proof approval.");
    const next = applyProductDraftIntentPatch(current, patch);
    if (next.pricing.model !== "two_dimensional_matrix") throw new Error("Expected matrix pricing");
    expect(next.pricing.cells.filter((cell) => cell.column === "three-layer").map((cell) => cell.priceCents)).toEqual([450, 450]);
    expect(next.optionGroups.find((group) => group.key === "layers")?.values.find((value) => value.isDefault)?.key).toBe("five-layer");
    expect(next.optionGroups.some((group) => group.key === "weed_tape")).toBe(false);
    expect(next.identity.name).toBe("Backlit Multilayer Vinyl");
    expect(next.workflow.requiresProofApproval).toBe(true);
  });

  test("the compiler accepts semantic continuation output and emits only a server-built canonical patch", async () => {
    const compiler = new ProductIntentCompiler({ generateJson: async () => ({
      rawText: JSON.stringify({ kind: "semantic_operations", operations: [{ op: "set_option_default", optionGroup: "Surface", value: "1st surface (right reading)" }, { op: "set_option_default", optionGroup: "Layers", value: "3 layers" }] }),
      provider: "test", model: "test", requestMetadata: {},
    }) });
    const result = await compiler.compile({ orgId: "org_1", request: "1st surface and 3 layers for defaults", currentIntent: translucentIntent, currentRevision: 4, operationContext: {}, schemaDescription: "test", allowedEnums: {}, supportedArchetypes: [] });
    expect(result.ok).toBe(true);
    if (!result.ok || result.result.kind !== "intent_patch") throw new Error("Expected a server-built patch");
    expect(result.result.patch.baseRevision).toBe(4);
    expect(result.result.patch.operations.some((operation) => operation.op === "replace_option_groups")).toBe(true);
  });

  test("repairs a rejected root discriminator with the continuation provider protocol", async () => {
    const requests: any[] = [];
    const compiler = new ProductIntentCompiler({ generateJson: async (input) => {
      requests.push(input);
      return requests.length === 1
        ? { rawText: JSON.stringify({ kind: "one_dimensional_matrix", operations: [{ op: "set_category", category: "roll" }] }), provider: "test", model: "test", requestMetadata: {} }
        : { rawText: JSON.stringify({ kind: "semantic_operations", operations: [{ op: "set_category", category: "roll" }] }), provider: "test", model: "test", requestMetadata: {} };
    } });
    const current = productDraftIntentSchema.parse({ ...translucentIntent, identity: { ...translucentIntent.identity, category: { state: "resolved", id: "flatbed", label: "Flatbed Printing" } } });
    const result = await compiler.compile({ orgId: "org_1", request: "I accidentally selected flatbed and it is supposed to be roll.", currentIntent: current, currentRevision: 4, operationContext: {}, schemaDescription: "test", allowedEnums: {}, supportedArchetypes: [], candidateLabels: { categories: ["Flatbed Printing", "Roll Printing"] } });
    expect(result.ok).toBe(true);
    expect(requests).toHaveLength(2);
    const repair = JSON.parse(requests[1]!.user);
    expect(repair.invalidRootKind).toBe("one_dimensional_matrix");
    expect(repair.allowedProviderRootKinds).toEqual(["semantic_operations"]);
    expect(repair.postNormalizationCompilerResultKinds).toEqual(["complete_intent", "intent_patch", "unresolved_questions", "compiler_error"]);
    if (!result.ok || result.result.kind !== "intent_patch") throw new Error("Expected repaired patch");
    expect(result.diagnostics.providerResponseKinds).toEqual(["one_dimensional_matrix", "semantic_operations"]);
    expect(result.result.patch.operations).toEqual(expect.arrayContaining([expect.objectContaining({ op: "set_identity", value: expect.objectContaining({ category: { state: "unresolved", label: "Roll Printing" } }) })]));
  });

  test("repairs a live-shaped canonical-state echo without exposing server-owned state to the repair", async () => {
    const requests: any[] = [];
    const current = productDraftIntentSchema.parse({ ...translucentIntent, identity: { ...translucentIntent.identity, category: { state: "resolved", id: "flatbed", label: "Flatbed Printing" } } });
    const compiler = new ProductIntentCompiler({ generateJson: async (input) => {
      requests.push(input);
      return requests.length === 1
        ? { rawText: JSON.stringify({ kind: "complete_intent", intent: { contractVersion: 1, intentId: "provider-intent", organizationId: "provider-org", revision: 99, state: "compiling", revisionMetadata: { parentRevision: null }, operationContext: {}, identity: { name: "should-not-be-read" } } }), provider: "openai_compatible", model: "deepseek-v4-flash", requestMetadata: {} }
        : { rawText: JSON.stringify({ kind: "semantic_operations", operations: [{ op: "set_category", category: "roll" }] }), provider: "openai_compatible", model: "deepseek-v4-flash", requestMetadata: {} };
    } });
    const result = await compiler.compile({ orgId: "org_1", request: "I accidentally selected flatbed when it should have been roll", currentIntent: current, currentRevision: 4, operationContext: {}, schemaDescription: "ProductIntentCompilerResult", allowedEnums: {}, supportedArchetypes: [], candidateLabels: { categories: ["Flatbed Printing", "Roll Printing"] } });
    expect(result.ok).toBe(true);
    expect(requests).toHaveLength(2);
    expect(requests[0]!.user).toContain("currentBusinessContext");
    expect(requests[0]!.user).not.toContain("currentIntent");
    expect(requests[0]!.user).not.toContain("provider-intent");
    expect(requests[0]!.user).not.toContain("currentRevision");
    expect(requests[0]!.user).not.toContain("canonicalSchema");
    const repair = JSON.parse(requests[1]!.user);
    expect(repair.validationIssuePaths).toEqual(["intent.serverOwnedFields"]);
    expect(repair.invalidOutput).toBe(JSON.stringify({ kind: "complete_intent" }));
    expect(JSON.stringify(repair)).not.toContain("provider-intent");
    expect(JSON.stringify(repair)).not.toContain("provider-org");
    if (!result.ok || result.result.kind !== "intent_patch") throw new Error("Expected a semantic correction patch.");
    expect(result.result.patch.operations).toEqual(expect.arrayContaining([expect.objectContaining({ op: "set_identity", value: expect.objectContaining({ category: { state: "unresolved", label: "Roll Printing" } }) })]));
  });

  test("rejects extra canonical state on a semantic envelope before it can affect the revision", async () => {
    const requests: any[] = [];
    const current = productDraftIntentSchema.parse({ ...translucentIntent, identity: { ...translucentIntent.identity, category: { state: "resolved", id: "flatbed", label: "Flatbed Printing" } } });
    const compiler = new ProductIntentCompiler({ generateJson: async (input) => {
      requests.push(input);
      return requests.length === 1
        ? { rawText: JSON.stringify({ kind: "semantic_operations", operations: [{ op: "set_category", category: "roll" }], intent: { revision: 999, organizationId: "provider-org" } }), provider: "test", model: "test", requestMetadata: {} }
        : { rawText: JSON.stringify({ kind: "semantic_operations", operations: [{ op: "set_category", category: "roll" }] }), provider: "test", model: "test", requestMetadata: {} };
    } });
    const result = await compiler.compile({ orgId: "org_1", request: "Change Flatbed to roll.", currentIntent: current, currentRevision: 4, operationContext: {}, schemaDescription: "test", allowedEnums: {}, supportedArchetypes: [], candidateLabels: { categories: ["Flatbed Printing", "Roll Printing"] } });
    expect(result.ok).toBe(true);
    const repair = JSON.parse(requests[1]!.user);
    expect(repair.validationIssuePaths).toEqual(["intent.serverOwnedFields"]);
    expect(repair.invalidOutput).toBe(JSON.stringify({ kind: "semantic_operations", operations: [{ op: "set_category", category: "roll" }] }));
    expect(JSON.stringify(repair)).not.toContain("provider-org");
  });
});
