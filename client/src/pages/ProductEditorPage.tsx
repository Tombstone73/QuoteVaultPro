
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
import PBV2ProductBuilderSection from "@/components/PBV2ProductBuilderSection";

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
  
  // Track PBV2 state for persistence
  const [pbv2State, setPbv2State] = useState<{ treeJson: unknown; hasChanges: boolean; draftId: string | null } | null>(null);

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
      const payload = {
        ...data,
        optionsJson: data.optionsJson && data.optionsJson.length > 0 ? data.optionsJson : null,
        primaryMaterialId: data.primaryMaterialId || null,
        // Preserve optionTreeJson as-is - don't nullify valid trees
        optionTreeJson: (data as any).optionTreeJson !== undefined ? (data as any).optionTreeJson : null,
      };
      
      // DEV-ONLY: Verify optionTreeJson is in payload if form is dirty
      if (import.meta.env.DEV) {
        const isDirty = form.formState.dirtyFields.optionTreeJson;
        const hasField = 'optionTreeJson' in payload;
        const treeValue = payload.optionTreeJson;
        console.log("[ProductEditorPage] Save payload validation:", {
          isDirty,
          hasField,
          isNull: treeValue === null,
          isUndefined: treeValue === undefined,
          type: typeof treeValue,
          hasNodes: treeValue?.nodes ? Object.keys(treeValue.nodes).length : 0,
          schemaVersion: treeValue?.schemaVersion,
          keys: Object.keys(payload).filter(k => k.includes('option') || k.includes('tree')),
        });
        
        if (isDirty && !hasField) {
          console.error("[ProductEditorPage] CRITICAL: optionTreeJson marked dirty but missing from payload!");
          console.error("[ProductEditorPage] Form data keys:", Object.keys(data));
        }
        
        if (hasField && treeValue && treeValue.nodes && Object.keys(treeValue.nodes).length > 0) {
          console.log("[ProductEditorPage] PBV2 tree has", Object.keys(treeValue.nodes).length, "nodes - will be saved");
        }
      }
      
      if (isNewProduct) {
        return await apiRequest("POST", "/api/products", payload);
      } else {
        const response = await apiRequest("PATCH", `/api/products/${productId}`, payload);
        
        // DEV-ONLY: Log what server returned
        if (import.meta.env.DEV && response) {
          const responseData = await response.json();
          const returnedTree = (responseData as any)?.optionTreeJson;
          if (returnedTree) {
            const returnedNodeCount = typeof returnedTree === 'object' 
              ? Object.keys(returnedTree.nodes || {}).length 
              : 0;
            console.log("[ProductEditorPage] PATCH response optionTreeJson:", {
              type: typeof returnedTree,
              nodeCount: returnedNodeCount,
              isString: typeof returnedTree === 'string',
            });
          }
          return { json: () => Promise.resolve(responseData) } as any;
        }
        
        return response;
      }
    },
    onSuccess: async (updatedProduct) => {
      setLastSavedAt(new Date());
      
      // Persist PBV2 draft to pbv2_tree_versions table
      if (!isNewProduct && pbv2State && pbv2State.treeJson) {
        const nodes = (pbv2State.treeJson as any)?.nodes || {};
        const hasNodes = Object.keys(nodes).length > 0;
        
        if (hasNodes) {
          try {
            const draftRes = await fetch(`/api/products/${productId}/pbv2/draft`, {
              method: 'PUT',
              credentials: 'include',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ treeJson: pbv2State.treeJson }),
            });
            
            if (!draftRes.ok) {
              const errData = await draftRes.json();
              throw new Error(errData.message || 'Failed to persist PBV2 draft');
            }
            
            if (import.meta.env.DEV) {
              const draftData = await draftRes.json();
              console.log('[ProductEditorPage] PBV2 draft persisted:', draftData.data?.id);
            }
          } catch (pbv2Error: any) {
            toast({ 
              title: "PBV2 Save Failed", 
              description: pbv2Error.message,
              variant: "destructive" 
            });
            console.error('[ProductEditorPage] PBV2 persistence error:', pbv2Error);
            return; // Stay on page if PBV2 save fails
          }
        }
      }
      
      toast({
        title: isNewProduct ? "Product Created" : "Product Updated",
        description: isNewProduct
          ? "The product has been created successfully."
          : "The product has been updated successfully."
      });
      
      // Invalidate both product list and individual product cache
      queryClient.invalidateQueries({ queryKey: ["/api/products"] });
      
      // Invalidate PBV2 tree cache for this product
      if (productId) {
        queryClient.invalidateQueries({ queryKey: ["/api/products", productId, "pbv2", "tree"] });
      }
      
      navigate("/products");
    },
    onError: (error: Error) => {
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
    if (saveMutation.isPending) return "Saving…";
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
            />

            {!isNewProduct && productId ? (
              <PBV2ProductBuilderSection 
                productId={productId}
                onPbv2StateChange={setPbv2State}
              />
            ) : null}
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
