import { readFile } from "node:fs/promises";
import path from "node:path";
import { CanonicalPbv2OptionConfigurationOperations, applyPbv2OptionConfigurationMutations, renderCanonicalPbv2OptionMigrationMarkdown } from "../services/products/canonicalPbv2OptionConfigurationOperations";

const timestamp = "2026-08-12T12:00:00.000Z";
function tree() {
  return {
    schemaVersion: 2, status: "DRAFT", rootNodeIds: ["input_grommets"],
    nodes: {
      group_finishing: { id: "group_finishing", kind: "group", type: "GROUP", status: "ENABLED", key: "finishing", label: "Finishing", input: { type: "select", required: false }, displayOrder: 0 },
      input_grommets: { id: "input_grommets", kind: "question", type: "INPUT", status: "ENABLED", key: "grommets", label: "Grommets", input: { type: "select", valueType: "ENUM", selectionKey: "grommets", required: true, defaultValue: "none" }, choices: [{ value: "none", label: "None", sortOrder: 0 }, { value: "custom", label: "Custom", sortOrder: 1 }], pricingImpact: [], weightImpact: [] },
    },
    edges: [{ id: "edge_finishing_grommets", fromNodeId: "group_finishing", toNodeId: "input_grommets", status: "DISABLED", priority: 0, condition: { op: "EXISTS", value: { op: "literal", value: true } } }],
    meta: { pricingV2: { base: { perSqftCents: 100 } } },
  };
}

function fixture(options: { activeOnly?: boolean; missingActive?: boolean; conflict?: boolean } = {}) {
  const product: any = { id: "product_1", organizationId: "org_1", name: "Banner", isActive: true, pbv2ActiveTreeVersionId: options.activeOnly ? "tree_active" : null };
  let draft: any = options.activeOnly ? null : { id: "tree_draft", organizationId: "org_1", productId: "product_1", status: "DRAFT", schemaVersion: 2, treeJson: tree(), createdByUserId: "user_1", updatedByUserId: "user_1", publishedAt: null, createdAt: new Date(timestamp), updatedAt: new Date(timestamp) };
  const active: any = options.activeOnly && !options.missingActive ? { ...(draft ?? {}), id: "tree_active", organizationId: "org_1", productId: "product_1", status: "ACTIVE", schemaVersion: 2, treeJson: { ...tree(), status: "ACTIVE" }, createdAt: new Date(timestamp), updatedAt: new Date(timestamp) } : null;
  const repository = {
    getProduct: async ({ organizationId, productId }: any) => organizationId === product.organizationId && productId === product.id ? { ...product } : null,
    getLatestDraft: async ({ organizationId, productId }: any) => organizationId === "org_1" && productId === "product_1" && draft ? { ...draft } : null,
    getTree: async ({ organizationId, productId, treeId }: any) => organizationId === "org_1" && productId === "product_1" && active?.id === treeId ? { ...active } : null,
    saveEditorDraft: async ({ treeJson, actorUserId }: any) => { draft = { ...(draft ?? active), id: draft?.id ?? "tree_created", status: "DRAFT", treeJson, updatedByUserId: actorUserId, updatedAt: new Date("2026-08-12T12:00:01.000Z") }; return { ...draft }; },
    saveOptionMutation: async ({ source, treeJson, actorUserId }: any) => { if (options.conflict) return null; draft = { ...source, id: source.status === "DRAFT" ? source.id : "tree_created", status: "DRAFT", treeJson, updatedByUserId: actorUserId, updatedAt: new Date("2026-08-12T12:00:01.000Z") }; return { ...draft }; },
  };
  return { service: new CanonicalPbv2OptionConfigurationOperations(repository as any), current: () => draft ? structuredClone(draft) : null, active: () => active ? structuredClone(active) : null };
}

