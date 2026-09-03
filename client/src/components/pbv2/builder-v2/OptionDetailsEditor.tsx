import React from 'react';
import { Plus, ChevronDown, ChevronUp, AlertCircle, Trash2, Check, ChevronsUpDown } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Separator } from '@/components/ui/separator';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList, CommandSeparator } from '@/components/ui/command';
import { cn } from '@/lib/utils';
import { centsToCurrencyInput, centsToCurrencyLabel, currencyInputToCents } from '@/lib/pbv2/currency';
import {
  parseMoneyInputDraft,
  normalizePricingImpactForMode,
  normalizeLegacyPricingImpact,
  normalizeFormulaInputDraft,
  getPricingImpactWarnings,
} from '@/lib/pbv2/pricing/pricingImpact';
import type { EditorOption } from '@/lib/pbv2/pbv2ViewModel';
import { CreateMaterialDialog } from '@/features/materials/CreateMaterialDialog';
import { useMaterial, useMaterialsSearch, type MaterialSearchItem } from '@/hooks/useMaterials';
import { useAuth } from '@/hooks/useAuth';
import { formatMaterialWeightStatus } from '@/lib/materialWeightDisplay';

const MATERIAL_DROPDOWN_RESULT_LIMIT = 200;
const MATERIAL_COMMAND_LIST_CLASS = "max-h-80 overflow-y-auto overscroll-contain";

/**
 * Money input backed by a local draft string so the user can type freely —
 * including partial values like "1." and a fully-cleared field — without the
 * controlled value snapping back.
 *
 * It commits cents only on a valid keystroke (blank/partial input is never
 * coerced mid-edit, so the field never fights the user) and normalizes the
 * display on blur. A field left blank settles to 0 on blur — the existing
 * PBV2 convention for impact amounts (`Add Impact` creates `cents: 0`) — which
 * also keeps the stored value schema-valid (`pricingImpact` requires a number).
 *
 * Uses type="text" + inputMode="decimal": native number spinners are
 * unreliable when the value is draft-controlled.
 */
function MoneyInput({
  cents,
  onCommit,
  className,
  placeholder = '0.00',
  ariaLabel,
}: {
  cents: number | null | undefined;
  onCommit: (cents: number) => void;
  className?: string;
  placeholder?: string;
  ariaLabel?: string;
}) {
  const [draft, setDraft] = React.useState<string>(() => centsToCurrencyInput(cents));
  const [focused, setFocused] = React.useState(false);

  // Sync from the tree only while not actively editing, so external changes
  // (type switch, reorder) refresh the field without fighting the user.
  React.useEffect(() => {
    if (!focused) setDraft(centsToCurrencyInput(cents));
  }, [cents, focused]);

  return (
    <Input
      type="text"
      inputMode="decimal"
      aria-label={ariaLabel}
      placeholder={placeholder}
      value={draft}
      onFocus={() => setFocused(true)}
      onChange={(e) => {
        const raw = e.target.value;
        setDraft(raw);
        const commit = parseMoneyInputDraft(raw);
        // Only commit a fully-parsed value. Blank/partial input keeps typing
        // without coercing to 0 mid-edit and never writes NaN to the tree.
        if (commit.status === 'valid') onCommit(commit.cents);
      }}
      onBlur={() => {
        setFocused(false);
        const commit = parseMoneyInputDraft(draft);
        if (commit.status === 'valid') {
          setDraft(centsToCurrencyInput(commit.cents));
          onCommit(commit.cents);
        } else {
          // Blank/unparseable settles to 0 — the existing PBV2 amount default.
          setDraft(centsToCurrencyInput(0));
          onCommit(0);
        }
      }}
      className={className}
    />
  );
}

function FormulaInput({
  formula,
  onCommit,
  className,
  placeholder = 'custom_grommet_qty * 0.25 * q',
}: {
  formula: string;
  onCommit: (formula: string) => void;
  className?: string;
  placeholder?: string;
}) {
  const displayFormula = formula.trim() === '0' ? '' : formula;
  const inputRef = React.useRef<HTMLInputElement | null>(null);
  const [focused, setFocused] = React.useState(false);

  React.useEffect(() => {
    if (!focused && inputRef.current && inputRef.current.value !== displayFormula) {
      inputRef.current.value = displayFormula;
    }
  }, [displayFormula, focused]);

  return (
    <Input
      ref={inputRef}
      type="text"
      defaultValue={displayFormula}
      onFocus={() => {
        setFocused(true);
        if (inputRef.current?.value.trim() === '0') {
          inputRef.current.value = '';
        }
      }}
      onChange={(e) => {
        const nextFormula = normalizeFormulaInputDraft(formula, e.currentTarget.value);
        if (nextFormula !== e.currentTarget.value) {
          e.currentTarget.value = nextFormula;
        }
        onCommit(nextFormula);
      }}
      onBlur={() => {
        setFocused(false);
        const currentValue = inputRef.current?.value ?? '';
        const settled = currentValue.trim() ? currentValue : '0';
        if (inputRef.current) {
          inputRef.current.value = settled.trim() === '0' ? '' : settled;
        }
        onCommit(settled);
      }}
      placeholder={placeholder}
      className={className}
    />
  );
}

type QuantityBasis = 'area_sqft' | 'perimeter_ft' | 'linear_ft' | 'each' | 'fixed';
type PricingOverrideMode = 'none' | 'set_base_rate' | 'add_base_rate' | 'multiply_base_rate';
type PricingOverrideUnit = 'perSqft' | 'perPiece' | 'minimumCharge';
type EditingChoiceValue = { optionId: string; value: string; originalValue?: string };

function impliedUomForBasis(basis: QuantityBasis): 'square_foot' | 'linear_foot' | 'each' {
  if (basis === 'area_sqft') return 'square_foot';
  if (basis === 'perimeter_ft' || basis === 'linear_ft') return 'linear_foot';
  return 'each';
}

function normalizeMaterialUom(value: string | null | undefined): 'square_foot' | 'linear_foot' | 'each' | null {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return null;
  if (raw === 'sqft' || raw === 'sf' || raw === 'square_foot' || raw === 'square_feet') return 'square_foot';
  if (raw === 'ft' || raw === 'foot' || raw === 'feet' || raw === 'linear_ft') return 'linear_foot';
  if (raw === 'each' || raw === 'ea' || raw === 'sheet' || raw === 'roll') return 'each';
  return null;
}

function formatWorkflowTags(value: unknown): string {
  if (!Array.isArray(value)) return '';
  return value
    .filter((tag): tag is string => typeof tag === 'string')
    .map((tag) => tag.trim())
    .filter(Boolean)
    .join(', ');
}

function parseWorkflowTags(value: string): string[] {
  return Array.from(
    new Set(
      value
        .split(/[\n,]+/)
        .map((tag) => tag.trim())
        .filter(Boolean)
    )
  );
}

function pricingOverrideAppliesToForUnit(unit: PricingOverrideUnit): 'base' | 'area' | 'quantity' {
  if (unit === 'perSqft') return 'area';
  if (unit === 'perPiece') return 'quantity';
  return 'base';
}

function formatPricingOverrideAmount(mode: PricingOverrideMode, amount: number | undefined): string {
  if (typeof amount !== 'number' || !Number.isFinite(amount)) return '';
  if (mode === 'multiply_base_rate') return amount.toString();
  return centsToCurrencyInput(amount);
}

