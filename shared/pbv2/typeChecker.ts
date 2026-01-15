import { errorFinding, pathJoin, type Finding } from "./findings";
import type { ConditionRule, ExpressionSpec } from "./expressionSpec";
import { isConditionRule, isExpressionSpec } from "./expressionSpec";
import type { RefContext, Ref, PBV2Type } from "./refContract";
import { constantValueToType } from "./refContract";
import type { SymbolTable } from "./symbolTable";
import { resolveConditionRefs, resolveExpressionRefs } from "./refResolver";

export type InferredType = {
  type: Exclude<PBV2Type, "NULL"> | "NULL";
  /**
   * When true, the runtime value may be NULL and callers must guard via exists/coalesce.
   */
  nullable: boolean;
};

type TypeInfo = {
  base: Exclude<PBV2Type, "NULL"> | null;
  nullable: boolean;
};

function ti(base: TypeInfo["base"], nullable: boolean): TypeInfo {
  return { base, nullable };
}

function asInferred(t: TypeInfo): InferredType {
  if (t.base === null) return { type: "NULL", nullable: true };
  return { type: t.base, nullable: t.nullable };
}

function typeName(t: TypeInfo): string {
  if (t.base === null) return "NULL";
  return t.nullable ? `${t.base}|NULL` : t.base;
}

function sameBase(a: TypeInfo, b: TypeInfo): boolean {
  return a.base === b.base;
}

function requireNonNullableBase(
  t: TypeInfo,
  expectedBase: Exclude<PBV2Type, "NULL">,
  code: string,
  message: string,
  path: string,
  entityId?: string,
  context?: Record<string, unknown>
): Finding[] {
  if (t.base !== expectedBase || t.nullable) {
    return [
      errorFinding({
        code,
        message,
        path,
        entityId,
        context: { expected: expectedBase, actual: typeName(t), ...(context ?? {}) },
      }),
    ];
  }
  return [];
}

function refTypeInfo(ref: Ref, ctx: RefContext, table: SymbolTable): TypeInfo {
  switch (ref.kind) {
    case "constant": {
      const t = constantValueToType(ref.value);
      if (t === "NULL") return ti(null, true);
      if (t === "JSON") return ti("JSON", false);
      return ti(t, false);
    }

    case "selectionRef": {
      const symbol = table.inputBySelectionKey[ref.selectionKey];
      if (!symbol) return ti(null, true);
      // selectionRef may be missing at runtime => nullable.
      return ti(symbol.inputKind === "NULL" ? null : (symbol.inputKind as any), true);
    }

    case "effectiveRef": {
      const symbol = table.inputBySelectionKey[ref.selectionKey];
      if (!symbol) return ti(null, true);
      // effectiveRef is nullable only when no default exists.
      return ti(symbol.inputKind === "NULL" ? null : (symbol.inputKind as any), !symbol.hasDefault);
    }

    case "optionValueParamRef": {
      // By contract, optionValueParamRef resolves a numeric param from the selected ENUM option.
      // It is nullable unless the ref provides a defaultValue.
      return ti("NUMBER", ref.defaultValue === undefined);
    }

    case "optionValueParamJsonRef": {
      // optionValueParamJsonRef can return arbitrary option metadata (arrays/objects) as JSON.
      return ti("JSON", ref.defaultValue === undefined);
    }

    case "nodeOutputRef": {
      const compute = table.computeByNodeId[ref.nodeId];
      const output = compute?.outputs?.[ref.outputKey];
      if (!output) return ti(null, true);
      if (output.type === "NULL") return ti(null, true);
      return ti(output.type as any, false);
    }

    case "envRef": {
      // Env keys are assumed NUMBER for now; the symbol table can evolve to include per-key typing.
      return ti("NUMBER", false);
    }

    case "pricebookRef": {
      // Pricebook values are NUMBER (cents) by contract.
      return ti("NUMBER", false);
    }

    default: {
      const _exhaustive: never = ref;
      return ti(null, true);
    }
  }
}

