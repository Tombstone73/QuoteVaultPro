import { describe, expect, test } from "@jest/globals";

import {
  applyPatchToTree,
  createUpdateOptionPatch,
  pbv2TreeToEditorModel,
} from "./pbv2ViewModel";

function makeTree() {
  return {
    schemaVersion: 2,
    status: "DRAFT",
    rootNodeIds: ["material"],
    nodes: {
      group_finishing: {
        id: "group_finishing",
        kind: "group",
        type: "GROUP",
        status: "ENABLED",
        label: "Finishing",
      },
      material: {
        id: "material",
        kind: "question",
        type: "INPUT",
        status: "ENABLED",
        key: "material",
        label: "Material",
        input: { type: "select", selectionKey: "material" },
        choices: [{ value: "vinyl", label: "Vinyl" }],
      },
      grommets: {
        id: "grommets",
        kind: "question",
        type: "INPUT",
        status: "DISABLED",
        key: "grommets",
        label: "Grommets",
        input: { type: "boolean", selectionKey: "grommets" },
      },
    },
    edges: [
      { id: "edge_material", status: "DISABLED", fromNodeId: "group_finishing", toNodeId: "material" },
      { id: "edge_grommets", status: "DISABLED", fromNodeId: "group_finishing", toNodeId: "grommets" },
    ],
  };
}

describe("pbv2ViewModel product option enablement", () => {
  test("keeps disabled product options visible in the editor model", () => {
    const model = pbv2TreeToEditorModel(makeTree());

    expect(model.groups[0].optionIds).toEqual(["material", "grommets"]);
    expect(model.options.material.enabled).toBe(true);
    expect(model.options.grommets.enabled).toBe(false);
  });

  test("updates only the selected product option node status", () => {
    const source = makeTree();
    const disabledPatch = createUpdateOptionPatch(source, "material", { enabled: false }).patch;
    const disabledTree = applyPatchToTree(source, disabledPatch);

    expect(disabledTree.nodes.material.status).toBe("DISABLED");
    expect(disabledTree.nodes.grommets.status).toBe("DISABLED");

    const enabledPatch = createUpdateOptionPatch(disabledTree, "grommets", { enabled: true }).patch;
    const reenabledTree = applyPatchToTree(disabledTree, enabledPatch);

    expect(reenabledTree.nodes.material.status).toBe("DISABLED");
    expect(reenabledTree.nodes.grommets.status).toBe("ENABLED");
    expect(reenabledTree.nodes.grommets.input.selectionKey).toBe("grommets");
  });
});
