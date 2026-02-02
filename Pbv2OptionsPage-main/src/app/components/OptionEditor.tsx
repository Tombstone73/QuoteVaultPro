import React from 'react';
import { Plus, Settings, GripVertical, Trash2, ChevronDown, ChevronRight, GitBranch, Package } from 'lucide-react';
import { Button } from '@/app/components/ui/button';
import { Input } from '@/app/components/ui/input';
import { Textarea } from '@/app/components/ui/textarea';
import { Switch } from '@/app/components/ui/switch';
import { Label } from '@/app/components/ui/label';
import { Badge } from '@/app/components/ui/badge';
import { Separator } from '@/app/components/ui/separator';
import { ScrollArea } from '@/app/components/ui/scroll-area';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/app/components/ui/select';
import { OptionDetailPanel } from '@/app/components/OptionDetailPanel';
import type { OptionGroup, Option, Product, WeightMode, WeightUnit } from '@/app/types';

interface OptionEditorProps {
  selectedGroup: OptionGroup | undefined;
  selectedOption: Option | undefined;
  product: Product;
  onSelectOption: (optionId: string | null) => void;
  onAddOption: (groupId: string) => void;
  onUpdateOption: (groupId: string, optionId: string, updates: Partial<Option>) => void;
  onDeleteOption: (groupId: string, optionId: string) => void;
  onUpdateGroup: (groupId: string, updates: Partial<OptionGroup>) => void;
  onUpdateProduct: (updates: Partial<Product>) => void;
}

