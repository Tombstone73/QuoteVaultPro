import assert from "node:assert/strict";
import { resolveProductOptionConfiguration } from "../../../shared/productOptionConfigurationResolver.js";

const tree = {
  schemaVersion: 2 as const,
  rootNodeIds: ["pole_pockets", "pole_pocket_depth", "custom_depth"],
  nodes: {
    pole_pockets: { id: "pole_pockets", kind: "question" as const, label: "Pole Pockets", input: { type: "select", selectionKey: "pole_pockets", required: true }, choices: [{ value: "no", label: "No" }, { value: "yes", label: "Yes" }] },
    pole_pocket_depth: { id: "pole_pocket_depth", kind: "question" as const, label: "Pole Pocket Depth", visibility: { rules: [{ type: "equals" as const, selectionKey: "pole_pockets", value: "yes" }] }, input: { type: "select", selectionKey: "pole_pocket_depth", required: false }, choices: [{ value: "3in", label: "3 inch" }, { value: "custom", label: "Custom" }] },
    custom_depth: { id: "custom_depth", kind: "question" as const, label: "Custom Pole Pocket Depth", visibility: { rules: [{ type: "equals" as const, selectionKey: "pole_pocket_depth", value: "custom" }] }, input: { type: "text", selectionKey: "custom_depth", required: false } },
  },
  optionRules: [
    { id: "pockets", when: { all: [{ optionGroup: "pole_pockets", operator: "equals" as const, value: "yes" }] }, then: [{ action: "require" as const, targetOptionGroup: "pole_pocket_depth" }], else: [{ action: "hide" as const, targetOptionGroup: "pole_pocket_depth" }, { action: "optional" as const, targetOptionGroup: "pole_pocket_depth" }, { action: "clear" as const, targetOptionGroup: "pole_pocket_depth" }, { action: "hide" as const, targetOptionGroup: "custom_depth" }, { action: "clear" as const, targetOptionGroup: "custom_depth" }] },
    { id: "custom", when: { all: [{ optionGroup: "pole_pocket_depth", operator: "equals" as const, value: "custom" }] }, then: [{ action: "require" as const, targetOptionGroup: "custom_depth" }], else: [{ action: "hide" as const, targetOptionGroup: "custom_depth" }] },
  ],
};

const noPockets = resolveProductOptionConfiguration(tree, { pole_pockets: "no", pole_pocket_depth: "custom", custom_depth: "5 inch" });
assert.deepEqual(noPockets.effectiveSelections, { pole_pockets: "no" });
assert(!noPockets.visibleNodeIds.includes("pole_pocket_depth"));
assert(!noPockets.visibleNodeIds.includes("custom_depth"));
assert(noPockets.isValidForPricing);

const pockets = resolveProductOptionConfiguration(tree, { pole_pockets: "yes" });
assert(pockets.visibleNodeIds.includes("pole_pocket_depth"));
assert(pockets.requiredOptionGroups.includes("pole_pocket_depth"));
assert(!pockets.isValidForPricing);

const custom = resolveProductOptionConfiguration(tree, { pole_pockets: "yes", pole_pocket_depth: "custom" });
assert(custom.visibleNodeIds.includes("custom_depth"));
assert(custom.requiredOptionGroups.includes("custom_depth"));
assert(!custom.isValidForPricing);

console.log("product option configuration resolver pure checks passed");
