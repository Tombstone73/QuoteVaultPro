import { useEffect, useMemo, useRef, useState } from "react";
import { AlertCircleIcon, AlertTriangle, CheckCircle, DollarSign } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import type { Finding } from "@shared/pbv2/findings";
import { pbv2TreeToEditorModel, type EditorModel } from "@/lib/pbv2/pbv2ViewModel";

export type PricingPreviewState = {
  width: number;
  height: number;
  quantity: number;
  selectedOptionValues: Record<string, string | string[] | boolean>;
  unit: "in";
};

type PricingPreviewResponse = {
  unitPrice: number;
  totalPrice: number;
  breakdown?: {
    basePrice: number;
    optionsPrice: number;
    total: number;
  };
  derived?: {
    sqft?: number;
    linearFeet?: number;
  };
  errors?: string[];
};

type PreviewOption = {
  optionId: string;
  optionName: string;
  inputType: string;
  choices: Array<{ value: string; label: string }>;
};

type PreviewGroup = {
  groupId: string;
  groupName: string;
  isMultiSelect: boolean;
  options: PreviewOption[];
};

interface PricingValidationPanelProps {
  treeJson: unknown | null;
  findings: Finding[];
}

function toNodesRecord(treeJson: any): Record<string, any> {
  if (!treeJson || typeof treeJson !== "object") return {};
  const nodesRaw = (treeJson as any).nodes;
  if (!nodesRaw) return {};
  if (!Array.isArray(nodesRaw)) return nodesRaw as Record<string, any>;
  return nodesRaw.reduce((acc: Record<string, any>, node: any) => {
    if (node?.id) acc[node.id] = node;
    return acc;
  }, {});
}

function buildPreviewGroups(treeJson: unknown | null): PreviewGroup[] {
  if (!treeJson || typeof treeJson !== "object") return [];

  let model: EditorModel | null = null;
  try {
    model = pbv2TreeToEditorModel(treeJson as any);
  } catch {
    return [];
  }
  if (!model) return [];

  const nodes = toNodesRecord(treeJson);

  return model.groups
    .map((group) => {
      const options: PreviewOption[] = group.optionIds
        .map((optionId) => {
          const optionMeta = model?.options?.[optionId];
          const node = nodes?.[optionId] ?? null;
          const choicesRaw = Array.isArray(node?.choices) ? node.choices : [];
          const mappedChoices: Array<{ value: string; label: string }> = choicesRaw.map((choice: any) => ({
              value: String(choice?.value ?? ""),
              label: String(choice?.label ?? choice?.value ?? ""),
            }));
          const choices = mappedChoices.filter((choice) => choice.value.length > 0);

          const inputType = String(node?.input?.type ?? "select");
          if (choices.length === 0) return null;

          return {
            optionId,
            optionName: optionMeta?.name || String(node?.label || "Option"),
            inputType,
            choices,
          };
        })
        .filter((option): option is PreviewOption => Boolean(option));

      return {
        groupId: group.id,
        groupName: group.name,
        isMultiSelect: group.isMultiSelect,
        options,
      };
    })
    .filter((group) => group.options.length > 0);
}

