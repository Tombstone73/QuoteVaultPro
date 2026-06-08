import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, jest, test } from "@jest/globals";
import { OptionRulesPricingMatrixEditor } from "./OptionRulesPricingMatrixEditor";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

function treeWithMatrix() {
  return {
    schemaVersion: 2,
    rootNodeIds: ["node_printed_sides"],
    nodes: {
      node_printed_sides: {
        id: "node_printed_sides",
        kind: "question",
        type: "INPUT",
        key: "printed_sides",
        label: "Printed Sides",
        input: { type: "select", required: true, selectionKey: "printed_sides", valueType: "ENUM" },
        choices: [
          { value: "single_sided", label: "Single Sided" },
          { value: "double_sided", label: "Double Sided" },
        ],
      },
    },
    edges: [],
    pricingMatrix: {
      dimensions: ["printed_sides"],
      rows: [
        {
          id: "row_single",
          when: { printed_sides: "single_sided" },
          qtyTiers: [
            { id: "tier_1_100", label: "1-100", minQty: 1, perPieceCents: 440 },
            { id: "tier_101_500", label: "101-500", minQty: 101, perPieceCents: 330 },
            { id: "tier_501", label: "501+", minQty: 501, perPieceCents: 300 },
          ],
          tierBasis: "line_item_quantity",
        },
        {
          id: "row_double",
          when: { printed_sides: "double_sided" },
          qtyTiers: [
            { id: "tier_1_100_double", label: "1-100", minQty: 1, perPieceCents: 550 },
            { id: "tier_101_500_double", label: "101-500", minQty: 101, perPieceCents: 440 },
            { id: "tier_501_double", label: "501+", minQty: 501, perPieceCents: 400 },
          ],
          tierBasis: "line_item_quantity",
        },
      ],
    },
  };
}

describe("OptionRulesPricingMatrixEditor", () => {
  test("loads top-level pricing matrix rows and emits matrix edits", async () => {
    const onUpdateRules = jest.fn();
    const onUpdatePricingMatrix = jest.fn();
    const onRepairPricingMatrix = jest.fn();
    const container = document.createElement("div");
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <OptionRulesPricingMatrixEditor
          treeJson={treeWithMatrix()}
          onUpdateRules={onUpdateRules}
          onUpdatePricingMatrix={onUpdatePricingMatrix}
          onRepairPricingMatrix={onRepairPricingMatrix}
        />,
      );
    });

    expect(container.textContent).toContain("Pricing Matrix");
    expect(container.textContent).toContain("Printed Sides");
    expect(container.textContent).toContain("Row Qty Tiers (3)");

    const addRow = Array.from(container.querySelectorAll("button")).find((button) => button.textContent?.includes("Add Row"));
    await act(async () => {
      addRow?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(onUpdatePricingMatrix).toHaveBeenCalledWith(expect.objectContaining({
      dimensions: ["printed_sides"],
      rows: expect.arrayContaining([
        expect.objectContaining({ when: { printed_sides: "single_sided" } }),
      ]),
    }));
    expect(onUpdateRules).not.toHaveBeenCalled();
    expect(onRepairPricingMatrix).not.toHaveBeenCalled();

    act(() => root.unmount());
  });
});
