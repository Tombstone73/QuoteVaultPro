import { describe, expect, test } from "@jest/globals";
import {
  createReorderGroupsPatch,
  applyPatchToTree,
  pbv2TreeToEditorModel,
} from "../pbv2/pbv2ViewModel";

/** Build a minimal valid PBV2 tree with the given group labels */
function makeTree(groupNames: string[]) {
  const nodes: Record<string, any> = {};
  const edges: any[] = [];
  const rootIds: string[] = [];

  groupNames.forEach((name, i) => {
    const gid = `g${i}`;
    const oid = `o${i}`;
    nodes[gid] = { id: gid, type: "GROUP", label: name };
    nodes[oid] = {
      id: oid,
      type: "INPUT",
      label: `Option ${i}`,
      key: `option_${i}`,
      status: "ENABLED",
      input: { type: "select", selectionKey: `option_${i}` },
    };
    edges.push({ id: `e${i}`, fromNodeId: gid, toNodeId: oid, status: "DISABLED" });
    rootIds.push(oid);
  });

  return { schemaVersion: 2 as const, rootNodeIds: rootIds, nodes, edges };
}

describe("createReorderGroupsPatch", () => {
  test("moves a group from index 0 to 2", () => {
    const tree = makeTree(["Alpha", "Beta", "Gamma"]);
    const { patch } = createReorderGroupsPatch(tree, 0, 2);
    const updated = applyPatchToTree(tree, patch);
    const model = pbv2TreeToEditorModel(updated);
    expect(model.groups.map(g => g.name)).toEqual(["Beta", "Gamma", "Alpha"]);
  });

  test("moves a group from index 2 to 0", () => {
    const tree = makeTree(["Alpha", "Beta", "Gamma"]);
    const { patch } = createReorderGroupsPatch(tree, 2, 0);
    const updated = applyPatchToTree(tree, patch);
    const model = pbv2TreeToEditorModel(updated);
    expect(model.groups.map(g => g.name)).toEqual(["Gamma", "Alpha", "Beta"]);
  });

  test("same index returns unchanged group order", () => {
    const tree = makeTree(["Alpha", "Beta", "Gamma"]);
    const { patch } = createReorderGroupsPatch(tree, 1, 1);
    const updated = applyPatchToTree(tree, patch);
    const model = pbv2TreeToEditorModel(updated);
    expect(model.groups.map(g => g.name)).toEqual(["Alpha", "Beta", "Gamma"]);
  });

  test("group IDs are preserved after reorder", () => {
    const tree = makeTree(["Alpha", "Beta"]);
    const originalIds = pbv2TreeToEditorModel(tree).groups.map(g => g.id);
    const { patch } = createReorderGroupsPatch(tree, 0, 1);
    const updated = applyPatchToTree(tree, patch);
    const reorderedIds = pbv2TreeToEditorModel(updated).groups.map(g => g.id);
    // Same IDs, different order
    expect(new Set(reorderedIds)).toEqual(new Set(originalIds));
    expect(reorderedIds[0]).toBe(originalIds[1]);
    expect(reorderedIds[1]).toBe(originalIds[0]);
  });

  test("option node IDs are unchanged by reorder", () => {
    const tree = makeTree(["Alpha", "Beta"]);
    const before = pbv2TreeToEditorModel(tree);
    const { patch } = createReorderGroupsPatch(tree, 0, 1);
    const updated = applyPatchToTree(tree, patch);
    const after = pbv2TreeToEditorModel(updated);
    // Each group still has the same options
    const beforeByName = Object.fromEntries(before.groups.map(g => [g.name, g.optionIds]));
    const afterByName = Object.fromEntries(after.groups.map(g => [g.name, g.optionIds]));
    expect(afterByName["Alpha"]).toEqual(beforeByName["Alpha"]);
    expect(afterByName["Beta"]).toEqual(beforeByName["Beta"]);
  });

  test("out-of-range fromIndex returns original order", () => {
    const tree = makeTree(["Alpha", "Beta"]);
    const { patch } = createReorderGroupsPatch(tree, 5, 0);
    const updated = applyPatchToTree(tree, patch);
    const model = pbv2TreeToEditorModel(updated);
    expect(model.groups.map(g => g.name)).toEqual(["Alpha", "Beta"]);
  });

  test("edge count unchanged by reorder", () => {
    const tree = makeTree(["Alpha", "Beta", "Gamma"]);
    const originalEdgeCount = (tree.edges as any[]).length;
    const { patch } = createReorderGroupsPatch(tree, 0, 2);
    expect(patch.edges.length).toBe(originalEdgeCount);
  });
});
