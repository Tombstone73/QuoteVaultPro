import { describe, expect, test } from "@jest/globals";
import type { OptionTreeV2 } from "../optionTreeV2";
import {
  buildPbv2DefaultSelections,
  buildPbv2DefaultsHydrationKey,
  getRenderablePbv2QuestionNodeIds,
  hasRenderablePbv2Tree,
  shouldHydratePbv2Defaults,
  sortPbv2Choices,
} from "../pbv2OrderEntryRuntime";
import { buildInitialOrderLineItemDraftFromProduct } from "../orderLineItemInitialization";

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
});
