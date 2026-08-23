import { describe, expect, test } from "@jest/globals";
import { resolveProductOptionConfiguration } from "../productOptionConfigurationResolver";

const tree = {
  schemaVersion: 2 as const,
  rootNodeIds: ["pole_pockets", "pole_pocket_depth", "custom_depth"],
  nodes: {
    pole_pockets: {
      id: "pole_pockets", kind: "question" as const, label: "Pole Pockets",
      input: { type: "select", selectionKey: "pole_pockets", required: true },
      choices: [{ value: "no", label: "No" }, { value: "yes", label: "Yes" }],
    },
    pole_pocket_depth: {
      id: "pole_pocket_depth", kind: "question" as const, label: "Pole Pocket Depth",
      visibility: { rules: [{ type: "equals" as const, selectionKey: "pole_pockets", value: "yes" }] },
      input: { type: "select", selectionKey: "pole_pocket_depth", required: false },
      choices: [{ value: "3in", label: "3 inch" }, { value: "custom", label: "Custom" }],
    },
    custom_depth: {
      id: "custom_depth", kind: "question" as const, label: "Custom Pole Pocket Depth",
      visibility: { rules: [
        { type: "equals" as const, selectionKey: "pole_pockets", value: "yes" },
        { type: "equals" as const, selectionKey: "pole_pocket_depth", value: "custom" },
      ] },
      input: { type: "text", selectionKey: "custom_depth", required: false },
    },
  },
  optionRules: [
    {
      id: "pockets", when: { all: [{ optionGroup: "pole_pockets", operator: "equals" as const, value: "yes" }] },
      then: [{ action: "require" as const, targetOptionGroup: "pole_pocket_depth" }],
      else: [
        { action: "hide" as const, targetOptionGroup: "pole_pocket_depth" },
        { action: "optional" as const, targetOptionGroup: "pole_pocket_depth" },
        { action: "clear" as const, targetOptionGroup: "pole_pocket_depth" },
        { action: "hide" as const, targetOptionGroup: "custom_depth" },
        { action: "clear" as const, targetOptionGroup: "custom_depth" },
      ],
    },
    {
      id: "custom", when: { all: [{ optionGroup: "pole_pocket_depth", operator: "equals" as const, value: "custom" }] },
      then: [{ action: "require" as const, targetOptionGroup: "custom_depth" }],
      else: [{ action: "hide" as const, targetOptionGroup: "custom_depth" }],
    },
  ],
};

describe("ProductVersion option configuration resolution", () => {
  test("clears and hides stale child selections when pole pockets are disabled", () => {
    const result = resolveProductOptionConfiguration(tree, {
      pole_pockets: "no", pole_pocket_depth: "custom", custom_depth: "5 inch",
    });
    expect(result.effectiveSelections).toEqual({ pole_pockets: "no" });
    expect(result.visibleNodeIds).not.toContain("pole_pocket_depth");
    expect(result.visibleNodeIds).not.toContain("custom_depth");
    expect(result.requiredOptionGroups).not.toContain("pole_pocket_depth");
    expect(result.isValidForPricing).toBe(true);
  });

  test("requires the dynamically relevant child selections", () => {
    const pockets = resolveProductOptionConfiguration(tree, { pole_pockets: "yes" });
    expect(pockets.visibleNodeIds).toContain("pole_pocket_depth");
    expect(pockets.requiredOptionGroups).toContain("pole_pocket_depth");
    expect(pockets.isValidForPricing).toBe(false);

    const custom = resolveProductOptionConfiguration(tree, {
      pole_pockets: "yes", pole_pocket_depth: "custom",
    });
    expect(custom.visibleNodeIds).toContain("custom_depth");
    expect(custom.requiredOptionGroups).toContain("custom_depth");
    expect(custom.isValidForPricing).toBe(false);
  });
});
