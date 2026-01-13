import { describe, test, expect } from "@jest/globals";
import { buildSymbolTable } from "../symbolTable";
import { validateFormulaJson } from "../formulaValidation";

describe("pbv2/formulaValidation", () => {
  const treeVersion = {
    nodes: [
      { id: "i_qty", type: "INPUT", input: { selectionKey: "qty", valueType: "NUMBER" } },
      { id: "c1", type: "COMPUTE", compute: { outputs: { out: { type: "NUMBER" } } } },
    ],
  };

  test("pricebookRef is rejected in COMPUTE context", () => {
    const { table } = buildSymbolTable(treeVersion);

    const expr = {
      op: "ref",
      ref: { kind: "pricebookRef", key: "banner.grommets.unitPriceCents" },
    } as const;

    const result = validateFormulaJson(expr, "COMPUTE", table, { pathBase: "expr" });
    expect(result.ok).toBe(false);
    expect(result.errors.some((f) => f.code === "PBV2_E_PRICEBOOK_REF_FORBIDDEN_CONTEXT")).toBe(true);
  });

  test("pricebookRef is rejected inside CONDITION", () => {
    const { table } = buildSymbolTable(treeVersion);

    const cond = {
      op: "EQ",
      left: { op: "ref", ref: { kind: "pricebookRef", key: "x" } },
      right: { op: "literal", value: 1 },
    } as const;

    const result = validateFormulaJson(cond, "CONDITION", table, { pathBase: "cond" });
    expect(result.ok).toBe(false);
    expect(result.errors.some((f) => f.code === "PBV2_E_PRICEBOOK_REF_FORBIDDEN_CONTEXT")).toBe(true);
  });

  test("simple valid COMPUTE expression passes", () => {
    const { table } = buildSymbolTable(treeVersion);

    const expr = {
      op: "add",
      left: { op: "literal", value: 1 },
      right: {
        op: "coalesce",
        args: [
          { op: "ref", ref: { kind: "selectionRef", selectionKey: "qty" } },
          { op: "literal", value: 0 },
        ],
      },
    } as const;

    const result = validateFormulaJson(expr, "COMPUTE", table, { pathBase: "expr" });
    expect(result.ok).toBe(true);
    expect(result.errors).toHaveLength(0);
  });
});
