import React from 'react';
import { Plus, Trash2, DollarSign } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

interface BasePricingEditorProps {
  pricingV2: {
    unitSystem?: 'imperial' | 'metric';
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
  onAddTier: (kind: 'qty' | 'sqft') => void;
  onUpdateTier: (kind: 'qty' | 'sqft', index: number, tier: any) => void;
  onDeleteTier: (kind: 'qty' | 'sqft', index: number) => void;
}

function centsTodollars(cents: number | undefined): string {
  if (cents === undefined || cents === null) return '';
  return (cents / 100).toFixed(2);
}

function dollarsToCents(dollars: string): number | undefined {
  if (!dollars || dollars.trim() === '') return undefined;
  const parsed = parseFloat(dollars);
  if (isNaN(parsed)) return undefined;
  return Math.round(parsed * 100);
}

export function BasePricingEditor({
  pricingV2,
  onUpdateBase,
  onUpdateUnitSystem,
  onAddTier,
  onUpdateTier,
  onDeleteTier,
}: BasePricingEditorProps) {
  const unitSystem = pricingV2?.unitSystem || 'imperial';
  const base = pricingV2?.base || {};
  const qtyTiers = pricingV2?.qtyTiers || [];
  const sqftTiers = pricingV2?.sqftTiers || [];

  // Local state for input values
  const [basePerSqft, setBasePerSqft] = React.useState(centsTodollars(base.perSqftCents));
  const [basePerPiece, setBasePerPiece] = React.useState(centsToWire(base.perPieceCents));
  const [baseMinCharge, setBaseMinCharge] = React.useState(centsToWire(base.minimumChargeCents));

  // Sync with props when pricingV2 changes
  React.useEffect(() => {
    setBasePerSqft(centsToWire(base.perSqftCents));
    setBasePerPiece(centsToWire(base.perPieceCents));
    setBaseMinCharge(centsToWire(base.minimumChargeCents));
  }, [base.perSqftCents, base.perPieceCents, base.minimumChargeCents]);

  const handleBaseBlur = () => {
    onUpdateBase({
      perSqftCents: dollarsToCents(basePerSqft),
      perPieceCents: dollarsToCents(basePerPiece),
      minimumChargeCents: dollarsToCents(baseMinCharge),
    });
  };

  return (
    <div className="bg-[#1e293b] border border-slate-700 rounded-lg p-4 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <DollarSign className="h-5 w-5 text-emerald-400" />
          <h3 className="text-lg font-semibold text-slate-100">Base Pricing Model</h3>
        </div>
        <Select value={unitSystem} onValueChange={(v) => onUpdateUnitSystem(v as 'imperial' | 'metric')}>
          <SelectTrigger className="w-32 bg-[#0f172a] border-slate-600 text-slate-100">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="imperial">Imperial</SelectItem>
            <SelectItem value="metric">Metric</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <Separator className="bg-slate-700" />

      <div className="space-y-3">
        <h4 className="text-sm font-medium text-slate-300">Base Rates</h4>
        
        <div className="grid grid-cols-3 gap-3">
          <div>
            <Label className="text-xs text-slate-400 mb-1 block">
              Rate per sq ft {unitSystem === 'metric' && '(sq m)'}
            </Label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">$</span>
              <Input
                type="text"
                value={basePerSqft}
                onChange={(e) => setBasePerSqft(e.target.value)}
                onBlur={handleBaseBlur}
                placeholder="0.00"
                className="bg-[#0f172a] border-slate-600 text-slate-100 pl-7"
              />
            </div>
          </div>

          <div>
            <Label className="text-xs text-slate-400 mb-1 block">Rate per piece</Label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">$</span>
              <Input
                type="text"
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
                value={baseMinCharge}
                onChange={(e) => setBaseMinCharge(e.target.value)}
                onBlur={handleBaseBlur}
                placeholder="0.00"
                className="bg-[#0f172a] border-slate-600 text-slate-100 pl-7"
              />
            </div>
          </div>
        </div>

        <p className="text-xs text-slate-400">
          Base rates apply by default. Use tiers below to override rates at specific quantities or sizes.
        </p>
      </div>

      <Separator className="bg-slate-700" />

      <Tabs defaultValue="qty" className="w-full">
        <TabsList className="bg-[#0f172a] border border-slate-700">
          <TabsTrigger value="qty" className="data-[state=active]:bg-slate-700">
            Quantity Tiers ({qtyTiers.length})
          </TabsTrigger>
          <TabsTrigger value="sqft" className="data-[state=active]:bg-slate-700">
            Size Tiers ({sqftTiers.length})
          </TabsTrigger>
        </TabsList>

        <TabsContent value="qty" className="space-y-3 mt-4">
          <div className="flex items-center justify-between">
            <p className="text-xs text-slate-400">Override rates at specific quantities</p>
            <Button
              type="button"
              onClick={() => onAddTier('qty')}
              size="sm"
              variant="outline"
              className="gap-1.5 text-xs"
            >
              <Plus className="h-3.5 w-3.5" />
              Add Qty Tier
            </Button>
          </div>

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
          <div className="flex items-center justify-between">
            <p className="text-xs text-slate-400">Override rates at specific sizes (sq ft)</p>
            <Button
              type="button"
              onClick={() => onAddTier('sqft')}
              size="sm"
              variant="outline"
              className="gap-1.5 text-xs"
            >
              <Plus className="h-3.5 w-3.5" />
              Add Size Tier
            </Button>
          </div>

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
  const [perSqft, setPerSqft] = React.useState(centsToWire(tier.perSqftCents));
  const [perPiece, setPerPiece] = React.useState(centsToWire(tier.perPieceCents));
  const [minCharge, setMinCharge] = React.useState(centsToWire(tier.minimumChargeCents));

  const handleBlur = () => {
    const minNum = parseFloat(minValue);
    onUpdate({
      ...(kind === 'qty' ? { minQty: isNaN(minNum) ? 1 : Math.max(1, Math.round(minNum)) } : {}),
      ...(kind === 'sqft' ? { minSqft: isNaN(minNum) ? 0 : Math.max(0, minNum) } : {}),
      perSqftCents: dollarsToCents(perSqft),
      perPieceCents: dollarsToCents(perPiece),
      minimumChargeCents: dollarsToCents(minCharge),
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

function centsToWire(cents: number | undefined): string {
  if (cents === undefined || cents === null) return '';
  return (cents / 100).toFixed(2);
}
