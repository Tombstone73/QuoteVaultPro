import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { Skeleton } from "@/components/ui/skeleton";
import { Copy, Edit, Plus, Trash2, Search, Package, Info, Layers, Settings2, X, Calculator, Grid3X3, ChevronUp, ChevronDown, Zap, Scissors, Sparkles, Circle } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { TitanCard } from "@/components/ui/TitanCard";
import type { Product, InsertProduct, UpdateProduct, ProductOptionItem } from "@shared/schema";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { insertProductSchema } from "@shared/schema";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { useProductTypes } from "@/hooks/useProductTypes";
import { useMaterials } from "@/hooks/useMaterials";
import { usePricingFormulas, type PricingFormula } from "@/hooks/usePricingFormulas";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { PRICING_PROFILES, type PricingProfileKey, type FlatGoodsConfig, getProfile, getDefaultFormula } from "@shared/pricingProfiles";
import React from "react";
import { optionsHaveInvalidChoices } from "@/lib/optionChoiceValidation";


// Required field indicator component
function RequiredIndicator() {
  return <span className="text-destructive ml-0.5">*</span>;
}

// Helper to create a label with required indicator
function RequiredLabel({ children, required = false }: { children: React.ReactNode; required?: boolean }) {
  return (
    <>
      {children}
      {required && <RequiredIndicator />}
    </>
  );
}

// Get profile badge for display
function getProfileBadge(profileKey: string | null | undefined) {
  const profile = getProfile(profileKey);
  switch (profile.key) {
    case "flat_goods":
      return <Badge variant="outline" className="bg-orange-500/10 text-orange-600 border-orange-500/30"><Grid3X3 className="h-3 w-3 mr-1" />Flat Goods</Badge>;
    case "qty_only":
      return <Badge variant="outline" className="bg-green-500/10 text-green-600 border-green-500/30">Qty Only</Badge>;
    case "fee":
      return <Badge variant="outline" className="bg-purple-500/10 text-purple-600 border-purple-500/30">Fee</Badge>;
    default:
      return <Badge variant="outline" className="bg-blue-500/10 text-blue-600 border-blue-500/30"><Calculator className="h-3 w-3 mr-1" />Formula</Badge>;
  }
}

// Generate a random ID for options
function generateOptionId(): string {
  return `opt_${Math.random().toString(36).substring(2, 11)}`;
}

interface ProductFormData extends Omit<InsertProduct, 'optionsJson'> {
  optionsJson: ProductOptionItem[] | null;
  pricingProfileKey: string;
  pricingProfileConfig: FlatGoodsConfig | null;
  pricingFormulaId: string | null;
}

