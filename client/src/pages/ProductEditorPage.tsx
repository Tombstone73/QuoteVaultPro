
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
import { type FlatGoodsConfig } from "@shared/pricingProfiles";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ChevronRight, RotateCcw, Save } from "lucide-react";

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
  const isNewProduct = !productId;
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);
  const lastLoadedRef = useRef<ProductFormData | null>(null);

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
      primaryMaterialId: null,
      optionsJson: [],
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
        primaryMaterialId: product.primaryMaterialId || null,
        optionsJson: product.optionsJson || [],
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
      };
      
      if (isNewProduct) {
        return await apiRequest("POST", "/api/products", payload);
      } else {
        return await apiRequest("PATCH", `/api/products/${productId}`, payload);
      }
    },
    onSuccess: () => {
      setLastSavedAt(new Date());
      toast({
        title: isNewProduct ? "Product Created" : "Product Updated",
        description: isNewProduct
          ? "The product has been created successfully."
          : "The product has been updated successfully."
      });
      queryClient.invalidateQueries({ queryKey: ["/api/products"] });
      navigate("/products");
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
            onClick={handleDiscard}
            disabled={!form.formState.isDirty}
          >
            <RotateCcw className="h-4 w-4 mr-2" />
            Discard
          </Button>
          <Button
            type="submit"
            form="product-editor-form"
            disabled={saveMutation.isPending}
          >
            <Save className="h-4 w-4 mr-2" />
            {saveLabel}
          </Button>
        </div>
      </div>
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
