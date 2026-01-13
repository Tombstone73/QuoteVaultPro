import { buildSymbolTable } from "../symbolTable";
import { typeCheckCondition } from "../typeChecker";
import { errorFinding, warningFinding, type Finding } from "../findings";
import { DEFAULT_VALIDATE_OPTS, type ProductOptionTreeV2Json, type RestoreChangeSet, type ValidateOpts, type ValidationResult } from "./types";

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

function extractNodes(tree: Record<string, unknown>, restoredNodeIds: Set<string>): NodeRec[] {
  const nodesRaw = tree.nodes;

  const out: NodeRec[] = [];

  const add = (id: string, raw: Record<string, unknown>) => {
    const originalStatus = normalizeStatus((raw as any).status);
    const status: PBV2Status = restoredNodeIds.has(id) ? "ENABLED" : originalStatus;

    const type =
      normalizeNodeType((raw as any).type ?? (raw as any).nodeType ?? (raw as any).kind) ??
      ((raw as any).kind === "question" ? "INPUT" : (raw as any).kind === "computed" ? "COMPUTE" : (raw as any).kind === "group" ? "GROUP" : null);

    const key = isNonEmptyString((raw as any).key) ? String((raw as any).key) : null;

    const input = asRecord((raw as any).input) ?? asRecord((raw as any).data);
    const selectionKey = input && isNonEmptyString((input as any).selectionKey) ? String((input as any).selectionKey) : null;

    const constraints = (input && (input as any).constraints) || (raw as any).constraints;
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

function extractEdges(tree: Record<string, unknown>, restoredEdgeIds: Set<string>): EdgeRec[] {
  const edgesRaw = tree.edges;
  const out: EdgeRec[] = [];

  const add = (id: string, raw: Record<string, unknown>) => {
    const originalStatus = normalizeStatus((raw as any).status);
    const status: PBV2Status = restoredEdgeIds.has(id) ? "ENABLED" : originalStatus;

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

  const byX: Record<string, Set<string>> = {};
  for (const e of eqs) {
    byX[e.xKey] ??= new Set<string>();
    byX[e.xKey].add(e.literalKey);
    if (byX[e.xKey].size > 1) return true;
  }

  for (const x of Object.keys(lower)) {
    const lo = lower[x];
    const hi = upper[x];
    if (hi !== undefined && lo !== undefined && lo > hi) return true;
  }

  return false;
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

export function validateTreeForRestore(tree: ProductOptionTreeV2Json, restore: RestoreChangeSet, opts: ValidateOpts): ValidationResult {
  const policy: ValidateOpts = { ...DEFAULT_VALIDATE_OPTS, ...(opts ?? ({} as any)) };
  const findings: Finding[] = [];

  const t = asRecord(tree);
  if (!t) {
    return toResult([
      errorFinding({
        code: "PBV2_E_RESTORE_NOT_IN_DRAFT",
        message: "Tree must be an object",
        path: "tree",
      }),
    ]);
  }

  const status = String((t as any).status ?? "").toUpperCase();
  if (status !== "DRAFT") {
    findings.push(
      errorFinding({
        code: "PBV2_E_RESTORE_NOT_IN_DRAFT",
        message: "Restore is allowed only in DRAFT trees",
        path: "tree.status",
        context: { status: (t as any).status },
      })
    );
  }

  const restoredNodeIds = new Set<string>((restore?.restoredNodeIds ?? []).filter(isNonEmptyString));
  const restoredEdgeIds = new Set<string>((restore?.restoredEdgeIds ?? []).filter(isNonEmptyString));

  const nodes = extractNodes(t, restoredNodeIds);
  const edges = extractEdges(t, restoredEdgeIds);

  const nodesById: Record<string, NodeRec> = {};
  for (const n of nodes) nodesById[n.id] = n;

  const symbol = buildSymbolTable(tree, { pathBase: "tree" });
  // Restore uses publish-level ref checks for edge conditions.
  findings.push(...symbol.findings);

  // key collision checks involving restored nodes
  const keyToIds: Record<string, string[]> = {};
  for (const n of nodes) {
    if (n.status === "DELETED") continue;
    if (!n.key) continue;
    keyToIds[n.key] ??= [];
    keyToIds[n.key].push(n.id);
  }

  for (const [key, ids] of Object.entries(keyToIds)) {
    if (ids.length <= 1) continue;
    const involvesRestored = ids.some((id) => restoredNodeIds.has(id));
    if (!involvesRestored) continue;
    findings.push(
      errorFinding({
        code: "PBV2_E_RESTORE_KEY_COLLISION",
        message: `Restoring node.key '${key}' collides with existing node.key`,
        path: "tree.nodes",
        context: { key, nodeIds: ids.sort() },
      })
    );
  }

  const selectionKeyToIds: Record<string, string[]> = {};
  for (const n of nodes) {
    if (n.status === "DELETED") continue;
    if (n.type !== "INPUT") continue;
    if (!n.selectionKey) continue;
    selectionKeyToIds[n.selectionKey] ??= [];
    selectionKeyToIds[n.selectionKey].push(n.id);
  }

  for (const [sk, ids] of Object.entries(selectionKeyToIds)) {
    if (ids.length <= 1) continue;
    const involvesRestored = ids.some((id) => restoredNodeIds.has(id));
    if (!involvesRestored) continue;
    findings.push(
      errorFinding({
        code: "PBV2_E_RESTORE_SELECTION_KEY_COLLISION",
        message: `Restoring INPUT.selectionKey '${sk}' collides with existing selectionKey`,
        path: "tree.nodes",
        context: { selectionKey: sk, nodeIds: ids.sort() },
      })
    );
  }

  // Prevent ENABLED edges pointing to DELETED endpoints
  for (const e of edges) {
    const edgePath = `tree.edges[${e.id}]`;

    // Condition validation (structure + ref/type)
    findings.push(...typeCheckCondition(e.condition, symbol.table, { pathBase: `${edgePath}.condition`, entityId: e.id }).findings);

    if (e.status !== "ENABLED") continue;
    if (!e.fromNodeId || !e.toNodeId) continue;

    const from = nodesById[e.fromNodeId];
    const to = nodesById[e.toNodeId];

    if ((from && from.status === "DELETED") || (to && to.status === "DELETED")) {
      findings.push(
        errorFinding({
          code: "PBV2_E_RESTORE_EDGE_TO_DELETED",
          message: "Restored/ENABLED edges must not point to DELETED endpoints",
          path: edgePath,
          entityId: e.id,
          context: { fromNodeId: e.fromNodeId, toNodeId: e.toNodeId, fromStatus: from?.status, toStatus: to?.status },
        })
      );
    }
  }

  // Re-run cycle + required reachability on the resulting runtime graph
  const rootNodeIds = Array.isArray((t as any).rootNodeIds) ? ((t as any).rootNodeIds as unknown[]) : [];

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

  const cycle = detectDirectedCycle(runtimeNodeIds, runtimeEdges);
  if (cycle) {
    findings.push(
      errorFinding({
        code: "PBV2_E_GRAPH_CYCLE",
        message: "Runtime dependency graph (ENABLED nodes/edges) must be acyclic",
        path: "tree",
        context: { cycle },
      })
    );
  }

  // Reachability
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

  const requiredInputs = nodes.filter((n) => n.status === "ENABLED" && n.type === "INPUT" && n.required);
  for (const n of requiredInputs) {
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
    }
  }

  // If ambiguity policy is strict, elevate any ambiguous edge findings already present in tree after restore.
  if (policy.ambiguousEdgesStrict) {
    const ambiguous = findings.filter((f) => f.code === "PBV2_W_EDGE_AMBIGUOUS_MATCH");
    for (const f of ambiguous) {
      if (f.severity === "WARNING") f.severity = "ERROR";
    }
  }

  // Best-effort: warn if restoredNodeIds is empty
  if (restoredNodeIds.size === 0 && restoredEdgeIds.size === 0) {
    findings.push(
      warningFinding({
        code: "PBV2_W_RESTORE_EMPTY_CHANGESET",
        message: "RestoreChangeSet is empty (no restoredNodeIds/restoredEdgeIds)",
        path: "restore",
      })
    );
  }

  return toResult(findings);
}
