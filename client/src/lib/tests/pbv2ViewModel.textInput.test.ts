import { describe, expect, test } from "@jest/globals";
import { applyPatchToTree, createUpdateChoicePatch, createUpdateGroupPatch, createUpdateOptionPatch, normalizeTreeJson, pbv2TreeToEditorModel } from "../pbv2/pbv2ViewModel";

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

  test("createUpdateGroupPatch writes Required when imported group is missing input metadata", () => {
    const tree = makeTextOptionTree();
    const { patch } = createUpdateGroupPatch(tree, "grp", { isRequired: true });
    const updated = applyPatchToTree(tree, patch) as any;
    expect(updated.nodes.grp.input).toMatchObject({ type: "select", required: true });
  });

  test("normalizeTreeJson creates a draft builder group for runtime-only input roots", () => {
    const normalized = normalizeTreeJson({
      schemaVersion: 2,
      status: "ACTIVE",
      rootNodeIds: ["imprint"],
      nodes: {
        imprint: {
          id: "imprint",
          type: "INPUT",
          kind: "question",
          status: "ENABLED",
          label: "Custom Imprint Text",
          key: "imprint",
          input: { type: "text", selectionKey: "imprint", required: true },
        },
      },
      edges: [],
    });
    const model = pbv2TreeToEditorModel(normalized);

    expect(model.groups).toHaveLength(1);
    expect(model.groups[0].optionIds).toEqual(["imprint"]);
    expect(model.options.imprint).toBeDefined();
    expect(normalized.status).toBe("DRAFT");
  });

  test("Product Intake generated GROUP to INPUT structural edges hydrate into editable groups", () => {
    const tree = normalizeTreeJson({
      schemaVersion: 2,
      status: "DRAFT",
      rootNodeIds: ["intake_size", "intake_printed_sides", "intake_rounded_corners"],
      nodes: {
        group_size_quantity: { id: "group_size_quantity", kind: "group", type: "GROUP", status: "ENABLED", label: "Size & Quantity", ui: { sortOrder: 10 } },
        group_print_setup: { id: "group_print_setup", kind: "group", type: "GROUP", status: "ENABLED", label: "Print Setup", ui: { sortOrder: 20 } },
        group_finishing: { id: "group_finishing", kind: "group", type: "GROUP", status: "ENABLED", label: "Finishing", ui: { sortOrder: 30 } },
        intake_size: {
          id: "intake_size",
          kind: "question",
          type: "INPUT",
          status: "ENABLED",
          label: "Size",
          key: "size",
          input: { type: "select", required: true, selectionKey: "size" },
          choices: [{ value: "8x10", label: "8x10" }, { value: "11x14", label: "11x14" }],
        },
        intake_printed_sides: {
          id: "intake_printed_sides",
          kind: "question",
          type: "INPUT",
          status: "ENABLED",
          label: "Printed Sides",
          key: "printed_sides",
          input: { type: "select", required: true, selectionKey: "printed_sides" },
          choices: [{ value: "single", label: "Single Sided" }, { value: "double", label: "Double Sided" }],
        },
        intake_rounded_corners: {
          id: "intake_rounded_corners",
          kind: "question",
          type: "INPUT",
          status: "ENABLED",
          label: "Rounded Corners",
          key: "rounded_corners",
          input: { type: "boolean", required: false, selectionKey: "rounded_corners" },
        },
      },
      edges: [
        { id: "edge_size", fromNodeId: "group_size_quantity", toNodeId: "intake_size", status: "DISABLED" },
        { id: "edge_sides", fromNodeId: "group_print_setup", toNodeId: "intake_printed_sides", status: "DISABLED" },
        { id: "edge_corners", fromNodeId: "group_finishing", toNodeId: "intake_rounded_corners", status: "DISABLED" },
      ],
    });
    const model = pbv2TreeToEditorModel(tree);

    expect(model.groups.map((group) => group.name)).toEqual(expect.arrayContaining(["Size & Quantity", "Print Setup", "Finishing"]));
    expect(model.groups.length).toBeGreaterThan(0);
    expect(Object.values(model.options).map((option) => option.name)).toEqual(expect.arrayContaining(["Size", "Printed Sides", "Rounded Corners"]));
    expect(Object.values(model.options).some((option) => /quantity|qty/i.test(`${option.name} ${option.selectionKey}`))).toBe(false);
  });

  test("pbv2TreeToEditorModel marks options and groups with choice-level pricing impacts", () => {
    const tree = normalizeTreeJson({
      schemaVersion: 2,
      status: "DRAFT",
      rootNodeIds: ["contour_cutting"],
      nodes: {
        group_cutting: { id: "group_cutting", kind: "group", type: "GROUP", status: "ENABLED", label: "Cutting" },
        contour_cutting: {
          id: "contour_cutting",
          kind: "question",
          type: "INPUT",
          status: "ENABLED",
          label: "Contour Cutting",
          key: "contour_cutting",
          input: { type: "select", required: true, selectionKey: "contour_cutting" },
          choices: [
            { value: "no", label: "No" },
            { value: "yes", label: "Yes", pricingImpact: [{ mode: "addPercent", percent: 10, basis: "base" }] },
          ],
        },
      },
      edges: [{ id: "edge_contour", fromNodeId: "group_cutting", toNodeId: "contour_cutting", status: "DISABLED" }],
    });

    const model = pbv2TreeToEditorModel(tree);

    expect(model.options.contour_cutting.hasPricing).toBe(true);
    expect(model.tags.groupPricing.has("group_cutting")).toBe(true);
  });

  test("changing a choice material override keeps its consumption basis, multiplier, and waste while synchronizing the material", () => {
    const tree = normalizeTreeJson({
      schemaVersion: 2,
      status: "DRAFT",
      rootNodeIds: ["thickness"],
      nodes: {
        thickness: {
          id: "thickness", kind: "question", type: "INPUT", status: "ENABLED", label: "Thickness", key: "thickness",
          input: { type: "select", selectionKey: "thickness" },
          choices: [{ value: "3mm", label: "3mm", materialOverride: { materialId: "foam_half" }, inventoryConsumption: [{ materialId: "foam_half", quantityBasis: "area_sqft", multiplier: 1.5, wastePercent: 7 }] }],
        },
      },
      edges: [],
    });

    const { patch } = createUpdateChoicePatch(tree, "thickness", "3mm", { materialOverride: { materialId: "oppbogga_3mm" } });
    const updated: any = applyPatchToTree(tree, patch);
    const node = Array.isArray(updated.nodes) ? updated.nodes.find((item: any) => item.id === "thickness") : updated.nodes.thickness;
    expect(node.choices[0]).toMatchObject({
      materialOverride: { materialId: "oppbogga_3mm" },
      inventoryConsumption: [{ materialId: "oppbogga_3mm", quantityBasis: "area_sqft", multiplier: 1.5, wastePercent: 7 }],
    });
  });
});
