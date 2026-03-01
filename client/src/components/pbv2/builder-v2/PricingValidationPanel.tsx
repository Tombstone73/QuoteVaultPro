import { useEffect, useMemo, useRef, useState } from "react";
import { AlertCircleIcon, AlertTriangle, CheckCircle, DollarSign } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
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
  formulaUsed?: string;
  breakdown?: {
    basePrice: number;
    optionsPrice: number;
    total: number;
  };
  derived?: {
    sqft?: number;
    totalSqft?: number;
    linearFeet?: number;
  };
  errors?: string[];
  debug?: {
    formulaRaw: string;
    formulaResolved?: string;
    variables: Record<string, number | string | boolean | null>;
    resultValue?: number;
    appliedAs?: "unitPrice" | "totalPrice" | "unknown";
    steps?: Array<{ label: string; value: number | string }>;
    errors?: Array<{ code: string; message: string; detail?: any }>;
    usedFallbackFormula?: boolean;
    fallbackFormula?: string;
    preCeilSqftTotal?: number | null;
    postCeilSqftTotal?: number | null;
    baseRateUsed?: number | null;
    inputs?: { widthIn: number; heightIn: number; quantity: number };
    derived?: { sqft: number; totalSqft: number; linearFeet: number };
    pricing?: { basePrice: number; optionsPrice: number; unitPrice: number; totalPrice: number };
  };
};

