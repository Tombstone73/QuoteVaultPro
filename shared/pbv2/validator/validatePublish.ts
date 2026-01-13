import { buildSymbolTable } from "../symbolTable";
import { typeCheckCondition, typeCheckExpression } from "../typeChecker";
import { errorFinding, warningFinding, infoFinding, type Finding } from "../findings";
import type { ConditionRule, ExpressionSpec } from "../expressionSpec";
import { DEFAULT_VALIDATE_OPTS, type ProductOptionTreeV2Json, type ValidateOpts, type ValidationResult } from "./types";

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

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object") return null;
  return value as Record<string, unknown>;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
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
      if ((r.kind === "selectionRef" || r.kind === "effectiveRef") && isNonEmptyString(r.selectionKey)) {
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

  return toResult(findings);
}
