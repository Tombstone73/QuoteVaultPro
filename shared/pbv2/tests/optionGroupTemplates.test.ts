import { describe, expect, test } from "@jest/globals";
import {
  cloneTemplateIntoTree,
  extractOptionGroupTemplateTree,
  validateOptionGroupTemplateTree,
} from "../optionGroupTemplates";
import { validateTreeForPublish } from "../validator/validatePublish";
import { DEFAULT_VALIDATE_OPTS } from "../validator/types";

const tree = {
  schemaVersion: 2,
  status: "DRAFT",
  rootNodeIds: ["opt_lamination", "outside_option"],
  nodes: {
    group_finish: {
      id: "group_finish",
      type: "GROUP",
      kind: "group",
      label: "Finishing",
      displayOrder: 0,
    },
    opt_lamination: {
      id: "opt_lamination",
      type: "OPTION",
      kind: "question",
      label: "Lamination",
      input: {
        selectionKey: "lamination",
        choices: [
          { value: "none", label: "None" },
          { value: "matte", label: "Matte" },
        ],
      },
      pricingImpact: [{ type: "addFormula", formula: "coverage_sqft * 2", nodeOutputRef: { nodeId: "calc_finish", output: "coverage_sqft" } }],
    },
    opt_contour: {
      id: "opt_contour",
      type: "OPTION",
      kind: "question",
      label: "Contour Cutting",
      input: {
        selectionKey: "contour_cutting",
        choices: [
          { value: "no", label: "No" },
          { value: "yes", label: "Yes" },
        ],
      },
    },
    calc_finish: {
      id: "calc_finish",
      type: "COMPUTED",
      kind: "computed",
      label: "Finish Coverage",
      expression: { op: "nodeOutputRef", nodeOutputRef: { nodeId: "opt_lamination", output: "selected" } },
    },
    outside_option: {
      id: "outside_option",
      type: "OPTION",
      kind: "question",
      label: "Outside",
      input: { selectionKey: "outside_key", choices: [{ value: "x", label: "X" }] },
    },
  },
  edges: [
    { id: "edge_group_lam", fromNodeId: "group_finish", toNodeId: "opt_lamination", status: "DISABLED", condition: { op: "EXISTS", value: { op: "literal", value: true } } },
    { id: "edge_group_contour", fromNodeId: "group_finish", toNodeId: "opt_contour", status: "DISABLED", condition: { op: "EXISTS", value: { op: "literal", value: true } } },
    { id: "edge_lam_calc", fromNodeId: "opt_lamination", toNodeId: "calc_finish", status: "ENABLED", condition: { op: "EXISTS", value: { op: "literal", value: true } } },
  ],
  rules: [{
    id: "rule_finish",
    when: { all: [{ optionGroup: "lamination", operator: "equals", value: "matte" }] },
    then: [{ action: "require", targetOptionGroup: "contour_cutting" }],
  }],
  pricingMatrix: {
    id: "matrix_finish",
    dimensions: ["lamination", "contour_cutting"],
    rows: [{
      id: "row_matte_cut",
      when: { lamination: "matte", contour_cutting: "yes" },
      variables: { finish_fee: 250 },
    }],
  },
};

