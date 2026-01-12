import { useEffect, useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import type { LineItemOptionSelectionsV2, OptionNodeV2, OptionTreeV2 } from "@shared/optionTreeV2";
import { validateOptionTreeV2 } from "@shared/optionTreeV2";
import { resolveVisibleNodes } from "@shared/optionTreeV2Runtime";

type ProductOptionsPanelV2Props = {
  tree: OptionTreeV2;
  selections: LineItemOptionSelectionsV2;
  onSelectionsChange: (next: LineItemOptionSelectionsV2) => void;
  onValidityChange?: (isValid: boolean) => void;
  className?: string;
};

function isTreeV2Selections(input: any): input is LineItemOptionSelectionsV2 {
  return !!input && typeof input === "object" && input.schemaVersion === 2 && !!input.selected && typeof input.selected === "object";
}

function getNodeValue(selections: LineItemOptionSelectionsV2, nodeId: string): any {
  return selections.selected?.[nodeId]?.value;
}

function requiredMissing(node: OptionNodeV2, value: any): boolean {
  const required = !!node.input?.required;
  if (!required) return false;

  const t = node.input?.type;
  if (t === "boolean") return value !== true;
  if (t === "number") return value === undefined || value === null || !Number.isFinite(Number(value));
  if (t === "text" || t === "textarea") return String(value ?? "").trim().length === 0;
  if (t === "select") return String(value ?? "").trim().length === 0;

  // Unsupported inputs treated as not fulfillable
  return true;
}

function normalizeNumberInput(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : null;
}

export function ProductOptionsPanelV2({
  tree,
  selections,
  onSelectionsChange,
  onValidityChange,
  className,
}: ProductOptionsPanelV2Props) {
  const graph = useMemo(() => validateOptionTreeV2(tree), [tree]);

  const safeSelections: LineItemOptionSelectionsV2 = useMemo(() => {
    if (isTreeV2Selections(selections)) return selections;
    return { schemaVersion: 2, selected: {} };
  }, [selections]);

  const visibleNodeIds = useMemo(() => {
    if (!graph.ok) return [];
    try {
      return resolveVisibleNodes(tree, safeSelections);
    } catch {
      return [];
    }
  }, [graph.ok, tree, safeSelections]);

  // Prune selections for hidden/missing nodes and store resolved.visibleNodeIds canonically.
  useEffect(() => {
    if (!graph.ok) {
      onValidityChange?.(false);
      return;
    }

    const visibleSet = new Set(visibleNodeIds);
    const nextSelected: LineItemOptionSelectionsV2["selected"] = { ...safeSelections.selected };

    let changed = false;

    for (const nodeId of Object.keys(nextSelected)) {
      if (!tree.nodes[nodeId] || !visibleSet.has(nodeId)) {
        delete nextSelected[nodeId];
        changed = true;
      }
    }

    const prevResolved = safeSelections.resolved?.visibleNodeIds;
    const sameResolved =
      Array.isArray(prevResolved) &&
      prevResolved.length === visibleNodeIds.length &&
      prevResolved.every((v, i) => v === visibleNodeIds[i]);

    const next: LineItemOptionSelectionsV2 = changed || !sameResolved
      ? {
          schemaVersion: 2,
          selected: nextSelected,
          resolved: {
            ...(safeSelections.resolved ?? {}),
            visibleNodeIds,
          },
        }
      : safeSelections;

    if (next !== safeSelections) {
      onSelectionsChange(next);
    }

    const missingRequired = visibleNodeIds.some((id) => {
      const node = tree.nodes[id];
      if (!node || node.kind !== "question" || !node.input) return false;
      const value = getNodeValue(next, id);
      return requiredMissing(node, value);
    });

    onValidityChange?.(!missingRequired);
  }, [graph.ok, onSelectionsChange, onValidityChange, safeSelections, tree.nodes, visibleNodeIds, tree]);

  const nodeErrors = useMemo(() => {
    if (!graph.ok) return new Map<string, string>();
    const out = new Map<string, string>();

    for (const nodeId of visibleNodeIds) {
      const node = tree.nodes[nodeId];
      if (!node || node.kind !== "question" || !node.input) continue;
      const value = getNodeValue(safeSelections, nodeId);

      if (requiredMissing(node, value)) {
        out.set(nodeId, "Required");
        continue;
      }

      if (node.input.type === "number" && value != null) {
        const n = Number(value);
        const constraints = node.input.constraints?.number;
        if (!Number.isFinite(n)) {
          out.set(nodeId, "Invalid number");
          continue;
        }
        if (constraints?.min != null && n < constraints.min) out.set(nodeId, `Min ${constraints.min}`);
        if (constraints?.max != null && n > constraints.max) out.set(nodeId, `Max ${constraints.max}`);
      }

      if ((node.input.type === "text" || node.input.type === "textarea") && typeof value === "string") {
        const constraints = node.input.constraints?.text;
        const len = value.length;
        if (constraints?.minLen != null && len < constraints.minLen) out.set(nodeId, `Min length ${constraints.minLen}`);
        if (constraints?.maxLen != null && len > constraints.maxLen) out.set(nodeId, `Max length ${constraints.maxLen}`);
      }
    }

    return out;
  }, [graph.ok, safeSelections, tree.nodes, visibleNodeIds, tree]);

  const isValid = graph.ok && nodeErrors.size === 0;

  const setNodeValue = (nodeId: string, value: any) => {
    const nextSelected = { ...(safeSelections.selected ?? {}) };

    const shouldClear =
      value === undefined ||
      value === null ||
      (typeof value === "string" && value.trim() === "") ||
      value === false;

    if (shouldClear) {
      delete nextSelected[nodeId];
    } else {
      nextSelected[nodeId] = { ...(nextSelected[nodeId] ?? {}), value };
    }

    onSelectionsChange({
      schemaVersion: 2,
      selected: nextSelected,
      resolved: safeSelections.resolved,
    });
  };

  if (!graph.ok) {
    return (
      <div className={cn("space-y-2", className)}>
        <div className="flex items-center gap-2">
          <div className="text-sm font-medium">Options</div>
          <Badge variant="secondary" className="text-[11px]">Tree v2</Badge>
          <Badge variant="destructive" className="text-[11px]">Invalid tree</Badge>
        </div>
        <div className="rounded-md border border-destructive/30 bg-destructive/5 p-2 text-xs text-destructive">
          <div className="font-medium mb-1">optionTreeJson errors</div>
          <ul className="list-disc pl-5 space-y-0.5">
            {graph.errors.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        </div>
      </div>
    );
  }

  return (
    <div className={cn("space-y-3", className)}>
      <div className="flex items-center gap-2">
        <div className="text-sm font-medium">Options</div>
        <Badge variant="secondary" className="text-[11px]">Tree v2</Badge>
        {!isValid && <Badge variant="destructive" className="text-[11px]">Missing required</Badge>}
      </div>

      {visibleNodeIds.length === 0 ? (
        <div className="text-xs text-muted-foreground">No options.</div>
      ) : (
        <div className="space-y-3">
          {visibleNodeIds.map((nodeId) => {
            const node = tree.nodes[nodeId];
            if (!node) return null;

            const error = nodeErrors.get(nodeId);

            if (node.kind === "group") {
              return (
                <div key={nodeId} className="rounded-md border border-border/50 bg-muted/20 p-2">
                  <div className="flex items-center gap-2">
                    <div className="text-sm font-medium">{node.label}</div>
                    {node.ui?.badge ? <Badge variant="outline" className="text-[11px]">{node.ui.badge}</Badge> : null}
                  </div>
                  {node.description ? <div className="mt-1 text-xs text-muted-foreground">{node.description}</div> : null}
                </div>
              );
            }

            if (node.kind !== "question" || !node.input) {
              return (
                <div key={nodeId} className="rounded-md border border-border/50 bg-muted/10 p-2">
                  <div className="text-sm font-medium">{node.label}</div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    Unsupported node kind.
                  </div>
                </div>
              );
            }

            const currentValue = getNodeValue(safeSelections, nodeId);
            const helpText = node.ui?.helpText;

            const commonHeader = (
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <Label className="text-xs">{node.label}{node.input.required ? " *" : ""}</Label>
                  {node.description ? <div className="mt-0.5 text-xs text-muted-foreground">{node.description}</div> : null}
                  {helpText ? <div className="mt-0.5 text-xs text-muted-foreground">{helpText}</div> : null}
                </div>
                {node.ui?.badge ? <Badge variant="outline" className="text-[11px] shrink-0">{node.ui.badge}</Badge> : null}
              </div>
            );

            if (node.input.type === "boolean") {
              return (
                <div key={nodeId} className="rounded-md border border-border/50 p-2">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">{commonHeader}</div>
                    <Switch
                      checked={currentValue === true}
                      onCheckedChange={(checked) => setNodeValue(nodeId, checked)}
                    />
                  </div>
                  {error ? <div className="mt-1 text-xs text-destructive">{error}</div> : null}
                </div>
              );
            }

            if (node.input.type === "select") {
              const choices = (node.choices ?? []).slice().sort((a, b) => {
                const ao = typeof a.sortOrder === "number" ? a.sortOrder : 0;
                const bo = typeof b.sortOrder === "number" ? b.sortOrder : 0;
                if (ao !== bo) return ao - bo;
                return a.value.localeCompare(b.value);
              });

              const allowEmpty = node.input.constraints?.select?.allowEmpty === true;
              const emptyLabel = node.input.constraints?.select?.emptyLabel ?? "(None)";

              return (
                <div key={nodeId} className="rounded-md border border-border/50 p-2 space-y-2">
                  {commonHeader}
                  <Select
                    value={String(currentValue ?? "")}
                    onValueChange={(val) => {
                      if (val === "" && allowEmpty) setNodeValue(nodeId, "");
                      else setNodeValue(nodeId, val);
                    }}
                  >
                    <SelectTrigger className="h-9">
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

            if (node.input.type === "number") {
              const constraints = node.input.constraints?.number;
              const step = constraints?.step ?? 1;
              const min = constraints?.min;
              const max = constraints?.max;

              return (
                <div key={nodeId} className="rounded-md border border-border/50 p-2 space-y-2">
                  {commonHeader}
                  <Input
                    type="number"
                    className="h-9"
                    step={step}
                    min={min}
                    max={max}
                    value={currentValue == null ? "" : String(currentValue)}
                    onChange={(e) => {
                      const n = normalizeNumberInput(e.target.value);
                      if (n === null) setNodeValue(nodeId, "");
                      else setNodeValue(nodeId, constraints?.integerOnly ? Math.trunc(n) : n);
                    }}
                  />
                  {error ? <div className="text-xs text-destructive">{error}</div> : null}
                </div>
              );
            }

            if (node.input.type === "text") {
              return (
                <div key={nodeId} className="rounded-md border border-border/50 p-2 space-y-2">
                  {commonHeader}
                  <Input
                    className="h-9"
                    value={typeof currentValue === "string" ? currentValue : String(currentValue ?? "")}
                    onChange={(e) => setNodeValue(nodeId, e.target.value)}
                  />
                  {error ? <div className="text-xs text-destructive">{error}</div> : null}
                </div>
              );
            }

            if (node.input.type === "textarea") {
              return (
                <div key={nodeId} className="rounded-md border border-border/50 p-2 space-y-2">
                  {commonHeader}
                  <Textarea
                    rows={3}
                    value={typeof currentValue === "string" ? currentValue : String(currentValue ?? "")}
                    onChange={(e) => setNodeValue(nodeId, e.target.value)}
                  />
                  {error ? <div className="text-xs text-destructive">{error}</div> : null}
                </div>
              );
            }

            return (
              <div key={nodeId} className="rounded-md border border-border/50 bg-muted/10 p-2 space-y-1">
                <div className="flex items-center gap-2">
                  <div className="text-sm font-medium">{node.label}</div>
                  <Badge variant="outline" className="text-[11px]">Unsupported: {node.input.type}</Badge>
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
