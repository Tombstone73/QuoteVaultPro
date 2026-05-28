import { useEffect, useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { isPbv2QuestionNode, isRenderablePbv2InputType, normalizePbv2Tree } from "@/lib/pbv2Utils";
import { cn } from "@/lib/utils";
import type { LineItemOptionSelectionsV2, OptionNodeV2, OptionTreeV2 } from "@shared/optionTreeV2";
import { validateOptionTreeV2 } from "@shared/optionTreeV2";
import { normalizeSelectionMap, resolveRuntimeVisibility } from "@shared/optionTreeV2Runtime";
import { filterPbv2ChoicesForRuntime, sortPbv2NodeIdsByBuilderOrder } from "@shared/pbv2OrderEntryRuntime";
import { evaluateProductOptionRules, type ProductOptionRule } from "@shared/productOptionRules";
import { extractProductOptionPricingMatrix } from "@shared/productOptionPricingMatrix";

type ProductOptionsPanelV2Props = {
  tree: OptionTreeV2;
  selections: LineItemOptionSelectionsV2;
  onSelectionsChange: (next: LineItemOptionSelectionsV2) => void;
  onUserEdit?: () => void;
  onValidityChange?: (isValid: boolean) => void;
  onRenderStatsChange?: (stats: ProductOptionsPanelV2RenderStats) => void;
  className?: string;
};

export type ProductOptionsPanelV2RenderStats = {
  renderedNodeCount: number;
  renderedControlCount: number;
  renderedControlNodeIds: string[];
};

function isTreeV2Selections(input: any): input is LineItemOptionSelectionsV2 {
  return !!input && typeof input === "object" && input.schemaVersion === 2 && !!input.selected && typeof input.selected === "object";
}

function isQuestionNodeEnabled(node: any): boolean {
  if (!isPbv2QuestionNode(node) || !node.input) return false;
  const status = (typeof node.status === "string" ? node.status : "ENABLED").toUpperCase();
  return status !== "DISABLED" && status !== "DELETED";
}

function getInputType(node: OptionNodeV2): string {
  return String((node.input as any)?.type ?? "");
}

function isRenderableInputType(inputType: string): boolean {
  return isRenderablePbv2InputType(inputType);
}

function getRuntimeChoices(node: OptionNodeV2, visibleChoiceIds?: string[] | null) {
  return filterPbv2ChoicesForRuntime(node.id, node.choices ?? [], visibleChoiceIds);
}

/**
 * Get the selection key for a node (used for storing/retrieving selections).
 * Priority: selectionKey > key > id
 */
function getSelectionKey(node: OptionNodeV2): string {
  return (node.input as any)?.selectionKey || (node as any).key || node.id;
}

function getOptionRules(tree: OptionTreeV2): ProductOptionRule[] {
  const rawTree = tree as any;
  const rules = Array.isArray(rawTree?.rules)
    ? rawTree.rules
    : Array.isArray(rawTree?.optionRules)
      ? rawTree.optionRules
      : [];
  return rules.filter((rule: any): rule is ProductOptionRule => {
    return Boolean(rule && typeof rule === "object" && rule.when && Array.isArray(rule.then));
  });
}

function toSelectionRecord(selected: Record<string, unknown>, prior: LineItemOptionSelectionsV2["selected"]): LineItemOptionSelectionsV2["selected"] {
  const next: LineItemOptionSelectionsV2["selected"] = {};
  for (const [selectionKey, value] of Object.entries(selected)) {
    if (value === undefined) continue;
    const priorEntry = prior?.[selectionKey];
    next[selectionKey] = priorEntry?.note ? { value, note: priorEntry.note } : { value };
  }
  return next;
}

function stableSelectionJson(value: unknown): string {
  if (!value || typeof value !== "object") return JSON.stringify(value);
  const record = value as Record<string, unknown>;
  return JSON.stringify(Object.keys(record).sort().map((key) => [key, record[key]]));
}

function sameStringArray(a: string[] | undefined, b: string[]): boolean {
  return Array.isArray(a) && a.length === b.length && a.every((value, index) => value === b[index]);
}

/**
 * Get node value from selections, supporting both new (selectionKey) and legacy (nodeId) keys.
 * Tries selectionKey first, then key, then id for backward compatibility.
 */
function getNodeValue(selections: LineItemOptionSelectionsV2, node: OptionNodeV2): any {
  const selectionKey = getSelectionKey(node);
  
  // Try selectionKey first (new/correct way)
  if (selections.selected?.[selectionKey]?.value !== undefined) {
    return selections.selected[selectionKey].value;
  }
  
  // Backward compat: try node.key
  const nodeKey = (node as any).key;
  if (nodeKey && selections.selected?.[nodeKey]?.value !== undefined) {
    return selections.selected[nodeKey].value;
  }
  
  // Backward compat: try node.id (legacy)
  if (selections.selected?.[node.id]?.value !== undefined) {
    return selections.selected[node.id].value;
  }
  
  return undefined;
}

function requiredMissing(node: OptionNodeV2, value: any): boolean {
  const required = !!node.input?.required;
  if (!required) return false;

  const t = getInputType(node);
  if (t === "boolean" || t === "checkbox") return value !== true;
  if (t === "number") return value === undefined || value === null || !Number.isFinite(Number(value));
  if (t === "text" || t === "textarea") return String(value ?? "").trim().length === 0;
  if (t === "select" || t === "radio") return String(value ?? "").trim().length === 0;
  if (t === "multiselect") return !Array.isArray(value) || value.length === 0;

  // Unsupported inputs treated as not fulfillable
  return true;
}

function normalizeNumberInput(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : null;
}

/**
 * Sort node IDs respecting parent-group hierarchy then per-node sortOrder.
 * This ensures options from the same group cluster together in the order the
 * Product Builder assigned to their group.
 */
function hierarchicalNodeSort(
  ids: string[],
  nodes: Record<string, OptionNodeV2>,
  parentGroupKey: Map<string, number>,
  tree: OptionTreeV2,
): string[] {
  const builderSorted = sortPbv2NodeIdsByBuilderOrder(tree, ids);
  return builderSorted.slice().sort((a, b) => {
    const ga = parentGroupKey.get(a) ?? 0;
    const gb = parentGroupKey.get(b) ?? 0;
    if (ga !== gb) return ga - gb;
    const aIndex = builderSorted.indexOf(a);
    const bIndex = builderSorted.indexOf(b);
    const sa = typeof (nodes[a] as any)?.ui?.sortOrder === "number" ? (nodes[a] as any).ui.sortOrder : aIndex;
    const sb = typeof (nodes[b] as any)?.ui?.sortOrder === "number" ? (nodes[b] as any).ui.sortOrder : bIndex;
    if (sa !== sb) return sa - sb;
    return aIndex - bIndex;
  });
}

export function ProductOptionsPanelV2({
  tree: rawTree,
  selections,
  onSelectionsChange,
  onUserEdit,
  onValidityChange,
  onRenderStatsChange,
  className,
}: ProductOptionsPanelV2Props) {
  const tree = useMemo(
    () => normalizePbv2Tree(rawTree) ?? { schemaVersion: 2 as const, rootNodeIds: [], nodes: {} },
    [rawTree]
  );
  const graph = useMemo(() => validateOptionTreeV2(tree), [tree]);

  const safeSelections: LineItemOptionSelectionsV2 = useMemo(() => {
    if (isTreeV2Selections(selections)) return selections;
    return { schemaVersion: 2, selected: {} };
  }, [selections]);

  const visibleNodeIds = useMemo(() => {
    try {
      return resolveRuntimeVisibility(tree, safeSelections).visibleNodeIds;
    } catch {
      return [];
    }
  }, [tree, safeSelections]);

  const runtimeVisibility = useMemo(() => {
    try {
      return resolveRuntimeVisibility(tree, safeSelections);
    } catch {
      return null;
    }
  }, [tree, safeSelections]);

  // Pricing-matrix dimensions: their selectionKeys must always be visible so the matrix can resolve.
  const matrixDimensionKeys = useMemo(() => {
    const matrix = extractProductOptionPricingMatrix(tree as any);
    return new Set<string>(matrix?.dimensions ?? []);
  }, [tree]);

  const matrixRequiredNodeIds = useMemo(() => {
    if (matrixDimensionKeys.size === 0) return [] as string[];
    const ids: string[] = [];
    for (const node of Object.values(tree.nodes)) {
      if (!isQuestionNodeEnabled(node)) continue;
      if (matrixDimensionKeys.has(getSelectionKey(node as OptionNodeV2))) {
        ids.push((node as OptionNodeV2).id);
      }
    }
    return ids;
  }, [tree.nodes, matrixDimensionKeys]);

  // Build a parent-group sort key for each node so question nodes from the same group
  // sort together, respecting the group's own ui.sortOrder / displayOrder.
  const nodeToParentGroupSortKey = useMemo(() => {
    const map = new Map<string, number>();
    const nodes = tree.nodes;
    const groupSortById = new Map<string, number>();
    sortPbv2NodeIdsByBuilderOrder(
      tree,
      Object.values(nodes)
        .filter((node) => node?.kind === "group")
        .map((node) => node.id),
    ).forEach((groupId, index) => {
      groupSortById.set(groupId, index);
    });
    // Walk top-level edges array (group → child)
    for (const edge of Array.isArray((tree as any).edges) ? (tree as any).edges : []) {
      if (!edge?.fromNodeId || !edge?.toNodeId) continue;
      const fromNode = nodes[edge.fromNodeId];
      if (!fromNode || fromNode.kind !== "group") continue;
      const groupSort = groupSortById.get(edge.fromNodeId) ?? 0;
      const existing = map.get(edge.toNodeId);
      if (existing === undefined || groupSort < existing) map.set(edge.toNodeId, groupSort);
    }
    // Walk per-node edges.children (older trees store containment here)
    for (const node of Object.values(nodes)) {
      if (!node || node.kind !== "group") continue;
      const groupSort = groupSortById.get(node.id) ?? 0;
      for (const edge of Array.isArray(node.edges?.children) ? node.edges!.children! : []) {
        if (!edge?.toNodeId) continue;
        const existing = map.get(edge.toNodeId);
        if (existing === undefined || groupSort < existing) map.set(edge.toNodeId, groupSort);
      }
    }
    return map;
  }, [tree]);

  // Fallback list used when validation fails or visibility resolves to zero: every enabled question.
  const allEnabledQuestionNodeIds = useMemo(() => {
    return hierarchicalNodeSort(
      Object.values(tree.nodes)
        .filter(isQuestionNodeEnabled)
        .map((n) => (n as OptionNodeV2).id),
      tree.nodes,
      nodeToParentGroupSortKey,
      tree,
    );
  }, [tree, tree.nodes, nodeToParentGroupSortKey]);

  const optionRules = useMemo(() => getOptionRules(tree), [tree]);

  const ruleOptionGroups = useMemo(() => {
    return Object.values(tree.nodes)
      .filter((node) => isPbv2QuestionNode(node) && node.input)
      .map(getSelectionKey);
  }, [tree.nodes]);

  const visibleOptionGroups = useMemo(() => {
    return visibleNodeIds
      .map((nodeId) => tree.nodes[nodeId])
      .filter((node): node is OptionNodeV2 => Boolean(node && isPbv2QuestionNode(node) && node.input))
      .map(getSelectionKey);
  }, [tree.nodes, visibleNodeIds]);

  const initiallyRequiredOptionGroups = useMemo(() => {
    return Object.values(tree.nodes)
      .filter((node) => isPbv2QuestionNode(node) && node.input?.required)
      .map(getSelectionKey);
  }, [tree.nodes]);

  const ruleEvaluation = useMemo(() => {
    const selectionsForRules = optionRules.length > 0 && runtimeVisibility
      ? runtimeVisibility.effectiveSelections
      : normalizeSelectionMap(safeSelections);

    return evaluateProductOptionRules({
      rules: optionRules,
      selections: selectionsForRules,
      optionGroups: ruleOptionGroups,
      visibleOptionGroups,
      requiredOptionGroups: initiallyRequiredOptionGroups,
    });
  }, [initiallyRequiredOptionGroups, optionRules, ruleOptionGroups, runtimeVisibility, safeSelections, visibleOptionGroups]);

  const hiddenOptionGroupSet = useMemo(() => new Set(ruleEvaluation.hiddenOptionGroups), [ruleEvaluation.hiddenOptionGroups]);
  const disabledOptionGroupSet = useMemo(() => new Set(ruleEvaluation.disabledOptionGroups), [ruleEvaluation.disabledOptionGroups]);
  const requiredOptionGroupSet = useMemo(() => new Set(ruleEvaluation.requiredOptionGroups), [ruleEvaluation.requiredOptionGroups]);

  const effectiveVisibleNodeIds = useMemo(() => {
    const filtered = visibleNodeIds.filter((nodeId) => {
      const node = tree.nodes[nodeId];
      if (!node) return false;
      if (hiddenOptionGroupSet.has(node.id) || hiddenOptionGroupSet.has((node as any).key)) return false;
      if (isPbv2QuestionNode(node) && node.input) return !hiddenOptionGroupSet.has(getSelectionKey(node));
      return true;
    });
    // Pricing-matrix dimensions must always render so the matrix can resolve its variables.
    const merged: string[] = filtered.slice();
    for (const id of matrixRequiredNodeIds) {
      if (!merged.includes(id)) merged.push(id);
    }
    // Re-sort by parent-group hierarchy so the rendered order matches Product Builder ordering.
    return hierarchicalNodeSort(merged, tree.nodes, nodeToParentGroupSortKey, tree);
  }, [hiddenOptionGroupSet, matrixRequiredNodeIds, tree, tree.nodes, visibleNodeIds, nodeToParentGroupSortKey]);

  // Final list used by the render pass. When validation fails or visibility resolves to zero
  // but the tree still contains enabled question nodes, fall back to rendering all of them so
  // the user is never left with an empty panel.
  const renderedNodeIds = useMemo(() => {
    if (effectiveVisibleNodeIds.length > 0) return effectiveVisibleNodeIds;
    return allEnabledQuestionNodeIds;
  }, [effectiveVisibleNodeIds, allEnabledQuestionNodeIds]);

  const usingFallbackNodeList = renderedNodeIds !== effectiveVisibleNodeIds;

  const renderStats = useMemo<ProductOptionsPanelV2RenderStats>(() => {
    const renderedControlNodeIds = renderedNodeIds.filter((nodeId) => {
      const node = tree.nodes[nodeId];
      return Boolean(node && isPbv2QuestionNode(node) && node.input && isRenderableInputType(getInputType(node)));
    });
    return {
      renderedNodeCount: renderedNodeIds.length,
      renderedControlCount: renderedControlNodeIds.length,
      renderedControlNodeIds,
    };
  }, [renderedNodeIds, tree.nodes]);

  useEffect(() => {
    onRenderStatsChange?.(renderStats);
  }, [onRenderStatsChange, renderStats]);

  const displaySelections = useMemo<LineItemOptionSelectionsV2>(() => ({
    schemaVersion: 2,
    selected: toSelectionRecord(ruleEvaluation.effectiveSelections, safeSelections.selected ?? {}),
    resolved: {
      ...(safeSelections.resolved ?? {}),
      visibleNodeIds: renderedNodeIds,
    },
  }), [renderedNodeIds, ruleEvaluation.effectiveSelections, safeSelections.resolved, safeSelections.selected]);

  // Prune selections for hidden/missing nodes and store resolved.visibleNodeIds canonically.
  useEffect(() => {
    // Validate selections against whatever set we're actually rendering.
    const validationNodeIds = renderedNodeIds;

    if (!graph.ok) {
      // Best-effort: still report a validity signal based on the fallback list (required-missing only).
      const missingRequiredFallback = validationNodeIds.some((id) => {
        const node = tree.nodes[id];
        if (!node || !isPbv2QuestionNode(node) || !node.input) return false;
        const value = getNodeValue(displaySelections, node);
        return requiredMissing(node, value);
      });
      onValidityChange?.(!missingRequiredFallback);
      return;
    }

    let nextSelected: LineItemOptionSelectionsV2["selected"] = { ...safeSelections.selected };

    let changed = false;

    if (optionRules.length > 0) {
      nextSelected = toSelectionRecord(ruleEvaluation.effectiveSelections, safeSelections.selected ?? {});
      changed = stableSelectionJson(nextSelected) !== stableSelectionJson(safeSelections.selected ?? {});
    } else {
      // Prune selections for hidden/missing nodes.
      // Support both selectionKey and legacy id-based keys.
      for (const key of Object.keys(nextSelected)) {
        let nodeFound = false;

        for (const nodeId of renderedNodeIds) {
          const node = tree.nodes[nodeId];
          if (!node) continue;

          const selectionKey = getSelectionKey(node);
          const nodeKey = (node as any).key;

          if (key === selectionKey || key === nodeKey || key === node.id) {
            nodeFound = true;
            break;
          }
        }

        if (!nodeFound) {
          delete nextSelected[key];
          changed = true;
        }
      }
    }

    const prevResolved = safeSelections.resolved?.visibleNodeIds;
    const sameResolved = sameStringArray(prevResolved, renderedNodeIds);

    const next: LineItemOptionSelectionsV2 = changed || !sameResolved
      ? {
          schemaVersion: 2,
          selected: nextSelected,
          resolved: {
            ...(safeSelections.resolved ?? {}),
            visibleNodeIds: renderedNodeIds,
          },
        }
      : safeSelections;

    if (next !== safeSelections) {
      onSelectionsChange(next);
    }

    const missingRequired = renderedNodeIds.some((id) => {
        const node = tree.nodes[id];
        if (!node || !isPbv2QuestionNode(node) || !node.input) return false;
        const selectionKey = getSelectionKey(node);
        const value = getNodeValue(next, node);
      const matrixRequired = matrixDimensionKeys.has(selectionKey);
      return requiredMissing(node, value)
        || (requiredOptionGroupSet.has(selectionKey) && requiredMissing({ ...node, input: { ...node.input, required: true } }, value))
        || (matrixRequired && requiredMissing({ ...node, input: { ...node.input, required: true } }, value));
    });

    onValidityChange?.(!missingRequired && ruleEvaluation.errors.length === 0);
  }, [
    renderedNodeIds,
    graph.ok,
    onSelectionsChange,
    onValidityChange,
    optionRules.length,
    requiredOptionGroupSet,
    matrixDimensionKeys,
    ruleEvaluation.effectiveSelections,
    ruleEvaluation.errors.length,
    safeSelections,
    tree.nodes,
  ]);

  const nodeErrors = useMemo(() => {
    const out = new Map<string, string>();

    for (const nodeId of renderedNodeIds) {
      const node = tree.nodes[nodeId];
      if (!node || !isPbv2QuestionNode(node) || !node.input) continue;
      const selectionKey = getSelectionKey(node);
      const value = getNodeValue(displaySelections, node);
      const isRequired = requiredOptionGroupSet.has(selectionKey) || matrixDimensionKeys.has(selectionKey);

      if (requiredMissing(node, value) || (isRequired && requiredMissing({ ...node, input: { ...node.input, required: true } }, value))) {
        out.set(nodeId, "Required");
        continue;
      }

      const inputType = getInputType(node);

      if (inputType === "number" && value != null) {
        const n = Number(value);
        const constraints = node.input.constraints?.number;
        if (!Number.isFinite(n)) {
          out.set(nodeId, "Invalid number");
          continue;
        }
        if (constraints?.min != null && n < constraints.min) out.set(nodeId, `Min ${constraints.min}`);
        if (constraints?.max != null && n > constraints.max) out.set(nodeId, `Max ${constraints.max}`);
      }

      if ((inputType === "text" || inputType === "textarea") && typeof value === "string") {
        const constraints = node.input.constraints?.text;
        const len = value.length;
        if (constraints?.minLen != null && len < constraints.minLen) out.set(nodeId, `Min length ${constraints.minLen}`);
        if (constraints?.maxLen != null && len > constraints.maxLen) out.set(nodeId, `Max length ${constraints.maxLen}`);
      }
    }

    for (const error of ruleEvaluation.errors) {
      const nodeId = Object.keys(tree.nodes).find((id) => {
        const node = tree.nodes[id];
        return Boolean(node && isPbv2QuestionNode(node) && node.input && getSelectionKey(node) === error.optionGroup);
      });
      if (nodeId && !out.has(nodeId)) out.set(nodeId, error.message);
    }

    return out;
  }, [displaySelections, matrixDimensionKeys, renderedNodeIds, requiredOptionGroupSet, ruleEvaluation.errors, tree.nodes]);

  const isValid = graph.ok && nodeErrors.size === 0;

  /**
   * Set node value using correct selectionKey.
   * Also cleans up legacy keys (id/key) to prevent duplicates.
   */
  const setNodeValue = (node: OptionNodeV2, value: any) => {
    const selectionKey = getSelectionKey(node);
    if (disabledOptionGroupSet.has(selectionKey) || disabledOptionGroupSet.has(node.id) || disabledOptionGroupSet.has((node as any).key)) return;
    const nextSelected = { ...(safeSelections.selected ?? {}) };

    const shouldClear =
      value === undefined ||
      value === null ||
      (typeof value === "string" && value.trim() === "") ||
      (Array.isArray(value) && value.length === 0) ||
      value === false;

    // Clean up all possible legacy keys
    delete nextSelected[node.id];
    if ((node as any).key) delete nextSelected[(node as any).key];
    delete nextSelected[selectionKey];

    // Store with correct key (unless clearing)
    if (!shouldClear) {
      nextSelected[selectionKey] = { value };
    }

    onUserEdit?.();
    onSelectionsChange({
      schemaVersion: 2,
      selected: nextSelected,
      resolved: {
        ...(safeSelections.resolved ?? {}),
        visibleNodeIds: renderedNodeIds,
      },
    });
  };

  // Extract root node label for section header (dynamic from tree structure)
  const rootNodeId = tree.rootNodeIds?.[0];
  const rootNode = rootNodeId ? tree.nodes[rootNodeId] : null;
  const sectionLabel = rootNode?.kind === "group" ? rootNode.label : null;

  return (
    <div className={cn("space-y-3", className)}>
      {sectionLabel && (
        <div className="flex items-center gap-2">
          <div className="text-sm font-medium">{sectionLabel}</div>
          {!isValid && <Badge variant="destructive" className="text-[11px]">Missing required</Badge>}
        </div>
      )}

      {!graph.ok && renderedNodeIds.length > 0 ? (
        <div className="rounded-md border border-amber-500/40 bg-amber-500/5 p-2 text-xs text-amber-700 dark:text-amber-300">
          <div className="font-medium">Showing options in recovery mode</div>
          <div className="mt-0.5">The option tree has structural issues; controls below are best-effort.</div>
        </div>
      ) : null}

      {ruleEvaluation.messages.filter((message) => message.code === "OPTION_RULE_CLEARED").length > 0 ? (
        <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-2 text-xs text-amber-700 dark:text-amber-300">
          Some selections were cleared because they are no longer valid for the current options.
        </div>
      ) : null}

      {ruleEvaluation.errors.length > 0 ? (
        <div className="rounded-md border border-destructive/30 bg-destructive/5 p-2 text-xs text-destructive">
          Complete required visible options before pricing or saving.
        </div>
      ) : null}

      {usingFallbackNodeList && renderedNodeIds.length > 0 ? (
        <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-2 text-xs text-amber-700 dark:text-amber-300">
          No visibility rules matched; showing all available options.
        </div>
      ) : null}

      {renderedNodeIds.length === 0 ? (
        <div className="text-xs text-muted-foreground">No options.</div>
      ) : (
        <div className="space-y-3">
          {renderedNodeIds.map((nodeId) => {
            const node = tree.nodes[nodeId];
            if (!node) return null;

            const error = nodeErrors.get(nodeId);

            // Structural group nodes remain part of runtime visibility, but the
            // order-entry editor should only render actual operator controls.
            if (node.kind === "group") {
              return null;
            }

            // "computed" nodes are structural (calculated values, not user inputs) - skip rendering
            if (node.kind === "computed") {
              return null;
            }

            // Only "question" nodes with input definitions are user-facing controls
            if (node.kind !== "question" || !node.input) {
              // This should never happen with valid schema, but provide fallback
              return null;
            }

            const selectionKey = getSelectionKey(node);
            const currentValue = getNodeValue(displaySelections, node);
            const inputType = getInputType(node);
            const helpText = node.ui?.helpText;
            const isRuleRequired = requiredOptionGroupSet.has(selectionKey);
            const isDisabled =
              disabledOptionGroupSet.has(selectionKey) ||
              disabledOptionGroupSet.has(node.id) ||
              disabledOptionGroupSet.has((node as any).key);

            const commonHeader = (
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <Label className="text-xs">{node.label}{node.input.required || isRuleRequired ? " *" : ""}</Label>
                  {node.description ? <div className="mt-0.5 text-xs text-muted-foreground">{node.description}</div> : null}
                  {helpText ? <div className="mt-0.5 text-xs text-muted-foreground">{helpText}</div> : null}
                  {isDisabled ? <div className="mt-0.5 text-xs text-muted-foreground">Not available for the current selections.</div> : null}
                </div>
                {node.ui?.badge ? <Badge variant="outline" className="text-[11px] shrink-0">{node.ui.badge}</Badge> : null}
              </div>
            );

            if (inputType === "boolean" || inputType === "checkbox") {
              return (
                <div key={nodeId} className={cn("rounded-md border border-border/50 p-2", isDisabled && "opacity-70")}>
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">{commonHeader}</div>
                    <Switch
                      checked={currentValue === true}
                      onCheckedChange={(checked) => setNodeValue(node, checked)}
                      disabled={isDisabled}
                    />
                  </div>
                  {error ? <div className="mt-1 text-xs text-destructive">{error}</div> : null}
                </div>
              );
            }

            if (inputType === "select") {
              const choices = getRuntimeChoices(node, runtimeVisibility?.visibleChoiceIds ?? null);

              const allowEmpty = node.input.constraints?.select?.allowEmpty === true;
              const emptyLabel = node.input.constraints?.select?.emptyLabel ?? "(None)";

              return (
                <div key={nodeId} className={cn("rounded-md border border-border/50 p-2 space-y-2", isDisabled && "opacity-70")}>
                  {commonHeader}
                  <Select
                    value={String(currentValue ?? "")}
                    onValueChange={(val) => {
                      if (val === "" && allowEmpty) setNodeValue(node, "");
                      else setNodeValue(node, val);
                    }}
                  >
                    <SelectTrigger className="h-9" disabled={isDisabled}>
                      <SelectValue placeholder="Select" />
                    </SelectTrigger>
                    <SelectContent>
                      {allowEmpty ? (
                        <SelectItem value="">{emptyLabel}</SelectItem>
                      ) : null}
                      {choices.map((c) => (
                        <SelectItem key={c.value} value={c.value}>
                          {c.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {error ? <div className="text-xs text-destructive">{error}</div> : null}
                </div>
              );
            }

            if (inputType === "radio") {
              const choices = getRuntimeChoices(node, runtimeVisibility?.visibleChoiceIds ?? null);

              return (
                <div key={nodeId} className={cn("rounded-md border border-border/50 p-2 space-y-2", isDisabled && "opacity-70")}>
                  {commonHeader}
                  <RadioGroup
                    value={typeof currentValue === "string" ? currentValue : ""}
                    onValueChange={(val) => setNodeValue(node, val)}
                    disabled={isDisabled}
                    className="grid gap-2 sm:grid-cols-2"
                  >
                    {choices.map((choice) => {
                      const choiceId = `${nodeId}-${choice.value}`;
                      return (
                        <Label
                          key={choice.value}
                          htmlFor={choiceId}
                          className={cn(
                            "flex min-h-9 cursor-pointer items-center gap-2 rounded-md border border-border/60 px-3 py-2 text-xs font-normal",
                            isDisabled && "cursor-not-allowed"
                          )}
                        >
                          <RadioGroupItem value={choice.value} id={choiceId} disabled={isDisabled} />
                          <span className="min-w-0">
                            <span className="block truncate">{choice.label}</span>
                            {choice.description ? <span className="block text-[11px] text-muted-foreground">{choice.description}</span> : null}
                          </span>
                        </Label>
                      );
                    })}
                  </RadioGroup>
                  {error ? <div className="text-xs text-destructive">{error}</div> : null}
                </div>
              );
            }

            if (inputType === "multiselect") {
              const choices = getRuntimeChoices(node, runtimeVisibility?.visibleChoiceIds ?? null);
              const selectedValues = Array.isArray(currentValue) ? currentValue.map(String) : [];

              return (
                <div key={nodeId} className={cn("rounded-md border border-border/50 p-2 space-y-2", isDisabled && "opacity-70")}>
                  {commonHeader}
                  <div className="grid gap-2 sm:grid-cols-2">
                    {choices.map((choice) => {
                      const choiceId = `${nodeId}-${choice.value}`;
                      const checked = selectedValues.includes(choice.value);
                      return (
                        <Label
                          key={choice.value}
                          htmlFor={choiceId}
                          className={cn(
                            "flex min-h-9 cursor-pointer items-center gap-2 rounded-md border border-border/60 px-3 py-2 text-xs font-normal",
                            isDisabled && "cursor-not-allowed"
                          )}
                        >
                          <Checkbox
                            id={choiceId}
                            checked={checked}
                            disabled={isDisabled}
                            onCheckedChange={(nextChecked) => {
                              const nextValues = nextChecked === true
                                ? Array.from(new Set([...selectedValues, choice.value]))
                                : selectedValues.filter((value) => value !== choice.value);
                              setNodeValue(node, nextValues);
                            }}
                          />
                          <span className="min-w-0">
                            <span className="block truncate">{choice.label}</span>
                            {choice.description ? <span className="block text-[11px] text-muted-foreground">{choice.description}</span> : null}
                          </span>
                        </Label>
                      );
                    })}
                  </div>
                  {error ? <div className="text-xs text-destructive">{error}</div> : null}
                </div>
              );
            }

            if (inputType === "number") {
              const constraints = node.input.constraints?.number;
              const step = constraints?.step ?? 1;
              const min = constraints?.min;
              const max = constraints?.max;

              return (
                <div key={nodeId} className={cn("rounded-md border border-border/50 p-2 space-y-2", isDisabled && "opacity-70")}>
                  {commonHeader}
                  <Input
                    type="number"
                    className="h-9"
                    step={step}
                    min={min}
                    max={max}
                    value={currentValue == null ? "" : String(currentValue)}
                    disabled={isDisabled}
                    onChange={(e) => {
                      const n = normalizeNumberInput(e.target.value);
                      if (n === null) setNodeValue(node, "");
                      else setNodeValue(node, constraints?.integerOnly ? Math.trunc(n) : n);
                    }}
                  />
                  {error ? <div className="text-xs text-destructive">{error}</div> : null}
                </div>
              );
            }

            if (inputType === "text") {
              return (
                <div key={nodeId} className={cn("rounded-md border border-border/50 p-2 space-y-2", isDisabled && "opacity-70")}>
                  {commonHeader}
                  <Input
                    className="h-9"
                    value={typeof currentValue === "string" ? currentValue : String(currentValue ?? "")}
                    disabled={isDisabled}
                    onChange={(e) => setNodeValue(node, e.target.value)}
                  />
                  {error ? <div className="text-xs text-destructive">{error}</div> : null}
                </div>
              );
            }

            if (inputType === "textarea") {
              return (
                <div key={nodeId} className={cn("rounded-md border border-border/50 p-2 space-y-2", isDisabled && "opacity-70")}>
                  {commonHeader}
                  <Textarea
                    rows={3}
                    value={typeof currentValue === "string" ? currentValue : String(currentValue ?? "")}
                    disabled={isDisabled}
                    onChange={(e) => setNodeValue(node, e.target.value)}
                  />
                  {error ? <div className="text-xs text-destructive">{error}</div> : null}
                </div>
              );
            }

            return (
              <div key={nodeId} className="rounded-md border border-border/50 bg-muted/10 p-2 space-y-1">
                <div className="flex items-center gap-2">
                  <div className="text-sm font-medium">{node.label}</div>
                  <Badge variant="outline" className="text-[11px]">Unsupported: {inputType}</Badge>
                </div>
                {node.description ? <div className="text-xs text-muted-foreground">{node.description}</div> : null}
                {node.input.required ? <div className="text-xs text-muted-foreground">Required field is not supported yet.</div> : null}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
