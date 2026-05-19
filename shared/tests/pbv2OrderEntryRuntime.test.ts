import { describe, expect, test } from "@jest/globals";
import type { OptionTreeV2 } from "../optionTreeV2";
import {
  buildPbv2DefaultSelections,
  buildPbv2DefaultsHydrationKey,
  getRenderablePbv2QuestionNodeIds,
  hasRenderablePbv2Tree,
  shouldHydratePbv2Defaults,
} from "../pbv2OrderEntryRuntime";

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
});
