import { useState } from "react";
import { ChevronDown, ChevronRight, Image as ImageIcon } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ProductImageManager } from "@/components/products/ProductImageManager";

export function ProductImagesSection({ productId, legacyImages = [] }: {
  productId: string | null;
  legacyImages?: Array<{ url: string }>;
}) {
  const [isOpen, setIsOpen] = useState(false);
  return <Collapsible open={isOpen} onOpenChange={setIsOpen}>
    <div className="rounded-lg border border-slate-700 bg-[#1e293b]">
      <CollapsibleTrigger asChild>
        <button type="button" className="flex w-full items-center justify-between rounded-t-lg p-4 text-slate-100 hover:bg-slate-700/30">
          <span className="flex items-center gap-2"><ImageIcon className="h-5 w-5 text-blue-400" /><span className="text-lg font-semibold">Product Images</span></span>
          {isOpen ? <ChevronDown className="h-5 w-5" /> : <ChevronRight className="h-5 w-5" />}
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent><div className="p-4 pt-0"><ProductImageManager productId={productId} legacyImages={legacyImages} /></div></CollapsibleContent>
    </div>
  </Collapsible>;
}
