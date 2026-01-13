import { describe, test, expect } from "@jest/globals";
import { buildSymbolTable } from "../symbolTable";
import { resolveExpressionRefs } from "../refResolver";

describe("pbv2/refResolver", () => {
  const treeVersion = {
    nodes: [
      { id: "i1", type: "INPUT", input: { selectionKey: "qty", valueType: "NUMBER" } },
      { id: "c1", type: "COMPUTE", compute: { outputs: { out: { type: "NUMBER" } } } },
      { id: "e1", type: "EFFECT" },
      { id: "g1", type: "GROUP" },
    ],
  };

  test("nodeOutputRef to non-COMPUTE => ERROR", () => {
    const { table } = buildSymbolTable(treeVersion);

    const expr = {
      op: "ref",
      ref: { kind: "nodeOutputRef", nodeId: "i1", outputKey: "out" },
    } as const;

    const findings = resolveExpressionRefs(expr, "COMPUTE", table, { pathBase: "expr" });
    expect(findings.some((f) => f.code === "PBV2_E_NODE_OUTPUT_REF_INVALID_TARGET" && f.severity === "ERROR")).toBe(true);
  });

  test("pricebookRef used in COMPUTE => ERROR", () => {
    const { table } = buildSymbolTable(treeVersion);

    const expr = {
      op: "ref",
      ref: { kind: "pricebookRef", key: "finishing.grommets.overageUnitPrice" },
    } as const;

    const findings = resolveExpressionRefs(expr, "COMPUTE", table, { pathBase: "expr" });
    expect(findings.some((f) => f.code === "PBV2_E_PRICEBOOK_REF_FORBIDDEN_CONTEXT" && f.severity === "ERROR")).toBe(true);
  });

  test("EFFECT output referenced anywhere => ERROR", () => {
    const { table } = buildSymbolTable(treeVersion);

    const expr = {
      op: "ref",
      ref: { kind: "nodeOutputRef", nodeId: "e1", outputKey: "x" },
    } as const;

    const findings = resolveExpressionRefs(expr, "PRICE", table, { pathBase: "expr" });
    expect(findings.some((f) => f.code === "PBV2_E_EFFECT_REF_FORBIDDEN" && f.severity === "ERROR")).toBe(true);
  });

  test("GROUP node referenced => ERROR", () => {
    const { table } = buildSymbolTable(treeVersion);

    const expr = {
      op: "ref",
      ref: { kind: "nodeOutputRef", nodeId: "g1", outputKey: "x" },
    } as const;

    const findings = resolveExpressionRefs(expr, "PRICE", table, { pathBase: "expr" });
    expect(findings.some((f) => f.code === "PBV2_E_GROUP_NODE_REFERENCED" && f.severity === "ERROR")).toBe(true);
  });
});
