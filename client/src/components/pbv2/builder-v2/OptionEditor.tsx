import React from 'react';
import { Plus, Settings, GripVertical, Trash2, ChevronDown, ChevronRight, GitBranch, ChevronUp, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { EditorOptionGroup, EditorOption } from '@/lib/pbv2/pbv2ViewModel';
import { OptionDetailsEditor } from './OptionDetailsEditor';

interface OptionEditorProps {
  selectedGroup: EditorOptionGroup | undefined;
  options: Record<string, EditorOption>;
  selectedOptionId: string | null;
  onSelectOption: (optionId: string | null) => void;
  onAddOption: (groupId: string) => void;
  onDeleteOption: (groupId: string, optionId: string) => void;
  onUpdateGroup: (groupId: string, updates: Partial<EditorOptionGroup>) => void;
  onUpdateOption: (optionId: string, updates: any) => void;
  onAddChoice: (optionId: string) => void;
  onUpdateChoice: (optionId: string, choiceValue: string, updates: any) => void;
  onDeleteChoice: (optionId: string, choiceValue: string) => void;
  onReorderChoice: (optionId: string, fromIndex: number, toIndex: number) => void;
  onUpdateNodePricing: (optionId: string, pricingImpact: Array<{ mode: 'addFlatCents' | 'addPerQtyCents' | 'addPerSqftCents'; cents: number; label?: string }>) => void;
  onAddPricingRule: (optionId: string, rule: { mode: 'addFlatCents' | 'addPerQtyCents' | 'addPerSqftCents'; cents: number; label?: string }) => void;
  onDeletePricingRule: (optionId: string, ruleIndex: number) => void;
  treeJson: any;
}

export function OptionEditor({
  selectedGroup,
  options,
  selectedOptionId,
  onSelectOption,
  onAddOption,
  onDeleteOption,
  onUpdateGroup,
  onUpdateOption,
  onAddChoice,
  onUpdateChoice,
  onDeleteChoice,
  onReorderChoice,
  onUpdateNodePricing,
  onAddPricingRule,
  onDeletePricingRule,
  treeJson
}: OptionEditorProps) {
  const [expandedOptions, setExpandedOptions] = React.useState<Set<string>>(new Set());
  const [editingChoiceValue, setEditingChoiceValue] = React.useState<{ optionId: string; value: string } | null>(null);

  const toggleOption = (optionId: string) => {
    const newExpanded = new Set(expandedOptions);
    if (newExpanded.has(optionId)) {
      newExpanded.delete(optionId);
      onSelectOption(null);
    } else {
      newExpanded.add(optionId);
      onSelectOption(optionId);
    }
    setExpandedOptions(newExpanded);
  };

  if (!selectedGroup) {
    return (
      <div className="flex items-center justify-center h-full text-slate-400 bg-[#0a0e1a]">
        <div className="text-center">
          <Settings className="h-12 w-12 mx-auto mb-3 text-slate-600" />
          <p>Select an option group to begin editing</p>
        </div>
      </div>
    );
  }

  const groupOptions = selectedGroup.optionIds.map(id => options[id]).filter(Boolean);

  return (
    <div className="w-full flex flex-col">
      <div className="border-b border-[#334155] p-6 bg-[#0a0e1a]">
        <div className="flex items-start justify-between mb-4">
          <div className="flex-1">
            <Input
              value={selectedGroup.name}
              onChange={(e) => onUpdateGroup(selectedGroup.id, { name: e.target.value })}
              className="text-lg font-semibold mb-2 border-transparent hover:border-slate-600 focus:border-blue-500 px-2 -ml-2 bg-transparent text-slate-100"
            />
            <Textarea
              value={selectedGroup.description}
              onChange={(e) => onUpdateGroup(selectedGroup.id, { description: e.target.value })}
              placeholder="Group description..."
              className="text-sm text-slate-300 min-h-[60px] border-transparent hover:border-slate-600 focus:border-blue-500 bg-transparent resize-none"
            />
          </div>
        </div>

        <div className="flex items-center gap-8">
          <div className="flex items-center gap-2.5">
            <Switch
              id="required"
              checked={selectedGroup.isRequired}
              onCheckedChange={(checked) =>
                onUpdateGroup(selectedGroup.id, { isRequired: checked })
              }
            />
            <Label htmlFor="required" className="text-sm font-medium cursor-pointer text-slate-200">
              Required Group
            </Label>
          </div>
          <div className="flex items-center gap-2.5">
            <Switch
              id="multiselect"
              checked={selectedGroup.isMultiSelect}
              onCheckedChange={(checked) =>
                onUpdateGroup(selectedGroup.id, { isMultiSelect: checked })
              }
            />
            <Label htmlFor="multiselect" className="text-sm font-medium cursor-pointer text-slate-200">
              Multi-select
            </Label>
          </div>
        </div>
      </div>

      <div className="p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-slate-200 uppercase tracking-wide">Options</h3>
          <Button
            onClick={() => onAddOption(selectedGroup.id)}
            size="sm"
            className="gap-2 bg-blue-600 hover:bg-blue-700 text-white shadow-sm"
          >
            <Plus className="h-4 w-4" />
            Add Option
          </Button>
        </div>

        <div className="space-y-3">
            {groupOptions.map((option) => {
              if (!option) return null;
              
              const isExpanded = expandedOptions.has(option.id);
              const hasPricing = option.hasPricing;
              const hasFlags = option.hasProductionFlags;
              const hasConditions = option.hasConditionals;
              const hasWeight = option.hasWeight;

              return (
                <div
                  key={option.id}
                  className={`bg-[#1e293b] border rounded-lg overflow-hidden transition-all duration-150 ${
                    isExpanded
                      ? 'border-blue-500/50 shadow-sm'
                      : 'border-slate-700 hover:border-slate-600'
                  }`}
                >
                  <div className="flex items-center p-3.5 hover:bg-slate-800/20 transition-colors">
                    <GripVertical className="h-4 w-4 text-slate-500 mr-2.5 flex-shrink-0 opacity-60" />

                    <button
                      type="button"
                      onClick={() => toggleOption(option.id)}
                      className="flex items-center flex-1 gap-3 text-left"
                    >
                      {isExpanded ? (
                        <ChevronDown className="h-4 w-4 text-blue-400 flex-shrink-0 transition-transform" />
                      ) : (
                        <ChevronRight className="h-4 w-4 text-slate-400 flex-shrink-0 transition-transform" />
                      )}

                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="font-medium text-slate-100 text-sm">
                            {option.name}
                          </span>
                          {hasConditions && !isExpanded && (
                            <GitBranch className="h-3.5 w-3.5 text-amber-400/60" />
                          )}
                        </div>
                        {option.description && (
                          <div className="text-xs text-slate-400 truncate">
                            {option.description}
                          </div>
                        )}
                        <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                          <Badge variant="outline" className="text-[10px] bg-slate-800/50 text-slate-300 border-slate-600 px-1.5 py-0 h-5">
                            {option.type}
                          </Badge>
                          {option.isDefault && (
                            <Badge variant="outline" className="text-[10px] bg-blue-500/10 text-blue-400 border-blue-500/40 px-1.5 py-0 h-5">
                              Default
                            </Badge>
                          )}
                          {option.isRequired && (
                            <Badge variant="outline" className="text-[10px] bg-red-500/10 text-red-400 border-red-500/40 px-1.5 py-0 h-5">
                              Required
                            </Badge>
                          )}
                          {hasPricing && (
                            <Badge variant="outline" className="text-[10px] bg-emerald-500/10 text-emerald-400 border-emerald-500/40 px-1.5 py-0 h-5">
                              Pricing
                            </Badge>
                          )}
                          {hasFlags && (
                            <Badge variant="outline" className="text-[10px] bg-cyan-500/10 text-cyan-400 border-cyan-500/40 px-1.5 py-0 h-5">
                              Production
                            </Badge>
                          )}
                          {hasConditions && (
                            <Badge variant="outline" className="text-[10px] bg-amber-500/10 text-amber-400 border-amber-500/40 px-1.5 py-0 h-5">
                              Conditional
                            </Badge>
                          )}
                          {hasWeight && (
                            <Badge variant="outline" className="text-xs bg-purple-500/10 text-purple-400 border-purple-500/40 px-1.5 py-0">
                              Weight
                            </Badge>
                          )}
                        </div>
                      </div>
                    </button>

                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => onDeleteOption(selectedGroup.id, option.id)}
                      className="ml-2 text-red-400 hover:text-red-300 hover:bg-red-500/10"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>

                  {isExpanded && (
                    <>
                      <Separator className="bg-[#334155]" />
                      <div className="p-4 bg-[#0f172a] space-y-4">
                        <OptionDetailsEditor
                          option={option}
                          treeJson={treeJson}
                          onUpdateOption={onUpdateOption}
                          onAddChoice={onAddChoice}
                          onUpdateChoice={onUpdateChoice}
                          onDeleteChoice={onDeleteChoice}
                          onReorderChoice={onReorderChoice}
                          onUpdateNodePricing={onUpdateNodePricing}
                          onAddPricingRule={onAddPricingRule}
                          onDeletePricingRule={onDeletePricingRule}
                          editingChoiceValue={editingChoiceValue}
                          setEditingChoiceValue={setEditingChoiceValue}
                        />
                      </div>
                    </>
                  )}
                </div>
              );
            })}
        </div>
      </div>
    </div>
  );
}


