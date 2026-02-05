
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useNavigate } from "react-router-dom";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { insertProductSchema, type Product, type InsertProduct, type UpdateProduct, type ProductOptionItem } from "@shared/schema";
import { useProductBuilderDraft } from "@/hooks/useProductBuilderDraft";
import { useMaterials } from "@/hooks/useMaterials";
import { usePricingFormulas } from "@/hooks/usePricingFormulas";
import SplitWorkspace from "@/components/SplitWorkspace";
import { Form, FormControl, FormField, FormItem } from "@/components/ui/form";
import { ProductForm } from "@/components/ProductForm";
import ProductSimulator from "@/components/ProductSimulator";
import { useProductTypes } from '../hooks/useProductTypes';
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { type FlatGoodsConfig } from "@shared/pricingProfiles";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { ChevronRight, Copy, RotateCcw, Save } from "lucide-react";
import { optionsHaveInvalidChoices } from "@/lib/optionChoiceValidation";
import PBV2ProductBuilderSectionV2 from "@/components/PBV2ProductBuilderSectionV2";
import { ensureRootNodeIds, normalizeTreeJson } from "@/lib/pbv2/pbv2ViewModel";

interface ProductFormData extends Omit<InsertProduct, 'optionsJson'> {
  optionsJson: ProductOptionItem[] | null;
  pricingProfileKey: string;
  pricingProfileConfig: FlatGoodsConfig | null;
  pricingFormulaId: string | null;
}