export function PricingValidationPanel({ treeJson, findings }: PricingValidationPanelProps) {
  const currencyFormatter = useMemo(
    () =>
      new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }),
    [],
  );
  const [previewState, setPreviewState] = useState<PricingPreviewState>({
    width: 24,
    height: 36,
    quantity: 1,
    selectedOptionValues: {},
    unit: "in",
  });
  const [result, setResult] = useState<PricingPreviewResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestIdRef = useRef(0);

  const errors = findings.filter((f) => f.severity === "ERROR");
  const warnings = findings.filter((f) => f.severity === "WARNING");

  const previewGroups = useMemo(() => buildPreviewGroups(treeJson), [treeJson]);

  const selectionPayload = useMemo(() => {
    const selected: Record<string, { value: string | string[] | boolean }> = {};
    for (const [optionId, value] of Object.entries(previewState.selectedOptionValues)) {
      if (Array.isArray(value) && value.length === 0) continue;
      if (typeof value === "string" && value.length === 0) continue;
      selected[optionId] = { value };
    }
    return selected;
  }, [previewState.selectedOptionValues]);

  const requestSignature = useMemo(
    () =>
      JSON.stringify({
        treeJson,
        width: previewState.width,
        height: previewState.height,
        quantity: previewState.quantity,
        optionSelectionsJson: selectionPayload,
      }),
    [treeJson, previewState.width, previewState.height, previewState.quantity, selectionPayload],
  );

  const inputErrors = useMemo(() => {
    const next: Partial<Record<"width" | "height" | "quantity", string>> = {};
    if (!Number.isFinite(previewState.width) || previewState.width <= 0) {
      next.width = "Width must be greater than 0.";
    }
    if (!Number.isFinite(previewState.height) || previewState.height <= 0) {
      next.height = "Height must be greater than 0.";
    }
    if (!Number.isFinite(previewState.quantity) || previewState.quantity < 1 || !Number.isInteger(previewState.quantity)) {
      next.quantity = "Quantity must be an integer of 1 or more.";
    }
    return next;
  }, [previewState.width, previewState.height, previewState.quantity]);

  const hasInputErrors = Boolean(inputErrors.width || inputErrors.height || inputErrors.quantity);
  const apiErrors = useMemo(() => {
    return Array.isArray(result?.errors) ? result.errors.filter((entry) => typeof entry === "string" && entry.trim().length > 0) : [];
  }, [result]);
  const hasApiErrors = apiErrors.length > 0;

  useEffect(() => {
    if (!treeJson) {
      setLoading(false);
      setResult(null);
      setError("No PBV2 tree loaded.");
      return;
    }

    if (hasInputErrors) {
      setLoading(false);
      setResult(null);
      setError(null);
      return;
    }

    const controller = new AbortController();
    const requestId = ++requestIdRef.current;
    const timeout = window.setTimeout(async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch("/api/pbv2/pricing-preview", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          signal: controller.signal,
          body: JSON.stringify({
            treeJson,
            width: previewState.width,
            height: previewState.height,
            quantity: previewState.quantity,
            optionSelectionsJson: selectionPayload,
          }),
        });

        const json = await res.json().catch(() => ({}));
        if (requestId !== requestIdRef.current) return;
        if (!res.ok) {
          setResult(null);
          setError(typeof json?.message === "string" ? json.message : "Pricing evaluation failed.");
          return;
        }

        const data = (json?.data ?? null) as PricingPreviewResponse | null;
        setResult(data);
      } catch (e: any) {
        if (controller.signal.aborted) return;
        if (requestId !== requestIdRef.current) return;
        setResult(null);
        setError(typeof e?.message === "string" ? e.message : "Pricing evaluation failed.");
      } finally {
        if (!controller.signal.aborted && requestId === requestIdRef.current) setLoading(false);
      }
    }, 250);

    return () => {
      controller.abort();
      window.clearTimeout(timeout);
    };
  }, [hasInputErrors, requestSignature, treeJson, previewState.width, previewState.height, previewState.quantity, selectionPayload]);

  return (
    <aside className="h-full w-full min-w-0 bg-card flex flex-col overflow-hidden">
      <ScrollArea className="flex-1 min-w-0">
        <div className="p-4 space-y-4 min-w-0">
          <div className="space-y-3 min-w-0">
            <div className="flex items-center gap-2">
              <DollarSign className="h-4 w-4 text-blue-400" />
              <h2 className="text-sm font-semibold text-slate-200 uppercase tracking-wide">Pricing Preview Sandbox</h2>
            </div>

            <div className="rounded-md border border-slate-700 bg-slate-800/50 p-3 space-y-3 min-w-0">
              <div className="flex items-center justify-between">
                <div className="text-xs text-slate-400 uppercase tracking-wide">Inputs</div>
                <div className="text-[11px] text-slate-500">Units: {previewState.unit === "in" ? "inches" : previewState.unit}</div>
              </div>

              <div className="grid grid-cols-3 gap-2 min-w-0">
                <div className="min-w-0">
                  <Label className="text-xs text-slate-400">Width ({previewState.unit})</Label>
                  <Input
                    type="number"
                    min={0}
                    step="any"
                    value={previewState.width}
                    onChange={(e) => setPreviewState((prev) => ({ ...prev, width: Number(e.target.value) }))}
                    className="bg-slate-950/60 border-slate-700/60 h-8"
                  />
                  {inputErrors.width ? <div className="mt-1 text-[11px] text-red-300">{inputErrors.width}</div> : null}
                </div>
                <div className="min-w-0">
                  <Label className="text-xs text-slate-400">Height ({previewState.unit})</Label>
                  <Input
                    type="number"
                    min={0}
                    step="any"
                    value={previewState.height}
                    onChange={(e) => setPreviewState((prev) => ({ ...prev, height: Number(e.target.value) }))}
                    className="bg-slate-950/60 border-slate-700/60 h-8"
                  />
                  {inputErrors.height ? <div className="mt-1 text-[11px] text-red-300">{inputErrors.height}</div> : null}
                </div>
                <div className="min-w-0">
                  <Label className="text-xs text-slate-400">Quantity</Label>
                  <Input
                    type="number"
                    min={1}
                    step={1}
                    value={previewState.quantity}
                    onChange={(e) => setPreviewState((prev) => ({ ...prev, quantity: Number(e.target.value) }))}
                    className="bg-slate-950/60 border-slate-700/60 h-8"
                  />
                  {inputErrors.quantity ? <div className="mt-1 text-[11px] text-red-300">{inputErrors.quantity}</div> : null}
                </div>
              </div>
            </div>

            <div className="rounded-md border border-slate-700 bg-slate-800/50 p-3 space-y-2 min-w-0">
              <div className="text-xs text-slate-400 uppercase tracking-wide">Output</div>
              {loading ? (
                <div className="text-sm text-slate-300">Calculating…</div>
              ) : hasInputErrors ? (
                <div className="text-sm text-red-300">Fix input errors to run preview.</div>
              ) : error ? (
                <div className="text-sm text-red-300">{error}</div>
              ) : hasApiErrors ? (
                <div className="space-y-1 rounded border border-red-500/40 bg-red-500/10 p-2 text-sm text-red-200">
                  <div className="font-semibold">Pricing evaluation errors</div>
                  {apiErrors.map((entry, idx) => (
                    <div key={`${entry}-${idx}`}>{entry}</div>
                  ))}
                </div>
              ) : result ? (
                <div className="space-y-1 text-sm text-slate-200">
                  <div className="flex items-center justify-between"><span>Unit price</span><span className="font-mono">{currencyFormatter.format(result.unitPrice)}</span></div>
                  <div className="flex items-center justify-between"><span>Total price</span><span className="font-mono">{currencyFormatter.format(result.totalPrice)}</span></div>
                  {typeof result.derived?.sqft === "number" || typeof result.derived?.linearFeet === "number" ? (
                    <div className="pt-2 mt-2 border-t border-slate-700 text-xs text-slate-400 space-y-1">
                      <div className="uppercase tracking-wide">Derived</div>
                      <div className="flex items-center justify-between"><span>sqft</span><span className="font-mono">{typeof result.derived?.sqft === "number" ? result.derived.sqft.toFixed(2) : "—"}</span></div>
                      <div className="flex items-center justify-between"><span>linear_feet</span><span className="font-mono">{typeof result.derived?.linearFeet === "number" ? result.derived.linearFeet.toFixed(2) : "—"}</span></div>
                    </div>
                  ) : null}
                  {result.breakdown ? (
                    <div className="pt-2 mt-2 border-t border-slate-700 text-xs text-slate-400 space-y-1">
                      <div className="flex items-center justify-between"><span>Base</span><span className="font-mono">{currencyFormatter.format(result.breakdown.basePrice)}</span></div>
                      <div className="flex items-center justify-between"><span>Options</span><span className="font-mono">{currencyFormatter.format(result.breakdown.optionsPrice)}</span></div>
                    </div>
                  ) : null}
                </div>
              ) : (
                <div className="text-sm text-slate-400">Enter dimensions and quantity to preview pricing.</div>
              )}
            </div>
          </div>

          <div className="space-y-3 min-w-0">
            <div className="text-xs font-semibold text-slate-300 uppercase tracking-wide">Options</div>
            {previewGroups.length === 0 ? (
              <div className="text-sm text-slate-400">No selectable options found in this draft tree.</div>
            ) : (
              previewGroups.map((group) => (
                <div key={group.groupId} className="rounded-md border border-slate-700 bg-slate-800/30 p-3 space-y-2 min-w-0">
                  <div className="flex items-center justify-between gap-2 min-w-0">
                    <div className="text-sm font-medium text-slate-200 truncate">{group.groupName}</div>
                    <Badge variant="outline" className="text-[10px] border-slate-600 text-slate-300">
                      {group.isMultiSelect ? "Multi" : "Single"}
                    </Badge>
                  </div>

                  {group.options.map((option) => {
                    const selectedValue = previewState.selectedOptionValues[option.optionId];
                    const isMulti = option.inputType === "multiselect" || group.isMultiSelect;

                    if (isMulti) {
                      const selectedArray = Array.isArray(selectedValue) ? selectedValue : [];
                      return (
                        <div key={option.optionId} className="space-y-1.5 min-w-0">
                          <div className="text-xs text-slate-400">{option.optionName}</div>
                          <div className="space-y-1">
                            {option.choices.map((choice) => {
                              const checked = selectedArray.includes(choice.value);
                              return (
                                <label key={choice.value} className="flex items-center gap-2 text-xs text-slate-200 min-w-0">
                                  <Checkbox
                                    checked={checked}
                                    onCheckedChange={(next) => {
                                      setPreviewState((prev) => {
                                        const current = Array.isArray(prev.selectedOptionValues[option.optionId])
                                          ? ([...(prev.selectedOptionValues[option.optionId] as string[])] as string[])
                                          : [];
                                        const updated = next
                                          ? Array.from(new Set([...current, choice.value]))
                                          : current.filter((v) => v !== choice.value);
                                        const nextSelected = { ...prev.selectedOptionValues };
                                        if (updated.length === 0) delete nextSelected[option.optionId];
                                        else nextSelected[option.optionId] = updated;
                                        return { ...prev, selectedOptionValues: nextSelected };
                                      });
                                    }}
                                  />
                                  <span className="truncate">{choice.label}</span>
                                </label>
                              );
                            })}
                          </div>
                        </div>
                      );
                    }

                    return (
                      <div key={option.optionId} className="space-y-1 min-w-0">
                        <div className="text-xs text-slate-400">{option.optionName}</div>
                        <Select
                          value={typeof selectedValue === "string" ? selectedValue : "__none__"}
                          onValueChange={(value) => {
                            setPreviewState((prev) => {
                              const nextSelected = { ...prev.selectedOptionValues };
                              if (value === "__none__") delete nextSelected[option.optionId];
                              else nextSelected[option.optionId] = value;
                              return { ...prev, selectedOptionValues: nextSelected };
                            });
                          }}
                        >
                          <SelectTrigger className="h-8 bg-slate-950/60 border-slate-700/60 text-xs min-w-0">
                            <SelectValue placeholder="Select option" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="__none__">— None —</SelectItem>
                            {option.choices.map((choice) => (
                              <SelectItem key={choice.value} value={choice.value}>
                                {choice.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    );
                  })}
                </div>
              ))
            )}
          </div>

          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-400" />
              <h3 className="text-sm font-semibold text-slate-200 uppercase tracking-wide">Validation</h3>
            </div>

            {findings.length === 0 ? (
              <div className="flex items-start gap-3 p-3 bg-emerald-500/10 border border-emerald-500/30 rounded-lg">
                <CheckCircle className="h-5 w-5 text-emerald-400 mt-0.5 flex-shrink-0" />
                <div className="text-emerald-300 text-sm">No validation findings.</div>
              </div>
            ) : (
              <div className="space-y-2">
                {errors.map((finding, i) => (
                  <div key={`err-${i}`} className="p-3 bg-red-500/10 border border-red-500/40 rounded text-sm text-red-200">
                    <div className="font-semibold">{finding.code}</div>
                    <div>{finding.message}</div>
                  </div>
                ))}
                {warnings.map((finding, i) => (
                  <div key={`warn-${i}`} className="p-3 bg-amber-500/10 border border-amber-500/40 rounded text-sm text-amber-200">
                    <div className="font-semibold">{finding.code}</div>
                    <div>{finding.message}</div>
                  </div>
                ))}
                {errors.length === 0 && warnings.length === 0 ? (
                  <div className="p-3 bg-blue-500/10 border border-blue-500/40 rounded text-sm text-blue-200 flex items-center gap-2">
                    <AlertCircleIcon className="h-4 w-4" />
                    Findings present, but no errors/warnings.
                  </div>
                ) : null}
              </div>
            )}
          </div>
        </div>
      </ScrollArea>
    </aside>
  );
}
