import { describe, test, expect } from "@jest/globals";
import { validateTreeForRestore } from "../../validator/validateRestore";
import { DEFAULT_VALIDATE_OPTS } from "../../validator/types";

describe("pbv2/validator/validateRestore", () => {
  test("Restore allowed only in DRAFT => ERROR", () => {
    const tree = {
      status: "ACTIVE",
      rootNodeIds: ["n1"],
      nodes: [{ id: "n1", type: "INPUT", status: "ENABLED", key: "n1", input: { selectionKey: "n1", valueType: "BOOLEAN" } }],
      edges: [],
    };

    const result = validateTreeForRestore(tree as any, { restoredNodeIds: ["n1"] }, DEFAULT_VALIDATE_OPTS);
    expect(result.errors.some((f) => f.code === "PBV2_E_RESTORE_NOT_IN_DRAFT")).toBe(true);
  });

  test("key collision on restore => ERROR", () => {
    const tree = {
      status: "DRAFT",
      rootNodeIds: ["a"],
      nodes: [
        { id: "a", type: "INPUT", status: "ENABLED", key: "k", input: { selectionKey: "a", valueType: "BOOLEAN" } },
        { id: "b", type: "INPUT", status: "DELETED", key: "k", input: { selectionKey: "b", valueType: "BOOLEAN" } },
      ],
      edges: [],
    };

    const result = validateTreeForRestore(tree as any, { restoredNodeIds: ["b"] }, DEFAULT_VALIDATE_OPTS);
    expect(result.errors.some((f) => f.code === "PBV2_E_RESTORE_KEY_COLLISION")).toBe(true);
  });

  test("ENABLED edge pointing to DELETED endpoint after restore => ERROR", () => {
    const tree = {
      status: "DRAFT",
      rootNodeIds: ["n1"],
      nodes: [
        { id: "n1", type: "INPUT", status: "ENABLED", key: "n1", input: { selectionKey: "n1", valueType: "BOOLEAN" } },
        { id: "n2", type: "INPUT", status: "DELETED", key: "n2", input: { selectionKey: "n2", valueType: "BOOLEAN" } },
      ],
      edges: [{ id: "e1", status: "ENABLED", fromNodeId: "n1", toNodeId: "n2", priority: 0 }],
    };

    const result = validateTreeForRestore(tree as any, { restoredNodeIds: [] }, DEFAULT_VALIDATE_OPTS);
    expect(result.errors.some((f) => f.code === "PBV2_E_RESTORE_EDGE_TO_DELETED")).toBe(true);
  });

  test("Restoring DELETED edge to DELETED endpoint => ERROR", () => {
    const tree = {
      status: "DRAFT",
      rootNodeIds: ["n1"],
      nodes: [
        { id: "n1", type: "INPUT", status: "ENABLED", key: "n1", input: { selectionKey: "n1", valueType: "BOOLEAN" } },
        { id: "n2", type: "INPUT", status: "DELETED", key: "n2", input: { selectionKey: "n2", valueType: "BOOLEAN" } },
      ],
      edges: [{ id: "e1", status: "DELETED", fromNodeId: "n1", toNodeId: "n2", priority: 0 }],
    };

    const result = validateTreeForRestore(tree as any, { restoredEdgeIds: ["e1"] }, DEFAULT_VALIDATE_OPTS);
    expect(result.errors.some((f) => f.code === "PBV2_E_RESTORE_EDGE_TO_DELETED")).toBe(true);
  });
});
