import React from "react";
import { AlertTriangle, Copy, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { centsToCurrencyInput, currencyInputToCents, decimalCurrencyToInput, normalizeVariableDisplay } from "@/lib/pbv2/currency";
import type { ProductOptionRule } from "@shared/productOptionRules";
import {
  isProductOptionPricingMatrixCurrencyVariable,
  type ProductOptionPricingMatrix,
} from "@shared/productOptionPricingMatrix";

type OptionKey = {
  selectionKey: string;
  label: string;
  inputType: string;
  choices: Array<{ value: string; label: string }>;
};

type MatrixVariable = {
  key: string;
  value: string;
};

const CONDITION_OPERATORS = ["equals", "not_equals", "in", "not_in", "exists", "not_exists"] as const;
const CONDITION_GROUPS = ["all", "any"] as const;
const ACTIONS = ["show", "hide", "disable", "enable", "require", "optional", "clear", "set_default"] as const;
const NO_VALUE_OPERATORS = new Set(["exists", "not_exists"]);
const MATRIX_VARIABLE_KEY_DEFAULT = "base_price";

function asRecord(value: unknown): Record<string, any> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : null;
}

function extractNodes(treeJson: any): Record<string, any> {
  const nodesRaw = treeJson?.nodes;
  if (Array.isArray(nodesRaw)) {
    return Object.fromEntries(
      nodesRaw
        .filter((node) => node && typeof node === "object" && typeof node.id === "string")
        .map((node) => [node.id, node])
    );
  }
  return asRecord(nodesRaw) ?? {};
}

function getSelectionKey(node: any): string | null {
  const input = asRecord(node?.input);
  if (typeof input?.selectionKey === "string" && input.selectionKey.trim()) return input.selectionKey;
  if (typeof node?.key === "string" && node.key.trim()) return node.key;
  if (typeof node?.id === "string" && node.id.trim()) return node.id;
  return null;
}

function getOptionKeys(treeJson: any): OptionKey[] {
  return Object.values(extractNodes(treeJson))
    .filter((node: any) => node && node.kind !== "group" && String(node.type ?? "").toUpperCase() !== "GROUP")
    .map((node: any) => {
      const selectionKey = getSelectionKey(node);
      if (!selectionKey) return null;
      const inputType = String(node?.input?.type ?? "").toLowerCase();
      const explicitChoices = Array.isArray(node.choices)
        ? node.choices
            .filter((choice: any) => choice && choice.value !== undefined && choice.value !== null)
            .map((choice: any) => ({
              value: String(choice.value),
              label: String(choice.label ?? choice.value),
            }))
        : [];
      const choices = inputType === "boolean" && explicitChoices.length === 0
        ? [
            { value: "true", label: "Yes" },
            { value: "false", label: "No" },
          ]
        : explicitChoices;
      return {
        selectionKey,
        label: String(node.label ?? selectionKey),
        inputType,
        choices,
      };
    })
    .filter((entry): entry is OptionKey => Boolean(entry))
    .sort((a, b) => a.label.localeCompare(b.label));
}

function getRules(treeJson: any): ProductOptionRule[] {
  const raw = Array.isArray(treeJson?.rules)
    ? treeJson.rules
    : Array.isArray(treeJson?.optionRules)
      ? treeJson.optionRules
      : [];
  return raw as ProductOptionRule[];
}

function getPricingMatrix(treeJson: any): ProductOptionPricingMatrix {
  const matrix = asRecord(treeJson?.pricingMatrix) ?? asRecord(treeJson?.meta?.pricingMatrix);
  return {
    dimensions: Array.isArray(matrix?.dimensions) ? matrix.dimensions.filter((value: unknown) => typeof value === "string") : [],
    rows: Array.isArray(matrix?.rows) ? matrix.rows : [],
  };
}

