import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ArrowRight, ImageOff, Star, Trash2 } from "lucide-react";
import type { Product } from "@shared/schema";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { MediaPicker } from "@/components/media-picker";
import { ObjectUploader } from "@/components/object-uploader";

/** Image-only editor shared by PBV2 and the Products list. */
export function ProductImageManager({ productId, product: suppliedProduct, legacyImages = [], onSaved, onSavingChange }: {
  productId: string | null;
  product?: Product | null;
  legacyImages?: Array<{ url: string }>;
  onSaved?: (product: Product) => void;
  onSavingChange?: (saving: boolean) => void;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const productQuery = useQuery<Product>({
    queryKey: ["/api/products", productId], enabled: !!productId,
    queryFn: async () => (await apiRequest("GET", `/api/products/${encodeURIComponent(productId!)}`)).json(),
  });
  const product = productQuery.data ?? suppliedProduct;
  const [urls, setUrls] = useState<string[]>([]);
  const [dirty, setDirty] = useState(false);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);

  useEffect(() => { setUrls([]); setDirty(false); setPreview(null); }, [productId]);
  useEffect(() => {
    if (!dirty && product?.id === productId) setUrls(product.thumbnailUrls ?? []);
  }, [product?.id, product?.thumbnailUrls, productId, dirty]);

  const changeUrls = (next: string[]) => {
    if (next.length > 20) {
      toast({ title: "Too many images", description: "A product can have up to 20 images.", variant: "destructive" });
      return;
    }
    setUrls(next);
    setDirty(true);
  };
  const move = (from: number, to: number) => {
    const next = [...urls];
    const [image] = next.splice(from, 1);
    next.splice(to, 0, image);
    changeUrls(next);
  };
  const save = useMutation({
    mutationFn: async () => {
      if (!productId || !product || product.id !== productId) throw new Error("Save the product before assigning images.");
      const response = await apiRequest("PUT", `/api/products/${encodeURIComponent(productId)}/thumbnails`, { thumbnailUrls: urls });
      return (await response.json()) as Product;
    },
    onSuccess: (updated) => {
      queryClient.setQueryData(["/api/products", updated.id], updated);
      void queryClient.invalidateQueries({ queryKey: ["/api/products"], exact: true });
      setUrls(updated.thumbnailUrls ?? []);
      setDirty(false);
      onSaved?.(updated);
      toast({ title: "Product images saved" });
    },
    onError: (error: Error) => toast({ title: "Could not save product images", description: error.message, variant: "destructive" }),
  });
  useEffect(() => { onSavingChange?.(save.isPending); }, [save.isPending, onSavingChange]);
  const registerUploadedImages = async (files: Array<{ url: string; filename: string; fileSize: number; mimeType: string }>) => {
    for (const file of files) await apiRequest("POST", "/api/media", file);
    await queryClient.invalidateQueries({ queryKey: ["/api/media"] });
    changeUrls([...urls, ...files.map((file) => file.url).filter((url) => !urls.includes(url))]);
  };

  if (!productId) return <p className="text-sm text-muted-foreground">Save this product before uploading or assigning images.</p>;
  if (productQuery.isLoading && !suppliedProduct) return <p className="text-sm text-muted-foreground">Loading product images…</p>;
  if (productQuery.isError && !suppliedProduct) return <p className="text-sm text-destructive">Could not load product images. Reload this page to retry.</p>;

  return <div className="space-y-4" data-testid="product-image-manager">
    <p className="text-sm text-muted-foreground">The first image is the primary customer thumbnail. Images save separately from pricing and PBV2 drafts.</p>
    {legacyImages.length > 0 ? <p className="text-xs text-amber-500">This PBV2 tree also contains {legacyImages.length} legacy image reference(s). They are preserved in the tree; customer images are managed below.</p> : null}
    {urls.length ? <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{urls.map((url, index) => <div key={`${url}-${index}`} className="rounded-md border p-2">
      <button type="button" onClick={() => setPreview(url)} aria-label={`Preview image ${index + 1}`} className="flex aspect-square w-full items-center justify-center overflow-hidden rounded bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><img src={url} alt={`Product image ${index + 1}${index === 0 ? ", primary" : ""}`} className="h-full w-full object-cover" /></button>
      <p className="mt-2 text-xs font-medium">{index === 0 ? "Primary thumbnail" : `Image ${index + 1}`}</p>
      <div className="mt-2 flex flex-wrap gap-1">
        {index > 0 ? <Button type="button" size="icon" variant="outline" aria-label={`Make image ${index + 1} primary`} onClick={() => move(index, 0)}><Star className="h-4 w-4" /></Button> : null}
        <Button type="button" size="icon" variant="outline" aria-label={`Move image ${index + 1} left`} disabled={index === 0} onClick={() => move(index, index - 1)}><ArrowLeft className="h-4 w-4" /></Button>
        <Button type="button" size="icon" variant="outline" aria-label={`Move image ${index + 1} right`} disabled={index === urls.length - 1} onClick={() => move(index, index + 1)}><ArrowRight className="h-4 w-4" /></Button>
        <Button type="button" size="icon" variant="outline" aria-label={`Remove image ${index + 1}`} onClick={() => changeUrls(urls.filter((_, position) => position !== index))}><Trash2 className="h-4 w-4" /></Button>
      </div>
    </div>)}</div> : <div className="flex items-center gap-2 rounded-md border p-5 text-sm text-muted-foreground"><ImageOff className="h-5 w-5" />No customer-facing images assigned.</div>}
    <Button type="button" variant="outline" onClick={() => setLibraryOpen(true)}>Choose from media library</Button>
    {urls.length < 20 ? <div><p className="mb-2 text-sm font-medium">Upload new images</p><ObjectUploader value={[]} onChange={() => {}} onUploaded={registerUploadedImages} maxFiles={Math.min(5, 20 - urls.length)} allowedFileTypes={["image/jpeg", "image/png", "image/webp", "image/gif"]} /><p className="mt-2 text-xs text-muted-foreground">Accepted formats: JPG, JPEG, PNG, WebP, and GIF.</p></div> : <p className="text-sm text-muted-foreground">Maximum of 20 images reached.</p>}
    <Button type="button" onClick={() => save.mutate()} disabled={!dirty || save.isPending}>{save.isPending ? "Saving…" : "Save images"}</Button>
    <MediaPicker value={urls} onChange={changeUrls} open={libraryOpen} onOpenChange={setLibraryOpen} />
    {preview ? <div role="dialog" aria-modal="true" aria-label="Product image preview" className="fixed inset-0 z-[100] flex items-center justify-center bg-black/85 p-6" onClick={() => setPreview(null)}><button type="button" className="absolute right-5 top-5 rounded bg-background px-3 py-1 text-foreground" onClick={() => setPreview(null)}>Close preview</button><img src={preview} alt="Product image large preview" className="max-h-full max-w-full object-contain" onClick={(event) => event.stopPropagation()} /></div> : null}
  </div>;
}