function typeCheckExpressionInternal(
  expr: ExpressionSpec,
  ctx: RefContext,
  table: SymbolTable,
  path: string,
  entityId?: string
): { t: TypeInfo; findings: Finding[] } {
  const findings: Finding[] = [];

  switch (expr.op) {
    case "literal": {
      const baseType = constantValueToType(expr.value);
      if (baseType === "NULL") return { t: ti(null, true), findings };
      if (baseType === "JSON") return { t: ti("JSON", false), findings };
      return { t: ti(baseType, false), findings };
    }

    case "ref": {
      findings.push(...resolveExpressionRefs(expr, ctx, table, { pathBase: path, entityId }));
      const t = refTypeInfo(expr.ref, ctx, table);
      return { t, findings };
    }

    case "and":
    case "or": {
      for (let i = 0; i < expr.args.length; i++) {
        const r = typeCheckExpressionInternal(expr.args[i], ctx, table, pathJoin(path, `args[${i}]`), entityId);
        findings.push(...r.findings);
        findings.push(
          ...requireNonNullableBase(
            r.t,
            "BOOLEAN",
            "PBV2_E_EXPR_TYPE_MISMATCH",
            `${expr.op}() requires BOOLEAN operands`,
            pathJoin(path, `args[${i}]`),
            entityId,
            { op: expr.op }
          )
        );
      }
      return { t: ti("BOOLEAN", false), findings };
    }

    case "not": {
      const r = typeCheckExpressionInternal(expr.arg, ctx, table, pathJoin(path, "arg"), entityId);
      findings.push(...r.findings);
      findings.push(
        ...requireNonNullableBase(
          r.t,
          "BOOLEAN",
          "PBV2_E_EXPR_TYPE_MISMATCH",
          "not() requires BOOLEAN operand",
          pathJoin(path, "arg"),
          entityId,
          { op: "not" }
        )
      );
      return { t: ti("BOOLEAN", false), findings };
    }

    case "exists": {
      const r = typeCheckExpressionInternal(expr.x, ctx, table, pathJoin(path, "x"), entityId);
      findings.push(...r.findings);
      return { t: ti("BOOLEAN", false), findings };
    }

    case "coalesce": {
      if (expr.args.length === 0) {
        findings.push(
          errorFinding({
            code: "PBV2_E_EXPR_PARSE_FAIL",
            message: "coalesce() requires at least one argument",
            path,
            entityId,
          })
        );
        return { t: ti(null, true), findings };
      }

      const argTypes: TypeInfo[] = [];
      for (let i = 0; i < expr.args.length; i++) {
        const r = typeCheckExpressionInternal(expr.args[i], ctx, table, pathJoin(path, `args[${i}]`), entityId);
        findings.push(...r.findings);
        argTypes.push(r.t);
      }

      const chosenBase = argTypes.find((t) => t.base !== null)?.base ?? null;
      if (chosenBase !== null) {
        for (let i = 0; i < argTypes.length; i++) {
          const t = argTypes[i];
          if (t.base === null) continue;
          if (t.base !== chosenBase) {
            findings.push(
              errorFinding({
                code: "PBV2_E_EXPR_TYPE_MISMATCH",
                message: "coalesce() requires compatible argument types",
                path,
                entityId,
                context: {
                  expectedBase: chosenBase,
                  actualBase: t.base,
                },
              })
            );
            break;
          }
        }
      }

      const allNullable = argTypes.every((t) => t.nullable || t.base === null);
      const anyNonNullable = argTypes.some((t) => t.base !== null && !t.nullable);
      const nullable = chosenBase === null ? true : !anyNonNullable && allNullable;
      return { t: ti(chosenBase, nullable), findings };
    }

    case "if": {
      const cond = typeCheckExpressionInternal(expr.cond, ctx, table, pathJoin(path, "cond"), entityId);
      findings.push(...cond.findings);
      findings.push(
        ...requireNonNullableBase(
          cond.t,
          "BOOLEAN",
          "PBV2_E_EXPR_TYPE_MISMATCH",
          "if() requires BOOLEAN condition",
          pathJoin(path, "cond"),
          entityId,
          { op: "if" }
        )
      );

      const thenR = typeCheckExpressionInternal(expr.then, ctx, table, pathJoin(path, "then"), entityId);
      const elseR = typeCheckExpressionInternal(expr.else, ctx, table, pathJoin(path, "else"), entityId);
      findings.push(...thenR.findings);
      findings.push(...elseR.findings);

      if (thenR.t.base !== elseR.t.base) {
        findings.push(
          errorFinding({
            code: "PBV2_E_EXPR_TYPE_MISMATCH",
            message: "if() then/else must have the same type",
            path,
            entityId,
            context: { then: typeName(thenR.t), else: typeName(elseR.t) },
          })
        );
      }

      return { t: ti(thenR.t.base, thenR.t.nullable || elseR.t.nullable), findings };
    }

    case "eq":
    case "ne": {
      const left = typeCheckExpressionInternal(expr.left, ctx, table, pathJoin(path, "left"), entityId);
      const right = typeCheckExpressionInternal(expr.right, ctx, table, pathJoin(path, "right"), entityId);
      findings.push(...left.findings);
      findings.push(...right.findings);

      if (!sameBase(left.t, right.t)) {
        findings.push(
          errorFinding({
            code: "PBV2_E_EXPR_TYPE_MISMATCH",
            message: `${expr.op}() requires operands of the same type`,
            path,
            entityId,
            context: { left: typeName(left.t), right: typeName(right.t), op: expr.op },
          })
        );
      }

      return { t: ti("BOOLEAN", false), findings };
    }

    case "lt":
    case "lte":
    case "gt":
    case "gte": {
      const left = typeCheckExpressionInternal(expr.left, ctx, table, pathJoin(path, "left"), entityId);
      const right = typeCheckExpressionInternal(expr.right, ctx, table, pathJoin(path, "right"), entityId);
      findings.push(...left.findings);
      findings.push(...right.findings);

      findings.push(
        ...requireNonNullableBase(
          left.t,
          "NUMBER",
          "PBV2_E_EXPR_TYPE_MISMATCH",
          `${expr.op}() requires NUMBER operands`,
          pathJoin(path, "left"),
          entityId,
          { op: expr.op }
        )
      );
      findings.push(
        ...requireNonNullableBase(
          right.t,
          "NUMBER",
          "PBV2_E_EXPR_TYPE_MISMATCH",
          `${expr.op}() requires NUMBER operands`,
          pathJoin(path, "right"),
          entityId,
          { op: expr.op }
        )
      );

      return { t: ti("BOOLEAN", false), findings };
    }

    case "add":
    case "sub":
    case "mul":
    case "div":
    case "mod":
    case "min":
    case "max": {
      const left = typeCheckExpressionInternal(expr.left, ctx, table, pathJoin(path, "left"), entityId);
      const right = typeCheckExpressionInternal(expr.right, ctx, table, pathJoin(path, "right"), entityId);
      findings.push(...left.findings);
      findings.push(...right.findings);

      findings.push(
        ...requireNonNullableBase(
          left.t,
          "NUMBER",
          "PBV2_E_EXPR_TYPE_MISMATCH",
          `${expr.op}() requires NUMBER operands (use coalesce/exists for nullable refs)`,
          pathJoin(path, "left"),
          entityId,
          { op: expr.op }
        )
      );
      findings.push(
        ...requireNonNullableBase(
          right.t,
          "NUMBER",
          "PBV2_E_EXPR_TYPE_MISMATCH",
          `${expr.op}() requires NUMBER operands (use coalesce/exists for nullable refs)`,
          pathJoin(path, "right"),
          entityId,
          { op: expr.op }
        )
      );

      return { t: ti("NUMBER", false), findings };
    }

    case "abs":
    case "floor":
    case "ceil": {
      const x = typeCheckExpressionInternal((expr as any).x ?? (expr as any).arg, ctx, table, pathJoin(path, "x"), entityId);
      findings.push(...x.findings);
      findings.push(
        ...requireNonNullableBase(
          x.t,
          "NUMBER",
          "PBV2_E_EXPR_TYPE_MISMATCH",
          `${expr.op}() requires NUMBER operand`,
          pathJoin(path, "x"),
          entityId,
          { op: expr.op }
        )
      );
      return { t: ti("NUMBER", false), findings };
    }

    case "clamp": {
      const x = typeCheckExpressionInternal(expr.x, ctx, table, pathJoin(path, "x"), entityId);
      const lo = typeCheckExpressionInternal(expr.lo, ctx, table, pathJoin(path, "lo"), entityId);
      const hi = typeCheckExpressionInternal(expr.hi, ctx, table, pathJoin(path, "hi"), entityId);
      findings.push(...x.findings, ...lo.findings, ...hi.findings);

      findings.push(
        ...requireNonNullableBase(x.t, "NUMBER", "PBV2_E_EXPR_TYPE_MISMATCH", "clamp() requires NUMBER args", pathJoin(path, "x"), entityId)
      );
      findings.push(
        ...requireNonNullableBase(lo.t, "NUMBER", "PBV2_E_EXPR_TYPE_MISMATCH", "clamp() requires NUMBER args", pathJoin(path, "lo"), entityId)
      );
      findings.push(
        ...requireNonNullableBase(hi.t, "NUMBER", "PBV2_E_EXPR_TYPE_MISMATCH", "clamp() requires NUMBER args", pathJoin(path, "hi"), entityId)
      );

      return { t: ti("NUMBER", false), findings };
    }

    case "round": {
      const x = typeCheckExpressionInternal(expr.x, ctx, table, pathJoin(path, "x"), entityId);
      findings.push(...x.findings);
      findings.push(
        ...requireNonNullableBase(x.t, "NUMBER", "PBV2_E_EXPR_TYPE_MISMATCH", "round() requires NUMBER x", pathJoin(path, "x"), entityId)
      );
      if (expr.digits) {
        const d = typeCheckExpressionInternal(expr.digits, ctx, table, pathJoin(path, "digits"), entityId);
        findings.push(...d.findings);
        findings.push(
          ...requireNonNullableBase(d.t, "NUMBER", "PBV2_E_EXPR_TYPE_MISMATCH", "round() requires NUMBER digits", pathJoin(path, "digits"), entityId)
        );
      }
      return { t: ti("NUMBER", false), findings };
    }

    case "concat": {
      for (let i = 0; i < expr.args.length; i++) {
        const r = typeCheckExpressionInternal(expr.args[i], ctx, table, pathJoin(path, `args[${i}]`), entityId);
        findings.push(...r.findings);
        findings.push(
          ...requireNonNullableBase(
            r.t,
            "TEXT",
            "PBV2_E_EXPR_TYPE_MISMATCH",
            "concat() requires TEXT args",
            pathJoin(path, `args[${i}]`),
            entityId
          )
        );
      }
      return { t: ti("TEXT", false), findings };
    }

    case "strlen": {
      const r = typeCheckExpressionInternal(expr.x, ctx, table, pathJoin(path, "x"), entityId);
      findings.push(...r.findings);
      findings.push(
        ...requireNonNullableBase(r.t, "TEXT", "PBV2_E_EXPR_TYPE_MISMATCH", "strlen() requires TEXT", pathJoin(path, "x"), entityId)
      );
      return { t: ti("NUMBER", false), findings };
    }

    default:
      findings.push(
        errorFinding({
          code: "PBV2_E_EXPR_PARSE_FAIL",
          message: `Unknown ExpressionSpec op '${(expr as any).op}'`,
          path,
          entityId,
        })
      );
      return { t: ti(null, true), findings };
  }
}

