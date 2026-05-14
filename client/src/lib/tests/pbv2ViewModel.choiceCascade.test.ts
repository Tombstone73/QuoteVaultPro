import { describe, expect, test } from "@jest/globals";
import { createUpdateChoicePatch, applyPatchToTree } from "../pbv2/pbv2ViewModel";

function makeAcmTree() {
  return {
    schemaVersion: 2 as const,
    rootNodeIds: ["thickness", "sides"],
    pricingMatrix: {
      dimensions: ["thickness", "sides"],
      rows: [
        { id: "3mm_single", when: { thickness: "3mm", sides: "single" }, variables: { base_price: 5 } },
        { id: "3mm_double", when: { thickness: "3mm", sides: "double" }, variables: { base_price: 5.75 } },
        { id: "6mm_single", when: { thickness: "6mm", sides: "single" }, variables: { base_price: 7 } },
        { id: "6mm_double", when: { thickness: "6mm", sides: "double" }, variables: { base_price: 8.25 } },
      ],
    },
    nodes: {
      thickness: {
        id: "thickness",
        type: "INPUT" as const,
        kind: "question" as const,
        label: "Thickness",
        key: "thickness",
        input: { type: "select" as const, selectionKey: "thickness" },
        choices: [
          { value: "3mm", label: "3mm" },
          { value: "6mm", label: "6mm" },
        ],
      },
      sides: {
        id: "sides",
        type: "INPUT" as const,
        kind: "question" as const,
        label: "Sides",
        key: "sides",
        input: { type: "select" as const, selectionKey: "sides" },
        choices: [
          { value: "single", label: "Single" },
          { value: "double", label: "Double" },
        ],
      },
    },
    edges: [] as any[],
  };
}

function makeRuleTree() {
  return {
    schemaVersion: 2 as const,
    rootNodeIds: ["material"],
    pricingMatrix: {
      dimensions: ["material"],
      rows: [
        { id: "vinyl", when: { material: "vinyl" }, variables: { base_price: 3 } },
        { id: "fabric", when: { material: "fabric" }, variables: { base_price: 5 } },
      ],
    },
    rules: [
      {
        id: "rule_fabric_upsell",
        when: { all: [{ optionGroup: "material", operator: "equals", value: "fabric" }] },
        then: [{ action: "show", targetOptionGroup: "hem_color" }],
      },
    ],
    nodes: {
      material: {
        id: "material",
        type: "INPUT" as const,
        kind: "question" as const,
        label: "Material",
        key: "material",
        input: { type: "select" as const, selectionKey: "material" },
        choices: [
          { value: "vinyl", label: "Vinyl" },
          { value: "fabric", label: "Fabric" },
        ],
      },
    },
    edges: [] as any[],
  };
}

describe("createUpdateChoicePatch – pricingMatrix cascade on value rename", () => {
  test("renaming a choice value updates matching pricingMatrix rows", () => {
    const tree = makeAcmTree();
    const { patch } = createUpdateChoicePatch(tree, "sides", "single", { value: "choice_single" });
    const updated = applyPatchToTree(tree, patch);

    const rows = updated.pricingMatrix.rows;
    expect(rows.find((r: any) => r.id === "3mm_single").when).toEqual({ thickness: "3mm", sides: "choice_single" });
    expect(rows.find((r: any) => r.id === "6mm_single").when).toEqual({ thickness: "6mm", sides: "choice_single" });
    // Unrelated rows untouched
    expect(rows.find((r: any) => r.id === "3mm_double").when).toEqual({ thickness: "3mm", sides: "double" });
    expect(rows.find((r: any) => r.id === "6mm_double").when).toEqual({ thickness: "6mm", sides: "double" });
  });

  test("renaming thickness value only touches rows with that dimension", () => {
    const tree = makeAcmTree();
    const { patch } = createUpdateChoicePatch(tree, "thickness", "6mm", { value: "6_mm" });
    const updated = applyPatchToTree(tree, patch);

    const rows = updated.pricingMatrix.rows;
    expect(rows.find((r: any) => r.id === "6mm_single").when).toEqual({ thickness: "6_mm", sides: "single" });
    expect(rows.find((r: any) => r.id === "6mm_double").when).toEqual({ thickness: "6_mm", sides: "double" });
    expect(rows.find((r: any) => r.id === "3mm_single").when).toEqual({ thickness: "3mm", sides: "single" });
    expect(rows.find((r: any) => r.id === "3mm_double").when).toEqual({ thickness: "3mm", sides: "double" });
  });

  test("all 4 rows resolve to distinct values after cascade rename", () => {
    const tree = makeAcmTree();
    const { patch } = createUpdateChoicePatch(tree, "sides", "double", { value: "choice_double" });
    const updated = applyPatchToTree(tree, patch);

    const rows = updated.pricingMatrix.rows;
    const whenValues = rows.map((r: any) => JSON.stringify(r.when));
    const unique = new Set(whenValues);
    expect(unique.size).toBe(4);
  });

  test("label-only rename does not modify pricingMatrix rows", () => {
    const tree = makeAcmTree();
    const { patch } = createUpdateChoicePatch(tree, "sides", "single", { label: "Front Only" });
    const updated = applyPatchToTree(tree, patch);

    expect(updated.pricingMatrix.rows).toEqual(tree.pricingMatrix.rows);
  });

  test("renaming a choice value cascades into rules conditions", () => {
    const tree = makeRuleTree();
    const { patch } = createUpdateChoicePatch(tree, "material", "fabric", { value: "fabric_premium" });
    const updated = applyPatchToTree(tree, patch);

    const condition = updated.rules[0].when.all[0];
    expect(condition.value).toBe("fabric_premium");
    expect(condition.optionGroup).toBe("material");
  });

  test("unrelated optionGroup conditions are not modified by rename", () => {
    const tree = makeRuleTree();
    const { patch } = createUpdateChoicePatch(tree, "material", "vinyl", { value: "vinyl_matte" });
    const updated = applyPatchToTree(tree, patch);

    // Rule references 'fabric', not 'vinyl' — should be unchanged
    const condition = updated.rules[0].when.all[0];
    expect(condition.value).toBe("fabric");
  });

  test("pricingMatrix rows are not mutated in the original tree", () => {
    const tree = makeAcmTree();
    const originalRows = tree.pricingMatrix.rows.map((r) => ({ ...r.when }));
    createUpdateChoicePatch(tree, "sides", "single", { value: "choice_single" });
    const afterRows = tree.pricingMatrix.rows.map((r) => ({ ...r.when }));
    expect(afterRows).toEqual(originalRows);
  });
});
