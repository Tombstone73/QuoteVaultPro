import type { ConditionExpr, LineItemOptionSelectionsV2, OptionNodeV2, OptionTreeV2 } from "./optionTreeV2";

function getSelectedValue(selected: Record<string, { value?: any } | undefined>, ref: string): any {
  const hit = selected?.[ref];
  return hit ? hit.value : undefined;
}

export function evaluateCondition(expr: ConditionExpr, selected: Record<string, { value?: any } | undefined>): boolean {
  switch (expr.op) {
    case "equals": {
      const v = getSelectedValue(selected, expr.ref);
      if (v === undefined) return false;
      return v === expr.value;
    }
    case "notEquals": {
      const v = getSelectedValue(selected, expr.ref);
      if (v === undefined) return false;
      return v !== expr.value;
    }
    case "truthy": {
      const v = getSelectedValue(selected, expr.ref);
      if (v === undefined) return false;
      return Boolean(v);
    }
    case "contains": {
      const v = getSelectedValue(selected, expr.ref);
      if (v === undefined) return false;
      if (Array.isArray(v)) return v.includes(expr.value);
      // If a non-array value is present, do not treat it as a container
      return false;
    }
    case "and":
      return expr.args.every((a) => evaluateCondition(a, selected));
    case "or":
      return expr.args.some((a) => evaluateCondition(a, selected));
    case "not":
      return !evaluateCondition(expr.arg, selected);
    default: {
      const _exhaustive: never = expr;
      return _exhaustive;
    }
  }
}

function nodeSortKey(node: OptionNodeV2 | undefined, nodeId: string): [number, string] {
  const sortOrderRaw = node?.ui?.sortOrder;
  const sortOrder = typeof sortOrderRaw === "number" && Number.isFinite(sortOrderRaw) ? sortOrderRaw : 0;
  return [sortOrder, nodeId];
}

export function resolveVisibleNodes(tree: OptionTreeV2, selections: LineItemOptionSelectionsV2): string[] {
  const visible: string[] = [];
  const visited = new Set<string>();

  const selected = selections?.selected ?? {};

  const isVisible = (node: OptionNodeV2): boolean => {
    const cond = node.visibility?.condition;
    if (!cond) return true;
    return evaluateCondition(cond, selected);
  };

  const walk = (nodeId: string) => {
    if (visited.has(nodeId)) return;
    visited.add(nodeId);

    const node = tree.nodes[nodeId];
    if (!node) return;
    if (!isVisible(node)) return;

    visible.push(nodeId);

    const children = node.edges?.children ?? [];
    const eligible = children.filter((edge) => {
      if (!edge?.toNodeId) return false;
      if (!edge.when) return true;
      return evaluateCondition(edge.when, selected);
    });

    eligible
      .slice()
      .sort((a, b) => {
        const na = tree.nodes[a.toNodeId];
        const nb = tree.nodes[b.toNodeId];
        const ka = nodeSortKey(na, a.toNodeId);
        const kb = nodeSortKey(nb, b.toNodeId);
        if (ka[0] !== kb[0]) return ka[0] - kb[0];
        return ka[1].localeCompare(kb[1]);
      })
      .forEach((edge) => {
        walk(edge.toNodeId);
      });
  };

  const roots = Array.isArray(tree.rootNodeIds) ? tree.rootNodeIds : [];
  for (let i = 0; i < roots.length; i++) {
    const rootId = roots[i];
    if (typeof rootId !== "string" || !rootId.trim()) continue;
    walk(rootId);
  }

  return visible;
}

export function validateOptionTreeV2(tree: OptionTreeV2): { ok: true } | { ok: false; errors: string[] } {
  const errors: string[] = [];

  if (!tree || typeof tree !== "object") {
    return { ok: false, errors: ["Tree must be an object"] };
  }

  if ((tree as any).schemaVersion !== 2) {
    errors.push("schemaVersion must be 2");
  }

  if (!Array.isArray(tree.rootNodeIds) || tree.rootNodeIds.length === 0) {
    errors.push("rootNodeIds must be a non-empty array");
  }

  if (!tree.nodes || typeof tree.nodes !== "object") {
    errors.push("nodes must be an object map");
  } else {
    const nodeKeys = Object.keys(tree.nodes);
    for (let i = 0; i < nodeKeys.length; i++) {
      const key = nodeKeys[i];
      const node = (tree.nodes as any)[key];
      if (!node || typeof node !== "object") {
        errors.push(`nodes['${key}'] must be an object`);
        continue;
      }
      const nodeId = (node as any).id;
      if (nodeId !== key) {
        errors.push(`Node id mismatch: nodes['${key}'].id must equal '${key}'`);
      }
    }

    // Root existence checks
    const roots = Array.isArray(tree.rootNodeIds) ? tree.rootNodeIds : [];
    for (let i = 0; i < roots.length; i++) {
      const rootId = roots[i];
      if (typeof rootId !== "string" || !rootId.trim()) {
        errors.push("rootNodeIds must contain non-empty strings");
        continue;
      }
      if (!tree.nodes[rootId]) {
        errors.push(`rootNodeId '${rootId}' does not exist in nodes`);
      }
    }

    // Edge reference checks
    for (let i = 0; i < nodeKeys.length; i++) {
      const fromId = nodeKeys[i];
      const node = (tree.nodes as any)[fromId];
      const children = (node as any)?.edges?.children;
      if (!children) continue;
      if (!Array.isArray(children)) {
        errors.push(`nodes['${fromId}'].edges.children must be an array if present`);
        continue;
      }
      for (let idx = 0; idx < children.length; idx++) {
        const edge = children[idx];
        const toNodeId = (edge as any)?.toNodeId;
        if (typeof toNodeId !== "string" || !toNodeId.trim()) {
          errors.push(`nodes['${fromId}'].edges.children[${idx}].toNodeId must be a string`);
          continue;
        }
        if (!tree.nodes[toNodeId]) {
          errors.push(`Edge reference missing: '${fromId}' -> '${toNodeId}'`);
        }
      }
    }

    // Cycle detection in directed graph reachable from roots
    const visited = new Set<string>();
    const inStack = new Set<string>();

    const dfs = (nodeId: string) => {
      if (inStack.has(nodeId)) {
        errors.push(`Cycle detected at '${nodeId}'`);
        return;
      }
      if (visited.has(nodeId)) return;
      visited.add(nodeId);
      inStack.add(nodeId);

      const node = tree.nodes[nodeId];
      const children = node?.edges?.children ?? [];
      for (let i = 0; i < children.length; i++) {
        const edge = children[i];
        const to = (edge as any)?.toNodeId;
        if (!to || !tree.nodes[to]) continue;
        dfs(to);
      }

      inStack.delete(nodeId);
    };

    for (let i = 0; i < roots.length; i++) {
      const rootId = roots[i];
      if (typeof rootId !== "string" || !rootId.trim()) continue;
      if (!tree.nodes[rootId]) continue;
      dfs(rootId);
    }
  }

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true };
}
