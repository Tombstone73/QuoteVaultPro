import React from 'react';
import { Plus, ChevronDown, ChevronUp, AlertCircle, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Separator } from '@/components/ui/separator';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { EditorOption } from '@/lib/pbv2/pbv2ViewModel';

interface OptionDetailsEditorProps {
  option: EditorOption;
  treeJson: any;
  onUpdateOption: (optionId: string, updates: any) => void;
  onAddChoice: (optionId: string) => void;
  onUpdateChoice: (optionId: string, choiceValue: string, updates: any) => void;
  onDeleteChoice: (optionId: string, choiceValue: string) => void;
  onReorderChoice: (optionId: string, fromIndex: number, toIndex: number) => void;
  onUpdateNodePricing: (optionId: string, pricingImpact: Array<{ mode: 'addFlatCents' | 'addPerQtyCents' | 'addPerSqftCents'; cents: number; label?: string }>) => void;
  onAddPricingRule: (optionId: string, rule: { mode: 'addFlatCents' | 'addPerQtyCents' | 'addPerSqftCents'; cents: number; label?: string }) => void;
  onDeletePricingRule: (optionId: string, ruleIndex: number) => void;
  editingChoiceValue: { optionId: string; value: string } | null;
  setEditingChoiceValue: (val: { optionId: string; value: string } | null) => void;
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
  // Get actual node data from tree
  const nodeData = React.useMemo(() => {
    const nodes = treeJson?.nodes || [];
    return nodes.find((n: any) => n.id === option.id);
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
                  const isEditing = editingChoiceValue?.optionId === option.id && editingChoiceValue?.value === choice.value;

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
                                    value={choice.value}
                                    onChange={(e) => {
                                      const newValue = e.target.value;
                                      setEditingChoiceValue({ optionId: option.id, value: newValue });
                                    }}
                                    onBlur={() => {
                                      if (editingChoiceValue) {
                                        onUpdateChoice(option.id, choice.value, { value: editingChoiceValue.value });
                                        setEditingChoiceValue(null);
                                      }
                                    }}
                                    onKeyDown={(e) => {
                                      if (e.key === 'Enter' && editingChoiceValue) {
                                        onUpdateChoice(option.id, choice.value, { value: editingChoiceValue.value });
                                        setEditingChoiceValue(null);
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
                                      if (editingChoiceValue) {
                                        onUpdateChoice(option.id, choice.value, { value: editingChoiceValue.value });
                                        setEditingChoiceValue(null);
                                      }
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
                                    onClick={() => setEditingChoiceValue({ optionId: option.id, value: choice.value })}
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

                          <div>
                            <Label className="text-xs text-slate-400 mb-1 block">Price Delta (cents)</Label>
                            <Input
                              type="number"
                              value={choice.priceDeltaCents ?? ''}
                              onChange={(e) => {
                                const value = e.target.value;
                                onUpdateChoice(option.id, choice.value, {
                                  priceDeltaCents: value === '' ? undefined : parseInt(value, 10) || 0
                                });
                              }}
                              onBlur={(e) => {
                                const value = e.target.value;
                                if (value === '') {
                                  onUpdateChoice(option.id, choice.value, { priceDeltaCents: undefined });
                                }
                              }}
                              placeholder="0 (optional)"
                              className="bg-[#0f172a] border-slate-600 text-slate-100 text-sm"
                            />
                            {choice.priceDeltaCents !== undefined && choice.priceDeltaCents !== null && (
                              <div className="text-xs text-slate-400 mt-1">
                                {choice.priceDeltaCents >= 0 ? '+' : ''}${((choice.priceDeltaCents || 0) / 100).toFixed(2)}
                              </div>
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
            <p className="text-xs text-slate-400 mt-0.5">Add pricing rules that apply when this option is selected</p>
          </div>
          <Button
            type="button"
            onClick={() => {
              onAddPricingRule(option.id, { mode: 'addFlatCents', cents: 0, label: '' });
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
              const mode = rule.mode || 'addFlatCents';
              const cents = rule.amountCents ?? 0;
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
                            updatedRules[index] = { ...updatedRules[index], mode: value };
                            onUpdateNodePricing(
                              option.id,
                              updatedRules.map((r: any) => ({
                                mode: r.mode || 'addFlatCents',
                                cents: r.amountCents ?? 0,
                                label: r.label,
                              }))
                            );
                          }}
                        >
                          <SelectTrigger className="bg-[#0f172a] border-slate-600 text-slate-100 text-sm">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="addFlatCents">Add Flat Amount</SelectItem>
                            <SelectItem value="addPerQtyCents">Add Per Quantity</SelectItem>
                            <SelectItem value="addPerSqftCents">Add Per Square Foot</SelectItem>
                          </SelectContent>
                        </Select>
                        <div className="text-xs text-slate-400 mt-1">
                          {mode === 'addFlatCents' && '• Adds a fixed amount once'}
                          {mode === 'addPerQtyCents' && '• Multiplies by quantity'}
                          {mode === 'addPerSqftCents' && '• Multiplies by square footage (width × height ÷ 144)'}
                        </div>
                      </div>

                      <div>
                        <Label className="text-xs text-slate-400 mb-1 block">Amount (cents)</Label>
                        <Input
                          type="number"
                          value={cents === 0 ? '' : cents}
                          onChange={(e) => {
                            const value = e.target.value;
                            if (value === '') return; // Don't update while empty
                            
                            const updatedRules = [...(nodeData.pricingImpact || [])];
                            updatedRules[index] = { ...updatedRules[index], amountCents: parseInt(value, 10) || 0 };
                            onUpdateNodePricing(
                              option.id,
                              updatedRules.map((r: any) => ({
                                mode: r.mode || 'addFlatCents',
                                cents: r.amountCents ?? 0,
                                label: r.label,
                              }))
                            );
                          }}
                          onBlur={(e) => {
                            const value = e.target.value;
                            if (value === '') {
                              // Clear to 0 on blur if empty
                              const updatedRules = [...(nodeData.pricingImpact || [])];
                              updatedRules[index] = { ...updatedRules[index], amountCents: 0 };
                              onUpdateNodePricing(
                                option.id,
                                updatedRules.map((r: any) => ({
                                  mode: r.mode || 'addFlatCents',
                                  cents: r.amountCents ?? 0,
                                  label: r.label,
                                }))
                              );
                            }
                          }}
                          placeholder="0"
                          className="bg-[#0f172a] border-slate-600 text-slate-100 text-sm"
                        />
                        <div className="text-xs text-slate-400 mt-1">
                          ${((cents || 0) / 100).toFixed(2)}
                        </div>
                      </div>

                      <div>
                        <Label className="text-xs text-slate-400 mb-1 block">Label (optional)</Label>
                        <Input
                          type="text"
                          value={label}
                          onChange={(e) => {
                            const updatedRules = [...(nodeData.pricingImpact || [])];
                            updatedRules[index] = { ...updatedRules[index], label: e.target.value };
                            onUpdateNodePricing(
                              option.id,
                              updatedRules.map((r: any) => ({
                                mode: r.mode || 'addFlatCents',
                                cents: r.amountCents ?? 0,
                                label: r.label,
                              }))
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
    </div>
  );
}