function makeRule(optionKeys: OptionKey[]): ProductOptionRule {
  const firstKey = optionKeys[0]?.selectionKey ?? "";
  return {
    id: `rule_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`,
    label: "New rule",
    enabled: true,
    when: {
      all: [{
        optionGroup: firstKey,
        operator: "equals",
        value: optionKeys[0]?.choices[0]?.value ?? "",
      }],
    },
    then: [{ action: "hide", targetOptionGroup: firstKey }],
  };
}

function getConditionMode(rule: ProductOptionRule): "all" | "any" {
  return Array.isArray((rule.when as any)?.any) ? "any" : "all";
}

function getConditions(rule: ProductOptionRule) {
  const mode = getConditionMode(rule);
  return ((rule.when as any)?.[mode] ?? []) as ProductOptionRule["when"] extends infer _T ? any[] : never;
}

function replaceRuleAt(rules: ProductOptionRule[], index: number, next: ProductOptionRule): ProductOptionRule[] {
  return rules.map((rule, ruleIndex) => (ruleIndex === index ? next : rule));
}

function cartesian(values: string[][]): string[][] {
  return values.reduce<string[][]>(
    (acc, options) => acc.flatMap((prefix) => options.map((value) => [...prefix, value])),
    [[]]
  );
}

function normalizeMatrixVariables(raw: unknown): MatrixVariable[] {
  const variables = asRecord(raw);
  if (!variables) return [{ key: MATRIX_VARIABLE_KEY_DEFAULT, value: "" }];
  const entries = Object.entries(variables);
  if (entries.length === 0) return [{ key: MATRIX_VARIABLE_KEY_DEFAULT, value: "" }];
  return entries.map(([key, value]) => ({ key, value: formatMatrixVariableInput(key, value) }));
}

function formatMatrixVariableInput(key: string, rawValue: unknown): string {
  if (rawValue === undefined || rawValue === null) return "";
  const value = Number(rawValue);
  if (!Number.isFinite(value)) return String(rawValue);
  if (!isProductOptionPricingMatrixCurrencyVariable(key)) return String(rawValue);
  if (Number.isInteger(value) && Math.abs(value) >= 100) return centsToCurrencyInput(value);
  return decimalCurrencyToInput(value);
}

function coerceOptionValue(optionKey: OptionKey | undefined, value: string): unknown {
  if (optionKey?.inputType === "boolean") return value === "true";
  if (optionKey?.inputType === "number" || optionKey?.inputType === "dimension") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : value;
  }
  return value;
}

function valueToEditorString(value: unknown): string {
  if (typeof value === "boolean") return value ? "true" : "false";
  if (value === undefined || value === null) return "";
  return String(value);
}

function variablesToRecord(variables: MatrixVariable[]) {
  const out: Record<string, number> = {};
  for (const variable of variables) {
    const key = variable.key.trim();
    if (!key) continue;
    const parsedValue = isProductOptionPricingMatrixCurrencyVariable(key)
      ? currencyInputToCents(variable.value)
      : Number(variable.value);
    if (typeof parsedValue === "number" && Number.isFinite(parsedValue)) out[key] = parsedValue;
  }
  return out;
}

type MatrixVariableInputProps = {
  variableValue: string;
  onCommit: (raw: string) => void;
};

function MatrixVariableInput({ variableValue, onCommit }: MatrixVariableInputProps) {
  const [local, setLocal] = React.useState(() => normalizeVariableDisplay(variableValue));
  const isFocused = React.useRef(false);

  React.useEffect(() => {
    if (!isFocused.current) setLocal(normalizeVariableDisplay(variableValue));
  }, [variableValue]);

  return (
    <Input
      type="number"
      step="0.01"
      value={local}
      onFocus={() => { isFocused.current = true; }}
      onChange={(e) => {
        const val = e.target.value;
        setLocal(val);
        if (Number.isFinite(parseFloat(val))) onCommit(val);
      }}
      onBlur={() => {
        isFocused.current = false;
        const formatted = normalizeVariableDisplay(local);
        if (Number.isFinite(parseFloat(local))) {
          setLocal(formatted);
          onCommit(formatted);
        }
      }}
      className="bg-[#1e293b] border-slate-600 text-slate-100"
    />
  );
}

