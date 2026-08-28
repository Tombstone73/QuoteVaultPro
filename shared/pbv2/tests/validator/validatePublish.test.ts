import { describe, test, expect } from "@jest/globals";
import { validateTreeForPublish } from "../../validator/validatePublish";
import { DEFAULT_VALIDATE_OPTS } from "../../validator/types";

describe("pbv2/validator/validatePublish", () => {
  const makeMaterialOverrideTree = (choicePatch: Record<string, unknown> = {}) => ({
    status: "DRAFT",
    rootNodeIds: ["material"],
    nodes: [
      {
        id: "material",
        type: "INPUT",
        status: "ENABLED",
        key: "material",
        input: { selectionKey: "material", valueType: "TEXT" },
        choices: [
          {
            value: "acm",
            label: "ACM",
            inventoryConsumption: [{ materialId: "mat_a", quantityBasis: "fixed", fixedQty: 1 }],
            ...choicePatch,
          },
        ],
      },
    ],
    edges: [],
  });

  test("canonical zero-option trees publish without runtime roots", () => {
    const tree = {
      schemaVersion: 2,
      status: "DRAFT",
      rootNodeIds: [],
      nodes: {},
      edges: [],
    };

    const result = validateTreeForPublish(tree as any, DEFAULT_VALIDATE_OPTS);
    expect(result.errors).toEqual([]);
  });

  test("non-empty trees without roots remain invalid", () => {
    const tree = {
      status: "DRAFT",
      rootNodeIds: [],
      nodes: [{ id: "input", type: "INPUT", status: "ENABLED", key: "input", input: { selectionKey: "input", valueType: "TEXT" } }],
      edges: [],
    };

    const result = validateTreeForPublish(tree as any, DEFAULT_VALIDATE_OPTS);
    expect(result.errors.some((f) => f.code === "PBV2_E_TREE_NO_ROOTS")).toBe(true);
  });

  test("Root referencing GROUP => ERROR", () => {
    const tree = {
      status: "DRAFT",
      rootNodeIds: ["g1"],
      nodes: [{ id: "g1", type: "GROUP", status: "ENABLED", key: "group" }],
      edges: [],
    };

    const result = validateTreeForPublish(tree as any, DEFAULT_VALIDATE_OPTS);
    expect(result.errors.some((f) => f.code === "PBV2_E_TREE_ROOT_INVALID")).toBe(true);
  });

  test("ENABLED edge => DELETED node => ERROR", () => {
    const tree = {
      status: "DRAFT",
      rootNodeIds: ["n1"],
      nodes: [
        { id: "n1", type: "INPUT", status: "ENABLED", key: "root", input: { selectionKey: "root", valueType: "BOOLEAN" } },
        { id: "n2", type: "INPUT", status: "DELETED", key: "dead", input: { selectionKey: "dead", valueType: "BOOLEAN" } },
      ],
      edges: [{ id: "e1", status: "ENABLED", fromNodeId: "n1", toNodeId: "n2", priority: 0 }],
    };

    const result = validateTreeForPublish(tree as any, DEFAULT_VALIDATE_OPTS);
    expect(result.errors.some((f) => f.code === "PBV2_E_EDGE_STATUS_INVALID")).toBe(true);
  });

  test("Compute dependency cycle => ERROR", () => {
    const tree = {
      status: "DRAFT",
      rootNodeIds: ["n1"],
      nodes: [
        { id: "n1", type: "INPUT", status: "ENABLED", key: "root", input: { selectionKey: "root", valueType: "BOOLEAN" } },
        {
          id: "c1",
          type: "COMPUTE",
          status: "ENABLED",
          key: "c1",
          compute: {
            outputs: { out: { type: "NUMBER" } },
            expression: { op: "ref", ref: { kind: "nodeOutputRef", nodeId: "c2", outputKey: "out" } },
          },
        },
        {
          id: "c2",
          type: "COMPUTE",
          status: "ENABLED",
          key: "c2",
          compute: {
            outputs: { out: { type: "NUMBER" } },
            expression: { op: "ref", ref: { kind: "nodeOutputRef", nodeId: "c1", outputKey: "out" } },
          },
        },
      ],
      edges: [],
    };

    const result = validateTreeForPublish(tree as any, DEFAULT_VALIDATE_OPTS);
    expect(result.errors.some((f) => f.code === "PBV2_E_EXPR_COMPUTE_DEP_CYCLE")).toBe(true);
  });

  test("Required INPUT unreachable via UNSAT condition => ERROR", () => {
    const unsatCondition = {
      op: "AND",
      args: [
        {
          op: "EQ",
          left: { op: "ref", ref: { kind: "selectionRef", selectionKey: "x" } },
          right: { op: "literal", value: "A" },
        },
        {
          op: "EQ",
          left: { op: "ref", ref: { kind: "selectionRef", selectionKey: "x" } },
          right: { op: "literal", value: "B" },
        },
      ],
    };

    const tree = {
      status: "DRAFT",
      rootNodeIds: ["root"],
      nodes: [
        { id: "root", type: "INPUT", status: "ENABLED", key: "root", input: { selectionKey: "root", valueType: "BOOLEAN" } },
        { id: "x", type: "INPUT", status: "ENABLED", key: "x", input: { selectionKey: "x", valueType: "TEXT" } },
        {
          id: "req",
          type: "INPUT",
          status: "ENABLED",
          key: "req",
          input: { selectionKey: "req", valueType: "TEXT", constraints: { required: true } },
        },
      ],
      edges: [{ id: "e_req", status: "ENABLED", fromNodeId: "root", toNodeId: "req", priority: 0, condition: unsatCondition }],
    };

    const result = validateTreeForPublish(tree as any, DEFAULT_VALIDATE_OPTS);
    expect(result.errors.some((f) => f.code === "PBV2_E_REQUIRED_INPUT_UNREACHABLE")).toBe(true);
  });

  test("Ambiguous edges => WARNING when ambiguousEdgesStrict=false", () => {
    const tree = {
      status: "DRAFT",
      rootNodeIds: ["root"],
      nodes: [
        { id: "root", type: "INPUT", status: "ENABLED", key: "root", input: { selectionKey: "root", valueType: "BOOLEAN" } },
        { id: "a", type: "INPUT", status: "ENABLED", key: "a", input: { selectionKey: "a", valueType: "BOOLEAN" } },
        { id: "b", type: "INPUT", status: "ENABLED", key: "b", input: { selectionKey: "b", valueType: "BOOLEAN" } },
      ],
      edges: [
        { id: "e1", status: "ENABLED", fromNodeId: "root", toNodeId: "a", priority: 0 },
        { id: "e2", status: "ENABLED", fromNodeId: "root", toNodeId: "b", priority: 0 },
      ],
    };

    const result = validateTreeForPublish(tree as any, { ...DEFAULT_VALIDATE_OPTS, ambiguousEdgesStrict: false });
    expect(result.warnings.some((f) => f.code === "PBV2_W_EDGE_AMBIGUOUS_MATCH")).toBe(true);
  });

  test.each([
    ["undefined", {}],
    ["null", { materialOverride: null }],
    ["empty object", { materialOverride: {} }],
    ["empty materialId", { materialOverride: { materialId: "" } }],
  ])("empty material override state does not trigger conflict validation: %s", (_label, choicePatch) => {
    const result = validateTreeForPublish(makeMaterialOverrideTree(choicePatch) as any, DEFAULT_VALIDATE_OPTS);

    expect(result.errors.some((f) => f.code === "PBV2_E_CHOICE_OVERRIDE_INVALID")).toBe(false);
    expect(result.errors.some((f) => f.code === "PBV2_E_CHOICE_MATERIAL_OVERRIDE_CONFLICT")).toBe(false);
  });

  test("explicit conflicting material override still triggers conflict validation", () => {
    const result = validateTreeForPublish(
      makeMaterialOverrideTree({ materialOverride: { materialId: "mat_b" } }) as any,
      DEFAULT_VALIDATE_OPTS
    );

    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "PBV2_E_CHOICE_MATERIAL_OVERRIDE_CONFLICT",
        }),
      ])
    );
  });

  test("matching material override and inventory consumption are compatible", () => {
    const result = validateTreeForPublish(
      makeMaterialOverrideTree({ materialOverride: { materialId: "mat_a" } }) as any,
      DEFAULT_VALIDATE_OPTS
    );

    expect(result.errors.some((f) => f.code === "PBV2_E_CHOICE_MATERIAL_OVERRIDE_CONFLICT")).toBe(false);
  });

  test("reports one conflict per affected choice with stable contextual detail", () => {
    const tree = makeMaterialOverrideTree({ materialOverride: { materialId: "mat_b" } });
    tree.nodes[0].label = "Thickness";
    tree.nodes[0].choices.push({
      value: "3mm",
      label: "3mm",
      materialOverride: { materialId: "mat_c" },
      inventoryConsumption: [{ materialId: "mat_d", quantityBasis: "fixed", fixedQty: 1 }],
    });

    const conflicts = validateTreeForPublish(tree as any, DEFAULT_VALIDATE_OPTS).errors
      .filter((finding) => finding.code === "PBV2_E_CHOICE_MATERIAL_OVERRIDE_CONFLICT");

    expect(conflicts).toHaveLength(2);
    expect(conflicts).toEqual(expect.arrayContaining([
      expect.objectContaining({
        context: expect.objectContaining({ optionGroupLabel: "Thickness", choiceLabel: "ACM", materialOverrideId: "mat_b", conflictingInventoryMaterialIds: ["mat_a"] }),
      }),
      expect.objectContaining({
        context: expect.objectContaining({ optionGroupLabel: "Thickness", choiceLabel: "3mm", materialOverrideId: "mat_c", conflictingInventoryMaterialIds: ["mat_d"] }),
      }),
    ]));
  });

  test("Ambiguous edges => ERROR when ambiguousEdgesStrict=true", () => {
    const tree = {
      status: "DRAFT",
      rootNodeIds: ["root"],
      nodes: [
        { id: "root", type: "INPUT", status: "ENABLED", key: "root", input: { selectionKey: "root", valueType: "BOOLEAN" } },
        { id: "a", type: "INPUT", status: "ENABLED", key: "a", input: { selectionKey: "a", valueType: "BOOLEAN" } },
        { id: "b", type: "INPUT", status: "ENABLED", key: "b", input: { selectionKey: "b", valueType: "BOOLEAN" } },
      ],
      edges: [
        { id: "e1", status: "ENABLED", fromNodeId: "root", toNodeId: "a", priority: 0 },
        { id: "e2", status: "ENABLED", fromNodeId: "root", toNodeId: "b", priority: 0 },
      ],
    };

    const result = validateTreeForPublish(tree as any, { ...DEFAULT_VALIDATE_OPTS, ambiguousEdgesStrict: true });
    expect(result.errors.some((f) => f.code === "PBV2_W_EDGE_AMBIGUOUS_MATCH")).toBe(true);
  });

  test("Visibility cycle => WARNING", () => {
    const tree = {
      status: "DRAFT",
      rootNodeIds: ["material"],
      nodes: [
        {
          id: "material",
          type: "INPUT",
          status: "ENABLED",
          key: "material",
          input: { selectionKey: "materialFamily", valueType: "TEXT" },
          visibility: { rules: [{ type: "equals", selectionKey: "printSides", value: "double" }] },
        },
        {
          id: "print",
          type: "GROUP",
          status: "ENABLED",
          key: "print",
          visibility: { rules: [{ type: "equals", selectionKey: "materialFamily", value: "ACM" }] },
        },
        {
          id: "printSides",
          type: "INPUT",
          status: "ENABLED",
          key: "printSides",
          input: { selectionKey: "printSides", valueType: "TEXT" },
        },
      ],
      edges: [{ id: "e1", status: "DISABLED", fromNodeId: "print", toNodeId: "printSides", priority: 0 }],
    };

    const result = validateTreeForPublish(tree as any, DEFAULT_VALIDATE_OPTS);
    expect(result.warnings.some((f) => f.code === "PBV2_W_VISIBILITY_DEP_CYCLE")).toBe(true);
  });

  test("Group visibility referencing its own child selection => WARNING", () => {
    const tree = {
      status: "DRAFT",
      rootNodeIds: ["material"],
      nodes: [
        {
          id: "material",
          type: "INPUT",
          status: "ENABLED",
          key: "material",
          input: { selectionKey: "materialFamily", valueType: "TEXT" },
        },
        {
          id: "print",
          type: "GROUP",
          status: "ENABLED",
          key: "print",
          visibility: { rules: [{ type: "equals", selectionKey: "printSides", value: "double" }] },
        },
        {
          id: "printSides",
          type: "INPUT",
          status: "ENABLED",
          key: "printSides",
          input: { selectionKey: "printSides", valueType: "TEXT" },
        },
      ],
      edges: [{ id: "e1", status: "DISABLED", fromNodeId: "print", toNodeId: "printSides", priority: 0 }],
    };

    const result = validateTreeForPublish(tree as any, DEFAULT_VALIDATE_OPTS);
    expect(result.warnings.some((f) => f.code === "PBV2_W_VISIBILITY_GROUP_SELF_GATE")).toBe(true);
    expect(result.warnings.some((f) => f.code === "PBV2_W_GROUP_VISIBILITY_UNREACHABLE")).toBe(true);
  });

  test("MaterialEffect qtyRef unresolved => ERROR", () => {
    const tree = {
      status: "DRAFT",
      rootNodeIds: ["root"],
      nodes: [
        { id: "root", type: "INPUT", status: "ENABLED", key: "root", input: { selectionKey: "root", valueType: "BOOLEAN" } },
        {
          id: "p1",
          type: "PRICE",
          status: "ENABLED",
          key: "p1",
          price: {
            components: [],
            materialEffects: [
              {
                skuRef: "SKU_X",
                uom: "ea",
                qtyRef: { op: "ref", ref: { kind: "selectionRef", selectionKey: "nope" } },
              },
            ],
          },
        },
      ],
      edges: [],
    };

    const result = validateTreeForPublish(tree as any, DEFAULT_VALIDATE_OPTS);
    expect(result.errors.some((f) => f.code === "PBV2_E_EXPR_REF_UNRESOLVED")).toBe(true);
  });

  test("MaterialEffect negative qtyRef => ERROR", () => {
    const tree = {
      status: "DRAFT",
      rootNodeIds: ["root"],
      nodes: [
        { id: "root", type: "INPUT", status: "ENABLED", key: "root", input: { selectionKey: "root", valueType: "BOOLEAN" } },
        {
          id: "p1",
          type: "PRICE",
          status: "ENABLED",
          key: "p1",
          price: {
            components: [],
            materialEffects: [
              {
                skuRef: "SKU_X",
                uom: "ea",
                qtyRef: { op: "literal", value: -1 },
              },
            ],
          },
        },
      ],
      edges: [],
    };

    const result = validateTreeForPublish(tree as any, DEFAULT_VALIDATE_OPTS);
    expect(result.errors.some((f) => f.code === "PBV2_E_MATERIAL_NEGATIVE_QUANTITY")).toBe(true);
  });

  test("Negative base weight => ERROR", () => {
    const tree = {
      status: "DRAFT",
      rootNodeIds: ["root"],
      nodes: [
        { id: "root", type: "INPUT", status: "ENABLED", key: "root", input: { selectionKey: "root", valueType: "BOOLEAN" } },
      ],
      edges: [],
      meta: {
        baseWeightOz: -5,
      },
    };

    const result = validateTreeForPublish(tree as any, DEFAULT_VALIDATE_OPTS);
    expect(result.errors.some((f) => f.code === "PBV2_E_WEIGHT_NEGATIVE")).toBe(true);
  });

  test("Negative weightImpact oz => ERROR", () => {
    const tree = {
      status: "DRAFT",
      rootNodeIds: ["root"],
      nodes: [
        {
          id: "root",
          type: "INPUT",
          status: "ENABLED",
          key: "root",
          label: "Test Option",
          input: { selectionKey: "root", valueType: "BOOLEAN" },
          weightImpact: [
            { mode: "addFlat", oz: -2.5 },
          ],
        },
      ],
      edges: [],
    };

    const result = validateTreeForPublish(tree as any, DEFAULT_VALIDATE_OPTS);
    expect(result.errors.some((f) => f.code === "PBV2_E_WEIGHT_NEGATIVE")).toBe(true);
  });

  test("Negative choice weightOz => ERROR", () => {
    const tree = {
      status: "DRAFT",
      rootNodeIds: ["root"],
      nodes: [
        {
          id: "root",
          type: "INPUT",
          status: "ENABLED",
          key: "root",
          label: "Material",
          input: { selectionKey: "root", valueType: "ENUM" },
          choices: [
            { value: "light", label: "Light", weightOz: 2 },
            { value: "heavy", label: "Heavy", weightOz: -10 },
          ],
        },
      ],
      edges: [],
    };

    const result = validateTreeForPublish(tree as any, DEFAULT_VALIDATE_OPTS);
    expect(result.errors.some((f) => f.code === "PBV2_E_WEIGHT_NEGATIVE")).toBe(true);
  });

  test("Missing weight everywhere => WARNING", () => {
    const tree = {
      status: "DRAFT",
      rootNodeIds: ["root"],
      nodes: [
        { id: "root", type: "INPUT", status: "ENABLED", key: "root", input: { selectionKey: "root", valueType: "BOOLEAN" } },
      ],
      edges: [],
    };

    const result = validateTreeForPublish(tree as any, DEFAULT_VALIDATE_OPTS);
    expect(result.warnings.some((f) => f.code === "PBV2_W_WEIGHT_MISSING")).toBe(true);
  });

  test("Base weight zero => WARNING (treated as missing)", () => {
    const tree = {
      status: "DRAFT",
      rootNodeIds: ["root"],
      nodes: [
        { id: "root", type: "INPUT", status: "ENABLED", key: "root", input: { selectionKey: "root", valueType: "BOOLEAN" } },
      ],
      edges: [],
      meta: {
        baseWeightOz: 0,
      },
    };

    const result = validateTreeForPublish(tree as any, DEFAULT_VALIDATE_OPTS);
    expect(result.warnings.some((f) => f.code === "PBV2_W_WEIGHT_MISSING")).toBe(true);
  });

  test("Product with positive base weight => no missing weight warning", () => {
    const tree = {
      status: "DRAFT",
      rootNodeIds: ["root"],
      nodes: [
        { id: "root", type: "INPUT", status: "ENABLED", key: "root", input: { selectionKey: "root", valueType: "BOOLEAN" } },
      ],
      edges: [],
      meta: {
        baseWeightOz: 10,
      },
    };

    const result = validateTreeForPublish(tree as any, DEFAULT_VALIDATE_OPTS);
    expect(result.warnings.some((f) => f.code === "PBV2_W_WEIGHT_MISSING")).toBe(false);
  });

  test("Product with weightImpact => no missing weight warning", () => {
    const tree = {
      status: "DRAFT",
      rootNodeIds: ["root"],
      nodes: [
        {
          id: "root",
          type: "INPUT",
          status: "ENABLED",
          key: "root",
          input: { selectionKey: "root", valueType: "BOOLEAN" },
          weightImpact: [
            { mode: "addPerQty", oz: 0.5 },
          ],
        },
      ],
      edges: [],
    };

    const result = validateTreeForPublish(tree as any, DEFAULT_VALIDATE_OPTS);
    expect(result.warnings.some((f) => f.code === "PBV2_W_WEIGHT_MISSING")).toBe(false);
  });

  test("Product with choice weightOz => no missing weight warning", () => {
    const tree = {
      status: "DRAFT",
      rootNodeIds: ["root"],
      nodes: [
        {
          id: "root",
          type: "INPUT",
          status: "ENABLED",
          key: "root",
          input: { selectionKey: "root", valueType: "ENUM" },
          choices: [
            { value: "light", label: "Light", weightOz: 2 },
          ],
        },
      ],
      edges: [],
    };

    const result = validateTreeForPublish(tree as any, DEFAULT_VALIDATE_OPTS);
    expect(result.warnings.some((f) => f.code === "PBV2_W_WEIGHT_MISSING")).toBe(false);
  });

  // --- shippingConfig.baseWeight tests ---

  const baseNode = {
    id: "root",
    type: "INPUT",
    status: "ENABLED",
    key: "root",
    input: { selectionKey: "root", valueType: "BOOLEAN" },
  };

  test("shippingConfig.baseWeight = 0.9 oz => no missing weight warning", () => {
    const tree = {
      status: "DRAFT",
      rootNodeIds: ["root"],
      nodes: [baseNode],
      edges: [],
      meta: {
        shippingConfig: { baseWeight: 0.9, weightUnit: "oz", weightBasis: "per_sqft" },
      },
    };

    const result = validateTreeForPublish(tree as any, DEFAULT_VALIDATE_OPTS);
    expect(result.warnings.some((f) => f.code === "PBV2_W_WEIGHT_MISSING")).toBe(false);
  });

  test("shippingConfig.baseWeight string '0.9' parses correctly => no missing weight warning", () => {
    const tree = {
      status: "DRAFT",
      rootNodeIds: ["root"],
      nodes: [baseNode],
      edges: [],
      meta: {
        shippingConfig: { baseWeight: "0.9", weightUnit: "oz" },
      },
    };

    const result = validateTreeForPublish(tree as any, DEFAULT_VALIDATE_OPTS);
    expect(result.warnings.some((f) => f.code === "PBV2_W_WEIGHT_MISSING")).toBe(false);
  });

  test("shippingConfig.baseWeight = 0 => missing weight warning (zero treated as absent)", () => {
    const tree = {
      status: "DRAFT",
      rootNodeIds: ["root"],
      nodes: [baseNode],
      edges: [],
      meta: {
        shippingConfig: { baseWeight: 0, weightUnit: "oz" },
      },
    };

    const result = validateTreeForPublish(tree as any, DEFAULT_VALIDATE_OPTS);
    expect(result.warnings.some((f) => f.code === "PBV2_W_WEIGHT_MISSING")).toBe(true);
  });

  test("shippingConfig.baseWeight = null => missing weight warning", () => {
    const tree = {
      status: "DRAFT",
      rootNodeIds: ["root"],
      nodes: [baseNode],
      edges: [],
      meta: {
        shippingConfig: { baseWeight: null, weightUnit: "oz" },
      },
    };

    const result = validateTreeForPublish(tree as any, DEFAULT_VALIDATE_OPTS);
    expect(result.warnings.some((f) => f.code === "PBV2_W_WEIGHT_MISSING")).toBe(true);
  });

  test("shippingConfig.baseWeight = undefined => missing weight warning", () => {
    const tree = {
      status: "DRAFT",
      rootNodeIds: ["root"],
      nodes: [baseNode],
      edges: [],
      meta: {
        shippingConfig: { weightUnit: "oz" },
      },
    };

    const result = validateTreeForPublish(tree as any, DEFAULT_VALIDATE_OPTS);
    expect(result.warnings.some((f) => f.code === "PBV2_W_WEIGHT_MISSING")).toBe(true);
  });

  test("shippingConfig.baseWeight empty string => missing weight warning", () => {
    const tree = {
      status: "DRAFT",
      rootNodeIds: ["root"],
      nodes: [baseNode],
      edges: [],
      meta: {
        shippingConfig: { baseWeight: "", weightUnit: "oz" },
      },
    };

    const result = validateTreeForPublish(tree as any, DEFAULT_VALIDATE_OPTS);
    expect(result.warnings.some((f) => f.code === "PBV2_W_WEIGHT_MISSING")).toBe(true);
  });

  test("shippingConfig.baseWeight in lbs (0.5 lb) => no missing weight warning", () => {
    const tree = {
      status: "DRAFT",
      rootNodeIds: ["root"],
      nodes: [baseNode],
      edges: [],
      meta: {
        shippingConfig: { baseWeight: 0.5, weightUnit: "lb" },
      },
    };

    const result = validateTreeForPublish(tree as any, DEFAULT_VALIDATE_OPTS);
    expect(result.warnings.some((f) => f.code === "PBV2_W_WEIGHT_MISSING")).toBe(false);
  });

  test("meta.baseWeightOz overrides missing shippingConfig.baseWeight => no missing weight warning", () => {
    const tree = {
      status: "DRAFT",
      rootNodeIds: ["root"],
      nodes: [baseNode],
      edges: [],
      meta: {
        baseWeightOz: 4,
        shippingConfig: {},
      },
    };

    const result = validateTreeForPublish(tree as any, DEFAULT_VALIDATE_OPTS);
    expect(result.warnings.some((f) => f.code === "PBV2_W_WEIGHT_MISSING")).toBe(false);
  });

  test("shippingConfig.baseWeight negative value => negative weight error", () => {
    const tree = {
      status: "DRAFT",
      rootNodeIds: ["root"],
      nodes: [baseNode],
      edges: [],
      meta: {
        shippingConfig: { baseWeight: -1, weightUnit: "oz" },
      },
    };

    const result = validateTreeForPublish(tree as any, DEFAULT_VALIDATE_OPTS);
    expect(result.errors.some((f) => f.code === "PBV2_E_WEIGHT_NEGATIVE")).toBe(true);
  });
});

