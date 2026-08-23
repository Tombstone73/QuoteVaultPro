import type {
  ConditionExpr,
  LineItemOptionSelectionsV2,
  OptionRuntimeSelectionWarning,
  OptionTreeV2,
  VisibilityConfig,
  VisibilityRule,
} from "./optionTreeV2";
import { validateOptionTreeV2Graph } from "./optionTreeV2GraphValidation";

type SelectionRecord = Record<string, unknown>;

export type ResolvedRuntimeVisibility = {
  effectiveSelections: SelectionRecord;
  visibleNodeIds: string[];
  visibleGroupIds: string[];
  visibleChoiceIds: string[];
  hiddenSelectionWarnings: OptionRuntimeSelectionWarning[];
};

function normalizeTree(tree: OptionTreeV2 | Record<string, unknown>): OptionTreeV2 {
  const rawTree = (tree ?? {}) as any;
  const nodesRaw = rawTree.nodes;
  const nodes = Array.isArray(nodesRaw)
    ? Object.fromEntries(
        nodesRaw
          .filter((node) => node && typeof node === "object" && isNonEmptyString((node as any).id))
          .map((node) => [String((node as any).id), node])
      )
    : ((nodesRaw && typeof nodesRaw === "object" ? nodesRaw : {}) as Record<string, any>);

  return {
    ...rawTree,
    nodes,
  } as OptionTreeV2;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function normalizeSelectionValue(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  if (Object.prototype.hasOwnProperty.call(value, "value")) {
    return (value as { value?: unknown }).value;
  }
  return value;
}

export function normalizeSelectionMap(
  selections: LineItemOptionSelectionsV2 | Record<string, unknown> | undefined
): SelectionRecord {
  if (!selections || typeof selections !== "object") return {};

  const selectedRaw =
    "selected" in selections && selections.selected && typeof selections.selected === "object"
      ? (selections.selected as Record<string, unknown>)
      : (selections as Record<string, unknown>);

  const normalized: SelectionRecord = {};
  for (const [selectionKey, rawValue] of Object.entries(selectedRaw)) {
    const value = normalizeSelectionValue(rawValue);
    if (value !== undefined) {
      normalized[selectionKey] = value;
    }
  }

  return normalized;
}

function getSelectionValue(selected: SelectionRecord, ref: string): unknown {
  return Object.prototype.hasOwnProperty.call(selected, ref) ? selected[ref] : undefined;
}

export function evaluateCondition(expr: ConditionExpr, selected: SelectionRecord): boolean {
  switch (expr.op) {
    case "equals": {
      const v = getSelectionValue(selected, expr.ref);
      if (v === undefined) return false;
      return v === expr.value;
    }
    case "notEquals": {
      const v = getSelectionValue(selected, expr.ref);
      if (v === undefined) return false;
      return v !== expr.value;
    }
    case "truthy": {
      const v = getSelectionValue(selected, expr.ref);
      if (v === undefined) return false;
      return Boolean(v);
    }
    case "contains": {
      const v = getSelectionValue(selected, expr.ref);
      if (v === undefined) return false;
      return Array.isArray(v) ? v.includes(expr.value) : false;
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

export function evaluateVisibilityRule(rule: VisibilityRule, selected: SelectionRecord): boolean {
  switch (rule.type) {
    case "equals": {
      const value = getSelectionValue(selected, rule.selectionKey);
      if (value === undefined) return false;
      return value === rule.value;
    }
    case "notEquals": {
      const value = getSelectionValue(selected, rule.selectionKey);
      if (value === undefined) return false;
      return value !== rule.value;
    }
    case "in": {
      const value = getSelectionValue(selected, rule.selectionKey);
      if (value === undefined) return false;
      return Array.isArray(rule.values) ? rule.values.includes(value) : false;
    }
    case "truthy": {
      const value = getSelectionValue(selected, rule.selectionKey);
      if (value === undefined) return false;
      return Boolean(value);
    }
    case "and":
      return rule.rules.every((child) => evaluateVisibilityRule(child, selected));
    case "or":
      return rule.rules.some((child) => evaluateVisibilityRule(child, selected));
    case "not":
      return !evaluateVisibilityRule(rule.rule, selected);
    default: {
      const _exhaustive: never = rule;
      return _exhaustive;
    }
  }
}

export function evaluateVisibilityConfig(config: VisibilityConfig | undefined, selected: SelectionRecord): boolean {
  if (!config) return true;
  if (config.condition && !evaluateCondition(config.condition, selected)) return false;
  if (Array.isArray(config.rules) && config.rules.length > 0) {
    return config.rules.every((rule) => evaluateVisibilityRule(rule, selected));
  }
  return true;
}

function nodeSortKey(node: any, nodeId: string): [number, string] {
  // ui.sortOrder is canonical; displayOrder is the legacy field stamped by the
  // Product Builder's group-reorder operation on older trees.
  const sortOrderRaw = node?.ui?.sortOrder ?? node?.displayOrder;
  const sortOrder = typeof sortOrderRaw === "number" && Number.isFinite(sortOrderRaw) ? sortOrderRaw : 0;
  return [sortOrder, nodeId];
}

function collectStructuralChildren(treeInput: OptionTreeV2): Record<string, string[]> {
  const tree = normalizeTree(treeInput);
  const childrenByGroupId: Record<string, string[]> = {};

  if (Array.isArray(tree.edges)) {
    for (const edge of tree.edges) {
      const fromNodeId = edge?.fromNodeId;
      const toNodeId = edge?.toNodeId;
      if (!isNonEmptyString(fromNodeId) || !isNonEmptyString(toNodeId)) continue;
      const fromNode = tree.nodes[fromNodeId];
      if (!fromNode || fromNode.kind !== "group") continue;
      childrenByGroupId[fromNodeId] ??= [];
      if (!childrenByGroupId[fromNodeId].includes(toNodeId)) {
        childrenByGroupId[fromNodeId].push(toNodeId);
      }
    }
  }

  for (const node of Object.values(tree.nodes)) {
    if (!node || node.kind !== "group") continue;
    const groupId = node.id;
    const children = Array.isArray(node.edges?.children) ? node.edges.children : [];
    for (const edge of children) {
      if (!isNonEmptyString(edge?.toNodeId)) continue;
      childrenByGroupId[groupId] ??= [];
      if (!childrenByGroupId[groupId].includes(edge.toNodeId)) {
        childrenByGroupId[groupId].push(edge.toNodeId);
      }
    }
  }

  return childrenByGroupId;
}

function buildGroupMembership(tree: OptionTreeV2): {
  childrenByGroupId: Record<string, string[]>;
  parentGroupsByNodeId: Record<string, string[]>;
} {
  const childrenByGroupId = collectStructuralChildren(tree);
  const parentGroupsByNodeId: Record<string, string[]> = {};

  for (const [groupId, childIds] of Object.entries(childrenByGroupId)) {
    const sortedChildIds = childIds
      .slice()
      .sort((a, b) => {
        const ka = nodeSortKey(tree.nodes[a], a);
        const kb = nodeSortKey(tree.nodes[b], b);
        if (ka[0] !== kb[0]) return ka[0] - kb[0];
        return ka[1].localeCompare(kb[1]);
      });
    childrenByGroupId[groupId] = sortedChildIds;

    for (const childId of sortedChildIds) {
      parentGroupsByNodeId[childId] ??= [];
      if (!parentGroupsByNodeId[childId].includes(groupId)) {
        parentGroupsByNodeId[childId].push(groupId);
      }
    }
  }

  return { childrenByGroupId, parentGroupsByNodeId };
}

function isNodeEnabled(node: any): boolean {
  const status = typeof node?.status === "string" ? node.status.toUpperCase() : "ENABLED";
  return status !== "DISABLED" && status !== "DELETED";
}

function isChoiceVisible(choice: any, selected: SelectionRecord): boolean {
  const rules = Array.isArray(choice?.visibilityRules) ? (choice.visibilityRules as VisibilityRule[]) : [];
  if (rules.length === 0) return true;
  return rules.every((rule) => evaluateVisibilityRule(rule, selected));
}

function visibleNodeIdSort(tree: OptionTreeV2, nodeIds: string[]): string[] {
  return nodeIds
    .slice()
    .sort((a, b) => {
      const ka = nodeSortKey(tree.nodes[a], a);
      const kb = nodeSortKey(tree.nodes[b], b);
      if (ka[0] !== kb[0]) return ka[0] - kb[0];
      return ka[1].localeCompare(kb[1]);
    });
}

function valueMatchesVisibleChoice(inputType: string | undefined, value: unknown, visibleChoiceValues: Set<string>): boolean {
  if (value === undefined || value === null || value === "") return false;
  if (inputType === "multiselect") {
    if (!Array.isArray(value)) return false;
    return value.every((entry) => visibleChoiceValues.has(String(entry)));
  }
  return visibleChoiceValues.has(String(value));
}

function selectionSignature(selected: SelectionRecord): string {
  return JSON.stringify(
    Object.keys(selected)
      .sort()
      .map((selectionKey) => [selectionKey, selected[selectionKey]])
  );
}

export function resolveRuntimeVisibility(
  treeInput: OptionTreeV2 | Record<string, unknown>,
  selections: LineItemOptionSelectionsV2 | Record<string, unknown> | undefined
): ResolvedRuntimeVisibility {
  const tree = normalizeTree(treeInput);
  const explicitSelections = normalizeSelectionMap(selections);
  const { childrenByGroupId, parentGroupsByNodeId } = buildGroupMembership(tree);
  const allNodeIds = Object.keys(tree.nodes);
  const groupNodeIds = allNodeIds.filter((nodeId) => tree.nodes[nodeId]?.kind === "group");

  let effectiveSelections: SelectionRecord = { ...explicitSelections };
  let prevSignature = "";
  let prevVisibleSignature = "";
  const maxPasses = Math.max(allNodeIds.length * 2, 8);

  for (let pass = 0; pass < maxPasses; pass++) {
    let visibleGroupIds = visibleNodeIdSort(
      tree,
      groupNodeIds.filter((groupId) => {
        const groupNode = tree.nodes[groupId];
        return isNodeEnabled(groupNode) && evaluateVisibilityConfig(groupNode.visibility, effectiveSelections);
      })
    );
    let groupsChanged = true;
    while (groupsChanged) {
      const prior = JSON.stringify(visibleGroupIds);
      const visibleGroupSetForParents = new Set<string>(visibleGroupIds);
      visibleGroupIds = visibleGroupIds.filter((groupId) => {
        const parentGroups = parentGroupsByNodeId[groupId] ?? [];
        if (parentGroups.length === 0) return true;
        return parentGroups.some((parentGroupId) => visibleGroupSetForParents.has(parentGroupId));
      });
      groupsChanged = JSON.stringify(visibleGroupIds) !== prior;
    }
    const visibleGroupSet = new Set<string>(visibleGroupIds);

    const visibleNodeIds = visibleNodeIdSort(
      tree,
      allNodeIds.filter((nodeId) => {
        const node = tree.nodes[nodeId];
        if (!node || !isNodeEnabled(node)) return false;
        if (node.kind === "group") return visibleGroupSet.has(nodeId);

        const parentGroups = parentGroupsByNodeId[nodeId] ?? [];
        if (parentGroups.length > 0 && !parentGroups.some((groupId) => visibleGroupSet.has(groupId))) {
          return false;
        }

        return evaluateVisibilityConfig(node.visibility, effectiveSelections);
      })
    );
    const visibleNodeSet = new Set<string>(visibleNodeIds);

    const nextSelections: SelectionRecord = {};
    const visibleChoiceIds: string[] = [];
    const hiddenSelectionWarnings: OptionRuntimeSelectionWarning[] = [];

    for (const nodeId of visibleNodeIds) {
      const node = tree.nodes[nodeId];
      if (!node || node.kind === "group") continue;

      const selectionKey = isNonEmptyString(node.input?.selectionKey)
        ? String(node.input?.selectionKey)
        : isNonEmptyString(node.key)
          ? String(node.key)
          : node.id;

      const inputType = node.input?.type;
      const explicitValue = explicitSelections[selectionKey];
      const defaultValue = node.input?.defaultValue;

      if (Array.isArray(node.choices) && node.choices.length > 0) {
        const visibleChoices = node.choices.filter((choice) => isChoiceVisible(choice, effectiveSelections));
        const visibleChoiceValues = new Set<string>();
        for (const choice of visibleChoices) {
          const choiceValue = String(choice.value ?? "");
          const choiceId = `${node.id}:${choiceValue}`;
          visibleChoiceValues.add(choiceValue);
          visibleChoiceIds.push(choiceId);
        }

        if (explicitValue !== undefined) {
          if (valueMatchesVisibleChoice(inputType, explicitValue, visibleChoiceValues)) {
            nextSelections[selectionKey] = explicitValue;
          } else {
            hiddenSelectionWarnings.push({
              selectionKey,
              choiceValue: Array.isArray(explicitValue) ? explicitValue.map((entry) => String(entry)).join(",") : String(explicitValue),
              reason: "hidden_choice",
            });
          }
        } else if (defaultValue !== undefined && valueMatchesVisibleChoice(inputType, defaultValue, visibleChoiceValues)) {
          nextSelections[selectionKey] = defaultValue;
        }

        continue;
      }

      if (explicitValue !== undefined) {
        nextSelections[selectionKey] = explicitValue;
      } else if (defaultValue !== undefined) {
        nextSelections[selectionKey] = defaultValue;
      }
    }

    for (const [selectionKey, value] of Object.entries(explicitSelections)) {
      const visibleNode = visibleNodeIds.find((nodeId) => {
        const node = tree.nodes[nodeId];
        if (!node || node.kind === "group") return false;
        const nodeSelectionKey = isNonEmptyString(node.input?.selectionKey)
          ? String(node.input?.selectionKey)
          : isNonEmptyString(node.key)
            ? String(node.key)
            : node.id;
        return nodeSelectionKey === selectionKey;
      });
      if (!visibleNode) {
        hiddenSelectionWarnings.push({
          selectionKey,
          choiceValue: value === undefined || value === null ? undefined : String(value),
          reason: "hidden_node",
        });
      }
    }

    const nextSignature = selectionSignature(nextSelections);
    const nextVisibleSignature = JSON.stringify({
      visibleNodeIds,
      visibleGroupIds,
      visibleChoiceIds: visibleChoiceIds.slice().sort(),
    });

    if (nextSignature === prevSignature && nextVisibleSignature === prevVisibleSignature) {
      return {
        effectiveSelections: nextSelections,
        visibleNodeIds,
        visibleGroupIds,
        visibleChoiceIds: visibleChoiceIds.slice().sort(),
        hiddenSelectionWarnings: hiddenSelectionWarnings
          .slice()
          .sort((a, b) => a.selectionKey.localeCompare(b.selectionKey) || (a.choiceValue ?? "").localeCompare(b.choiceValue ?? "")),
      };
    }

    effectiveSelections = nextSelections;
    prevSignature = nextSignature;
    prevVisibleSignature = nextVisibleSignature;
  }

  return {
    effectiveSelections,
    visibleNodeIds: visibleNodeIdSort(tree, allNodeIds.filter((nodeId) => tree.nodes[nodeId] && tree.nodes[nodeId].kind !== "group")),
    visibleGroupIds: [],
    visibleChoiceIds: [],
    hiddenSelectionWarnings: [],
  };
}

export function resolveVisibleNodes(tree: OptionTreeV2, selections: LineItemOptionSelectionsV2): string[] {
  return resolveRuntimeVisibility(tree, selections).visibleNodeIds;
}

export function validateOptionTreeV2(tree: OptionTreeV2): { ok: true } | { ok: false; errors: string[] } {
  return validateOptionTreeV2Graph(tree);
}