type PricingPreviewApiResponse = {
  success?: boolean;
  data?: PricingPreviewResponse;
  debug?: PricingPreviewResponse["debug"];
  message?: string;
  errors?: Array<{ code?: string; message?: string; detail?: any }>;
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
  pricingV2Override?: unknown;
  pricingFormulaOverride?: string | null;
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
          const choices = mappedChoices.filter((choice: { value: string; label: string }) => choice.value.length > 0);

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

export function PricingValidationPanel({ treeJson, pricingV2Override, pricingFormulaOverride, findings }: PricingValidationPanelProps) {
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
  const [formulaDebug, setFormulaDebug] = useState<PricingPreviewResponse["debug"] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [responseErrors, setResponseErrors] = useState<string[]>([]);
  const requestIdRef = useRef(0);

  const errors = findings.filter((f) => f.severity === "ERROR");
  const warnings = findings.filter((f) => f.severity === "WARNING");

  const treeForPreview = useMemo(() => {
    if (!treeJson || typeof treeJson !== "object") return treeJson;
    if (!pricingV2Override || typeof pricingV2Override !== "object") return treeJson;

    const tree = treeJson as Record<string, any>;
    const meta = tree.meta && typeof tree.meta === "object" ? tree.meta : {};

    return {
      ...tree,
      meta: {
        ...meta,
        pricingV2: pricingV2Override,
      },
    };
  }, [treeJson, pricingV2Override]);

  const previewGroups = useMemo(() => buildPreviewGroups(treeForPreview), [treeForPreview]);

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
        treeJson: treeForPreview,
        width: previewState.width,
        height: previewState.height,
        quantity: previewState.quantity,
        pricingFormulaOverride,
        optionSelectionsJson: selectionPayload,
      }),
    [treeForPreview, previewState.width, previewState.height, previewState.quantity, pricingFormulaOverride, selectionPayload],
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
    const resultErrors = Array.isArray(result?.errors) ? result.errors.filter((entry) => typeof entry === "string" && entry.trim().length > 0) : [];
    return [...responseErrors, ...resultErrors];
  }, [responseErrors, result]);
  const hasApiErrors = apiErrors.length > 0;
  const pricingConfigHint = useMemo(() => {
    const haystack = `${error ?? ""} ${apiErrors.join(" ")}`.toLowerCase();
    if (
      haystack.includes("base pricing configuration required") ||
      haystack.includes("meta.pricingv2") ||
      haystack.includes("base pricing")
    ) {
      return "Set Base Pricing Model (rate per sq ft or per piece) to enable preview.";
    }
    return null;
  }, [error, apiErrors]);
  const calculatedSqftPerItem = useMemo(() => {
    if (!Number.isFinite(previewState.width) || !Number.isFinite(previewState.height) || previewState.width <= 0 || previewState.height <= 0) {
      return undefined;
    }
    return (previewState.width * previewState.height) / 144;
  }, [previewState.width, previewState.height]);
  const displaySqftPerItem = typeof result?.derived?.sqft === "number" ? result.derived.sqft : calculatedSqftPerItem;
  const displayTotalSqft = typeof result?.derived?.totalSqft === "number"
    ? result.derived.totalSqft
    : (typeof displaySqftPerItem === "number" ? displaySqftPerItem * previewState.quantity : undefined);
  const billedSqftPre = typeof formulaDebug?.preCeilSqftTotal === "number" ? formulaDebug.preCeilSqftTotal : null;
  const billedSqftPost = typeof formulaDebug?.postCeilSqftTotal === "number" ? formulaDebug.postCeilSqftTotal : null;
  const baseRateUsed = typeof formulaDebug?.baseRateUsed === "number" ? formulaDebug.baseRateUsed : null;
  const billedLineTotal = billedSqftPost != null && baseRateUsed != null
    ? billedSqftPost * baseRateUsed
    : null;
  const formulaDebugErrors = useMemo(() => {
    const errorsFromDebug = Array.isArray(formulaDebug?.errors) ? formulaDebug.errors : [];
    const normalized = errorsFromDebug
      .map((entry) => ({
        code: String(entry?.code ?? "PBV2_FORMULA_ERROR"),
        message: String(entry?.message ?? "Formula evaluation error"),
      }))
      .filter((entry) => entry.message.trim().length > 0);

    if (typeof formulaDebug?.resultValue === "number" && !Number.isFinite(formulaDebug.resultValue)) {
      normalized.push({
        code: "PBV2_FORMULA_NON_FINITE",
        message: "Formula result is NaN or Infinity.",
      });
    }

    return normalized;
  }, [formulaDebug]);
  const hasFormulaDebugErrors = formulaDebugErrors.length > 0;
  const sortedDebugVariables = useMemo(() => {
    const source = formulaDebug?.variables ?? {};
    const entries = Object.entries(source);
    const priority = ["w", "h", "q", "sqft", "p"];
    const score = (key: string) => {
      const idx = priority.indexOf(key);
      return idx === -1 ? 100 : idx;
    };
    return entries.sort((a, b) => {
      const diff = score(a[0]) - score(b[0]);
      if (diff !== 0) return diff;
      return a[0].localeCompare(b[0]);
    });
  }, [formulaDebug]);

  useEffect(() => {
    if (!treeForPreview || typeof treeForPreview !== "object") {
      setLoading(false);
      setResult(null);
      setFormulaDebug(null);
      setResponseErrors([]);
      setError("No PBV2 tree loaded.");
      return;
    }

    if (hasInputErrors) {
      setLoading(false);
      setResult(null);
      setFormulaDebug(null);
      setResponseErrors([]);
      setError(null);
      return;
    }

    const controller = new AbortController();
    const requestId = ++requestIdRef.current;
    const timeout = window.setTimeout(async () => {
      setLoading(true);
      setError(null);
      setFormulaDebug(null);
      setResponseErrors([]);
      try {
        const res = await fetch("/api/pbv2/pricing-preview", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          signal: controller.signal,
          body: JSON.stringify({
            treeJson: treeForPreview,
            width: previewState.width,
            height: previewState.height,
            quantity: previewState.quantity,
            pricingFormulaOverride,
            debug: true,
            optionSelectionsJson: selectionPayload,
          }),
        });

        const json = (await res.json().catch(() => ({}))) as PricingPreviewApiResponse;
        if (requestId !== requestIdRef.current) return;
        if (!res.ok || json?.success === false) {
          setResult(null);
          setFormulaDebug((json?.debug ?? null) as PricingPreviewResponse["debug"] | null);
          const structuredErrors = Array.isArray(json?.errors)
            ? json.errors
                .map((entry: any) => (typeof entry?.message === "string" ? entry.message : null))
                .filter((entry: string | null): entry is string => Boolean(entry))
            : [];
          setResponseErrors(structuredErrors);
          setError(typeof json?.message === "string" ? json.message : "Pricing evaluation failed.");
          return;
        }

        const data = (json?.data ?? null) as PricingPreviewResponse | null;
        setResponseErrors([]);
        setFormulaDebug(data?.debug ?? null);
        setResult(data);
      } catch (e: any) {
        if (controller.signal.aborted) return;
        if (requestId !== requestIdRef.current) return;
        setResult(null);
        setFormulaDebug(null);
        setResponseErrors([]);
        setError(typeof e?.message === "string" ? e.message : "Pricing evaluation failed.");
      } finally {
        if (!controller.signal.aborted && requestId === requestIdRef.current) setLoading(false);
      }
    }, 250);

    return () => {
      controller.abort();
      window.clearTimeout(timeout);
    };
  }, [hasInputErrors, requestSignature, treeForPreview, previewState.width, previewState.height, previewState.quantity, pricingFormulaOverride, selectionPayload]);

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
                <div className="space-y-1 rounded border border-red-500/40 bg-red-500/10 p-2 text-sm text-red-200">
                  <div className="font-semibold">{error}</div>
                  {pricingConfigHint ? <div>{pricingConfigHint}</div> : null}
                  {hasFormulaDebugErrors ? (
                    <div className="space-y-1 pt-1">
                      {formulaDebugErrors.map((entry, idx) => (
                        <div key={`formula-debug-${idx}`}>{entry.code}: {entry.message}</div>
                      ))}
                    </div>
                  ) : null}
                  {apiErrors.map((entry, idx) => (
                    <div key={`api-${idx}`}>{entry}</div>
                  ))}
                </div>
              ) : hasApiErrors ? (
                <div className="space-y-1 rounded border border-red-500/40 bg-red-500/10 p-2 text-sm text-red-200">
                  <div className="font-semibold">Pricing evaluation errors</div>
                  {apiErrors.map((entry, idx) => (
                    <div key={`${entry}-${idx}`}>{entry}</div>
                  ))}
                </div>
              ) : result ? (
                <div className="space-y-1 text-sm text-slate-200">
                  <div className="rounded border border-slate-700/70 bg-slate-900/40 px-2 py-1.5 mb-2">
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-slate-300">Raw total sqft</span>
                      <span className="font-mono text-base text-slate-100">{typeof displayTotalSqft === "number" ? displayTotalSqft.toFixed(2) : "—"}</span>
                    </div>
                    <div className="text-[11px] text-slate-400 mt-0.5">
                      width × height only · ({previewState.width} × {previewState.height}) ÷ 144 = {typeof displaySqftPerItem === "number" ? displaySqftPerItem.toFixed(2) : "—"} sqft
                    </div>
                  </div>

                  {billedSqftPre != null && billedSqftPost != null ? (
                    <div className="rounded border border-slate-700/70 bg-slate-900/40 px-2 py-1.5 mb-2">
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-slate-300">Billed sqft</span>
                        <span className="font-mono text-base text-slate-100">{billedSqftPost.toFixed(0)}</span>
                      </div>
                      <div className="text-[11px] text-slate-400 mt-0.5">Pre-ceil: {billedSqftPre.toFixed(4)}</div>
                      <div className="text-[11px] text-slate-400">Post-ceil: {billedSqftPost.toFixed(0)}</div>
                    </div>
                  ) : null}

                  {hasFormulaDebugErrors ? (
                    <div className="space-y-1 rounded border border-red-500/40 bg-red-500/10 p-2 text-sm text-red-200">
                      <div className="font-semibold">Formula Debug Errors</div>
                      {formulaDebugErrors.map((entry, idx) => (
                        <div key={`formula-debug-inline-${idx}`}>{entry.code}: {entry.message}</div>
                      ))}
                    </div>
                  ) : (
                    <>
                      <div className="flex items-center justify-between"><span>Unit price</span><span className="font-mono">{currencyFormatter.format(result.unitPrice)}</span></div>
                      <div className="flex items-center justify-between"><span>Total price</span><span className="font-mono">{currencyFormatter.format(result.totalPrice)}</span></div>
                    </>
                  )}
                  {result.formulaUsed ? (
                    <div className="flex items-center gap-2 text-[11px] text-slate-400">
                      <span>Formula: <span className="font-mono">{result.formulaUsed}</span></span>
                      {formulaDebug?.usedFallbackFormula ? (
                        <Badge variant="outline" className="text-[10px] border-amber-500/40 text-amber-300">
                          Using fallback formula
                        </Badge>
                      ) : null}
                    </div>
                  ) : null}
                  {billedSqftPost != null && baseRateUsed != null && billedLineTotal != null ? (
                    <div className="text-[11px] text-slate-400">
                      {billedSqftPost.toFixed(0)} × {currencyFormatter.format(baseRateUsed)} = {currencyFormatter.format(billedLineTotal)}
                    </div>
                  ) : null}
                  {typeof result.derived?.sqft === "number" || typeof result.derived?.linearFeet === "number" ? (
                    <div className="pt-2 mt-2 border-t border-slate-700 text-xs text-slate-400 space-y-1">
                      <div className="uppercase tracking-wide">Derived</div>
                      <div className="flex items-center justify-between"><span>sqft</span><span className="font-mono">{typeof result.derived?.sqft === "number" ? result.derived.sqft.toFixed(2) : "—"}</span></div>
                      <div className="flex items-center justify-between"><span>total_sqft</span><span className="font-mono">{typeof result.derived?.totalSqft === "number" ? result.derived.totalSqft.toFixed(2) : "—"}</span></div>
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

              {formulaDebug ? (
                <Accordion type="single" collapsible className="mt-2 border-t border-slate-700/80 pt-2">
                  <AccordionItem value="formula-debug" className="border-b-0">
                    <AccordionTrigger className="py-1 text-xs text-slate-300 hover:no-underline">Formula Debug</AccordionTrigger>
                    <AccordionContent className="space-y-2 text-xs text-slate-300">
                      <div><span className="text-slate-400">Formula used:</span> <span className="font-mono">{formulaDebug.formulaRaw || "—"}</span></div>
                      {formulaDebug.formulaResolved ? (
                        <div><span className="text-slate-400">Formula resolved:</span> <span className="font-mono">{formulaDebug.formulaResolved}</span></div>
                      ) : null}
                      <div><span className="text-slate-400">Result value:</span> <span className="font-mono">{typeof formulaDebug.resultValue === "number" ? String(formulaDebug.resultValue) : "—"}</span></div>
                      <div><span className="text-slate-400">Applied as:</span> <span className="font-mono">{formulaDebug.appliedAs ?? "unknown"}</span></div>
                      <div><span className="text-slate-400">Pre-ceil sqft:</span> <span className="font-mono">{typeof formulaDebug.preCeilSqftTotal === "number" ? formulaDebug.preCeilSqftTotal.toFixed(4) : "—"}</span></div>
                      <div><span className="text-slate-400">Post-ceil sqft:</span> <span className="font-mono">{typeof formulaDebug.postCeilSqftTotal === "number" ? formulaDebug.postCeilSqftTotal.toFixed(0) : "—"}</span></div>
                      <div><span className="text-slate-400">Base rate used (p):</span> <span className="font-mono">{typeof formulaDebug.baseRateUsed === "number" ? String(formulaDebug.baseRateUsed) : "—"}</span></div>
                      {formulaDebug.usedFallbackFormula ? (
                        <div>
                          <span className="text-slate-400">Fallback:</span>{" "}
                          <span className="font-mono">{formulaDebug.fallbackFormula || "sqft * p * q"}</span>
                        </div>
                      ) : null}

                      <div className="space-y-1">
                        <div className="text-slate-400">Variables</div>
                        <div className="rounded border border-slate-700/70 bg-slate-900/40 p-2 max-h-32 overflow-y-auto">
                          {sortedDebugVariables.length === 0 ? (
                            <div className="text-slate-500">No variables</div>
                          ) : (
                            sortedDebugVariables.map(([key, value]) => (
                              <div key={key} className="flex items-center justify-between gap-2">
                                <span className="font-mono text-slate-400">{key}</span>
                                <span className="font-mono text-slate-200">{value == null ? "null" : String(value)}</span>
                              </div>
                            ))
                          )}
                        </div>
                      </div>

                      {Array.isArray(formulaDebug.steps) && formulaDebug.steps.length > 0 ? (
                        <div className="space-y-1">
                          <div className="text-slate-400">Steps</div>
                          <div className="rounded border border-slate-700/70 bg-slate-900/40 p-2">
                            {formulaDebug.steps.map((step, idx) => (
                              <div key={`${step.label}-${idx}`} className="flex items-center justify-between gap-2">
                                <span>{step.label}</span>
                                <span className="font-mono">{String(step.value)}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      ) : null}

                      {hasFormulaDebugErrors ? (
                        <div className="space-y-1 rounded border border-red-500/40 bg-red-500/10 p-2 text-red-200">
                          {formulaDebugErrors.map((entry, idx) => (
                            <div key={`formula-debug-acc-${idx}`}>{entry.code}: {entry.message}</div>
                          ))}
                        </div>
                      ) : null}
                    </AccordionContent>
                  </AccordionItem>
                </Accordion>
              ) : null}
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