describe("pbv2/validator/validatePublish — text input type", () => {
  test("text input node without choices passes validation without errors", () => {
    const tree = {
      status: "DRAFT",
      rootNodeIds: ["imprint"],
      nodes: [
        {
          id: "imprint",
          type: "INPUT",
          status: "ENABLED",
          key: "imprint",
          input: { selectionKey: "imprint", type: "text" },
        },
      ],
      edges: [],
    };

    const result = validateTreeForPublish(tree as any, DEFAULT_VALIDATE_OPTS);
    expect(result.errors.length).toBe(0);
  });

  test("required text input node without choices passes validation without errors", () => {
    const tree = {
      status: "DRAFT",
      rootNodeIds: ["imprint"],
      nodes: [
        {
          id: "imprint",
          type: "INPUT",
          status: "ENABLED",
          key: "imprint",
          input: { selectionKey: "imprint", type: "text", required: true },
        },
      ],
      edges: [],
    };

    const result = validateTreeForPublish(tree as any, DEFAULT_VALIDATE_OPTS);
    expect(result.errors.length).toBe(0);
  });
});

describe("pbv2/validator/validatePublish — fee formula variables", () => {
  test("flatFee option formula requires a configured flat fee variable", () => {
    const tree = {
      status: "DRAFT",
      rootNodeIds: ["rush_fee"],
      nodes: [
        {
          id: "rush_fee",
          type: "INPUT",
          status: "ENABLED",
          key: "rush_fee",
          label: "Rush Fee",
          input: { selectionKey: "rush_fee", type: "select" },
          choices: [
            {
              value: "rush",
              label: "Yes",
              pricingImpact: [{ mode: "addFormula", formula: "flatFee" }],
            },
          ],
        },
      ],
      edges: [],
      meta: {
        pricingProfileKey: "fee",
        pricingFormula: "flatFee",
      },
    };

    const result = validateTreeForPublish(tree as any, DEFAULT_VALIDATE_OPTS);

    expect(result.errors.some((finding) => finding.code === "PBV2_E_FORMULA_FLAT_FEE_MISSING")).toBe(true);
  });

  test("flatFee option formula passes when flat fee variable is configured", () => {
    const tree = {
      status: "DRAFT",
      rootNodeIds: ["rush_fee"],
      nodes: [
        {
          id: "rush_fee",
          type: "INPUT",
          status: "ENABLED",
          key: "rush_fee",
          label: "Rush Fee",
          input: { selectionKey: "rush_fee", type: "select" },
          choices: [
            {
              value: "rush",
              label: "Yes",
              pricingImpact: [{ mode: "addFormula", formula: "flatFee" }],
            },
          ],
        },
      ],
      edges: [],
      meta: {
        pricingProfileKey: "fee",
        pricingFormula: "flatFee",
        formulaVariables: { flatFee: 25 },
      },
    };

    const result = validateTreeForPublish(tree as any, DEFAULT_VALIDATE_OPTS);

    expect(result.errors.some((finding) => finding.code === "PBV2_E_FORMULA_FLAT_FEE_MISSING")).toBe(false);
  });
});
