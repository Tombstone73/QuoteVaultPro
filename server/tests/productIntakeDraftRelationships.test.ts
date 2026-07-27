import { describe, expect, test } from "@jest/globals";
import {
  productDraftRelationshipPatchSchema,
  relationshipSnapshotFromTree,
  removeTemplateImport,
} from "../services/productIntakeWizard/productIntakeDraftRelationships";

describe("product intake draft relationship patches", () => {
  test("distinguishes explicit clear operations from empty add and remove lists", () => {
    expect(productDraftRelationshipPatchSchema.safeParse({ options: { operation: "add", templates: [] } }).success).toBe(true);
    expect(productDraftRelationshipPatchSchema.safeParse({ options: { operation: "remove", templates: [] } }).success).toBe(true);
    expect(productDraftRelationshipPatchSchema.safeParse({ options: { operation: "clear" } }).success).toBe(true);
    expect(productDraftRelationshipPatchSchema.safeParse({ options: { operation: "clear", templates: [] } }).success).toBe(false);
  });

  test("requires a station only for a set-routing operation", () => {
    expect(productDraftRelationshipPatchSchema.safeParse({ routing: { operation: "set_primary", station: { name: "Flatbed" } } }).success).toBe(true);
    expect(productDraftRelationshipPatchSchema.safeParse({ routing: { operation: "set_primary" } }).success).toBe(false);
    expect(productDraftRelationshipPatchSchema.safeParse({ routing: { operation: "clear" } }).success).toBe(true);
  });

  test("removes only nodes, edges, and rules belonging to one tracked template import", () => {
    const tree = {
      nodes: {
        keep: { id: "keep", type: "INPUT" },
        removeGroup: { id: "removeGroup", type: "GROUP", meta: { templateSource: { importInstanceId: "import_a" } } },
        removeInput: { id: "removeInput", type: "INPUT", meta: { templateSource: { importInstanceId: "import_a" } } },
      },
      edges: [
        { id: "edge_import_a_1", fromNodeId: "removeGroup", toNodeId: "removeInput" },
        { id: "edge_keep", fromNodeId: "keep", toNodeId: "keep" },
      ],
      rules: [{ id: "rule_import_a_1" }, { id: "keep_rule" }],
    };
    const result = removeTemplateImport(tree, "import_a");
    expect(Object.keys(result.nodes)).toEqual(["keep"]);
    expect(result.edges).toEqual([{ id: "edge_keep", fromNodeId: "keep", toNodeId: "keep" }]);
    expect(result.rules).toEqual([{ id: "keep_rule" }]);
  });

  test("reads staff-only relationship metadata from the PBV2 draft tree", () => {
    expect(relationshipSnapshotFromTree({ meta: { productIntake: {
      draftRouting: { stationId: "station-1", stationKey: "flatbed", stationName: "Flatbed" },
      draftOptionTemplates: [{ templateId: "template-1", name: "Contour cutting", importInstanceId: "import-1" }],
      internalSetupNote: "Test white ink",
      reviewWarnings: ["Pricing review required"],
    } } })).toEqual({
      routing: { stationId: "station-1", stationKey: "flatbed", stationName: "Flatbed" },
      optionTemplates: [{ templateId: "template-1", name: "Contour cutting", importInstanceId: "import-1" }],
      setupNote: "Test white ink",
      reviewWarnings: ["Pricing review required"],
    });
  });
});
