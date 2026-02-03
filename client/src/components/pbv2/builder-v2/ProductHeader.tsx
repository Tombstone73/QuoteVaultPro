import React from 'react';
import { Save, Eye, AlertCircle, Package, Tag, Hash, Truck, FileDown, FileUp } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';

export type ProductStatus = 'draft' | 'active' | 'archived';

interface ProductHeaderProps {
  productName: string;
  productStatus: ProductStatus;
  hasUnsavedChanges: boolean;
  canPublish: boolean;
  baseWeightOz?: number;
  basePriceCents?: number;
  onSave: () => void;
  onPublish: () => void;
  onExportJson: () => void;
  onImportJson: () => void;
  onUpdateProductName: (name: string) => void;
  onUpdateBaseWeight: (weightOz?: number) => void;
  onUpdateBasePrice: (priceCents?: number) => void;
}

export function ProductHeader({
  productName,
  productStatus,
  hasUnsavedChanges,
  canPublish,
  baseWeightOz,
  basePriceCents,
  onSave,
  onPublish,
  onExportJson,
  onImportJson,
  onUpdateProductName,
  onUpdateBaseWeight,
  onUpdateBasePrice
}: ProductHeaderProps) {
  const statusColors = {
    draft: 'bg-slate-700/50 text-slate-300 border-slate-600',
    active: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
    archived: 'bg-red-500/20 text-red-400 border-red-500/30'
  };

  const isDraft = productStatus === 'draft';

  return (
    <header 
      className={`flex items-center justify-between border-b border-[#334155] px-6 py-3.5 transition-colors ${
        isDraft ? 'bg-[#0f172a]' : 'bg-[#0a1628]'
      }`}
    >
      <div className="flex items-center gap-6">
        <div className="flex items-center gap-3">
          <Package className="h-5 w-5 text-slate-400" />
          <div>
            <div className="flex items-center gap-3">
              <Input
                value={productName}
                onChange={(e) => onUpdateProductName(e.target.value)}
                className="text-lg font-semibold border-transparent hover:border-slate-600 focus:border-blue-500 px-2 -ml-2 bg-transparent text-slate-100"
              />
              <Badge variant="outline" className={`text-xs ${statusColors[productStatus]}`}>
                {productStatus.toUpperCase()}
              </Badge>
            </div>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-3">
        {/* Part A: Base Weight Input */}
        <div className="flex items-center gap-2 border-r border-slate-600 pr-3">
          <label className="text-xs text-slate-400 whitespace-nowrap">Base Weight (oz)</label>
          <Input
            type="number"
            value={baseWeightOz !== undefined ? String(baseWeightOz) : ''}
            onChange={(e) => {
              const val = e.target.value.trim();
              if (val === '') {
                onUpdateBaseWeight(undefined);
              } else {
                const parsed = parseFloat(val);
                if (!isNaN(parsed) && parsed >= 0) {
                  onUpdateBaseWeight(parsed);
                }
              }
            }}
            onBlur={(e) => {
              // On blur, ensure valid value
              const val = e.target.value.trim();
              if (val !== '') {
                const parsed = parseFloat(val);
                if (isNaN(parsed) || parsed < 0) {
                  onUpdateBaseWeight(undefined);
                }
              }
            }}
            placeholder="0"
            className="w-20 h-8 text-sm bg-slate-800 border-slate-600 text-slate-100"
            min="0"
            step="0.1"
          />
        </div>

        {/* Part C: Base Price Input */}
        <div className="flex items-center gap-2 border-r border-slate-600 pr-3">
          <label className="text-xs text-slate-400 whitespace-nowrap">Base Price (¢)</label>
          <Input
            type="number"
            value={basePriceCents !== undefined ? String(basePriceCents) : ''}
            onChange={(e) => {
              const val = e.target.value.trim();
              if (val === '') {
                onUpdateBasePrice(undefined);
              } else {
                const parsed = parseFloat(val);
                if (!isNaN(parsed) && parsed >= 0) {
                  onUpdateBasePrice(Math.floor(parsed));
                }
              }
            }}
            onBlur={(e) => {
              // On blur, ensure valid value
              const val = e.target.value.trim();
              if (val !== '') {
                const parsed = parseFloat(val);
                if (isNaN(parsed) || parsed < 0) {
                  onUpdateBasePrice(undefined);
                }
              }
            }}
            placeholder="0"
            className="w-20 h-8 text-sm bg-slate-800 border-slate-600 text-slate-100"
            min="0"
            step="1"
          />
        </div>

        {hasUnsavedChanges && (
          <div className="flex items-center gap-2 text-amber-400 text-sm">
            <AlertCircle className="h-4 w-4" />
            <span>Unsaved changes</span>
          </div>
        )}

        <Button
          type="button"
          variant="outline"
          onClick={onExportJson}
          className="gap-2 border-slate-600 bg-slate-800 text-slate-200 hover:bg-slate-700 hover:text-white"
          size="sm"
        >
          <FileDown className="h-4 w-4" />
          Download JSON
        </Button>

        <Button
          type="button"
          variant="outline"
          onClick={onImportJson}
          className="gap-2 border-slate-600 bg-slate-800 text-slate-200 hover:bg-slate-700 hover:text-white"
          size="sm"
        >
          <FileUp className="h-4 w-4" />
          Upload JSON
        </Button>
        
        <Button
          type="button"
          variant="outline"
          onClick={onSave}
          disabled={!hasUnsavedChanges}
          className="gap-2 border-slate-600 bg-slate-800 text-slate-200 hover:bg-slate-700 hover:text-white"
          size="sm"
        >
          <Save className="h-4 w-4" />
          Save Draft
        </Button>
        
        <Button
          type="button"
          onClick={onPublish}
          disabled={!canPublish}
          className="gap-2 bg-blue-600 hover:bg-blue-700 text-white shadow-lg shadow-blue-600/20"
          size="sm"
        >
          <Eye className="h-4 w-4" />
          {productStatus === 'active' ? 'Published' : 'Publish'}
        </Button>
      </div>
    </header>
  );
}
