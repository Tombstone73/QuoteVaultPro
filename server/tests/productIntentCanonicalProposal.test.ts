import { applyProductDraftIntentPatch, productDraftIntentSchema } from "@shared/productDraftIntent";
import fs from "node:fs";
import path from "node:path";
import {
  applyCanonicalProductIntentProposal,
  buildCanonicalProductIntentProposal,
  canonicalProductIntentProposalSchema,
  renderProductIntentCompilerMigrationMarkdown,
} from "../services/productIntentCompiler/productIntentCanonicalProposal";
import { compileSemanticProductOperations } from "../services/productIntentCompiler/semanticProductOperations";
import { projectProductDraftIntentToProductBuilderDraft } from "../services/productIntentCompiler/productIntentProjection";

const draft = productDraftIntentSchema.parse({
  contractVersion: 1, intentId: "intent_1", organizationId: "org_1", revision: 3, state: "needs_answers", operation: "new_product",
  identity: { name: "Unfinished product draft", description: "", category: { state: "unresolved", label: "Product category" } },
  lifecycle: { productStatus: "inactive", published: false }, measurement: { mode: "quantity_only" }, quantity: { behavior: "customer_entered", minimum: 1 },
  pricing: { model: "unresolved" }, material: { state: "explicitly_unset" }, optionGroups: [],
  workflow: { kind: "standard_production", requiresProofApproval: false, requiresProductionJob: true }, production: { route: { state: "explicitly_unset" }, configuration: {} },
  visibility: { catalogVisible: false }, unresolvedFields: [{ path: "identity.name", code: "PRODUCT_NAME_UNRESOLVED" }], fieldMetadata: {}, revisionMetadata: { parentRevision: 2 }, operationContext: {},
});

