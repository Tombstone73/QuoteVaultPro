import { describe, expect, test } from "@jest/globals";
import type { OptionTreeV2 } from "../optionTreeV2";
import {
  buildPbv2DefaultSelections,
  buildPbv2DefaultsHydrationKey,
  filterPbv2ChoicesForRuntime,
  getRenderablePbv2QuestionNodeIds,
  hasRenderablePbv2Tree,
  shouldHydratePbv2Defaults,
  sortPbv2Choices,
} from "../pbv2OrderEntryRuntime";
import { buildInitialOrderLineItemDraftFromProduct } from "../orderLineItemInitialization";
import { createPbv2BannerProductTreeJson } from "../pbv2/starterTree";
import { resolveRuntimeVisibility } from "../optionTreeV2Runtime";

function makeTree(): OptionTreeV2 {
  return {
    schemaVersion: 2,
    rootNodeIds: ["root"],
    nodes: {
      root: {
        id: "root",
        kind: "group",
        label: "Product Options",
      },
      finish: {
        id: "finish",
        kind: "question",
        key: "finish",
        label: "Finish",
        input: { type: "select", selectionKey: "finish", defaultValue: "matte" },
        choices: [
          { value: "matte", label: "Matte" },
          { value: "gloss", label: "Gloss" },
        ],
      },
      extras: {
        id: "extras",
        kind: "question",
        key: "extras",
        label: "Extras",
        input: { type: "multiselect", selectionKey: "extras", defaultValue: ["grommets"] },
        choices: [
          { value: "grommets", label: "Grommets" },
          { value: "hems", label: "Hems" },
        ],
      },
      note: {
        id: "note",
        kind: "question",
        key: "note",
        label: "Note",
        input: { type: "text", selectionKey: "note", defaultValue: "rush" },
      },
    },
    edges: [
      { fromNodeId: "root", toNodeId: "finish" },
      { fromNodeId: "root", toNodeId: "extras" },
      { fromNodeId: "root", toNodeId: "note" },
    ],
  };
}

