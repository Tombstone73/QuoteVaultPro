import React from 'react';
import { Plus, Trash2, DollarSign } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { centsToCurrencyInput, centsToCurrencyRateInput, currencyInputToCents, currencyRateInputToCents } from '@/lib/pbv2/currency';
import type { Pbv2TierBasis } from '@shared/optionTreeV2';

interface BasePricingEditorProps {
  pricingV2: {
    unitSystem?: 'imperial' | 'metric';
    tierBasis?: Pbv2TierBasis;
    base?: {
      perSqftCents?: number;
      perPieceCents?: number;
      minimumChargeCents?: number;
    };
    qtyTiers?: Array<{
      minQty?: number;
      perSqftCents?: number;
      perPieceCents?: number;
      minimumChargeCents?: number;
    }>;
    sqftTiers?: Array<{
      minSqft?: number;
      perSqftCents?: number;
      perPieceCents?: number;
      minimumChargeCents?: number;
    }>;
  } | null;
  onUpdateBase: (base: { perSqftCents?: number; perPieceCents?: number; minimumChargeCents?: number }) => void;
  onUpdateUnitSystem: (unitSystem: 'imperial' | 'metric') => void;
  onUpdateTierBasis: (tierBasis: Pbv2TierBasis) => void;
  pricingProfileKey?: string | null;
  allowRotation?: boolean;
  onUpdateAllowRotation?: (allowRotation: boolean) => void;
  onAddTier: (kind: 'qty' | 'sqft') => void;
  onUpdateTier: (kind: 'qty' | 'sqft', index: number, tier: any) => void;
  onDeleteTier: (kind: 'qty' | 'sqft', index: number) => void;
}

