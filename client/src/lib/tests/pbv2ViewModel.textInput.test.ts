import { describe, expect, test } from "@jest/globals";
import { applyPatchToTree, createUpdateOptionPatch, pbv2TreeToEditorModel } from "../pbv2/pbv2ViewModel";

function makeTextOptionTree() {
  return {
    schemaVersion: 2 as const,
    rootNodeIds: ["imprint"],
    nodes: {
      grp: { id: "grp", type: "GROUP", label: "Personalization" },
      imprint: {
        id: "imprint",
        type: "INPUT",
        kind: "question" as const,
        status: "ENABLED",
        label: "Custom Imprint Text",
        key: "imprint",
        input: { type: "text" as const, selectionKey: "imprint", required: true },
      },
    },
    edges: [{ id: "e1", fromNodeId: "grp", toNodeId: "imprint", status: "ENABLED" }],
  };
}

describe("pbv2ViewModel — text input type", () => {
  test("pbv2TreeToEditorModel maps input.type 'text' to EditorOption.type 'text'", () => {
    const tree = makeTextOptionTree();
    const model = pbv2TreeToEditorModel(tree);
    const option = model.options["imprint"];
    expect(option).toBeDefined();
    expect(option.type).toBe("text");
  });

  test("pbv2TreeToEditorModel does not map text node to 'radio' or 'dropdown'", () => {
    const tree = makeTextOptionTree();
    const model = pbv2TreeToEditorModel(tree);
    const option = model.options["imprint"];
    expect(option.type).not.toBe("radio");
    expect(option.type).not.toBe("dropdown");
  });

  test("createUpdateOptionPatch with type 'text' writes input.type 'text' to tree", () => {
    const tree = makeTextOptionTree();
    const { patch } = createUpdateOptionPatch(tree, "imprint", { type: "text" });
    const updated = applyPatchToTree(tree, patch) as any;
    const nodes = updated.nodes;
    const inputNode = Array.isArray(nodes)
      ? nodes.find((n: any) => n.id === "imprint")
      : nodes["imprint"];
    expect(inputNode.input.type).toBe("text");
  });

  test("createUpdateOptionPatch with type 'text' does not fall back to 'select'", () => {
    const tree = makeTextOptionTree();
    const { patch } = createUpdateOptionPatch(tree, "imprint", { type: "text" });
    const updated = applyPatchToTree(tree, patch) as any;
    const nodes = updated.nodes;
    const inputNode = Array.isArray(nodes)
      ? nodes.find((n: any) => n.id === "imprint")
      : nodes["imprint"];
    expect(inputNode.input.type).not.toBe("select");
  });

  test("isRequired is preserved on a text option node", () => {
    const tree = makeTextOptionTree();
    const model = pbv2TreeToEditorModel(tree);
    const option = model.options["imprint"];
    expect(option.isRequired).toBe(true);
  });

  test("pbv2TreeToEditorModel maps input.type 'textarea' to EditorOption.type 'textarea'", () => {
    const tree = makeTextOptionTree();
    (tree.nodes.imprint.input as any).type = "textarea";
    const model = pbv2TreeToEditorModel(tree);
    const option = model.options["imprint"];
    expect(option.type).toBe("textarea");
  });

  test("createUpdateOptionPatch with type 'textarea' writes input.type 'textarea' to tree", () => {
    const tree = makeTextOptionTree();
    const { patch } = createUpdateOptionPatch(tree, "imprint", { type: "textarea" });
    const updated = applyPatchToTree(tree, patch) as any;
    const nodes = updated.nodes;
    const inputNode = Array.isArray(nodes)
      ? nodes.find((n: any) => n.id === "imprint")
      : nodes["imprint"];
    expect(inputNode.input.type).toBe("textarea");
  });
});
