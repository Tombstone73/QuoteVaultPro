import { useState } from "react";
import type { Product } from "@shared/schema";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ProductImageManager } from "./ProductImageManager";

export function ProductImageManagerDialog({ product, onClose, onSaved }: {
  product: Product | null;
  onClose: () => void;
  onSaved: (product: Product) => void;
}) {
  const [saving, setSaving] = useState(false);
  return <Dialog open={!!product} onOpenChange={(open) => { if (!open && !saving) onClose(); }}>
    <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
      <DialogHeader><DialogTitle>Manage product images</DialogTitle></DialogHeader>
      {product ? <ProductImageManager key={product.id} productId={product.id} product={product} onSaved={onSaved} onSavingChange={setSaving} /> : null}
    </DialogContent>
  </Dialog>;
}
