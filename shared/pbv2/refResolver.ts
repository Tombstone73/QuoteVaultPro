import { errorFinding, pathJoin, type Finding } from "./findings";
import type { ConditionRule, ExpressionSpec } from "./expressionSpec";
import { isConditionRule, isExpressionSpec } from "./expressionSpec";
import type { Ref, RefContext, RefKind } from "./refContract";
import { isRefKindAllowedInContext, constantValueToType } from "./refContract";
import type { SymbolTable } from "./symbolTable";

export type ResolveRefsOptions = {
  pathBase?: string;
  entityId?: string;
  /** Additional env keys beyond the canonical allowlist, if a future version expands it. */
  additionalEnvKeys?: string[];
};

function refKind(ref: Ref): RefKind {
  return ref.kind;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function resolveRef(ref: Ref, ctx: RefContext, table: SymbolTable, path: string, entityId?: string): Finding[] {
  const findings: Finding[] = [];

  if (!isRefKindAllowedInContext(ref.kind, ctx)) {
    if (ref.kind === "pricebookRef") {
      findings.push(
        errorFinding({
          code: "PBV2_E_PRICEBOOK_REF_FORBIDDEN_CONTEXT",
          message: `pricebookRef is not allowed in ${ctx} context`,
          path,
          entityId,
          context: { ctx },
        })
      );
      return findings;
    }

    findings.push(
      errorFinding({
        code: "PBV2_E_REF_FORBIDDEN_CONTEXT",
        message: `Ref kind '${ref.kind}' is not allowed in ${ctx} context`,
        path,
        entityId,
        context: { ctx, refKind: ref.kind },
      })
    );
    return findings;
  }

  switch (ref.kind) {
    case "selectionRef":
    case "effectiveRef": {
      if (!isNonEmptyString(ref.selectionKey)) {
        findings.push(
          errorFinding({
            code: "PBV2_E_EXPR_REF_UNRESOLVED",
            message: `Invalid selectionKey for ${ref.kind}`,
            path,
            entityId,
            context: { refKind: ref.kind },
          })
        );
        return findings;
      }

      const symbol = table.inputBySelectionKey[ref.selectionKey];
      if (!symbol) {
        findings.push(
          errorFinding({
            code: "PBV2_E_EXPR_REF_UNRESOLVED",
            message: `Unresolved selectionKey '${ref.selectionKey}'`,
            path,
            entityId,
            context: { refKind: ref.kind, selectionKey: ref.selectionKey },
          })
        );
      }
      return findings;
    }

    case "nodeOutputRef": {
      if (!isNonEmptyString(ref.nodeId) || !isNonEmptyString(ref.outputKey)) {
        findings.push(
          errorFinding({
            code: "PBV2_E_EXPR_REF_UNRESOLVED",
            message: `Invalid nodeOutputRef address`,
            path,
            entityId,
            context: { refKind: ref.kind },
          })
        );
        return findings;
      }

      const nodeType = table.nodeTypesById[ref.nodeId];
      if (!nodeType) {
        findings.push(
          errorFinding({
            code: "PBV2_E_EXPR_REF_UNRESOLVED",
            message: `Unresolved nodeId '${ref.nodeId}'`,
            path,
            entityId,
            context: { refKind: ref.kind, nodeId: ref.nodeId },
          })
        );
        return findings;
      }

      if (nodeType === "GROUP") {
        findings.push(
          errorFinding({
            code: "PBV2_E_GROUP_NODE_REFERENCED",
            message: `GROUP node '${ref.nodeId}' cannot be referenced`,
            path,
            entityId,
            context: { nodeId: ref.nodeId },
          })
        );
        return findings;
      }

      if (nodeType === "EFFECT") {
        findings.push(
          errorFinding({
            code: "PBV2_E_EFFECT_REF_FORBIDDEN",
            message: `EFFECT outputs cannot be referenced`,
            path,
            entityId,
            context: { nodeId: ref.nodeId, outputKey: ref.outputKey },
          })
        );
        return findings;
      }

      if (nodeType !== "COMPUTE") {
        findings.push(
          errorFinding({
            code: "PBV2_E_NODE_OUTPUT_REF_INVALID_TARGET",
            message: `nodeOutputRef must target a COMPUTE node (got ${nodeType})`,
            path,
            entityId,
            context: { nodeId: ref.nodeId, nodeType },
          })
        );
        return findings;
      }

      const compute = table.computeByNodeId[ref.nodeId];
      const output = compute?.outputs?.[ref.outputKey];
      if (!output) {
        findings.push(
          errorFinding({
            code: "PBV2_E_EXPR_REF_UNRESOLVED",
            message: `Unresolved compute output '${ref.outputKey}' on node '${ref.nodeId}'`,
            path,
            entityId,
            context: { nodeId: ref.nodeId, outputKey: ref.outputKey },
          })
        );
      }
      return findings;
    }

    case "envRef": {
      if (!isNonEmptyString(ref.envKey)) {
        findings.push(
          errorFinding({
            code: "PBV2_E_EXPR_REF_UNRESOLVED",
            message: `Invalid envKey for envRef`,
            path,
            entityId,
            context: { refKind: ref.kind },
          })
        );
        return findings;
      }

      if (!table.envKeys.has(ref.envKey)) {
        findings.push(
          errorFinding({
            code: "PBV2_E_EXPR_REF_UNRESOLVED",
            message: `Unresolved envKey '${ref.envKey}'`,
            path,
            entityId,
            context: { envKey: ref.envKey },
          })
        );
      }
      return findings;
    }

    case "pricebookRef": {
      if (!isNonEmptyString(ref.key)) {
        findings.push(
          errorFinding({
            code: "PBV2_E_EXPR_REF_UNRESOLVED",
            message: `Invalid pricebook key`,
            path,
            entityId,
            context: { refKind: ref.kind },
          })
        );
      }
      return findings;
    }

    case "constant": {
      // constant refs are allowed where constant is allowed; validate type is supported.
      const type = constantValueToType(ref.value);
      if (type === "JSON") {
        findings.push(
          errorFinding({
            code: "PBV2_E_EXPR_TYPE_MISMATCH",
            message: `constant value must be NUMBER|BOOLEAN|TEXT|NULL`,
            path,
            entityId,
            context: { actualType: "JSON" },
          })
        );
      }
      return findings;
    }

    default: {
      const _exhaustive: never = ref;
      return findings;
    }
  }
}

export function resolveExpressionRefs(
  expr: unknown,
  ctx: RefContext,
  table: SymbolTable,
  opts?: ResolveRefsOptions
): Finding[] {
  const pathBase = opts?.pathBase ?? "expr";
  const entityId = opts?.entityId;

  if (!isExpressionSpec(expr)) {
    return [
      errorFinding({
        code: "PBV2_E_EXPR_PARSE_FAIL",
        message: "ExpressionSpec is not a valid AST object",
        path: pathBase,
        entityId,
      }),
    ];
  }

  const findings: Finding[] = [];

  const walk = (node: ExpressionSpec, path: string): void => {
    switch (node.op) {
      case "literal":
        return;
      case "ref":
        findings.push(...resolveRef(node.ref, ctx, table, pathJoin(path, "ref"), entityId));
        return;

      case "and":
      case "or": {
        node.args.forEach((a, i) => walk(a, pathJoin(path, `args[${i}]`)));
        return;
      }

      case "not":
      case "abs":
      case "floor":
      case "ceil":
      case "exists":
      case "strlen": {
        walk((node as any).arg ?? (node as any).x ?? (node as any).value ?? (node as any).x, pathJoin(path, "arg"));
        return;
      }

      case "eq":
      case "ne":
      case "lt":
      case "lte":
      case "gt":
      case "gte":
      case "add":
      case "sub":
      case "mul":
      case "div":
      case "mod":
      case "min":
      case "max": {
        const left = (node as any).left;
        const right = (node as any).right;
        walk(left, pathJoin(path, "left"));
        walk(right, pathJoin(path, "right"));
        return;
      }

      case "clamp": {
        walk(node.x, pathJoin(path, "x"));
        walk(node.lo, pathJoin(path, "lo"));
        walk(node.hi, pathJoin(path, "hi"));
        return;
      }

      case "round": {
        walk(node.x, pathJoin(path, "x"));
        if (node.digits) walk(node.digits, pathJoin(path, "digits"));
        return;
      }

      case "if": {
        walk(node.cond, pathJoin(path, "cond"));
        walk(node.then, pathJoin(path, "then"));
        walk(node.else, pathJoin(path, "else"));
        return;
      }

      case "coalesce":
      case "concat": {
        node.args.forEach((a, i) => walk(a, pathJoin(path, `args[${i}]`)));
        return;
      }

      default:
        findings.push(
          errorFinding({
            code: "PBV2_E_EXPR_PARSE_FAIL",
            message: `Unknown ExpressionSpec op '${(node as any).op}'`,
            path,
            entityId,
          })
        );
        return;
    }
  };

  walk(expr, pathBase);
  return findings;
}

export function resolveConditionRefs(
  rule: unknown,
  table: SymbolTable,
  opts?: ResolveRefsOptions
): Finding[] {
  const pathBase = opts?.pathBase ?? "condition";
  const entityId = opts?.entityId;

  if (!isConditionRule(rule)) {
    return [
      errorFinding({
        code: "PBV2_E_EDGE_CONDITION_INVALID",
        message: "ConditionRule is not a valid AST object",
        path: pathBase,
        entityId,
      }),
    ];
  }

  const findings: Finding[] = [];

  const walk = (node: ConditionRule, path: string): void => {
    switch (node.op) {
      case "AND":
      case "OR":
        node.args.forEach((a, i) => walk(a, pathJoin(path, `args[${i}]`)));
        return;
      case "NOT":
        walk(node.arg, pathJoin(path, "arg"));
        return;
      case "EXISTS":
        findings.push(...resolveExpressionRefs(node.value, "CONDITION", table, { pathBase: pathJoin(path, "value"), entityId }));
        return;
      case "EQ":
      case "NEQ":
      case "GT":
      case "GTE":
      case "LT":
      case "LTE":
        findings.push(...resolveExpressionRefs(node.left, "CONDITION", table, { pathBase: pathJoin(path, "left"), entityId }));
        findings.push(...resolveExpressionRefs(node.right, "CONDITION", table, { pathBase: pathJoin(path, "right"), entityId }));
        return;
      case "IN":
        findings.push(...resolveExpressionRefs(node.value, "CONDITION", table, { pathBase: pathJoin(path, "value"), entityId }));
        node.options.forEach((o, i) => {
          findings.push(...resolveExpressionRefs(o, "CONDITION", table, { pathBase: pathJoin(path, `options[${i}]`), entityId }));
        });
        return;
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
  return findings;
}