export function typeCheckExpression(
  expr: unknown,
  ctx: RefContext,
  table: SymbolTable,
  opts?: { pathBase?: string; entityId?: string }
): { inferred: InferredType; findings: Finding[] } {
  const pathBase = opts?.pathBase ?? "expr";
  const entityId = opts?.entityId;

  if (!isExpressionSpec(expr)) {
    return {
      inferred: { type: "NULL", nullable: true },
      findings: [
        errorFinding({
          code: "PBV2_E_EXPR_PARSE_FAIL",
          message: "ExpressionSpec is not a valid AST object",
          path: pathBase,
          entityId,
        }),
      ],
    };
  }

  const r = typeCheckExpressionInternal(expr, ctx, table, pathBase, entityId);
  return { inferred: asInferred(r.t), findings: r.findings };
}

export function typeCheckCondition(
  rule: unknown,
  table: SymbolTable,
  opts?: { pathBase?: string; entityId?: string }
): { findings: Finding[] } {
  const pathBase = opts?.pathBase ?? "condition";
  const entityId = opts?.entityId;

  const findings: Finding[] = [];
  findings.push(...resolveConditionRefs(rule, table, { pathBase, entityId }));

  if (!isConditionRule(rule)) {
    return { findings };
  }

  const walk = (node: ConditionRule, path: string): void => {
    switch (node.op) {
      case "AND":
      case "OR":
        node.args.forEach((a, i) => walk(a, pathJoin(path, `args[${i}]`)));
        return;
      case "NOT":
        walk(node.arg, pathJoin(path, "arg"));
        return;
      case "EXISTS": {
        // exists() accepts any expression type.
        typeCheckExpression(node.value, "CONDITION", table, { pathBase: pathJoin(path, "value"), entityId });
        return;
      }

      case "EQ":
      case "NEQ": {
        const left = typeCheckExpression(node.left, "CONDITION", table, { pathBase: pathJoin(path, "left"), entityId });
        const right = typeCheckExpression(node.right, "CONDITION", table, { pathBase: pathJoin(path, "right"), entityId });
        findings.push(...left.findings, ...right.findings);
        if (left.inferred.type !== right.inferred.type) {
          findings.push(
            errorFinding({
              code: "PBV2_E_EXPR_TYPE_MISMATCH",
              message: `${node.op} requires operands of the same type`,
              path,
              entityId,
              context: { left: left.inferred, right: right.inferred, op: node.op },
            })
          );
        }
        return;
      }

      case "GT":
      case "GTE":
      case "LT":
      case "LTE": {
        const left = typeCheckExpression(node.left, "CONDITION", table, { pathBase: pathJoin(path, "left"), entityId });
        const right = typeCheckExpression(node.right, "CONDITION", table, { pathBase: pathJoin(path, "right"), entityId });
        findings.push(...left.findings, ...right.findings);

        if (left.inferred.type !== "NUMBER" || left.inferred.nullable) {
          findings.push(
            errorFinding({
              code: "PBV2_E_EXPR_TYPE_MISMATCH",
              message: `${node.op} requires non-null NUMBER left operand`,
              path: pathJoin(path, "left"),
              entityId,
              context: { actual: left.inferred },
            })
          );
        }
        if (right.inferred.type !== "NUMBER" || right.inferred.nullable) {
          findings.push(
            errorFinding({
              code: "PBV2_E_EXPR_TYPE_MISMATCH",
              message: `${node.op} requires non-null NUMBER right operand`,
              path: pathJoin(path, "right"),
              entityId,
              context: { actual: right.inferred },
            })
          );
        }
        return;
      }

      case "IN": {
        const value = typeCheckExpression(node.value, "CONDITION", table, { pathBase: pathJoin(path, "value"), entityId });
        findings.push(...value.findings);

        node.options.forEach((o, i) => {
          const opt = typeCheckExpression(o, "CONDITION", table, { pathBase: pathJoin(path, `options[${i}]`), entityId });
          findings.push(...opt.findings);
          if (opt.inferred.type !== value.inferred.type) {
            findings.push(
              errorFinding({
                code: "PBV2_E_EXPR_TYPE_MISMATCH",
                message: "IN requires option types to match value type",
                path: pathJoin(path, `options[${i}]`),
                entityId,
                context: { value: value.inferred, option: opt.inferred },
              })
            );
          }
        });
        return;
      }

      default:
        findings.push(
          errorFinding({
            code: "PBV2_E_EDGE_CONDITION_INVALID",
            message: `Unknown ConditionRule op '${(node as any).op}'`,
            path,
            entityId,
          })
        );
        return;
    }
  };

  walk(rule, pathBase);
  return { findings };
}
