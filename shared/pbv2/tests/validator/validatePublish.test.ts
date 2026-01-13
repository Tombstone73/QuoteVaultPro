import { describe, test, expect } from "@jest/globals";
import { validateTreeForPublish } from "../../validator/validatePublish";
import { DEFAULT_VALIDATE_OPTS } from "../../validator/types";

describe("pbv2/validator/validatePublish", () => {
  test("Missing roots => ERROR", () => {
    const tree = {
      status: "DRAFT",
      rootNodeIds: [],
      nodes: [],
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
});
