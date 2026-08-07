import { describe, expect, test } from "@jest/globals";
import { applyProductDraftIntentPatch, productDraftIntentSchema } from "@shared/productDraftIntent";
import { compileSemanticProductOperations } from "../services/productIntentCompiler/semanticProductOperations";
import { ProductIntentCompiler } from "../services/productIntentCompiler/productIntentCompiler";

const translucentIntent = productDraftIntentSchema.parse({
  contractVersion: 1, intentId: "intent_1", organizationId: "org_1", revision: 4, state: "needs_answers", operation: "new_product",
  identity: { name: "Translucent Vinyl - Multilayer Print", description: "", category: { state: "unresolved", label: "Product category" } }, lifecycle: { productStatus: "inactive", published: false },
  measurement: { mode: "dimensions_required" }, quantity: { behavior: "customer_entered", minimum: 1 }, pricing: { model: "two_dimensional_matrix", unit: "per_square_foot", rowOptionKey: "surface", columnOptionKey: "layers", cells: [{ row: "first-surface", column: "three-layer", priceCents: 500 }, { row: "first-surface", column: "five-layer", priceCents: 600 }, { row: "second-surface", column: "three-layer", priceCents: 500 }, { row: "second-surface", column: "five-layer", priceCents: 600 }] },
  material: { state: "explicitly_unset" }, optionGroups: [{ key: "surface", label: "Surface", required: true, selectionMode: "single", values: [{ key: "first-surface", label: "1st surface (right reading)", isDefault: false }, { key: "second-surface", label: "2nd surface (reverse printed)", isDefault: false }] }, { key: "layers", label: "Layers", required: true, selectionMode: "single", values: [{ key: "three-layer", label: "3 layers", isDefault: false }, { key: "five-layer", label: "5 layers", isDefault: false }] }],
  workflow: { kind: "standard_production", requiresProofApproval: false, requiresProductionJob: true }, production: { route: { state: "explicitly_unset" }, configuration: {} }, visibility: { catalogVisible: false }, unresolvedFields: [], fieldMetadata: {}, revisionMetadata: { parentRevision: 3 }, operationContext: {},
});

describe("semantic product operations", () => {
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
});
