import { describe, expect, test } from "@jest/globals";

import { pbv2ToChildItemProposals } from "../pricingAdapter";
import { validateTreeForPublish, DEFAULT_VALIDATE_OPTS } from "../validator";
import { createPbv2SignExtrusionTreeJson } from "../starterTree";

describe("pbv2/childItemProposals", () => {
  test("appliesWhen gates child items", () => {
    const tree = createPbv2SignExtrusionTreeJson();

    // disabled => no proposals
    {
      const r = pbv2ToChildItemProposals(tree, { extrusionEnabled: false }, { perimeterIn: 120 });
      expect(r.childItems).toHaveLength(0);
    }

    // enabled => proposal exists
    {
      const r = pbv2ToChildItemProposals(tree, { extrusionEnabled: true }, { perimeterIn: 120 });
      expect(r.childItems.length).toBeGreaterThan(0);
      expect(r.childItems[0].title).toBe("Aluminum extrusion frame");
    }
  });

  test("qty math works for known perimeter", () => {
    const tree = createPbv2SignExtrusionTreeJson();

    // perimeterIn=25 => ceil(25/12)=3
    const r = pbv2ToChildItemProposals(tree, { extrusionEnabled: true }, { perimeterIn: 25 });
    expect(r.childItems).toHaveLength(1);
    expect(r.childItems[0].qty).toBe(3);
  });

  test("publish validation blocks illegal refs in qtyRef", () => {
    const tree: any = {
      status: "DRAFT",
      rootNodeIds: ["opt"],
      nodes: [
        { id: "opt", type: "INPUT", status: "ENABLED", key: "opt", input: { selectionKey: "opt", valueType: "BOOLEAN", defaultValue: true } },
        {
          id: "p",
          type: "PRICE",
          status: "ENABLED",
          key: "p",
          price: {
            components: [],
            childItemEffects: [
              {
                kind: "inlineSku",
                title: "X",
                skuRef: "SKU",
                qtyRef: { op: "ref", ref: { kind: "pricebookRef", key: "ILLEGAL_IN_COMPUTE" } },
              },
            ],
          },
        },
      ],
      edges: [
        {
          id: "e",
          status: "ENABLED",
          fromNodeId: "opt",
          toNodeId: "p",
          priority: 0,
          condition: { op: "EXISTS", value: { op: "literal", value: true } },
        },
      ],
    };

    const res = validateTreeForPublish(tree, DEFAULT_VALIDATE_OPTS);
    expect(res.errors.length).toBeGreaterThan(0);
  });

  test("publish validation blocks negative qty", () => {
    const tree: any = {
      status: "DRAFT",
      rootNodeIds: ["opt"],
      nodes: [
        { id: "opt", type: "INPUT", status: "ENABLED", key: "opt", input: { selectionKey: "opt", valueType: "BOOLEAN", defaultValue: true } },
        {
          id: "p",
          type: "PRICE",
          status: "ENABLED",
          key: "p",
          price: {
            components: [],
            childItemEffects: [
              {
                kind: "inlineSku",
                title: "X",
                skuRef: "SKU",
                qtyRef: { op: "literal", value: -1 },
              },
            ],
          },
        },
      ],
      edges: [
        {
          id: "e",
          status: "ENABLED",
          fromNodeId: "opt",
          toNodeId: "p",
          priority: 0,
          condition: { op: "EXISTS", value: { op: "literal", value: true } },
        },
      ],
    };

    const res = validateTreeForPublish(tree, DEFAULT_VALIDATE_OPTS);
    expect(res.errors.some((e: any) => String(e.code).includes("NEGATIVE"))).toBe(true);
  });
});
