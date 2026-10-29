import { describe, expect, it } from "@jest/globals";
import { detectUnsupportedInboundRequests, hydrateInboundPbv2Selections } from "../inboundOrderPbv2Options";
import type { OptionTreeV2 } from "../optionTreeV2";

const tree: OptionTreeV2 = { schemaVersion: 2, rootNodeIds: ["actual_side_node"], nodes: {
  actual_side_node: { id: "actual_side_node", kind: "question", label: "Print Sides", input: { type: "select", selectionKey: "catalog_sides", defaultValue: "front" }, choices: [{ value: "front", label: "Single-Sided / 4/0" }, { value: "front_back", label: "Double-Sided / 4/4" }] },
} };

describe("printing meaning in compatible inbound evidence", () => {
  it.each([["4/4", "front_back"], ["4/0", "front"]])("maps %s to actual catalog IDs", (notation, value) => {
    expect(hydrateInboundPbv2Selections(tree, `Prints ${notation}`).selections.selected.catalog_sides).toMatchObject({ value, origin: "SOURCE_EVIDENCE" });
    expect(detectUnsupportedInboundRequests(tree, `Prints ${notation}`, "Test Sign")).toEqual([]);
  });
  it("does not turn a date into a print-side request", () => {
    expect(hydrateInboundPbv2Selections(tree, "Due 4/4").selections.selected.catalog_sides).toMatchObject({ value: "front", origin: "DEFAULT" });
  });
  it("requires review rather than substituting front-color/back-black for 4/4", () => {
    const incompatible = structuredClone(tree);
    incompatible.nodes.actual_side_node.choices![1] = { value: "front_black_back", label: "Double-Sided / 4/1" };
    const result = hydrateInboundPbv2Selections(incompatible, "Prints 4/4");
    expect(result.suggestions.some(suggestion => suggestion.origin === "SOURCE_EVIDENCE")).toBe(false);
    expect(detectUnsupportedInboundRequests(incompatible, "Prints 4/4", "Test Sign")).toEqual([expect.objectContaining({ category: "print_sides", severity: "review_required" })]);
  });
});