export default function ProductsPage() {
  const { toast } = useToast();
  const navigate = useNavigate();
  const [searchTerm, setSearchTerm] = useState("");
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [duplicateSource, setDuplicateSource] = useState<Product | null>(null);

  // Refs for scrolling to first error
  const addFormRef = useRef<HTMLFormElement>(null);
  const editFormRef = useRef<HTMLFormElement>(null);

  const { data: products, isLoading } = useQuery<Product[]>({
    queryKey: ["/api/products"],
  });

  const { data: productTypes } = useProductTypes();
  const { data: materials } = useMaterials();
  const { data: pricingFormulas } = usePricingFormulas();

  // Add product form
  const addProductForm = useForm<ProductFormData>({
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

  // Edit product form
  const editProductForm = useForm<ProductFormData>({
    resolver: zodResolver(insertProductSchema.partial()),
  });

  // Scroll to first error field
  const scrollToFirstError = (formRef: React.RefObject<HTMLFormElement>) => {
    setTimeout(() => {
      const firstError = formRef.current?.querySelector('[data-error="true"]');
      if (firstError) {
        firstError.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }, 100);
  };

  // Handle add form validation errors
  const handleAddFormError = () => {
    toast({
      title: "Validation Error",
      description: "Please fill out all required fields before saving.",
      variant: "destructive",
    });
    scrollToFirstError(addFormRef);
  };

  // Handle edit form validation errors  
  const handleEditFormError = () => {
    toast({
      title: "Validation Error",
      description: "Please fill out all required fields before saving.",
      variant: "destructive",
    });
    scrollToFirstError(editFormRef);
  };

  // Watch pricing profile and formula for conditional UI
  const addPricingProfileKey = addProductForm.watch("pricingProfileKey");
  const editPricingProfileKey = editProductForm.watch("pricingProfileKey");
  const addPricingProfileConfig = addProductForm.watch("pricingProfileConfig");
  const editPricingProfileConfig = editProductForm.watch("pricingProfileConfig");
  const addPricingFormulaId = addProductForm.watch("pricingFormulaId");
  const editPricingFormulaId = editProductForm.watch("pricingFormulaId");

  const addHasInvalidChoiceValues = optionsHaveInvalidChoices(addProductForm.watch("optionsJson"));
  const editHasInvalidChoiceValues = optionsHaveInvalidChoices(editProductForm.watch("optionsJson"));

  const addProductMutation = useMutation({
    mutationFn: async (data: InsertProduct) => {
      // Clean up empty optionsJson
      const payload = {
        ...data,
        optionsJson: data.optionsJson && data.optionsJson.length > 0 ? data.optionsJson : null,
        primaryMaterialId: data.primaryMaterialId || null,
      };
      return await apiRequest("POST", "/api/products", payload);
    },
    onSuccess: () => {
      const wasDuplicate = !!duplicateSource;
      toast({
        title: wasDuplicate ? "Product Duplicated" : "Product Added",
        description: wasDuplicate
          ? "The product has been duplicated successfully."
          : "The product has been added successfully."
      });
      queryClient.invalidateQueries({ queryKey: ["/api/products"] });
      setIsAddDialogOpen(false);
      setDuplicateSource(null);
      addProductForm.reset();
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const updateProductMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: UpdateProduct }) => {
      // Clean up empty optionsJson
      const payload = {
        ...data,
        optionsJson: data.optionsJson && data.optionsJson.length > 0 ? data.optionsJson : null,
        primaryMaterialId: data.primaryMaterialId || null,
      };
      return await apiRequest("PATCH", `/api/products/${id}`, payload);
    },
    onSuccess: () => {
      toast({ title: "Product Updated", description: "The product has been updated successfully." });
      queryClient.invalidateQueries({ queryKey: ["/api/products"] });
      setEditingProduct(null);
      editProductForm.reset();
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const deleteProductMutation = useMutation({
    mutationFn: async (id: string) => {
      return await apiRequest("DELETE", `/api/products/${id}`);
    },
    onSuccess: () => {
      toast({ title: "Product Deleted", description: "The product has been deleted successfully." });
      queryClient.invalidateQueries({ queryKey: ["/api/products"] });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });



  const filteredProducts = products?.filter(
    (product) =>
      product.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      product.category?.toLowerCase().includes(searchTerm.toLowerCase())
  ) || [];

  const handleEditProduct = (product: Product) => {
    navigate(`/products/${product.id}/edit`);
  };

  // Handle duplicating a product - opens Add dialog pre-filled with source product data
  const handleDuplicateProduct = (product: Product) => {
    setDuplicateSource(product);
    // Pre-fill the add form with the source product's data (excluding id, organizationId, timestamps)
    addProductForm.reset({
      name: `${product.name} (Copy)`,
      description: product.description || "",
      category: product.category || "",
      pricingFormula: product.pricingFormula || "sqft * p * q",
      pricingMode: product.pricingMode || "area",
      pricingProfileKey: product.pricingProfileKey || "default",
      pricingProfileConfig: product.pricingProfileConfig as FlatGoodsConfig | null,
      pricingFormulaId: product.pricingFormulaId || null,
      isService: product.isService || false,
      primaryMaterialId: product.primaryMaterialId || null,
      optionsJson: product.optionsJson ? JSON.parse(JSON.stringify(product.optionsJson)) : [],
      storeUrl: product.storeUrl || "",
      showStoreLink: product.showStoreLink ?? true,
      thumbnailUrls: product.thumbnailUrls || [],
      priceBreaks: product.priceBreaks || { enabled: false, type: "quantity", tiers: [] },
      useNestingCalculator: product.useNestingCalculator || false,
      sheetWidth: product.sheetWidth ? parseFloat(product.sheetWidth) : null,
      sheetHeight: product.sheetHeight ? parseFloat(product.sheetHeight) : null,
      materialType: product.materialType || "sheet",
      minPricePerItem: product.minPricePerItem ? parseFloat(product.minPricePerItem) : null,
      nestingVolumePricing: product.nestingVolumePricing || { enabled: false, tiers: [] },
      isActive: true, // New duplicates should be active by default
      productTypeId: product.productTypeId || undefined,
      requiresProductionJob: product.requiresProductionJob ?? true,
      isTaxable: product.isTaxable ?? true,
    });
    setIsAddDialogOpen(true);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Package className="h-6 w-6" />
            Product Catalog
          </h1>
          <p className="text-muted-foreground text-sm">
            Manage products and pricing used for quotes and orders
          </p>
        </div>
        <Button onClick={() => navigate("/products/new")}>
          <Plus className="h-4 w-4 mr-2" />
          Add Product
        </Button>
      </div>

      {/* Search */}
      <TitanCard className="p-4">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search products by name or category..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-10"
          />
        </div>
      </TitanCard>

      {/* Products Table */}
      <TitanCard className="p-0 overflow-hidden">
        {isLoading ? (
          <div className="p-6 space-y-4">
            {[...Array(5)].map((_, i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        ) : filteredProducts.length === 0 ? (
          <div className="p-12 text-center">
            <Package className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
            <h3 className="text-lg font-medium mb-2">No products found</h3>
            <p className="text-muted-foreground mb-4">
              {searchTerm ? "Try adjusting your search term" : "Get started by adding your first product"}
            </p>
            {!searchTerm && (
              <Button onClick={() => navigate("/products/new")}>
                <Plus className="h-4 w-4 mr-2" />
                Add Product
              </Button>
            )}
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Pricing Profile</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredProducts.map((product) => {
                const productType = productTypes?.find((pt) => pt.id === product.productTypeId);
                return (
                  <TableRow key={product.id}>
                    <TableCell className="font-medium">
                      <div className="flex items-center gap-2">
                        {product.name}
                        {product.isService && (
                          <Badge variant="secondary" className="text-xs">Service</Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>{product.category || "—"}</TableCell>
                    <TableCell>{productType?.name || "—"}</TableCell>
                    <TableCell>{getProfileBadge(product.pricingProfileKey)}</TableCell>
                    <TableCell>
                      <Badge variant={product.isActive ? "default" : "secondary"}>
                        {product.isActive ? "Active" : "Inactive"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-2">
                        <Button variant="ghost" size="sm" onClick={() => handleEditProduct(product)}>
                          <Edit className="h-4 w-4" />
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => handleDuplicateProduct(product)} title="Duplicate product">
                          <Copy className="h-4 w-4" />
                        </Button>
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button variant="ghost" size="sm">
                              <Trash2 className="h-4 w-4 text-destructive" />
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Delete Product</AlertDialogTitle>
                              <AlertDialogDescription>
                                Are you sure you want to delete "{product.name}"? This action cannot be undone.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancel</AlertDialogCancel>
                              <AlertDialogAction onClick={() => deleteProductMutation.mutate(product.id)}>
                                Delete
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </TitanCard>

      {/* Add Product Dialog */}
      <Dialog open={isAddDialogOpen} onOpenChange={(open) => {
        setIsAddDialogOpen(open);
        if (!open) {
          setDuplicateSource(null);
          addProductForm.reset();
        }
      }}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{duplicateSource ? "Duplicate Product" : "Add New Product"}</DialogTitle>
            <DialogDescription>
              {duplicateSource
                ? `Creating a copy of "${duplicateSource.name}". Modify the details below and save.`
                : "Create a new product for use in quotes and orders."}
            </DialogDescription>
          </DialogHeader>
          <Form {...addProductForm}>
            <form
              ref={addFormRef}
              onSubmit={addProductForm.handleSubmit(
                (data) => addProductMutation.mutate(data as InsertProduct),
                handleAddFormError
              )}
              className="space-y-6"
            >
              {/* Section: Basic Info */}
              <div className="space-y-4">
                <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                  <Info className="h-4 w-4" />
                  Basic Info
                </div>
                <FormField
                  control={addProductForm.control}
                  name="name"
                  render={({ field, fieldState }) => (
                    <FormItem data-error={!!fieldState.error}>
                      <FormLabel><RequiredLabel required>Name</RequiredLabel></FormLabel>
                      <FormControl>
                        <Input
                          placeholder="Product name"
                          {...field}
                          className={fieldState.error ? "border-destructive" : ""}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={addProductForm.control}
                  name="description"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Description</FormLabel>
                      <FormControl>
                        <Textarea placeholder="Product description" {...field} value={field.value || ""} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <div className="grid grid-cols-2 gap-4">
                  <FormField
                    control={addProductForm.control}
                    name="category"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Category</FormLabel>
                        <FormControl>
                          <Input placeholder="e.g., Signs, Banners" {...field} value={field.value || ""} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={addProductForm.control}
                    name="productTypeId"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Product Type</FormLabel>
                        <Select onValueChange={field.onChange} value={field.value || ""}>
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue placeholder="Select type" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            {productTypes?.map((pt) => (
                              <SelectItem key={pt.id} value={pt.id}>{pt.name}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
                <FormField
                  control={addProductForm.control}
                  name="isService"
                  render={({ field }) => (
                    <FormItem className="flex items-center justify-between rounded-lg border p-3 bg-muted/30">
                      <div className="space-y-0.5">
                        <FormLabel>Service / Fee</FormLabel>
                        <FormDescription>This is a service or fee (design, rush, shipping) rather than a physical product</FormDescription>
                      </div>
                      <FormControl>
                        <Switch checked={field.value || false} onCheckedChange={field.onChange} />
                      </FormControl>
                    </FormItem>
                  )}
                />
              </div>

              <Separator />

              {/* Section: Pricing Profile */}
              <div className="space-y-4">
                <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                  <Calculator className="h-4 w-4" />
                  Pricing Calculator
                </div>

                {/* Pricing Formula Selector (Optional) */}
                <FormField
                  control={addProductForm.control}
                  name="pricingFormulaId"
                  render={({ field }) => {
                    const selectedFormula = pricingFormulas?.find(f => f.id === field.value);
                    return (
                      <FormItem>
                        <FormLabel>Formula Library</FormLabel>
                        <Select
                          onValueChange={(val) => {
                            field.onChange(val === "__none__" ? null : val);
                            // When a formula is selected, update the profile key to match
                            if (val !== "__none__") {
                              const formula = pricingFormulas?.find(f => f.id === val);
                              if (formula) {
                                addProductForm.setValue("pricingProfileKey", formula.pricingProfileKey || "default");
                                if (formula.config) {
                                  addProductForm.setValue("pricingProfileConfig", formula.config as unknown as FlatGoodsConfig);
                                }
                              }
                            }
                          }}
                          value={field.value || "__none__"}
                        >
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue placeholder="Select a reusable formula (optional)" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            <SelectItem value="__none__">— No formula (configure manually) —</SelectItem>
                            {pricingFormulas?.map((formula) => (
                              <SelectItem key={formula.id} value={formula.id}>
                                {formula.name} ({formula.code})
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <FormDescription className="text-xs italic">
                          {selectedFormula
                            ? `Using "${selectedFormula.name}" formula. Profile and config inherited from formula.`
                            : "Optional: choose a saved pricing formula as a starting point."}
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    );
                  }}
                />

                {/* Show note when formula is selected */}
                {addPricingFormulaId && (
                  <div className="rounded-lg bg-blue-500/10 border border-blue-500/30 p-3 text-sm text-blue-700 dark:text-blue-300">
                    <strong>Using Pricing Formula:</strong> Profile and configuration below are inherited from the selected formula.
                    Changes to the formula in Settings will affect all products using it.
                  </div>
                )}

                <FormField
                  control={addProductForm.control}
                  name="pricingProfileKey"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Pricing Profile</FormLabel>
                      <Select
                        onValueChange={(val) => {
                          field.onChange(val);
                          // Set default formula for the selected profile
                          const profile = getProfile(val);
                          if (profile.usesFormula && profile.defaultFormula) {
                            addProductForm.setValue("pricingFormula", profile.defaultFormula);
                          }
                          // Initialize flat goods config if selecting flat_goods
                          if (val === "flat_goods" && !addProductForm.getValues("pricingProfileConfig")) {
                            addProductForm.setValue("pricingProfileConfig", {
                              sheetWidth: 48,
                              sheetHeight: 96,
                              allowRotation: true,
                              materialType: "sheet",
                              minPricePerItem: null,
                            });
                          }
                        }}
                        value={field.value || "default"}
                        disabled={!!addPricingFormulaId}
                      >
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Select pricing profile" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {Object.values(PRICING_PROFILES).map((profile) => (
                            <SelectItem key={profile.key} value={profile.key}>{profile.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormDescription className="text-xs italic">
                        {getProfile(field.value).description}
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                {/* Profile-specific notes */}
                {getProfile(addPricingProfileKey).requiresDimensions === false && (
                  <div className="rounded-lg bg-green-500/10 border border-green-500/30 p-3 text-sm text-green-700 dark:text-green-300">
                    <strong>Note:</strong> This profile does NOT require width/height. Dimensions will be hidden in the quote editor.
                  </div>
                )}

                {/* Flat Goods Configuration */}
                {addPricingProfileKey === "flat_goods" && (
                  <div className="rounded-lg border border-orange-500/30 bg-orange-500/5 p-4 space-y-4">
                    <div className="flex items-center gap-2 text-sm font-medium text-orange-700 dark:text-orange-300">
                      <Grid3X3 className="h-4 w-4" />
                      Flat Goods / Nesting Settings
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <Label className="text-xs">Sheet Width (in)</Label>
                        <Input
                          type="number"
                          step="0.01"
                          value={addPricingProfileConfig?.sheetWidth || 48}
                          onChange={(e) => {
                            const current = addProductForm.getValues("pricingProfileConfig") as FlatGoodsConfig || { sheetWidth: 48, sheetHeight: 96, allowRotation: true, materialType: "sheet" };
                            addProductForm.setValue("pricingProfileConfig", {
                              ...current,
                              sheetWidth: parseFloat(e.target.value) || 48,
                            });
                          }}
                        />
                      </div>
                      <div>
                        <Label className="text-xs">Sheet Height (in)</Label>
                        <Input
                          type="number"
                          step="0.01"
                          value={addPricingProfileConfig?.sheetHeight || 96}
                          onChange={(e) => {
                            const current = addProductForm.getValues("pricingProfileConfig") as FlatGoodsConfig || { sheetWidth: 48, sheetHeight: 96, allowRotation: true, materialType: "sheet" };
                            addProductForm.setValue("pricingProfileConfig", {
                              ...current,
                              sheetHeight: parseFloat(e.target.value) || 96,
                            });
                          }}
                        />
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <Label className="text-xs">Material Type</Label>
                        <Select
                          value={(addPricingProfileConfig as FlatGoodsConfig)?.materialType || "sheet"}
                          onValueChange={(val) => {
                            const current = addProductForm.getValues("pricingProfileConfig") as FlatGoodsConfig || { sheetWidth: 48, sheetHeight: 96, allowRotation: true, materialType: "sheet" };
                            addProductForm.setValue("pricingProfileConfig", {
                              ...current,
                              materialType: val as "sheet" | "roll",
                            });
                          }}
                        >
                          <SelectTrigger className="h-9">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="sheet">Sheet</SelectItem>
                            <SelectItem value="roll">Roll</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div>
                        <Label className="text-xs">Min Price Per Item ($)</Label>
                        <Input
                          type="number"
                          step="0.01"
                          placeholder="Optional"
                          value={(addPricingProfileConfig as FlatGoodsConfig)?.minPricePerItem || ""}
                          onChange={(e) => {
                            const current = addProductForm.getValues("pricingProfileConfig") as FlatGoodsConfig || { sheetWidth: 48, sheetHeight: 96, allowRotation: true, materialType: "sheet" };
                            addProductForm.setValue("pricingProfileConfig", {
                              ...current,
                              minPricePerItem: e.target.value ? parseFloat(e.target.value) : null,
                            });
                          }}
                        />
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Switch
                        checked={(addPricingProfileConfig as FlatGoodsConfig)?.allowRotation ?? true}
                        onCheckedChange={(val) => {
                          const current = addProductForm.getValues("pricingProfileConfig") as FlatGoodsConfig || { sheetWidth: 48, sheetHeight: 96, allowRotation: true, materialType: "sheet" };
                          addProductForm.setValue("pricingProfileConfig", {
                            ...current,
                            allowRotation: val,
                          });
                        }}
                      />
                      <Label className="text-sm">Allow rotation for optimal nesting</Label>
                    </div>
                  </div>
                )}

                {/* Formula field - shown for profiles that use formulas */}
                {getProfile(addPricingProfileKey).usesFormula && (
                  <FormField
                    control={addProductForm.control}
                    name="pricingFormula"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Pricing Formula</FormLabel>
                        <FormControl>
                          <Input
                            placeholder={getDefaultFormula(addPricingProfileKey)}
                            {...field}
                            value={field.value || ""}
                          />
                        </FormControl>
                        <FormDescription className="text-xs">
                          {addPricingProfileKey === "default" && "Variables: width, height, sqft (width×height÷144), p (price per sqft), q (quantity)"}
                          {addPricingProfileKey === "qty_only" && "Variables: q (quantity), unitPrice"}
                          {addPricingProfileKey === "fee" && "Variables: flatFee (this price is used as-is)"}
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                )}
              </div>

              <Separator />

              {/* Section: Materials */}
              <div className="space-y-4">
                <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                  <Layers className="h-4 w-4" />
                  Materials
                </div>
                <FormField
                  control={addProductForm.control}
                  name="primaryMaterialId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Primary Material</FormLabel>
                      <Select
                        onValueChange={(val) => field.onChange(val === "__none__" ? null : val)}
                        value={field.value || "__none__"}
                      >
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Select primary material" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="__none__">None</SelectItem>
                          {materials?.map((mat) => (
                            <SelectItem key={mat.id} value={mat.id}>
                              {mat.name} {mat.sku ? `(${mat.sku})` : ""}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormDescription className="text-xs">
                        Primary material is used for cost calculations and inventory; optional for service/fee products.
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <Separator />

              {/* Section: Options / Add-ons */}
              <div className="space-y-4">
                <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                  <Settings2 className="h-4 w-4" />
                  Options / Add-ons
                </div>

                {/* Basic Options - Quick Add Buttons */}
                <div className="space-y-3">
                  <div>
                    <h4 className="text-sm font-medium mb-2">Basic Options</h4>
                    <p className="text-xs text-muted-foreground mb-3">Quick-add common options with sensible defaults:</p>
                    <div className="grid grid-cols-2 gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          const current = addProductForm.getValues("optionsJson") || [];
                          addProductForm.setValue("optionsJson", [
                            ...current,
                            {
                              id: generateOptionId(),
                              label: "Printing",
                              type: "select",
                              priceMode: "flat",
                              amount: 0,
                              defaultSelected: false,
                              config: {
                                kind: "sides",
                                singleLabel: "Single Sided",
                                doubleLabel: "Double Sided",
                                defaultSide: "single",
                                pricingMode: "multiplier",
                                doublePriceMultiplier: 1.6
                              },
                              sortOrder: current.length + 1
                            }
                          ]);
                        }}
                      >
                        <Circle className="h-4 w-4 mr-2" />
                        + Sides (Single/Double)
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          const current = addProductForm.getValues("optionsJson") || [];
                          addProductForm.setValue("optionsJson", [
                            ...current,
                            {
                              id: generateOptionId(),
                              label: "Contour Cutting",
                              type: "checkbox",
                              priceMode: "percent_of_base",
                              percentBase: "media",
                              amount: 10,
                              defaultSelected: false,
                              sortOrder: current.length + 1
                            }
                          ]);
                        }}
                      >
                        <Scissors className="h-4 w-4 mr-2" />
                        + Contour Cutting
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          const current = addProductForm.getValues("optionsJson") || [];
                          addProductForm.setValue("optionsJson", [
                            ...current,
                            {
                              id: generateOptionId(),
                              label: "Grommets",
                              type: "checkbox",
                              priceMode: "flat_per_item",
                              amount: 0.25,
                              defaultSelected: false,
                              config: {
                                kind: "grommets",
                                defaultLocation: "all_corners",
                                locations: ["all_corners", "top_corners", "top_even", "custom"]
                              },
                              sortOrder: current.length + 1
                            }
                          ]);
                        }}
                      >
                        <Zap className="h-4 w-4 mr-2" />
                        + Grommets
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          const current = addProductForm.getValues("optionsJson") || [];
                          addProductForm.setValue("optionsJson", [
                            ...current,
                            {
                              id: generateOptionId(),
                              label: "Overlaminate",
                              type: "checkbox",
                              priceMode: "percent_of_base",
                              percentBase: "line",
                              amount: 25,
                              defaultSelected: false,
                              sortOrder: current.length + 1
                            }
                          ]);
                        }}
                      >
                        <Sparkles className="h-4 w-4 mr-2" />
                        + Overlaminate
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          const current = addProductForm.getValues("optionsJson") || [];
                          addProductForm.setValue("optionsJson", [
                            ...current,
                            {
                              id: generateOptionId(),
                              label: "Hems",
                              type: "checkbox",
                              priceMode: "flat_per_item",
                              amount: 2.00,
                              defaultSelected: false,
                              config: {
                                kind: "hems",
                                hemsChoices: ["none", "all_sides", "top_bottom", "left_right"],
                                defaultHems: "none"
                              },
                              sortOrder: current.length + 1
                            }
                          ]);
                        }}
                      >
                        <Zap className="h-4 w-4 mr-2" />
                        + Hems
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          const current = addProductForm.getValues("optionsJson") || [];
                          addProductForm.setValue("optionsJson", [
                            ...current,
                            {
                              id: generateOptionId(),
                              label: "Pole Pockets",
                              type: "checkbox",
                              priceMode: "flat_per_item",
                              amount: 5.00,
                              defaultSelected: false,
                              config: {
                                kind: "pole_pockets",
                                polePocketChoices: ["none", "top", "bottom", "top_bottom"],
                                defaultPolePocket: "none"
                              },
                              sortOrder: current.length + 1
                            }
                          ]);
                        }}
                      >
                        <Zap className="h-4 w-4 mr-2" />
                        + Pole Pockets
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          const current = addProductForm.getValues("optionsJson") || [];
                          addProductForm.setValue("optionsJson", [
                            ...current,
                            {
                              id: generateOptionId(),
                              label: "Artwork Upload",
                              type: "attachment",
                              priceMode: "flat",
                              amount: 0,
                              defaultSelected: false,
                              config: { kind: "generic" },
                              sortOrder: current.length + 1
                            }
                          ]);
                        }}
                      >
                        <Sparkles className="h-4 w-4 mr-2" />
                        + Attachment (File Upload)
                      </Button>
                    </div>
                  </div>

                  {/* Show added options (exclude thickness selector from basic view) */}
                  <ProductOptionsEditor
                    form={addProductForm}
                    fieldName="optionsJson"
                    excludeThickness={true}
                  />
                </div>

                {/* Advanced Options - Collapsible */}
                <Collapsible className="border rounded-lg p-4 bg-muted/20">
                  <CollapsibleTrigger asChild>
                    <Button type="button" variant="ghost" className="w-full justify-between p-0 h-auto font-medium">
                      <span className="text-sm">Advanced Options (multi-thickness & custom configs)</span>
                      <ChevronDown className="h-4 w-4" />
                    </Button>
                  </CollapsibleTrigger>
                  <CollapsibleContent className="pt-4 space-y-3">
                    <p className="text-xs text-muted-foreground mb-3">
                      Use these only if you need multiple thicknesses or highly customized options on a single product.
                    </p>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        const current = addProductForm.getValues("optionsJson") || [];
                        addProductForm.setValue("optionsJson", [
                          ...current,
                          {
                            id: generateOptionId(),
                            label: "",
                            type: "checkbox",
                            priceMode: "flat",
                            amount: 0,
                            defaultSelected: false,
                            sortOrder: current.length + 1
                          }
                        ]);
                      }}
                    >
                      <Plus className="h-4 w-4 mr-1" />
                      Add Custom Option
                    </Button>

                    {/* Show only thickness selector options in advanced */}
                    <ProductOptionsEditor
                      form={addProductForm}
                      fieldName="optionsJson"
                      onlyThickness={true}
                    />
                  </CollapsibleContent>
                </Collapsible>
              </div>

              <Separator />

              {/* Section: Status */}
              <div className="space-y-4">
                <FormField
                  control={addProductForm.control}
                  name="isActive"
                  render={({ field }) => (
                    <FormItem className="flex items-center justify-between rounded-lg border p-3">
                      <div className="space-y-0.5">
                        <FormLabel>Active</FormLabel>
                        <FormDescription>Product is available for use in quotes</FormDescription>
                      </div>
                      <FormControl>
                        <Switch checked={field.value ?? true} onCheckedChange={field.onChange} />
                      </FormControl>
                    </FormItem>
                  )}
                />
                <FormField
                  control={addProductForm.control}
                  name="requiresProductionJob"
                  render={({ field }) => (
                    <FormItem className="flex items-center justify-between rounded-lg border p-3">
                      <div className="space-y-0.5">
                        <FormLabel>Requires Production Job</FormLabel>
                        <FormDescription>Create a production job when this product is ordered</FormDescription>
                      </div>
                      <FormControl>
                        <Switch checked={field.value ?? true} onCheckedChange={field.onChange} />
                      </FormControl>
                    </FormItem>
                  )}
                />
                <FormField
                  control={addProductForm.control}
                  name="isTaxable"
                  render={({ field }) => (
                    <FormItem className="flex items-center justify-between rounded-lg border p-3">
                      <div className="space-y-0.5">
                        <FormLabel>Taxable Item</FormLabel>
                        <FormDescription>Apply sales tax to this product when sold</FormDescription>
                      </div>
                      <FormControl>
                        <Switch checked={field.value ?? true} onCheckedChange={field.onChange} />
                      </FormControl>
                    </FormItem>
                  )}
                />
              </div>

              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setIsAddDialogOpen(false)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={addProductMutation.isPending || addHasInvalidChoiceValues}>
                  {addProductMutation.isPending ? "Adding..." : "Add Product"}
                </Button>
              </DialogFooter>
              {addHasInvalidChoiceValues ? (
                <div className="text-xs text-destructive">Fix empty choice values before saving.</div>
              ) : null}
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      {/* Edit Product Dialog */}
      <Dialog open={!!editingProduct} onOpenChange={(open) => !open && setEditingProduct(null)}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit Product</DialogTitle>
            <DialogDescription>
              Update product details.
            </DialogDescription>
          </DialogHeader>
          <Form {...editProductForm}>
            <form
              ref={editFormRef}
              onSubmit={editProductForm.handleSubmit(
                (data) => editingProduct && updateProductMutation.mutate({ id: editingProduct.id, data: data as UpdateProduct }),
                handleEditFormError
              )}
              className="space-y-6"
            >
              {/* Section: Basic Info */}
              <div className="space-y-4">
                <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                  <Info className="h-4 w-4" />
                  Basic Info
                </div>
                <FormField
                  control={editProductForm.control}
                  name="name"
                  render={({ field, fieldState }) => (
                    <FormItem data-error={!!fieldState.error}>
                      <FormLabel><RequiredLabel required>Name</RequiredLabel></FormLabel>
                      <FormControl>
                        <Input
                          placeholder="Product name"
                          {...field}
                          value={field.value || ""}
                          className={fieldState.error ? "border-destructive" : ""}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={editProductForm.control}
                  name="description"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Description</FormLabel>
                      <FormControl>
                        <Textarea placeholder="Product description" {...field} value={field.value || ""} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <div className="grid grid-cols-2 gap-4">
                  <FormField
                    control={editProductForm.control}
                    name="category"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Category</FormLabel>
                        <FormControl>
                          <Input placeholder="e.g., Signs, Banners" {...field} value={field.value || ""} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={editProductForm.control}
                    name="productTypeId"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Product Type</FormLabel>
                        <Select onValueChange={field.onChange} value={field.value || ""}>
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue placeholder="Select type" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            {productTypes?.map((pt) => (
                              <SelectItem key={pt.id} value={pt.id}>{pt.name}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
                <FormField
                  control={editProductForm.control}
                  name="isService"
                  render={({ field }) => (
                    <FormItem className="flex items-center justify-between rounded-lg border p-3 bg-muted/30">
                      <div className="space-y-0.5">
                        <FormLabel>Service / Fee</FormLabel>
                        <FormDescription>This is a service or fee (design, rush, shipping) rather than a physical product</FormDescription>
                      </div>
                      <FormControl>
                        <Switch checked={field.value || false} onCheckedChange={field.onChange} />
                      </FormControl>
                    </FormItem>
                  )}
                />
              </div>

              <Separator />

              {/* Section: Pricing Profile */}
              <div className="space-y-4">
                <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                  <Calculator className="h-4 w-4" />
                  Pricing Calculator
                </div>

                {/* Pricing Formula Selector (Optional) */}
                <FormField
                  control={editProductForm.control}
                  name="pricingFormulaId"
                  render={({ field }) => {
                    const selectedFormula = pricingFormulas?.find(f => f.id === field.value);
                    return (
                      <FormItem>
                        <FormLabel>Formula Library</FormLabel>
                        <Select
                          onValueChange={(val) => {
                            field.onChange(val === "__none__" ? null : val);
                            // When a formula is selected, update the profile key to match
                            if (val !== "__none__") {
                              const formula = pricingFormulas?.find(f => f.id === val);
                              if (formula) {
                                editProductForm.setValue("pricingProfileKey", formula.pricingProfileKey || "default");
                                if (formula.config) {
                                  editProductForm.setValue("pricingProfileConfig", formula.config as unknown as FlatGoodsConfig);
                                }
                              }
                            }
                          }}
                          value={field.value || "__none__"}
                        >
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue placeholder="Select a reusable formula (optional)" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            <SelectItem value="__none__">— No formula (configure manually) —</SelectItem>
                            {pricingFormulas?.map((formula) => (
                              <SelectItem key={formula.id} value={formula.id}>
                                {formula.name} ({formula.code})
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <FormDescription className="text-xs italic">
                          {selectedFormula
                            ? `Using "${selectedFormula.name}" formula. Profile and config inherited from formula.`
                            : "Optional: choose a saved pricing formula as a starting point."}
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    );
                  }}
                />

                {/* Show note when formula is selected */}
                {editPricingFormulaId && (
                  <div className="rounded-lg bg-blue-500/10 border border-blue-500/30 p-3 text-sm text-blue-700 dark:text-blue-300">
                    <strong>Using Pricing Formula:</strong> Profile and configuration below are inherited from the selected formula.
                    Changes to the formula in Settings will affect all products using it.
                  </div>
                )}

                <FormField
                  control={editProductForm.control}
                  name="pricingProfileKey"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Pricing Profile</FormLabel>
                      <Select
                        onValueChange={(val) => {
                          field.onChange(val);
                          // Set default formula for the selected profile
                          const profile = getProfile(val);
                          if (profile.usesFormula && profile.defaultFormula) {
                            editProductForm.setValue("pricingFormula", profile.defaultFormula);
                          }
                          // Initialize flat goods config if selecting flat_goods
                          if (val === "flat_goods" && !editProductForm.getValues("pricingProfileConfig")) {
                            editProductForm.setValue("pricingProfileConfig", {
                              sheetWidth: 48,
                              sheetHeight: 96,
                              allowRotation: true,
                              materialType: "sheet",
                              minPricePerItem: null,
                            });
                          }
                        }}
                        value={field.value || "default"}
                        disabled={!!editPricingFormulaId}
                      >
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Select pricing profile" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {Object.values(PRICING_PROFILES).map((profile) => (
                            <SelectItem key={profile.key} value={profile.key}>{profile.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormDescription className="text-xs italic">
                        {getProfile(field.value).description}
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                {/* Profile-specific notes */}
                {getProfile(editPricingProfileKey).requiresDimensions === false && (
                  <div className="rounded-lg bg-green-500/10 border border-green-500/30 p-3 text-sm text-green-700 dark:text-green-300">
                    <strong>Note:</strong> This profile does NOT require width/height. Dimensions will be hidden in the quote editor.
                  </div>
                )}

                {/* Flat Goods Configuration */}
                {editPricingProfileKey === "flat_goods" && (
                  <div className="rounded-lg border border-orange-500/30 bg-orange-500/5 p-4 space-y-4">
                    <div className="flex items-center gap-2 text-sm font-medium text-orange-700 dark:text-orange-300">
                      <Grid3X3 className="h-4 w-4" />
                      Flat Goods / Nesting Settings
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <Label className="text-xs">Sheet Width (in)</Label>
                        <Input
                          type="number"
                          step="0.01"
                          value={(editPricingProfileConfig as FlatGoodsConfig)?.sheetWidth || 48}
                          onChange={(e) => {
                            const current = editProductForm.getValues("pricingProfileConfig") as FlatGoodsConfig || { sheetWidth: 48, sheetHeight: 96, allowRotation: true, materialType: "sheet" };
                            editProductForm.setValue("pricingProfileConfig", {
                              ...current,
                              sheetWidth: parseFloat(e.target.value) || 48,
                            });
                          }}
                        />
                      </div>
                      <div>
                        <Label className="text-xs">Sheet Height (in)</Label>
                        <Input
                          type="number"
                          step="0.01"
                          value={(editPricingProfileConfig as FlatGoodsConfig)?.sheetHeight || 96}
                          onChange={(e) => {
                            const current = editProductForm.getValues("pricingProfileConfig") as FlatGoodsConfig || { sheetWidth: 48, sheetHeight: 96, allowRotation: true, materialType: "sheet" };
                            editProductForm.setValue("pricingProfileConfig", {
                              ...current,
                              sheetHeight: parseFloat(e.target.value) || 96,
                            });
                          }}
                        />
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <Label className="text-xs">Material Type</Label>
                        <Select
                          value={(editPricingProfileConfig as FlatGoodsConfig)?.materialType || "sheet"}
                          onValueChange={(val) => {
                            const current = editProductForm.getValues("pricingProfileConfig") as FlatGoodsConfig || { sheetWidth: 48, sheetHeight: 96, allowRotation: true, materialType: "sheet" };
                            editProductForm.setValue("pricingProfileConfig", {
                              ...current,
                              materialType: val as "sheet" | "roll",
                            });
                          }}
                        >
                          <SelectTrigger className="h-9">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="sheet">Sheet</SelectItem>
                            <SelectItem value="roll">Roll</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div>
                        <Label className="text-xs">Min Price Per Item ($)</Label>
                        <Input
                          type="number"
                          step="0.01"
                          placeholder="Optional"
                          value={(editPricingProfileConfig as FlatGoodsConfig)?.minPricePerItem || ""}
                          onChange={(e) => {
                            const current = editProductForm.getValues("pricingProfileConfig") as FlatGoodsConfig || { sheetWidth: 48, sheetHeight: 96, allowRotation: true, materialType: "sheet" };
                            editProductForm.setValue("pricingProfileConfig", {
                              ...current,
                              minPricePerItem: e.target.value ? parseFloat(e.target.value) : null,
                            });
                          }}
                        />
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Switch
                        checked={(editPricingProfileConfig as FlatGoodsConfig)?.allowRotation ?? true}
                        onCheckedChange={(val) => {
                          const current = editProductForm.getValues("pricingProfileConfig") as FlatGoodsConfig || { sheetWidth: 48, sheetHeight: 96, allowRotation: true, materialType: "sheet" };
                          editProductForm.setValue("pricingProfileConfig", {
                            ...current,
                            allowRotation: val,
                          });
                        }}
                      />
                      <Label className="text-sm">Allow rotation for optimal nesting</Label>
                    </div>
                  </div>
                )}

                {/* Formula field - shown for profiles that use formulas */}
                {getProfile(editPricingProfileKey).usesFormula && (
                  <FormField
                    control={editProductForm.control}
                    name="pricingFormula"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Pricing Formula</FormLabel>
                        <FormControl>
                          <Input
                            placeholder={getDefaultFormula(editPricingProfileKey)}
                            {...field}
                            value={field.value || ""}
                          />
                        </FormControl>
                        <FormDescription className="text-xs">
                          {editPricingProfileKey === "default" && "Variables: width, height, sqft (width×height÷144), p (price per sqft), q (quantity)"}
                          {(editPricingProfileKey === "qty_only" || !editPricingProfileKey) && "Variables: q (quantity), unitPrice"}
                          {editPricingProfileKey === "fee" && "Variables: flatFee (this price is used as-is)"}
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                )}
              </div>

              <Separator />

              {/* Section: Materials */}
              <div className="space-y-4">
                <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                  <Layers className="h-4 w-4" />
                  Materials
                </div>
                <FormField
                  control={editProductForm.control}
                  name="primaryMaterialId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Primary Material</FormLabel>
                      <Select
                        onValueChange={(val) => field.onChange(val === "__none__" ? null : val)}
                        value={field.value || "__none__"}
                      >
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Select primary material" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="__none__">None</SelectItem>
                          {materials?.map((mat) => (
                            <SelectItem key={mat.id} value={mat.id}>
                              {mat.name} {mat.sku ? `(${mat.sku})` : ""}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormDescription className="text-xs">
                        This material is used for cost, nesting, and inventory. Extra materials like laminate are configured as options.
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <Separator />

              {/* Section: Options / Add-ons */}
              <div className="space-y-4">
                <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                  <Settings2 className="h-4 w-4" />
                  Options / Add-ons
                </div>

                {/* Basic Options - Quick Add Buttons */}
                <div className="space-y-3">
                  <div>
                    <h4 className="text-sm font-medium mb-2">Basic Options</h4>
                    <p className="text-xs text-muted-foreground mb-3">Quick-add common options with sensible defaults:</p>
                    <div className="grid grid-cols-2 gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          const current = editProductForm.getValues("optionsJson") || [];
                          const maxSortOrder = current.reduce((max, opt) => Math.max(max, opt.sortOrder || 0), 0);
                          editProductForm.setValue("optionsJson", [
                            ...current,
                            {
                              id: generateOptionId(),
                              label: "Printing",
                              type: "select",
                              priceMode: "flat",
                              amount: 0,
                              defaultSelected: false,
                              config: {
                                kind: "sides",
                                singleLabel: "Single Sided",
                                doubleLabel: "Double Sided",
                                defaultSide: "single",
                                pricingMode: "multiplier",
                                doublePriceMultiplier: 1.6
                              },
                              sortOrder: maxSortOrder + 1
                            }
                          ]);
                        }}
                      >
                        <Circle className="h-4 w-4 mr-2" />
                        + Sides (Single/Double)
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          const current = editProductForm.getValues("optionsJson") || [];
                          const maxSortOrder = current.reduce((max, opt) => Math.max(max, opt.sortOrder || 0), 0);
                          editProductForm.setValue("optionsJson", [
                            ...current,
                            {
                              id: generateOptionId(),
                              label: "Contour Cutting",
                              type: "checkbox",
                              priceMode: "percent_of_base",
                              percentBase: "media",
                              amount: 10,
                              defaultSelected: false,
                              sortOrder: maxSortOrder + 1
                            }
                          ]);
                        }}
                      >
                        <Scissors className="h-4 w-4 mr-2" />
                        + Contour Cutting
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          const current = editProductForm.getValues("optionsJson") || [];
                          const maxSortOrder = current.reduce((max, opt) => Math.max(max, opt.sortOrder || 0), 0);
                          editProductForm.setValue("optionsJson", [
                            ...current,
                            {
                              id: generateOptionId(),
                              label: "Grommets",
                              type: "checkbox",
                              priceMode: "flat_per_item",
                              amount: 0.25,
                              defaultSelected: false,
                              config: {
                                kind: "grommets",
                                defaultLocation: "all_corners",
                                locations: ["all_corners", "top_corners", "top_even", "custom"]
                              },
                              sortOrder: maxSortOrder + 1
                            }
                          ]);
                        }}
                      >
                        <Zap className="h-4 w-4 mr-2" />
                        + Grommets
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          const current = editProductForm.getValues("optionsJson") || [];
                          const maxSortOrder = current.reduce((max, opt) => Math.max(max, opt.sortOrder || 0), 0);
                          editProductForm.setValue("optionsJson", [
                            ...current,
                            {
                              id: generateOptionId(),
                              label: "Overlaminate",
                              type: "checkbox",
                              priceMode: "percent_of_base",
                              percentBase: "line",
                              amount: 25,
                              defaultSelected: false,
                              sortOrder: maxSortOrder + 1
                            }
                          ]);
                        }}
                      >
                        <Sparkles className="h-4 w-4 mr-2" />
                        + Overlaminate
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          const current = editProductForm.getValues("optionsJson") || [];
                          const maxSortOrder = current.reduce((max, opt) => Math.max(max, opt.sortOrder || 0), 0);
                          editProductForm.setValue("optionsJson", [
                            ...current,
                            {
                              id: generateOptionId(),
                              label: "Hems",
                              type: "checkbox",
                              priceMode: "flat_per_item",
                              amount: 2.00,
                              defaultSelected: false,
                              config: {
                                kind: "hems",
                                hemsChoices: ["none", "all_sides", "top_bottom", "left_right"],
                                defaultHems: "none"
                              },
                              sortOrder: maxSortOrder + 1
                            }
                          ]);
                        }}
                      >
                        <Zap className="h-4 w-4 mr-2" />
                        + Hems
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          const current = editProductForm.getValues("optionsJson") || [];
                          const maxSortOrder = current.reduce((max, opt) => Math.max(max, opt.sortOrder || 0), 0);
                          editProductForm.setValue("optionsJson", [
                            ...current,
                            {
                              id: generateOptionId(),
                              label: "Pole Pockets",
                              type: "checkbox",
                              priceMode: "flat_per_item",
                              amount: 5.00,
                              defaultSelected: false,
                              config: {
                                kind: "pole_pockets",
                                polePocketChoices: ["none", "top", "bottom", "top_bottom"],
                                defaultPolePocket: "none"
                              },
                              sortOrder: maxSortOrder + 1
                            }
                          ]);
                        }}
                      >
                        <Zap className="h-4 w-4 mr-2" />
                        + Pole Pockets
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          const current = editProductForm.getValues("optionsJson") || [];
                          const maxSortOrder = current.reduce((max, opt) => Math.max(max, opt.sortOrder || 0), 0);
                          editProductForm.setValue("optionsJson", [
                            ...current,
                            {
                              id: generateOptionId(),
                              label: "Artwork Upload",
                              type: "attachment",
                              priceMode: "flat",
                              amount: 0,
                              defaultSelected: false,
                              config: { kind: "generic" },
                              sortOrder: maxSortOrder + 1
                            }
                          ]);
                        }}
                      >
                        <Sparkles className="h-4 w-4 mr-2" />
                        + Attachment (File Upload)
                      </Button>
                    </div>
                  </div>

                  {/* Show added options (exclude thickness selector from basic view) */}
                  <ProductOptionsEditor
                    form={editProductForm}
                    fieldName="optionsJson"
                    excludeThickness={true}
                  />
                </div>

                {/* Advanced Options - Collapsible */}
                <Collapsible className="border rounded-lg p-4 bg-muted/20">
                  <CollapsibleTrigger asChild>
                    <Button type="button" variant="ghost" className="w-full justify-between p-0 h-auto font-medium">
                      <span className="text-sm">Advanced Options (multi-thickness & custom configs)</span>
                      <ChevronDown className="h-4 w-4" />
                    </Button>
                  </CollapsibleTrigger>
                  <CollapsibleContent className="pt-4 space-y-3">
                    <p className="text-xs text-muted-foreground mb-3">
                      Use these only if you need multiple thicknesses or highly customized options on a single product.
                    </p>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        const current = editProductForm.getValues("optionsJson") || [];
                        const maxSortOrder = current.reduce((max, opt) => Math.max(max, opt.sortOrder || 0), 0);
                        editProductForm.setValue("optionsJson", [
                          ...current,
                          {
                            id: generateOptionId(),
                            label: "",
                            type: "checkbox",
                            priceMode: "flat",
                            amount: 0,
                            defaultSelected: false,
                            sortOrder: maxSortOrder + 1
                          }
                        ]);
                      }}
                    >
                      <Plus className="h-4 w-4 mr-1" />
                      Add Custom Option
                    </Button>

                    {/* Show only thickness selector options in advanced */}
                    <ProductOptionsEditor
                      form={editProductForm}
                      fieldName="optionsJson"
                      onlyThickness={true}
                    />
                  </CollapsibleContent>
                </Collapsible>
              </div>

              <Separator />

              {/* Section: Status */}
              <div className="space-y-4">
                <FormField
                  control={editProductForm.control}
                  name="isActive"
                  render={({ field }) => (
                    <FormItem className="flex items-center justify-between rounded-lg border p-3">
                      <div className="space-y-0.5">
                        <FormLabel>Active</FormLabel>
                        <FormDescription>Product is available for use in quotes</FormDescription>
                      </div>
                      <FormControl>
                        <Switch checked={field.value ?? true} onCheckedChange={field.onChange} />
                      </FormControl>
                    </FormItem>
                  )}
                />
                <FormField
                  control={editProductForm.control}
                  name="requiresProductionJob"
                  render={({ field }) => (
                    <FormItem className="flex items-center justify-between rounded-lg border p-3">
                      <div className="space-y-0.5">
                        <FormLabel>Requires Production Job</FormLabel>
                        <FormDescription>Create a production job when this product is ordered</FormDescription>
                      </div>
                      <FormControl>
                        <Switch checked={field.value ?? true} onCheckedChange={field.onChange} />
                      </FormControl>
                    </FormItem>
                  )}
                />
                <FormField
                  control={editProductForm.control}
                  name="isTaxable"
                  render={({ field }) => (
                    <FormItem className="flex items-center justify-between rounded-lg border p-3">
                      <div className="space-y-0.5">
                        <FormLabel>Taxable Item</FormLabel>
                        <FormDescription>Apply sales tax to this product when sold</FormDescription>
                      </div>
                      <FormControl>
                        <Switch checked={field.value ?? true} onCheckedChange={field.onChange} />
                      </FormControl>
                    </FormItem>
                  )}
                />
              </div>

              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setEditingProduct(null)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={updateProductMutation.isPending || editHasInvalidChoiceValues}>
                  {updateProductMutation.isPending ? "Saving..." : "Save Changes"}
                </Button>
              </DialogFooter>
              {editHasInvalidChoiceValues ? (
                <div className="text-xs text-destructive">Fix empty choice values before saving.</div>
              ) : null}
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// Simple Material Selector Component
function MaterialSelector({ value, onChange }: { value: string; onChange: (materialId: string) => void }) {
  const { data: materials } = useMaterials();

  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="h-9">
        <SelectValue placeholder="Select material" />
      </SelectTrigger>
      <SelectContent>
        {(materials || []).map((material: any) => (
          <SelectItem key={material.id} value={material.id}>
            {material.name} - {material.width}×{material.height}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

// Product Options Editor Component with full grommets and sides support
function ProductOptionsEditor({
  form,
  fieldName,
  excludeThickness = false,
  onlyThickness = false
}: {
  form: any;
  fieldName: string;
  excludeThickness?: boolean;
  onlyThickness?: boolean;
}) {
  const allOptions: ProductOptionItem[] = form.watch(fieldName) || [];

  // Filter options based on thickness config
  const options = allOptions.filter(opt => {
    const isThicknessOption = opt.config?.kind === "thickness";
    if (onlyThickness) return isThicknessOption;
    if (excludeThickness) return !isThicknessOption;
    return true;
  });

  const updateOption = (index: number, updates: Partial<ProductOptionItem>) => {
    const current = [...(form.getValues(fieldName) || [])];
    current[index] = { ...current[index], ...updates };
    form.setValue(fieldName, current);
  };

  const removeOption = (index: number) => {
    const current = [...(form.getValues(fieldName) || [])];
    current.splice(index, 1);
    form.setValue(fieldName, current);
  };

  const moveOption = (index: number, direction: "up" | "down") => {
    const current = [...(form.getValues(fieldName) || [])];
    const newIndex = direction === "up" ? index - 1 : index + 1;
    if (newIndex < 0 || newIndex >= current.length) return;

    // Swap elements
    [current[index], current[newIndex]] = [current[newIndex], current[index]];

    // Update sortOrder values
    current.forEach((opt, idx) => {
      opt.sortOrder = idx + 1;
    });

    form.setValue(fieldName, current);
  };

  const updateConfig = (index: number, configUpdates: Partial<ProductOptionItem["config"]>) => {
    const current = [...(form.getValues(fieldName) || [])];
    current[index] = {
      ...current[index],
      config: { ...(current[index].config || {}), ...configUpdates }
    };
    form.setValue(fieldName, current);
  };

  if (options.length === 0) {
    if (onlyThickness) {
      return (
        <div className="text-sm text-muted-foreground italic p-3 border border-dashed rounded-lg text-center">
          No thickness selector configured.
        </div>
      );
    }
    return (
      <div className="text-sm text-muted-foreground italic p-4 border border-dashed rounded-lg text-center">
        No options added yet. Use the quick-add buttons above to add common options.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {options
        .sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0))
        .map((opt, index) => (
          <React.Fragment key={opt.id || index}>
            <div className="flex items-start gap-3 p-3 border rounded-lg bg-muted/20">
              {/* Reorder Controls */}
              <div className="flex flex-col gap-1 pt-6">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-6 w-6 p-0"
                  onClick={() => moveOption(index, "up")}
                  disabled={index === 0}
                >
                  <ChevronUp className="h-4 w-4" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-6 w-6 p-0"
                  onClick={() => moveOption(index, "down")}
                  disabled={index === options.length - 1}
                >
                  <ChevronDown className="h-4 w-4" />
                </Button>
              </div>

              <div className="flex-1 space-y-3">
              </div>

              <div className="flex-1 space-y-3">
                {/* Main option fields */}
                <div className="grid grid-cols-5 gap-3">
                  <div className="col-span-2">
                    <Label className="text-xs">Label</Label>
                    <Input
                      placeholder="e.g., Include Yard Stakes"
                      value={opt.label}
                      onChange={(e) => updateOption(index, { label: e.target.value })}
                      className="h-9"
                    />
                  </div>
                  <div>
                    <Label className="text-xs">Type</Label>
                    <Select
                      value={opt.type}
                      onValueChange={(val) => updateOption(index, { type: val as any })}
                    >
                      <SelectTrigger className="h-9">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="checkbox">Checkbox</SelectItem>
                        <SelectItem value="quantity">Quantity</SelectItem>
                        <SelectItem value="toggle">Toggle</SelectItem>
                        <SelectItem value="select">Select</SelectItem>
                        <SelectItem value="attachment">Attachment (File Upload)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  {opt.type !== "attachment" && (
                    <div>
                      <Label className="text-xs">Price Mode</Label>
                      <Select
                        value={opt.priceMode}
                        onValueChange={(val) => updateOption(index, { priceMode: val as any })}
                      >
                        <SelectTrigger className="h-9">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="flat">Flat</SelectItem>
                          <SelectItem value="per_qty">Per Qty</SelectItem>
                          <SelectItem value="per_sqft">Per SqFt</SelectItem>
                          <SelectItem value="flat_per_item">Flat Per Item</SelectItem>
                          <SelectItem value="percent_of_base">Percent of Base</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                  {opt.type !== "attachment" && (
                    <div>
                      <Label className="text-xs">
                        Amount {opt.priceMode === "percent_of_base" ? "(%)" : "($)"}
                      </Label>
                      <Input
                        type="number"
                        step="0.01"
                        placeholder={opt.priceMode === "percent_of_base" ? "10 = 10%" : "0.00"}
                        value={opt.amount || ""}
                        onChange={(e) => updateOption(index, { amount: parseFloat(e.target.value) || 0 })}
                        className="h-9"
                      />
                      {opt.priceMode === "percent_of_base" && (
                        <p className="text-xs text-muted-foreground mt-1">
                          {opt.percentBase === "media"
                            ? "Percentage of media/printing cost only (excludes finishing add-ons)."
                            : "Percentage of base line price (before other add-ons)."}
                        </p>
                      )}
                    </div>
                  )}
                  {opt.type !== "attachment" && opt.priceMode === "percent_of_base" && (
                    <div>
                      <Label className="text-xs">Percent of</Label>
                      <Select
                        value={opt.percentBase || "line"}
                        onValueChange={(val) => updateOption(index, { percentBase: val as "media" | "line" })}
                      >
                        <SelectTrigger className="h-9">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="line">Full Line Total</SelectItem>
                          <SelectItem value="media">Media Cost Only</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                </div>

                {/* Default selected & special config type */}
                {opt.type === "attachment" ? (
                  <div className="mt-2 text-xs text-muted-foreground">
                    Files for this product will be uploaded via the line-item attachments panel. No additional option configuration is required here.
                  </div>
                ) : (
                  <div className="grid grid-cols-3 gap-3">
                    <div className="flex items-center space-x-2">
                      <input
                        type="checkbox"
                        id={`default-${opt.id}`}
                        checked={opt.defaultSelected || false}
                        onChange={(e) => updateOption(index, { defaultSelected: e.target.checked })}
                        className="h-4 w-4 rounded border-gray-300"
                      />
                      <label htmlFor={`default-${opt.id}`} className="text-xs font-medium cursor-pointer">
                        Default On <span className="text-muted-foreground">(auto-selected on new quotes)</span>
                      </label>
                    </div>
                    <div className="col-span-2">
                      <Label className="text-xs">Special Config</Label>
                      <Select
                        value={opt.config?.kind || "generic"}
                        onValueChange={(val) => {
                          if (val === "generic") {
                            updateConfig(index, { kind: "generic" });
                          } else if (val === "grommets") {
                            updateConfig(index, {
                              kind: "grommets",
                              defaultLocation: "all_corners",
                              locations: ["all_corners", "top_corners", "top_even", "custom"],
                              spacingOptions: [12, 24],
                              defaultSpacingInches: 24,
                            });
                          } else if (val === "hems") {
                            updateConfig(index, {
                              kind: "hems",
                              hemsChoices: ["none", "all_sides", "top_bottom", "left_right"],
                              defaultHems: "none",
                            });
                          } else if (val === "pole_pockets") {
                            updateConfig(index, {
                              kind: "pole_pockets",
                              polePocketChoices: ["none", "top", "bottom", "top_bottom"],
                              defaultPolePocket: "none",
                            });
                          } else if (val === "sides") {
                            updateConfig(index, {
                              kind: "sides",
                              singleLabel: "Single Sided",
                              doubleLabel: "Double Sided",
                              defaultSide: "single",
                              pricingMode: "multiplier",
                              doublePriceMultiplier: 1.6,
                            });
                          } else if (val === "thickness") {
                            updateConfig(index, {
                              kind: "thickness",
                              defaultThicknessKey: "4mm",
                              thicknessVariants: [
                                {
                                  key: "4mm",
                                  label: "4mm",
                                  materialId: "",
                                  pricingMode: "multiplier",
                                  priceMultiplier: 1.0,
                                },
                              ],
                            });
                          }
                        }}
                      >
                        <SelectTrigger className="h-9">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="generic">None</SelectItem>
                          <SelectItem value="grommets">Grommets</SelectItem>
                          <SelectItem value="hems">Hems</SelectItem>
                          <SelectItem value="pole_pockets">Pole Pockets</SelectItem>
                          <SelectItem value="sides">Sides (Single/Double)</SelectItem>
                          <SelectItem value="thickness">Thickness Selector</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                )}

                {/* Grommets Sub-Config */}
                {opt.config?.kind === "grommets" && (
                  <div className="pl-4 border-l-2 border-orange-500/50 space-y-2">
                    <div className="text-xs font-semibold text-orange-600">Grommet Configuration</div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <Label className="text-xs">Default Location</Label>
                        <Select
                          value={opt.config.defaultLocation || "all_corners"}
                          onValueChange={(val) => updateConfig(index, { defaultLocation: val as any })}
                        >
                          <SelectTrigger className="h-9">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="all_corners">All Corners</SelectItem>
                            <SelectItem value="top_corners">Top Corners</SelectItem>
                            <SelectItem value="top_even">Top - Evenly Spaced</SelectItem>
                            <SelectItem value="custom">Custom</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      {opt.config.defaultLocation === "top_even" && (
                        <div>
                          <Label className="text-xs">Default Spacing Count</Label>
                          <Input
                            type="number"
                            min="2"
                            placeholder="e.g., 4"
                            value={opt.config.defaultSpacingCount || ""}
                            onChange={(e) => updateConfig(index, { defaultSpacingCount: parseInt(e.target.value) || undefined })}
                            className="h-9"
                          />
                        </div>
                      )}
                    </div>
                    {opt.config.defaultLocation === "custom" && (
                      <div>
                        <Label className="text-xs">Custom Notes (Optional)</Label>
                        <Textarea
                          placeholder="Enter default notes for custom grommet placement"
                          value={opt.config.customNotes || ""}
                          onChange={(e) => updateConfig(index, { customNotes: e.target.value })}
                          rows={2}
                          className="text-xs"
                        />
                      </div>
                    )}
                    {/* Spacing Options for grommets */}
                    <div>
                      <Label className="text-xs">Spacing Options (inches)</Label>
                      <Input
                        placeholder="e.g., 12,24"
                        value={(opt.config.spacingOptions || []).join(",")}
                        onChange={(e) => {
                          const values = e.target.value.split(",").map(v => parseInt(v.trim())).filter(v => !isNaN(v));
                          updateConfig(index, { spacingOptions: values });
                        }}
                        className="h-9"
                      />
                      <p className="text-xs text-muted-foreground mt-1">Comma-separated values (e.g., 12,24 for 12" and 24" spacing)</p>
                    </div>
                    <div>
                      <Label className="text-xs">Default Spacing (inches)</Label>
                      <Input
                        type="number"
                        min="1"
                        placeholder="24"
                        value={opt.config.defaultSpacingInches || ""}
                        onChange={(e) => updateConfig(index, { defaultSpacingInches: parseInt(e.target.value) || undefined })}
                        className="h-9"
                      />
                    </div>
                  </div>
                )}

                {/* Hems Sub-Config */}
                {opt.config?.kind === "hems" && (
                  <div className="pl-4 border-l-2 border-blue-500/50 space-y-2">
                    <div className="text-xs font-semibold text-blue-600">Hems Configuration</div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <Label className="text-xs">Default Hem Style</Label>
                        <Select
                          value={opt.config.defaultHems || "none"}
                          onValueChange={(val) => updateConfig(index, { defaultHems: val as "none" | "all_sides" | "top_bottom" | "left_right" })}
                        >
                          <SelectTrigger className="h-9">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="none">None</SelectItem>
                            <SelectItem value="all_sides">All Sides</SelectItem>
                            <SelectItem value="top_bottom">Top & Bottom</SelectItem>
                            <SelectItem value="left_right">Left & Right</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div>
                        <Label className="text-xs">Available Choices</Label>
                        <Input
                          placeholder="none,all_sides,top_bottom,left_right"
                          value={(opt.config.hemsChoices || []).join(",")}
                          onChange={(e) => {
                            const choices = e.target.value.split(",").map(v => v.trim()).filter(Boolean);
                            updateConfig(index, { hemsChoices: choices });
                          }}
                          className="h-9"
                        />
                      </div>
                    </div>
                  </div>
                )}

                {/* Pole Pockets Sub-Config */}
                {opt.config?.kind === "pole_pockets" && (
                  <div className="pl-4 border-l-2 border-green-500/50 space-y-2">
                    <div className="text-xs font-semibold text-green-600">Pole Pockets Configuration</div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <Label className="text-xs">Default Pole Pocket</Label>
                        <Select
                          value={opt.config.defaultPolePocket || "none"}
                          onValueChange={(val: "none" | "top" | "bottom" | "top_bottom") => updateConfig(index, { defaultPolePocket: val })}
                        >
                          <SelectTrigger className="h-9">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="none">None</SelectItem>
                            <SelectItem value="top">Top</SelectItem>
                            <SelectItem value="bottom">Bottom</SelectItem>
                            <SelectItem value="top_bottom">Top & Bottom</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div>
                        <Label className="text-xs">Available Choices</Label>
                        <Input
                          placeholder="none,top,bottom,top_bottom"
                          value={(opt.config.polePocketChoices || []).join(",")}
                          onChange={(e) => {
                            const choices = e.target.value.split(",").map(v => v.trim()).filter(Boolean);
                            updateConfig(index, { polePocketChoices: choices });
                          }}
                          className="h-9"
                        />
                      </div>
                    </div>
                  </div>
                )}

                {/* Sides Sub-Config */}
                {opt.config?.kind === "sides" && (
                  <div className="pl-4 border-l-2 border-purple-500/50 space-y-3">
                    <div className="text-xs font-semibold text-purple-600">Single/Double Sided Configuration</div>

                    {/* Pricing Mode Selector */}
                    <div>
                      <Label className="text-xs">Sides Pricing Mode</Label>
                      <Select
                        value={opt.config.pricingMode || "multiplier"}
                        onValueChange={(val: "multiplier" | "volume") => {
                          updateConfig(index, { pricingMode: val });
                        }}
                      >
                        <SelectTrigger className="h-9">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="multiplier">Multiplier</SelectItem>
                          <SelectItem value="volume">Per-Sheet Volume Pricing</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    {/* Default Side Selector */}
                    <div>
                      <Label className="text-xs">Default Side</Label>
                      <Select
                        value={opt.config.defaultSide || "single"}
                        onValueChange={(val: "single" | "double") => {
                          updateConfig(index, { defaultSide: val });
                        }}
                      >
                        <SelectTrigger className="h-9">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="single">{opt.config.singleLabel || "Single Sided"}</SelectItem>
                          <SelectItem value="double">{opt.config.doubleLabel || "Double Sided"}</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    {/* Multiplier Mode UI */}
                    {(!opt.config.pricingMode || opt.config.pricingMode === "multiplier") && (
                      <div className="grid grid-cols-3 gap-3">
                        <div>
                          <Label className="text-xs">Single Label</Label>
                          <Input
                            placeholder="Single Sided"
                            value={opt.config.singleLabel || ""}
                            onChange={(e) => updateConfig(index, { singleLabel: e.target.value })}
                            className="h-9"
                          />
                        </div>
                        <div>
                          <Label className="text-xs">Double Label</Label>
                          <Input
                            placeholder="Double Sided"
                            value={opt.config.doubleLabel || ""}
                            onChange={(e) => updateConfig(index, { doubleLabel: e.target.value })}
                            className="h-9"
                          />
                        </div>
                        <div>
                          <Label className="text-xs">Double Multiplier</Label>
                          <Input
                            type="number"
                            step="0.1"
                            min="1"
                            placeholder="1.6"
                            value={opt.config.doublePriceMultiplier || ""}
                            onChange={(e) => updateConfig(index, { doublePriceMultiplier: parseFloat(e.target.value) || 1 })}
                            className="h-9"
                          />
                        </div>
                      </div>
                    )}

                    {/* Volume Pricing Mode UI */}
                    {opt.config.pricingMode === "volume" && (
                      <div className="space-y-3">
                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <Label className="text-xs">Single Label</Label>
                            <Input
                              placeholder="Single Sided"
                              value={opt.config.singleLabel || ""}
                              onChange={(e) => updateConfig(index, { singleLabel: e.target.value })}
                              className="h-9"
                            />
                          </div>
                          <div>
                            <Label className="text-xs">Double Label</Label>
                            <Input
                              placeholder="Double Sided"
                              value={opt.config.doubleLabel || ""}
                              onChange={(e) => updateConfig(index, { doubleLabel: e.target.value })}
                              className="h-9"
                            />
                          </div>
                        </div>

                        <div className="space-y-2">
                          <div className="flex items-center justify-between">
                            <Label className="text-xs font-semibold">Volume Price Tiers</Label>
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() => {
                                const currentTiers = opt.config?.volumeTiers ?? [];
                                updateConfig(index, {
                                  volumeTiers: [
                                    ...currentTiers,
                                    { minSheets: 1, maxSheets: null, singlePricePerSheet: 0, doublePricePerSheet: 0 }
                                  ]
                                });
                              }}
                            >
                              <Plus className="h-3 w-3 mr-1" />
                              Add Tier
                            </Button>
                          </div>

                          {/* Volume Tiers Table */}
                          <div className="border rounded-md overflow-hidden">
                            <table className="w-full text-xs">
                              <thead className="bg-muted/50">
                                <tr>
                                  <th className="p-2 text-left font-medium">Min Sheets</th>
                                  <th className="p-2 text-left font-medium">Max Sheets</th>
                                  <th className="p-2 text-left font-medium">Single $/Sheet</th>
                                  <th className="p-2 text-left font-medium">Double $/Sheet</th>
                                  <th className="p-2 w-10"></th>
                                </tr>
                              </thead>
                              <tbody>
                                {(opt.config?.volumeTiers ?? []).map((tier, tierIndex) => (
                                  <tr key={tierIndex} className="border-t">
                                    <td className="p-2">
                                      <Input
                                        type="number"
                                        min="1"
                                        value={tier.minSheets}
                                        onChange={(e) => {
                                          const updatedTiers = [...(opt.config?.volumeTiers ?? [])];
                                          updatedTiers[tierIndex] = { ...tier, minSheets: parseInt(e.target.value) || 1 };
                                          updateConfig(index, { volumeTiers: updatedTiers });
                                        }}
                                        className="h-8"
                                      />
                                    </td>
                                    <td className="p-2">
                                      <Input
                                        type="number"
                                        min="1"
                                        placeholder="∞"
                                        value={tier.maxSheets ?? ""}
                                        onChange={(e) => {
                                          const updatedTiers = [...(opt.config?.volumeTiers ?? [])];
                                          updatedTiers[tierIndex] = { ...tier, maxSheets: e.target.value ? parseInt(e.target.value) : null };
                                          updateConfig(index, { volumeTiers: updatedTiers });
                                        }}
                                        className="h-8"
                                      />
                                    </td>
                                    <td className="p-2">
                                      <Input
                                        type="number"
                                        step="0.01"
                                        min="0"
                                        value={tier.singlePricePerSheet}
                                        onChange={(e) => {
                                          const updatedTiers = [...(opt.config?.volumeTiers ?? [])];
                                          updatedTiers[tierIndex] = { ...tier, singlePricePerSheet: parseFloat(e.target.value) || 0 };
                                          updateConfig(index, { volumeTiers: updatedTiers });
                                        }}
                                        className="h-8"
                                      />
                                    </td>
                                    <td className="p-2">
                                      <Input
                                        type="number"
                                        step="0.01"
                                        min="0"
                                        value={tier.doublePricePerSheet}
                                        onChange={(e) => {
                                          const updatedTiers = [...(opt.config?.volumeTiers ?? [])];
                                          updatedTiers[tierIndex] = { ...tier, doublePricePerSheet: parseFloat(e.target.value) || 0 };
                                          updateConfig(index, { volumeTiers: updatedTiers });
                                        }}
                                        className="h-8"
                                      />
                                    </td>
                                    <td className="p-2">
                                      <Button
                                        type="button"
                                        variant="ghost"
                                        size="sm"
                                        className="h-8 w-8 p-0 text-destructive"
                                        onClick={() => {
                                          const updatedTiers = (opt.config?.volumeTiers ?? []).filter((_, i) => i !== tierIndex);
                                          updateConfig(index, { volumeTiers: updatedTiers });
                                        }}
                                      >
                                        <X className="h-3 w-3" />
                                      </Button>
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                          {(!opt.config?.volumeTiers || opt.config?.volumeTiers.length === 0) && (
                            <p className="text-xs text-muted-foreground p-2 text-center">
                              No tiers defined. Click "Add Tier" to create volume pricing.
                            </p>
                          )}
                          <p className="text-xs text-muted-foreground">
                            Define pricing tiers based on billable sheets. Leave Max Sheets empty for open-ended tiers (e.g., "51+").
                          </p>
                        </div>
                      </div>
                    )}

                    {(!opt.config.pricingMode || opt.config.pricingMode === "multiplier") && (
                      <p className="text-xs text-muted-foreground">
                        When customer selects "{opt.config.doubleLabel || 'Double'}", base price will be multiplied by {opt.config.doublePriceMultiplier || 1.6}x
                      </p>
                    )}
                  </div>
                )}

                {/* Thickness Selector Sub-Config */}
                {opt.config?.kind === "thickness" && (
                  <div className="pl-4 border-l-2 border-blue-500/50 space-y-3">
                    <div className="text-xs font-semibold text-blue-600">Thickness Selector Configuration</div>

                    {/* Default Thickness */}
                    <div>
                      <Label className="text-xs">Default Thickness</Label>
                      <Select
                        value={opt.config.defaultThicknessKey || ""}
                        onValueChange={(val) => updateConfig(index, { defaultThicknessKey: val })}
                      >
                        <SelectTrigger className="h-9">
                          <SelectValue placeholder="Select default" />
                        </SelectTrigger>
                        <SelectContent>
                          {(opt.config.thicknessVariants || []).map(variant => (
                            <SelectItem key={variant.key} value={variant.key}>
                              {variant.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    {/* Thickness Variants */}
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <Label className="text-xs font-semibold">Thickness Variants</Label>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            const currentVariants = opt.config?.thicknessVariants ?? [];
                            const newKey = `variant_${currentVariants.length + 1}`;
                            updateConfig(index, {
                              thicknessVariants: [
                                ...currentVariants,
                                {
                                  key: newKey,
                                  label: "",
                                  materialId: "",
                                  pricingMode: "multiplier",
                                  priceMultiplier: 1.0
                                }
                              ]
                            });
                          }}
                        >
                          <Plus className="h-3 w-3 mr-1" />
                          Add Variant
                        </Button>
                      </div>

                      {/* Variants List */}
                      {(opt.config?.thicknessVariants ?? []).map((variant, variantIndex) => (
                        <div key={variantIndex} className="border rounded-md p-3 space-y-3 bg-background">
                          <div className="flex items-center justify-between">
                            <h4 className="text-sm font-medium">Variant {variantIndex + 1}</h4>
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              className="h-8 text-destructive"
                              onClick={() => {
                                const updatedVariants = (opt.config?.thicknessVariants ?? []).filter((_, i) => i !== variantIndex);
                                updateConfig(index, { thicknessVariants: updatedVariants });
                              }}
                            >
                              <X className="h-3 w-3 mr-1" />
                              Remove
                            </Button>
                          </div>

                          <div className="grid grid-cols-2 gap-3">
                            <div>
                              <Label className="text-xs">Key (internal)</Label>
                              <Input
                                placeholder="e.g., 4mm"
                                value={variant.key}
                                onChange={(e) => {
                                  const updatedVariants = [...(opt.config?.thicknessVariants ?? [])];
                                  updatedVariants[variantIndex] = { ...variant, key: e.target.value };
                                  updateConfig(index, { thicknessVariants: updatedVariants });
                                }}
                                className="h-9"
                              />
                            </div>
                            <div>
                              <Label className="text-xs">Display Label</Label>
                              <Input
                                placeholder="e.g., 4mm Coroplast"
                                value={variant.label}
                                onChange={(e) => {
                                  const updatedVariants = [...(opt.config?.thicknessVariants ?? [])];
                                  updatedVariants[variantIndex] = { ...variant, label: e.target.value };
                                  updateConfig(index, { thicknessVariants: updatedVariants });
                                }}
                                className="h-9"
                              />
                            </div>
                          </div>

                          <div>
                            <Label className="text-xs">Material</Label>
                            <MaterialSelector
                              value={variant.materialId}
                              onChange={(materialId) => {
                                const updatedVariants = [...(opt.config?.thicknessVariants ?? [])];
                                updatedVariants[variantIndex] = { ...variant, materialId };
                                updateConfig(index, { thicknessVariants: updatedVariants });
                              }}
                            />
                          </div>

                          <div>
                            <Label className="text-xs">Pricing Mode</Label>
                            <Select
                              value={variant.pricingMode}
                              onValueChange={(val: "multiplier" | "volume") => {
                                const updatedVariants = [...(opt.config?.thicknessVariants ?? [])];
                                updatedVariants[variantIndex] = { ...variant, pricingMode: val };
                                updateConfig(index, { thicknessVariants: updatedVariants });
                              }}
                            >
                              <SelectTrigger className="h-9">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="multiplier">Multiplier</SelectItem>
                                <SelectItem value="volume">Per-Sheet Volume Pricing</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>

                          {/* Multiplier Mode */}
                          {variant.pricingMode === "multiplier" && (
                            <div>
                              <Label className="text-xs">Price Multiplier</Label>
                              <Input
                                type="number"
                                step="0.1"
                                min="0"
                                placeholder="1.0"
                                value={variant.priceMultiplier || ""}
                                onChange={(e) => {
                                  const updatedVariants = [...(opt.config?.thicknessVariants ?? [])];
                                  updatedVariants[variantIndex] = { ...variant, priceMultiplier: parseFloat(e.target.value) || 1 };
                                  updateConfig(index, { thicknessVariants: updatedVariants });
                                }}
                                className="h-9"
                              />
                              <p className="text-xs text-muted-foreground mt-1">
                                Sheet cost will be multiplied by this value (e.g., 1.5 for 50% more expensive)
                              </p>
                            </div>
                          )}

                          {/* Volume Pricing Mode */}
                          {variant.pricingMode === "volume" && (
                            <div className="space-y-2">
                              <div className="flex items-center justify-between">
                                <Label className="text-xs font-semibold">Volume Price Tiers</Label>
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  onClick={() => {
                                    const updatedVariants = [...(opt.config?.thicknessVariants ?? [])];
                                    const currentTiers = variant.volumeTiers || [];
                                    updatedVariants[variantIndex] = {
                                      ...variant,
                                      volumeTiers: [
                                        ...currentTiers,
                                        { minSheets: 1, maxSheets: null, pricePerSheet: 0 }
                                      ]
                                    };
                                    updateConfig(index, { thicknessVariants: updatedVariants });
                                  }}
                                >
                                  <Plus className="h-3 w-3 mr-1" />
                                  Add Tier
                                </Button>
                              </div>

                              <div className="border rounded-md overflow-hidden">
                                <table className="w-full text-xs">
                                  <thead className="bg-muted/50">
                                    <tr>
                                      <th className="p-2 text-left font-medium">Min Sheets</th>
                                      <th className="p-2 text-left font-medium">Max Sheets</th>
                                      <th className="p-2 text-left font-medium">Price/Sheet ($)</th>
                                      <th className="p-2 w-10"></th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {(variant.volumeTiers || []).map((tier, tierIndex) => (
                                      <tr key={tierIndex} className="border-t">
                                        <td className="p-2">
                                          <Input
                                            type="number"
                                            min="1"
                                            value={tier.minSheets}
                                            onChange={(e) => {
                                              const updatedVariants = [...(opt.config?.thicknessVariants ?? [])];
                                              const updatedTiers = [...(variant.volumeTiers || [])];
                                              updatedTiers[tierIndex] = { ...tier, minSheets: parseInt(e.target.value) || 1 };
                                              updatedVariants[variantIndex] = { ...variant, volumeTiers: updatedTiers };
                                              updateConfig(index, { thicknessVariants: updatedVariants });
                                            }}
                                            className="h-8"
                                          />
                                        </td>
                                        <td className="p-2">
                                          <Input
                                            type="number"
                                            min="1"
                                            placeholder="∞"
                                            value={tier.maxSheets ?? ""}
                                            onChange={(e) => {
                                              const updatedVariants = [...(opt.config?.thicknessVariants ?? [])];
                                              const updatedTiers = [...(variant.volumeTiers || [])];
                                              updatedTiers[tierIndex] = { ...tier, maxSheets: e.target.value ? parseInt(e.target.value) : null };
                                              updatedVariants[variantIndex] = { ...variant, volumeTiers: updatedTiers };
                                              updateConfig(index, { thicknessVariants: updatedVariants });
                                            }}
                                            className="h-8"
                                          />
                                        </td>
                                        <td className="p-2">
                                          <Input
                                            type="number"
                                            step="0.01"
                                            min="0"
                                            value={tier.pricePerSheet}
                                            onChange={(e) => {
                                              const updatedVariants = [...(opt.config?.thicknessVariants ?? [])];
                                              const updatedTiers = [...(variant.volumeTiers || [])];
                                              updatedTiers[tierIndex] = { ...tier, pricePerSheet: parseFloat(e.target.value) || 0 };
                                              updatedVariants[variantIndex] = { ...variant, volumeTiers: updatedTiers };
                                              updateConfig(index, { thicknessVariants: updatedVariants });
                                            }}
                                            className="h-8"
                                          />
                                        </td>
                                        <td className="p-2">
                                          <Button
                                            type="button"
                                            variant="ghost"
                                            size="sm"
                                            className="h-8 w-8 p-0 text-destructive"
                                            onClick={() => {
                                              const updatedVariants = [...(opt.config?.thicknessVariants ?? [])];
                                              const updatedTiers = (variant.volumeTiers || []).filter((_, i) => i !== tierIndex);
                                              updatedVariants[variantIndex] = { ...variant, volumeTiers: updatedTiers };
                                              updateConfig(index, { thicknessVariants: updatedVariants });
                                            }}
                                          >
                                            <X className="h-3 w-3" />
                                          </Button>
                                        </td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                              {(!variant.volumeTiers || variant.volumeTiers.length === 0) && (
                                <p className="text-xs text-muted-foreground p-2 text-center">
                                  No tiers defined. Click "Add Tier" to create volume pricing.
                                </p>
                              )}
                            </div>
                          )}
                        </div>
                      ))}

                      {(!opt.config.thicknessVariants || opt.config.thicknessVariants.length === 0) && (
                        <p className="text-xs text-muted-foreground p-2 text-center border border-dashed rounded">
                          No variants defined. Click "Add Variant" to add thickness options.
                        </p>
                      )}
                    </div>
                  </div>
                )}

                {/* Material Add-on Configuration */}
                <div className="mt-3 pt-3 border-t">
                  <div className="flex items-center space-x-2 mb-2">
                    <input
                      type="checkbox"
                      id={`material-addon-${opt.id}`}
                      checked={!!opt.materialAddonConfig}
                      onChange={(e) => {
                        if (e.target.checked) {
                          updateOption(index, {
                            materialAddonConfig: {
                              materialId: "",
                              usageBasis: "same_area",
                              unitType: "sqft",
                              wasteFactor: 0
                            }
                          });
                        } else {
                          updateOption(index, { materialAddonConfig: undefined });
                        }
                      }}
                      className="h-4 w-4 rounded border-gray-300"
                    />
                    <label htmlFor={`material-addon-${opt.id}`} className="text-xs font-medium cursor-pointer">
                      This option uses an additional material <span className="text-muted-foreground">(e.g., laminate)</span>
                    </label>
                  </div>

                  {opt.materialAddonConfig && (
                    <div className="pl-4 border-l-2 border-green-500/50 space-y-3">
                      <div className="text-xs font-semibold text-green-600">Material Add-on Configuration</div>

                      <div>
                        <Label className="text-xs">Material</Label>
                        <MaterialSelector
                          value={opt.materialAddonConfig.materialId}
                          onChange={(materialId) => {
                            updateOption(index, {
                              materialAddonConfig: {
                                ...opt.materialAddonConfig!,
                                materialId
                              }
                            });
                          }}
                        />
                      </div>

                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <Label className="text-xs">Usage Basis</Label>
                          <Select
                            value={opt.materialAddonConfig.usageBasis}
                            onValueChange={(val) => {
                              const usageBasis = val as "same_area" | "same_sheets";
                              const unitType = val === "same_area" ? "sqft" : "sheet";
                              updateOption(index, {
                                materialAddonConfig: {
                                  ...opt.materialAddonConfig!,
                                  usageBasis,
                                  unitType
                                }
                              });
                            }}
                          >
                            <SelectTrigger className="h-9">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="same_area">Same Area as Print</SelectItem>
                              <SelectItem value="same_sheets">Same Number of Sheets</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>

                        <div>
                          <Label className="text-xs">Waste Factor (%)</Label>
                          <Input
                            type="number"
                            step="1"
                            min="0"
                            max="100"
                            placeholder="0"
                            value={(opt.materialAddonConfig.wasteFactor || 0) * 100}
                            onChange={(e) => {
                              const percent = parseFloat(e.target.value) || 0;
                              updateOption(index, {
                                materialAddonConfig: {
                                  ...opt.materialAddonConfig!,
                                  wasteFactor: percent / 100
                                }
                              });
                            }}
                            className="h-9"
                          />
                        </div>
                      </div>

                      <p className="text-xs text-muted-foreground">
                        {opt.materialAddonConfig.usageBasis === "same_area"
                          ? "This material will consume the same square footage as the printed area."
                          : "This material will use the same number of sheets as the base product."}
                        {opt.materialAddonConfig.wasteFactor ? ` Waste factor adds ${(opt.materialAddonConfig.wasteFactor * 100).toFixed(0)}% extra.` : ""}
                      </p>
                    </div>
                  )}
                </div>
              </div>

              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="text-destructive hover:text-destructive"
                onClick={() => removeOption(index)}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          </React.Fragment>
        ))}
      <p className="text-xs text-muted-foreground">
        Examples: "Grommets" (Checkbox + Grommets Config), "Printing" (Toggle + Sides Config), "Rush Fee" (Checkbox, Flat, $25)
      </p>
    </div>
  );
}