describe("thin canonical Product intent proposal", () => {
  test("composes Phase 5 Product configuration and Phase 6 PBV2 proposal shapes before a Product id exists", () => {
    const proposal = buildCanonicalProductIntentProposal(draft, [
      { op: "set_product_name", name: "Conditional Banner" },
      { op: "set_category", category: "Roll Printing" },
      { op: "set_measurement_mode", mode: "dimensions_required" },
      { op: "set_proof_requirement", requiresProofApproval: true },
      { op: "add_option_group", optionGroup: "Grommets", required: true, selectionMode: "single" },
      { op: "set_option_default", optionGroup: "Grommets", value: "Custom" },
      { op: "add_option_value", optionGroup: "Grommets", value: "None" },
      { op: "add_option_value", optionGroup: "Grommets", value: "Custom" },
    ], "Create Conditional Banner in Roll Printing with dimensions, proof, and required Grommets defaulting to Custom.", { categoryLabels: ["Roll Printing"] });
    expect(canonicalProductIntentProposalSchema.parse(proposal)).toMatchObject({
      productConfiguration: { name: "Conditional Banner", category: "Roll Printing", measurementMode: "dimensions_required", requiresProofApproval: true },
      compatibilityOperations: [], unsupportedDetails: [],
    });
    expect(proposal.pbv2OptionConfiguration).toEqual([
      expect.objectContaining({ kind: "add_group" }),
      expect.objectContaining({ kind: "add_input", input: expect.objectContaining({ selectionKey: "grommets", required: true }) }),
      expect.objectContaining({ kind: "add_choice", choice: expect.objectContaining({ value: "none" }) }),
      expect.objectContaining({ kind: "add_choice", choice: expect.objectContaining({ value: "custom" }) }),
      { kind: "set_default", input: "grommets", choice: "custom" },
    ]);
    const patch = applyCanonicalProductIntentProposal(draft, proposal, 3)!;
    const next = applyProductDraftIntentPatch(draft, patch);
    expect(next.identity).toMatchObject({ name: "Conditional Banner", category: { state: "unresolved", label: "Roll Printing" } });
    expect(next.optionGroups[0]).toMatchObject({ key: "grommets", required: true, values: [{ key: "none", isDefault: false }, { key: "custom", isDefault: true }] });
  });

  test.each([
    "When Grommets is Custom, show the placement field.",
    "Only show placement after Custom is selected for Grommets.",
  ])("equivalent wording does not change the canonical proposal when interpretation is equivalent: %s", (request) => {
    const current = productDraftIntentSchema.parse({ ...draft, optionGroups: [
      { key: "grommets", label: "Grommets", required: false, selectionMode: "single", values: [{ key: "custom", label: "Custom", isDefault: false }] },
      { key: "placement", label: "Placement", required: false, selectionMode: "single", values: [{ key: "corners", label: "Corners", isDefault: false }] },
    ] });
    const proposal = buildCanonicalProductIntentProposal(current, [{ op: "set_option_group_availability", optionGroup: "Placement", whenOptionGroup: "Grommets", whenValue: "Custom" }], request);
    expect(proposal.pbv2OptionConfiguration).toEqual([{ kind: "update_input", input: "placement", changes: { visibilityRules: [{ type: "equals", selectionKey: "grommets", value: "custom" }] } }]);
  });

  test("preserves a conditional textarea through multi-turn draft state and final PBV2 projection", () => {
    const current = productDraftIntentSchema.parse({ ...draft, optionGroups: [
      { key: "grommets", label: "Grommets", required: false, selectionMode: "single", values: [{ key: "custom", label: "Custom", isDefault: false }] },
    ] });
    const patch = compileSemanticProductOperations(current, { kind: "semantic_operations", operations: [
      { op: "add_text_input", optionGroup: "Grommets", label: "Where should we put them?", multiline: true, required: true, whenOptionGroup: "Grommets", whenValue: "Custom" },
    ] }, 3, "When Grommets is Custom, show a text box asking where to put them.");
    const next = applyProductDraftIntentPatch(current, patch);
    expect(next.optionGroups.find((group) => group.key === "where_should_we_put_them")!).toMatchObject({
      inputType: "textarea", parentGroupKey: "grommets", required: true, values: [], availableWhen: { optionGroupKey: "grommets", optionValueKey: "custom" },
    });
    const ready = productDraftIntentSchema.parse({
      ...next, state: "ready_for_review", identity: { ...next.identity, name: "Banner", category: { state: "resolved", id: "roll", label: "Roll Printing" } },
      pricing: { model: "scalar", unit: "per_piece", priceCents: 100 }, unresolvedFields: [],
    });
    const projected = projectProductDraftIntentToProductBuilderDraft(ready);
    const node = Object.values(projected.treeJson.nodes as Record<string, any>).find((candidate: any) => candidate.input?.selectionKey === "where_should_we_put_them") as any;
    expect(node).toMatchObject({ input: { type: "textarea", required: true }, visibility: { rules: [{ type: "equals", selectionKey: "grommets", value: "custom" }] } });
    const edge = (projected.treeJson.edges as any[]).find((candidate) => candidate.toNodeId === node.id);
    const parent = (projected.treeJson.nodes as Record<string, any>)[edge.fromNodeId];
    expect(parent).toMatchObject({ type: "GROUP", key: "grommets_group", label: "Grommets" });
  });

  test("keeps pricing and deletion compatibility-only while preserving unsupported detail beside supported work", () => {
    const proposal = buildCanonicalProductIntentProposal(draft, [
      { op: "set_product_description", description: "Supported description" },
      { op: "set_scalar_price", priceCents: 900, basis: "per_piece" },
      { op: "remove_option_group", optionGroup: "Legacy" },
      { op: "record_unsupported_detail", detail: "customer_specific_availability" },
    ]);
    expect(proposal.productConfiguration).toEqual({ description: "Supported description" });
    expect(proposal.compatibilityOperations).toEqual([{ index: 1, op: "set_scalar_price" }, { index: 2, op: "remove_option_group" }]);
    expect(proposal.unsupportedDetails).toEqual([{ code: "customer_specific_availability", blocking: false }]);
  });

  test("does not manufacture grommet choices from request vocabulary", () => {
    const patch = compileSemanticProductOperations(draft, { kind: "semantic_operations", operations: [
      { op: "add_option_group", optionGroup: "Grommets", required: false, selectionMode: "single" },
      { op: "record_unsupported_detail", detail: "grommet_quantity" },
    ] }, 3, "Grommets are top and bottom, one each.");
    const next = applyProductDraftIntentPatch(draft, patch);
    expect(next.optionGroups[0]?.values).toEqual([]);
    expect(next.unresolvedFields).toEqual(expect.arrayContaining([expect.objectContaining({ code: "GROMMET_QUANTITY_UNRESOLVED" })]));
  });

  test("canonical proposal schemas and revision checks fail closed", () => {
    expect(() => buildCanonicalProductIntentProposal(draft, [{ op: "set_measurement_mode", mode: "invented" }])).toThrow();
    const proposal = buildCanonicalProductIntentProposal(draft, [{ op: "set_product_description", description: "Safe" }]);
    expect(() => applyCanonicalProductIntentProposal(draft, proposal, 2)).toThrow("STALE");
  });

  test("keeps the generated responsibility report synchronized", () => {
    const report = renderProductIntentCompilerMigrationMarkdown();
    expect(report).toContain("products.update_configuration.v1");
    expect(report).toContain("Compatibility only");
    expect(fs.readFileSync(path.resolve(process.cwd(), "docs/architecture/product-intent-compiler-migration.md"), "utf8")).toBe(report);
  });
});
