import type { ConditionExpr, LineItemOptionSelectionsV2, OptionNodeV2, OptionTreeV2 } from "./optionTreeV2";
import { validateOptionTreeV2 as validateOptionTreeV2Minimal } from "./optionTreeV2";

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
  return validateOptionTreeV2Minimal(tree);
}
