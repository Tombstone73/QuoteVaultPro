import type { ConditionRule, ExpressionSpec } from "./expressionSpec";
import type { RefContext } from "./refContract";
import type { Finding } from "./findings";
import type { SymbolTable } from "./symbolTable";
import { typeCheckCondition, typeCheckExpression } from "./typeChecker";

export type FormulaValidationResult = {
  ok: boolean;
  findings: Finding[];
  errors: Finding[];
  warnings: Finding[];
  info: Finding[];
  inferred?: { type: string; nullable: boolean };
};

function splitFindings(findings: Finding[]): { errors: Finding[]; warnings: Finding[]; info: Finding[] } {
  const errors: Finding[] = [];
  const warnings: Finding[] = [];
  const info: Finding[] = [];
  for (const f of findings) {
    if (f.severity === "ERROR") errors.push(f);
    else if (f.severity === "WARNING") warnings.push(f);
    else info.push(f);
  }
  return { errors, warnings, info };
}

export function validateFormulaJson(
  parsed: unknown,
  ctx: RefContext,
  symbolTable: SymbolTable,
  opts?: { pathBase?: string; entityId?: string }
): FormulaValidationResult {
  if (ctx === "CONDITION") {
    const r = typeCheckCondition(parsed as ConditionRule, symbolTable, { pathBase: opts?.pathBase, entityId: opts?.entityId });
    const split = splitFindings(r.findings);
    return {
      ok: split.errors.length === 0,
      findings: r.findings,
      errors: split.errors,
      warnings: split.warnings,
      info: split.info,
    };
  }

  const r = typeCheckExpression(parsed as ExpressionSpec, ctx, symbolTable, { pathBase: opts?.pathBase, entityId: opts?.entityId });
  const split = splitFindings(r.findings);
  return {
    ok: split.errors.length === 0,
    findings: r.findings,
    errors: split.errors,
    warnings: split.warnings,
    info: split.info,
    inferred: r.inferred as any,
  };
}