function rowKey(row: any, dimensions: string[]): string {
  const match = asRecord(row?.when) ?? asRecord(row?.match) ?? asRecord(row?.combination) ?? {};
  return dimensions.map((dimension) => `${dimension}:${String(match[dimension] ?? "")}`).join("|");
}

function getMatrixWarnings(matrix: ProductOptionPricingMatrix, optionKeys: OptionKey[]) {
  const knownKeys = new Set(optionKeys.map((option) => option.selectionKey));
  const warnings: string[] = [];
  const missingDimensions = matrix.dimensions.filter((dimension) => !knownKeys.has(dimension));
  if (missingDimensions.length > 0) warnings.push(`Unknown dimensions: ${missingDimensions.join(", ")}`);

  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const row of matrix.rows) {
    const key = rowKey(row, matrix.dimensions);
    if (seen.has(key)) duplicates.add(key);
    seen.add(key);
  }
  if (duplicates.size > 0) warnings.push("Duplicate matrix row matches found.");
  return warnings;
}

function ValueEditor({
  optionKey,
  value,
  onChange,
  placeholder = "value",
}: {
  optionKey?: OptionKey;
  value: unknown;
  onChange: (value: unknown) => void;
  placeholder?: string;
}) {
  if (optionKey?.choices.length) {
    return (
      <Select value={valueToEditorString(value)} onValueChange={(next) => onChange(coerceOptionValue(optionKey, next))}>
        <SelectTrigger className="bg-[#0f172a] border-slate-600 text-slate-100">
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>
          {optionKey.choices.map((choice) => (
            <SelectItem key={choice.value} value={choice.value}>{choice.label}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  }

  return (
    <Input
      value={String(value ?? "")}
      onChange={(event) => onChange(coerceOptionValue(optionKey, event.target.value))}
      placeholder={placeholder}
      className="bg-[#0f172a] border-slate-600 text-slate-100"
    />
  );
}

export function OptionRulesPricingMatrixEditor({
  treeJson,
  onUpdateRules,
  onUpdatePricingMatrix,
}: {
  treeJson: any;
  onUpdateRules: (rules: ProductOptionRule[]) => void;
  onUpdatePricingMatrix: (pricingMatrix: ProductOptionPricingMatrix) => void;
}) {
  const optionKeys = React.useMemo(() => getOptionKeys(treeJson), [treeJson]);
  const rules = React.useMemo(() => getRules(treeJson), [treeJson]);
  const pricingMatrix = React.useMemo(() => getPricingMatrix(treeJson), [treeJson]);
  const matrixWarnings = React.useMemo(() => getMatrixWarnings(pricingMatrix, optionKeys), [pricingMatrix, optionKeys]);

  const optionByKey = React.useMemo(() => {
    return new Map(optionKeys.map((option) => [option.selectionKey, option]));
  }, [optionKeys]);

  const updateRule = (index: number, next: ProductOptionRule) => {
    onUpdateRules(replaceRuleAt(rules, index, next));
  };

  const setConditionMode = (ruleIndex: number, mode: "all" | "any") => {
    const rule = rules[ruleIndex];
    const conditions = getConditions(rule);
    updateRule(ruleIndex, { ...rule, when: { [mode]: conditions } as any });
  };

  const updateMatrix = (next: ProductOptionPricingMatrix) => onUpdatePricingMatrix(next);

  const setMatrixDimension = (dimension: string, checked: boolean) => {
    const dimensions = checked
      ? [...pricingMatrix.dimensions, dimension]
      : pricingMatrix.dimensions.filter((entry) => entry !== dimension);
    updateMatrix({ ...pricingMatrix, dimensions, rows: pricingMatrix.rows });
  };

  const generateMatrixRows = () => {
    const dimensions = pricingMatrix.dimensions;
    const dimensionOptions = dimensions.map((dimension) => optionByKey.get(dimension)?.choices.map((choice) => choice.value) ?? []);
    if (dimensions.length === 0 || dimensionOptions.some((values) => values.length === 0)) return;

    const rows = cartesian(dimensionOptions).map((values) => ({
      when: Object.fromEntries(dimensions.map((dimension, index) => [dimension, values[index]])),
      variables: { [MATRIX_VARIABLE_KEY_DEFAULT]: 0 },
    }));
    updateMatrix({ ...pricingMatrix, dimensions, rows });
  };

  return (
    <div className="mt-4 space-y-4">
      <section className="border border-slate-700 bg-[#1e293b] rounded-lg p-4 space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-slate-100">Option Rules</h3>
            <p className="text-xs text-slate-400 mt-1">Control visibility, enablement, required state, clearing, and defaults from saved option selections.</p>
          </div>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => onUpdateRules([...rules, makeRule(optionKeys)])}
            disabled={optionKeys.length === 0}
            className="gap-1.5 text-xs"
          >
            <Plus className="h-3.5 w-3.5" />
            Add Rule
          </Button>
        </div>

        {optionKeys.length === 0 ? (
          <div className="rounded-md border border-slate-700 bg-[#0f172a] p-3 text-sm text-slate-400">
            Add product options before creating rules.
          </div>
        ) : rules.length === 0 ? (
          <div className="rounded-md border border-slate-700 bg-[#0f172a] p-3 text-sm text-slate-400">
            No option rules configured.
          </div>
        ) : (
          <div className="space-y-3">
            {rules.map((rule, ruleIndex) => {
              const mode = getConditionMode(rule);
              const conditions = getConditions(rule);
              const thenActions = rule.then ?? [];
              const elseActions = rule.else ?? [];

              return (
                <div key={rule.id || ruleIndex} className="rounded-md border border-slate-700 bg-[#0f172a] p-3 space-y-3">
                  <div className="grid grid-cols-[1fr_auto_auto] gap-3 items-end">
                    <div>
                      <Label className="text-xs text-slate-400 mb-1 block">Rule label</Label>
                      <Input
                        value={rule.label ?? ""}
                        onChange={(event) => updateRule(ruleIndex, { ...rule, label: event.target.value })}
                        className="bg-[#1e293b] border-slate-600 text-slate-100"
                      />
                    </div>
                    <label className="flex items-center gap-2 text-xs text-slate-300 pb-2">
                      <Switch
                        checked={rule.enabled !== false}
                        onCheckedChange={(checked) => updateRule(ruleIndex, { ...rule, enabled: Boolean(checked) })}
                      />
                      Enabled
                    </label>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() => onUpdateRules(rules.filter((_, index) => index !== ruleIndex))}
                      className="text-red-400 hover:text-red-300 hover:bg-red-500/10"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>

                  <div className="space-y-2">
                    <div className="flex items-center justify-between gap-3">
                      <Label className="text-xs text-slate-400">Conditions</Label>
                      <Select value={mode} onValueChange={(value) => setConditionMode(ruleIndex, value as "all" | "any")}>
                        <SelectTrigger className="w-28 bg-[#1e293b] border-slate-600 text-slate-100 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {CONDITION_GROUPS.map((entry) => <SelectItem key={entry} value={entry}>{entry}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>

                    {conditions.map((condition: any, conditionIndex: number) => {
                      const selectedOption = optionByKey.get(condition.optionGroup);
                      const needsValue = !NO_VALUE_OPERATORS.has(condition.operator);
                      return (
                        <div key={conditionIndex} className="grid grid-cols-[1fr_140px_1fr_32px] gap-2 items-center">
                          <Select
                            value={condition.optionGroup || optionKeys[0]?.selectionKey}
                            onValueChange={(optionGroup) => {
                              const next = [...conditions];
                              next[conditionIndex] = { ...condition, optionGroup, value: optionByKey.get(optionGroup)?.choices[0]?.value ?? "" };
                              updateRule(ruleIndex, { ...rule, when: { [mode]: next } as any });
                            }}
                          >
                            <SelectTrigger className="bg-[#1e293b] border-slate-600 text-slate-100">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {optionKeys.map((option) => (
                                <SelectItem key={option.selectionKey} value={option.selectionKey}>{option.label}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>

                          <Select
                            value={condition.operator}
                            onValueChange={(operator) => {
                              const next = [...conditions];
                              next[conditionIndex] = { ...condition, operator };
                              updateRule(ruleIndex, { ...rule, when: { [mode]: next } as any });
                            }}
                          >
                            <SelectTrigger className="bg-[#1e293b] border-slate-600 text-slate-100">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {CONDITION_OPERATORS.map((operator) => (
                                <SelectItem key={operator} value={operator}>{operator}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>

                          {needsValue ? (
                            <ValueEditor
                              optionKey={selectedOption}
                              value={condition.value}
                              onChange={(value) => {
                                const next = [...conditions];
                                next[conditionIndex] = { ...condition, value };
                                updateRule(ruleIndex, { ...rule, when: { [mode]: next } as any });
                              }}
                            />
                          ) : (
                            <div className="text-xs text-slate-500">No value</div>
                          )}

                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            onClick={() => {
                              const next = conditions.filter((_: any, index: number) => index !== conditionIndex);
                              updateRule(ruleIndex, { ...rule, when: { [mode]: next.length ? next : conditions } as any });
                            }}
                            className="text-red-400 hover:text-red-300 hover:bg-red-500/10"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      );
                    })}

                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        const firstKey = optionKeys[0]?.selectionKey ?? "";
                        const next = [...conditions, { optionGroup: firstKey, operator: "equals", value: optionKeys[0]?.choices[0]?.value ?? "" }];
                        updateRule(ruleIndex, { ...rule, when: { [mode]: next } as any });
                      }}
                      className="gap-1.5 text-xs"
                    >
                      <Plus className="h-3.5 w-3.5" />
                      Add Condition
                    </Button>
                  </div>

                  <RuleActionsEditor
                    title="Then actions"
                    actions={thenActions}
                    optionKeys={optionKeys}
                    optionByKey={optionByKey}
                    onChange={(then) => updateRule(ruleIndex, { ...rule, then })}
                  />
                  <RuleActionsEditor
                    title="Else actions"
                    actions={elseActions}
                    optionKeys={optionKeys}
                    optionByKey={optionByKey}
                    onChange={(elseActionsNext) => updateRule(ruleIndex, { ...rule, else: elseActionsNext })}
                  />
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section className="border border-slate-700 bg-[#1e293b] rounded-lg p-4 space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-slate-100">Pricing Matrix</h3>
            <p className="text-xs text-slate-400 mt-1">Resolve formula variables from valid option combinations after rules are applied.</p>
          </div>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={generateMatrixRows}
            disabled={pricingMatrix.dimensions.length === 0}
            className="gap-1.5 text-xs"
          >
            <Copy className="h-3.5 w-3.5" />
            Generate Rows
          </Button>
        </div>

        {optionKeys.length === 0 ? (
          <div className="rounded-md border border-slate-700 bg-[#0f172a] p-3 text-sm text-slate-400">
            Add selectable options before configuring matrix dimensions.
          </div>
        ) : (
          <>
            <div className="space-y-2">
              <Label className="text-xs text-slate-400">Dimensions</Label>
              <div className="flex flex-wrap gap-2">
                {optionKeys.map((option) => {
                  const selected = pricingMatrix.dimensions.includes(option.selectionKey);
                  return (
                    <Button
                      key={option.selectionKey}
                      type="button"
                      size="sm"
                      variant={selected ? "default" : "outline"}
                      onClick={() => setMatrixDimension(option.selectionKey, !selected)}
                      className="text-xs"
                    >
                      {option.label}
                    </Button>
                  );
                })}
              </div>
            </div>

            {matrixWarnings.length > 0 ? (
              <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-200 space-y-1">
                {matrixWarnings.map((warning) => (
                  <div key={warning} className="flex items-center gap-2">
                    <AlertTriangle className="h-3.5 w-3.5" />
                    {warning}
                  </div>
                ))}
              </div>
            ) : null}

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-xs text-slate-400">Rows</Label>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => updateMatrix({
                    ...pricingMatrix,
                    rows: [
                      ...pricingMatrix.rows,
                      {
                        when: Object.fromEntries(pricingMatrix.dimensions.map((dimension) => [dimension, optionByKey.get(dimension)?.choices[0]?.value ?? ""])),
                        variables: { [MATRIX_VARIABLE_KEY_DEFAULT]: 0 },
                      },
                    ],
                  })}
                  disabled={pricingMatrix.dimensions.length === 0}
                  className="gap-1.5 text-xs"
                >
                  <Plus className="h-3.5 w-3.5" />
                  Add Row
                </Button>
              </div>

              {pricingMatrix.dimensions.length === 0 ? (
                <div className="rounded-md border border-slate-700 bg-[#0f172a] p-3 text-sm text-slate-400">
                  Choose one or more dimensions to begin.
                </div>
              ) : pricingMatrix.rows.length === 0 ? (
                <div className="rounded-md border border-slate-700 bg-[#0f172a] p-3 text-sm text-slate-400">
                  Generate rows from dimension choices or add rows manually.
                </div>
              ) : (
                <div className="space-y-2">
                  {pricingMatrix.rows.map((row: any, rowIndex) => {
                    const match = asRecord(row.when) ?? asRecord(row.match) ?? asRecord(row.combination) ?? {};
                    const variables = normalizeMatrixVariables(row.variables ?? row.values);
                    return (
                      <div key={rowIndex} className="rounded-md border border-slate-700 bg-[#0f172a] p-3 space-y-3">
                        <div className="flex items-start gap-2">
                          <div className="flex-1 grid gap-2" style={{ gridTemplateColumns: `repeat(${Math.max(pricingMatrix.dimensions.length, 1)}, minmax(0, 1fr))` }}>
                            {pricingMatrix.dimensions.map((dimension) => (
                              <div key={dimension}>
                                <Label className="text-xs text-slate-400 mb-1 block">{optionByKey.get(dimension)?.label ?? dimension}</Label>
                                <ValueEditor
                                  optionKey={optionByKey.get(dimension)}
                                  value={match[dimension]}
                                  onChange={(value) => {
                                    const rows = [...pricingMatrix.rows];
                                    rows[rowIndex] = {
                                      ...row,
                                      when: { ...match, [dimension]: value },
                                      variables: variablesToRecord(variables),
                                    };
                                    updateMatrix({ ...pricingMatrix, rows });
                                  }}
                                />
                              </div>
                            ))}
                          </div>
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            onClick={() => updateMatrix({ ...pricingMatrix, rows: pricingMatrix.rows.filter((_, index) => index !== rowIndex) })}
                            className="text-red-400 hover:text-red-300 hover:bg-red-500/10 mt-5"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>

                        <div className="space-y-2">
                          <Label className="text-xs text-slate-400">Variables</Label>
                          {variables.map((variable, variableIndex) => (
                            <div key={variableIndex} className="grid grid-cols-[1fr_140px_32px] gap-2 items-center">
                              <Input
                                value={variable.key}
                                onChange={(event) => {
                                  const nextVariables = [...variables];
                                  nextVariables[variableIndex] = { ...variable, key: event.target.value };
                                  const rows = [...pricingMatrix.rows];
                                  rows[rowIndex] = { ...row, when: match, variables: variablesToRecord(nextVariables) };
                                  updateMatrix({ ...pricingMatrix, rows });
                                }}
                                className="bg-[#1e293b] border-slate-600 text-slate-100"
                              />
                              <MatrixVariableInput
                                variableValue={variable.value}
                                onCommit={(raw) => {
                                  const nextVariables = [...variables];
                                  nextVariables[variableIndex] = { ...variable, value: raw };
                                  const rows = [...pricingMatrix.rows];
                                  rows[rowIndex] = { ...row, when: match, variables: variablesToRecord(nextVariables) };
                                  updateMatrix({ ...pricingMatrix, rows });
                                }}
                              />
                              <Button
                                type="button"
                                size="sm"
                                variant="ghost"
                                onClick={() => {
                                  const nextVariables = variables.filter((_, index) => index !== variableIndex);
                                  const rows = [...pricingMatrix.rows];
                                  rows[rowIndex] = { ...row, when: match, variables: variablesToRecord(nextVariables) };
                                  updateMatrix({ ...pricingMatrix, rows });
                                }}
                                className="text-red-400 hover:text-red-300 hover:bg-red-500/10"
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </div>
                          ))}
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              const nextVariables = [...variables, { key: "", value: "" }];
                              const rows = [...pricingMatrix.rows];
                              rows[rowIndex] = { ...row, when: match, variables: variablesToRecord(nextVariables) };
                              updateMatrix({ ...pricingMatrix, rows });
                            }}
                            className="gap-1.5 text-xs"
                          >
                            <Plus className="h-3.5 w-3.5" />
                            Add Variable
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </>
        )}
      </section>
    </div>
  );
}

function RuleActionsEditor({
  title,
  actions,
  optionKeys,
  optionByKey,
  onChange,
}: {
  title: string;
  actions: ProductOptionRule["then"];
  optionKeys: OptionKey[];
  optionByKey: Map<string, OptionKey>;
  onChange: (actions: ProductOptionRule["then"]) => void;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <Label className="text-xs text-slate-400">{title}</Label>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => onChange([...actions, { action: "hide", targetOptionGroup: optionKeys[0]?.selectionKey ?? "" }])}
          className="gap-1.5 text-xs"
        >
          <Plus className="h-3.5 w-3.5" />
          Add Action
        </Button>
      </div>
      {actions.length === 0 ? (
        <div className="text-xs text-slate-500">No actions.</div>
      ) : (
        <div className="space-y-2">
          {actions.map((action, actionIndex) => {
            const selectedOption = optionByKey.get(action.targetOptionGroup);
            return (
              <div key={actionIndex} className="grid grid-cols-[140px_1fr_1fr_32px] gap-2 items-center">
                <Select
                  value={action.action}
                  onValueChange={(nextAction) => {
                    const next = [...actions];
                    next[actionIndex] = { ...action, action: nextAction as any };
                    onChange(next);
                  }}
                >
                  <SelectTrigger className="bg-[#1e293b] border-slate-600 text-slate-100">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ACTIONS.map((entry) => <SelectItem key={entry} value={entry}>{entry}</SelectItem>)}
                  </SelectContent>
                </Select>

                <Select
                  value={action.targetOptionGroup || optionKeys[0]?.selectionKey}
                  onValueChange={(targetOptionGroup) => {
                    const next = [...actions];
                    next[actionIndex] = { ...action, targetOptionGroup };
                    onChange(next);
                  }}
                >
                  <SelectTrigger className="bg-[#1e293b] border-slate-600 text-slate-100">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {optionKeys.map((option) => (
                      <SelectItem key={option.selectionKey} value={option.selectionKey}>{option.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                {action.action === "set_default" ? (
                  <ValueEditor
                    optionKey={selectedOption}
                    value={action.value}
                    onChange={(value) => {
                      const next = [...actions];
                      next[actionIndex] = { ...action, value };
                      onChange(next);
                    }}
                    placeholder="default"
                  />
                ) : (
                  <div className="text-xs text-slate-500">No value</div>
                )}

                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => onChange(actions.filter((_, index) => index !== actionIndex))}
                  className="text-red-400 hover:text-red-300 hover:bg-red-500/10"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