describe("CanonicalPbv2OptionConfigurationOperations", () => {
  it("creates a reusable DRAFT from an active Product without changing the published version", async () => {
    const state = fixture({ activeOnly: true });
    const activeBefore = state.active();
    const nextTree = structuredClone(activeBefore.treeJson);
    nextTree.meta.pricingV2.base.perSqftCents = 250;

    const result = await state.service.saveEditorDraft({
      organizationId: "org_1",
      actorUserId: "admin_1",
      productId: "product_1",
      treeJson: nextTree,
    });

    expect(result.draft).toMatchObject({ id: "tree_created", status: "DRAFT" });
    expect(result.draft.treeJson.meta.pricingV2.base.perSqftCents).toBe(250);
    expect(state.active()).toEqual(activeBefore);

    const reopened = await state.service.saveEditorDraft({
      organizationId: "org_1",
      actorUserId: "admin_1",
      productId: "product_1",
      treeJson: nextTree,
    });
    expect(reopened.draft.id).toBe("tree_created");
  });

  it("normalizes a conflicting editor payload to the choice material without changing consumption parameters", async () => {
    const state = fixture();
    const nextTree: any = tree();
    nextTree.nodes.input_grommets.choices[0] = {
      ...nextTree.nodes.input_grommets.choices[0],
      materialOverride: { materialId: "oppbogga_3mm" },
      inventoryConsumption: [{ materialId: "foam_board_half", quantityBasis: "area_sqft", multiplier: 1.5, wastePercent: 7 }],
    };

    const result = await state.service.saveEditorDraft({ organizationId: "org_1", actorUserId: "admin_1", productId: "product_1", treeJson: nextTree });
    const saved = result.draft.treeJson.nodes.input_grommets.choices[0];
    expect(saved.inventoryConsumption).toEqual([{ materialId: "oppbogga_3mm", quantityBasis: "area_sqft", multiplier: 1.5, wastePercent: 7 }]);
    expect(result.sanitizerChanges).toEqual(expect.arrayContaining([expect.objectContaining({ fromMaterialId: "foam_board_half", toMaterialId: "oppbogga_3mm" })]));
  });

  it("applies group metadata, input required/default, choice metadata, and ordering without changing pricing", () => {
    const original = tree();
    const result = applyPbv2OptionConfigurationMutations(original, [
      { kind: "update_group", group: "Finishing", changes: { label: "Finishing Options", required: true } },
      { kind: "update_input", input: "Grommets", changes: { required: false, defaultValue: "custom" } },
      { kind: "update_choice", input: "Grommets", choice: "Custom", changes: { label: "Custom placement" } },
      { kind: "reorder_choices", input: "Grommets", orderedValues: ["custom", "none"] },
      { kind: "add_group", group: { key: "artwork", label: "Artwork" } },
      { kind: "reorder_groups", orderedGroups: ["Artwork", "Finishing Options"] },
    ]);
    expect(result.tree.nodes.group_finishing).toMatchObject({ label: "Finishing Options", input: { required: true } });
    expect(result.tree.nodes.input_grommets.input).toMatchObject({ required: false, defaultValue: "custom" });
    expect(result.tree.nodes.input_grommets.choices[0]).toMatchObject({ value: "custom", label: "Custom placement", sortOrder: 0 });
    expect(result.tree.nodes.input_grommets.choices).toHaveLength(2);
    expect(result.tree.nodes.group_artwork.displayOrder).toBe(0);
    expect(result.tree.nodes.group_finishing.displayOrder).toBe(1);
    expect(result.tree.meta.pricingV2).toEqual(original.meta.pricingV2);
  });

  it("creates a conditional free-form text input using the Product Editor's INPUT and visibility representation", async () => {
    const state = fixture();
    const mutations = [{ kind: "add_input", group: "Finishing", input: { selectionKey: "grommet_placement_note", label: "Describe grommet placement", type: "textarea", required: true, visibilityRules: [{ type: "equals", selectionKey: "grommets", value: "custom" }] } }] as const;
    const proposal = await state.service.propose({ organizationId: "org_1", productId: "product_1", mutations });
    const result = await state.service.execute({ organizationId: "org_1", actorUserId: "admin_1", productId: "product_1", mutations, expectedTreeId: proposal.sourceTreeId, expectedTreeUpdatedAt: proposal.expectedTreeUpdatedAt, auditContext: { source: "assistant_go", reference: "plan_1" } });
    const added: any = Object.values(state.current().treeJson.nodes).find((node: any) => node.input?.selectionKey === "grommet_placement_note");
    expect(added).toMatchObject({ type: "INPUT", input: { type: "textarea", required: true }, visibility: { rules: [{ type: "equals", selectionKey: "grommets", value: "custom" }] } });
    expect(result).toMatchObject({ operationReference: "products.update_option_configuration.v1", auditReference: "plan_1" });
  });

  it("rejects invalid defaults and broken conditional references", async () => {
    const state = fixture();
    await expect(state.service.propose({ organizationId: "org_1", productId: "product_1", mutations: [{ kind: "update_input", input: "Grommets", changes: { defaultValue: "missing" } }] })).rejects.toMatchObject({ code: "PBV2_CONFIGURATION_INVALID" });
    await expect(state.service.propose({ organizationId: "org_1", productId: "product_1", mutations: [{ kind: "update_group", group: "Finishing", changes: { visibilityRules: [{ type: "equals", selectionKey: "missing", value: "x" }] } }] })).rejects.toMatchObject({ code: "PBV2_CONFIGURATION_INVALID" });
    expect(state.current().treeJson.nodes.input_grommets.input.defaultValue).toBe("none");
  });

  it("fails closed for tenant mismatch, missing actor, stale state, and invalid lifecycle", async () => {
    const state = fixture(); const mutations = [{ kind: "update_input", input: "Grommets", changes: { required: false } }];
    await expect(state.service.propose({ organizationId: "org_2", productId: "product_1", mutations })).rejects.toMatchObject({ code: "PRODUCT_NOT_FOUND" });
    const proposal = await state.service.propose({ organizationId: "org_1", productId: "product_1", mutations });
    await expect(state.service.execute({ organizationId: "org_1", actorUserId: "", productId: "product_1", mutations, expectedTreeId: proposal.sourceTreeId, expectedTreeUpdatedAt: proposal.expectedTreeUpdatedAt })).rejects.toMatchObject({ code: "ACTOR_REQUIRED" });
    await expect(state.service.execute({ organizationId: "org_1", actorUserId: "admin_1", productId: "product_1", mutations, expectedTreeId: proposal.sourceTreeId, expectedTreeUpdatedAt: "2026-01-01T00:00:00.000Z" })).rejects.toMatchObject({ code: "PBV2_DRAFT_STALE" });
    const lifecycle = fixture({ activeOnly: true, missingActive: true });
    await expect(lifecycle.service.propose({ organizationId: "org_1", productId: "product_1", mutations })).rejects.toMatchObject({ code: "PBV2_LIFECYCLE_RESTRICTED" });
  });

  it("leaves the tree unchanged when the conditional transaction write loses a race", async () => {
    const state = fixture({ conflict: true }); const mutations = [{ kind: "update_input", input: "Grommets", changes: { required: false } }];
    const proposal = await state.service.propose({ organizationId: "org_1", productId: "product_1", mutations });
    await expect(state.service.execute({ organizationId: "org_1", actorUserId: "admin_1", productId: "product_1", mutations, expectedTreeId: proposal.sourceTreeId, expectedTreeUpdatedAt: proposal.expectedTreeUpdatedAt })).rejects.toMatchObject({ code: "PBV2_DRAFT_STALE" });
    expect(state.current().treeJson.nodes.input_grommets.input.required).toBe(true);
  });

  it("keeps Product Editor persistence delegated and the Phase 6 report generated", async () => {
    await expect(readFile(path.resolve(process.cwd(), "server/routes/products.routes.ts"), "utf8")).resolves.toContain("canonicalPbv2OptionConfigurationOperations.saveEditorDraft");
    await expect(readFile(path.resolve(process.cwd(), "docs/architecture/canonical-pbv2-option-migration.md"), "utf8")).resolves.toBe(renderCanonicalPbv2OptionMigrationMarkdown());
  });
});
