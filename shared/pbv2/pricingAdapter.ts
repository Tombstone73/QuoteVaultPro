import type { ConditionRule, ExpressionLiteral, ExpressionSpec } from "./expressionSpec";

export type Pbv2Selections = {
  explicitSelections?: Record<string, unknown>;
};

export type Pbv2Env = {
  widthIn?: number;
  heightIn?: number;
  quantity?: number;
  sqft?: number;
  perimeterIn?: number;
  [k: string]: unknown;
};

export type Pbv2PricingBreakdownLine = {
  nodeId: string;
  componentIndex: number;
  kind: string;
  amountCents: number;
  quantity?: number;
  unitPriceCents?: number;
};

export type Pbv2PricingAddonsResult = {
  addOnCents: number;
  breakdown: Pbv2PricingBreakdownLine[];
};

type AnyRecord = Record<string, unknown>;

type NodeStatus = "ENABLED" | "DISABLED" | "DELETED";

type NodeRec = {
  id: string;
  status: NodeStatus;
  type: string;
  raw: AnyRecord;
};

type EdgeRec = {
  id: string;
  status: NodeStatus;
  fromNodeId: string;
  toNodeId: string;
  priority: number;
  condition?: unknown;
};

function asRecord(value: unknown): AnyRecord | null {
  if (!value || typeof value !== "object") return null;
  return value as AnyRecord;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function normalizeStatus(value: unknown): NodeStatus {
  if (typeof value !== "string") return "ENABLED";
  const upper = value.toUpperCase();
  if (upper === "ENABLED") return "ENABLED";
  if (upper === "DISABLED") return "DISABLED";
  if (upper === "DELETED") return "DELETED";
  return "ENABLED";
}

function normalizeNodeType(value: unknown): string {
  return typeof value === "string" ? value.toUpperCase() : "";
}

function extractNodes(tree: AnyRecord): NodeRec[] {
  const nodesValue = tree.nodes;
  const out: NodeRec[] = [];

  if (Array.isArray(nodesValue)) {
    for (const raw of nodesValue) {
      const rec = asRecord(raw);
      if (!rec) continue;
      const id = isNonEmptyString(rec.id) ? rec.id : isNonEmptyString((rec as any).nodeId) ? String((rec as any).nodeId) : "";
      if (!id) continue;
      out.push({
        id,
        status: normalizeStatus((rec as any).status),
        type: normalizeNodeType((rec as any).type ?? (rec as any).nodeType ?? (rec as any).kind),
        raw: rec,
      });
    }
    return out;
  }

  const nodesRecord = asRecord(nodesValue);
  if (nodesRecord) {
    for (const [key, raw] of Object.entries(nodesRecord)) {
      const rec = asRecord(raw);
      if (!rec) continue;
      const id = isNonEmptyString(rec.id) ? rec.id : key;
      if (!id) continue;
      out.push({
        id,
        status: normalizeStatus((rec as any).status),
        type: normalizeNodeType((rec as any).type ?? (rec as any).nodeType ?? (rec as any).kind),
        raw: rec,
      });
    }
  }

  return out;
}

function extractEdges(tree: AnyRecord): EdgeRec[] {
  const edgesValue = tree.edges;
  const out: EdgeRec[] = [];

  if (Array.isArray(edgesValue)) {
    for (const raw of edgesValue) {
      const rec = asRecord(raw);
      if (!rec) continue;
      const id = isNonEmptyString(rec.id) ? rec.id : "";
      const fromNodeId = (rec as any).fromNodeId;
      const toNodeId = (rec as any).toNodeId;
      if (!isNonEmptyString(id) || !isNonEmptyString(fromNodeId) || !isNonEmptyString(toNodeId)) continue;
      out.push({
        id,
        status: normalizeStatus((rec as any).status),
        fromNodeId,
        toNodeId,
        priority: Number.isInteger((rec as any).priority) ? (rec as any).priority : 0,
        condition: (rec as any).condition,
      });
    }
    return out;
  }

  const edgesRecord = asRecord(edgesValue);
  if (edgesRecord) {
    for (const [key, raw] of Object.entries(edgesRecord)) {
      const rec = asRecord(raw);
      if (!rec) continue;
      const id = isNonEmptyString(rec.id) ? rec.id : key;
      const fromNodeId = (rec as any).fromNodeId;
      const toNodeId = (rec as any).toNodeId;
      if (!isNonEmptyString(id) || !isNonEmptyString(fromNodeId) || !isNonEmptyString(toNodeId)) continue;
      out.push({
        id,
        status: normalizeStatus((rec as any).status),
        fromNodeId,
        toNodeId,
        priority: Number.isInteger((rec as any).priority) ? (rec as any).priority : 0,
        condition: (rec as any).condition,
      });
    }
  }

  return out;
}

function extractRootNodeIds(tree: AnyRecord): string[] {
  const roots = tree.rootNodeIds;
  if (!Array.isArray(roots)) return [];
  return roots.filter(isNonEmptyString);
}

function extractInputPayload(node: AnyRecord): AnyRecord | null {
  return asRecord((node as any).input) ?? asRecord((node as any).data);
}

function extractInputDefault(node: AnyRecord): unknown {
  const input = extractInputPayload(node);
  if (!input) return undefined;
  if (Object.prototype.hasOwnProperty.call(input, "defaultValue")) return (input as any).defaultValue;
  if (Object.prototype.hasOwnProperty.call(input, "default")) return (input as any).default;
  return undefined;
}

function extractComputePayload(node: AnyRecord): AnyRecord | null {
  return asRecord((node as any).compute) ?? asRecord((node as any).data);
}

function extractComputeExpression(node: AnyRecord): unknown {
  const compute = extractComputePayload(node);
  return compute ? (compute as any).expression ?? (compute as any).expr : undefined;
}

function extractComputeOutputs(node: AnyRecord): Record<string, { type?: string }> {
  const compute = extractComputePayload(node);
  const outputsRaw = compute ? ((compute as any).outputs ?? (compute as any).outputSchema) : undefined;
  const outputsRecord = asRecord(outputsRaw);
  if (!outputsRecord) {
    const maybeOutputType = (compute as any)?.outputType;
    if (isNonEmptyString(maybeOutputType)) return { value: { type: maybeOutputType } };
    return {};
  }
  const out: Record<string, { type?: string }> = {};
  for (const [key, raw] of Object.entries(outputsRecord)) {
    const rec = asRecord(raw);
    out[key] = { type: isNonEmptyString((rec as any)?.type) ? String((rec as any).type) : undefined };
  }
  return out;
}

function extractPricePayload(node: AnyRecord): AnyRecord | null {
  return asRecord((node as any).price) ?? asRecord((node as any).data);
}

function extractPriceComponents(node: AnyRecord): unknown[] {
  const price = extractPricePayload(node);
  const comps = price ? (price as any).components : undefined;
  return Array.isArray(comps) ? comps : [];
}

type EvalCtx = {
  selections: Record<string, unknown>;
  inputDefaultsBySelectionKey: Record<string, unknown>;
  computeOutputsByNodeId: Record<string, Record<string, unknown>>;
  env: Record<string, unknown>;
  pricebook?: Record<string, number>;
};

function isNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function toNumberOrThrow(value: unknown, message: string): number {
  if (!isNumber(value)) throw new Error(message);
  return value;
}

function evalRef(ref: any, ctx: EvalCtx): unknown {
  if (!ref || typeof ref !== "object") return null;

  switch (ref.kind) {
    case "constant":
      return ref.value ?? null;

    case "selectionRef": {
      if (!isNonEmptyString(ref.selectionKey)) return null;
      return Object.prototype.hasOwnProperty.call(ctx.selections, ref.selectionKey) ? ctx.selections[ref.selectionKey] : null;
    }

    case "effectiveRef": {
      if (!isNonEmptyString(ref.selectionKey)) return null;
      if (Object.prototype.hasOwnProperty.call(ctx.selections, ref.selectionKey)) return ctx.selections[ref.selectionKey];
      if (Object.prototype.hasOwnProperty.call(ctx.inputDefaultsBySelectionKey, ref.selectionKey)) return ctx.inputDefaultsBySelectionKey[ref.selectionKey];
      return null;
    }

    case "nodeOutputRef": {
      const nodeId = ref.nodeId;
      const outputKey = ref.outputKey;
      if (!isNonEmptyString(nodeId) || !isNonEmptyString(outputKey)) return null;
      return ctx.computeOutputsByNodeId[nodeId]?.[outputKey] ?? null;
    }

    case "envRef": {
      const envKey = ref.envKey;
      if (!isNonEmptyString(envKey)) return null;
      return Object.prototype.hasOwnProperty.call(ctx.env, envKey) ? ctx.env[envKey] : null;
    }

    case "pricebookRef": {
      const key = ref.key;
      if (!isNonEmptyString(key)) return null;
      if (!ctx.pricebook) return null;
      return Object.prototype.hasOwnProperty.call(ctx.pricebook, key) ? ctx.pricebook[key] : null;
    }

    default:
      return null;
  }
}

function evalExpression(expr: ExpressionSpec, ctx: EvalCtx): ExpressionLiteral {
  switch (expr.op) {
    case "literal":
      return expr.value;

    case "ref":
      return evalRef(expr.ref as any, ctx) as any;

    case "and":
      return expr.args.every((a) => Boolean(evalExpression(a, ctx)));

    case "or":
      return expr.args.some((a) => Boolean(evalExpression(a, ctx)));

    case "not":
      return !Boolean(evalExpression(expr.arg, ctx));

    case "eq":
      return (evalExpression(expr.left, ctx) as any) === (evalExpression(expr.right, ctx) as any);

    case "ne":
      return (evalExpression(expr.left, ctx) as any) !== (evalExpression(expr.right, ctx) as any);

    case "lt":
      return toNumberOrThrow(evalExpression(expr.left, ctx), "lt(): left must be NUMBER") <
        toNumberOrThrow(evalExpression(expr.right, ctx), "lt(): right must be NUMBER");

    case "lte":
      return toNumberOrThrow(evalExpression(expr.left, ctx), "lte(): left must be NUMBER") <=
        toNumberOrThrow(evalExpression(expr.right, ctx), "lte(): right must be NUMBER");

    case "gt":
      return toNumberOrThrow(evalExpression(expr.left, ctx), "gt(): left must be NUMBER") >
        toNumberOrThrow(evalExpression(expr.right, ctx), "gt(): right must be NUMBER");

    case "gte":
      return toNumberOrThrow(evalExpression(expr.left, ctx), "gte(): left must be NUMBER") >=
        toNumberOrThrow(evalExpression(expr.right, ctx), "gte(): right must be NUMBER");

    case "add":
      return toNumberOrThrow(evalExpression(expr.left, ctx), "add(): left must be NUMBER") +
        toNumberOrThrow(evalExpression(expr.right, ctx), "add(): right must be NUMBER");

    case "sub":
      return toNumberOrThrow(evalExpression(expr.left, ctx), "sub(): left must be NUMBER") -
        toNumberOrThrow(evalExpression(expr.right, ctx), "sub(): right must be NUMBER");

    case "mul":
      return toNumberOrThrow(evalExpression(expr.left, ctx), "mul(): left must be NUMBER") *
        toNumberOrThrow(evalExpression(expr.right, ctx), "mul(): right must be NUMBER");

    case "div":
      return toNumberOrThrow(evalExpression(expr.left, ctx), "div(): left must be NUMBER") /
        toNumberOrThrow(evalExpression(expr.right, ctx), "div(): right must be NUMBER");

    case "mod":
      return toNumberOrThrow(evalExpression(expr.left, ctx), "mod(): left must be NUMBER") %
        toNumberOrThrow(evalExpression(expr.right, ctx), "mod(): right must be NUMBER");

    case "abs":
      return Math.abs(toNumberOrThrow(evalExpression(expr.arg, ctx), "abs(): arg must be NUMBER"));

    case "min":
      return Math.min(
        toNumberOrThrow(evalExpression(expr.left, ctx), "min(): left must be NUMBER"),
        toNumberOrThrow(evalExpression(expr.right, ctx), "min(): right must be NUMBER")
      );

    case "max":
      return Math.max(
        toNumberOrThrow(evalExpression(expr.left, ctx), "max(): left must be NUMBER"),
        toNumberOrThrow(evalExpression(expr.right, ctx), "max(): right must be NUMBER")
      );

    case "clamp": {
      const x = toNumberOrThrow(evalExpression(expr.x, ctx), "clamp(): x must be NUMBER");
      const lo = toNumberOrThrow(evalExpression(expr.lo, ctx), "clamp(): lo must be NUMBER");
      const hi = toNumberOrThrow(evalExpression(expr.hi, ctx), "clamp(): hi must be NUMBER");
      return Math.min(Math.max(x, lo), hi);
    }

    case "round": {
      const x = toNumberOrThrow(evalExpression(expr.x, ctx), "round(): x must be NUMBER");
      const digits = expr.digits === undefined ? 0 : toNumberOrThrow(evalExpression(expr.digits, ctx), "round(): digits must be NUMBER");
      const pow = Math.pow(10, digits);
      return Math.round(x * pow) / pow;
    }

    case "floor":
      return Math.floor(toNumberOrThrow(evalExpression(expr.x, ctx), "floor(): x must be NUMBER"));

    case "ceil":
      return Math.ceil(toNumberOrThrow(evalExpression(expr.x, ctx), "ceil(): x must be NUMBER"));

    case "if":
      return Boolean(evalExpression(expr.cond, ctx)) ? (evalExpression(expr.then, ctx) as any) : (evalExpression(expr.else, ctx) as any);

    case "exists":
      return evalExpression(expr.x, ctx) !== null && evalExpression(expr.x, ctx) !== undefined;

    case "coalesce": {
      for (const a of expr.args) {
        const v = evalExpression(a, ctx);
        if (v !== null && v !== undefined) return v;
      }
      return null;
    }

    case "concat":
      return expr.args.map((a) => String(evalExpression(a, ctx) ?? "")).join("");

    case "strlen":
      return String(evalExpression(expr.x, ctx) ?? "").length;

    default: {
      const _exhaustive: never = expr;
      return _exhaustive as any;
    }
  }
}

function evalCondition(rule: ConditionRule, ctx: EvalCtx): boolean {
  switch (rule.op) {
    case "AND":
      return rule.args.every((a) => evalCondition(a, ctx));
    case "OR":
      return rule.args.some((a) => evalCondition(a, ctx));
    case "NOT":
      return !evalCondition(rule.arg, ctx);
    case "EXISTS": {
      const v = evalExpression(rule.value, ctx);
      return v !== null && v !== undefined;
    }
    case "EQ":
      return (evalExpression(rule.left, ctx) as any) === (evalExpression(rule.right, ctx) as any);
    case "NEQ":
      return (evalExpression(rule.left, ctx) as any) !== (evalExpression(rule.right, ctx) as any);
    case "GT":
      return toNumberOrThrow(evalExpression(rule.left, ctx), "GT.left must be NUMBER") >
        toNumberOrThrow(evalExpression(rule.right, ctx), "GT.right must be NUMBER");
    case "GTE":
      return toNumberOrThrow(evalExpression(rule.left, ctx), "GTE.left must be NUMBER") >=
        toNumberOrThrow(evalExpression(rule.right, ctx), "GTE.right must be NUMBER");
    case "LT":
      return toNumberOrThrow(evalExpression(rule.left, ctx), "LT.left must be NUMBER") <
        toNumberOrThrow(evalExpression(rule.right, ctx), "LT.right must be NUMBER");
    case "LTE":
      return toNumberOrThrow(evalExpression(rule.left, ctx), "LTE.left must be NUMBER") <=
        toNumberOrThrow(evalExpression(rule.right, ctx), "LTE.right must be NUMBER");
    case "IN": {
      const v = evalExpression(rule.value, ctx);
      for (const o of rule.options) {
        if ((evalExpression(o, ctx) as any) === (v as any)) return true;
      }
      return false;
    }
    default: {
      const _exhaustive: never = rule;
      return _exhaustive as any;
    }
  }
}

function resolveActiveNodeIds(tree: AnyRecord, nodesById: Record<string, NodeRec>, edges: EdgeRec[], ctx: EvalCtx): Set<string> {
  const active = new Set<string>();
  const roots = extractRootNodeIds(tree);

  const outgoing: Record<string, EdgeRec[]> = {};
  for (const e of edges) {
    if (e.status !== "ENABLED") continue;
    const from = nodesById[e.fromNodeId];
    const to = nodesById[e.toNodeId];
    if (!from || !to) continue;
    if (from.status !== "ENABLED" || to.status !== "ENABLED") continue;
    if (from.type === "GROUP" || to.type === "GROUP") continue;
    outgoing[e.fromNodeId] ??= [];
    outgoing[e.fromNodeId].push(e);
  }
  for (const list of Object.values(outgoing)) {
    list.sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0) || a.id.localeCompare(b.id));
  }

  const queue: string[] = [];
  for (const rid of roots) {
    const n = nodesById[rid];
    if (!n || n.status !== "ENABLED" || n.type === "GROUP") continue;
    if (!active.has(rid)) {
      active.add(rid);
      queue.push(rid);
    }
  }

  // Deterministic traversal: at each node, follow the first matching edge for each priority bucket.
  while (queue.length > 0) {
    const cur = queue.shift()!;
    const outs = outgoing[cur] ?? [];

    // group by priority
    const byPriority: Record<string, EdgeRec[]> = {};
    for (const e of outs) {
      const p = e.priority ?? 0;
      const key = String(p);
      byPriority[key] ??= [];
      byPriority[key].push(e);
    }

    const priorities = Object.keys(byPriority)
      .map((p) => Number(p))
      .filter((p) => Number.isFinite(p))
      .sort((a, b) => a - b);

    for (const p of priorities) {
      const candidates = (byPriority[String(p)] ?? []).slice().sort((a, b) => a.id.localeCompare(b.id));
      for (const e of candidates) {
        const cond = e.condition as any;
        const ok = cond ? evalCondition(cond as ConditionRule, ctx) : true;
        if (!ok) continue;

        const toId = e.toNodeId;
        if (!active.has(toId)) {
          active.add(toId);
          queue.push(toId);
        }

        // only first match per priority
        break;
      }
    }
  }

  return active;
}

