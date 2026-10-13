import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ArrowRight, ImageOff, Star, Trash2 } from "lucide-react";
import type { Product } from "@shared/schema";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { MediaPicker } from "@/components/media-picker";
import { ObjectUploader } from "@/components/object-uploader";

export function ProductImageManagerDialog({ product, onClose, onSaved }: {
  product: Product | null;
  onClose: () => void;
  onSaved: (product: Product) => void;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [urls, setUrls] = useState<string[]>([]);
  const [libraryOpen, setLibraryOpen] = useState(false);
  useEffect(() => { setUrls(product?.thumbnailUrls ?? []); }, [product?.id]);

  const save = useMutation({
    mutationFn: async () => {
      if (!product) throw new Error("Product required");
      const response = await apiRequest("PUT", `/api/products/${encodeURIComponent(product.id)}/thumbnails`, { thumbnailUrls: urls });
      return (await response.json()) as Product;
    },
    onSuccess: (updated) => { onSaved(updated); toast({ title: "Product images saved" }); },
    onError: (error: Error) => toast({ title: "Could not save product images", description: error.message, variant: "destructive" }),
  });

  const move = (from: number, to: number) => {
    setUrls((current) => {
      const next = [...current];
      const [image] = next.splice(from, 1);
      next.splice(to, 0, image);
      return next;
    });
  };

  const registerUploadedImages = async (files: Array<{ url: string; filename: string; fileSize: number; mimeType: string }>) => {
    for (const file of files) await apiRequest("POST", "/api/media", file);
    await queryClient.invalidateQueries({ queryKey: ["/api/media"] });
    setUrls((current) => [...current, ...files.map((file) => file.url).filter((url) => !current.includes(url))]);
  };

  return <>
    <Dialog open={!!product} onOpenChange={(open) => { if (!open && !save.isPending) onClose(); }}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Manage product images</DialogTitle>
          <DialogDescription>{product?.name}. The first image is the primary thumbnail shown to customers. Image changes do not alter pricing.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          {urls.length ? <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-3">{urls.map((url, index) => <div key={url} className="rounded-md border p-2">
            <div className="flex aspect-square items-center justify-center overflow-hidden rounded bg-muted"><img src={url} alt={`Product image ${index + 1}${index === 0 ? ", primary" : ""}`} className="h-full w-full object-cover" /></div>
            <p className="mt-2 text-xs font-medium">{index === 0 ? "Primary thumbnail" : `Image ${index + 1}`}</p>
            <div className="mt-2 flex flex-wrap gap-1">
              {index > 0 ? <Button type="button" size="icon" variant="outline" aria-label={`Make image ${index + 1} primary`} onClick={() => move(index, 0)}><Star className="h-4 w-4" /></Button> : null}
              <Button type="button" size="icon" variant="outline" aria-label={`Move image ${index + 1} left`} disabled={index === 0} onClick={() => move(index, index - 1)}><ArrowLeft className="h-4 w-4" /></Button>
              <Button type="button" size="icon" variant="outline" aria-label={`Move image ${index + 1} right`} disabled={index === urls.length - 1} onClick={() => move(index, index + 1)}><ArrowRight className="h-4 w-4" /></Button>
              <Button type="button" size="icon" variant="outline" aria-label={`Remove image ${index + 1}`} onClick={() => setUrls((current) => current.filter((_, position) => position !== index))}><Trash2 className="h-4 w-4" /></Button>
            </div>
          </div>)}</div> : <div className="flex items-center gap-2 rounded-md border p-5 text-sm text-muted-foreground"><ImageOff className="h-5 w-5" />No customer-facing images assigned.</div>}
          <Button type="button" variant="outline" onClick={() => setLibraryOpen(true)}>Choose from media library</Button>
          {urls.length < 20 ? <div><p className="mb-2 text-sm font-medium">Upload new images</p><ObjectUploader value={[]} onChange={() => {}} onUploaded={registerUploadedImages} maxFiles={Math.min(5, 20 - urls.length)} allowedFileTypes={["image/jpeg", "image/png", "image/webp", "image/gif"]} /></div> : null}
        </div>
        <DialogFooter><Button type="button" variant="outline" onClick={onClose} disabled={save.isPending}>Cancel</Button><Button type="button" onClick={() => save.mutate()} disabled={save.isPending}>Save images</Button></DialogFooter>
      </DialogContent>
    </Dialog>
    <MediaPicker value={urls} onChange={setUrls} open={libraryOpen && !!product} onOpenChange={setLibraryOpen} />
  </>;
}