interface OptionDetailsEditorProps {
  option: EditorOption;
  treeJson: any;
  onUpdateOption: (optionId: string, updates: any) => void;
  onAddChoice: (optionId: string) => void;
  onUpdateChoice: (optionId: string, choiceValue: string, updates: any) => void;
  onDeleteChoice: (optionId: string, choiceValue: string) => void;
  onReorderChoice: (optionId: string, fromIndex: number, toIndex: number) => void;
  onUpdateNodePricing: (optionId: string, pricingImpact: any[]) => void;
  onAddPricingRule: (optionId: string, rule: { mode: string; cents?: number; amountCents?: number; label?: string }) => void;
  onDeletePricingRule: (optionId: string, ruleIndex: number) => void;
  editingChoiceValue: EditingChoiceValue | null;
  setEditingChoiceValue: (val: EditingChoiceValue | null) => void;
}

export function OptionDetailsEditor({
  option,
  treeJson,
  onUpdateOption,
  onAddChoice,
  onUpdateChoice,
  onDeleteChoice,
  onReorderChoice,
  onUpdateNodePricing,
  onAddPricingRule,
  onDeletePricingRule,
  editingChoiceValue,
  setEditingChoiceValue
}: OptionDetailsEditorProps) {
  const queryClient = useQueryClient();
  const auth = useAuth();
  const canCreateMaterials = !auth.isLoading && !!auth.user && (
    auth.isAdmin ||
    auth.user?.role === 'owner' ||
    auth.user?.role === 'admin'
  );

  const [isAddMaterialOpen, setIsAddMaterialOpen] = React.useState(false);
  const [addMaterialTarget, setAddMaterialTarget] = React.useState<{ choiceIdx: number; entryIdx: number } | null>(null);
  const [recentlyCreatedByRowKey, setRecentlyCreatedByRowKey] = React.useState<Record<string, MaterialSearchItem>>({});

  const getRowKey = React.useCallback((choiceIdx: number, entryIdx: number) => `${choiceIdx}:${entryIdx}`, []);

  // Get actual node data from tree
  const nodeData = React.useMemo(() => {
    const nodesRaw = treeJson?.nodes;
    if (!nodesRaw) return undefined;
    
    // Handle both array and object (Record) format
    if (Array.isArray(nodesRaw)) {
      return nodesRaw.find((n: any) => n?.id === option.id);
    } else if (typeof nodesRaw === 'object') {
      return nodesRaw[option.id];
    }
    
    return undefined;
  }, [treeJson, option.id]);

  const choices = nodeData?.choices || [];
  const defaultValue = nodeData?.input?.defaultValue;
  const isRequired = nodeData?.input?.required || false;
  
  const isSelectType = option.type === 'radio' || option.type === 'dropdown';
  const isCheckboxType = option.type === 'checkbox';

  // Validation
  const duplicateValues = React.useMemo(() => {
    const values = choices.map((c: any) => c.value);
    const duplicates = new Set<string>();
    const seen = new Set<string>();
    values.forEach((v: string) => {
      if (seen.has(v)) duplicates.add(v);
      seen.add(v);
    });
    return duplicates;
  }, [choices]);

  const hasEmptyLabels = choices.some((c: any) => !c.label?.trim());
  const hasEmptyValues = choices.some((c: any) => !c.value?.trim());
  const hasInvalidDefault = defaultValue && !choices.some((c: any) => c.value === defaultValue);

  const quantityBasisOptions: Array<{ value: "area_sqft" | "perimeter_ft" | "linear_ft" | "each" | "fixed"; label: string }> = [
    { value: "area_sqft", label: "Area (sqft)" },
    { value: "perimeter_ft", label: "Perimeter (ft)" },
    { value: "linear_ft", label: "Linear (ft)" },
    { value: "each", label: "Each" },
    { value: "fixed", label: "Fixed Qty" },
  ];

  return (
    <div className="space-y-4">
      <div className="space-y-3">
        <div>
          <Label className="text-slate-300 mb-1.5 block">Option Label *</Label>
          <Input
            value={nodeData?.label || ''}
            onChange={(e) => onUpdateOption(option.id, { label: e.target.value })}
            placeholder="Enter option label..."
            className="bg-[#1e293b] border-slate-600 text-slate-100"
          />
          {!nodeData?.label?.trim() && (
            <div className="flex items-center gap-1.5 mt-1 text-xs text-red-400">
              <AlertCircle className="h-3 w-3" />
              Label is required
            </div>
          )}
        </div>

        <div>
          <Label className="text-slate-300 mb-1.5 block">Description / Help Text</Label>
          <Textarea
            value={nodeData?.description || ''}
            onChange={(e) => onUpdateOption(option.id, { description: e.target.value })}
            placeholder="Optional help text for users..."
            className="bg-[#1e293b] border-slate-600 text-slate-100 min-h-[60px]"
          />
        </div>

        <div>
          <Label className="text-slate-300 mb-1.5 block">Input Type</Label>
          <Select
            value={option.type}
            onValueChange={(value) => onUpdateOption(option.id, { type: value })}
          >
            <SelectTrigger className="bg-[#1e293b] border-slate-600 text-slate-100">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="radio">Radio (Single Choice)</SelectItem>
              <SelectItem value="dropdown">Dropdown (Single Choice)</SelectItem>
              <SelectItem value="checkbox">Checkbox (Boolean)</SelectItem>
              <SelectItem value="numeric">Numeric Input</SelectItem>
              <SelectItem value="dimension">Dimension Input</SelectItem>
              <SelectItem value="text">Text Input</SelectItem>
              <SelectItem value="textarea">Textarea / Note</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="flex items-center gap-2">
          <Switch
            id={`required-${option.id}`}
            checked={isRequired}
            onCheckedChange={(checked) => onUpdateOption(option.id, { required: checked })}
          />
          <Label htmlFor={`required-${option.id}`} className="text-slate-300 cursor-pointer">
            Required field
          </Label>
        </div>
      </div>

      {isSelectType && (
        <>
          <Separator className="bg-slate-700" />
          
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <Label className="text-slate-300">Choices</Label>
                {choices.length === 0 && isRequired && (
                  <div className="flex items-center gap-1.5 mt-1 text-xs text-red-400">
                    <AlertCircle className="h-3 w-3" />
                    Required select must have at least one choice
                  </div>
                )}
              </div>
              <Button
                type="button"
                onClick={() => onAddChoice(option.id)}
                size="sm"
                variant="outline"
                className="gap-1.5 text-xs"
              >
                <Plus className="h-3.5 w-3.5" />
                Add Choice
              </Button>
            </div>

            {choices.length > 0 && (
              <div className="space-y-2">
                {choices.map((choice: any, index: number) => {
                  const isDuplicate = duplicateValues.has(choice.value);
                  const editingOriginalValue = editingChoiceValue?.originalValue ?? editingChoiceValue?.value;
                  const isEditing = editingChoiceValue?.optionId === option.id && editingOriginalValue === choice.value;
                  const commitChoiceValueEdit = () => {
                    if (!editingChoiceValue || !isEditing) return;
                    onUpdateChoice(option.id, editingOriginalValue ?? choice.value, { value: editingChoiceValue.value });
                    setEditingChoiceValue(null);
                  };
                  const choiceWorkflowTags = Array.isArray(choice.workflowTags) ? choice.workflowTags : [];
                  const hasVariantContext =
                    choice.priceDeltaCents !== undefined ||
                    (choice.pricingOverride?.mode && choice.pricingOverride.mode !== 'none') ||
                    !!choice.materialOverride?.materialId ||
                    choiceWorkflowTags.length > 0;
                  const hasModifierContext =
                    (Array.isArray(choice.pricingImpact) && choice.pricingImpact.length > 0) ||
                    (Array.isArray(choice.inventoryConsumption) && choice.inventoryConsumption.length > 0);

                  return (
                    <div
                      key={choice.value}
                      className="bg-[#1e293b] border border-slate-700 rounded-lg p-3 space-y-2"
                    >
                      <div className="flex items-start gap-2">
                        <div className="flex flex-col gap-1 mt-2">
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => index > 0 && onReorderChoice(option.id, index, index - 1)}
                            disabled={index === 0}
                            className="h-6 w-6 p-0 text-slate-400 hover:text-slate-200"
                          >
                            <ChevronUp className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => index < choices.length - 1 && onReorderChoice(option.id, index, index + 1)}
                            disabled={index === choices.length - 1}
                            className="h-6 w-6 p-0 text-slate-400 hover:text-slate-200"
                          >
                            <ChevronDown className="h-3.5 w-3.5" />
                          </Button>
                        </div>

                        <div className="flex-1 space-y-2">
                          <div className="flex flex-wrap items-center gap-2">
                            {hasVariantContext ? (
                              <span className="rounded-full border border-sky-500/40 bg-sky-500/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-sky-200">
                                Variant-defining
                              </span>
                            ) : null}
                            {hasModifierContext ? (
                              <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-emerald-200">
                                Additive modifier
                              </span>
                            ) : null}
                          </div>

                          <div>
                            <Label className="text-xs text-slate-400 mb-1 block">Label *</Label>
                            <Input
                              value={choice.label}
                              onChange={(e) => onUpdateChoice(option.id, choice.value, { label: e.target.value })}
                              placeholder="Choice label..."
                              className="bg-[#0f172a] border-slate-600 text-slate-100 text-sm"
                            />
                            {!choice.label?.trim() && (
                              <div className="text-xs text-red-400 mt-1">Label required</div>
                            )}
                          </div>

                          <div>
                            <Label className="text-xs text-slate-400 mb-1 block">Value *</Label>
                            <div className="flex gap-2">
                              {isEditing ? (
                                <>
                                  <Input
                                    value={editingChoiceValue?.value ?? choice.value}
                                    onChange={(e) => {
                                      const newValue = e.target.value;
                                      setEditingChoiceValue({
                                        optionId: option.id,
                                        originalValue: editingOriginalValue ?? choice.value,
                                        value: newValue,
                                      });
                                    }}
                                    onBlur={() => {
                                      commitChoiceValueEdit();
                                    }}
                                    onKeyDown={(e) => {
                                      if (e.key === 'Enter') {
                                        commitChoiceValueEdit();
                                      }
                                      if (e.key === 'Escape') {
                                        setEditingChoiceValue(null);
                                      }
                                    }}
                                    className="bg-[#0f172a] border-slate-600 text-slate-100 text-sm flex-1"
                                    autoFocus
                                  />
                                  <Button
                                    type="button"
                                    size="sm"
                                    onClick={() => {
                                      commitChoiceValueEdit();
                                    }}
                                  >
                                    Save
                                  </Button>
                                </>
                              ) : (
                                <>
                                  <code className="flex-1 text-xs bg-[#0f172a] border border-slate-600 rounded px-2 py-1.5 text-slate-300">
                                    {choice.value}
                                  </code>
                                  <Button
                                    type="button"
                                    size="sm"
                                    variant="outline"
                                    onClick={() => setEditingChoiceValue({ optionId: option.id, originalValue: choice.value, value: choice.value })}
                                    className="text-xs"
                                  >
                                    Edit
                                  </Button>
                                </>
                              )}
                            </div>
                            {isDuplicate && (
                              <div className="flex items-center gap-1.5 text-xs text-red-400 mt-1">
                                <AlertCircle className="h-3 w-3" />
                                Duplicate value
                              </div>
                            )}
                          </div>

                          <div className="mt-3 pt-3 border-t border-slate-700 space-y-3">
                            <div>
                              <Label className="text-xs text-slate-400">Variant Context</Label>
                              <p className="text-[11px] text-slate-500 mt-0.5">
                                Use these fields for variant-defining selections. Keep additive logic in Pricing Impacts and Materials below.
                              </p>
                            </div>

                            <div className="space-y-2 rounded-md border border-slate-700/80 bg-[#0f172a]/60 p-3">
                              <div>
                                <Label className="text-xs text-slate-400 mb-1 block">Pricing Override</Label>
                                <Select
                                  value={choice.pricingOverride?.mode ?? 'none'}
                                  onValueChange={(mode: PricingOverrideMode) => {
                                    if (mode === 'none') {
                                      onUpdateChoice(option.id, choice.value, { pricingOverride: undefined });
                                      return;
                                    }

                                    const nextUnit: PricingOverrideUnit = choice.pricingOverride?.unit ?? 'perSqft';
                                    onUpdateChoice(option.id, choice.value, {
                                      pricingOverride: {
                                        ...choice.pricingOverride,
                                        mode,
                                        unit: nextUnit,
                                        appliesTo: pricingOverrideAppliesToForUnit(nextUnit),
                                      },
                                    });
                                  }}
                                >
                                  <SelectTrigger className="bg-[#0a0f1a] border-slate-700 text-slate-200 text-sm">
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="none">None</SelectItem>
                                    <SelectItem value="set_base_rate">Set Base Rate</SelectItem>
                                    <SelectItem value="add_base_rate">Add Base Rate</SelectItem>
                                    <SelectItem value="multiply_base_rate">Multiply Base Rate</SelectItem>
                                  </SelectContent>
                                </Select>
                              </div>

                              {choice.pricingOverride?.mode && choice.pricingOverride.mode !== 'none' ? (
                                <div className="grid gap-2 md:grid-cols-2">
                                  <div>
                                    <Label className="text-xs text-slate-400 mb-1 block">
                                      {choice.pricingOverride.mode === 'multiply_base_rate' ? 'Multiplier' : 'Amount'}
                                    </Label>
                                    <Input
                                      type="number"
                                      step={choice.pricingOverride.mode === 'multiply_base_rate' ? '0.01' : '0.01'}
                                      value={formatPricingOverrideAmount(choice.pricingOverride.mode, choice.pricingOverride.amount)}
                                      onChange={(e) => {
                                        const raw = e.target.value;
                                        const parsed = choice.pricingOverride.mode === 'multiply_base_rate'
                                          ? (raw === '' ? undefined : Number(raw))
                                          : currencyInputToCents(raw);
                                        onUpdateChoice(option.id, choice.value, {
                                          pricingOverride: {
                                            ...choice.pricingOverride,
                                            amount: parsed !== undefined && Number.isFinite(parsed) ? parsed : undefined,
                                          },
                                        });
                                      }}
                                      placeholder={choice.pricingOverride.mode === 'multiply_base_rate' ? '1.00' : '0.00'}
                                      className="bg-[#0a0f1a] border-slate-700 text-slate-100 text-sm"
                                    />
                                    <div className="text-[11px] text-slate-500 mt-1">
                                      {choice.pricingOverride.mode === 'multiply_base_rate'
                                        ? 'Use 1.10 to increase the resolved base rate by 10%.'
                                        : 'Enter dollars for the resolved base rate input this choice controls.'}
                                    </div>
                                  </div>

                                  <div>
                                    <Label className="text-xs text-slate-400 mb-1 block">Pricing Unit</Label>
                                    <Select
                                      value={choice.pricingOverride.unit ?? 'perSqft'}
                                      onValueChange={(unit: PricingOverrideUnit) =>
                                        onUpdateChoice(option.id, choice.value, {
                                          pricingOverride: {
                                            ...choice.pricingOverride,
                                            unit,
                                            appliesTo: pricingOverrideAppliesToForUnit(unit),
                                          },
                                        })
                                      }
                                    >
                                      <SelectTrigger className="bg-[#0a0f1a] border-slate-700 text-slate-200 text-sm">
                                        <SelectValue />
                                      </SelectTrigger>
                                      <SelectContent>
                                        <SelectItem value="perSqft">Per Sqft</SelectItem>
                                        <SelectItem value="perPiece">Per Piece</SelectItem>
                                        <SelectItem value="minimumCharge">Minimum Charge</SelectItem>
                                      </SelectContent>
                                    </Select>
                                  </div>
                                </div>
                              ) : null}

                              <div className="text-[11px] text-slate-500">
                                Use this when a choice defines the base pricing for the configured product, such as ACM thickness or banner media weight.
                              </div>
                            </div>

                            <div>
                              <Label className="text-xs text-slate-400 mb-1 block">Variant Price Delta ($)</Label>
                              <Input
                                type="number"
                                step="0.01"
                                value={centsToCurrencyInput(choice.priceDeltaCents)}
                                onChange={(e) => {
                                  onUpdateChoice(option.id, choice.value, {
                                    priceDeltaCents: currencyInputToCents(e.target.value)
                                  });
                                }}
                                onBlur={(e) => {
                                  const value = e.target.value;
                                  if (value === '') {
                                    onUpdateChoice(option.id, choice.value, { priceDeltaCents: undefined });
                                  }
                                }}
                                placeholder="0.00 (optional)"
                                className="bg-[#0f172a] border-slate-600 text-slate-100 text-sm"
                              />
                              {choice.priceDeltaCents !== undefined && choice.priceDeltaCents !== null ? (
                                <div className="text-xs text-slate-400 mt-1">
                                  {centsToCurrencyLabel(choice.priceDeltaCents)}
                                </div>
                              ) : (
                                <div className="text-[11px] text-slate-500 mt-1">
                                  Optional metadata for variant-level pricing context. Existing additive impacts still apply separately.
                                </div>
                              )}
                            </div>

                            <div>
                              <Label className="text-xs text-slate-400 mb-1 block">Resolved Material Override</Label>
                              <MaterialIdSearchField
                                value={choice.materialOverride?.materialId ?? ''}
                                onChange={(nextMaterialId) =>
                                  onUpdateChoice(option.id, choice.value, {
                                    materialOverride: nextMaterialId ? { materialId: nextMaterialId } : undefined,
                                  })
                                }
                                onRequestAddMaterial={() => {}}
                                canCreateMaterials={false}
                                showUsageValidation={false}
                              />
                              <div className="text-[11px] text-slate-500 mt-1">
                                Selects the canonical material for this choice. If inventory consumption is also configured below, it must use this same material; the consumption rule supplies quantity and basis.
                              </div>
                            </div>

                            <div>
                              <Label className="text-xs text-slate-400 mb-1 block">Workflow Context Tags</Label>
                              <Textarea
                                value={formatWorkflowTags(choice.workflowTags)}
                                onChange={(e) =>
                                  onUpdateChoice(option.id, choice.value, {
                                    workflowTags: parseWorkflowTags(e.target.value),
                                  })
                                }
                                placeholder="acm, rigid, thickness:3mm"
                                className="bg-[#0f172a] border-slate-600 text-slate-100 text-sm min-h-[72px]"
                              />
                              <div className="text-[11px] text-slate-500 mt-1">
                                Comma or newline separated tags for downstream workflow context.
                              </div>
                            </div>
                          </div>

                          {/* Choice-level Pricing Impacts (v2.1) */}
                          <div className="mt-3 pt-3 border-t border-slate-700">
                            <div className="flex items-center justify-between mb-2">
                              <Label className="text-xs text-slate-400">Pricing Impacts</Label>
                              <Button
                                type="button"
                                size="sm"
                                variant="ghost"
                                onClick={() => {
                                  const currentImpacts = choice.pricingImpact || [];
                                  onUpdateChoice(option.id, choice.value, {
                                    pricingImpact: [...currentImpacts, { mode: 'addCents', cents: 0 }]
                                  });
                                }}
                                className="h-6 text-xs text-slate-400 hover:text-slate-200"
                              >
                                <Plus className="h-3 w-3 mr-1" />
                                Add Impact
                              </Button>
                            </div>
                            
                            {Array.isArray(choice.pricingImpact) && choice.pricingImpact.length > 0 ? (
                              <div className="space-y-2">
                                {choice.pricingImpact.map((rawImpact: any, impactIdx: number) => {
                                  const impact = normalizeLegacyPricingImpact(rawImpact, 'addCents');
                                  const mode = impact.mode || 'addCents';
                                  // Read each mode's canonical cents field directly (no `??`
                                  // fallback chain) so the display never shows a stale amount.
                                  const flatCents = typeof impact.cents === 'number' ? impact.cents : null;
                                  const perUnitCents = typeof impact.centsPerUnit === 'number' ? impact.centsPerUnit : null;
                                  const percent = impact.percent ?? 0;
                                  const basis = impact.basis || 'base';
                                  const unit = impact.unit;
                                  const impactWarnings = getPricingImpactWarnings(impact);

                                  return (
                                    <div key={impactIdx} className="bg-[#0f172a] border border-slate-600 rounded p-2 space-y-2">
                                      <div className="flex items-start gap-2">
                                        <div className="flex-1 space-y-2">
                                          <div>
                                            <Label className="text-xs text-slate-500 mb-1 block">Type</Label>
                                            <Select
                                              value={mode}
                                              onValueChange={(newMode) => {
                                                // Re-shape the impact for the new type: preserve a
                                                // compatible amount and initialize required fields
                                                // (e.g. centsPerUnit + unit) so nothing is left missing.
                                                const updated = [...(choice.pricingImpact || [])];
                                                updated[impactIdx] = normalizePricingImpactForMode(updated[impactIdx], newMode);
                                                onUpdateChoice(option.id, choice.value, { pricingImpact: updated });
                                              }}
                                            >
                                              <SelectTrigger className="bg-[#0a0f1a] border-slate-700 text-slate-200 text-xs h-7">
                                                <SelectValue />
                                              </SelectTrigger>
                                              <SelectContent>
                                                <SelectItem value="addCents">Add Amount</SelectItem>
                                                <SelectItem value="addPercent">Add Percent</SelectItem>
                                                <SelectItem value="addPerUnit">Per Unit</SelectItem>
                                              </SelectContent>
                                            </Select>
                                          </div>

                                          {mode === 'addCents' && (
                                            <div>
                                              <Label className="text-xs text-slate-500 mb-1 block">Amount in $ (negative = discount)</Label>
                                              <MoneyInput
                                                ariaLabel="Pricing impact amount in dollars"
                                                cents={flatCents}
                                                onCommit={(val) => {
                                                  const updated = [...(choice.pricingImpact || [])];
                                                  updated[impactIdx] = { ...impact, cents: val };
                                                  onUpdateChoice(option.id, choice.value, { pricingImpact: updated });
                                                }}
                                                className="bg-[#0a0f1a] border-slate-700 text-slate-200 text-xs h-7"
                                              />
                                              <div className="text-xs text-slate-500 mt-0.5">
                                                {centsToCurrencyLabel(flatCents ?? 0)}
                                              </div>
                                            </div>
                                          )}

                                          {mode === 'addPercent' && (
                                            <>
                                              <div>
                                                <Label className="text-xs text-slate-500 mb-1 block">Percent (negative = discount)</Label>
                                                <Input
                                                  type="number"
                                                  step="0.01"
                                                  value={percent}
                                                  onChange={(e) => {
                                                    const val = parseFloat(e.target.value) || 0;
                                                    const updated = [...(choice.pricingImpact || [])];
                                                    updated[impactIdx] = { ...impact, percent: val };
                                                    onUpdateChoice(option.id, choice.value, { pricingImpact: updated });
                                                  }}
                                                  className="bg-[#0a0f1a] border-slate-700 text-slate-200 text-xs h-7"
                                                />
                                                <div className="text-xs text-slate-500 mt-0.5">
                                                  {percent >= 0 ? '+' : ''}{percent}%
                                                </div>
                                              </div>
                                              <div>
                                                <Label className="text-xs text-slate-500 mb-1 block">Basis</Label>
                                                <Select
                                                  value={basis}
                                                  onValueChange={(val) => {
                                                    const updated = [...(choice.pricingImpact || [])];
                                                    updated[impactIdx] = { ...impact, basis: val };
                                                    onUpdateChoice(option.id, choice.value, { pricingImpact: updated });
                                                  }}
                                                >
                                                  <SelectTrigger className="bg-[#0a0f1a] border-slate-700 text-slate-200 text-xs h-7">
                                                    <SelectValue />
                                                  </SelectTrigger>
                                                  <SelectContent>
                                                    <SelectItem value="base">Base Price</SelectItem>
                                                    <SelectItem value="lineSubtotal">Line Subtotal</SelectItem>
                                                    <SelectItem value="optionsSubtotal">Options Subtotal</SelectItem>
                                                  </SelectContent>
                                                </Select>
                                              </div>
                                            </>
                                          )}

                                          {mode === 'addPerUnit' && (
                                            <>
                                              <div>
                                                <Label className="text-xs text-slate-500 mb-1 block">Amount Per Unit ($)</Label>
                                                <MoneyInput
                                                  ariaLabel="Amount per unit in dollars"
                                                  cents={perUnitCents}
                                                  onCommit={(val) => {
                                                    const updated = [...(choice.pricingImpact || [])];
                                                    updated[impactIdx] = { ...impact, centsPerUnit: val };
                                                    onUpdateChoice(option.id, choice.value, { pricingImpact: updated });
                                                  }}
                                                  className="bg-[#0a0f1a] border-slate-700 text-slate-200 text-xs h-7"
                                                />
                                              </div>
                                              <div>
                                                <Label className="text-xs text-slate-500 mb-1 block">Unit</Label>
                                                <Select
                                                  value={unit}
                                                  onValueChange={(val) => {
                                                    const updated = [...(choice.pricingImpact || [])];
                                                    updated[impactIdx] = { ...impact, unit: val };
                                                    onUpdateChoice(option.id, choice.value, { pricingImpact: updated });
                                                  }}
                                                >
                                                  <SelectTrigger className="bg-[#0a0f1a] border-slate-700 text-slate-200 text-xs h-7">
                                                    <SelectValue />
                                                  </SelectTrigger>
                                                  <SelectContent>
                                                    <SelectItem value="perPiece">Per Piece</SelectItem>
                                                    <SelectItem value="perQty">Per Qty (alias)</SelectItem>
                                                    <SelectItem value="perSqft">Per Sqft</SelectItem>
                                                    <SelectItem value="perLinearFoot">Per Linear Foot</SelectItem>
                                                    <SelectItem value="perInch">Per Inch</SelectItem>
                                                  </SelectContent>
                                                </Select>
                                              </div>
                                            </>
                                          )}
                                        </div>

                                        <Button
                                          type="button"
                                          variant="ghost"
                                          size="sm"
                                          onClick={() => {
                                            const updated = [...(choice.pricingImpact || [])];
                                            updated.splice(impactIdx, 1);
                                            onUpdateChoice(option.id, choice.value, { pricingImpact: updated });
                                          }}
                                          className="text-red-400 hover:text-red-300 h-6 w-6 p-0 mt-4"
                                        >
                                          <Trash2 className="h-3 w-3" />
                                        </Button>
                                      </div>

                                      {(impactWarnings.type || impactWarnings.amount || impactWarnings.unit) ? (
                                        <div className="rounded border border-amber-500/30 bg-amber-500/10 px-2 py-1 text-[11px] text-amber-300 space-y-0.5">
                                          {impactWarnings.type ? <div>{impactWarnings.type}</div> : null}
                                          {impactWarnings.amount ? <div>{impactWarnings.amount}</div> : null}
                                          {impactWarnings.unit ? <div>{impactWarnings.unit}</div> : null}
                                        </div>
                                      ) : null}
                                    </div>
                                  );
                                })}
                              </div>
                            ) : (
                              <div className="text-xs text-slate-500 italic">No pricing impacts defined</div>
                            )}
                          </div>

                          <div className="mt-3 pt-3 border-t border-slate-700">
                            <div className="flex items-center justify-between mb-2">
                              <div>
                                <Label className="text-xs text-slate-400">Materials / Inventory</Label>
                                <p className="text-[11px] text-slate-500 mt-0.5">Planned material usage metadata for Prepress</p>
                              </div>
                              <Button
                                type="button"
                                size="sm"
                                variant="ghost"
                                onClick={() => {
                                  const currentConsumption = Array.isArray(choice.inventoryConsumption) ? choice.inventoryConsumption : [];
                                  onUpdateChoice(option.id, choice.value, {
                                    inventoryConsumption: [
                                      ...currentConsumption,
                                      {
                                        materialId: choice.materialOverride?.materialId?.trim() || "",
                                        quantityBasis: "area_sqft",
                                        multiplier: 1,
                                      },
                                    ],
                                  });
                                }}
                                className="h-6 text-xs text-slate-400 hover:text-slate-200"
                              >
                                <Plus className="h-3 w-3 mr-1" />
                                {choice.materialOverride?.materialId ? "Add Consumption Rule" : "Add Material"}
                              </Button>
                            </div>

                            {Array.isArray(choice.inventoryConsumption) && choice.inventoryConsumption.length > 0 ? (
                              <div className="space-y-2">
                                {choice.inventoryConsumption.map((entry: any, entryIdx: number) => {
                                  const basis = entry?.quantityBasis || "area_sqft";
                                  const materialOverrideId = choice.materialOverride?.materialId?.trim() || "";
                                  const materialIsSelectedByChoice = Boolean(materialOverrideId);
                                  const showFixedQty = basis === "fixed" || basis === "each";
                                  const rowKey = getRowKey(index, entryIdx);

                                  const updateEntry = (entryUpdates: Record<string, unknown>) => {
                                    const updated = [...(choice.inventoryConsumption || [])];
                                    updated[entryIdx] = { ...updated[entryIdx], ...entryUpdates };
                                    onUpdateChoice(option.id, choice.value, { inventoryConsumption: updated });
                                  };

                                  return (
                                    <div key={entryIdx} className="bg-[#0f172a] border border-slate-600 rounded p-2 space-y-2">
                                      <div className="flex items-start gap-2">
                                        <div className="flex-1 grid grid-cols-1 md:grid-cols-2 gap-2">
                                          <div>
                                            <Label className="text-xs text-slate-500 mb-1 block">Material {materialIsSelectedByChoice ? "(selected by choice)" : "ID *"}</Label>
                                            <MaterialIdSearchField
                                              value={materialOverrideId || entry?.materialId || ""}
                                              onChange={(nextMaterialId) => updateEntry({ materialId: nextMaterialId })}
                                              quantityBasis={basis as QuantityBasis}
                                              onRequestAddMaterial={() => {
                                                if (!canCreateMaterials) return;
                                                setAddMaterialTarget({ choiceIdx: index, entryIdx });
                                                setIsAddMaterialOpen(true);
                                              }}
                                              createdMaterialOverride={recentlyCreatedByRowKey[rowKey] ?? null}
                                              canCreateMaterials={canCreateMaterials}
                                              readOnly={materialIsSelectedByChoice}
                                            />
                                          </div>

                                          <div>
                                            <Label className="text-xs text-slate-500 mb-1 block">Quantity Basis</Label>
                                            <Select
                                              value={basis}
                                              onValueChange={(value) => {
                                                const nextBasis = value as "area_sqft" | "perimeter_ft" | "linear_ft" | "each" | "fixed";
                                                const next: Record<string, unknown> = { quantityBasis: nextBasis };
                                                if (nextBasis !== "fixed" && nextBasis !== "each") {
                                                  next.fixedQty = undefined;
                                                }
                                                updateEntry(next);
                                              }}
                                            >
                                              <SelectTrigger className="bg-[#0a0f1a] border-slate-700 text-slate-200 text-xs h-7">
                                                <SelectValue />
                                              </SelectTrigger>
                                              <SelectContent>
                                                {quantityBasisOptions.map((qb) => (
                                                  <SelectItem key={qb.value} value={qb.value}>{qb.label}</SelectItem>
                                                ))}
                                              </SelectContent>
                                            </Select>
                                          </div>

                                          <div>
                                            <Label className="text-xs text-slate-500 mb-1 block">Multiplier</Label>
                                            <Input
                                              type="number"
                                              step="0.01"
                                              min="0.01"
                                              value={entry?.multiplier ?? 1}
                                              onChange={(e) => {
                                                const val = Number(e.target.value);
                                                updateEntry({ multiplier: Number.isFinite(val) && val > 0 ? val : 1 });
                                              }}
                                              className="bg-[#0a0f1a] border-slate-700 text-slate-200 text-xs h-7"
                                            />
                                          </div>

                                          <div>
                                            <Label className="text-xs text-slate-500 mb-1 block">Waste % (optional)</Label>
                                            <Input
                                              type="number"
                                              step="0.01"
                                              min="0"
                                              max="100"
                                              value={entry?.wastePercent ?? ""}
                                              onChange={(e) => {
                                                const raw = e.target.value;
                                                if (raw === "") {
                                                  updateEntry({ wastePercent: undefined });
                                                  return;
                                                }
                                                const val = Number(raw);
                                                if (!Number.isFinite(val)) return;
                                                updateEntry({ wastePercent: Math.max(0, Math.min(100, val)) });
                                              }}
                                              className="bg-[#0a0f1a] border-slate-700 text-slate-200 text-xs h-7"
                                            />
                                          </div>

                                          {showFixedQty && (
                                            <div>
                                              <Label className="text-xs text-slate-500 mb-1 block">Fixed Qty {basis === "fixed" ? "*" : "(optional)"}</Label>
                                              <Input
                                                type="number"
                                                step="0.01"
                                                min="0"
                                                value={entry?.fixedQty ?? ""}
                                                onChange={(e) => {
                                                  const raw = e.target.value;
                                                  if (raw === "") {
                                                    updateEntry({ fixedQty: undefined });
                                                    return;
                                                  }
                                                  const val = Number(raw);
                                                  if (!Number.isFinite(val)) return;
                                                  updateEntry({ fixedQty: Math.max(0, val) });
                                                }}
                                                className="bg-[#0a0f1a] border-slate-700 text-slate-200 text-xs h-7"
                                              />
                                            </div>
                                          )}
                                        </div>

                                        <Button
                                          type="button"
                                          variant="ghost"
                                          size="sm"
                                          onClick={() => {
                                            const updated = [...(choice.inventoryConsumption || [])];
                                            updated.splice(entryIdx, 1);
                                            onUpdateChoice(option.id, choice.value, { inventoryConsumption: updated });
                                          }}
                                          className="text-red-400 hover:text-red-300 h-6 w-6 p-0 mt-1"
                                        >
                                          <Trash2 className="h-3 w-3" />
                                        </Button>
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            ) : (
                              <div className="text-xs text-slate-500 italic">No materials defined</div>
                            )}
                          </div>
                        </div>

                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => onDeleteChoice(option.id, choice.value)}
                          className="text-red-400 hover:text-red-300 hover:bg-red-500/10 mt-1"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {choices.length > 0 && (
              <div>
                <Label className="text-slate-300 mb-1.5 block">Default Choice</Label>
                <Select
                  value={defaultValue || '__none__'}
                  onValueChange={(value) => {
                    onUpdateOption(option.id, { defaultValue: value === '__none__' ? undefined : value });
                  }}
                >
                  <SelectTrigger className="bg-[#1e293b] border-slate-600 text-slate-100">
                    <SelectValue placeholder="No default" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">No default</SelectItem>
                    {choices.map((choice: any) => (
                      <SelectItem key={choice.value} value={choice.value}>
                        {choice.label || choice.value}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {hasInvalidDefault && (
                  <div className="flex items-center gap-1.5 mt-1 text-xs text-amber-400">
                    <AlertCircle className="h-3 w-3" />
                    Default points to deleted choice (cleared)
                  </div>
                )}
              </div>
            )}
          </div>
        </>
      )}

      <Separator className="bg-slate-700" />
      
      {/* Pricing Impact Section */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <Label className="text-slate-300">Pricing Impact</Label>
            <p className="text-xs text-slate-400 mt-0.5">
              {option.input?.type === 'select'
                ? 'Applies to every selected choice, including the default/NONE choice. Use the choice-level Pricing Impacts above for choice-specific charges.'
                : 'Add pricing rules that apply when this option is selected'}
            </p>
          </div>
          <Button
            type="button"
            onClick={() => {
              onAddPricingRule(option.id, { mode: 'addFlat', amountCents: 0, label: '' });
            }}
            size="sm"
            variant="outline"
            className="gap-1.5 text-xs"
          >
            <Plus className="h-3.5 w-3.5" />
            Add Pricing Rule
          </Button>
        </div>

        {nodeData?.pricingImpact && Array.isArray(nodeData.pricingImpact) && nodeData.pricingImpact.length > 0 && (
          <div className="space-y-2">
            {nodeData.pricingImpact.map((rule: any, index: number) => {
              const normalizedRule = normalizeLegacyPricingImpact(rule, 'addFlat', {
                settleBlankFormula: false,
              });
              const mode = normalizedRule.mode || 'addFlat';
              const cents = normalizedRule.amountCents ?? 0;
              const formula = typeof normalizedRule.formula === 'string' ? normalizedRule.formula : '';
              const label = rule.label || '';

              return (
                <div
                  key={index}
                  className="bg-[#1e293b] border border-slate-700 rounded-lg p-3 space-y-2"
                >
                  <div className="flex items-start gap-2">
                    <div className="flex-1 space-y-2">
                      <div>
                        <Label className="text-xs text-slate-400 mb-1 block">Mode</Label>
                        <Select
                          value={mode}
                          onValueChange={(value) => {
                            const updatedRules = [...(nodeData.pricingImpact || [])];
                            updatedRules[index] = normalizePricingImpactForMode(updatedRules[index], value);
                            onUpdateNodePricing(
                              option.id,
                              updatedRules.map((r: any) => normalizeLegacyPricingImpact(r, 'addFlat', {
                                settleBlankFormula: false,
                              }))
                            );
                          }}
                        >
                          <SelectTrigger className="bg-[#0f172a] border-slate-600 text-slate-100 text-sm">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="addFlat">Add Flat Amount</SelectItem>
                            <SelectItem value="addPerQty">Add Per Quantity</SelectItem>
                            <SelectItem value="addPerSqft">Add Per Square Foot</SelectItem>
                            <SelectItem value="addFormula">Formula</SelectItem>
                          </SelectContent>
                        </Select>
                        <div className="text-xs text-slate-400 mt-1">
                          {mode === 'addFlat' && '• Adds a fixed amount once'}
                          {mode === 'addPerQty' && '• Multiplies by quantity'}
                          {mode === 'addPerSqft' && '• Multiplies by square footage (width × height ÷ 144)'}
                        </div>
                      </div>

                      {mode === 'addFormula' ? (
                        <div>
                          <Label className="text-xs text-slate-400 mb-1 block">Formula ($)</Label>
                          <FormulaInput
                            formula={formula}
                            onCommit={(nextFormula) => {
                              const updatedRules = [...(nodeData.pricingImpact || [])];
                              updatedRules[index] = { ...normalizedRule, formula: nextFormula };
                              onUpdateNodePricing(
                                option.id,
                                updatedRules.map((r: any) => normalizeLegacyPricingImpact(r, 'addFlat', {
                                  settleBlankFormula: false,
                                }))
                              );
                            }}
                            placeholder="custom_grommet_qty * 0.25 * q"
                            className="bg-[#0f172a] border-slate-600 text-slate-100 text-sm font-mono"
                          />
                          <div className="text-xs text-slate-400 mt-1">
                            Numeric option selection keys and labels are available as formula variables.
                          </div>
                        </div>
                      ) : (
                      <div>
                        <Label className="text-xs text-slate-400 mb-1 block">Amount ($)</Label>
                        <Input
                          type="number"
                          step="0.01"
                          value={cents === 0 ? '' : centsToCurrencyInput(cents)}
                          onChange={(e) => {
                            const value = e.target.value;
                            if (value === '') return; // Don't update while empty
                            
                            const updatedRules = [...(nodeData.pricingImpact || [])];
                            updatedRules[index] = { ...normalizedRule, amountCents: currencyInputToCents(value) ?? 0 };
                            onUpdateNodePricing(
                              option.id,
                              updatedRules.map((r: any) => normalizeLegacyPricingImpact(r, 'addFlat'))
                            );
                          }}
                          onBlur={(e) => {
                            const value = e.target.value;
                            if (value === '') {
                              // Clear to 0 on blur if empty
                              const updatedRules = [...(nodeData.pricingImpact || [])];
                              updatedRules[index] = { ...normalizedRule, amountCents: 0 };
                              onUpdateNodePricing(
                                option.id,
                                updatedRules.map((r: any) => normalizeLegacyPricingImpact(r, 'addFlat'))
                              );
                            }
                          }}
                          placeholder="0.00"
                          className="bg-[#0f172a] border-slate-600 text-slate-100 text-sm"
                        />
                        <div className="text-xs text-slate-400 mt-1">
                          {centsToCurrencyLabel(cents || 0)}
                        </div>
                      </div>
                      )}

                      <div>
                        <Label className="text-xs text-slate-400 mb-1 block">Label (optional)</Label>
                        <Input
                          type="text"
                          value={label}
                          onChange={(e) => {
                            const updatedRules = [...(nodeData.pricingImpact || [])];
                            updatedRules[index] = { ...normalizedRule, label: e.target.value };
                            onUpdateNodePricing(
                              option.id,
                              updatedRules.map((r: any) => normalizeLegacyPricingImpact(r, 'addFlat'))
                            );
                          }}
                          placeholder="e.g., Setup fee"
                          className="bg-[#0f172a] border-slate-600 text-slate-100 text-sm"
                        />
                      </div>
                    </div>

                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => onDeletePricingRule(option.id, index)}
                      className="text-red-400 hover:text-red-300 hover:bg-red-500/10 mt-1"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {(hasEmptyLabels || hasEmptyValues || duplicateValues.size > 0) && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 space-y-1">
          <div className="text-sm font-medium text-red-300">Validation Issues</div>
          {hasEmptyLabels && <div className="text-xs text-red-400">• Some choices have empty labels</div>}
          {hasEmptyValues && <div className="text-xs text-red-400">• Some choices have empty values</div>}
          {duplicateValues.size > 0 && <div className="text-xs text-red-400">• Duplicate choice values detected</div>}
        </div>
      )}

      {canCreateMaterials ? (
        <CreateMaterialDialog
          open={isAddMaterialOpen}
          onOpenChange={setIsAddMaterialOpen}
          hideTrigger
          onCreated={async (material) => {
            const target = addMaterialTarget;
            if (!target || !material?.id) {
              setAddMaterialTarget(null);
              return;
            }

            const targetChoice = choices[target.choiceIdx];
            if (!targetChoice) {
              setAddMaterialTarget(null);
              return;
            }

            const currentConsumption = Array.isArray(targetChoice.inventoryConsumption) ? targetChoice.inventoryConsumption : [];
            const nextConsumption = [...currentConsumption];
            if (!nextConsumption[target.entryIdx]) {
              setAddMaterialTarget(null);
              return;
            }

            nextConsumption[target.entryIdx] = {
              ...nextConsumption[target.entryIdx],
              materialId: material.id,
            };

            onUpdateChoice(option.id, targetChoice.value, { inventoryConsumption: nextConsumption });

            const rowKey = getRowKey(target.choiceIdx, target.entryIdx);
            setRecentlyCreatedByRowKey((prev) => ({
              ...prev,
              [rowKey]: {
                id: material.id,
                name: material.name,
                inventoryUnit: material.inventoryUnit || '',
                consumptionUnit: material.inventoryUnit || '',
                isActive: true,
              },
            }));

            await queryClient.invalidateQueries({ queryKey: ['/api/materials'] });
            setAddMaterialTarget(null);
          }}
        />
      ) : null}
    </div>
  );
}

function MaterialIdSearchField({
  value,
  onChange,
  quantityBasis,
  onRequestAddMaterial,
  createdMaterialOverride,
  canCreateMaterials,
  showUsageValidation = true,
  readOnly = false,
}: {
  value: string;
  onChange: (materialId: string) => void;
  quantityBasis?: QuantityBasis;
  onRequestAddMaterial: () => void;
  createdMaterialOverride?: MaterialSearchItem | null;
  canCreateMaterials: boolean;
  showUsageValidation?: boolean;
  readOnly?: boolean;
}) {
  const [open, setOpen] = React.useState(false);
  const [searchText, setSearchText] = React.useState('');

  const materialsQuery = useMaterialsSearch(searchText, { limit: MATERIAL_DROPDOWN_RESULT_LIMIT, includeInactive: false });
  const searchResults = materialsQuery.data || [];

  const selectedInResults = React.useMemo(
    () => searchResults.find((m) => m.id === value),
    [searchResults, value]
  );

  // Resolve saved IDs that are not present in current search results.
  const materialByIdQuery = useMaterial(value && !selectedInResults ? value : undefined);
  const resolvedById = materialByIdQuery.data;

  const selectedFromOverride = createdMaterialOverride && createdMaterialOverride.id === value
    ? createdMaterialOverride
    : null;

  const resolvedIsActive = resolvedById && typeof resolvedById === 'object' && 'isActive' in resolvedById
    ? (resolvedById as { isActive?: boolean }).isActive !== false
    : true;

  const selectedMaterial = selectedInResults || selectedFromOverride || (resolvedById
    ? {
        id: resolvedById.id,
        name: resolvedById.name,
        inventoryUnit: resolvedById.inventoryUnit,
        consumptionUnit: resolvedById.consumptionUnit,
        materialForm: resolvedById.materialForm,
        weightValue: resolvedById.weightValue ?? null,
        weightUnit: resolvedById.weightUnit ?? null,
        weightBasis: resolvedById.weightBasis ?? null,
        weightOzPerBasis: resolvedById.weightOzPerBasis ?? null,
        isActive: resolvedIsActive,
      }
    : null);

  const isMissingMaterial = !!value && !selectedMaterial && !materialByIdQuery.isLoading;

  const impliedUom = quantityBasis ? impliedUomForBasis(quantityBasis) : null;
  const selectedMaterialUom = normalizeMaterialUom(selectedMaterial?.consumptionUnit);
  const hasUomMismatch =
    showUsageValidation &&
    !!selectedMaterial &&
    !!selectedMaterialUom &&
    !!impliedUom &&
    selectedMaterialUom !== impliedUom &&
    !(selectedMaterial.materialForm === 'roll' &&
      ((selectedMaterialUom === 'square_foot' && impliedUom === 'linear_foot') ||
        (selectedMaterialUom === 'linear_foot' && impliedUom === 'square_foot')));

  if (readOnly) {
    return (
      <div className="space-y-1 rounded border border-slate-700 bg-[#0a0f1a] px-2 py-1.5 text-xs text-slate-200">
        <div className="truncate">{selectedMaterial ? selectedMaterial.name ?? '—' : value ? `Missing material (${value})` : 'No material selected'}</div>
        <div className="text-[10px] text-slate-500">Selected by this Option Choice</div>
        {hasUomMismatch ? (
          <div className="text-[10px] text-amber-300 flex items-center gap-1">
            <AlertCircle className="h-3 w-3" />
            Warning: Material unit is &lt;{selectedMaterialUom}&gt; but this rule consumes &lt;{impliedUom}&gt;. Check quantity basis.
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div className="space-y-1">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            role="combobox"
            aria-expanded={open}
            className="w-full justify-between bg-[#0a0f1a] border-slate-700 text-slate-200 text-xs h-7"
          >
            <span className="truncate text-left">
              {selectedMaterial
                ? (selectedMaterial.name ?? '—')
                : value
                  ? `Missing material (${value})`
                  : 'None selected'}
            </span>
            <ChevronsUpDown className="ml-2 h-3 w-3 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[420px] max-w-[calc(100vw-2rem)] overflow-hidden p-0" align="start">
          <Command className="max-h-[420px]">
            <CommandInput
              placeholder="Search materials by name or SKU..."
              value={searchText}
              onValueChange={setSearchText}
            />
            <CommandList className={MATERIAL_COMMAND_LIST_CLASS}>
              <CommandEmpty>
                {materialsQuery.isLoading ? 'Searching materials...' : 'No materials found'}
              </CommandEmpty>
              {searchResults.map((material) => (
                <CommandItem
                  key={material.id}
                  value={`${material.name} ${material.id} ${material.consumptionUnit || material.inventoryUnit}`}
                  onSelect={() => {
                    onChange(material.id);
                    setOpen(false);
                  }}
                  className="text-xs"
                >
                  <Check
                    className={cn('mr-2 h-3 w-3', value === material.id ? 'opacity-100' : 'opacity-0')}
                  />
                  <div className="flex items-center justify-between w-full gap-2">
                    <span className="truncate">{material.name}</span>
                    <span className="text-[10px] text-slate-500 whitespace-nowrap">{material.consumptionUnit || material.inventoryUnit}</span>
                  </div>
                </CommandItem>
              ))}
              {canCreateMaterials ? (
                <>
                  <CommandSeparator />
                  <CommandItem
                    value="__add_new_material__"
                    onSelect={() => {
                      setOpen(false);
                      onRequestAddMaterial();
                    }}
                    className="text-xs"
                  >
                    <Plus className="mr-2 h-3 w-3" />
                    <div className="flex flex-col">
                      <span>+ Add new material</span>
                      <span className="text-[10px] text-slate-500">Create a material and select it</span>
                    </div>
                  </CommandItem>
                </>
              ) : null}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>

      <div className="text-[10px] text-slate-500 flex items-center gap-2">
        <span>ID: {selectedMaterial?.id ?? '—'}</span>
        <span>Consumption unit: {selectedMaterial?.consumptionUnit ?? '—'}</span>
        {selectedMaterial && !selectedMaterial.isActive ? (
          <span className="text-amber-300">Inactive material</span>
        ) : null}
      </div>

      {selectedMaterial ? (
        <div className={cn(
          "text-[10px]",
          formatMaterialWeightStatus(selectedMaterial) === "Weight not configured" ? "text-amber-300" : "text-emerald-300"
        )}>
          {formatMaterialWeightStatus(selectedMaterial)}
        </div>
      ) : null}

      {isMissingMaterial ? (
        <div className="text-[10px] text-amber-300 flex items-center gap-1">
          <AlertCircle className="h-3 w-3" />
          Material reference missing. Saved ID retained: {value}
        </div>
      ) : null}

      {hasUomMismatch ? (
        <div className="text-[10px] text-amber-300 flex items-center gap-1">
          <AlertCircle className="h-3 w-3" />
          Warning: Material unit is &lt;{selectedMaterialUom}&gt; but this rule consumes &lt;{impliedUom}&gt;. Check configuration.
        </div>
      ) : null}
    </div>
  );
}
