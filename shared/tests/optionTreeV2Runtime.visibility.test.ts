import { describe, expect, test } from "@jest/globals";
import { resolveRuntimeVisibility } from "../optionTreeV2Runtime";

function makeVisibilityTree() {
  return {
    schemaVersion: 2 as const,
    rootNodeIds: ["group_material", "group_print", "group_finish", "group_acrylic"],
    nodes: {
      group_material: {
        id: "group_material",
        kind: "group" as const,
        label: "Material",
      },
      materialFamily: {
        id: "materialFamily",
        kind: "question" as const,
        label: "Material Family",
        input: {
          type: "select" as const,
          selectionKey: "materialFamily",
        },
        choices: [
          { value: "ACM", label: "ACM" },
          { value: "Acrylic", label: "Acrylic" },
        ],
      },
      group_print: {
        id: "group_print",
        kind: "group" as const,
        label: "Print Sides",
        visibility: {
          rules: [{ type: "equals" as const, selectionKey: "materialFamily", value: "ACM" }],
        },
      },
      printSides: {
        id: "printSides",
        kind: "question" as const,
        label: "Print Sides",
        input: {
          type: "select" as const,
          selectionKey: "printSides",
        },
        choices: [
          { value: "single", label: "Single" },
          { value: "double", label: "Double" },
        ],
      },
      group_finish: {
        id: "group_finish",
        kind: "group" as const,
        label: "Contour Cut",
      },
      contourCut: {
        id: "contourCut",
        kind: "question" as const,
        label: "Contour Cut",
        input: {
          type: "boolean" as const,
          selectionKey: "contourCut",
        },
      },
      group_acrylic: {
        id: "group_acrylic",
        kind: "group" as const,
        label: "Acrylic Options",
        visibility: {
          rules: [{ type: "equals" as const, selectionKey: "materialFamily", value: "Acrylic" }],
        },
      },
      edgePolish: {
        id: "edgePolish",
        kind: "question" as const,
        label: "Edge Polish",
        input: {
          type: "select" as const,
          selectionKey: "edgePolish",
        },
        choices: [
          { value: "none", label: "None" },
          {
            value: "premium",
            label: "Premium Polish",
            visibilityRules: [{ type: "equals" as const, selectionKey: "materialFamily", value: "Acrylic" }],
          },
        ],
      },
    },
    edges: [
      { id: "e1", status: "DISABLED" as const, fromNodeId: "group_material", toNodeId: "materialFamily" },
      { id: "e2", status: "DISABLED" as const, fromNodeId: "group_print", toNodeId: "printSides" },
      { id: "e3", status: "DISABLED" as const, fromNodeId: "group_finish", toNodeId: "contourCut" },
      { id: "e4", status: "DISABLED" as const, fromNodeId: "group_acrylic", toNodeId: "edgePolish" },
    ],
  };
}

describe("optionTreeV2Runtime visibility resolution", () => {
  test("ACM shows print sides while acrylic options stay hidden", () => {
    const result = resolveRuntimeVisibility(makeVisibilityTree() as any, {
      selected: {
        materialFamily: { value: "ACM" },
      },
    });

    expect(result.visibleGroupIds).toHaveLength(3);
    expect(result.visibleGroupIds).toEqual(expect.arrayContaining(["group_material", "group_finish", "group_print"]));
    expect(result.visibleNodeIds).toContain("printSides");
    expect(result.visibleNodeIds).not.toContain("edgePolish");
    expect(result.effectiveSelections.materialFamily).toBe("ACM");
  });

  test("stale hidden selections are ignored and choice-level visibility is enforced", () => {
    const result = resolveRuntimeVisibility(makeVisibilityTree() as any, {
      selected: {
        materialFamily: { value: "Acrylic" },
        printSides: { value: "double" },
        edgePolish: { value: "premium" },
      },
    });

    expect(result.visibleGroupIds).toEqual(["group_acrylic", "group_finish", "group_material"]);
    expect(result.effectiveSelections.materialFamily).toBe("Acrylic");
    expect(result.effectiveSelections.printSides).toBeUndefined();
    expect(result.effectiveSelections.edgePolish).toBe("premium");
    expect(result.hiddenSelectionWarnings.some((warning) => warning.selectionKey === "printSides" && warning.reason === "hidden_node")).toBe(true);
    expect(result.visibleChoiceIds).toContain("edgePolish:premium");
  });

  test("hidden choice selections are stripped even when the parent option stays visible", () => {
    const result = resolveRuntimeVisibility(makeVisibilityTree() as any, {
      selected: {
        materialFamily: { value: "ACM" },
        edgePolish: { value: "premium" },
      },
    });

    expect(result.visibleNodeIds).not.toContain("edgePolish");
    expect(result.effectiveSelections.edgePolish).toBeUndefined();
  });
});