describe("PBV2 order-entry runtime", () => {
  test("canonical zero-option trees render no controls and create no fake selections", () => {
    const tree: OptionTreeV2 = { schemaVersion: 2, rootNodeIds: [], nodes: {}, edges: [] };
    expect(getRenderablePbv2QuestionNodeIds(tree)).toEqual([]);
    expect(hasRenderablePbv2Tree(tree)).toBe(false);
    expect(buildPbv2DefaultSelections(tree)).toBeNull();
  });

  test("PBV2 options remain renderable with blank or zero base rate", () => {
    const tree = {
      ...makeTree(),
      meta: { pricingV2: { base: {} } },
      baseRate: 0,
      base_price: "",
      basePricing: null,
    } as OptionTreeV2;

    expect(getRenderablePbv2QuestionNodeIds(tree)).toEqual(["finish", "extras", "note"]);
  });

  test("PBV2 options remain renderable when pricing matrix rows are missing", () => {
    const tree = {
      ...makeTree(),
      pricingMatrix: { dimensions: ["finish"], rows: [] },
    } as OptionTreeV2;

    expect(hasRenderablePbv2Tree(tree)).toBe(true);
    expect(getRenderablePbv2QuestionNodeIds(tree)).toContain("finish");
  });

  test("PBV2 options remain renderable when pricing calculation result contains an error", () => {
    const tree = {
      ...makeTree(),
      calculateResult: { error: "Missing base rate" },
      previewResult: { error: "Cannot calculate" },
      lineTotal: null,
      isCalculated: false,
    } as OptionTreeV2;

    expect(hasRenderablePbv2Tree(tree)).toBe(true);
    expect(getRenderablePbv2QuestionNodeIds(tree)).toContain("finish");
  });

  test("does not hydrate before a renderable tree exists, then hydrates defaults after delayed tree load", () => {
    const key = buildPbv2DefaultsHydrationKey({
      lineItemId: "li_1",
      productId: "prod_1",
      activeTreeVersionId: "tree_v1",
    });
    const hydrated = new Set<string>();
    const emptySelections = { schemaVersion: 2 as const, selected: {} };

    expect(shouldHydratePbv2Defaults({ hydrationKey: key, hydratedKeys: hydrated, selections: emptySelections, tree: null })).toBe(false);
    expect(shouldHydratePbv2Defaults({ hydrationKey: key, hydratedKeys: hydrated, selections: emptySelections, tree: makeTree() })).toBe(true);

    const defaults = buildPbv2DefaultSelections(makeTree());

    expect(defaults?.selected.finish?.value).toBe("matte");
    expect(defaults?.selected.extras?.value).toEqual(["grommets"]);
    expect(defaults?.selected.note?.value).toBe("rush");
  });

  test("disabled product options are omitted from new line item controls and defaults", () => {
    const tree = makeTree();
    tree.nodes.extras.status = "DISABLED";

    expect(getRenderablePbv2QuestionNodeIds(tree)).toEqual(["finish", "note"]);
    expect(hasRenderablePbv2Tree(tree)).toBe(true);

    const defaults = buildPbv2DefaultSelections(tree);
    expect(defaults?.selected.finish?.value).toBe("matte");
    expect(defaults?.selected.note?.value).toBe("rush");
    expect(defaults?.selected.extras).toBeUndefined();
  });

  test("re-enabled product options return to new line item controls and defaults", () => {
    const tree = makeTree();
    tree.nodes.extras.status = "DISABLED";
    expect(getRenderablePbv2QuestionNodeIds(tree)).not.toContain("extras");

    tree.nodes.extras.status = "ENABLED";

    expect(getRenderablePbv2QuestionNodeIds(tree)).toEqual(["finish", "extras", "note"]);
    expect(buildPbv2DefaultSelections(tree)?.selected.extras?.value).toEqual(["grommets"]);
  });

  test("saved selections and user-changed selections are not overwritten by defaults", () => {
    const key = "li_1|prod_1|tree_v1";
    const savedSelections = { schemaVersion: 2 as const, selected: { finish: { value: "gloss" } } };

    expect(shouldHydratePbv2Defaults({
      hydrationKey: key,
      hydratedKeys: new Set<string>(),
      selections: savedSelections,
      tree: makeTree(),
    })).toBe(false);

    expect(shouldHydratePbv2Defaults({
      hydrationKey: key,
      hydratedKeys: new Set<string>([key]),
      selections: { schemaVersion: 2, selected: {} },
      tree: makeTree(),
    })).toBe(false);
  });

  test("renderable questions follow Product Builder group, question, and edge fallback order", () => {
    const tree: OptionTreeV2 = {
      schemaVersion: 2,
      rootNodeIds: ["root"],
      nodes: {
        root: { id: "root", kind: "group", label: "Root" },
        group_b: { id: "group_b", kind: "group", label: "Group B", displayOrder: 20 } as any,
        group_a: { id: "group_a", kind: "group", label: "Group A", ui: { sortOrder: 10 } },
        beta: {
          id: "beta",
          kind: "question",
          label: "Beta",
          input: { type: "select", selectionKey: "beta" },
          choices: [{ value: "b", label: "B" }],
          displayOrder: 30,
        } as any,
        alpha: {
          id: "alpha",
          kind: "question",
          label: "Alpha",
          input: { type: "select", selectionKey: "alpha" },
          choices: [{ value: "a", label: "A" }],
          order: 10,
        } as any,
        gamma: {
          id: "gamma",
          kind: "question",
          label: "Gamma",
          input: { type: "select", selectionKey: "gamma" },
          choices: [{ value: "g", label: "G" }],
        },
        delta: {
          id: "delta",
          kind: "question",
          label: "Delta",
          input: { type: "select", selectionKey: "delta" },
          choices: [{ value: "d", label: "D" }],
        },
      },
      edges: [
        { fromNodeId: "root", toNodeId: "group_b" },
        { fromNodeId: "root", toNodeId: "group_a" },
        { fromNodeId: "group_b", toNodeId: "delta" },
        { fromNodeId: "group_b", toNodeId: "gamma" },
        { fromNodeId: "group_a", toNodeId: "beta" },
        { fromNodeId: "group_a", toNodeId: "alpha" },
      ],
    };

    expect(getRenderablePbv2QuestionNodeIds(tree)).toEqual(["alpha", "beta", "delta", "gamma"]);
  });

  test("choices follow explicit display/order fields and otherwise keep original choice order", () => {
    const sorted = sortPbv2Choices([
      { value: "fallback-first", label: "Fallback First" },
      { value: "last", label: "Last", displayOrder: 30 } as any,
      { value: "first", label: "First", order: 5 } as any,
      { value: "fallback-second", label: "Fallback Second" },
    ]);

    expect(sorted.map((choice) => choice.value)).toEqual([
      "first",
      "last",
      "fallback-first",
      "fallback-second",
    ]);
  });

  test("runtime choice filtering removes unavailable Banner Double Sided when 13oz is selected", () => {
    const tree = createPbv2BannerProductTreeJson() as any;
    const runtime = resolveRuntimeVisibility(tree, {
      selected: {
        banner_weight: { value: "13oz" },
      },
    });

    const choices = filterPbv2ChoicesForRuntime("print_side", tree.nodes.print_side.choices, runtime.visibleChoiceIds);

    expect(runtime.visibleChoiceIds).toContain("print_side:single_sided");
    expect(runtime.visibleChoiceIds).not.toContain("print_side:double_sided");
    expect(choices.map((choice) => choice.value)).toEqual(["single_sided"]);
  });

  test("runtime choice filtering restores Banner Double Sided when 18oz is selected", () => {
    const tree = createPbv2BannerProductTreeJson() as any;
    const runtime = resolveRuntimeVisibility(tree, {
      selected: {
        banner_weight: { value: "18oz" },
      },
    });

    const choices = filterPbv2ChoicesForRuntime("print_side", tree.nodes.print_side.choices, runtime.visibleChoiceIds);

    expect(runtime.visibleChoiceIds).toContain("print_side:single_sided");
    expect(runtime.visibleChoiceIds).toContain("print_side:double_sided");
    expect(choices.map((choice) => choice.value)).toEqual(["single_sided", "double_sided"]);
  });

  test("buildInitialOrderLineItemDraftFromProduct centralizes routing defaults, PBV2 defaults, and render order", () => {
    const tree = makeTree();
    const draft = buildInitialOrderLineItemDraftFromProduct(
      {
        id: "prod_1",
        name: "Banner",
        requiresDesign: true,
        requiresPrepress: false,
        requiresProofApproval: true,
        requiresProductionJob: true,
        pbv2ActiveTreeVersionId: "tree_v1",
        optionTreeJson: tree,
      },
      tree,
      "order_1",
    );

    expect(draft.requiresDesign).toBe(true);
    expect(draft.requiresPrepress).toBe(false);
    expect(draft.requiresProofApproval).toBe(true);
    expect(draft.requiresProductionJob).toBe(true);
    expect(draft.optionSelectionsJson?.selected.finish?.value).toBe("matte");
    expect(draft.optionSelectionsJson?.selected.extras?.value).toEqual(["grommets"]);
    expect(draft.specsJson.initialDraft.renderedOptionLabels).toEqual(["Finish", "Extras", "Note"]);
    expect(draft.debug.defaultSelectionsFound).toBe(true);
  });

  test("new order line item drafts omit disabled product options", () => {
    const tree = makeTree();
    tree.nodes.extras.status = "DISABLED";

    const draft = buildInitialOrderLineItemDraftFromProduct(
      {
        id: "prod_1",
        name: "Banner",
        pbv2ActiveTreeVersionId: "tree_v1",
        optionTreeJson: tree,
      },
      tree,
      "order_1",
    );

    expect(draft.optionSelectionsJson?.selected.finish?.value).toBe("matte");
    expect(draft.optionSelectionsJson?.selected.extras).toBeUndefined();
    expect(draft.specsJson.initialDraft.renderedOptionLabels).toEqual(["Finish", "Note"]);
  });

  test("buildInitialOrderLineItemDraftFromProduct seeds fixed PBV2 dimensions without custom size entry", () => {
    const tree = {
      ...makeTree(),
      meta: {
        requiresDimensions: false,
        fixedDimensions: { widthIn: 24, heightIn: 18, unit: "in" as const, label: '24" x 18"' },
      },
    };
    const draft = buildInitialOrderLineItemDraftFromProduct(
      {
        id: "prod_fixed",
        name: "4mm Coroplast Yard Signs",
        requiresProductionJob: true,
        pbv2ActiveTreeVersionId: "tree_fixed",
        optionTreeJson: tree,
      },
      tree,
      "order_1",
    );

    expect(draft.width).toBe(24);
    expect(draft.height).toBe(18);
    expect(draft.quantity).toBe(1);
    expect(draft.requiresProductionJob).toBe(true);
  });

  test("quantity-only products initialize without width or height even when stale PBV2 metadata requires them", () => {
    const tree = { ...makeTree(), meta: { requiresDimensions: true } };
    const draft = buildInitialOrderLineItemDraftFromProduct(
      {
        id: "prod_stakes",
        name: "Economy Yard Sign Stakes",
        measurementMode: "quantity_only",
        requiresProductionJob: false,
      },
      tree,
      "order_1",
    );

    expect(draft.width).toBe(0);
    expect(draft.height).toBe(0);
    expect(draft.quantity).toBe(1);
  });

  test("fulfillment-only products default routing off without preventing a staff override later", () => {
    const draft = buildInitialOrderLineItemDraftFromProduct(
      {
        id: "prod_stakes",
        name: "Economy Yard Sign Stakes",
        measurementMode: "quantity_only",
        workflowIntent: "fulfillment_only",
        requiresDesign: true,
        requiresPrepress: true,
        requiresProofApproval: true,
        requiresProductionJob: true,
      },
      makeTree(),
      "order_1",
    );

    expect(draft.requiresDesign).toBe(false);
    expect(draft.requiresPrepress).toBe(false);
    expect(draft.requiresProofApproval).toBe(false);
    expect(draft.requiresProductionJob).toBe(false);
  });

  test("dimension-required products still initialize with dimensions required", () => {
    const draft = buildInitialOrderLineItemDraftFromProduct(
      { id: "prod_banner", name: "Banner", measurementMode: "dimensions_required" },
      { ...makeTree(), meta: { requiresDimensions: true } },
      "order_1",
    );

    expect(draft.width).toBe(1);
    expect(draft.height).toBe(1);
  });
});
