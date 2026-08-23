import { buildSymbolTable } from "../symbolTable";
import { typeCheckCondition, typeCheckExpression } from "../typeChecker";
import { errorFinding, warningFinding, infoFinding, type Finding } from "../findings";
import type { ConditionRule, ExpressionSpec } from "../expressionSpec";
import { DEFAULT_VALIDATE_OPTS, type ProductOptionTreeV2Json, type ValidateOpts, type ValidationResult } from "./types";
import { PBV2_PRICING_MATRIX_PROTECTED_VARIABLES } from "../../productOptionPricingMatrix";

type PBV2Status = "ENABLED" | "DISABLED" | "DELETED";

type NodeRec = {
  id: string;
  raw: Record<string, unknown>;
  status: PBV2Status;
  type: string | null;
  key: string | null;
  selectionKey: string | null;
  required: boolean;
};

type EdgeRec = {
  id: string;
  raw: Record<string, unknown>;
  status: PBV2Status;
  fromNodeId: string | null;
  toNodeId: string | null;
  priority: number | null;
  condition: unknown;
};

type ChoicePricingOverrideMode = "none" | "set_base_rate" | "add_base_rate" | "multiply_base_rate";
type ChoicePricingOverrideUnit = "perSqft" | "perPiece" | "minimumCharge";
type ChoicePricingOverrideAppliesTo = "base" | "area" | "quantity";
type VisibilityRuleType = "equals" | "notEquals" | "in" | "truthy" | "and" | "or" | "not";

const OPTION_RULE_OPERATORS = new Set(["equals", "not_equals", "in", "not_in", "exists", "not_exists"]);
const OPTION_RULE_ACTIONS = new Set(["show", "hide", "disable", "enable", "require", "optional", "clear", "set_default"]);

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object") return null;
  return value as Record<string, unknown>;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isEmptyOverrideValue(value: unknown): boolean {
  return value === undefined || value === null || value === "";
}

function getExplicitMaterialOverride(value: unknown): Record<string, unknown> | null | "invalid" {
  if (value === undefined || value === null) return null;

  const override = asRecord(value);
  if (!override) return "invalid";

  const hasConfiguredValue = Object.values(override).some((entry) => !isEmptyOverrideValue(entry));
  if (!hasConfiguredValue) return null;

  if (!isNonEmptyString((override as any).materialId)) return "invalid";
  return override;
}

function normalizeStatus(value: unknown): PBV2Status {
  if (typeof value !== "string") return "ENABLED";
  const upper = value.toUpperCase();
  if (upper === "ENABLED") return "ENABLED";
  if (upper === "DISABLED") return "DISABLED";
  if (upper === "DELETED") return "DELETED";
  return "ENABLED";
}

function normalizeNodeType(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const upper = value.toUpperCase();
  if (upper === "INPUT" || upper === "COMPUTE" || upper === "PRICE" || upper === "EFFECT" || upper === "GROUP") return upper;
  return null;
}

function extractNodes(tree: Record<string, unknown>): NodeRec[] {
  const nodesRaw = tree.nodes;

  const out: NodeRec[] = [];

  const add = (id: string, raw: Record<string, unknown>) => {
    const status = normalizeStatus((raw as any).status);
    const type =
      normalizeNodeType((raw as any).type ?? (raw as any).nodeType ?? (raw as any).kind) ??
      ((raw as any).kind === "question" ? "INPUT" : (raw as any).kind === "computed" ? "COMPUTE" : (raw as any).kind === "group" ? "GROUP" : null);

    const key = isNonEmptyString((raw as any).key) ? String((raw as any).key) : null;

    const input = asRecord((raw as any).input) ?? asRecord((raw as any).data);
    const selectionKey = input && isNonEmptyString((input as any).selectionKey) ? String((input as any).selectionKey) : null;

    const constraints =
      (input && (input as any).constraints) ||
      (input && (input as any).constraint) ||
      (raw as any).constraints ||
      (raw as any).constraint;
    const required = Boolean((input as any)?.required ?? (constraints as any)?.required ?? false);

    out.push({ id, raw, status, type, key, selectionKey, required });
  };

  if (Array.isArray(nodesRaw)) {
    for (const item of nodesRaw) {
      const rec = asRecord(item);
      if (!rec) continue;
      const id = isNonEmptyString((rec as any).id) ? String((rec as any).id) : isNonEmptyString((rec as any).nodeId) ? String((rec as any).nodeId) : "";
      if (!id) continue;
      add(id, rec);
    }
    return out;
  }

  const nodesMap = asRecord(nodesRaw);
  if (nodesMap) {
    for (const [key, raw] of Object.entries(nodesMap)) {
      const rec = asRecord(raw);
      if (!rec) continue;
      const id = isNonEmptyString((rec as any).id) ? String((rec as any).id) : key;
      if (!id) continue;
      add(id, rec);
    }
  }

  return out;
}

function extractEdges(tree: Record<string, unknown>): EdgeRec[] {
  const edgesRaw = tree.edges;
  const out: EdgeRec[] = [];

  const add = (id: string, raw: Record<string, unknown>) => {
    const status = normalizeStatus((raw as any).status);
    const fromNodeId = isNonEmptyString((raw as any).fromNodeId) ? String((raw as any).fromNodeId) : null;
    const toNodeId = isNonEmptyString((raw as any).toNodeId) ? String((raw as any).toNodeId) : null;

    const pr = (raw as any).priority;
    const priority = typeof pr === "number" && Number.isFinite(pr) ? pr : pr === undefined ? 0 : null;

    const condition = (raw as any).condition;

    out.push({ id, raw, status, fromNodeId, toNodeId, priority, condition });
  };

  if (Array.isArray(edgesRaw)) {
    for (const item of edgesRaw) {
      const rec = asRecord(item);
      if (!rec) continue;
      const id = isNonEmptyString((rec as any).id) ? String((rec as any).id) : isNonEmptyString((rec as any).edgeId) ? String((rec as any).edgeId) : "";
      if (!id) continue;
      add(id, rec);
    }
    return out;
  }

  const edgesMap = asRecord(edgesRaw);
  if (edgesMap) {
    for (const [key, raw] of Object.entries(edgesMap)) {
      const rec = asRecord(raw);
      if (!rec) continue;
      const id = isNonEmptyString((rec as any).id) ? String((rec as any).id) : key;
      if (!id) continue;
      add(id, rec);
    }
  }

  return out;
}

function stableStringify(value: unknown): string {
  if (value === null) return "null";
  if (typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const rec = value as Record<string, unknown>;
  const keys = Object.keys(rec).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(rec[k])}`).join(",")}}`;
}

function collectSelectionKeysFromCondition(rule: unknown): Set<string> {
  const out = new Set<string>();
  const walkExpr = (expr: unknown) => {
    const e = expr as any;
    if (!e || typeof e !== "object") return;
    if (e.op === "ref" && e.ref && typeof e.ref === "object") {
      const r = e.ref as any;
      if (
        (
          r.kind === "selectionRef" ||
          r.kind === "effectiveRef" ||
          r.kind === "optionValueParamRef" ||
          r.kind === "optionValueParamJsonRef"
        ) &&
        isNonEmptyString(r.selectionKey)
      ) {
        out.add(r.selectionKey);
      }
    }
    // recurse
    for (const v of Object.values(e)) {
      if (v && typeof v === "object") walkExpr(v);
    }
  };
  const walkRule = (node: unknown) => {
    const n = node as any;
    if (!n || typeof n !== "object") return;
    switch (n.op) {
      case "AND":
      case "OR":
        if (Array.isArray(n.args)) n.args.forEach(walkRule);
        return;
      case "NOT":
        walkRule(n.arg);
        return;
      case "EXISTS":
        walkExpr(n.value);
        return;
      case "EQ":
      case "NEQ":
      case "GT":
      case "GTE":
      case "LT":
      case "LTE":
        walkExpr(n.left);
        walkExpr(n.right);
        return;
      case "IN":
        walkExpr(n.value);
        if (Array.isArray(n.options)) n.options.forEach(walkExpr);
        return;
      default:
        return;
    }
  };

  walkRule(rule);
  return out;
}

function isProvablyUnsat(rule: unknown): boolean {
  const r = rule as any;
  if (!r || typeof r !== "object") return false;

  if (r.op === "IN") {
    if (Array.isArray(r.options) && r.options.length === 0) return true;
    return false;
  }

  if (r.op === "OR") {
    if (!Array.isArray(r.args) || r.args.length === 0) return false;
    return r.args.every(isProvablyUnsat);
  }

  if (r.op !== "AND") return false;
  if (!Array.isArray(r.args) || r.args.length === 0) return false;

  type EqConstraint = { xKey: string; literalKey: string };
  const eqs: EqConstraint[] = [];
  const lower: Record<string, number> = {};
  const upper: Record<string, number> = {};

  const exprKey = (expr: unknown): string => stableStringify(expr);

  const asLiteralNumber = (expr: unknown): number | null => {
    const e = expr as any;
    if (!e || typeof e !== "object") return null;
    if (e.op === "literal" && typeof e.value === "number" && Number.isFinite(e.value)) return e.value;
    return null;
  };

  const asLiteralAny = (expr: unknown): string | null => {
    const e = expr as any;
    if (!e || typeof e !== "object") return null;
    if (e.op !== "literal") return null;
    return stableStringify(e.value);
  };

  for (const a of r.args) {
    const n = a as any;
    if (!n || typeof n !== "object") continue;

    if (n.op === "EQ") {
      const lk = asLiteralAny(n.left);
      const rk = asLiteralAny(n.right);
      if (rk !== null) eqs.push({ xKey: exprKey(n.left), literalKey: rk });
      else if (lk !== null) eqs.push({ xKey: exprKey(n.right), literalKey: lk });
      continue;
    }

    if (n.op === "GT" || n.op === "GTE") {
      const val = asLiteralNumber(n.right);
      if (val === null) continue;
      const x = exprKey(n.left);
      lower[x] = Math.max(lower[x] ?? -Infinity, val);
      continue;
    }

    if (n.op === "LT" || n.op === "LTE") {
      const val = asLiteralNumber(n.right);
      if (val === null) continue;
      const x = exprKey(n.left);
      upper[x] = Math.min(upper[x] ?? Infinity, val);
      continue;
    }

    if (isProvablyUnsat(n)) return true;
  }

  // AND(EQ(x,a), EQ(x,b)) where a!=b
  const byX: Record<string, Set<string>> = {};
  for (const e of eqs) {
    byX[e.xKey] ??= new Set<string>();
    byX[e.xKey].add(e.literalKey);
    if (byX[e.xKey].size > 1) return true;
  }

  // AND(GT(x,10), LT(x,5))
  for (const x of Object.keys(lower)) {
    const lo = lower[x];
    const hi = upper[x];
    if (hi !== undefined && lo !== undefined && lo > hi) return true;
  }

  return false;
}

function extractComputeExpression(node: Record<string, unknown>): unknown {
  const compute = asRecord((node as any).compute) ?? asRecord((node as any).data);
  return compute ? (compute as any).expression ?? (compute as any).expr : undefined;
}

function extractPriceComponents(node: Record<string, unknown>): unknown[] {
  const price = asRecord((node as any).price) ?? asRecord((node as any).data);
  const components = price ? (price as any).components : undefined;
  return Array.isArray(components) ? components : [];
}

function extractMaterialEffects(node: Record<string, unknown>): unknown[] {
  const price = asRecord((node as any).price) ?? asRecord((node as any).data);
  const effects = price ? (price as any).materialEffects : undefined;
  return Array.isArray(effects) ? effects : [];
}

function extractChildItemEffects(node: Record<string, unknown>): unknown[] {
  const price = asRecord((node as any).price) ?? asRecord((node as any).data);
  const effects = price ? (price as any).childItemEffects : undefined;
  return Array.isArray(effects) ? effects : [];
}

function normalizeChoicePricingOverride(raw: unknown): {
  mode: ChoicePricingOverrideMode;
  amount?: number;
  unit?: ChoicePricingOverrideUnit;
  appliesTo?: ChoicePricingOverrideAppliesTo;
} | null {
  const override = asRecord(raw);
  if (!override) return null;

  const modeRaw = typeof (override as any).mode === "string" ? String((override as any).mode).trim() : "";
  const mode =
    modeRaw === "none" ||
    modeRaw === "set_base_rate" ||
    modeRaw === "add_base_rate" ||
    modeRaw === "multiply_base_rate"
      ? (modeRaw as ChoicePricingOverrideMode)
      : null;
  if (!mode) return null;

  const amountRaw = (override as any).amount;
  const amount = typeof amountRaw === "number" && Number.isFinite(amountRaw) ? amountRaw : undefined;

  const unitRaw = typeof (override as any).unit === "string" ? String((override as any).unit).trim() : "";
  const unit =
    unitRaw === "perSqft" || unitRaw === "perPiece" || unitRaw === "minimumCharge"
      ? (unitRaw as ChoicePricingOverrideUnit)
      : undefined;

  const appliesToRaw = typeof (override as any).appliesTo === "string" ? String((override as any).appliesTo).trim() : "";
  const appliesTo =
    appliesToRaw === "base" || appliesToRaw === "area" || appliesToRaw === "quantity"
      ? (appliesToRaw as ChoicePricingOverrideAppliesTo)
      : undefined;

  return {
    mode,
    ...(amount !== undefined ? { amount } : {}),
    ...(unit ? { unit } : {}),
    ...(appliesTo ? { appliesTo } : {}),
  };
}

function inferChoicePricingOverrideUnit(
  override: Pick<{ unit?: ChoicePricingOverrideUnit; appliesTo?: ChoicePricingOverrideAppliesTo }, "unit" | "appliesTo">
): ChoicePricingOverrideUnit | undefined {
  if (override.unit) return override.unit;
  if (override.appliesTo === "area") return "perSqft";
  if (override.appliesTo === "quantity") return "perPiece";
  if (override.appliesTo === "base") return "minimumCharge";
  return undefined;
}

function collectGroupChildSelectionKeys(
  groupId: string,
  nodesById: Record<string, NodeRec>,
  edges: EdgeRec[]
): Set<string> {
  const selectionKeys = new Set<string>();
  for (const edge of edges) {
    if (edge.fromNodeId !== groupId || !edge.toNodeId) continue;
    const child = nodesById[edge.toNodeId];
    if (!child || child.type !== "INPUT" || !child.selectionKey) continue;
    selectionKeys.add(child.selectionKey);
  }
  return selectionKeys;
}

function walkVisibilityRuleSelectionKeys(
  rule: unknown,
  visit: (selectionKey: string, ruleType: VisibilityRuleType) => void
): void {
  const rec = asRecord(rule);
  if (!rec) return;
  const type = typeof (rec as any).type === "string" ? String((rec as any).type) as VisibilityRuleType : null;
  if (!type) return;

  switch (type) {
    case "equals":
    case "notEquals":
    case "in":
    case "truthy":
      if (isNonEmptyString((rec as any).selectionKey)) {
        visit(String((rec as any).selectionKey), type);
      }
      return;
    case "and":
    case "or": {
      const rules = Array.isArray((rec as any).rules) ? (rec as any).rules : [];
      rules.forEach((child: unknown) => walkVisibilityRuleSelectionKeys(child, visit));
      return;
    }
    case "not":
      walkVisibilityRuleSelectionKeys((rec as any).rule, visit);
      return;
    default:
      return;
  }
}