function topoSortComputeNodes(computeNodeIds: string[], exprByNodeId: Record<string, ExpressionSpec>): string[] {
  const deps: Record<string, Set<string>> = {};
  const rev: Record<string, Set<string>> = {};

  const idSet = new Set(computeNodeIds);

  const collectNodeOutputRefs = (expr: ExpressionSpec): string[] => {
    const out: string[] = [];
    const walk = (e: ExpressionSpec) => {
      if (e.op === "ref" && (e.ref as any)?.kind === "nodeOutputRef") {
        const nodeId = (e.ref as any).nodeId;
        if (isNonEmptyString(nodeId)) out.push(nodeId);
      }
      for (const v of Object.values(e as any)) {
        if (!v) continue;
        if (Array.isArray(v)) {
          for (const item of v) {
            if (item && typeof item === "object" && typeof (item as any).op === "string") walk(item as any);
          }
        } else if (v && typeof v === "object" && typeof (v as any).op === "string") {
          walk(v as any);
        }
      }
    };
    walk(expr);
    return out;
  };

  for (const id of computeNodeIds) {
    deps[id] = new Set<string>();
    rev[id] = new Set<string>();
  }

  for (const id of computeNodeIds) {
    const expr = exprByNodeId[id];
    const refs = collectNodeOutputRefs(expr);
    for (const other of refs) {
      if (!idSet.has(other)) continue;
      if (other === id) continue;
      deps[id].add(other);
      rev[other].add(id);
    }
  }

  const inDegree: Record<string, number> = {};
  for (const id of computeNodeIds) inDegree[id] = deps[id].size;

  const queue = computeNodeIds.filter((id) => inDegree[id] === 0).sort();
  const out: string[] = [];

  while (queue.length > 0) {
    const id = queue.shift()!;
    out.push(id);
    rev[id].forEach((dependent) => {
      inDegree[dependent]--;
      if (inDegree[dependent] === 0) {
        queue.push(dependent);
        queue.sort();
      }
    });
  }

  if (out.length !== computeNodeIds.length) {
    throw new Error("PBV2 compute dependency cycle detected during evaluation");
  }

  return out;
}