const ProductEditorPage = () => {
  const { productId } = useParams<{ productId: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();
  const auth = useAuth();
  const isNewProduct = !productId;
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);
  const lastLoadedRef = useRef<ProductFormData | null>(null);
  const [duplicateOpen, setDuplicateOpen] = useState(false);
  
  // Single-flight guard: Prevent duplicate product creation from rapid clicks
  const saveInFlightRef = useRef<boolean>(false);
  // Idempotency: Once product is created, store ID to prevent duplicate creates
  const createdProductIdRef = useRef<string | null>(null);
  
  // Track PBV2 state for persistence
  const [pbv2State, setPbv2State] = useState<{ treeJson: unknown; hasChanges: boolean; draftId: string | null } | null>(null);
  const pbv2TreeProviderRef = useRef<{ getCurrentTree: () => unknown | null } | null>(null);

  const { data: product, isLoading } = useQuery<Product>({
    queryKey: ["/api/products", productId],
    enabled: !isNewProduct,
  });

  const form = useForm<ProductFormData>({
    resolver: zodResolver(insertProductSchema),
    defaultValues: {
      name: "",
      description: "",
      category: "",
      pricingFormula: "sqft * p * q",
      pricingMode: "area",
      pricingProfileKey: "default",
      pricingProfileConfig: null,
      pricingFormulaId: null,
      isService: false,
      artworkPolicy: "not_required",
      primaryMaterialId: null,
      optionsJson: [],
      optionTreeJson: null,
      storeUrl: "",
      showStoreLink: true,
      thumbnailUrls: [],
      priceBreaks: { enabled: false, type: "quantity", tiers: [] },
      useNestingCalculator: false,
      sheetWidth: null,
      sheetHeight: null,
      materialType: "sheet",
      minPricePerItem: null,
      nestingVolumePricing: { enabled: false, tiers: [] },
      isActive: true,
      requiresProductionJob: true,
      isTaxable: true,
    },
  });

  // Load product data when editing
  useEffect(() => {
    if (product && !isNewProduct) {
      // DEV-ONLY: Log what we received from API
      if (import.meta.env.DEV && (product as any).optionTreeJson) {
        const loadedTree = (product as any).optionTreeJson;
        const nodeCount = typeof loadedTree === 'object' && !Array.isArray(loadedTree)
          ? Object.keys(loadedTree.nodes || {}).length
          : 0;
        console.log("[ProductEditorPage] Loading product with optionTreeJson:", {
          type: typeof loadedTree,
          nodeCount,
          isString: typeof loadedTree === 'string',
          preview: typeof loadedTree === 'string' ? loadedTree.slice(0, 100) : null,
          schemaVersion: loadedTree?.schemaVersion,
        });
      }
      
      const nextValues: ProductFormData = {
        name: product.name,
        description: product.description || "",
        category: product.category || "",
        pricingFormula: product.pricingFormula || "sqft * p * q",
        pricingMode: product.pricingMode || "area",
        pricingProfileKey: product.pricingProfileKey || "default",
        pricingProfileConfig: product.pricingProfileConfig as FlatGoodsConfig | null,
        pricingFormulaId: product.pricingFormulaId || null,
        isService: product.isService || false,
        artworkPolicy: (product as any).artworkPolicy || "not_required",
        primaryMaterialId: product.primaryMaterialId || null,
        optionsJson: product.optionsJson || [],
        optionTreeJson: (product as any).optionTreeJson ?? null,
        storeUrl: product.storeUrl || "",
        showStoreLink: product.showStoreLink ?? true,
        isActive: product.isActive ?? true,
        productTypeId: product.productTypeId || undefined,
        requiresProductionJob: product.requiresProductionJob ?? true,
        isTaxable: product.isTaxable ?? true,
      };
      lastLoadedRef.current = nextValues;
      form.reset(nextValues);
    }
  }, [product, isNewProduct, form]);

  useEffect(() => {
    // For new products, keep a discard baseline so "Discard" works.
    if (isNewProduct) {
      lastLoadedRef.current = form.getValues();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isNewProduct]);

  const { data: materials } = useMaterials();
  const { data: pricingFormulas } = usePricingFormulas();
  const { data: productTypes } = useProductTypes();
  const draft = useProductBuilderDraft({ form, materials, pricingFormulas });

  const saveMutation = useMutation({
    mutationFn: async (data: InsertProduct | UpdateProduct) => {
      // SINGLE-FLIGHT GUARD: Prevent duplicate requests
      if (saveInFlightRef.current) {
        if (import.meta.env.DEV) {
          console.log('[SAVE_PIPELINE] BLOCKED: save already in flight');
        }
        throw new Error('Save already in progress');
      }
      
      saveInFlightRef.current = true;
      
      try {
        // IDEMPOTENCY: If we already created a product, this should be an UPDATE
        const effectiveIsNewProduct = isNewProduct && !createdProductIdRef.current;
        const effectiveProductId = createdProductIdRef.current || productId;
        
        if (import.meta.env.DEV) {
          console.log('[SAVE_PIPELINE] phase=start', {
            mode: effectiveIsNewProduct ? 'create' : 'update',
            productId: effectiveProductId,
            hasCreatedId: !!createdProductIdRef.current,
          });
        }
        
        // NO SHADOW COPY: PBV2ProductBuilderSectionV2 uses pbv2_tree_versions as ONLY source of truth
        const { optionTreeJson: _unused, ...cleanData } = data as any;
        const payload = {
          ...cleanData,
          optionsJson: data.optionsJson && data.optionsJson.length > 0 ? data.optionsJson : null,
          primaryMaterialId: data.primaryMaterialId || null,
        };
        
        let response;
        if (effectiveIsNewProduct) {
          response = await apiRequest("POST", "/api/products", payload);
          if (import.meta.env.DEV) {
            console.log('[SAVE_PIPELINE] phase=create-ok');
          }
        } else {
          response = await apiRequest("PATCH", `/api/products/${effectiveProductId}`, payload);
          if (import.meta.env.DEV) {
            console.log('[SAVE_PIPELINE] phase=update-ok');
          }
        }
        
        // Extract product data from response
        const productData = await response.json();
        return productData;
      } catch (error) {
        // Release guard on error so retry is possible
        saveInFlightRef.current = false;
        throw error;
      }
    },
    onSuccess: async (updatedProduct) => {
      try {
        setLastSavedAt(new Date());
        
        // IDEMPOTENCY: Store created product ID to prevent duplicate creates
        const targetProductId = isNewProduct ? updatedProduct.id : productId;
        if (isNewProduct && updatedProduct.id) {
          createdProductIdRef.current = updatedProduct.id;
        }
        
        if (!targetProductId) {
          if (import.meta.env.DEV) {
            console.log('[SAVE_PIPELINE] phase=pbv2-skip reason=no-productId');
          }
          // No productId means we can't persist PBV2, but product saved
          toast({
            title: isNewProduct ? "Product Created" : "Product Updated",
            description: "Product saved successfully.",
          });
          queryClient.invalidateQueries({ queryKey: ["/api/products"] });
          navigate("/products");
          return;
        }
        
        // Get FRESH tree snapshot at save time
        const freshTreeJson = pbv2TreeProviderRef.current?.getCurrentTree();
        
        if (!freshTreeJson) {
          if (import.meta.env.DEV) {
            console.log('[SAVE_PIPELINE] phase=pbv2-skip reason=no-tree');
          }
          // No tree to save, but product saved successfully
          toast({
            title: isNewProduct ? "Product Created" : "Product Updated",
            description: "Product saved successfully.",
          });
          queryClient.invalidateQueries({ queryKey: ["/api/products"] });
          if (productId) {
            queryClient.invalidateQueries({ queryKey: ["/api/products", productId, "pbv2", "tree"] });
          }
          navigate("/products");
          return;
        }
        
        // Tree is already normalized by getCurrentTree
        const normalizedTree = freshTreeJson;
        const nodes = (normalizedTree as any)?.nodes || {};
        const edges = (normalizedTree as any)?.edges || [];
        const nodeCount = Object.keys(nodes).length;
        const groupCount = Object.values(nodes).filter((n: any) => (n.type || '').toUpperCase() === 'GROUP').length;
        const optionCount = Object.values(nodes).filter((n: any) => {
          const type = (n.type || '').toUpperCase();
          return type === 'INPUT' || type === 'OPTION';
        }).length;
        const rootCount = Array.isArray((normalizedTree as any)?.rootNodeIds) ? (normalizedTree as any).rootNodeIds.length : 0;
        
        // Validate tree structure
        if (nodeCount > 0 && rootCount === 0) {
          toast({
            title: "PBV2 Save Failed",
            description: "Invalid tree: missing root nodes. Product saved but options not persisted.",
            variant: "destructive"
          });
          if (import.meta.env.DEV) {
            console.error('[SAVE_PIPELINE] phase=pbv2-invalid reason=no-roots');
          }
          // Don't navigate - let user fix tree
          return;
        }
        
        // Only persist if there are actual nodes (not just empty seed)
        if (nodeCount > 0) {
          if (import.meta.env.DEV) {
            console.log('[SAVE_PIPELINE] phase=pbv2-flush-start', {
              productId: targetProductId,
              nodeCount,
              groupCount,
              optionCount,
              edgeCount: edges.length,
            });
          }
          
          const draftRes = await fetch(`/api/products/${targetProductId}/pbv2/draft`, {
            method: 'PUT',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ treeJson: normalizedTree }),
          });
          
          if (!draftRes.ok) {
            const errData = await draftRes.json().catch(() => ({ message: 'Unknown error' }));
            toast({ 
              title: "PBV2 draft save failed", 
              description: `Product saved but options not persisted: ${errData.message || 'Unknown error'}`,
              variant: "destructive" 
            });
            if (import.meta.env.DEV) {
              console.error('[SAVE_PIPELINE] phase=pbv2-flush-failed', errData);
            }
            // Don't navigate - let user retry
            return;
          }
          
          if (import.meta.env.DEV) {
            const draftData = await draftRes.json();
            console.log('[SAVE_PIPELINE] phase=pbv2-flush-ok', { draftId: draftData.data?.id });
          }
        } else {
          if (import.meta.env.DEV) {
            console.log('[SAVE_PIPELINE] phase=pbv2-skip reason=empty-tree');
          }
        }
        
        // SUCCESS: Both product and PBV2 saved (or PBV2 skipped because empty)
        toast({
          title: isNewProduct ? "Product Created" : "Product Updated",
          description: isNewProduct
            ? "The product has been created successfully."
            : "The product has been updated successfully."
        });
        
        // Invalidate caches
        queryClient.invalidateQueries({ queryKey: ["/api/products"] });
        if (productId) {
          queryClient.invalidateQueries({ queryKey: ["/api/products", productId, "pbv2", "tree"] });
        }
        
        if (import.meta.env.DEV) {
          console.log('[SAVE_PIPELINE] phase=nav');
        }
        
        // Navigate away on full success
        navigate("/products");
        
      } catch (error: any) {
        // Catch any unexpected errors in onSuccess
        toast({ 
          title: "Save Error", 
          description: error.message || 'An unexpected error occurred',
          variant: "destructive" 
        });
        if (import.meta.env.DEV) {
          console.error('[SAVE_PIPELINE] phase=error', error);
        }
      } finally {
        // ALWAYS release single-flight guard so retry is possible
        saveInFlightRef.current = false;
        if (import.meta.env.DEV) {
          console.log('[SAVE_PIPELINE] phase=complete guard-released');
        }
      }
    },
    onError: (error: Error) => {
      // Release single-flight guard on mutation error
      saveInFlightRef.current = false;
      if (import.meta.env.DEV) {
        console.error('[SAVE_PIPELINE] phase=mutation-error guard-released', error.message);
      }
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const canDuplicate = !isNewProduct && (auth.isAdmin || auth.user?.role === "owner" || auth.user?.role === "admin");

  const duplicateMutation = useMutation({
    mutationFn: async () => {
      if (!productId) throw new Error("Missing productId");
      const res = await apiRequest("POST", `/api/products/${productId}/duplicate`);
      return (await res.json()) as Product;
    },
    onSuccess: (newProduct) => {
      setDuplicateOpen(false);
      toast({
        title: "Product Duplicated",
        description: "A draft copy was created successfully.",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/products"] });
      navigate(`/products/${newProduct.id}/edit`);
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const handleSave = (data: ProductFormData) => {
    // Additional guard at handler level
    if (saveInFlightRef.current) {
      if (import.meta.env.DEV) {
        console.log('[SAVE_PIPELINE] handleSave blocked: already in flight');
      }
      return;
    }
    saveMutation.mutate(data as InsertProduct);
  };

  const handleDiscard = () => {
    const baseline = lastLoadedRef.current;
    if (baseline) {
      form.reset(baseline);
    } else {
      form.reset();
    }
    toast({ title: "Discarded Changes", description: "Reverted to last loaded values." });
  };

  const saveLabel = useMemo(() => {
    if (saveMutation.isPending || saveInFlightRef.current) return "Saving…";
    if (!form.formState.isDirty) return "Save Changes";
    return "Save Changes";
  }, [form.formState.isDirty, saveMutation.isPending]);

  const hasInvalidChoiceValues = optionsHaveInvalidChoices(form.watch("optionsJson"));
  const hasInvalidOptionTreeJson = Boolean((form.formState.errors as any)?.optionTreeJson);

  if (isLoading) {
    return <div>Loading...</div>;
  }

  const header = (
    <div className="py-3">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            <button
              type="button"
              className="hover:text-foreground transition-colors"
              onClick={() => navigate("/products")}
            >
              Products
            </button>
            <ChevronRight className="h-3.5 w-3.5" />
            <span>{isNewProduct ? "New Product" : "Edit Product"}</span>
          </div>

          <div className="mt-1 flex items-center gap-3 min-w-0">
            <div className="min-w-[260px] max-w-[520px]">
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormControl>
                      <Input
                        {...field}
                        value={field.value || ""}
                        placeholder="Product name"
                        className="h-9 text-base font-semibold"
                      />
                    </FormControl>
                  </FormItem>
                )}
              />
            </div>

            <Badge variant={form.formState.isDirty ? "secondary" : "outline"} className="text-[11px]">
              {form.formState.isDirty ? "Draft" : "Saved"}
            </Badge>

            {lastSavedAt ? (
              <span className="text-xs text-muted-foreground">Last saved {lastSavedAt.toLocaleTimeString()}</span>
            ) : null}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => navigate("/products")}
            disabled={saveMutation.isPending}
          >
            Cancel
          </Button>
          {canDuplicate ? (
            <AlertDialog open={duplicateOpen} onOpenChange={setDuplicateOpen}>
              <Button
                type="button"
                variant="outline"
                onClick={() => setDuplicateOpen(true)}
                disabled={saveMutation.isPending || duplicateMutation.isPending}
              >
                <Copy className="h-4 w-4 mr-2" />
                Duplicate
              </Button>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Duplicate Product</AlertDialogTitle>
                  <AlertDialogDescription>
                    This will create a new draft copy of this product (including options/config). Continue?
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel disabled={duplicateMutation.isPending}>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={() => duplicateMutation.mutate()}
                    disabled={duplicateMutation.isPending}
                  >
                    {duplicateMutation.isPending ? "Duplicating…" : "Duplicate"}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          ) : null}
          <Button
            type="button"
            variant="outline"
            onClick={handleDiscard}
            disabled={!form.formState.isDirty}
          >
            <RotateCcw className="h-4 w-4 mr-2" />
            Discard
          </Button>
          <Button
            type="submit"
            form="product-editor-form"
            disabled={saveMutation.isPending || hasInvalidChoiceValues || hasInvalidOptionTreeJson}
          >
            <Save className="h-4 w-4 mr-2" />
            {saveLabel}
          </Button>
        </div>
      </div>
      {hasInvalidChoiceValues ? (
        <div className="mt-2 text-xs text-destructive">Fix empty choice values before saving.</div>
      ) : null}
      {hasInvalidOptionTreeJson ? (
        <div className="mt-2 text-xs text-destructive">Fix Option Tree v2 JSON errors before saving.</div>
      ) : null}
    </div>
  );

  return (
    <SplitWorkspace
      left={
        <Form {...form}>
          <div className="pb-6">
            {header}

            <ProductForm
              form={form}
              materials={materials}
              pricingFormulas={pricingFormulas}
              productTypes={productTypes}
              onSave={handleSave}
              formId="product-editor-form"
              onPbv2StateChange={setPbv2State}
            />

            <PBV2ProductBuilderSectionV2 
              productId={productId || null}
              onPbv2StateChange={setPbv2State}
              onTreeProviderReady={(provider) => {
                pbv2TreeProviderRef.current = provider;
              }}
            />
          </div>
        </Form>
      }
      right={<ProductSimulator draft={draft} isDirty={form.formState.isDirty} />}
      rightTitle="Live Simulator"
      storageKey="productEditor.simOpen"
    />
  );
};

export default ProductEditorPage;