export function BasePricingEditor({
  pricingV2,
  onUpdateBase,
  onUpdateUnitSystem,
  onUpdateTierBasis,
  pricingProfileKey,
  allowRotation = false,
  onUpdateAllowRotation,
  onAddTier,
  onUpdateTier,
  onDeleteTier,
}: BasePricingEditorProps) {
  const unitSystem = pricingV2?.unitSystem || 'imperial';
  const tierBasis = pricingV2?.tierBasis || 'line_item_quantity';
  const base = pricingV2?.base || {};
  const quantityOnly = pricingProfileKey === "qty_only";
  const feeService = pricingProfileKey === "fee";
  const qtyTiers = pricingV2?.qtyTiers || [];
  const sqftTiers = pricingV2?.sqftTiers || [];

  // Track active tab for dynamic button
  const [activeTab, setActiveTab] = React.useState<'qty' | 'sqft'>('qty');

  // Local state for input values
  const [basePerSqft, setBasePerSqft] = React.useState(centsToCurrencyRateInput(base.perSqftCents));
  const [basePerPiece, setBasePerPiece] = React.useState(centsToCurrencyRateInput(base.perPieceCents));
  const [baseMinCharge, setBaseMinCharge] = React.useState(centsToCurrencyInput(base.minimumChargeCents));

  // Sync with props when pricingV2 changes
  React.useEffect(() => {
    setBasePerSqft(centsToCurrencyRateInput(base.perSqftCents));
    setBasePerPiece(centsToCurrencyRateInput(base.perPieceCents));
    setBaseMinCharge(centsToCurrencyInput(base.minimumChargeCents));
  }, [base.perSqftCents, base.perPieceCents, base.minimumChargeCents]);

  const handleBaseBlur = () => {
    onUpdateBase({
      perSqftCents: currencyRateInputToCents(basePerSqft),
      perPieceCents: currencyRateInputToCents(basePerPiece),
      minimumChargeCents: currencyInputToCents(baseMinCharge),
    });
  };

  if (feeService) {
    return (
      <div className="rounded-lg border border-slate-700 bg-[#1e293b] p-4">
        <h4 className="text-sm font-medium text-slate-300">Fee / Service Pricing</h4>
        <p className="mt-1 text-xs leading-relaxed text-slate-400">
          Fee / Service products use the Flat Fee Amount configured in the pricing profile. The fee is charged once per line item; square-foot, per-piece, minimum-charge, and tier rates do not apply.
        </p>
      </div>
    );
  }

  return (
    <div className="bg-[#1e293b] border border-slate-700 rounded-lg p-4 space-y-4">
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h4 className="text-sm font-medium text-slate-300">Base Pricing Model</h4>
          <div className="flex items-center gap-2">
            <div className="space-y-1">
              <Label className="text-[11px] text-slate-500">Tier Basis</Label>
              <Select value={tierBasis} onValueChange={(v) => onUpdateTierBasis(v as Pbv2TierBasis)}>
                <SelectTrigger className="w-48 bg-[#0f172a] border-slate-600 text-slate-100 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="line_item_quantity">Line Item Quantity</SelectItem>
                  <SelectItem value="computed_sheet_usage">Computed Sheet Usage</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-[11px] text-slate-500">Units</Label>
              <Select value={unitSystem} onValueChange={(v) => onUpdateUnitSystem(v as 'imperial' | 'metric')}>
                <SelectTrigger className="w-32 bg-[#0f172a] border-slate-600 text-slate-100 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="imperial">Imperial</SelectItem>
                  <SelectItem value="metric">Metric</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>
        <div className="text-xs text-slate-400">
          Tier Basis controls which quantity is used to choose the price break.
          {tierBasis === 'computed_sheet_usage' ? (
            <span className="block mt-1">
              Use this when discounts should be based on production sheet usage instead of customer piece quantity. When exact flat-goods nesting is available, this uses computed sheets needed; otherwise it uses sheet-equivalent usage from the sheet consumption calculation.
            </span>
          ) : null}
        </div>
        
        <div className="rounded-md border border-slate-700 bg-[#0f172a]/60 p-3">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <Label className="text-xs font-medium text-slate-300">
                Allow Rotation / Mixed Sheet Layout
              </Label>
              <p className="mt-1 text-[11px] leading-relaxed text-slate-500">
                Sheet-yield formulas use normal orientation only when off. When on, pricing may use rotated and mixed layouts.
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <span className="text-[11px] text-slate-500">
                {allowRotation ? 'Allow rotation/mixed layout' : 'No rotation'}
              </span>
              <Switch
                checked={Boolean(allowRotation)}
                onCheckedChange={(checked) => onUpdateAllowRotation?.(Boolean(checked))}
                disabled={!onUpdateAllowRotation}
              />
            </div>
          </div>
        </div>

        <div className={`grid gap-3 ${quantityOnly ? "grid-cols-2" : "grid-cols-3"}`}>
          {!quantityOnly ? <div>
            <Label className="text-xs text-slate-400 mb-1 block">
              Rate per sq ft {unitSystem === 'metric' && '(sq m)'}
            </Label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">$</span>
              <Input
                type="text"
                inputMode="decimal"
                value={basePerSqft}
                onChange={(e) => setBasePerSqft(e.target.value)}
                onBlur={handleBaseBlur}
                placeholder="0.00"
                className="bg-[#0f172a] border-slate-600 text-slate-100 pl-7"
              />
            </div>
          </div> : null}

          <div>
            <Label className="text-xs text-slate-400 mb-1 block">Rate per piece</Label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">$</span>
              <Input
                type="text"
                inputMode="decimal"
                value={basePerPiece}
                onChange={(e) => setBasePerPiece(e.target.value)}
                onBlur={handleBaseBlur}
                placeholder="0.00"
                className="bg-[#0f172a] border-slate-600 text-slate-100 pl-7"
              />
            </div>
          </div>

          <div>
            <Label className="text-xs text-slate-400 mb-1 block">Minimum charge</Label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">$</span>
              <Input
                type="text"
                inputMode="decimal"
                value={baseMinCharge}
                onChange={(e) => setBaseMinCharge(e.target.value)}
                onBlur={handleBaseBlur}
                placeholder="0.00"
                className="bg-[#0f172a] border-slate-600 text-slate-100 pl-7"
              />
            </div>
          </div>
        </div>
        {quantityOnly ? (
          <div className="text-xs text-slate-400">Quantity Only uses Rate per piece. Rate per sq ft is not used.</div>
        ) : null}
      </div>

      <Separator className="bg-slate-700" />

      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as 'qty' | 'sqft')} className="w-full">
        <div className="flex items-center justify-between gap-3">
          <TabsList className="bg-[#0f172a] border border-slate-700">
            <TabsTrigger value="qty" className="data-[state=active]:bg-slate-700">
              Quantity Tiers ({qtyTiers.length})
            </TabsTrigger>
            <TabsTrigger value="sqft" className="data-[state=active]:bg-slate-700">
              Size Tiers ({sqftTiers.length})
            </TabsTrigger>
          </TabsList>
          <Button
            type="button"
            onClick={() => onAddTier(activeTab)}
            size="sm"
            variant="outline"
            className="gap-1.5 text-xs"
          >
            <Plus className="h-3.5 w-3.5" />
            {activeTab === 'qty' ? 'Add Qty Tier' : 'Add Size Tier'}
          </Button>
        </div>

        <TabsContent value="qty" className="space-y-3 mt-4">

          {qtyTiers.length > 0 && (
            <div className="space-y-2">
              {qtyTiers.map((tier, index) => (
                <TierRow
                  key={index}
                  tier={tier}
                  kind="qty"
                  index={index}
                  onUpdate={(updated) => onUpdateTier('qty', index, updated)}
                  onDelete={() => onDeleteTier('qty', index)}
                  unitSystem={unitSystem}
                />
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="sqft" className="space-y-3 mt-4">

          {sqftTiers.length > 0 && (
            <div className="space-y-2">
              {sqftTiers.map((tier, index) => (
                <TierRow
                  key={index}
                  tier={tier}
                  kind="sqft"
                  index={index}
                  onUpdate={(updated) => onUpdateTier('sqft', index, updated)}
                  onDelete={() => onDeleteTier('sqft', index)}
                  unitSystem={unitSystem}
                />
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

function TierRow({
  tier,
  kind,
  index,
  onUpdate,
  onDelete,
  unitSystem,
}: {
  tier: any;
  kind: 'qty' | 'sqft';
  index: number;
  onUpdate: (tier: any) => void;
  onDelete: () => void;
  unitSystem: 'imperial' | 'metric';
}) {
  const [minValue, setMinValue] = React.useState(kind === 'qty' ? String(tier.minQty || '') : String(tier.minSqft || ''));
  const [perSqft, setPerSqft] = React.useState(centsToCurrencyRateInput(tier.perSqftCents));
  const [perPiece, setPerPiece] = React.useState(centsToCurrencyRateInput(tier.perPieceCents));
  const [minCharge, setMinCharge] = React.useState(centsToCurrencyInput(tier.minimumChargeCents));

  const handleBlur = () => {
    const minNum = parseFloat(minValue);
    onUpdate({
      ...(kind === 'qty' ? { minQty: isNaN(minNum) ? 1 : Math.max(1, Math.round(minNum)) } : {}),
      ...(kind === 'sqft' ? { minSqft: isNaN(minNum) ? 0 : Math.max(0, minNum) } : {}),
      perSqftCents: currencyRateInputToCents(perSqft),
      perPieceCents: currencyRateInputToCents(perPiece),
      minimumChargeCents: currencyInputToCents(minCharge),
    });
  };

  return (
    <div className="bg-[#0f172a] border border-slate-700 rounded-lg p-3 space-y-2">
      <div className="flex items-start gap-2">
        <div className="flex-1 grid grid-cols-4 gap-2">
          <div>
            <Label className="text-xs text-slate-400 mb-1 block">
              {kind === 'qty' ? 'Min Qty' : `Min sq ft${unitSystem === 'metric' ? ' (sq m)' : ''}`}
            </Label>
            <Input
              type="text"
              value={minValue}
              onChange={(e) => setMinValue(e.target.value)}
              onBlur={handleBlur}
              placeholder={kind === 'qty' ? '1' : '0'}
              className="bg-[#1e293b] border-slate-600 text-slate-100 text-sm"
            />
          </div>

          <div>
            <Label className="text-xs text-slate-400 mb-1 block">$/sq ft</Label>
            <div className="relative">
              <span className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400 text-xs">$</span>
              <Input
                type="text"
                inputMode="decimal"
                value={perSqft}
                onChange={(e) => setPerSqft(e.target.value)}
                onBlur={handleBlur}
                placeholder="—"
                className="bg-[#1e293b] border-slate-600 text-slate-100 text-sm pl-5"
              />
            </div>
          </div>

          <div>
            <Label className="text-xs text-slate-400 mb-1 block">$/piece</Label>
            <div className="relative">
              <span className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400 text-xs">$</span>
              <Input
                type="text"
                inputMode="decimal"
                value={perPiece}
                onChange={(e) => setPerPiece(e.target.value)}
                onBlur={handleBlur}
                placeholder="—"
                className="bg-[#1e293b] border-slate-600 text-slate-100 text-sm pl-5"
              />
            </div>
          </div>

          <div>
            <Label className="text-xs text-slate-400 mb-1 block">Min $</Label>
            <div className="relative">
              <span className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400 text-xs">$</span>
              <Input
                type="text"
                inputMode="decimal"
                value={minCharge}
                onChange={(e) => setMinCharge(e.target.value)}
                onBlur={handleBlur}
                placeholder="—"
                className="bg-[#1e293b] border-slate-600 text-slate-100 text-sm pl-5"
              />
            </div>
          </div>
        </div>

        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onDelete}
          className="text-red-400 hover:text-red-300 hover:bg-red-500/10 mt-5"
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

