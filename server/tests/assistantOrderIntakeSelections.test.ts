import { describe, expect, it } from "@jest/globals";
import type { OptionTreeV2 } from "@shared/optionTreeV2";
import { canonicalDefaultOrderSelections, isAssistantOrderOptionQuestion, orderIntakeOptionGroups, resolveAssistantOrderSelections } from "../services/assistant/orderIntakeSelections";

const tree: OptionTreeV2 = {
  schemaVersion: 2,
  rootNodeIds: ["sides", "thickness", "retired"],
  nodes: {
    sides: { id: "sides", kind: "question", label: "Sides", input: { type: "select", selectionKey: "sides", required: true, defaultValue: "single" }, choices: [{ value: "single", label: "Single Sided" }, { value: "double", label: "Double Sided" }] },
    thickness: { id: "thickness", kind: "question", label: "Thickness", input: { type: "select", selectionKey: "thickness", required: true }, choices: [{ value: "3mm", label: "3mm" }, { value: "6mm", label: "6mm" }] },
    retired: { id: "retired", kind: "question", status: "DISABLED", label: "Retired", input: { type: "select", selectionKey: "retired" }, choices: [{ value: "old", label: "Old option" }] },
  },
};

describe("assistant direct-order PBV2 selections", () => {
  it("enumerates only active snapshot choices and identifies canonical defaults", () => {
    const groups = orderIntakeOptionGroups(tree, canonicalDefaultOrderSelections(tree), ["sides", "thickness"]);
    expect(groups).toEqual([
      expect.objectContaining({ label: "Sides", choices: [expect.objectContaining({ label: "Single Sided", isDefault: true }), expect.objectContaining({ label: "Double Sided", isDefault: false })] }),
      expect.objectContaining({ label: "Thickness", choices: [expect.objectContaining({ label: "3mm" }), expect.objectContaining({ label: "6mm" })] }),
    ]);
    expect(JSON.stringify(groups)).not.toContain("Old option");
  });

  it("resolves exact canonical values across capitalization, punctuation, and hyphens", () => {
    const resolved = resolveAssistantOrderSelections({ tree, existingSelections: canonicalDefaultOrderSelections(tree), message: "SIDES: single-sided; Thickness: 3 mm", requiredSelectionKeys: ["sides", "thickness"] });
    expect(resolved).toMatchObject({ ok: true, selections: { selected: { sides: { value: "single" }, thickness: { value: "3mm" } } } });
  });

  it("fails closed for invalid, ambiguous, and contradictory selections", () => {
    expect(resolveAssistantOrderSelections({ tree, existingSelections: canonicalDefaultOrderSelections(tree), message: "Thickness: 9mm", requiredSelectionKeys: ["thickness"] })).toMatchObject({ ok: false, code: "ORDER_OPTION_INVALID" });
    expect(resolveAssistantOrderSelections({ tree, existingSelections: canonicalDefaultOrderSelections(tree), message: "Single Sided and Double Sided", requiredSelectionKeys: ["sides"] })).toMatchObject({ ok: false, code: "ORDER_OPTION_CONTRADICTORY" });
    const duplicateValueTree: OptionTreeV2 = { ...tree, nodes: { ...tree.nodes, finish: { id: "finish", kind: "question", label: "Finish", input: { type: "select", selectionKey: "finish" }, choices: [{ value: "3mm", label: "3mm" }] } }, rootNodeIds: [...tree.rootNodeIds, "finish"] };
    expect(resolveAssistantOrderSelections({ tree: duplicateValueTree, existingSelections: canonicalDefaultOrderSelections(duplicateValueTree), message: "3mm", requiredSelectionKeys: ["thickness", "finish"] })).toMatchObject({ ok: false, code: "ORDER_OPTION_AMBIGUOUS" });
  });

  it("recognizes option questions without treating them as selections", () => {
    expect(isAssistantOrderOptionQuestion("What are the options?")).toBe(true);
    expect(isAssistantOrderOptionQuestion("Use single sided and 3mm")).toBe(false);
  });
});