function validateVisibilityRuleStructure(
  rule: unknown,
  path: string,
  findings: Finding[],
  entityId: string
): void {
  const rec = asRecord(rule);
  if (!rec) {
    findings.push(
      warningFinding({
        code: "PBV2_W_VISIBILITY_RULE_INVALID",
        message: "Visibility rule must be an object",
        path,
        entityId,
      })
    );
    return;
  }

  const type = typeof (rec as any).type === "string" ? String((rec as any).type) as VisibilityRuleType : null;
  if (
    type !== "equals" &&
    type !== "notEquals" &&
    type !== "in" &&
    type !== "truthy" &&
    type !== "and" &&
    type !== "or" &&
    type !== "not"
  ) {
    findings.push(
      warningFinding({
        code: "PBV2_W_VISIBILITY_RULE_INVALID",
        message: "Visibility rule type is invalid",
        path: `${path}.type`,
        entityId,
      })
    );
    return;
  }

  if (type === "equals" || type === "notEquals" || type === "truthy" || type === "in") {
    if (!isNonEmptyString((rec as any).selectionKey)) {
      findings.push(
        warningFinding({
          code: "PBV2_W_VISIBILITY_RULE_INVALID",
          message: "Visibility rule requires selectionKey",
          path: `${path}.selectionKey`,
          entityId,
        })
      );
    }
  }

  if (type === "in" && !Array.isArray((rec as any).values)) {
    findings.push(
      warningFinding({
        code: "PBV2_W_VISIBILITY_RULE_INVALID",
        message: "Visibility rule type 'in' requires values[]",
        path: `${path}.values`,
        entityId,
      })
    );
  }

  if (type === "and" || type === "or") {
    const rules = Array.isArray((rec as any).rules) ? (rec as any).rules : [];
    if (rules.length === 0) {
      findings.push(
        warningFinding({
          code: "PBV2_W_VISIBILITY_RULE_INVALID",
          message: `Visibility rule type '${type}' requires at least one child rule`,
          path: `${path}.rules`,
          entityId,
        })
      );
    }
    rules.forEach((child: unknown, idx: number) => validateVisibilityRuleStructure(child, `${path}.rules[${idx}]`, findings, entityId));
  }

  if (type === "not") {
    if (!asRecord((rec as any).rule)) {
      findings.push(
        warningFinding({
          code: "PBV2_W_VISIBILITY_RULE_INVALID",
          message: "Visibility rule type 'not' requires a child rule",
          path: `${path}.rule`,
          entityId,
        })
      );
      return;
    }
    validateVisibilityRuleStructure((rec as any).rule, `${path}.rule`, findings, entityId);
  }
}

function extractEffectOutputs(node: Record<string, unknown>): unknown[] {
  const eff = asRecord((node as any).effect) ?? asRecord((node as any).data);
  const outputs = eff ? (eff as any).outputs : undefined;
  return Array.isArray(outputs) ? outputs : [];
}

