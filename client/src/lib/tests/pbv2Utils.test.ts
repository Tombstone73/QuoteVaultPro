import { describe, expect, test } from "@jest/globals";
import { getPbv2Tree, isPbv2Product, normalizePbv2Tree, summarizePbv2Tree } from "@/lib/pbv2Utils";

function makeLegacyTypedTree() {
  return {
    schemaVersion: 2 as const,
    rootNodeIds: ["group_board"],
    nodes: {
      group_board: {
        id: "group_board",
        type: "GROUP",
        label: "Board Options",
      },
      sides: {
        id: "sides",
        type: "INPUT",
        label: "Sides",
        key: "sides",
        input: { type: "select" as const },
        choices: [
          { value: "single", label: "Single" },
          { value: "double", label: "Double" },
        ],
      },
      thickness: {
        id: "thickness",
        type: "INPUT",
        label: "Thickness",
        key: "thickness",
        input: { type: "select" as const },
        choices: [
          { value: "3mm", label: "3mm" },
          { value: "6mm", label: "6mm" },
        ],
      },
    },
    edges: [
      { fromNodeId: "group_board", toNodeId: "sides", status: "DISABLED" as const },
      { fromNodeId: "group_board", toNodeId: "thickness", status: "DISABLED" as const },
    ],
  };
}

describe("pbv2Utils tree normalization", () => {
  test("normalizes legacy INPUT/GROUP nodes into renderable PBV2 nodes", () => {
    const normalized = normalizePbv2Tree(makeLegacyTypedTree());

    expect(normalized).not.toBeNull();
    expect(normalized?.nodes.group_board.kind).toBe("group");
    expect(normalized?.nodes.sides.kind).toBe("question");
    expect(normalized?.nodes.sides.input?.selectionKey).toBe("sides");
    expect(normalized?.nodes.thickness.kind).toBe("question");
    expect(normalized?.nodes.thickness.input?.selectionKey).toBe("thickness");
  });

  test("summarizes legacy typed PBV2 trees with selectable questions", () => {
    const summary = summarizePbv2Tree(makeLegacyTypedTree());

    expect(summary.exists).toBe(true);
    expect(summary.groupCount).toBe(1);
    expect(summary.questionCount).toBe(2);
    expect(summary.choiceCount).toBe(4);
    expect(summary.renderableControlCount).toBe(2);
  });

  test("getPbv2Tree returns normalized tree data for PBV2 products", () => {
    const tree = makeLegacyTypedTree();
    const product = {
      id: "prod_pvc",
      name: "PVC",
      optionTreeJson: JSON.stringify(tree),
    };

    const extracted = getPbv2Tree(product as any);

    expect(extracted).not.toBeNull();
    expect(extracted?.nodes.sides.kind).toBe("question");
    expect(extracted?.nodes.sides.input?.selectionKey).toBe("sides");
    expect(extracted?.nodes.thickness.kind).toBe("question");
    expect(extracted?.nodes.thickness.input?.selectionKey).toBe("thickness");
  });

  test("recognizes a DRAFT-only PBV2 catalog product so Order Entry blocks instead of using legacy pricing", () => {
    const product = { id: "prod_acm", name: "ACM", pbv2ActiveTreeVersionId: null, pbv2DraftTreeVersionId: "draft_acm", optionTreeJson: null };

    expect(isPbv2Product(product as any)).toBe(true);
    expect(getPbv2Tree(product as any)).toBeNull();
  });
});