export function OptionEditor({
  selectedGroup,
  selectedOption,
  product,
  onSelectOption,
  onAddOption,
  onUpdateOption,
  onDeleteOption,
  onUpdateGroup,
  onUpdateProduct
}: OptionEditorProps) {
  const [expandedOptions, setExpandedOptions] = React.useState<Set<string>>(new Set());
  
  const showWeightUI = product.fulfillment === 'shippable-estimate';

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

  return (
    <div className="h-full flex flex-col bg-[#0a0e1a]">
      <div className="border-b border-[#334155] bg-[#1e293b] p-5">
        <div className="flex items-start justify-between mb-3">
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
              className="text-sm text-slate-300 min-h-[50px] border-transparent hover:border-slate-600 focus:border-blue-500 bg-transparent"
            />
          </div>
        </div>

        <div className="flex items-center gap-6 ml-2">
          <div className="flex items-center gap-2">
            <Switch
              id="required"
              checked={selectedGroup.isRequired}
              onCheckedChange={(checked) => 
                onUpdateGroup(selectedGroup.id, { isRequired: checked })
              }
            />
            <Label htmlFor="required" className="font-medium cursor-pointer text-slate-300">
              Required Group
            </Label>
          </div>
          <div className="flex items-center gap-2">
            <Switch
              id="multiselect"
              checked={selectedGroup.isMultiSelect}
              onCheckedChange={(checked) => 
                onUpdateGroup(selectedGroup.id, { isMultiSelect: checked })
              }
            />
            <Label htmlFor="multiselect" className="font-medium cursor-pointer text-slate-300">
              Multi-select
            </Label>
          </div>
        </div>

        {showWeightUI && (
          <>
            <Separator className="bg-[#334155] my-4" />
            <div className="ml-2 space-y-3">
              <div className="flex items-center gap-2">
                <Package className="h-4 w-4 text-slate-400" />
                <h4 className="font-semibold text-slate-200">Weight</h4>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <Label className="text-slate-300 mb-1.5 block">Weight mode</Label>
                  <Select
                    value={product.weightModel.mode}
                    onValueChange={(value: WeightMode) => 
                      onUpdateProduct({ weightModel: { ...product.weightModel, mode: value } })
                    }
                  >
                    <SelectTrigger className="bg-[#0f172a] border-[#334155] text-slate-100">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="off">Off</SelectItem>
                      <SelectItem value="per-sqft">Per sq ft</SelectItem>
                      <SelectItem value="fixed">Fixed</SelectItem>
                      <SelectItem value="derived">Derived</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-slate-300 mb-1.5 block">Unit</Label>
                  <Select
                    value={product.weightModel.unit}
                    onValueChange={(value: WeightUnit) => 
                      onUpdateProduct({ weightModel: { ...product.weightModel, unit: value } })
                    }
                  >
                    <SelectTrigger className="bg-[#0f172a] border-[#334155] text-slate-100">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="lb">lb</SelectItem>
                      <SelectItem value="oz">oz</SelectItem>
                      <SelectItem value="kg">kg</SelectItem>
                      <SelectItem value="g">g</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {(product.weightModel.mode === 'per-sqft' || product.weightModel.mode === 'fixed') && (
                  <div>
                    <Label className="text-slate-300 mb-1.5 block">
                      {product.weightModel.mode === 'per-sqft' ? 'Per sq ft' : 'Base weight'}
                    </Label>
                    <Input
                      type="number"
                      step="0.01"
                      value={product.weightModel.baseWeight || ''}
                      onChange={(e) => 
                        onUpdateProduct({ 
                          weightModel: { 
                            ...product.weightModel, 
                            baseWeight: parseFloat(e.target.value) || 0 
                          } 
                        })
                      }
                      className="bg-[#0f172a] border-[#334155] text-slate-100"
                    />
                  </div>
                )}
              </div>
              {product.weightModel.mode === 'derived' && (
                <div className="text-sm text-slate-400 bg-slate-800/30 border border-slate-700/50 rounded p-2">
                  Computed from option selections
                </div>
              )}
            </div>
          </>
        )}
      </div>

      <ScrollArea className="flex-1 bg-[#0a0e1a]">
        <div className="p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold text-slate-200">Options</h3>
            <Button
              onClick={() => onAddOption(selectedGroup.id)}
              size="sm"
              className="gap-2 bg-blue-600 hover:bg-blue-700 text-white"
            >
              <Plus className="h-4 w-4" />
              Add Option
            </Button>
          </div>

          <div className="space-y-2">
            {selectedGroup.options.map((option) => {
              const isExpanded = expandedOptions.has(option.id);
              const hasPricing = option.pricingBehavior.type !== 'none';
              const hasFlags = option.productionFlags.length > 0;
              const hasConditions = option.conditionalLogic !== null;
              const hasWeight = showWeightUI && option.weightImpact.enabled;

              return (
                <div
                  key={option.id}
                  className="bg-[#1e293b] border border-[#334155] rounded-lg overflow-hidden"
                >
                  <div className="flex items-center p-4 hover:bg-slate-800/30 transition-colors">
                    <GripVertical className="h-4 w-4 text-slate-500 mr-2 flex-shrink-0" />
                    
                    <button
                      onClick={() => toggleOption(option.id)}
                      className="flex items-center flex-1 gap-3 text-left"
                    >
                      {isExpanded ? (
                        <ChevronDown className="h-4 w-4 text-slate-400 flex-shrink-0" />
                      ) : (
                        <ChevronRight className="h-4 w-4 text-slate-400 flex-shrink-0" />
                      )}
                      
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="font-medium text-slate-200">
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
                        <div className="flex items-center gap-2 mt-2 flex-wrap">
                          <Badge variant="outline" className="text-xs bg-slate-700/50 text-slate-300 border-slate-600">
                            {option.type}
                          </Badge>
                          {option.isDefault && (
                            <Badge variant="outline" className="text-xs bg-blue-500/10 text-blue-400 border-blue-500/30">
                              Default
                            </Badge>
                          )}
                          {option.isRequired && (
                            <Badge variant="outline" className="text-xs bg-red-500/10 text-red-400 border-red-500/30">
                              Required
                            </Badge>
                          )}
                          {hasPricing && (
                            <Badge variant="outline" className="text-xs bg-emerald-500/10 text-emerald-400 border-emerald-500/30">
                              Pricing
                            </Badge>
                          )}
                          {hasFlags && (
                            <Badge variant="outline" className="text-xs bg-cyan-500/10 text-cyan-400 border-cyan-500/30">
                              Production
                            </Badge>
                          )}
                          {hasConditions && (
                            <Badge variant="outline" className="text-xs bg-amber-500/10 text-amber-400 border-amber-500/30">
                              Conditional
                            </Badge>
                          )}
                          {hasWeight && (
                            <Badge variant="outline" className="text-xs bg-purple-500/10 text-purple-400 border-purple-500/30">
                              Weight
                            </Badge>
                          )}
                        </div>
                      </div>
                    </button>

                    <Button
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
                      <div className="p-4 bg-[#0f172a]">
                        <OptionDetailPanel
                          option={option}
                          groupId={selectedGroup.id}
                          product={product}
                          onUpdateOption={onUpdateOption}
                        />
                      </div>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </ScrollArea>
    </div>
  );
}
