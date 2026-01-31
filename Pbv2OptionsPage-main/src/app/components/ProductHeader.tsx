import React from 'react';
import { Save, Eye, AlertCircle, Package, Tag, Hash, Truck } from 'lucide-react';
import { Button } from '@/app/components/ui/button';
import { Badge } from '@/app/components/ui/badge';
import { Input } from '@/app/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/app/components/ui/select';
import type { Product, FulfillmentType } from '@/app/types';

interface ProductHeaderProps {
  product: Product;
  hasUnsavedChanges: boolean;
  onSave: () => void;
  onPublish: () => void;
  onUpdateProduct: (updates: Partial<Product>) => void;
}

export function ProductHeader({
  product,
  hasUnsavedChanges,
  onSave,
  onPublish,
  onUpdateProduct
}: ProductHeaderProps) {
  const statusColors = {
    draft: 'bg-slate-700/50 text-slate-300 border-slate-600',
    active: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
    archived: 'bg-red-500/20 text-red-400 border-red-500/30'
  };

  const fulfillmentLabels: Record<FulfillmentType, string> = {
    'pickup-only': 'Pickup only',
    'shippable-estimate': 'Shippable (estimate)',
    'shippable-manual-quote': 'Shippable (custom quote)'
  };

  const isDraft = product.status === 'draft';

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
                value={product.name}
                onChange={(e) => onUpdateProduct({ name: e.target.value })}
                className="text-lg font-semibold border-transparent hover:border-slate-600 focus:border-blue-500 px-2 -ml-2 bg-transparent text-slate-100"
              />
              <Badge variant="outline" className={`text-xs ${statusColors[product.status]}`}>
                {product.status.toUpperCase()}
              </Badge>
            </div>
            <div className="flex items-center gap-4 mt-1 text-xs text-slate-400">
              <span className="flex items-center gap-1.5">
                <Tag className="h-3 w-3" />
                {product.category}
              </span>
              <span className="flex items-center gap-1.5">
                <Hash className="h-3 w-3" />
                {product.sku}
              </span>
              <span className="flex items-center gap-1.5">
                <Truck className="h-3 w-3" />
                <Select
                  value={product.fulfillment}
                  onValueChange={(value: FulfillmentType) => 
                    onUpdateProduct({ fulfillment: value })
                  }
                >
                  <SelectTrigger className="h-auto border-0 p-0 text-xs text-slate-400 hover:text-slate-300 bg-transparent focus:ring-0 focus:ring-offset-0 [&>svg]:h-3 [&>svg]:w-3 gap-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="pickup-only">Pickup only</SelectItem>
                    <SelectItem value="shippable-estimate">Shippable (estimate)</SelectItem>
                    <SelectItem value="shippable-manual-quote">Shippable (custom quote)</SelectItem>
                  </SelectContent>
                </Select>
              </span>
            </div>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-3">
        {hasUnsavedChanges && (
          <div className="flex items-center gap-2 text-amber-400 text-sm">
            <AlertCircle className="h-4 w-4" />
            <span>Unsaved changes</span>
          </div>
        )}
        
        <Button
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
          onClick={onPublish}
          disabled={product.status === 'active'}
          className="gap-2 bg-blue-600 hover:bg-blue-700 text-white shadow-lg shadow-blue-600/20"
          size="sm"
        >
          <Eye className="h-4 w-4" />
          {product.status === 'active' ? 'Published' : 'Publish'}
        </Button>
      </div>
    </header>
  );
}
