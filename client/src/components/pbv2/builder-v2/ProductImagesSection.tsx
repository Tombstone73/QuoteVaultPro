/**
 * Product Images Section (MVP)
 * 
 * Collapsible section for managing product images.
 * Images are stored in tree meta.productImages as ordered array.
 * 
 * MVP: Placeholder UI with state management plumbing.
 * Full implementation: Upload + reorder + thumbnail display using existing asset pipeline.
 */

import React, { useState } from 'react';
import { Upload, Image as ImageIcon, GripVertical, X, ChevronDown, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';

export interface ProductImagesSectionProps {
  productImages?: Array<{
    url: string;
    fileName: string;
    mediaAssetId?: string;
    orderIndex: number;
  }>;
  onUpdateImages?: (images: Array<{ url: string; fileName: string; mediaAssetId?: string; orderIndex: number }>) => void;
}

export function ProductImagesSection({
  productImages = [],
  onUpdateImages,
}: ProductImagesSectionProps) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <div className="bg-[#1e293b] border border-slate-700 rounded-lg">
        <CollapsibleTrigger asChild>
          <button
            type="button"
            className="w-full flex items-center justify-between p-4 hover:bg-slate-700/30 transition-colors rounded-t-lg"
          >
            <div className="flex items-center gap-2">
              <ImageIcon className="h-5 w-5 text-blue-400" />
              <h3 className="text-lg font-semibold text-slate-100">Product Images</h3>
              {productImages.length > 0 && (
                <span className="text-xs text-slate-400">({productImages.length})</span>
              )}
            </div>
            {isOpen ? (
              <ChevronDown className="h-5 w-5 text-slate-400" />
            ) : (
              <ChevronRight className="h-5 w-5 text-slate-400" />
            )}
          </button>
        </CollapsibleTrigger>

        <CollapsibleContent>
          <div className="p-4 pt-0 space-y-3">
            <p className="text-xs text-slate-400">
              Customer-facing images displayed in portals and storefronts. Upload and reorder images.
            </p>

            {/* MVP: Placeholder UI */}
            <div className="bg-[#0f172a] border border-slate-700 rounded-lg p-6 text-center space-y-3">
              <Upload className="h-10 w-10 mx-auto text-slate-600" />
              <div className="text-sm text-slate-400">
                Image upload functionality coming soon
              </div>
              <div className="text-xs text-slate-500">
                Full implementation: upload → thumbnail generation → drag-and-drop reordering
              </div>
            </div>

            {/* FUTURE: Full implementation will include:
              - File upload via input[type="file"] or drag-and-drop
              - Preflight to /api/objects/upload (or media endpoint)
              - Thumbnail strip with drag-and-drop reorder
              - Delete and set primary image
              - Persist ordered URLs to tree meta.productImages
            */}
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}