function findDivByZeroFindings(expr: unknown, opts: { strict: boolean; pathBase: string; entityId?: string }): Finding[] {
  const findings: Finding[] = [];

  const guardedDivPaths = new Set<string>();

  const isLiteralZero = (e: any): boolean => e?.op === "literal" && e.value === 0;

  const exprEquals = (a: unknown, b: unknown): boolean => stableStringify(a) === stableStringify(b);

  const markGuardedFromIf = (node: any, base: string) => {
    if (!node || typeof node !== "object" || node.op !== "if") return;
    const elseExpr = node.else;
    if (!elseExpr || typeof elseExpr !== "object" || elseExpr.op !== "div") return;

    const denom = elseExpr.right;
    const cond = node.cond;

    const isEqZero = (c: any): boolean =>
      c?.op === "eq" && ((exprEquals(c.left, denom) && isLiteralZero(c.right)) || (exprEquals(c.right, denom) && isLiteralZero(c.left)));

    if (isEqZero(cond) && isLiteralZero(node.then)) {
      guardedDivPaths.add(`${base}.else`);
    }
  };

  const denomIsClampPositive = (denom: any): boolean => {
    if (!denom || typeof denom !== "object") return false;
    if (denom.op !== "clamp") return false;
    const lo = denom.lo;
    return lo?.op === "literal" && typeof lo.value === "number" && lo.value > 0;
  };

  const walk = (node: any, path: string) => {
    if (!node || typeof node !== "object") return;

    if (node.op === "if") {
      markGuardedFromIf(node, path);
    }

    if (node.op === "div") {
      const denom = node.right;
      if (isLiteralZero(denom)) {
        findings.push(
          errorFinding({
            code: "PBV2_E_EXPR_DIV_BY_ZERO_UNGUARDED",
            message: "Division by literal zero is not allowed",
            path,
            entityId: opts.entityId,
          })
        );
      } else if (guardedDivPaths.has(path) || denomIsClampPositive(denom)) {
        // ok
      } else {
        const sev = opts.strict ? "ERROR" : "WARNING";
        findings.push({
          code: "PBV2_E_EXPR_DIV_BY_ZERO_UNGUARDED",
          severity: sev,
          message: "Division denominator may be zero; guard required (if/eq-zero or clamp)",
          path,
          entityId: opts.entityId,
        } as Finding);
      }
    }

    for (const [k, v] of Object.entries(node)) {
      if (k === "op") continue;
      if (v && typeof v === "object") {
        if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${path}.${k}[${i}]`));
        else walk(v, `${path}.${k}`);
      }
    }
  };

  walk(expr as any, opts.pathBase);
  return findings;
}

function detectDirectedCycle(nodes: string[], edges: Array<[string, string]>): string[] | null {
  const adj: Record<string, string[]> = {};
  for (const n of nodes) adj[n] = [];
  for (const [a, b] of edges) {
    if (!adj[a]) adj[a] = [];
    adj[a].push(b);
  }
  for (const n of Object.keys(adj)) adj[n].sort();

  const visited = new Set<string>();
  const stack = new Set<string>();
  const parent: Record<string, string | null> = {};

  const dfs = (u: string): string[] | null => {
    visited.add(u);
    stack.add(u);

    for (const v of adj[u] ?? []) {
      if (!visited.has(v)) {
        parent[v] = u;
        const r = dfs(v);
        if (r) return r;
      } else if (stack.has(v)) {
        // Found a back edge u -> v, reconstruct cycle
        const cycle: string[] = [v];
        let cur: string | null = u;
        while (cur && cur !== v) {
          cycle.push(cur);
          cur = parent[cur] ?? null;
        }
        cycle.push(v);
        cycle.reverse();
        return cycle;
      }
    }

    stack.delete(u);
    return null;
  };

  for (const n of nodes.slice().sort()) {
    if (!visited.has(n)) {
      parent[n] = null;
      const r = dfs(n);
      if (r) return r;
    }
  }

  return null;
}

function sortFindings(findings: Finding[]): Finding[] {
  const sevRank = (s: string): number => (s === "ERROR" ? 0 : s === "WARNING" ? 1 : 2);

  return findings
    .slice()
    .sort((a, b) => {
      const sa = sevRank(a.severity);
      const sb = sevRank(b.severity);
      if (sa !== sb) return sa - sb;
      if (a.code !== b.code) return a.code.localeCompare(b.code);
      if (a.path !== b.path) return a.path.localeCompare(b.path);
      const ea = a.entityId ?? "";
      const eb = b.entityId ?? "";
      if (ea !== eb) return ea.localeCompare(eb);
      return a.message.localeCompare(b.message);
    });
}

function toResult(findings: Finding[]): ValidationResult {
  const sorted = sortFindings(findings);
  const errors = sorted.filter((f) => f.severity === "ERROR");
  const warnings = sorted.filter((f) => f.severity === "WARNING");
  const info = sorted.filter((f) => f.severity === "INFO");
  return { ok: errors.length === 0, findings: sorted, errors, warnings, info };
}

function getRuleCollections(tree: Record<string, unknown>): Array<{ path: string; value: unknown }> {
  const meta = asRecord((tree as any).meta);
  return [
    { path: "tree.rules", value: (tree as any).rules },
    { path: "tree.optionRules", value: (tree as any).optionRules },
    { path: "tree.meta.optionRules", value: meta ? (meta as any).optionRules : undefined },
  ].filter((entry) => entry.value !== undefined);
}

function getPricingMatrixCandidates(tree: Record<string, unknown>): Array<{ path: string; value: unknown }> {
  const meta = asRecord((tree as any).meta);
  return [
    { path: "tree.pricingMatrix", value: (tree as any).pricingMatrix },
    { path: "tree.meta.pricingMatrix", value: meta ? (meta as any).pricingMatrix : undefined },
  ].filter((entry) => entry.value !== undefined);
}

function getInputOptionContext(nodes: NodeRec[]): {
  knownSelectionKeys: Set<string>;
  choiceValuesBySelectionKey: Record<string, Set<string>>;
  booleanSelectionKeys: Set<string>;
} {
  const knownSelectionKeys = new Set<string>();
  const choiceValuesBySelectionKey: Record<string, Set<string>> = {};
  const booleanSelectionKeys = new Set<string>();

  for (const node of nodes) {
    if (node.status === "DELETED" || node.type !== "INPUT" || !node.selectionKey) continue;
    knownSelectionKeys.add(node.selectionKey);

    const input = asRecord((node.raw as any).input) ?? asRecord((node.raw as any).data);
    const typeRaw = String((input as any)?.type ?? (input as any)?.valueType ?? "").toLowerCase();
    if (typeRaw === "boolean" || typeRaw === "bool") booleanSelectionKeys.add(node.selectionKey);

    const choices = (node.raw as any).choices;
    if (!Array.isArray(choices)) continue;
    const values = new Set<string>();
    for (const choiceRaw of choices) {
      const choice = asRecord(choiceRaw);
      if (!choice || !Object.prototype.hasOwnProperty.call(choice, "value")) continue;
      values.add(stableStringify((choice as any).value));
    }
    if (values.size > 0) choiceValuesBySelectionKey[node.selectionKey] = values;
  }

  return { knownSelectionKeys, choiceValuesBySelectionKey, booleanSelectionKeys };
}

function optionValueIsKnown(
  optionGroup: string,
  value: unknown,
  context: ReturnType<typeof getInputOptionContext>
): boolean {
  const choices = context.choiceValuesBySelectionKey[optionGroup];
  if (choices && choices.size > 0) return choices.has(stableStringify(value));
  if (context.booleanSelectionKeys.has(optionGroup)) return typeof value === "boolean";
  return true;
}

function validateRuleConditionValue(
  condition: Record<string, unknown>,
  path: string,
  findings: Finding[],
  ruleId: string,
  context: ReturnType<typeof getInputOptionContext>
): void {
  const optionGroup = isNonEmptyString((condition as any).optionGroup) ? String((condition as any).optionGroup) : "";
  const operator = typeof (condition as any).operator === "string" ? String((condition as any).operator) : "";
  if (!optionGroup || !OPTION_RULE_OPERATORS.has(operator)) return;

  if (operator === "exists" || operator === "not_exists") return;

  if (!Object.prototype.hasOwnProperty.call(condition, "value")) {
    findings.push(
      errorFinding({
        code: "PBV2_E_OPTION_RULE_CONDITION_INVALID",
        message: `Rule '${ruleId}' condition using '${operator}' requires a value`,
        path: `${path}.value`,
        entityId: ruleId,
      })
    );
    return;
  }

  const rawValue = (condition as any).value;
  const values = operator === "in" || operator === "not_in" ? rawValue : [rawValue];
  if ((operator === "in" || operator === "not_in") && (!Array.isArray(rawValue) || rawValue.length === 0)) {
    findings.push(
      errorFinding({
        code: "PBV2_E_OPTION_RULE_CONDITION_INVALID",
        message: `Rule '${ruleId}' condition '${operator}' requires a non-empty value array`,
        path: `${path}.value`,
        entityId: ruleId,
      })
    );
    return;
  }

  for (const value of values as unknown[]) {
    if (!optionValueIsKnown(optionGroup, value, context)) {
      findings.push(
        errorFinding({
          code: "PBV2_E_OPTION_RULE_VALUE_UNKNOWN",
          message: `Rule '${ruleId}' references value '${String(value)}' that is not valid for option group '${optionGroup}'`,
          path: `${path}.value`,
          entityId: ruleId,
          context: { optionGroup, value },
        })
      );
    }
  }
}

function validateRuleActions(
  actionsRaw: unknown,
  path: string,
  findings: Finding[],
  ruleId: string,
  context: ReturnType<typeof getInputOptionContext>
): void {
  if (!Array.isArray(actionsRaw)) {
    findings.push(
      errorFinding({
        code: "PBV2_E_OPTION_RULE_INVALID_STRUCTURE",
        message: `Rule '${ruleId}' ${path.endsWith(".then") ? "then" : "else"} actions must be an array`,
        path,
        entityId: ruleId,
      })
    );
    return;
  }

  const actionsByTarget = new Map<string, Set<string>>();
  actionsRaw.forEach((actionRaw, index) => {
    const action = asRecord(actionRaw);
    const actionPath = `${path}[${index}]`;
    if (!action) {
      findings.push(
        errorFinding({
          code: "PBV2_E_OPTION_RULE_INVALID_STRUCTURE",
          message: `Rule '${ruleId}' action must be an object`,
          path: actionPath,
          entityId: ruleId,
        })
      );
      return;
    }

    const actionType = typeof (action as any).action === "string" ? String((action as any).action) : "";
    if (!OPTION_RULE_ACTIONS.has(actionType)) {
      findings.push(
        errorFinding({
          code: "PBV2_E_OPTION_RULE_ACTION_INVALID",
          message: `Rule '${ruleId}' action must be one of: ${Array.from(OPTION_RULE_ACTIONS).join(", ")}`,
          path: `${actionPath}.action`,
          entityId: ruleId,
          context: { action: actionType },
        })
      );
    }

    const target = isNonEmptyString((action as any).targetOptionGroup) ? String((action as any).targetOptionGroup) : "";
    if (!target) {
      findings.push(
        errorFinding({
          code: "PBV2_E_OPTION_RULE_TARGET_UNKNOWN",
          message: `Rule '${ruleId}' action requires targetOptionGroup`,
          path: `${actionPath}.targetOptionGroup`,
          entityId: ruleId,
        })
      );
      return;
    }

    if (!context.knownSelectionKeys.has(target)) {
      findings.push(
        errorFinding({
          code: "PBV2_E_OPTION_RULE_TARGET_UNKNOWN",
          message: `Rule '${ruleId}' targets unknown option group '${target}'`,
          path: `${actionPath}.targetOptionGroup`,
          entityId: ruleId,
          context: { targetOptionGroup: target },
        })
      );
    }

    if (actionType === "set_default") {
      if (!Object.prototype.hasOwnProperty.call(action, "value")) {
        findings.push(
          errorFinding({
            code: "PBV2_E_OPTION_RULE_DEFAULT_INVALID",
            message: `Rule '${ruleId}' set_default action requires a value`,
            path: `${actionPath}.value`,
            entityId: ruleId,
          })
        );
      } else if (target && !optionValueIsKnown(target, (action as any).value, context)) {
        findings.push(
          errorFinding({
            code: "PBV2_E_OPTION_RULE_DEFAULT_INVALID",
            message: `Rule '${ruleId}' set_default value '${String((action as any).value)}' is not valid for '${target}'`,
            path: `${actionPath}.value`,
            entityId: ruleId,
            context: { targetOptionGroup: target, value: (action as any).value },
          })
        );
      }
    }

    if (!target || !OPTION_RULE_ACTIONS.has(actionType)) return;
    const targetActions = actionsByTarget.get(target) ?? new Set<string>();
    targetActions.add(actionType);
    actionsByTarget.set(target, targetActions);
  });

  for (const [target, actions] of Array.from(actionsByTarget.entries())) {
    if (actions.has("show") && actions.has("hide")) {
      findings.push(
        errorFinding({
          code: "PBV2_E_OPTION_RULE_ACTION_CONFLICT",
          message: `Rule '${ruleId}' both shows and hides '${target}' in the same action branch`,
          path,
          entityId: ruleId,
          context: { targetOptionGroup: target, actions: ["show", "hide"] },
        })
      );
    }
    if (actions.has("enable") && actions.has("disable")) {
      findings.push(
        errorFinding({
          code: "PBV2_E_OPTION_RULE_ACTION_CONFLICT",
          message: `Rule '${ruleId}' both enables and disables '${target}' in the same action branch`,
          path,
          entityId: ruleId,
          context: { targetOptionGroup: target, actions: ["enable", "disable"] },
        })
      );
    }
  }
}

function validateProductOptionRules(
  tree: Record<string, unknown>,
  findings: Finding[],
  context: ReturnType<typeof getInputOptionContext>
): void {
  for (const collection of getRuleCollections(tree)) {
    if (!Array.isArray(collection.value)) {
      findings.push(
        errorFinding({
          code: "PBV2_E_OPTION_RULE_INVALID_STRUCTURE",
          message: "Option rules must be an array",
          path: collection.path,
        })
      );
      continue;
    }

    collection.value.forEach((ruleRaw, ruleIndex) => {
      const rule = asRecord(ruleRaw);
      const rulePath = `${collection.path}[${ruleIndex}]`;
      const ruleId = rule && isNonEmptyString((rule as any).id) ? String((rule as any).id) : `rule_${ruleIndex + 1}`;

      if (!rule) {
        findings.push(
          errorFinding({
            code: "PBV2_E_OPTION_RULE_INVALID_STRUCTURE",
            message: "Option rule must be an object",
            path: rulePath,
            entityId: ruleId,
          })
        );
        return;
      }

      if (!isNonEmptyString((rule as any).id)) {
        findings.push(
          errorFinding({
            code: "PBV2_E_OPTION_RULE_INVALID_STRUCTURE",
            message: "Option rule id is required",
            path: `${rulePath}.id`,
            entityId: ruleId,
          })
        );
      }

      if ((rule as any).enabled !== undefined && typeof (rule as any).enabled !== "boolean") {
        findings.push(
          errorFinding({
            code: "PBV2_E_OPTION_RULE_INVALID_STRUCTURE",
            message: `Rule '${ruleId}' enabled must be boolean when provided`,
            path: `${rulePath}.enabled`,
            entityId: ruleId,
          })
        );
      }

      const when = asRecord((rule as any).when);
      if (!when) {
        findings.push(
          errorFinding({
            code: "PBV2_E_OPTION_RULE_INVALID_STRUCTURE",
            message: `Rule '${ruleId}' requires a when condition group`,
            path: `${rulePath}.when`,
            entityId: ruleId,
          })
        );
      } else {
        const hasAll = Object.prototype.hasOwnProperty.call(when, "all");
        const hasAny = Object.prototype.hasOwnProperty.call(when, "any");
        if (hasAll === hasAny) {
          findings.push(
            errorFinding({
              code: "PBV2_E_OPTION_RULE_CONDITION_GROUP_INVALID",
              message: `Rule '${ruleId}' when must contain exactly one of all or any`,
              path: `${rulePath}.when`,
              entityId: ruleId,
            })
          );
        }

        const groupKey = hasAll ? "all" : "any";
        const conditions = (when as any)[groupKey];
        if (!Array.isArray(conditions) || conditions.length === 0) {
          findings.push(
            errorFinding({
              code: "PBV2_E_OPTION_RULE_CONDITION_GROUP_INVALID",
              message: `Rule '${ruleId}' when.${groupKey} must be a non-empty array`,
              path: `${rulePath}.when.${groupKey}`,
              entityId: ruleId,
            })
          );
        } else {
          conditions.forEach((conditionRaw: unknown, conditionIndex: number) => {
            const condition = asRecord(conditionRaw);
            const conditionPath = `${rulePath}.when.${groupKey}[${conditionIndex}]`;
            if (!condition) {
              findings.push(
                errorFinding({
                  code: "PBV2_E_OPTION_RULE_CONDITION_INVALID",
                  message: `Rule '${ruleId}' condition must be an object`,
                  path: conditionPath,
                  entityId: ruleId,
                })
              );
              return;
            }

            const optionGroup = isNonEmptyString((condition as any).optionGroup) ? String((condition as any).optionGroup) : "";
            if (!optionGroup || !context.knownSelectionKeys.has(optionGroup)) {
              findings.push(
                errorFinding({
                  code: "PBV2_E_OPTION_RULE_OPTION_GROUP_UNKNOWN",
                  message: `Rule '${ruleId}' references unknown option group '${optionGroup || "(missing)"}'`,
                  path: `${conditionPath}.optionGroup`,
                  entityId: ruleId,
                  context: { optionGroup },
                })
              );
            }

            const operator = typeof (condition as any).operator === "string" ? String((condition as any).operator) : "";
            if (!OPTION_RULE_OPERATORS.has(operator)) {
              findings.push(
                errorFinding({
                  code: "PBV2_E_OPTION_RULE_OPERATOR_INVALID",
                  message: `Rule '${ruleId}' operator must be one of: ${Array.from(OPTION_RULE_OPERATORS).join(", ")}`,
                  path: `${conditionPath}.operator`,
                  entityId: ruleId,
                  context: { operator },
                })
              );
            }

            validateRuleConditionValue(condition, conditionPath, findings, ruleId, context);
          });
        }
      }

      validateRuleActions((rule as any).then, `${rulePath}.then`, findings, ruleId, context);
      if ((rule as any).else !== undefined) {
        validateRuleActions((rule as any).else, `${rulePath}.else`, findings, ruleId, context);
      }
    });
  }
}

/**
 * Full option rules can mutate selections and visibility.  Their references
 * therefore form a Product-configuration dependency graph separate from the
 * native node-visibility graph below.  Reject only direct, proven feedback
 * loops and identical-condition opposing actions; independent conditions keep
 * their established ordered evaluation semantics.
 */
function validateProductOptionRuleDependencySafety(
  tree: Record<string, unknown>,
  findings: Finding[],
): void {
  const edges = new Map<string, Set<string>>();
  const actionByConditionTarget = new Map<string, { action: string; ruleId: string; path: string }>();
  const feedbackActions = new Set(["show", "hide", "disable", "enable", "clear", "set_default"]);
  const opposite = (left: string, right: string) =>
    (left === "show" && right === "hide") ||
    (left === "hide" && right === "show") ||
    (left === "enable" && right === "disable") ||
    (left === "disable" && right === "enable");

  for (const collection of getRuleCollections(tree)) {
    if (!Array.isArray(collection.value)) continue;
    collection.value.forEach((rawRule, ruleIndex) => {
      const rule = asRecord(rawRule);
      if (!rule || rule.enabled === false) return;
      const ruleId = isNonEmptyString((rule as any).id) ? String((rule as any).id) : `rule_${ruleIndex + 1}`;
      const when = asRecord((rule as any).when);
      const conditions = Array.isArray((when as any)?.all)
        ? (when as any).all
        : Array.isArray((when as any)?.any)
          ? (when as any).any
          : [];
      const sources = (conditions as unknown[])
        .map((entry: unknown) => asRecord(entry))
        .map((condition: Record<string, unknown> | null) => condition && isNonEmptyString((condition as any).optionGroup) ? String((condition as any).optionGroup) : null)
        .filter((value: string | null): value is string => Boolean(value));
      const conditionKey = stableStringify(when);
      for (const branch of ["then", "else"] as const) {
        const actions = Array.isArray((rule as any)[branch]) ? (rule as any)[branch] : [];
        actions.forEach((rawAction: unknown, actionIndex: number) => {
          const action = asRecord(rawAction);
          const actionType = typeof (action as any)?.action === "string" ? String((action as any).action) : "";
          const target = isNonEmptyString((action as any)?.targetOptionGroup) ? String((action as any).targetOptionGroup) : "";
          if (!target || !feedbackActions.has(actionType)) return;
          const path = `${collection.path}[${ruleIndex}].${branch}[${actionIndex}]`;
          for (const source of sources) {
            const next = edges.get(source) ?? new Set<string>();
            next.add(target);
            edges.set(source, next);
          }
          const key = `${conditionKey}:${branch}:${target}`;
          const prior = actionByConditionTarget.get(key);
          if (prior && opposite(prior.action, actionType)) {
            findings.push(errorFinding({
              code: "PBV2_E_OPTION_RULE_ACTION_CONFLICT",
              message: `Rules '${prior.ruleId}' and '${ruleId}' apply opposing ${prior.action}/${actionType} actions to '${target}' for the same condition.`,
              path,
              entityId: ruleId,
              context: { targetOptionGroup: target, ruleIds: [prior.ruleId, ruleId] },
            }));
          }
          actionByConditionTarget.set(key, { action: actionType, ruleId, path });
        });
      }
    });
  }

  const visiting = new Set<string>();
  const visited = new Set<string>();
  const stack: string[] = [];
  const visit = (node: string): string[] | null => {
    if (visiting.has(node)) return [...stack.slice(stack.indexOf(node)), node];
    if (visited.has(node)) return null;
    visiting.add(node); stack.push(node);
    for (const target of edges.get(node) ?? []) {
      const cycle = visit(target);
      if (cycle) return cycle;
    }
    stack.pop(); visiting.delete(node); visited.add(node);
    return null;
  };
  for (const node of edges.keys()) {
    const cycle = visit(node);
    if (!cycle) continue;
    findings.push(errorFinding({
      code: "PBV2_E_OPTION_RULE_DEPENDENCY_CYCLE",
      message: "Option rules contain a visibility/default dependency cycle.",
      path: "tree.optionRules",
      context: { cycle },
    }));
    break;
  }
}

function getMatrixRowMatch(row: Record<string, unknown>): { key: "match" | "when" | "combination"; value: unknown } | null {
  if (Object.prototype.hasOwnProperty.call(row, "match")) return { key: "match", value: (row as any).match };
  if (Object.prototype.hasOwnProperty.call(row, "when")) return { key: "when", value: (row as any).when };
  if (Object.prototype.hasOwnProperty.call(row, "combination")) return { key: "combination", value: (row as any).combination };
  return null;
}

function getMatrixRowVariables(row: Record<string, unknown>): { key: "variables" | "values"; value: unknown } | null {
  if (Object.prototype.hasOwnProperty.call(row, "variables")) return { key: "variables", value: (row as any).variables };
  if (Object.prototype.hasOwnProperty.call(row, "values")) return { key: "values", value: (row as any).values };
  return null;
}

function numericRecord(value: unknown): Record<string, number> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out: Record<string, number> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    const numeric = Number(raw);
    if (key && Number.isFinite(numeric)) out[key] = numeric;
  }
  return out;
}

function formulaReferencesSymbol(formula: unknown, symbol: string): boolean {
  if (typeof formula !== "string" || !formula.trim()) return false;
  const escaped = symbol.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`\\b${escaped}\\b`).test(formula);
}

function formulaUsesSqftPricing(formula: unknown): boolean {
  if (typeof formula !== "string" || !formula.trim()) return false;
  return /\b(?:total_sqft|sqft|w|h|width|height|base_price|p)\b/i.test(formula);
}

function hasConfiguredFormulaVariable(meta: Record<string, unknown> | null, key: string): boolean {
  const variables = {
    ...numericRecord(meta?.pricingFormulaVariables),
    ...numericRecord(meta?.formulaVariables),
  };
  return Number.isFinite(variables[key]);
}

function validateFormulaVariableReferences(
  findings: Finding[],
  meta: Record<string, unknown> | null,
  formula: unknown,
  path: string,
  label: string,
): void {
  if (formulaReferencesSymbol(formula, "flatFee") && !hasConfiguredFormulaVariable(meta, "flatFee")) {
    findings.push(
      errorFinding({
        code: "PBV2_E_FORMULA_FLAT_FEE_MISSING",
        message: `${label} references flatFee, but no flat fee amount is configured.`,
        path,
        context: { missingSymbol: "flatFee" },
      })
    );
  }
}

function hasMatrixRowQtyTiers(row: Record<string, unknown>): boolean {
  return Array.isArray((row as any).qtyTiers) && (row as any).qtyTiers.length > 0;
}

/** Matrix tiers use established lower-bound semantics.  They may be paired
 * with a static matrix price (which covers quantities below the first tier),
 * so unlike the product-level quantity-only family they are not required to
 * begin at one or be contiguous.  They must still be executable by the
 * runtime: a recognized basis, strictly increasing positive bounds, and at
 * least one positive rate per tier. */
function validateMatrixRowQtyTiers(
  row: Record<string, unknown>,
  rowPath: string,
  rowLabel: string,
  findings: Finding[],
): void {
  if (!Array.isArray((row as any).qtyTiers)) return;

  const tierBasis = (row as any).tierBasis;
  if (tierBasis !== undefined && !["line_item_quantity", "computed_sheet_usage", "product_default"].includes(String(tierBasis))) {
    findings.push(errorFinding({
      code: "PBV2_E_PRICING_MATRIX_TIER_BASIS_INVALID",
      message: `Pricing matrix ${rowLabel} has an unsupported quantity-tier basis.`,
      path: `${rowPath}.tierBasis`,
      context: { rowId: (row as any).id ?? null, tierBasis },
    }));
  }

  let previousMin: number | null = null;
  for (const [tierIndex, rawTier] of (row as any).qtyTiers.entries()) {
    const tier = asRecord(rawTier);
    const tierPath = `${rowPath}.qtyTiers[${tierIndex}]`;
    const minQty = Number(tier?.minQty);
    if (!tier || !Number.isFinite(minQty) || minQty <= 0) {
      findings.push(errorFinding({
        code: "PBV2_E_PRICING_MATRIX_TIER_BOUND_INVALID",
        message: `Every quantity tier in pricing matrix ${rowLabel} requires a positive numeric minimum.`,
        path: `${tierPath}.minQty`,
        context: { rowId: (row as any).id ?? null },
      }));
      continue;
    }
    if (previousMin !== null && minQty <= previousMin) {
      findings.push(errorFinding({
        code: "PBV2_E_PRICING_MATRIX_TIER_ORDER_INVALID",
        message: `Quantity tiers in pricing matrix ${rowLabel} must be strictly increasing.`,
        path: `${tierPath}.minQty`,
        context: { rowId: (row as any).id ?? null },
      }));
    }
    previousMin = minQty;
    const hasPositiveRate = ["perSqftCents", "perPieceCents", "minimumChargeCents"]
      .some((field) => Number.isFinite(Number((tier as any)[field])) && Number((tier as any)[field]) > 0);
    if (!hasPositiveRate) {
      findings.push(errorFinding({
        code: "PBV2_E_PRICING_MATRIX_TIER_RATE_MISSING",
        message: `Every quantity tier in pricing matrix ${rowLabel} requires a positive PBV2 price rate.`,
        path: tierPath,
        context: { rowId: (row as any).id ?? null },
      }));
    }
  }
}

function validatePricingMatrices(
  tree: Record<string, unknown>,
  findings: Finding[],
  context: ReturnType<typeof getInputOptionContext>
): void {
  for (const candidate of getPricingMatrixCandidates(tree)) {
    const matrix = asRecord(candidate.value);
    if (!matrix || Array.isArray(candidate.value)) {
      findings.push(
        errorFinding({
          code: "PBV2_E_PRICING_MATRIX_INVALID_STRUCTURE",
          message: "Pricing matrix must be an object with dimensions and rows",
          path: candidate.path,
        })
      );
      continue;
    }

    const dimensionsRaw = (matrix as any).dimensions;
    const rowsRaw = (matrix as any).rows;
    const dimensions = Array.isArray(dimensionsRaw)
      ? dimensionsRaw.filter(isNonEmptyString).map(String)
      : [];
    const dimensionSet = new Set(dimensions);

    if (!Array.isArray(dimensionsRaw) || dimensions.length === 0 || dimensions.length !== dimensionsRaw.length) {
      findings.push(
        errorFinding({
          code: "PBV2_E_PRICING_MATRIX_INVALID_STRUCTURE",
          message: "Pricing matrix dimensions must be a non-empty array of option groups",
          path: `${candidate.path}.dimensions`,
        })
      );
    }

    for (const dimension of dimensions) {
      if (!context.knownSelectionKeys.has(dimension)) {
        findings.push(
          errorFinding({
            code: "PBV2_E_PRICING_MATRIX_DIMENSION_UNKNOWN",
            message: `Pricing matrix dimension '${dimension}' does not match a known option group`,
            path: `${candidate.path}.dimensions`,
            context: { dimension },
          })
        );
      }
    }

    if (!Array.isArray(rowsRaw) || rowsRaw.length === 0) {
      findings.push(
        errorFinding({
          code: "PBV2_E_PRICING_MATRIX_INVALID_STRUCTURE",
          message: "Pricing matrix rows must be a non-empty array",
          path: `${candidate.path}.rows`,
        })
      );
      continue;
    }

    const seenCombinations = new Map<string, number>();
    rowsRaw.forEach((rowRaw: unknown, rowIndex: number) => {
      const row = asRecord(rowRaw);
      const rowPath = `${candidate.path}.rows[${rowIndex}]`;
      const rowLabel = row && isNonEmptyString((row as any).id) ? String((row as any).id) : `row ${rowIndex + 1}`;

      if (!row) {
        findings.push(
          errorFinding({
            code: "PBV2_E_PRICING_MATRIX_INVALID_STRUCTURE",
            message: "Pricing matrix row must be an object",
            path: rowPath,
          })
        );
        return;
      }

      validateMatrixRowQtyTiers(row, rowPath, rowLabel, findings);

      const matchEntry = getMatrixRowMatch(row);
      const match = matchEntry ? asRecord(matchEntry.value) : null;
      if (!match) {
        findings.push(
          errorFinding({
            code: "PBV2_E_PRICING_MATRIX_ROW_MATCH_INVALID",
            message: `Pricing matrix ${rowLabel} requires a match object`,
            path: `${rowPath}.match`,
            context: { rowId: (row as any).id ?? null },
          })
        );
      } else {
        for (const key of Object.keys(match)) {
          if (!dimensionSet.has(key)) {
            findings.push(
              errorFinding({
                code: "PBV2_E_PRICING_MATRIX_ROW_MATCH_INVALID",
                message: `Pricing matrix ${rowLabel} has match key '${key}' that is not listed in dimensions`,
                path: `${rowPath}.${matchEntry!.key}.${key}`,
                context: { rowId: (row as any).id ?? null, dimension: key },
              })
            );
          }
        }

        for (const dimension of dimensions) {
          if (!Object.prototype.hasOwnProperty.call(match, dimension)) {
            findings.push(
              errorFinding({
                code: "PBV2_E_PRICING_MATRIX_ROW_MISSING_DIMENSION",
                message: `Pricing matrix ${rowLabel} is missing required dimension '${dimension}'`,
                path: `${rowPath}.${matchEntry!.key}`,
                context: { rowId: (row as any).id ?? null, dimension },
              })
            );
            continue;
          }

          const value = (match as any)[dimension];
          if (!optionValueIsKnown(dimension, value, context)) {
            findings.push(
              errorFinding({
                code: "PBV2_E_PRICING_MATRIX_ROW_VALUE_INVALID",
                message: `Pricing matrix ${rowLabel} uses invalid value '${String(value)}' for '${dimension}'`,
                path: `${rowPath}.${matchEntry!.key}.${dimension}`,
                context: { rowId: (row as any).id ?? null, dimension, value },
              })
            );
          }
        }

        const comboKey = dimensions.map((dimension) => `${dimension}:${stableStringify((match as any)[dimension])}`).join("|");
        if (dimensions.length > 0 && Array.from(dimensionSet).every((dimension) => Object.prototype.hasOwnProperty.call(match, dimension))) {
          const existingIndex = seenCombinations.get(comboKey);
          if (existingIndex !== undefined) {
            findings.push(
              errorFinding({
                code: "PBV2_E_PRICING_MATRIX_ROW_DUPLICATE",
                message: `Pricing matrix ${rowLabel} duplicates row ${existingIndex + 1} for the same option combination`,
                path: rowPath,
                context: { rowId: (row as any).id ?? null, duplicateOfRowIndex: existingIndex, combination: comboKey },
              })
            );
          } else {
            seenCombinations.set(comboKey, rowIndex);
          }
        }
      }

      const variablesEntry = getMatrixRowVariables(row);
      const variables = variablesEntry ? asRecord(variablesEntry.value) : null;
      if (!variables) {
        if (!hasMatrixRowQtyTiers(row)) {
          findings.push(
            errorFinding({
              code: "PBV2_E_PRICING_MATRIX_VARIABLE_INVALID",
              message: `Pricing matrix ${rowLabel} requires numeric variables`,
              path: `${rowPath}.variables`,
              context: { rowId: (row as any).id ?? null },
            })
          );
        }
        return;
      }

      for (const [variable, rawValue] of Object.entries(variables)) {
        if (!isNonEmptyString(variable)) continue;
        if (PBV2_PRICING_MATRIX_PROTECTED_VARIABLES.has(variable)) {
          findings.push(
            errorFinding({
              code: "PBV2_E_PRICING_MATRIX_VARIABLE_PROTECTED",
              message: `Pricing matrix ${rowLabel} cannot override protected built-in '${variable}'`,
              path: `${rowPath}.${variablesEntry!.key}.${variable}`,
              context: { rowId: (row as any).id ?? null, variable },
            })
          );
        }

        const value = Number(rawValue);
        if (!Number.isFinite(value)) {
          findings.push(
            errorFinding({
              code: "PBV2_E_PRICING_MATRIX_VARIABLE_INVALID",
              message: `Pricing matrix ${rowLabel} variable '${variable}' must be a finite number`,
              path: `${rowPath}.${variablesEntry!.key}.${variable}`,
              context: { rowId: (row as any).id ?? null, variable },
            })
          );
        }
      }
    });

    // Publication must not leave an obviously selectable matrix combination
    // without a price. Restrict this proof to finite, unconditioned discrete
    // dimensions: visibility rules and multi-select semantics have their own
    // runtime resolver and are not safe to infer as a blind Cartesian product.
    const hasConditionalRules = getRuleCollections(tree).length > 0;
    const dimensionValues = dimensions.map((dimension) => context.choiceValuesBySelectionKey[dimension]);
    const canProveCoverage = !hasConditionalRules
      && dimensions.length > 0
      && dimensionValues.every((values) => values && values.size > 0)
      && dimensions.every((dimension) => !context.booleanSelectionKeys.has(dimension));
    if (canProveCoverage) {
      const expected = dimensionValues.reduce<string[][]>((combinations, values) =>
        combinations.flatMap((combination) => Array.from(values!).map((value) => [...combination, value])), [[]]);
      for (const values of expected) {
        const combination = dimensions.map((dimension, index) => `${dimension}:${values[index]}`).join("|");
        if (seenCombinations.has(combination)) continue;
        const display = dimensions.map((dimension, index) => `${dimension}=${values[index]}`).join(", ");
        findings.push(errorFinding({
          code: "PBV2_E_PRICING_MATRIX_COVERAGE_MISSING",
          message: `Pricing matrix is missing an executable row for reachable selection (${display}).`,
          path: `${candidate.path}.rows`,
          context: { combination },
        }));
      }
    }
  }
}

export function validateTreeForPublish(tree: ProductOptionTreeV2Json, opts: ValidateOpts): ValidationResult {
  const policy: ValidateOpts = { ...DEFAULT_VALIDATE_OPTS, ...(opts ?? ({} as any)) };
  const findings: Finding[] = [];

  const t = asRecord(tree);
  if (!t) {
    return toResult([
      errorFinding({
        code: "PBV2_E_TREE_STATUS_INVALID",
        message: "Tree must be an object",
        path: "tree",
      }),
    ]);
  }

  const status = (t as any).status;
  if (String(status).toUpperCase() !== "DRAFT") {
    findings.push(
      errorFinding({
        code: "PBV2_E_TREE_STATUS_INVALID",
        message: "Tree status must be DRAFT at time of publish",
        path: "tree.status",
        context: { status },
      })
    );
  }

  const rootNodeIds = Array.isArray((t as any).rootNodeIds) ? ((t as any).rootNodeIds as unknown[]) : [];
  if (rootNodeIds.length === 0) {
    findings.push(
      errorFinding({
        code: "PBV2_E_TREE_NO_ROOTS",
        message: "rootNodeIds must exist and include at least one ENABLED runtime node",
        path: "tree.rootNodeIds",
      })
    );
  }

  const nodes = extractNodes(t);
  const edges = extractEdges(t);

  const nodesById: Record<string, NodeRec> = {};
  const nodeIdCounts: Record<string, number> = {};
  for (const n of nodes) {
    nodeIdCounts[n.id] = (nodeIdCounts[n.id] ?? 0) + 1;
    nodesById[n.id] = n;
  }
  const dupNodeIds = Object.entries(nodeIdCounts)
    .filter(([, c]) => c > 1)
    .map(([id]) => id)
    .sort();
  if (dupNodeIds.length > 0) {
    findings.push(
      errorFinding({
        code: "PBV2_E_TREE_DUPLICATE_IDS",
        message: "Node IDs must be unique",
        path: "tree.nodes",
        context: { duplicateNodeIds: dupNodeIds },
      })
    );
  }

  const edgeIdCounts: Record<string, number> = {};
  for (const e of edges) edgeIdCounts[e.id] = (edgeIdCounts[e.id] ?? 0) + 1;
  const dupEdgeIds = Object.entries(edgeIdCounts)
    .filter(([, c]) => c > 1)
    .map(([id]) => id)
    .sort();
  if (dupEdgeIds.length > 0) {
    findings.push(
      errorFinding({
        code: "PBV2_E_TREE_DUPLICATE_IDS",
        message: "Edge IDs must be unique",
        path: "tree.edges",
        context: { duplicateEdgeIds: dupEdgeIds },
      })
    );
  }

  // Build symbol table and include any symbol build findings.
  const symbol = buildSymbolTable(tree, { pathBase: "tree" });
  findings.push(...symbol.findings);

  // Root validity
  let enabledRuntimeRootCount = 0;
  for (const rid of rootNodeIds) {
    if (!isNonEmptyString(rid)) continue;
    const rootId = String(rid);
    const node = nodesById[rootId];
    if (!node) {
      findings.push(
        errorFinding({
          code: "PBV2_E_TREE_ROOT_INVALID",
          message: `Root node '${rootId}' does not exist`,
          path: `tree.rootNodeIds`,
          entityId: rootId,
        })
      );
      continue;
    }

    if (node.status !== "ENABLED") {
      findings.push(
        errorFinding({
          code: "PBV2_E_TREE_ROOT_INVALID",
          message: "Root node must be ENABLED",
          path: `tree.nodes[${rootId}].status`,
          entityId: rootId,
          context: { status: node.status },
        })
      );
      continue;
    }

    if (node.type === "GROUP") {
      findings.push(
        errorFinding({
          code: "PBV2_E_TREE_ROOT_INVALID",
          message: "Root node cannot be GROUP",
          path: `tree.nodes[${rootId}].type`,
          entityId: rootId,
        })
      );
      continue;
    }

    if (node.status === "ENABLED") enabledRuntimeRootCount++;
  }

  if (rootNodeIds.length > 0 && enabledRuntimeRootCount === 0) {
    findings.push(
      errorFinding({
        code: "PBV2_E_TREE_NO_ROOTS",
        message: "rootNodeIds must include at least one ENABLED runtime node",
        path: "tree.rootNodeIds",
      })
    );
  }

  // node.key uniqueness among ENABLED + DISABLED
  const keyToNodeIds: Record<string, string[]> = {};
  for (const n of nodes) {
    if (n.status === "DELETED") continue;
    if (!n.key) continue;
    keyToNodeIds[n.key] ??= [];
    keyToNodeIds[n.key].push(n.id);
  }
  for (const [key, ids] of Object.entries(keyToNodeIds)) {
    if (ids.length <= 1) continue;
    ids.sort();
    findings.push(
      errorFinding({
        code: "PBV2_E_TREE_KEY_COLLISION",
        message: `node.key '${key}' collides across nodes`,
        path: "tree.nodes",
        context: { key, nodeIds: ids },
      })
    );
  }

  // INPUT.selectionKey checks
  const selectionKeyToNodeIds: Record<string, string[]> = {};
  for (const n of nodes) {
    if (n.status === "DELETED") continue;
    if (n.type !== "INPUT") continue;

    if (!n.selectionKey) {
      findings.push(
        errorFinding({
          code: "PBV2_E_INPUT_MISSING_SELECTION_KEY",
          message: "INPUT must define selectionKey",
          path: `tree.nodes[${n.id}].input.selectionKey`,
          entityId: n.id,
        })
      );
      continue;
    }

    selectionKeyToNodeIds[n.selectionKey] ??= [];
    selectionKeyToNodeIds[n.selectionKey].push(n.id);
  }

  for (const [sk, ids] of Object.entries(selectionKeyToNodeIds)) {
    if (ids.length <= 1) continue;
    ids.sort();
    findings.push(
      errorFinding({
        code: "PBV2_E_SELECTION_KEY_COLLISION",
        message: `INPUT.selectionKey '${sk}' collides across INPUT nodes`,
        path: "tree.nodes",
        context: { selectionKey: sk, nodeIds: ids },
      })
    );
  }

  const optionContext = getInputOptionContext(nodes);
  validateProductOptionRules(t, findings, optionContext);
  validateProductOptionRuleDependencySafety(t, findings);
  validatePricingMatrices(t, findings, optionContext);

  const visibilityDependencyEdges: Array<[string, string]> = [];
  const groupChildSelectionKeysByNodeId: Record<string, Set<string>> = {};
  for (const n of nodes) {
    if (n.status === "DELETED" || n.type !== "GROUP") continue;
    groupChildSelectionKeysByNodeId[n.id] = collectGroupChildSelectionKeys(n.id, nodesById, edges);
    for (const edge of edges) {
      if (edge.fromNodeId !== n.id || !edge.toNodeId) continue;
      const childNode = nodesById[edge.toNodeId];
      if (!childNode || childNode.status === "DELETED") continue;
      visibilityDependencyEdges.push([n.id, childNode.id]);
    }
  }

  for (const n of nodes) {
    if (n.status === "DELETED") continue;

    const visibility = asRecord((n.raw as any).visibility);
    const visibilityRules = Array.isArray((visibility as any)?.rules) ? ((visibility as any).rules as unknown[]) : [];
    visibilityRules.forEach((rule, idx) => {
      validateVisibilityRuleStructure(rule, `tree.nodes[${n.id}].visibility.rules[${idx}]`, findings, n.id);
      walkVisibilityRuleSelectionKeys(rule, (selectionKey) => {
        if (!selectionKeyToNodeIds[selectionKey] || selectionKeyToNodeIds[selectionKey].length === 0) {
          findings.push(
            warningFinding({
              code: "PBV2_W_VISIBILITY_SELECTION_KEY_UNKNOWN",
              message: `Visibility rule references unknown selectionKey '${selectionKey}'`,
              path: `tree.nodes[${n.id}].visibility.rules[${idx}]`,
              entityId: n.id,
              context: { selectionKey },
            })
          );
          return;
        }

        if (n.selectionKey && selectionKey === n.selectionKey) {
          findings.push(
            warningFinding({
              code: "PBV2_W_VISIBILITY_SELF_REFERENCE",
              message: "Visibility rule references the node's own selectionKey",
              path: `tree.nodes[${n.id}].visibility.rules[${idx}]`,
              entityId: n.id,
              context: { selectionKey },
            })
          );
        }

        if (n.type === "GROUP" && groupChildSelectionKeysByNodeId[n.id]?.has(selectionKey)) {
          findings.push(
            warningFinding({
              code: "PBV2_W_VISIBILITY_GROUP_SELF_GATE",
              message: "Group visibility references a selection inside the same group; the group may be unreachable at runtime",
              path: `tree.nodes[${n.id}].visibility.rules[${idx}]`,
              entityId: n.id,
              context: { selectionKey },
            })
          );
        }

        for (const providerNodeId of selectionKeyToNodeIds[selectionKey] ?? []) {
          visibilityDependencyEdges.push([providerNodeId, n.id]);
        }
      });
    });

    const choices = Array.isArray((n.raw as any).choices) ? ((n.raw as any).choices as unknown[]) : [];
    choices.forEach((choiceRaw, idx) => {
      const choice = asRecord(choiceRaw);
      if (!choice) return;
      const choiceValue = isNonEmptyString((choice as any).value) ? String((choice as any).value) : `choice_${idx}`;
      const choiceRules = Array.isArray((choice as any).visibilityRules) ? ((choice as any).visibilityRules as unknown[]) : [];
      choiceRules.forEach((rule, ruleIdx) => {
        const choiceEntityId = `${n.id}:${choiceValue}`;
        validateVisibilityRuleStructure(rule, `tree.nodes[${n.id}].choices[${idx}].visibilityRules[${ruleIdx}]`, findings, n.id);
        walkVisibilityRuleSelectionKeys(rule, (selectionKey) => {
          if (!selectionKeyToNodeIds[selectionKey] || selectionKeyToNodeIds[selectionKey].length === 0) {
            findings.push(
              warningFinding({
                code: "PBV2_W_VISIBILITY_SELECTION_KEY_UNKNOWN",
                message: `Choice visibility references unknown selectionKey '${selectionKey}'`,
                path: `tree.nodes[${n.id}].choices[${idx}].visibilityRules[${ruleIdx}]`,
                entityId: n.id,
                context: { selectionKey, choiceValue },
              })
            );
            return;
          }

          if (n.selectionKey && selectionKey === n.selectionKey) {
            findings.push(
              warningFinding({
                code: "PBV2_W_VISIBILITY_SELF_REFERENCE",
                message: "Choice visibility references its own node selectionKey",
                path: `tree.nodes[${n.id}].choices[${idx}].visibilityRules[${ruleIdx}]`,
                entityId: n.id,
                context: { selectionKey, choiceValue },
              })
            );
          }

          for (const providerNodeId of selectionKeyToNodeIds[selectionKey] ?? []) {
            visibilityDependencyEdges.push([providerNodeId, choiceEntityId]);
          }
        });
      });
    });
  }

  const visibilityEntities = Array.from(
    new Set([
      ...nodes.filter((n) => n.status !== "DELETED").map((n) => n.id),
      ...visibilityDependencyEdges.map(([, consumerId]) => consumerId),
    ])
  ).sort();
  const visibilityCycle = detectDirectedCycle(visibilityEntities, visibilityDependencyEdges);
  if (visibilityCycle) {
    findings.push(
      warningFinding({
        code: "PBV2_W_VISIBILITY_DEP_CYCLE",
        message: "Visibility dependencies contain a cycle; runtime visibility may be unstable",
        path: "tree.nodes",
        context: { cycle: visibilityCycle },
      })
    );
  }

  for (const n of nodes) {
    if (n.status === "DELETED" || n.type !== "GROUP") continue;
    const visibility = asRecord((n.raw as any).visibility);
    const visibilityRules = Array.isArray((visibility as any)?.rules) ? ((visibility as any).rules as unknown[]) : [];
    if (visibilityRules.length === 0) continue;

    const referencedSelectionKeys = new Set<string>();
    visibilityRules.forEach((rule) => {
      walkVisibilityRuleSelectionKeys(rule, (selectionKey) => referencedSelectionKeys.add(selectionKey));
    });

    if (referencedSelectionKeys.size === 0) continue;

    const allRefsInternalOrUnknown = Array.from(referencedSelectionKeys).every((selectionKey) => {
      const isInternal = groupChildSelectionKeysByNodeId[n.id]?.has(selectionKey) ?? false;
      const isKnown = Boolean(selectionKeyToNodeIds[selectionKey]?.length);
      return isInternal || !isKnown;
    });

    if (allRefsInternalOrUnknown) {
      findings.push(
        warningFinding({
          code: "PBV2_W_GROUP_VISIBILITY_UNREACHABLE",
          message: "Group visibility only depends on selections inside the same group or unknown keys, so the group may never become visible",
          path: `tree.nodes[${n.id}].visibility.rules`,
          entityId: n.id,
        })
      );
    }
  }

  // INPUT constraints validation (minimal)
  for (const n of nodes) {
    if (n.status === "DELETED") continue;
    if (n.type !== "INPUT") continue;
    const input = asRecord((n.raw as any).input) ?? asRecord((n.raw as any).data);
    if (!input) continue;

    const valueTypeRaw = (input as any).valueType ?? (input as any).type ?? (input as any).inputKind;
    const valueType = typeof valueTypeRaw === "string" ? valueTypeRaw.toUpperCase() : "";

    const constraints = (input as any).constraints as any;

    if (valueType === "NUMBER") {
      const numberC = constraints?.number ?? constraints;
      const min = typeof numberC?.min === "number" ? numberC.min : undefined;
      const max = typeof numberC?.max === "number" ? numberC.max : undefined;
      const step = typeof numberC?.step === "number" ? numberC.step : undefined;
      if (min !== undefined && max !== undefined && min > max) {
        findings.push(
          errorFinding({
            code: "PBV2_E_INPUT_CONSTRAINT_INVALID",
            message: "NUMBER constraints require min <= max",
            path: `tree.nodes[${n.id}].input.constraints.number`,
            entityId: n.id,
            context: { min, max },
          })
        );
      }
      if (step !== undefined && !(step > 0)) {
        findings.push(
          errorFinding({
            code: "PBV2_E_INPUT_CONSTRAINT_INVALID",
            message: "NUMBER constraints require step > 0",
            path: `tree.nodes[${n.id}].input.constraints.number.step`,
            entityId: n.id,
            context: { step },
          })
        );
      }

      const def = (input as any).defaultValue ?? (input as any).default;
      if (typeof def === "number" && Number.isFinite(def)) {
        const outOfRange = (min !== undefined && def < min) || (max !== undefined && def > max);
        if (outOfRange) {
          findings.push(
            (n.required
              ? errorFinding({
                  code: "PBV2_W_DEFAULT_OUT_OF_RANGE",
                  message: "Default value is out of range for required input",
                  path: `tree.nodes[${n.id}].input.defaultValue`,
                  entityId: n.id,
                  context: { defaultValue: def, min, max },
                })
              : warningFinding({
                  code: "PBV2_W_DEFAULT_OUT_OF_RANGE",
                  message: "Default value is out of range",
                  path: `tree.nodes[${n.id}].input.defaultValue`,
                  entityId: n.id,
                  context: { defaultValue: def, min, max },
                }))
          );
        }
      }
    }

    if (valueType === "BOOLEAN") {
      const def = (input as any).defaultValue ?? (input as any).default;
      if (def !== undefined && typeof def !== "boolean") {
        findings.push(
          errorFinding({
            code: "PBV2_E_INPUT_CONSTRAINT_INVALID",
            message: "BOOLEAN default must be a boolean",
            path: `tree.nodes[${n.id}].input.defaultValue`,
            entityId: n.id,
            context: { defaultValue: def },
          })
        );
      }
    }

    if (valueType === "ENUM") {
      const options = (constraints?.enum?.options ?? constraints?.options ?? (input as any).options ?? (input as any).choices) as any;
      if (Array.isArray(options)) {
        const seen = new Set<string>();
        for (let i = 0; i < options.length; i++) {
          const o = options[i];
          const v = typeof o?.value === "string" ? o.value : typeof o === "string" ? o : "";
          if (!v.trim()) {
            findings.push(
              errorFinding({
                code: "PBV2_E_INPUT_CONSTRAINT_INVALID",
                message: "ENUM option values must be non-empty strings",
                path: `tree.nodes[${n.id}].input.constraints.enum.options[${i}]`,
                entityId: n.id,
              })
            );
          } else if (seen.has(v)) {
            findings.push(
              errorFinding({
                code: "PBV2_E_INPUT_CONSTRAINT_INVALID",
                message: "ENUM option values must be unique",
                path: `tree.nodes[${n.id}].input.constraints.enum.options`,
                entityId: n.id,
                context: { value: v },
              })
            );
          }
          seen.add(v);
        }
      }
    }
  }

  // Edge integrity and ambiguity
  const enabledEdgesByFrom: Record<string, EdgeRec[]> = {};

  for (const e of edges) {
    const edgePath = `tree.edges[${e.id}]`;

    if (e.fromNodeId === null || e.toNodeId === null) {
      findings.push(
        errorFinding({
          code: "PBV2_E_EDGE_MISSING_ENDPOINT",
          message: "Edge must define fromNodeId and toNodeId",
          path: edgePath,
          entityId: e.id,
        })
      );
      continue;
    }

    if (!nodesById[e.fromNodeId] || !nodesById[e.toNodeId]) {
      findings.push(
        errorFinding({
          code: "PBV2_E_EDGE_MISSING_ENDPOINT",
          message: "Edge endpoints must exist",
          path: edgePath,
          entityId: e.id,
          context: { fromNodeId: e.fromNodeId, toNodeId: e.toNodeId },
        })
      );
    }

    if (e.fromNodeId === e.toNodeId) {
      findings.push(
        errorFinding({
          code: "PBV2_E_EDGE_SELF_LOOP",
          message: "Edge fromNodeId must not equal toNodeId",
          path: edgePath,
          entityId: e.id,
          context: { nodeId: e.fromNodeId },
        })
      );
    }

    if (e.priority === null || !Number.isInteger(e.priority) || e.priority < 0) {
      findings.push(
        errorFinding({
          code: "PBV2_E_EDGE_INVALID_PRIORITY",
          message: "priority must be integer >= 0",
          path: `${edgePath}.priority`,
          entityId: e.id,
          context: { priority: (e.raw as any).priority },
        })
      );
    }

    // Condition validation
    const condPath = `${edgePath}.condition`;
    findings.push(...typeCheckCondition(e.condition, symbol.table, { pathBase: condPath, entityId: e.id }).findings);

    const from = nodesById[e.fromNodeId];
    const to = nodesById[e.toNodeId];

    if (e.status === "ENABLED") {
      if (from?.status === "DELETED" || to?.status === "DELETED") {
        findings.push(
          errorFinding({
            code: "PBV2_E_EDGE_STATUS_INVALID",
            message: "ENABLED edges cannot reference DELETED nodes",
            path: edgePath,
            entityId: e.id,
          })
        );
      }
      if (from?.type === "GROUP" || to?.type === "GROUP") {
        findings.push(
          errorFinding({
            code: "PBV2_E_EDGE_STATUS_INVALID",
            message: "ENABLED edges cannot connect to GROUP nodes",
            path: edgePath,
            entityId: e.id,
          })
        );
      }
      if (from?.status === "DISABLED" || to?.status === "DISABLED") {
        findings.push(
          errorFinding({
            code: "PBV2_E_EDGE_STATUS_INVALID",
            message: "If either endpoint is DISABLED, the edge must be DISABLED",
            path: edgePath,
            entityId: e.id,
            context: { fromStatus: from?.status, toStatus: to?.status },
          })
        );
      }

      enabledEdgesByFrom[e.fromNodeId] ??= [];
      enabledEdgesByFrom[e.fromNodeId].push(e);
    }
  }

  for (const list of Object.values(enabledEdgesByFrom)) list.sort((a, b) => a.id.localeCompare(b.id));

  for (const [fromNodeId, list] of Object.entries(enabledEdgesByFrom)) {
    const byPriority: Record<string, EdgeRec[]> = {};
    for (const e of list) {
      const p = e.priority ?? 0;
      const key = String(p);
      byPriority[key] ??= [];
      byPriority[key].push(e);
    }

    for (const [p, same] of Object.entries(byPriority)) {
      if (same.length <= 1) continue;

      const nonUnsat = same.filter((e) => !isProvablyUnsat(e.condition));
      if (nonUnsat.length <= 1) continue;

      const sev = policy.ambiguousEdgesStrict ? "ERROR" : "WARNING";
      findings.push({
        code: "PBV2_W_EDGE_AMBIGUOUS_MATCH",
        severity: sev,
        message: "Multiple outgoing edges can match with the same priority",
        path: `tree.edges`,
        context: { fromNodeId, priority: Number(p), edgeIds: nonUnsat.map((e) => e.id).sort() },
      } as Finding);
    }
  }

  // Graph cycle detection (runtime graph only)
  const runtimeNodeIds = nodes
    .filter((n) => n.status === "ENABLED" && n.type !== "GROUP")
    .map((n) => n.id)
    .sort();

  const runtimeEdges: Array<[string, string]> = [];
  for (const e of edges) {
    if (e.status !== "ENABLED") continue;
    if (!e.fromNodeId || !e.toNodeId) continue;
    const from = nodesById[e.fromNodeId];
    const to = nodesById[e.toNodeId];
    if (!from || !to) continue;
    if (from.status !== "ENABLED" || to.status !== "ENABLED") continue;
    if (from.type === "GROUP" || to.type === "GROUP") continue;
    runtimeEdges.push([from.id, to.id]);
  }

  const runtimeCycle = detectDirectedCycle(runtimeNodeIds, runtimeEdges);
  if (runtimeCycle) {
    findings.push(
      errorFinding({
        code: "PBV2_E_GRAPH_CYCLE",
        message: "Runtime dependency graph (ENABLED nodes/edges) must be acyclic",
        path: "tree",
        context: { cycle: runtimeCycle },
      })
    );
  }

  // Expression + Condition validation on nodes
  for (const n of nodes) {
    if (n.status === "DELETED") continue;

    if (n.type === "COMPUTE") {
      const expr = extractComputeExpression(n.raw);
      const pathBase = `tree.nodes[${n.id}].compute.expression`;
      const res = typeCheckExpression(expr, "COMPUTE", symbol.table, { pathBase, entityId: n.id });
      findings.push(...res.findings);
      findings.push(...findDivByZeroFindings(expr, { strict: policy.divByZeroStrict, pathBase, entityId: n.id }));
    }

    if (n.type === "PRICE") {
      const comps = extractPriceComponents(n.raw);
      for (let i = 0; i < comps.length; i++) {
        const c = asRecord(comps[i]);
        const cPath = `tree.nodes[${n.id}].price.components[${i}]`;
        if (!c) {
          findings.push(
            errorFinding({
              code: "PBV2_E_PRICE_COMPONENT_INVALID",
              message: "PriceComponent must be an object",
              path: cPath,
              entityId: n.id,
            })
          );
          continue;
        }

        const kindRaw = (c as any).kind;
        const kind = typeof kindRaw === "string" ? kindRaw.toUpperCase() : "";
        if (!kind || !["FLAT", "PER_UNIT", "PER_OVERAGE", "TIERED"].includes(kind)) {
          findings.push(
            errorFinding({
              code: "PBV2_E_PRICE_COMPONENT_INVALID",
              message: "PriceComponent.kind must be one of FLAT|PER_UNIT|PER_OVERAGE|TIERED",
              path: `${cPath}.kind`,
              entityId: n.id,
              context: { kind: kindRaw },
            })
          );
          continue;
        }

        const requireField = (field: string) => {
          if (!(field in c)) {
            findings.push(
              errorFinding({
                code: "PBV2_E_PRICE_COMPONENT_INVALID",
                message: `Missing required field '${field}' for ${kind}`,
                path: cPath,
                entityId: n.id,
                context: { kind, field },
              })
            );
            return false;
          }
          return true;
        };

        if (kind === "FLAT") {
          requireField("unitPriceRef");
        }
        if (kind === "PER_UNIT") {
          requireField("quantityRef");
          requireField("unitPriceRef");
        }
        if (kind === "PER_OVERAGE") {
          requireField("quantityRef");
          requireField("overageBaseRef");
          requireField("unitPriceRef");
        }
        if (kind === "TIERED") {
          requireField("quantityRef");
          requireField("tiers");
          const tiers = (c as any).tiers;
          if (!Array.isArray(tiers) || tiers.length === 0) {
            findings.push(
              errorFinding({
                code: "PBV2_E_PRICE_COMPONENT_INVALID",
                message: "TIERED components require non-empty tiers",
                path: `${cPath}.tiers`,
                entityId: n.id,
              })
            );
          }
        }

        // Optional per-component discount config (additive, default-safe)
        const discountRaw = (c as any).discount;
        if (discountRaw != null) {
          const d = asRecord(discountRaw);
          const dPath = `${cPath}.discount`;
          if (!d) {
            findings.push(
              errorFinding({
                code: "PBV2_E_PRICE_COMPONENT_INVALID",
                message: "discount must be an object when present",
                path: dPath,
                entityId: n.id,
              })
            );
          } else {
            const discountEligible = (d as any).discountEligible;
            if (discountEligible != null && typeof discountEligible !== "boolean") {
              findings.push(
                errorFinding({
                  code: "PBV2_E_PRICE_COMPONENT_INVALID",
                  message: "discount.discountEligible must be boolean when present",
                  path: `${dPath}.discountEligible`,
                  entityId: n.id,
                })
              );
            }

            const scope = (d as any).discountScope;
            if (scope != null && !["none", "customerTier", "volume", "customerTier+volume"].includes(String(scope))) {
              findings.push(
                errorFinding({
                  code: "PBV2_E_PRICE_COMPONENT_INVALID",
                  message: "discount.discountScope must be one of none|customerTier|volume|customerTier+volume",
                  path: `${dPath}.discountScope`,
                  entityId: n.id,
                  context: { value: scope },
                })
              );
            }

            const trigger = (d as any).volumeTrigger;
            if (trigger != null && !["componentQty", "productQty"].includes(String(trigger))) {
              findings.push(
                errorFinding({
                  code: "PBV2_E_PRICE_COMPONENT_INVALID",
                  message: "discount.volumeTrigger must be one of componentQty|productQty",
                  path: `${dPath}.volumeTrigger`,
                  entityId: n.id,
                  context: { value: trigger },
                })
              );
            }

            const method = (d as any).discountMethod;
            const methodStr = method == null ? null : String(method);
            if (methodStr != null && !["percentage", "fixedPerUnit", "tierTable"].includes(methodStr)) {
              findings.push(
                errorFinding({
                  code: "PBV2_E_PRICE_COMPONENT_INVALID",
                  message: "discount.discountMethod must be one of percentage|fixedPerUnit|tierTable",
                  path: `${dPath}.discountMethod`,
                  entityId: n.id,
                  context: { value: method },
                })
              );
            }

            const checkPercent = (value: any, path: string) => {
              const num = typeof value === "number" ? value : Number(String(value));
              if (!Number.isFinite(num) || num < 0 || num > 100) {
                findings.push(
                  errorFinding({
                    code: "PBV2_E_PRICE_COMPONENT_INVALID",
                    message: "percentOff must be a number between 0 and 100",
                    path,
                    entityId: n.id,
                    context: { value },
                  })
                );
              }
            };

            const checkNonNegativeNumber = (value: any, path: string, label: string) => {
              const num = typeof value === "number" ? value : Number(String(value));
              if (!Number.isFinite(num) || num < 0) {
                findings.push(
                  errorFinding({
                    code: "PBV2_E_PRICE_COMPONENT_INVALID",
                    message: `${label} must be a non-negative number`,
                    path,
                    entityId: n.id,
                    context: { value },
                  })
                );
              }
            };

            // Validate optional per-method fields when present.
            const customerTierPercentByTier = (d as any).customerTierPercentByTier;
            if (customerTierPercentByTier != null) {
              const rec = asRecord(customerTierPercentByTier);
              if (!rec) {
                findings.push(
                  errorFinding({
                    code: "PBV2_E_PRICE_COMPONENT_INVALID",
                    message: "discount.customerTierPercentByTier must be an object",
                    path: `${dPath}.customerTierPercentByTier`,
                    entityId: n.id,
                  })
                );
              } else {
                for (const [k, v] of Object.entries(rec)) {
                  if (!["default", "wholesale", "retail"].includes(k)) continue;
                  if (v == null) continue;
                  checkPercent(v, `${dPath}.customerTierPercentByTier.${k}`);
                }
              }
            }

            const volumePercentTiers = (d as any).volumePercentTiers;
            if (volumePercentTiers != null) {
              if (!Array.isArray(volumePercentTiers)) {
                findings.push(
                  errorFinding({
                    code: "PBV2_E_PRICE_COMPONENT_INVALID",
                    message: "discount.volumePercentTiers must be an array",
                    path: `${dPath}.volumePercentTiers`,
                    entityId: n.id,
                  })
                );
              } else {
                for (let ti = 0; ti < volumePercentTiers.length; ti++) {
                  const tr = asRecord(volumePercentTiers[ti]);
                  if (!tr) {
                    findings.push(
                      errorFinding({
                        code: "PBV2_E_PRICE_COMPONENT_INVALID",
                        message: "volumePercentTiers entries must be objects",
                        path: `${dPath}.volumePercentTiers[${ti}]`,
                        entityId: n.id,
                      })
                    );
                    continue;
                  }
                  checkNonNegativeNumber((tr as any).minQty, `${dPath}.volumePercentTiers[${ti}].minQty`, "minQty");
                  checkPercent((tr as any).percentOff, `${dPath}.volumePercentTiers[${ti}].percentOff`);
                  const ct = (tr as any).customerTier;
                  if (ct != null && !["default", "wholesale", "retail"].includes(String(ct))) {
                    findings.push(
                      errorFinding({
                        code: "PBV2_E_PRICE_COMPONENT_INVALID",
                        message: "volumePercentTiers.customerTier must be default|wholesale|retail when present",
                        path: `${dPath}.volumePercentTiers[${ti}].customerTier`,
                        entityId: n.id,
                        context: { value: ct },
                      })
                    );
                  }
                }
              }
            }

            const customerTierCentsOffPerUnitByTier = (d as any).customerTierCentsOffPerUnitByTier;
            if (customerTierCentsOffPerUnitByTier != null) {
              const rec = asRecord(customerTierCentsOffPerUnitByTier);
              if (!rec) {
                findings.push(
                  errorFinding({
                    code: "PBV2_E_PRICE_COMPONENT_INVALID",
                    message: "discount.customerTierCentsOffPerUnitByTier must be an object",
                    path: `${dPath}.customerTierCentsOffPerUnitByTier`,
                    entityId: n.id,
                  })
                );
              } else {
                for (const [k, v] of Object.entries(rec)) {
                  if (!["default", "wholesale", "retail"].includes(k)) continue;
                  if (v == null) continue;
                  checkNonNegativeNumber(v, `${dPath}.customerTierCentsOffPerUnitByTier.${k}`, "centsOffPerUnit");
                }
              }
            }

            const volumeCentsOffPerUnitTiers = (d as any).volumeCentsOffPerUnitTiers;
            if (volumeCentsOffPerUnitTiers != null) {
              if (!Array.isArray(volumeCentsOffPerUnitTiers)) {
                findings.push(
                  errorFinding({
                    code: "PBV2_E_PRICE_COMPONENT_INVALID",
                    message: "discount.volumeCentsOffPerUnitTiers must be an array",
                    path: `${dPath}.volumeCentsOffPerUnitTiers`,
                    entityId: n.id,
                  })
                );
              } else {
                for (let ti = 0; ti < volumeCentsOffPerUnitTiers.length; ti++) {
                  const tr = asRecord(volumeCentsOffPerUnitTiers[ti]);
                  if (!tr) {
                    findings.push(
                      errorFinding({
                        code: "PBV2_E_PRICE_COMPONENT_INVALID",
                        message: "volumeCentsOffPerUnitTiers entries must be objects",
                        path: `${dPath}.volumeCentsOffPerUnitTiers[${ti}]`,
                        entityId: n.id,
                      })
                    );
                    continue;
                  }
                  checkNonNegativeNumber((tr as any).minQty, `${dPath}.volumeCentsOffPerUnitTiers[${ti}].minQty`, "minQty");
                  checkNonNegativeNumber((tr as any).centsOffPerUnit, `${dPath}.volumeCentsOffPerUnitTiers[${ti}].centsOffPerUnit`, "centsOffPerUnit");
                  const ct = (tr as any).customerTier;
                  if (ct != null && !["default", "wholesale", "retail"].includes(String(ct))) {
                    findings.push(
                      errorFinding({
                        code: "PBV2_E_PRICE_COMPONENT_INVALID",
                        message: "volumeCentsOffPerUnitTiers.customerTier must be default|wholesale|retail when present",
                        path: `${dPath}.volumeCentsOffPerUnitTiers[${ti}].customerTier`,
                        entityId: n.id,
                        context: { value: ct },
                      })
                    );
                  }
                }
              }
            }

            const customerTierUnitPriceCentsByTier = (d as any).customerTierUnitPriceCentsByTier;
            if (customerTierUnitPriceCentsByTier != null) {
              const rec = asRecord(customerTierUnitPriceCentsByTier);
              if (!rec) {
                findings.push(
                  errorFinding({
                    code: "PBV2_E_PRICE_COMPONENT_INVALID",
                    message: "discount.customerTierUnitPriceCentsByTier must be an object",
                    path: `${dPath}.customerTierUnitPriceCentsByTier`,
                    entityId: n.id,
                  })
                );
              } else {
                for (const [k, v] of Object.entries(rec)) {
                  if (!["default", "wholesale", "retail"].includes(k)) continue;
                  if (v == null) continue;
                  checkNonNegativeNumber(v, `${dPath}.customerTierUnitPriceCentsByTier.${k}`, "unitPriceCents");
                }
              }
            }

            const volumeUnitPriceCentsTiers = (d as any).volumeUnitPriceCentsTiers;
            if (volumeUnitPriceCentsTiers != null) {
              if (!Array.isArray(volumeUnitPriceCentsTiers)) {
                findings.push(
                  errorFinding({
                    code: "PBV2_E_PRICE_COMPONENT_INVALID",
                    message: "discount.volumeUnitPriceCentsTiers must be an array",
                    path: `${dPath}.volumeUnitPriceCentsTiers`,
                    entityId: n.id,
                  })
                );
              } else {
                for (let ti = 0; ti < volumeUnitPriceCentsTiers.length; ti++) {
                  const tr = asRecord(volumeUnitPriceCentsTiers[ti]);
                  if (!tr) {
                    findings.push(
                      errorFinding({
                        code: "PBV2_E_PRICE_COMPONENT_INVALID",
                        message: "volumeUnitPriceCentsTiers entries must be objects",
                        path: `${dPath}.volumeUnitPriceCentsTiers[${ti}]`,
                        entityId: n.id,
                      })
                    );
                    continue;
                  }
                  checkNonNegativeNumber((tr as any).minQty, `${dPath}.volumeUnitPriceCentsTiers[${ti}].minQty`, "minQty");
                  checkNonNegativeNumber((tr as any).unitPriceCents, `${dPath}.volumeUnitPriceCentsTiers[${ti}].unitPriceCents`, "unitPriceCents");
                  const ct = (tr as any).customerTier;
                  if (ct != null && !["default", "wholesale", "retail"].includes(String(ct))) {
                    findings.push(
                      errorFinding({
                        code: "PBV2_E_PRICE_COMPONENT_INVALID",
                        message: "volumeUnitPriceCentsTiers.customerTier must be default|wholesale|retail when present",
                        path: `${dPath}.volumeUnitPriceCentsTiers[${ti}].customerTier`,
                        entityId: n.id,
                        context: { value: ct },
                      })
                    );
                  }
                }
              }
            }
          }
        }

        const checkNumberExpr = (field: string) => {
          if (!(field in c)) return;
          const value = (c as any)[field];
          const r = typeCheckExpression(value, "PRICE", symbol.table, { pathBase: `${cPath}.${field}`, entityId: n.id });
          findings.push(...r.findings);
          findings.push(...findDivByZeroFindings(value, { strict: policy.divByZeroStrict, pathBase: `${cPath}.${field}`, entityId: n.id }));

          if (r.inferred.type !== "NUMBER" || r.inferred.nullable) {
            findings.push(
              errorFinding({
                code: "PBV2_E_PRICE_REF_UNRESOLVED",
                message: `${field} must resolve to non-null NUMBER`,
                path: `${cPath}.${field}`,
                entityId: n.id,
                context: { inferred: r.inferred },
              })
            );
          }

          if (field === "quantityRef") {
            const expr = value as any;
            if (expr?.op === "literal" && typeof expr.value === "number" && expr.value < 0) {
              findings.push(
                errorFinding({
                  code: "PBV2_E_PRICE_NEGATIVE_QUANTITY",
                  message: "quantityRef cannot be a negative literal",
                  path: `${cPath}.${field}`,
                  entityId: n.id,
                  context: { value: expr.value },
                })
              );
            } else if (policy.negativeQuantityStrict && (expr?.op === "sub" || expr?.op === "mul")) {
              findings.push(
                errorFinding({
                  code: "PBV2_E_PRICE_NEGATIVE_QUANTITY",
                  message: "quantityRef may produce negative quantities; clamp/guard recommended",
                  path: `${cPath}.${field}`,
                  entityId: n.id,
                })
              );
            } else if (!policy.negativeQuantityStrict && (expr?.op === "sub" || expr?.op === "mul")) {
              findings.push(
                warningFinding({
                  code: "PBV2_E_PRICE_NEGATIVE_QUANTITY",
                  message: "quantityRef may produce negative quantities; clamp/guard recommended",
                  path: `${cPath}.${field}`,
                  entityId: n.id,
                })
              );
            }
          }
        };

        // Resolve refs by kind
        checkNumberExpr("quantityRef");
        checkNumberExpr("unitPriceRef");
        checkNumberExpr("overageBaseRef");

        // appliesWhen condition
        if ((c as any).appliesWhen !== undefined) {
          findings.push(
            ...typeCheckCondition((c as any).appliesWhen, symbol.table, { pathBase: `${cPath}.appliesWhen`, entityId: n.id }).findings
          );
          // minimal UNSAT detection is used only for reachability/ambiguity
        }
      }

      const effects = extractMaterialEffects(n.raw);
      for (let i = 0; i < effects.length; i++) {
        const e = asRecord(effects[i]);
        const ePath = `tree.nodes[${n.id}].price.materialEffects[${i}]`;
        if (!e) {
          findings.push(
            errorFinding({
              code: "PBV2_E_MATERIAL_EFFECT_INVALID",
              message: "MaterialEffect must be an object",
              path: ePath,
              entityId: n.id,
            })
          );
          continue;
        }

        const skuRef = (e as any).skuRef;
        if (!isNonEmptyString(skuRef)) {
          findings.push(
            errorFinding({
              code: "PBV2_E_MATERIAL_EFFECT_INVALID",
              message: "MaterialEffect.skuRef must be a non-empty string",
              path: `${ePath}.skuRef`,
              entityId: n.id,
            })
          );
        }

        const uom = (e as any).uom;
        if (!isNonEmptyString(uom)) {
          findings.push(
            errorFinding({
              code: "PBV2_E_MATERIAL_EFFECT_INVALID",
              message: "MaterialEffect.uom must be a non-empty string",
              path: `${ePath}.uom`,
              entityId: n.id,
            })
          );
        }

        if (!("qtyRef" in e)) {
          findings.push(
            errorFinding({
              code: "PBV2_E_MATERIAL_EFFECT_INVALID",
              message: "MaterialEffect.qtyRef is required",
              path: ePath,
              entityId: n.id,
              context: { field: "qtyRef" },
            })
          );
        } else {
          const qtyRef = (e as any).qtyRef;
          const r = typeCheckExpression(qtyRef, "COMPUTE", symbol.table, { pathBase: `${ePath}.qtyRef`, entityId: n.id });
          findings.push(...r.findings);
          findings.push(...findDivByZeroFindings(qtyRef, { strict: policy.divByZeroStrict, pathBase: `${ePath}.qtyRef`, entityId: n.id }));

          if (r.inferred.type !== "NUMBER" || r.inferred.nullable) {
            findings.push(
              errorFinding({
                code: "PBV2_E_MATERIAL_QTY_REF_INVALID",
                message: "qtyRef must resolve to non-null NUMBER",
                path: `${ePath}.qtyRef`,
                entityId: n.id,
                context: { inferred: r.inferred },
              })
            );
          }

          const expr = qtyRef as any;
          if (expr?.op === "literal" && typeof expr.value === "number" && expr.value < 0) {
            findings.push(
              errorFinding({
                code: "PBV2_E_MATERIAL_NEGATIVE_QUANTITY",
                message: "qtyRef cannot be a negative literal",
                path: `${ePath}.qtyRef`,
                entityId: n.id,
                context: { value: expr.value },
              })
            );
          } else if (expr?.op === "sub" || expr?.op === "mul") {
            findings.push(
              errorFinding({
                code: "PBV2_E_MATERIAL_NEGATIVE_QUANTITY",
                message: "qtyRef may produce negative quantities; clamp/guard required",
                path: `${ePath}.qtyRef`,
                entityId: n.id,
              })
            );
          }
        }

        if ((e as any).appliesWhen !== undefined) {
          const c = (e as any).appliesWhen as ConditionRule;
          findings.push(...typeCheckCondition(c, symbol.table, { pathBase: `${ePath}.appliesWhen`, entityId: n.id }).findings);
          if (isProvablyUnsat(c)) {
            findings.push(
              warningFinding({
                code: "PBV2_W_MATERIAL_EFFECT_UNREACHABLE",
                message: "MaterialEffect.appliesWhen is provably UNSAT (effect will never apply)",
                path: `${ePath}.appliesWhen`,
                entityId: n.id,
              })
            );
          }
        }
      }

      const childEffects = extractChildItemEffects(n.raw);
      for (let i = 0; i < childEffects.length; i++) {
        const e = asRecord(childEffects[i]);
        const ePath = `tree.nodes[${n.id}].price.childItemEffects[${i}]`;
        if (!e) {
          findings.push(
            errorFinding({
              code: "PBV2_E_CHILD_ITEM_EFFECT_INVALID",
              message: "ChildItemEffect must be an object",
              path: ePath,
              entityId: n.id,
            })
          );
          continue;
        }

        const kind = (e as any).kind;
        const kindOk = kind === "inlineSku" || kind === "productRef";
        if (!kindOk) {
          findings.push(
            errorFinding({
              code: "PBV2_E_CHILD_ITEM_EFFECT_INVALID",
              message: "ChildItemEffect.kind must be 'inlineSku' or 'productRef'",
              path: `${ePath}.kind`,
              entityId: n.id,
            })
          );
        }

        const title = (e as any).title;
        if (!isNonEmptyString(title)) {
          findings.push(
            errorFinding({
              code: "PBV2_E_CHILD_ITEM_EFFECT_INVALID",
              message: "ChildItemEffect.title must be a non-empty string",
              path: `${ePath}.title`,
              entityId: n.id,
            })
          );
        }

        const skuRef = (e as any).skuRef;
        if (kind === "inlineSku" && !isNonEmptyString(skuRef)) {
          findings.push(
            errorFinding({
              code: "PBV2_E_CHILD_ITEM_EFFECT_INVALID",
              message: "ChildItemEffect.skuRef is required when kind='inlineSku'",
              path: `${ePath}.skuRef`,
              entityId: n.id,
            })
          );
        }

        const childProductId = (e as any).childProductId;
        if (childProductId !== undefined && !isNonEmptyString(childProductId)) {
          findings.push(
            errorFinding({
              code: "PBV2_E_CHILD_ITEM_EFFECT_INVALID",
              message: "ChildItemEffect.childProductId must be a non-empty string when provided",
              path: `${ePath}.childProductId`,
              entityId: n.id,
            })
          );
        }

        const invoiceVisibility = (e as any).invoiceVisibility;
        if (
          invoiceVisibility !== undefined &&
          invoiceVisibility !== "hidden" &&
          invoiceVisibility !== "rollup" &&
          invoiceVisibility !== "separateLine"
        ) {
          findings.push(
            errorFinding({
              code: "PBV2_E_CHILD_ITEM_EFFECT_INVALID",
              message: "ChildItemEffect.invoiceVisibility must be 'hidden', 'rollup', or 'separateLine'",
              path: `${ePath}.invoiceVisibility`,
              entityId: n.id,
            })
          );
        }

        if (!("qtyRef" in e)) {
          findings.push(
            errorFinding({
              code: "PBV2_E_CHILD_ITEM_EFFECT_INVALID",
              message: "ChildItemEffect.qtyRef is required",
              path: ePath,
              entityId: n.id,
              context: { field: "qtyRef" },
            })
          );
        } else {
          const qtyRef = (e as any).qtyRef;
          const r = typeCheckExpression(qtyRef, "COMPUTE", symbol.table, { pathBase: `${ePath}.qtyRef`, entityId: n.id });
          findings.push(...r.findings);
          findings.push(...findDivByZeroFindings(qtyRef, { strict: policy.divByZeroStrict, pathBase: `${ePath}.qtyRef`, entityId: n.id }));

          if (r.inferred.type !== "NUMBER" || r.inferred.nullable) {
            findings.push(
              errorFinding({
                code: "PBV2_E_CHILD_ITEM_QTY_REF_INVALID",
                message: "qtyRef must resolve to non-null NUMBER",
                path: `${ePath}.qtyRef`,
                entityId: n.id,
                context: { inferred: r.inferred },
              })
            );
          }

          const expr = qtyRef as any;
          if (expr?.op === "literal" && typeof expr.value === "number" && expr.value < 0) {
            findings.push(
              errorFinding({
                code: "PBV2_E_CHILD_ITEM_NEGATIVE_QUANTITY",
                message: "qtyRef cannot be a negative literal",
                path: `${ePath}.qtyRef`,
                entityId: n.id,
                context: { value: expr.value },
              })
            );
          } else if (expr?.op === "sub" || expr?.op === "mul") {
            findings.push(
              errorFinding({
                code: "PBV2_E_CHILD_ITEM_NEGATIVE_QUANTITY",
                message: "qtyRef may produce negative quantities; clamp/guard required",
                path: `${ePath}.qtyRef`,
                entityId: n.id,
              })
            );
          }
        }

        if ((e as any).unitPriceRef !== undefined) {
          const unitPriceRef = (e as any).unitPriceRef;
          const r = typeCheckExpression(unitPriceRef, "PRICE", symbol.table, { pathBase: `${ePath}.unitPriceRef`, entityId: n.id });
          findings.push(...r.findings);
          findings.push(...findDivByZeroFindings(unitPriceRef, { strict: policy.divByZeroStrict, pathBase: `${ePath}.unitPriceRef`, entityId: n.id }));
          if (r.inferred.type !== "NUMBER" || r.inferred.nullable) {
            findings.push(
              errorFinding({
                code: "PBV2_E_CHILD_ITEM_UNIT_PRICE_REF_INVALID",
                message: "unitPriceRef must resolve to non-null NUMBER (cents)",
                path: `${ePath}.unitPriceRef`,
                entityId: n.id,
                context: { inferred: r.inferred },
              })
            );
          }
        }

        if ((e as any).appliesWhen !== undefined) {
          const c = (e as any).appliesWhen as ConditionRule;
          findings.push(...typeCheckCondition(c, symbol.table, { pathBase: `${ePath}.appliesWhen`, entityId: n.id }).findings);
          if (isProvablyUnsat(c)) {
            findings.push(
              warningFinding({
                code: "PBV2_W_CHILD_ITEM_EFFECT_UNREACHABLE",
                message: "ChildItemEffect.appliesWhen is provably UNSAT (effect will never apply)",
                path: `${ePath}.appliesWhen`,
                entityId: n.id,
              })
            );
          }
        }
      }
    }

    if (n.type === "EFFECT") {
      const outputs = extractEffectOutputs(n.raw);
      const seenKeys = new Set<string>();
      for (let i = 0; i < outputs.length; i++) {
        const o = asRecord(outputs[i]);
        const oPath = `tree.nodes[${n.id}].effect.outputs[${i}]`;
        if (!o) {
          findings.push(
            errorFinding({
              code: "PBV2_E_EFFECT_OUTPUT_INVALID",
              message: "EFFECT output must be an object",
              path: oPath,
              entityId: n.id,
            })
          );
          continue;
        }
        const key = (o as any).key;
        if (!isNonEmptyString(key)) {
          findings.push(
            errorFinding({
              code: "PBV2_E_EFFECT_OUTPUT_INVALID",
              message: "EFFECT output.key must be a non-empty string",
              path: `${oPath}.key`,
              entityId: n.id,
            })
          );
        } else {
          if (seenKeys.has(key)) {
            findings.push(
              errorFinding({
                code: "PBV2_E_EFFECT_OUTPUT_INVALID",
                message: "EFFECT output keys must be unique within node",
                path: `tree.nodes[${n.id}].effect.outputs`,
                entityId: n.id,
                context: { key },
              })
            );
          }
          seenKeys.add(key);
        }

        const valueRef = (o as any).valueRef;
        const r = typeCheckExpression(valueRef, "EFFECT", symbol.table, { pathBase: `${oPath}.valueRef`, entityId: n.id });
        findings.push(...r.findings);
        findings.push(...findDivByZeroFindings(valueRef, { strict: policy.divByZeroStrict, pathBase: `${oPath}.valueRef`, entityId: n.id }));
      }
    }

    if (n.type === "GROUP") {
      // GROUP nodes are editor-only: warn if enabled at runtime.
      if (n.status === "ENABLED") {
        findings.push(
          infoFinding({
            code: "PBV2_I_GROUP_NODE_IGNORED",
            message: "GROUP nodes are excluded from runtime evaluation",
            path: `tree.nodes[${n.id}]`,
            entityId: n.id,
          })
        );
      }
    }
  }

  // Compute dependency cycle detection
  const computeIds = nodes.filter((n) => n.status !== "DELETED" && n.type === "COMPUTE").map((n) => n.id).sort();
  const computeIdSet = new Set<string>(computeIds);

  const computeEdges: Array<[string, string]> = [];
  const collectNodeOutputRefs = (expr: unknown): Array<{ nodeId: string; outputKey: string }> => {
    const refs: Array<{ nodeId: string; outputKey: string }> = [];
    const walk = (e: any) => {
      if (!e || typeof e !== "object") return;
      if (e.op === "ref" && e.ref && typeof e.ref === "object") {
        const r = e.ref as any;
        if (r.kind === "nodeOutputRef" && isNonEmptyString(r.nodeId) && isNonEmptyString(r.outputKey)) {
          refs.push({ nodeId: r.nodeId, outputKey: r.outputKey });
        }
      }
      for (const v of Object.values(e)) {
        if (v && typeof v === "object") {
          if (Array.isArray(v)) v.forEach(walk);
          else walk(v);
        }
      }
    };
    walk(expr as any);
    return refs;
  };

  for (const n of nodes) {
    if (n.status === "DELETED" || n.type !== "COMPUTE") continue;
    const expr = extractComputeExpression(n.raw);
    const refs = collectNodeOutputRefs(expr);
    for (const r of refs) {
      if (computeIdSet.has(r.nodeId)) {
        computeEdges.push([n.id, r.nodeId]);
      }
    }
  }

  const computeCycle = detectDirectedCycle(computeIds, computeEdges);
  if (computeCycle) {
    findings.push(
      errorFinding({
        code: "PBV2_E_EXPR_COMPUTE_DEP_CYCLE",
        message: "Compute dependency graph (nodeOutputRef usage) must be acyclic",
        path: "tree",
        context: { cycle: computeCycle },
      })
    );
  }

  // Required INPUT reachability under satisfiable conditions
  const enabledEdges = edges.filter((e) => e.status === "ENABLED" && e.fromNodeId && e.toNodeId);
  const adjacency: Record<string, EdgeRec[]> = {};
  for (const e of enabledEdges) {
    const from = nodesById[e.fromNodeId!];
    const to = nodesById[e.toNodeId!];
    if (!from || !to) continue;
    if (from.status !== "ENABLED" || to.status !== "ENABLED") continue;
    if (from.type === "GROUP" || to.type === "GROUP") continue;
    adjacency[from.id] ??= [];
    adjacency[from.id].push(e);
  }
  for (const list of Object.values(adjacency)) list.sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0) || a.id.localeCompare(b.id));

  const reachable = new Set<string>();
  const queue: string[] = [];
  for (const rid of rootNodeIds) {
    if (!isNonEmptyString(rid)) continue;
    const rootId = String(rid);
    const n = nodesById[rootId];
    if (!n || n.status !== "ENABLED" || n.type === "GROUP") continue;
    if (!reachable.has(rootId)) {
      reachable.add(rootId);
      queue.push(rootId);
    }
  }

  while (queue.length > 0) {
    const cur = queue.shift()!;
    const outs = adjacency[cur] ?? [];
    for (const e of outs) {
      if (isProvablyUnsat(e.condition)) continue;
      const toId = e.toNodeId!;
      if (!reachable.has(toId)) {
        reachable.add(toId);
        queue.push(toId);
      }
    }
  }

  const requiredInputs = nodes.filter((n) => n.status !== "DELETED" && n.type === "INPUT" && n.required);

  // incoming edges index
  const incoming: Record<string, EdgeRec[]> = {};
  for (const e of enabledEdges) {
    const toId = e.toNodeId;
    if (!toId) continue;
    incoming[toId] ??= [];
    incoming[toId].push(e);
  }
  for (const list of Object.values(incoming)) list.sort((a, b) => a.id.localeCompare(b.id));

  for (const n of requiredInputs) {
    if (n.status !== "ENABLED") continue;

    if (!reachable.has(n.id)) {
      findings.push(
        errorFinding({
          code: "PBV2_E_REQUIRED_INPUT_UNREACHABLE",
          message: "Required INPUT node is unreachable from roots under potentially satisfiable conditions",
          path: `tree.nodes[${n.id}]`,
          entityId: n.id,
          context: { selectionKey: n.selectionKey },
        })
      );
      continue;
    }

    if (n.selectionKey) {
      const inc = incoming[n.id] ?? [];
      if (inc.length > 0) {
        const allSelfGated = inc
          .filter((e) => !isProvablyUnsat(e.condition))
          .every((e) => collectSelectionKeysFromCondition(e.condition).has(n.selectionKey!));
        if (allSelfGated) {
          findings.push(
            errorFinding({
              code: "PBV2_E_REQUIRED_INPUT_UNREACHABLE",
              message: "Required INPUT is gated only by conditions that reference itself (circular visibility)",
              path: `tree.nodes[${n.id}]`,
              entityId: n.id,
              context: { selectionKey: n.selectionKey, circular: true },
            })
          );
        }
      }
    }
  }

  // Unreachable non-required ENABLED nodes => warning
  for (const n of nodes) {
    if (n.status !== "ENABLED") continue;
    if (n.type === "GROUP") continue;
    if (!reachable.has(n.id) && !(n.type === "INPUT" && n.required)) {
      findings.push(
        warningFinding({
          code: "PBV2_W_NODE_UNREACHABLE",
          message: "Node is ENABLED but unreachable from roots under potentially satisfiable conditions",
          path: `tree.nodes[${n.id}]`,
          entityId: n.id,
        })
      );
    }
  }

  const setBaseRateOverridesByUnit = new Map<
    ChoicePricingOverrideUnit,
    Array<{ nodeId: string; choiceValue: string; path: string }>
  >();

  // Choice-level override metadata validation
  for (const n of nodes) {
    if (n.status === "DELETED") continue;

    const choices = (n.raw as any).choices;
    if (!Array.isArray(choices)) continue;

    const seenChoiceValues = new Set<string>();
    for (let i = 0; i < choices.length; i++) {
      const choice = asRecord(choices[i]);
      const cPath = `tree.nodes[${n.id}].choices[${i}]`;
      if (!choice) {
        findings.push(
          errorFinding({
            code: "PBV2_E_CHOICE_OVERRIDE_INVALID",
            message: "Choice must be an object",
            path: cPath,
            entityId: n.id,
          })
        );
        continue;
      }

      const choiceValue = isNonEmptyString((choice as any).value) ? String((choice as any).value) : null;
      if (choiceValue) {
        if (seenChoiceValues.has(choiceValue)) {
          findings.push(
            errorFinding({
              code: "PBV2_E_CHOICE_VALUE_DUPLICATE",
              message: `Choice value '${choiceValue}' must be unique within its node`,
              path: `${cPath}.value`,
              entityId: n.id,
              context: { value: choiceValue },
            })
          );
        }
        seenChoiceValues.add(choiceValue);
      }

      const priceDeltaCents = (choice as any).priceDeltaCents;
      if (priceDeltaCents !== undefined && (!Number.isInteger(priceDeltaCents) || !Number.isFinite(priceDeltaCents))) {
        findings.push(
          errorFinding({
            code: "PBV2_E_CHOICE_OVERRIDE_INVALID",
            message: "priceDeltaCents must be a finite integer when provided",
            path: `${cPath}.priceDeltaCents`,
            entityId: n.id,
          })
        );
      }

      if ((choice as any).pricingOverride !== undefined) {
        const pricingOverride = normalizeChoicePricingOverride((choice as any).pricingOverride);
        if (!pricingOverride) {
          findings.push(
            errorFinding({
              code: "PBV2_E_CHOICE_PRICING_OVERRIDE_INVALID",
              message: "pricingOverride.mode must be one of: none, set_base_rate, add_base_rate, multiply_base_rate",
              path: `${cPath}.pricingOverride.mode`,
              entityId: n.id,
            })
          );
        } else if (pricingOverride.mode !== "none") {
          if (pricingOverride.amount === undefined) {
            findings.push(
              errorFinding({
                code: "PBV2_E_CHOICE_PRICING_OVERRIDE_INVALID",
                message: "pricingOverride.amount is required when pricingOverride.mode is active",
                path: `${cPath}.pricingOverride.amount`,
                entityId: n.id,
              })
            );
          } else if (
            (pricingOverride.mode === "set_base_rate" || pricingOverride.mode === "add_base_rate") &&
            (!Number.isInteger(pricingOverride.amount) || pricingOverride.amount < 0)
          ) {
            findings.push(
              errorFinding({
                code: "PBV2_E_CHOICE_PRICING_OVERRIDE_INVALID",
                message: "Base-rate pricingOverride.amount must be a non-negative integer number of cents",
                path: `${cPath}.pricingOverride.amount`,
                entityId: n.id,
              })
            );
          } else if (pricingOverride.mode === "multiply_base_rate" && pricingOverride.amount < 0) {
            findings.push(
              errorFinding({
                code: "PBV2_E_CHOICE_PRICING_OVERRIDE_INVALID",
                message: "multiply_base_rate amount must be non-negative",
                path: `${cPath}.pricingOverride.amount`,
                entityId: n.id,
              })
            );
          }

          const overrideUnit = inferChoicePricingOverrideUnit(pricingOverride);
          if (!overrideUnit) {
            findings.push(
              errorFinding({
                code: "PBV2_E_CHOICE_PRICING_OVERRIDE_INVALID",
                message: "pricingOverride.unit is required for active pricing overrides",
                path: `${cPath}.pricingOverride.unit`,
                entityId: n.id,
              })
            );
          } else {
            if (
              (overrideUnit === "perSqft" && pricingOverride.appliesTo && pricingOverride.appliesTo !== "area") ||
              (overrideUnit === "perPiece" && pricingOverride.appliesTo && pricingOverride.appliesTo !== "quantity") ||
              (overrideUnit === "minimumCharge" && pricingOverride.appliesTo && pricingOverride.appliesTo !== "base")
            ) {
              findings.push(
                warningFinding({
                  code: "PBV2_W_CHOICE_PRICING_OVERRIDE_APPLIES_TO_MISMATCH",
                  message: "pricingOverride.appliesTo does not match pricingOverride.unit",
                  path: `${cPath}.pricingOverride.appliesTo`,
                  entityId: n.id,
                })
              );
            }

            if (pricingOverride.mode === "set_base_rate") {
              const existing = setBaseRateOverridesByUnit.get(overrideUnit) ?? [];
              existing.push({
                nodeId: n.id,
                choiceValue: choiceValue ?? `choice_${i}`,
                path: cPath,
              });
              setBaseRateOverridesByUnit.set(overrideUnit, existing);
            }
          }
        }
      }

      const materialOverride = getExplicitMaterialOverride((choice as any).materialOverride);
      if (materialOverride === "invalid") {
        findings.push(
          errorFinding({
            code: "PBV2_E_CHOICE_OVERRIDE_INVALID",
            message: "materialOverride.materialId must be a non-empty string",
            path: `${cPath}.materialOverride.materialId`,
            entityId: n.id,
          })
        );
      }

      const workflowTagsRaw = (choice as any).workflowTags;
      if (workflowTagsRaw !== undefined) {
        if (!Array.isArray(workflowTagsRaw)) {
          findings.push(
            errorFinding({
              code: "PBV2_E_CHOICE_OVERRIDE_INVALID",
              message: "workflowTags must be an array of non-empty strings",
              path: `${cPath}.workflowTags`,
              entityId: n.id,
            })
          );
        } else {
          const normalizedTags = workflowTagsRaw
            .filter((tag): tag is string => typeof tag === "string")
            .map((tag) => tag.trim())
            .filter(Boolean);

          if (normalizedTags.length !== workflowTagsRaw.length) {
            findings.push(
              errorFinding({
                code: "PBV2_E_CHOICE_OVERRIDE_INVALID",
                message: "workflowTags may only contain non-empty strings",
                path: `${cPath}.workflowTags`,
                entityId: n.id,
              })
            );
          }

          const duplicateWorkflowTags = normalizedTags.filter((tag, idx) => normalizedTags.indexOf(tag) !== idx);
          if (duplicateWorkflowTags.length > 0) {
            findings.push(
              warningFinding({
                code: "PBV2_W_CHOICE_WORKFLOW_TAG_DUPLICATE",
                message: "workflowTags contains duplicate values",
                path: `${cPath}.workflowTags`,
                entityId: n.id,
                context: { duplicateTags: Array.from(new Set(duplicateWorkflowTags)).sort() },
              })
            );
          }
        }
      }

      if (materialOverride && materialOverride !== "invalid" && isNonEmptyString((materialOverride as any).materialId)) {
        const inventoryEntries = Array.isArray((choice as any).inventoryConsumption) ? (choice as any).inventoryConsumption : [];
        const distinctInventoryMaterialIds = Array.from(
          new Set(
            inventoryEntries
              .map(asRecord)
              .map((entry: Record<string, unknown> | null) => (entry && isNonEmptyString((entry as any).materialId) ? String((entry as any).materialId) : null))
              .filter((materialId: string | null): materialId is string => Boolean(materialId))
          )
        );

        const conflictingInventoryMaterialIds = distinctInventoryMaterialIds.filter(
          (materialId) => materialId !== String((materialOverride as any).materialId)
        );

        if (conflictingInventoryMaterialIds.length > 0) {
          findings.push(
            errorFinding({
              code: "PBV2_E_CHOICE_MATERIAL_OVERRIDE_CONFLICT",
              message: "materialOverride conflicts with inventoryConsumption material references",
              path: `${cPath}.materialOverride`,
              entityId: n.id,
              context: {
                materialOverrideId: String((materialOverride as any).materialId),
                conflictingInventoryMaterialIds: conflictingInventoryMaterialIds.sort(),
              },
            })
          );
        }
      }
    }
  }

  setBaseRateOverridesByUnit.forEach((entries, unit) => {
    const reachableEntries = entries.filter((entry) => reachable.has(entry.nodeId));
    const distinctReachableNodeIds = Array.from(new Set(reachableEntries.map((entry) => entry.nodeId)));
    if (distinctReachableNodeIds.length > 1) {
      findings.push(
        warningFinding({
          code: "PBV2_W_CHOICE_PRICING_OVERRIDE_POTENTIAL_CONFLICT",
          message: `Multiple reachable choices can set the same base pricing unit (${unit}); runtime pricing will reject conflicting active selections`,
          path: "tree.nodes",
          context: {
            unit,
            entries: reachableEntries.map((entry) => ({
              nodeId: entry.nodeId,
              choiceValue: entry.choiceValue,
              path: entry.path,
            })),
          },
        })
      );
    }
  });

  const pricingMeta = asRecord((t as any).meta);
  const metaPricingProfileKey = isNonEmptyString((pricingMeta as any)?.pricingProfileKey)
    ? String((pricingMeta as any).pricingProfileKey)
    : null;
  const metaPricingFormula = isNonEmptyString((pricingMeta as any)?.pricingFormula)
    ? String((pricingMeta as any).pricingFormula)
    : null;

  validateFormulaVariableReferences(
    findings,
    pricingMeta,
    metaPricingFormula,
    "tree.meta.pricingFormula",
    "Product pricing formula",
  );

  if (metaPricingProfileKey === "fee" && formulaUsesSqftPricing(metaPricingFormula)) {
    findings.push(
      warningFinding({
        code: "PBV2_W_FEE_FORMULA_USES_SQFT_PRICING",
        message: "Fee / Service products usually use flat-fee or per-item pricing. This formula uses sqft/base-rate variables; confirm this is intentional.",
        path: "tree.meta.pricingFormula",
      })
    );
  }

  for (const n of nodes) {
    if (n.status === "DELETED") continue;
    const nodeLabel = isNonEmptyString((n.raw as any).label) ? String((n.raw as any).label) : n.id;
    const nodeImpacts = Array.isArray((n.raw as any).pricingImpact) ? ((n.raw as any).pricingImpact as unknown[]) : [];
    for (let i = 0; i < nodeImpacts.length; i++) {
      const impact = asRecord(nodeImpacts[i]);
      if (!impact || (impact as any).mode !== "addFormula") continue;
      validateFormulaVariableReferences(
        findings,
        pricingMeta,
        (impact as any).formula,
        `nodes.${n.id}.pricingImpact.${i}.formula`,
        `Option "${nodeLabel}" pricing formula`,
      );
    }

    const choices = Array.isArray((n.raw as any).choices) ? ((n.raw as any).choices as unknown[]) : [];
    for (let i = 0; i < choices.length; i++) {
      const choice = asRecord(choices[i]);
      if (!choice) continue;
      const choiceLabel = isNonEmptyString((choice as any).label) ? String((choice as any).label) : `choice ${i + 1}`;
      const impacts = Array.isArray((choice as any).pricingImpact) ? ((choice as any).pricingImpact as unknown[]) : [];
      for (let j = 0; j < impacts.length; j++) {
        const impact = asRecord(impacts[j]);
        if (!impact || (impact as any).mode !== "addFormula") continue;
        validateFormulaVariableReferences(
          findings,
          pricingMeta,
          (impact as any).formula,
          `nodes.${n.id}.choices.${i}.pricingImpact.${j}.formula`,
          `Option "${nodeLabel}" choice "${choiceLabel}" pricing formula`,
        );
      }
    }
  }

  // Weight validation: check for negative weights (ERROR)
  const negativeWeights: Array<{ path: string; value: number; label?: string }> = [];

  // Check base weight (canonical field)
  const meta = pricingMeta;
  if (meta) {
    const baseWeightOz = meta.baseWeightOz;
    if (typeof baseWeightOz === "number" && baseWeightOz < 0) {
      negativeWeights.push({ path: "tree.meta.baseWeightOz", value: baseWeightOz, label: "Base weight" });
    }
    // Also check shippingConfig.baseWeight for negative values
    const shippingConfig = asRecord(meta.shippingConfig);
    if (shippingConfig) {
      const rawWeight = shippingConfig.baseWeight;
      let numWeight: number | null = null;
      if (typeof rawWeight === "number" && !isNaN(rawWeight)) numWeight = rawWeight;
      else if (typeof rawWeight === "string") {
        const p = parseFloat(rawWeight);
        if (!isNaN(p)) numWeight = p;
      }
      if (numWeight !== null && numWeight < 0) {
        negativeWeights.push({ path: "tree.meta.shippingConfig.baseWeight", value: numWeight, label: "Base weight (shipping config)" });
      }
    }
  }

  // Check node weightImpact
  for (const n of nodes) {
    const weightImpact = (n.raw as any).weightImpact;
    if (Array.isArray(weightImpact)) {
      for (let i = 0; i < weightImpact.length; i++) {
        const impact = asRecord(weightImpact[i]);
        if (impact) {
          const oz = impact.oz;
          if (typeof oz === "number" && oz < 0) {
            const label = impact.label ? String(impact.label) : `Node ${n.id}`;
            negativeWeights.push({
              path: `tree.nodes[${n.id}].weightImpact[${i}].oz`,
              value: oz,
              label,
            });
          }
        }
      }
    }

    // Check choice weightOz
    const choices = (n.raw as any).choices;
    if (Array.isArray(choices)) {
      for (let i = 0; i < choices.length; i++) {
        const choice = asRecord(choices[i]);
        if (choice) {
          const weightOz = choice.weightOz;
          if (typeof weightOz === "number" && weightOz < 0) {
            const choiceLabel = choice.label ? String(choice.label) : `choice ${i}`;
            const nodeLabel = (n.raw as any).label ? String((n.raw as any).label) : n.id;
            negativeWeights.push({
              path: `tree.nodes[${n.id}].choices[${i}].weightOz`,
              value: weightOz,
              label: `${nodeLabel}: ${choiceLabel}`,
            });
          }
        }
      }
    }
  }

  if (negativeWeights.length > 0) {
    for (const neg of negativeWeights) {
      findings.push(
        errorFinding({
          code: "PBV2_E_WEIGHT_NEGATIVE",
          message: `Weight cannot be negative: ${neg.label} (${neg.value} oz)`,
          path: neg.path,
        })
      );
    }
  }

  // Weight validation: check for missing weight (WARNING)
  let hasWeight = false;

  // Check base weight from meta.baseWeightOz (canonical field)
  if (meta) {
    const baseWeightOz = meta.baseWeightOz;
    if (typeof baseWeightOz === "number" && baseWeightOz > 0) {
      hasWeight = true;
    }
  }

  // Check base weight from meta.shippingConfig.baseWeight (form-managed field)
  // The product editor stores weight here: { baseWeight: 0.9, weightUnit: "oz" | "lb", ... }
  if (!hasWeight && meta) {
    const shippingConfig = asRecord(meta.shippingConfig);
    if (shippingConfig) {
      const rawWeight = shippingConfig.baseWeight;
      const weightUnit = typeof shippingConfig.weightUnit === "string" ? shippingConfig.weightUnit : "oz";
      let weightOz: number | null = null;
      if (typeof rawWeight === "number" && !isNaN(rawWeight)) {
        weightOz = rawWeight;
      } else if (typeof rawWeight === "string" && rawWeight.trim().length > 0) {
        const parsed = parseFloat(rawWeight);
        if (!isNaN(parsed)) weightOz = parsed;
      }
      if (weightOz !== null && weightOz > 0) {
        // Convert lbs to oz if needed for comparison (any positive weight satisfies the check)
        hasWeight = weightUnit === "lb" ? weightOz > 0 : weightOz > 0;
      }
    }
  }

  // Check node weightImpact for non-zero values
  if (!hasWeight) {
    for (const n of nodes) {
      const weightImpact = (n.raw as any).weightImpact;
      if (Array.isArray(weightImpact)) {
        for (const impact of weightImpact) {
          const impactRec = asRecord(impact);
          if (impactRec) {
            const oz = impactRec.oz;
            if (typeof oz === "number" && oz !== 0) {
              hasWeight = true;
              break;
            }
          }
        }
      }
      if (hasWeight) break;

      // Check choice weightOz for non-zero values
      const choices = (n.raw as any).choices;
      if (Array.isArray(choices)) {
        for (const choice of choices) {
          const choiceRec = asRecord(choice);
          if (choiceRec) {
            const weightOz = choiceRec.weightOz;
            if (typeof weightOz === "number" && weightOz !== 0) {
              hasWeight = true;
              break;
            }
          }
        }
      }
      if (hasWeight) break;
    }
  }

  if (!hasWeight) {
    findings.push(
      warningFinding({
        code: "PBV2_W_WEIGHT_MISSING",
        message: "Product has no weight defined (base weight and option weights are missing). Shipping weight will be 0.",
        path: "tree",
      })
    );
  }

  return toResult(findings);
}