export function pbv2ToPricingAddons(
  treeJson: unknown,
  selections: Pbv2Selections | Record<string, unknown> | undefined,
  env: Pbv2Env | undefined,
  opts?: { pricebook?: Record<string, number> }
): Pbv2PricingAddonsResult {
  const tree = asRecord(treeJson);
  if (!tree) throw new Error("Invalid PBV2 treeJson");

  const nodes = extractNodes(tree);
  const edges = extractEdges(tree);

  const nodesById: Record<string, NodeRec> = {};
  for (const n of nodes) nodesById[n.id] = n;

  const explicitSelections = (() => {
    if (!selections) return {};
    if ((selections as any).explicitSelections && typeof (selections as any).explicitSelections === "object") {
      return (selections as any).explicitSelections as Record<string, unknown>;
    }
    return selections as Record<string, unknown>;
  })();

  const envMap: Record<string, unknown> = { ...(env ?? {}) };

  const inputDefaultsBySelectionKey: Record<string, unknown> = {};
  for (const n of nodes) {
    if (n.status !== "ENABLED") continue;
    if (n.type !== "INPUT") continue;
    const payload = extractInputPayload(n.raw);
    const selectionKey = payload && isNonEmptyString((payload as any).selectionKey) ? String((payload as any).selectionKey) : null;
    if (!selectionKey) continue;
    const def = extractInputDefault(n.raw);
    if (def !== undefined) inputDefaultsBySelectionKey[selectionKey] = def;
  }

  const evalCtx: EvalCtx = {
    selections: explicitSelections,
    inputDefaultsBySelectionKey,
    computeOutputsByNodeId: {},
    env: envMap,
    pricebook: opts?.pricebook,
  };

  const activeNodeIds = resolveActiveNodeIds(tree, nodesById, edges, evalCtx);

  // Evaluate COMPUTE nodes in dependency order (active subset)
  const activeComputeNodes = nodes.filter((n) => n.status === "ENABLED" && n.type === "COMPUTE" && activeNodeIds.has(n.id));
  const exprByComputeId: Record<string, ExpressionSpec> = {};
  const outputsByComputeId: Record<string, string[]> = {};

  for (const n of activeComputeNodes) {
    const exprRaw = extractComputeExpression(n.raw);
    const expr = exprRaw as ExpressionSpec;
    if (!expr || typeof expr !== "object" || typeof (expr as any).op !== "string") {
      throw new Error(`PBV2 compute node '${n.id}' has invalid expression`);
    }
    exprByComputeId[n.id] = expr;

    const outputs = extractComputeOutputs(n.raw);
    const keys = Object.keys(outputs);
    if (keys.length !== 1) {
      throw new Error(`PBV2 compute node '${n.id}' must define exactly 1 output key for runtime adapter`);
    }
    outputsByComputeId[n.id] = keys;
  }

  const computeOrder = topoSortComputeNodes(
    activeComputeNodes.map((n) => n.id).sort(),
    exprByComputeId
  );

  for (const id of computeOrder) {
    const expr = exprByComputeId[id];
    const outKey = outputsByComputeId[id][0];
    const value = evalExpression(expr, evalCtx);
    evalCtx.computeOutputsByNodeId[id] = { [outKey]: value };
  }

  // Evaluate PRICE nodes/components
  const breakdown: Pbv2PricingBreakdownLine[] = [];
  let addOnCents = 0;

  const activePriceNodes = nodes.filter((n) => n.status === "ENABLED" && n.type === "PRICE" && activeNodeIds.has(n.id));

  for (const n of activePriceNodes) {
    const comps = extractPriceComponents(n.raw);

    for (let i = 0; i < comps.length; i++) {
      const c = asRecord(comps[i]);
      if (!c) continue;

      const appliesWhenRaw = (c as any).appliesWhen;
      if (appliesWhenRaw) {
        const ok = evalCondition(appliesWhenRaw as ConditionRule, evalCtx);
        if (!ok) continue;
      }

      const kind = typeof (c as any).kind === "string" ? (c as any).kind.toUpperCase() : "";
      if (!kind) continue;

      const unitPriceExpr = (c as any).unitPriceRef as ExpressionSpec | undefined;
      const quantityExpr = (c as any).quantityRef as ExpressionSpec | undefined;
      const overageBaseExpr = (c as any).overageBaseRef as ExpressionSpec | undefined;

      const unitPriceCents = unitPriceExpr ? toNumberOrThrow(evalExpression(unitPriceExpr, evalCtx), `PRICE '${n.id}' unitPriceRef must be NUMBER`) : 0;

      let amountCents = 0;
      let quantity: number | undefined;

      if (kind === "FLAT") {
        amountCents = unitPriceCents;
      } else if (kind === "PER_UNIT") {
        quantity = toNumberOrThrow(evalExpression(quantityExpr as any, evalCtx), `PRICE '${n.id}' quantityRef must be NUMBER`);
        amountCents = quantity * unitPriceCents;
      } else if (kind === "PER_OVERAGE") {
        quantity = toNumberOrThrow(evalExpression(quantityExpr as any, evalCtx), `PRICE '${n.id}' quantityRef must be NUMBER`);
        const base = toNumberOrThrow(evalExpression(overageBaseExpr as any, evalCtx), `PRICE '${n.id}' overageBaseRef must be NUMBER`);
        const over = Math.max(quantity - base, 0);
        amountCents = over * unitPriceCents;
        quantity = over;
      } else {
        // MVP adapter: ignore unsupported kinds (e.g., TIERED) rather than guessing.
        continue;
      }

      const rounded = Math.round(amountCents);
      if (!Number.isFinite(rounded)) throw new Error(`PBV2 PRICE '${n.id}' produced invalid amount`);

      if (rounded !== 0) {
        breakdown.push({
          nodeId: n.id,
          componentIndex: i,
          kind,
          amountCents: rounded,
          quantity,
          unitPriceCents: unitPriceCents ? Math.round(unitPriceCents) : undefined,
        });
      }

      addOnCents += rounded;
    }
  }

  addOnCents = Math.round(addOnCents);

  return { addOnCents, breakdown };
}