describe("PBV2 option group templates", () => {
  test("extracts a self-contained group template with rules and matrix fragments", () => {
    const result = extractOptionGroupTemplateTree(tree, "group_finish");
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(Object.keys(result.templateTree.nodes).sort()).toEqual(["calc_finish", "group_finish", "opt_contour", "opt_lamination"]);
    expect(result.templateTree.rules).toHaveLength(1);
    expect(result.templateTree.pricingMatrix?.dimensions).toEqual(["lamination", "contour_cutting"]);
    expect(validateOptionGroupTemplateTree(result.templateTree).ok).toBe(true);
  });

  test("rejects extraction when a related rule references an external selection", () => {
    const result = extractOptionGroupTemplateTree({
      ...tree,
      rules: [{
        id: "rule_external",
        when: { all: [{ optionGroup: "lamination", operator: "equals", value: "matte" }] },
        then: [{ action: "require", targetOptionGroup: "outside_key" }],
      }],
    }, "group_finish");

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.map((error) => error.code)).toContain("EXTERNAL_RULE_REFERENCE");
  });

  test("rejects extraction when a pricing matrix references an external selection", () => {
    const result = extractOptionGroupTemplateTree({
      ...tree,
      pricingMatrix: {
        id: "matrix_external",
        dimensions: ["lamination", "outside_key"],
        rows: [{ id: "row_external", when: { lamination: "matte", outside_key: "x" }, variables: { fee: 100 } }],
      },
    }, "group_finish");

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.map((error) => error.code)).toContain("EXTERNAL_MATRIX_REFERENCE");
  });

  test("rejects extraction when a runtime edge crosses to an external option", () => {
    const result = extractOptionGroupTemplateTree({
      ...tree,
      edges: [
        ...tree.edges,
        { id: "edge_external_option", fromNodeId: "opt_lamination", toNodeId: "outside_option", status: "ENABLED", condition: { op: "EXISTS", value: { op: "literal", value: true } } },
      ],
    }, "group_finish");

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.map((error) => error.code)).toContain("EXTERNAL_EDGE_REFERENCE");
  });

  test("clones into a minimal tree with regenerated ids and selection keys", () => {
    const extracted = extractOptionGroupTemplateTree(tree, "group_finish");
    expect(extracted.ok).toBe(true);
    if (!extracted.ok) return;

    const cloned = cloneTemplateIntoTree({ schemaVersion: 2, status: "DRAFT", nodes: {}, edges: [], rootNodeIds: [] }, extracted.templateTree, {
      importInstanceId: "case_a",
    });
    expect(cloned.ok).toBe(true);
    if (!cloned.ok) return;

    expect(cloned.importedGroupId).toBe("tpl_case_a_group_finish");
    expect(Object.values(cloned.idMap)).not.toContain("group_finish");
    expect(cloned.selectionKeyMap.lamination).toBe("lamination__case_a");
    expect(Object.keys(cloned.tree.nodes)).toContain("tpl_case_a_opt_lamination");
    expect(cloned.tree.rootNodeIds).toContain("tpl_case_a_opt_lamination");
  });

  test("rewrites rule, matrix, edge, and nested nodeOutputRef references after clone", () => {
    const extracted = extractOptionGroupTemplateTree(tree, "group_finish");
    expect(extracted.ok).toBe(true);
    if (!extracted.ok) return;

    const cloned = cloneTemplateIntoTree({ schemaVersion: 2, status: "DRAFT", nodes: {}, edges: [] }, extracted.templateTree, {
      importInstanceId: "case_b",
    });
    expect(cloned.ok).toBe(true);
    if (!cloned.ok) return;

    const rule = cloned.tree.rules[0];
    expect(rule.id).toBe("rule_case_b_rule_finish");
    expect(rule.when.all[0].optionGroup).toBe("lamination__case_b");
    expect(rule.then[0].targetOptionGroup).toBe("contour_cutting__case_b");

    const matrix = cloned.tree.pricingMatrix;
    expect(matrix.dimensions).toEqual(["lamination__case_b", "contour_cutting__case_b"]);
    expect(matrix.rows[0].id).toBe("matrix_row_case_b_row_matte_cut");
    expect(matrix.rows[0].when).toEqual({ lamination__case_b: "matte", contour_cutting__case_b: "yes" });

    const option = cloned.tree.nodes.tpl_case_b_opt_lamination;
    expect(option.type).toBe("INPUT");
    expect(option.key).toBe("lamination__case_b");
    expect(option.input.valueType).toBe("ENUM");
    expect(option.pricingImpact[0].nodeOutputRef.nodeId).toBe("tpl_case_b_calc_finish");
    expect(cloned.tree.edges.some((edge: any) => edge.fromNodeId === "tpl_case_b_opt_lamination" && edge.toNodeId === "tpl_case_b_calc_finish")).toBe(true);
  });

  test("imports the same template twice without collisions", () => {
    const extracted = extractOptionGroupTemplateTree(tree, "group_finish");
    expect(extracted.ok).toBe(true);
    if (!extracted.ok) return;

    const first = cloneTemplateIntoTree({ schemaVersion: 2, status: "DRAFT", nodes: {}, edges: [] }, extracted.templateTree, { importInstanceId: "dup" });
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    const second = cloneTemplateIntoTree(first.tree, extracted.templateTree, { importInstanceId: "dup" });
    expect(second.ok).toBe(true);
    if (!second.ok) return;

    const nodeIds = Object.keys(second.tree.nodes);
    expect(new Set(nodeIds).size).toBe(nodeIds.length);
    expect(nodeIds).toContain("tpl_dup_group_finish");
    expect(nodeIds).toContain("tpl_dup_group_finish_2");
    expect(Object.values(second.selectionKeyMap)).toContain("lamination__dup_2");
  });

  test("stores incompatible imported matrix fragments under inert meta without publish errors", () => {
    const matrixOnlyTree = {
      ...tree,
      nodes: {
        ...tree.nodes,
        opt_lamination: {
          ...tree.nodes.opt_lamination,
          pricingImpact: [],
        },
      },
      edges: tree.edges.filter((edge) => edge.id !== "edge_lam_calc"),
    };
    delete (matrixOnlyTree.nodes as any).calc_finish;

    const extracted = extractOptionGroupTemplateTree(matrixOnlyTree, "group_finish");
    expect(extracted.ok).toBe(true);
    if (!extracted.ok) return;

    const currentTree = {
      schemaVersion: 2,
      status: "DRAFT",
      rootNodeIds: ["thickness", "sides"],
      nodes: {
        thickness: {
          id: "thickness",
          type: "INPUT",
          status: "ENABLED",
          key: "thickness",
          input: { selectionKey: "thickness", valueType: "ENUM" },
          choices: [{ value: "3mm", label: "3mm" }],
        },
        sides: {
          id: "sides",
          type: "INPUT",
          status: "ENABLED",
          key: "sides",
          input: { selectionKey: "sides", valueType: "ENUM" },
          choices: [{ value: "single", label: "Single" }],
        },
      },
      edges: [],
      meta: {
        baseWeightOz: 1,
        pricingV2: { base: { perSqftCents: 100 } },
      },
      pricingMatrix: {
        dimensions: ["thickness", "sides"],
        rows: [{ id: "base_row", match: { thickness: "3mm", sides: "single" }, variables: { base_price: 100 } }],
      },
    };

    const cloned = cloneTemplateIntoTree(currentTree, extracted.templateTree, { importInstanceId: "fragment" });
    expect(cloned.ok).toBe(true);
    if (!cloned.ok) return;

    expect(cloned.tree.pricingMatrix.dimensions).toEqual(["thickness", "sides"]);
    expect(cloned.tree.meta.templatePricingMatrixFragments).toHaveLength(1);
    expect(validateTreeForPublish(cloned.tree, DEFAULT_VALIDATE_OPTS).errors).toEqual([]);
  });

  test("deterministic clone output is stable for a supplied importInstanceId", () => {
    const extracted = extractOptionGroupTemplateTree(tree, "group_finish");
    expect(extracted.ok).toBe(true);
    if (!extracted.ok) return;

    const a = cloneTemplateIntoTree({ schemaVersion: 2, status: "DRAFT", nodes: {}, edges: [] }, extracted.templateTree, { importInstanceId: "stable" });
    const b = cloneTemplateIntoTree({ schemaVersion: 2, status: "DRAFT", nodes: {}, edges: [] }, extracted.templateTree, { importInstanceId: "stable" });
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    expect(a.tree).toEqual(b.tree);
  });

  test("editing cloned output does not mutate the source template object", () => {
    const extracted = extractOptionGroupTemplateTree(tree, "group_finish");
    expect(extracted.ok).toBe(true);
    if (!extracted.ok) return;

    const sourceTemplate = extracted.templateTree;
    const cloned = cloneTemplateIntoTree({ schemaVersion: 2, status: "DRAFT", nodes: {}, edges: [] }, sourceTemplate, { importInstanceId: "immutable" });
    expect(cloned.ok).toBe(true);
    if (!cloned.ok) return;

    cloned.tree.nodes.tpl_immutable_opt_lamination.input.choices[0].label = "Changed";
    expect(sourceTemplate.nodes.opt_lamination.input.choices[0].label).toBe("None");
  });
});
