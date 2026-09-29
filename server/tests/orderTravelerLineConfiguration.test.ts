import { describe, expect, test } from "@jest/globals";
import { resolveTravelerLineConfiguration } from "../services/orderTravelerLineConfiguration";
import { buildOrderTravelerData } from "../../shared/productionTicket";

const materialNames = new Map([["catalog-default", 'Banner - 13oz Frontlit 54"']]);
const treeJson = {
  schemaVersion: 2,
  nodes: [
    { id: "weight", kind: "question", label: "Banner Weight", input: { type: "select", selectionKey: "weight" }, choices: [
      { value: "mesh", label: "8oz Mesh Banner" },
      { value: "frontlit", label: "13oz Frontlit" },
    ] },
    { id: "side", kind: "question", label: "Print Side", input: { type: "select", selectionKey: "side" }, choices: [{ value: "single", label: "Single Sided" }] },
    { id: "hems", kind: "question", label: "Hems", input: { type: "select", selectionKey: "hems" }, choices: [{ value: "none", label: "None" }] },
  ],
};

function line(weight: string) {
  return {
    productPrimaryMaterialId: "catalog-default",
    pbv2SnapshotJson: { treeJson },
    optionSelectionsJson: { schemaVersion: 2, selected: {
      weight: { value: weight }, side: { value: "single" }, hems: { value: "none" },
    } },
  };
}

describe("order traveler saved configuration", () => {
  test("shows each banner line's own saved choices without the conflicting catalog material", () => {
    const first = resolveTravelerLineConfiguration(line("mesh"), materialNames);
    const second = resolveTravelerLineConfiguration(line("frontlit"), materialNames);
    const traveler = buildOrderTravelerData({
      orderId: "order", orderNumber: "20056", customerName: "Customer",
      lineItems: [first, second].map((configuration) => ({
        description: "Banner", quantity: 24, size: "28 × 22", ...configuration,
      })),
    });
    expect(traveler.lineItems[0].selectedOptions).toEqual([
      { optionLabel: "Banner Weight", selectedLabel: "8oz Mesh Banner" },
      { optionLabel: "Print Side", selectedLabel: "Single Sided" },
      { optionLabel: "Hems", selectedLabel: "None" },
    ]);
    expect(traveler.lineItems[1].selectedOptions[0].selectedLabel).toBe("13oz Frontlit");
    expect(traveler.lineItems.map((item) => item.material)).toEqual(["—", "—"]);
    expect(traveler.lineItems[0]).toMatchObject({ quantity: "24", size: "28 × 22" });
  });

  test("does not pull changed catalog choices or missing option defaults into an existing line", () => {
    const saved = line("mesh");
    const changedCatalog = { ...treeJson, nodes: [{ id: "weight", kind: "question", label: "Banner Weight", input: { type: "select", selectionKey: "weight", defaultValue: "frontlit" } }] };
    expect(changedCatalog.nodes[0].input.defaultValue).toBe("frontlit");
    expect(resolveTravelerLineConfiguration(saved, materialNames).selectedOptions[0].selectedLabel).toBe("8oz Mesh Banner");
    expect(resolveTravelerLineConfiguration({ ...saved, optionSelectionsJson: { selected: {} }, pbv2SnapshotJson: { treeJson: { schemaVersion: 2, nodes: [] } }, selectedOptions: [] }, materialNames).selectedOptions).toEqual([]);
  });

  test("keeps material on non-configurable lines and handles absent configuration", () => {
    expect(resolveTravelerLineConfiguration({ productPrimaryMaterialId: "catalog-default" }, materialNames))
      .toEqual({ material: 'Banner - 13oz Frontlit 54"', selectedOptions: [] });
    expect(resolveTravelerLineConfiguration({}, new Map()))
      .toEqual({ material: null, selectedOptions: [] });
  });
});
