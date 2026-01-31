import React from 'react';
import { DollarSign, Settings2, GitBranch, Package } from 'lucide-react';
import { Input } from '@/app/components/ui/input';
import { Textarea } from '@/app/components/ui/textarea';
import { Label } from '@/app/components/ui/label';
import { Switch } from '@/app/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/app/components/ui/select';
import { Badge } from '@/app/components/ui/badge';
import { Separator } from '@/app/components/ui/separator';
import { ConditionalLogicBuilder } from '@/app/components/ConditionalLogicBuilder';
import type { Option, Product, PricingType, OptionType } from '@/app/types';

interface OptionDetailPanelProps {
  option: Option;
  groupId: string;
  product: Product;
  onUpdateOption: (groupId: string, optionId: string, updates: Partial<Option>) => void;
}

export function OptionDetailPanel({
  option,
  groupId,
  product,
  onUpdateOption
}: OptionDetailPanelProps) {
  // Production flags separated by criticality
  const primaryFlags = [
    { value: 'bleed-required', label: 'Bleed Required' },
    { value: 'finishing-required', label: 'Finishing Required' },
    { value: 'proof-required', label: 'Proof Required' }
  ];

  const secondaryFlags = [
    { value: 'rotation-allowed', label: 'Rotation Allowed' },
    { value: 'double-sided', label: 'Double-Sided' },
    { value: 'special-media', label: 'Special Media' },
    { value: 'bindery-routing', label: 'Bindery Routing' }
  ];

  const toggleProductionFlag = (flag: string) => {
    const flags = option.productionFlags.includes(flag as any)
      ? option.productionFlags.filter(f => f !== flag)
      : [...option.productionFlags, flag as any];
    onUpdateOption(groupId, option.id, { productionFlags: flags });
  };

  return (
    <div className="space-y-4">
      {/* Basic Information - Compressed */}
      <div className="space-y-3">
        <div>
          <Label htmlFor="option-name" className="font-medium mb-1 block text-slate-300">
            Option Name
          </Label>
          <Input
            id="option-name"
            value={option.name}
            onChange={(e) => onUpdateOption(groupId, option.id, { name: e.target.value })}
            className="font-medium bg-[#1e293b] border-[#334155] text-slate-100"
          />
        </div>

        <div>
          <Label htmlFor="option-description" className="font-medium mb-1 block text-slate-300">
            Description
          </Label>
          <Textarea
            id="option-description"
            value={option.description}
            onChange={(e) => onUpdateOption(groupId, option.id, { description: e.target.value })}
            placeholder="Internal description for staff..."
            className="min-h-[60px] bg-[#1e293b] border-[#334155] text-slate-100"
          />
        </div>

        {/* Single horizontal control row */}
        <div className="flex items-center gap-4">
          <div className="flex-1">
            <Label htmlFor="option-type" className="font-medium mb-1 block text-slate-300">
              Option Type
            </Label>
            <Select
              value={option.type}
              onValueChange={(value) => 
                onUpdateOption(groupId, option.id, { type: value as OptionType })
              }
            >
              <SelectTrigger id="option-type" className="bg-[#1e293b] border-[#334155] text-slate-100">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="radio">Radio Button</SelectItem>
                <SelectItem value="checkbox">Checkbox</SelectItem>
                <SelectItem value="dropdown">Dropdown</SelectItem>
                <SelectItem value="numeric">Numeric Input</SelectItem>
                <SelectItem value="dimension">Dimension-Based</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-end gap-4 pb-[2px]">
            <div className="flex items-center gap-2">
              <Switch
                id="default"
                checked={option.isDefault}
                onCheckedChange={(checked) => 
                  onUpdateOption(groupId, option.id, { isDefault: checked })
                }
              />
              <Label htmlFor="default" className="cursor-pointer text-slate-300">
                Default
              </Label>
            </div>
            <div className="flex items-center gap-2">
              <Switch
                id="required"
                checked={option.isRequired}
                onCheckedChange={(checked) => 
                  onUpdateOption(groupId, option.id, { isRequired: checked })
                }
              />
              <Label htmlFor="required" className="cursor-pointer text-slate-300">
                Required
              </Label>
            </div>
          </div>
        </div>
      </div>

      <Separator className="bg-[#334155]" />

      {/* Pricing Behavior */}
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <DollarSign className="h-4 w-4 text-emerald-400" />
          <h4 className="font-semibold text-slate-200">Pricing Behavior</h4>
        </div>

        <div>
          <Label htmlFor="pricing-type" className="font-medium mb-1 block text-slate-300">
            Pricing Type
          </Label>
          <Select
            value={option.pricingBehavior.type}
            onValueChange={(value) => 
              onUpdateOption(groupId, option.id, {
                pricingBehavior: { ...option.pricingBehavior, type: value as PricingType }
              })
            }
          >
            <SelectTrigger id="pricing-type" className="bg-[#1e293b] border-[#334155] text-slate-100">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">No Price Impact</SelectItem>
              <SelectItem value="flat">Flat Amount</SelectItem>
              <SelectItem value="per-unit">Per Unit</SelectItem>
              <SelectItem value="per-sqft">Per Square Foot</SelectItem>
              <SelectItem value="formula">Formula-Based</SelectItem>
              <SelectItem value="tiered">Tiered Pricing</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {option.pricingBehavior.type === 'flat' && (
          <div>
            <Label htmlFor="flat-amount" className="font-medium mb-1 block text-slate-300">
              Flat Amount ($)
            </Label>
            <Input
              id="flat-amount"
              type="number"
              step="0.01"
              value={option.pricingBehavior.flatAmount || ''}
              onChange={(e) => 
                onUpdateOption(groupId, option.id, {
                  pricingBehavior: {
                    ...option.pricingBehavior,
                    flatAmount: parseFloat(e.target.value) || 0
                  }
                })
              }
              className="bg-[#1e293b] border-[#334155] text-slate-100"
            />
          </div>
        )}

        {option.pricingBehavior.type === 'per-unit' && (
          <div>
            <Label htmlFor="per-unit-amount" className="font-medium mb-1 block text-slate-300">
              Per Unit Amount ($)
            </Label>
            <Input
              id="per-unit-amount"
              type="number"
              step="0.001"
              value={option.pricingBehavior.perUnitAmount || ''}
              onChange={(e) => 
                onUpdateOption(groupId, option.id, {
                  pricingBehavior: {
                    ...option.pricingBehavior,
                    perUnitAmount: parseFloat(e.target.value) || 0
                  }
                })
              }
              className="bg-[#1e293b] border-[#334155] text-slate-100"
            />
          </div>
        )}

        {option.pricingBehavior.type === 'per-sqft' && (
          <div>
            <Label htmlFor="per-sqft-amount" className="font-medium mb-1 block text-slate-300">
              Per Sq Ft Amount ($)
            </Label>
            <Input
              id="per-sqft-amount"
              type="number"
              step="0.01"
              value={option.pricingBehavior.perSqftAmount || ''}
              onChange={(e) => 
                onUpdateOption(groupId, option.id, {
                  pricingBehavior: {
                    ...option.pricingBehavior,
                    perSqftAmount: parseFloat(e.target.value) || 0
                  }
                })
              }
              className="bg-[#1e293b] border-[#334155] text-slate-100"
            />
          </div>
        )}

        {option.pricingBehavior.type === 'formula' && (
          <div>
            <Label htmlFor="formula" className="font-medium mb-1 block text-slate-300">
              Formula
            </Label>
            <Input
              id="formula"
              value={option.pricingBehavior.formula || ''}
              onChange={(e) => 
                onUpdateOption(groupId, option.id, {
                  pricingBehavior: {
                    ...option.pricingBehavior,
                    formula: e.target.value
                  }
                })
              }
              placeholder="e.g., basePrice * 1.25 + quantity * 0.05"
              className="bg-[#1e293b] border-[#334155] text-slate-100"
            />
            <p className="text-xs text-slate-400 mt-1">
              Available variables: basePrice, quantity, width, height, sqft
            </p>
          </div>
        )}
      </div>

      <Separator className="bg-[#334155]" />

      {/* Production Flags - Hierarchical */}
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <Settings2 className="h-4 w-4 text-cyan-400" />
          <h4 className="font-semibold text-slate-200">Production Flags</h4>
        </div>

        <div className="space-y-3">
          {/* Primary flags - production critical */}
          <div>
            <div className="text-xs font-medium text-slate-400 mb-1.5">Production Critical</div>
            <div className="flex flex-wrap gap-2">
              {primaryFlags.map((flag) => (
                <Badge
                  key={flag.value}
                  variant="outline"
                  className={`cursor-pointer transition-colors text-xs ${
                    option.productionFlags.includes(flag.value as any)
                      ? 'bg-cyan-500/25 text-cyan-300 border-cyan-400/50 font-medium'
                      : 'bg-slate-700/50 text-slate-300 border-slate-600 hover:bg-slate-700'
                  }`}
                  onClick={() => toggleProductionFlag(flag.value)}
                >
                  {flag.label}
                </Badge>
              ))}
            </div>
          </div>

          {/* Secondary flags - routing/metadata */}
          <div>
            <div className="text-xs font-medium text-slate-400 mb-1.5">Routing & Metadata</div>
            <div className="flex flex-wrap gap-2">
              {secondaryFlags.map((flag) => (
                <Badge
                  key={flag.value}
                  variant="outline"
                  className={`cursor-pointer transition-colors text-xs ${
                    option.productionFlags.includes(flag.value as any)
                      ? 'bg-cyan-500/15 text-cyan-400 border-cyan-500/30'
                      : 'bg-slate-700/30 text-slate-400 border-slate-600/60 hover:bg-slate-700/50'
                  }`}
                  onClick={() => toggleProductionFlag(flag.value)}
                >
                  {flag.label}
                </Badge>
              ))}
            </div>
          </div>
        </div>
      </div>

      <Separator className="bg-[#334155]" />

      {/* Shipping Impact */}
      {product.fulfillment === 'shippable-estimate' && (
        <>
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Package className="h-4 w-4 text-purple-400" />
              <h4 className="font-semibold text-slate-200">Shipping Impact</h4>
            </div>

            <div className="flex items-center gap-2">
              <Switch
                id="weight-enabled"
                checked={option.weightImpact.enabled}
                onCheckedChange={(checked) =>
                  onUpdateOption(groupId, option.id, {
                    weightImpact: { ...option.weightImpact, enabled: checked }
                  })
                }
              />
              <Label htmlFor="weight-enabled" className="font-medium cursor-pointer text-slate-300">
                Affects weight
              </Label>
            </div>

            {option.weightImpact.enabled && (
              <div className="space-y-3 pl-6">
                <div>
                  <Label className="text-slate-300 mb-1.5 block">Impact type</Label>
                  <Select
                    value={option.weightImpact.type}
                    onValueChange={(value: 'per-sqft' | 'fixed') =>
                      onUpdateOption(groupId, option.id, {
                        weightImpact: { ...option.weightImpact, type: value }
                      })
                    }
                  >
                    <SelectTrigger className="bg-[#0f172a] border-[#334155] text-slate-100">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="per-sqft">Adds per sq ft</SelectItem>
                      <SelectItem value="fixed">Adds fixed weight</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <Label className="text-slate-300 mb-1.5 block">
                    Weight value ({product.weightModel.unit})
                  </Label>
                  <Input
                    type="number"
                    step="0.01"
                    value={option.weightImpact.value || ''}
                    onChange={(e) =>
                      onUpdateOption(groupId, option.id, {
                        weightImpact: {
                          ...option.weightImpact,
                          value: parseFloat(e.target.value) || 0
                        }
                      })
                    }
                    className="bg-[#0f172a] border-[#334155] text-slate-100"
                  />
                </div>

                <div className="text-xs text-slate-400 bg-slate-800/30 border border-slate-700/50 rounded p-2">
                  Applies when this option is selected
                </div>
              </div>
            )}
          </div>

          <Separator className="bg-[#334155]" />
        </>
      )}

      {/* Conditional Logic */}
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <GitBranch className="h-4 w-4 text-amber-400" />
          <h4 className="font-semibold text-slate-200">Conditional Logic</h4>
        </div>

        <ConditionalLogicBuilder
          option={option}
          groupId={groupId}
          product={product}
          onUpdateOption={onUpdateOption}
        />
      </div>
    </div>
  );
}
