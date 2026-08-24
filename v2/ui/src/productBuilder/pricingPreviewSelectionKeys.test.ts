import assert from "node:assert/strict";
import { previewOptionValue, previewSelectionKey, resolvePreviewConfiguration, visiblePreviewOptions, withPreviewSelection } from "./pricing-preview";

assert.equal(previewSelectionKey("opt_internal", { opt_internal: "contour_cutting" }), "contour_cutting");
assert.equal(previewSelectionKey("opt_internal", {}), "opt_internal");

const options: any = [
  { optionId: "opt_parent", selectionKey: "parent", inputType: "select", choices: [], label: "Parent" },
  { optionId: "opt_child", selectionKey: "child", inputType: "select", choices: [], label: "Child" },
];
const resolved: any = {
  visibleOptionSelectionKeys: ["parent"], hiddenOptionSelectionKeys: ["child"], disabledOptionSelectionKeys: [], requiredOptionSelectionKeys: [], clearedOptionSelectionKeys: ["child"], defaultedOptionSelectionKeys: [], effectiveSelections: { parent: "no" },
};
assert.deepEqual(visiblePreviewOptions(options, { opt_parent: "parent", opt_child: "child" }, resolved).map((option) => option.optionId), ["opt_parent"]);

const ruleOptions: any = [
  { optionId: "opt_parent", selectionKey: "parent", inputType: "select", required: true, defaultValue: null, choices: [{ choiceValue: "no", label: "No" }, { choiceValue: "yes", label: "Yes" }], label: "Parent", canRemove: true },
  { optionId: "opt_child", selectionKey: "child", inputType: "select", required: false, defaultValue: null, choices: [{ choiceValue: "custom", label: "Custom" }], label: "Child", canRemove: true, visibility: { rules: [{ type: "equals", selectionKey: "parent", value: "yes" }] } },
];
const ruleConfig = resolvePreviewConfiguration(ruleOptions, [{ id: "child-required", when: { all: [{ optionGroup: "parent", operator: "equals", value: "yes" }] }, then: [{ action: "require", targetOptionGroup: "child" }], else: [{ action: "hide", targetOptionGroup: "child" }, { action: "clear", targetOptionGroup: "child" }] }] as any, { parent: "no", child: "custom" });
assert.deepEqual(ruleConfig.effectiveSelections, { parent: "no" });
assert.deepEqual(ruleConfig.visibleOptionSelectionKeys, ["parent"]);

const typedOptions: any = [
  { optionId: "multi", selectionKey: "multi", inputType: "multiselect", choices: [{ choiceValue: "a", label: "A" }], label: "Multi" },
  { optionId: "flag", selectionKey: "flag", inputType: "boolean", choices: [], label: "Flag", defaultValue: false },
  { optionId: "count", selectionKey: "count", inputType: "number", choices: [], label: "Count", defaultValue: 3 },
  { optionId: "note", selectionKey: "note", inputType: "textarea", choices: [], label: "Note" },
];
const typedConfiguration = resolvePreviewConfiguration(typedOptions, [], {});
assert.deepEqual(visiblePreviewOptions(typedOptions, {}, typedConfiguration).map((option) => option.inputType), ["multiselect", "boolean", "number", "textarea"]);
assert.equal(previewOptionValue({ quantity: "1", width: "", height: "", selections: {} }, typedConfiguration, "flag"), false);
assert.equal(previewOptionValue({ quantity: "1", width: "", height: "", selections: {} }, typedConfiguration, "count"), 3);
assert.deepEqual(withPreviewSelection({ quantity: "1", width: "", height: "", selections: {} }, "multi", ["a"]).selections, { multi: ["a"] });
assert.deepEqual(withPreviewSelection({ quantity: "1", width: "", height: "", selections: { count: 3 } }, "count", undefined).selections, {});

console.log("Product Builder preview selection-key tests passed.");
