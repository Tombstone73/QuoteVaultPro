import type { Ref } from "./refContract";

export type ExprOp =
  | "literal"
  | "ref"
  | "and"
  | "or"
  | "not"
  | "eq"
  | "ne"
  | "lt"
  | "lte"
  | "gt"
  | "gte"
  | "add"
  | "sub"
  | "mul"
  | "div"
  | "mod"
  | "abs"
  | "min"
  | "max"
  | "clamp"
  | "round"
  | "floor"
  | "ceil"
  | "if"
  | "exists"
  | "coalesce"
  | "concat"
  | "strlen";

export type ExpressionLiteral = number | boolean | string | null;

export type ExpressionSpec =
  | { op: "literal"; value: ExpressionLiteral }
  | { op: "ref"; ref: Ref }
  | { op: "and"; args: ExpressionSpec[] }
  | { op: "or"; args: ExpressionSpec[] }
  | { op: "not"; arg: ExpressionSpec }
  | { op: "eq"; left: ExpressionSpec; right: ExpressionSpec }
  | { op: "ne"; left: ExpressionSpec; right: ExpressionSpec }
  | { op: "lt"; left: ExpressionSpec; right: ExpressionSpec }
  | { op: "lte"; left: ExpressionSpec; right: ExpressionSpec }
  | { op: "gt"; left: ExpressionSpec; right: ExpressionSpec }
  | { op: "gte"; left: ExpressionSpec; right: ExpressionSpec }
  | { op: "add"; left: ExpressionSpec; right: ExpressionSpec }
  | { op: "sub"; left: ExpressionSpec; right: ExpressionSpec }
  | { op: "mul"; left: ExpressionSpec; right: ExpressionSpec }
  | { op: "div"; left: ExpressionSpec; right: ExpressionSpec }
  | { op: "mod"; left: ExpressionSpec; right: ExpressionSpec }
  | { op: "abs"; arg: ExpressionSpec }
  | { op: "min"; left: ExpressionSpec; right: ExpressionSpec }
  | { op: "max"; left: ExpressionSpec; right: ExpressionSpec }
  | { op: "clamp"; x: ExpressionSpec; lo: ExpressionSpec; hi: ExpressionSpec }
  | { op: "round"; x: ExpressionSpec; digits?: ExpressionSpec }
  | { op: "floor"; x: ExpressionSpec }
  | { op: "ceil"; x: ExpressionSpec }
  | { op: "if"; cond: ExpressionSpec; then: ExpressionSpec; else: ExpressionSpec }
  | { op: "exists"; x: ExpressionSpec }
  | { op: "coalesce"; args: ExpressionSpec[] }
  | { op: "concat"; args: ExpressionSpec[] }
  | { op: "strlen"; x: ExpressionSpec };

export type ConditionOp = "AND" | "OR" | "NOT" | "EQ" | "NEQ" | "GT" | "GTE" | "LT" | "LTE" | "IN" | "EXISTS";

export type ConditionRule =
  | { op: "AND"; args: ConditionRule[] }
  | { op: "OR"; args: ConditionRule[] }
  | { op: "NOT"; arg: ConditionRule }
  | { op: "EXISTS"; value: ExpressionSpec }
  | {
      op: "EQ" | "NEQ" | "GT" | "GTE" | "LT" | "LTE";
      left: ExpressionSpec;
      right: ExpressionSpec;
    }
  | { op: "IN"; value: ExpressionSpec; options: ExpressionSpec[] };

export function isExpressionSpec(value: unknown): value is ExpressionSpec {
  return typeof value === "object" && value !== null && typeof (value as any).op === "string";
}

export function isConditionRule(value: unknown): value is ConditionRule {
  return typeof value === "object" && value !== null && typeof (value as any).op === "string";
}
