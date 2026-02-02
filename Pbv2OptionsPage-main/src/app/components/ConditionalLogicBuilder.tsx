import React from 'react';
import { Plus, X, AlertCircle } from 'lucide-react';
import { Button } from '@/app/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/app/components/ui/select';
import { Input } from '@/app/components/ui/input';
import type { Option, Product, ConditionalLogic, Condition } from '@/app/types';

interface ConditionalLogicBuilderProps {
  option: Option;
  groupId: string;
  product: Product;
  onUpdateOption: (groupId: string, optionId: string, updates: Partial<Option>) => void;
}

export function ConditionalLogicBuilder({
  option,
  groupId,
  product,
  onUpdateOption
}: ConditionalLogicBuilderProps) {
  const allOtherOptions = product.optionGroups
    .flatMap(group => 
      group.options
        .filter(opt => opt.id !== option.id)
        .map(opt => ({
          id: opt.id,
          name: opt.name,
          groupName: group.name
        }))
    );

  const addCondition = () => {
    const newCondition: Condition = {
      targetOptionId: '',
      operator: 'equals',
      value: 'selected'
    };

    const logic: ConditionalLogic = option.conditionalLogic || {
      operator: 'and',
      conditions: []
    };

    onUpdateOption(groupId, option.id, {
      conditionalLogic: {
        ...logic,
        conditions: [...logic.conditions, newCondition]
      }
    });
  };

  const removeCondition = (index: number) => {
    if (!option.conditionalLogic) return;
    
    const conditions = option.conditionalLogic.conditions.filter((_, i) => i !== index);
    
    if (conditions.length === 0) {
      onUpdateOption(groupId, option.id, { conditionalLogic: null });
    } else {
      onUpdateOption(groupId, option.id, {
        conditionalLogic: {
          ...option.conditionalLogic,
          conditions
        }
      });
    }
  };

  const updateCondition = (index: number, updates: Partial<Condition>) => {
    if (!option.conditionalLogic) return;

    const conditions = option.conditionalLogic.conditions.map((c, i) =>
      i === index ? { ...c, ...updates } : c
    );

    onUpdateOption(groupId, option.id, {
      conditionalLogic: {
        ...option.conditionalLogic,
        conditions
      }
    });
  };

  const toggleOperator = () => {
    if (!option.conditionalLogic) return;

    onUpdateOption(groupId, option.id, {
      conditionalLogic: {
        ...option.conditionalLogic,
        operator: option.conditionalLogic.operator === 'and' ? 'or' : 'and'
      }
    });
  };

  const getOptionLabel = (optionId: string) => {
    const opt = allOtherOptions.find(o => o.id === optionId);
    return opt ? `${opt.groupName} → ${opt.name}` : 'Select option...';
  };

  const hasIncompleteConditions = option.conditionalLogic?.conditions.some(
    c => !c.targetOptionId
  );

  return (
    <div className="space-y-3">
      <div className="text-slate-300">
        This option will only appear when the following conditions are met:
      </div>

      {option.conditionalLogic && option.conditionalLogic.conditions.length > 0 ? (
        <div className="space-y-3">
          {option.conditionalLogic.conditions.map((condition, index) => (
            <div key={index} className="space-y-2">
              {index > 0 && (
                <div className="flex items-center gap-2">
                  <div className="h-px bg-[#334155] flex-1" />
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={toggleOperator}
                    className="text-xs px-3 py-1 h-auto bg-slate-800 border-slate-600 text-slate-300 hover:bg-slate-700"
                  >
                    {option.conditionalLogic.operator.toUpperCase()}
                  </Button>
                  <div className="h-px bg-[#334155] flex-1" />
                </div>
              )}

              <div className="flex items-start gap-2 p-3 bg-amber-500/10 border border-amber-500/30 rounded-lg">
                <div className="flex-1 space-y-2">
                  <Select
                    value={condition.targetOptionId}
                    onValueChange={(value) => 
                      updateCondition(index, { targetOptionId: value })
                    }
                  >
                    <SelectTrigger className="bg-[#1e293b] border-[#334155] text-slate-100">
                      <SelectValue placeholder="Select an option..." />
                    </SelectTrigger>
                    <SelectContent>
                      {allOtherOptions.map((opt) => (
                        <SelectItem key={opt.id} value={opt.id}>
                          {opt.groupName} → {opt.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>

                  <div className="flex items-center gap-2">
                    <Select
                      value={condition.operator}
                      onValueChange={(value: any) => 
                        updateCondition(index, { operator: value })
                      }
                    >
                      <SelectTrigger className="bg-[#1e293b] border-[#334155] text-slate-100 w-[160px]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="equals">Equals</SelectItem>
                        <SelectItem value="not-equals">Not Equals</SelectItem>
                        <SelectItem value="includes">Includes</SelectItem>
                        <SelectItem value="greater-than">Greater Than</SelectItem>
                        <SelectItem value="less-than">Less Than</SelectItem>
                      </SelectContent>
                    </Select>

                    <Input
                      value={condition.value}
                      onChange={(e) => 
                        updateCondition(index, { value: e.target.value })
                      }
                      placeholder="Value..."
                      className="bg-[#1e293b] border-[#334155] text-slate-100 flex-1"
                    />
                  </div>

                  {condition.targetOptionId && (
                    <div className="text-xs text-amber-300 flex items-start gap-1.5">
                      <AlertCircle className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" />
                      <span>
                        Show "{option.name}" when "{getOptionLabel(condition.targetOptionId)}" 
                        {' '}{condition.operator.replace('-', ' ')}{' '}
                        "{condition.value}"
                      </span>
                    </div>
                  )}
                </div>

                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => removeCondition(index)}
                  className="text-red-400 hover:text-red-300 hover:bg-red-500/10"
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            </div>
          ))}

          {hasIncompleteConditions && (
            <div className="flex items-start gap-2 p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-red-300">
              <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
              <span>Some conditions are incomplete. Please select a target option for all conditions.</span>
            </div>
          )}
        </div>
      ) : (
        <div className="text-slate-300 p-3 bg-slate-800/20 border border-slate-600/40 rounded-lg">
          Always available (no conditions)
        </div>
      )}

      <Button
        onClick={addCondition}
        variant="outline"
        size="sm"
        className="w-full gap-2 bg-slate-800 border-slate-600 text-slate-300 hover:bg-slate-700"
      >
        <Plus className="h-4 w-4" />
        Add Condition
      </Button>

      {option.conditionalLogic && option.conditionalLogic.conditions.length > 1 && (
        <div className="text-xs text-slate-300 p-2 bg-blue-500/10 border border-blue-500/30 rounded">
          <strong>Logic:</strong> All conditions must be met when using AND. 
          At least one condition must be met when using OR.
        </div>
      )}
    </div>
  );
}
