import React, { useState } from 'react';
import { DollarSign, AlertTriangle, CheckCircle, Calculator, ChevronDown, ChevronRight, Package } from 'lucide-react';
import { Button } from '@/app/components/ui/button';
import { Input } from '@/app/components/ui/input';
import { Label } from '@/app/components/ui/label';
import { ScrollArea } from '@/app/components/ui/scroll-area';
import { Separator } from '@/app/components/ui/separator';
import { Badge } from '@/app/components/ui/badge';
import type { Product } from '@/app/types';

interface PricingValidationPanelProps {
  product: Product;
}

export function PricingValidationPanel({ product }: PricingValidationPanelProps) {
  const [previewQuantity, setPreviewQuantity] = useState('500');
  const [showBreakdown, setShowBreakdown] = useState(true);

  // Calculate pricing preview
  const calculatePreview = () => {
    let total = product.basePrice;
    const breakdown: Array<{ label: string; amount: number; type: string }> = [
      { label: 'Base Price', amount: product.basePrice, type: 'base' }
    ];

    const qty = parseInt(previewQuantity) || 0;

    product.optionGroups.forEach(group => {
      group.options.forEach(option => {
        if (option.isDefault || option.isRequired) {
          const pricing = option.pricingBehavior;
          let optionCost = 0;

          switch (pricing.type) {
            case 'flat':
              optionCost = pricing.flatAmount || 0;
              break;
            case 'per-unit':
              optionCost = (pricing.perUnitAmount || 0) * qty;
              break;
            case 'per-sqft':
              // Simplified: assume 1 sqft for demo
              optionCost = (pricing.perSqftAmount || 0) * qty;
              break;
          }

          if (optionCost > 0) {
            breakdown.push({
              label: `${group.name}: ${option.name}`,
              amount: optionCost,
              type: 'option'
            });
            total += optionCost;
          }
        }
      });
    });

    return { total, breakdown };
  };

  const { total, breakdown } = calculatePreview();

  // Calculate weight estimate
  const calculateWeight = () => {
    const { mode, baseWeight = 0, unit } = product.weightModel;
    
    if (mode === 'off') return null;
    
    let weight = 0;
    
    if (mode === 'fixed') {
      weight = baseWeight;
    } else if (mode === 'per-sqft') {
      // Simplified: assume 1 sqft for demo
      weight = baseWeight * 1;
    } else if (mode === 'derived') {
      // Calculate from options with weight impact
      product.optionGroups.forEach(group => {
        group.options.forEach(option => {
          if ((option.isDefault || option.isRequired) && option.weightImpact.enabled) {
            if (option.weightImpact.type === 'fixed') {
              weight += option.weightImpact.value;
            } else if (option.weightImpact.type === 'per-sqft') {
              // Simplified: assume 1 sqft for demo
              weight += option.weightImpact.value * 1;
            }
          }
        });
      });
    }
    
    return { weight, unit };
  };

  const weightEstimate = product.fulfillment === 'shippable-estimate' ? calculateWeight() : null;

  // Validation checks
  const validationResults = [
    ...product.validationRules.map(rule => ({
      id: rule.id,
      type: rule.type,
      message: rule.message,
      affectedOptions: rule.affectedOptions
    })),
    // Check for groups without options
    ...product.optionGroups
      .filter(g => g.options.length === 0)
      .map(g => ({
        id: `empty-${g.id}`,
        type: 'warning' as const,
        message: `Group "${g.name}" has no options`,
        affectedOptions: []
      })),
    // Check for required groups without defaults
    ...product.optionGroups
      .filter(g => g.isRequired && !g.options.some(o => o.isDefault))
      .map(g => ({
        id: `no-default-${g.id}`,
        type: 'warning' as const,
        message: `Required group "${g.name}" has no default option`,
        affectedOptions: []
      })),
    // Check weight configuration for shippable-estimate
    ...(product.fulfillment === 'shippable-estimate' && product.weightModel.mode === 'off' ? [{
      id: 'weight-not-configured',
      type: 'warning' as const,
      message: 'Weight model not configured for shipping estimates',
      affectedOptions: []
    }] : []),
    ...(product.fulfillment === 'shippable-estimate' && product.weightModel.mode === 'derived' && !product.optionGroups.some(g => g.options.some(o => o.weightImpact.enabled)) ? [{
      id: 'weight-derived-no-options',
      type: 'warning' as const,
      message: 'Derived weight mode selected but no options contribute weight',
      affectedOptions: []
    }] : [])
  ];

  const conflicts = validationResults.filter(v => v.type === 'conflict');
  const warnings = validationResults.filter(v => v.type === 'warning');

  return (
    <aside className="w-96 bg-[#0f172a] border-l border-[#334155] flex flex-col">
      <div className="border-b border-[#334155] p-4">
        <div className="flex items-center gap-2 mb-4">
          <Calculator className="h-4 w-4 text-blue-400" />
          <h2 className="font-semibold text-slate-200">Pricing Preview</h2>
        </div>

        <div className="space-y-3">
          <div>
            <Label htmlFor="preview-qty" className="mb-1.5 block text-slate-300">
              Preview Quantity
            </Label>
            <Input
              id="preview-qty"
              type="number"
              value={previewQuantity}
              onChange={(e) => setPreviewQuantity(e.target.value)}
              className="font-mono bg-[#1e293b] border-[#334155] text-slate-100"
            />
          </div>

          <div className="bg-[#1e293b] border border-[#334155] rounded-lg p-4">
            <div className="flex items-baseline justify-between mb-1">
              <span className="text-sm text-slate-400">Preview Total</span>
              <div className="flex items-baseline gap-1">
                <DollarSign className="h-4 w-4 text-slate-400" />
                <span className="text-2xl font-semibold text-slate-100">
                  {total.toFixed(2)}
                </span>
              </div>
            </div>
            <div className="text-xs text-slate-500">
              Based on current defaults
            </div>
          </div>

          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowBreakdown(!showBreakdown)}
            className="w-full gap-2 justify-between bg-slate-800 border-slate-600 text-slate-300 hover:bg-slate-700"
          >
            <span>Price Breakdown</span>
            {showBreakdown ? (
              <ChevronDown className="h-4 w-4" />
            ) : (
              <ChevronRight className="h-4 w-4" />
            )}
          </Button>

          {showBreakdown && (
            <div className="space-y-1 pt-2">
              {breakdown.map((item, index) => (
                <div
                  key={index}
                  className="flex items-center justify-between text-sm py-1.5 px-2 rounded hover:bg-slate-800/50"
                >
                  <span className={item.type === 'base' ? 'font-medium text-slate-200' : 'text-slate-400'}>
                    {item.label}
                  </span>
                  <span className="font-mono text-slate-200">
                    ${item.amount.toFixed(2)}
                  </span>
                </div>
              ))}
            </div>
          )}

          {/* Weight Estimate */}
          {weightEstimate !== null && (
            <div className="mt-3 pt-3 border-t border-[#334155]">
              <div className="flex items-center justify-between text-sm">
                <span className="flex items-center gap-2 text-slate-400">
                  <Package className="h-3.5 w-3.5" />
                  Estimated ship weight
                </span>
                {weightEstimate.weight > 0 ? (
                  <span className="font-mono text-slate-200">
                    {weightEstimate.weight.toFixed(2)} {weightEstimate.unit}
                  </span>
                ) : (
                  <span className="text-amber-400 text-xs">Not configured</span>
                )}
              </div>
              {(product.weightModel.mode === 'off' || (product.weightModel.mode !== 'derived' && !product.weightModel.baseWeight)) && (
                <div className="text-xs text-amber-400/70 mt-1">
                  Weight model required for estimates
                </div>
              )}
            </div>
          )}

          {product.fulfillment === 'shippable-manual-quote' && (
            <div className="mt-3 pt-3 border-t border-[#334155]">
              <div className="text-xs text-slate-400 bg-slate-800/30 border border-slate-700/50 rounded p-2">
                Shipping requires manual quote
              </div>
            </div>
          )}
        </div>
      </div>

      <ScrollArea className="flex-1">
        <div className="p-4 space-y-4">
          <div>
            <div className="flex items-center gap-2 mb-3">
              <AlertTriangle className="h-4 w-4 text-amber-400" />
              <h3 className="font-semibold text-slate-200">Validation</h3>
            </div>

            {validationResults.length === 0 ? (
              <div className="flex items-start gap-2 p-3 bg-emerald-500/10 border border-emerald-500/30 rounded-lg">
                <CheckCircle className="h-4 w-4 text-emerald-400 mt-0.5 flex-shrink-0" />
                <div className="text-emerald-300">
                  <div className="font-medium mb-1">All checks passed</div>
                  <div className="text-sm text-emerald-400/70">
                    No conflicts or warnings detected in the current configuration.
                  </div>
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                {conflicts.length > 0 && (
                  <div className="space-y-2">
                    <div className="text-xs font-semibold text-red-200 mb-2 flex items-center gap-1.5">
                      <div className="w-2 h-2 rounded-full bg-red-500" />
                      {conflicts.length} Error{conflicts.length !== 1 ? 's' : ''}
                    </div>
                    {conflicts.map((issue) => (
                      <div
                        key={issue.id}
                        className="p-3 bg-red-500/15 border-2 border-red-500/50 rounded-lg"
                      >
                        <div className="font-semibold text-red-200 mb-1">
                          {issue.message}
                        </div>
                        {issue.affectedOptions.length > 0 && (
                          <div className="flex flex-wrap gap-1 mt-2">
                            {issue.affectedOptions.map((optId) => {
                              const opt = product.optionGroups
                                .flatMap(g => g.options)
                                .find(o => o.id === optId);
                              return opt ? (
                                <Badge
                                  key={optId}
                                  variant="outline"
                                  className="text-xs bg-red-500/25 text-red-200 border-red-400/60 font-medium"
                                >
                                  {opt.name}
                                </Badge>
                              ) : null;
                            })}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {warnings.length > 0 && (
                  <div className="space-y-2">
                    <div className="text-xs font-medium text-amber-300/90 mb-2 flex items-center gap-1.5">
                      <div className="w-2 h-2 rounded-full bg-amber-500/70" />
                      {warnings.length} Warning{warnings.length !== 1 ? 's' : ''}
                    </div>
                    {warnings.map((issue) => (
                      <div
                        key={issue.id}
                        className="p-3 bg-amber-500/8 border border-amber-500/25 rounded-lg"
                      >
                        <div className="font-medium text-amber-300/90 mb-1">
                          {issue.message}
                        </div>
                        {issue.affectedOptions.length > 0 && (
                          <div className="flex flex-wrap gap-1 mt-2">
                            {issue.affectedOptions.map((optId) => {
                              const opt = product.optionGroups
                                .flatMap(g => g.options)
                                .find(o => o.id === optId);
                              return opt ? (
                                <Badge
                                  key={optId}
                                  variant="outline"
                                  className="text-xs bg-amber-500/15 text-amber-300/90 border-amber-500/35"
                                >
                                  {opt.name}
                                </Badge>
                              ) : null;
                            })}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          <Separator className="bg-[#334155]" />

          <div>
            <h3 className="font-semibold text-slate-200 mb-3">Product Summary</h3>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-slate-400">Option Groups</span>
                <span className="font-medium text-slate-200">{product.optionGroups.length}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Total Options</span>
                <span className="font-medium text-slate-200">
                  {product.optionGroups.reduce((sum, g) => sum + g.options.length, 0)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Required Groups</span>
                <span className="font-medium text-slate-200">
                  {product.optionGroups.filter(g => g.isRequired).length}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Pricing Options</span>
                <span className="font-medium text-slate-200">
                  {product.optionGroups.reduce(
                    (sum, g) => sum + g.options.filter(o => o.pricingBehavior.type !== 'none').length,
                    0
                  )}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Conditional Options</span>
                <span className="font-medium text-slate-200">
                  {product.optionGroups.reduce(
                    (sum, g) => sum + g.options.filter(o => o.conditionalLogic !== null).length,
                    0
                  )}
                </span>
              </div>
            </div>
          </div>
        </div>
      </ScrollArea>
    </aside>
  );
}
