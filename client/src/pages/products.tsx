import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { Skeleton } from "@/components/ui/skeleton";
import { Copy, Edit, Plus, Trash2, Search, Package, Info, Layers, Settings2, X, Calculator, Grid3X3 } from "lucide-react";
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

interface ProductFormData extends InsertProduct {
  optionsJson: ProductOptionItem[] | null;
  pricingProfileKey: string;
  pricingProfileConfig: FlatGoodsConfig | null;
  pricingFormulaId: string | null;
}

export default function ProductsPage() {
  const { toast } = useToast();
  const [searchTerm, setSearchTerm] = useState("");
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [duplicateSource, setDuplicateSource] = useState<Product | null>(null);

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
    },
  });

  // Edit product form
  const editProductForm = useForm<ProductFormData>({
    resolver: zodResolver(insertProductSchema.partial()),
  });

  // Watch pricing profile and formula for conditional UI
  const addPricingProfileKey = addProductForm.watch("pricingProfileKey");
  const editPricingProfileKey = editProductForm.watch("pricingProfileKey");
  const addPricingProfileConfig = addProductForm.watch("pricingProfileConfig");
  const editPricingProfileConfig = editProductForm.watch("pricingProfileConfig");
  const addPricingFormulaId = addProductForm.watch("pricingFormulaId");
  const editPricingFormulaId = editProductForm.watch("pricingFormulaId");

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
    setEditingProduct(product);
    editProductForm.reset({
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
    });
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
        <Button onClick={() => setIsAddDialogOpen(true)}>
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
              <Button onClick={() => setIsAddDialogOpen(true)}>
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
            <form onSubmit={addProductForm.handleSubmit((data) => addProductMutation.mutate(data))} className="space-y-6">
              {/* Section: Basic Info */}
              <div className="space-y-4">
                <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                  <Info className="h-4 w-4" />
                  Basic Info
                </div>
                <FormField
                  control={addProductForm.control}
                  name="name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Name *</FormLabel>
                      <FormControl>
                        <Input placeholder="Product name" {...field} />
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
                        <FormLabel>Pricing Formula (Optional)</FormLabel>
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
                            : "Select a formula to use shared pricing settings, or configure manually below."}
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
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                    <Settings2 className="h-4 w-4" />
                    Options / Add-ons
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      const current = addProductForm.getValues("optionsJson") || [];
                      addProductForm.setValue("optionsJson", [
                        ...current,
                        { id: generateOptionId(), label: "", type: "checkbox", priceMode: "flat", amount: 0 }
                      ]);
                    }}
                  >
                    <Plus className="h-4 w-4 mr-1" />
                    Add Option
                  </Button>
                </div>
                <ProductOptionsEditor 
                  form={addProductForm} 
                  fieldName="optionsJson" 
                />
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
              </div>

              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setIsAddDialogOpen(false)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={addProductMutation.isPending}>
                  {addProductMutation.isPending ? "Adding..." : "Add Product"}
                </Button>
              </DialogFooter>
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
              onSubmit={editProductForm.handleSubmit((data) =>
                editingProduct && updateProductMutation.mutate({ id: editingProduct.id, data })
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
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Name *</FormLabel>
                      <FormControl>
                        <Input placeholder="Product name" {...field} value={field.value || ""} />
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
                        <FormLabel>Pricing Formula (Optional)</FormLabel>
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
                            : "Select a formula to use shared pricing settings, or configure manually below."}
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
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                    <Settings2 className="h-4 w-4" />
                    Options / Add-ons
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      const current = editProductForm.getValues("optionsJson") || [];
                      editProductForm.setValue("optionsJson", [
                        ...current,
                        { id: generateOptionId(), label: "", type: "checkbox", priceMode: "flat", amount: 0 }
                      ]);
                    }}
                  >
                    <Plus className="h-4 w-4 mr-1" />
                    Add Option
                  </Button>
                </div>
                <ProductOptionsEditor 
                  form={editProductForm} 
                  fieldName="optionsJson" 
                />
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
              </div>

              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setEditingProduct(null)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={updateProductMutation.isPending}>
                  {updateProductMutation.isPending ? "Saving..." : "Save Changes"}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// Product Options Editor Component
function ProductOptionsEditor({ form, fieldName }: { form: any; fieldName: string }) {
  const options: ProductOptionItem[] = form.watch(fieldName) || [];

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

  if (options.length === 0) {
    return (
      <div className="text-sm text-muted-foreground italic p-4 border border-dashed rounded-lg text-center">
        No options defined. Click "Add Option" to create product add-ons like yard stakes, rush fees, or design time.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {options.map((opt, index) => (
        <div key={opt.id} className="flex items-start gap-3 p-3 border rounded-lg bg-muted/20">
          <div className="flex-1 grid grid-cols-4 gap-3">
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
                onValueChange={(val) => updateOption(index, { type: val as "checkbox" | "quantity" })}
              >
                <SelectTrigger className="h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="checkbox">Checkbox</SelectItem>
                  <SelectItem value="quantity">Quantity</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Price Mode</Label>
              <Select
                value={opt.priceMode}
                onValueChange={(val) => updateOption(index, { priceMode: val as "flat" | "perQuantity" | "perArea" })}
              >
                <SelectTrigger className="h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="flat">Flat</SelectItem>
                  <SelectItem value="perQuantity">Per Qty</SelectItem>
                  <SelectItem value="perArea">Per Area</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="col-span-2">
              <Label className="text-xs">Amount ($)</Label>
              <Input
                type="number"
                step="0.01"
                placeholder="0.00"
                value={opt.amount || ""}
                onChange={(e) => updateOption(index, { amount: parseFloat(e.target.value) || 0 })}
                className="h-9"
              />
            </div>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="text-destructive hover:text-destructive mt-5"
            onClick={() => removeOption(index)}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      ))}
      <p className="text-xs text-muted-foreground">
        Examples: "Include Yard Stakes" (Checkbox, Per Qty, $1.50), "Rush Fee" (Checkbox, Flat, $25), "Design Time" (Quantity, Per Qty, $75/hr)
      </p>
    </div>
  );
}
