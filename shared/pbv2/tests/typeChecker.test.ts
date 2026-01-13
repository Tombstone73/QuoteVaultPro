import { describe, test, expect } from "@jest/globals";
import { buildSymbolTable } from "../symbolTable";
import { typeCheckExpression } from "../typeChecker";

describe("pbv2/typeChecker", () => {
  const treeVersion = {
    nodes: [
      { id: "i_qty", type: "INPUT", input: { selectionKey: "qty", valueType: "NUMBER" } },
      { id: "i_enabled", type: "INPUT", input: { selectionKey: "enabled", valueType: "BOOLEAN", defaultValue: true } },
      { id: "c1", type: "COMPUTE", compute: { outputs: { out: { type: "NUMBER" } } } },
    ],
  };

  test("if() branch mismatch => ERROR", () => {
    const { table } = buildSymbolTable(treeVersion);

    const expr = {
      op: "if",
      cond: { op: "literal", value: true },
      then: { op: "literal", value: 1 },
      else: { op: "literal", value: "x" },
    } as const;

    const result = typeCheckExpression(expr, "COMPUTE", table, { pathBase: "expr" });
    expect(result.findings.some((f) => f.code === "PBV2_E_EXPR_TYPE_MISMATCH" && f.severity === "ERROR")).toBe(true);
  });

  test("exists/coalesce NULL behavior => passes and types correctly", () => {
    const { table } = buildSymbolTable(treeVersion);

    const expr = {
      op: "coalesce",
      args: [
        { op: "ref", ref: { kind: "selectionRef", selectionKey: "qty" } },
        { op: "literal", value: 0 },
      ],
    } as const;

    const result = typeCheckExpression(expr, "COMPUTE", table, { pathBase: "expr" });
    expect(result.findings).toHaveLength(0);
    expect(result.inferred.type).toBe("NUMBER");
    expect(result.inferred.nullable).toBe(false);
  });

  test("selectionRef missing yields NULL typing (nullable) and is not an error by itself", () => {
    const { table } = buildSymbolTable(treeVersion);

    const expr = {
      op: "ref",
      ref: { kind: "selectionRef", selectionKey: "qty" },
    } as const;

    const result = typeCheckExpression(expr, "COMPUTE", table, { pathBase: "expr" });
    // No findings: selectionKey exists, value may be missing at runtime.
    expect(result.findings).toHaveLength(0);
    expect(result.inferred.type).toBe("NUMBER");
    expect(result.inferred.nullable).toBe(true);
  });
});
