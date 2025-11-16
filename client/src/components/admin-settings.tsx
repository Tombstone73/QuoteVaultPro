import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { Skeleton } from "@/components/ui/skeleton";
import { Copy, Download, Edit, Plus, Settings as SettingsIcon, Trash2, Upload } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import type {
  Product,
  InsertProduct,
  UpdateProduct,
  ProductOption,
  InsertProductOption,
  UpdateProductOption,
  ProductVariant,
  InsertProductVariant,
  UpdateProductVariant,
  GlobalVariable,
  InsertGlobalVariable,
  UpdateGlobalVariable
} from "@shared/schema";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { 
  insertProductSchema, 
  insertProductOptionSchema,
  insertProductVariantSchema,
  insertGlobalVariableSchema
} from "@shared/schema";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Checkbox } from "@/components/ui/checkbox";

function SelectChoicesInput({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const [newChoice, setNewChoice] = useState("");
  const choices = value?.split(",").map(s => s.trim()).filter(Boolean) || [];
  
  const addChoice = () => {
    const trimmed = newChoice.trim();
    if (trimmed && !choices.includes(trimmed)) {
      onChange([...choices, trimmed].join(","));
      setNewChoice("");
    }
  };
  
  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <Input
          placeholder="Add a choice (e.g., Matte, Gloss)"
          value={newChoice}
          onChange={(e) => setNewChoice(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              addChoice();
            }
          }}
          data-testid="input-add-select-choice"
        />
        <Button
          type="button"
          variant="outline"
          onClick={addChoice}
          data-testid="button-add-select-choice"
        >
          <Plus className="w-4 h-4" />
        </Button>
      </div>
      <div className="flex flex-wrap gap-2">
        {choices.map((choice, index) => (
          <Badge
            key={index}
            variant="secondary"
            className="gap-1"
            data-testid={`badge-choice-${index}`}
          >
            {choice}
            <button
              type="button"
              onClick={() => {
                const newChoices = choices.filter((_, i) => i !== index);
                onChange(newChoices.join(","));
              }}
              className="ml-1 hover:text-destructive"
              data-testid={`button-remove-choice-${index}`}
            >
              ×
            </button>
          </Badge>
        ))}
      </div>
    </div>
  );
}

export default function AdminSettings() {
  const { toast } = useToast();
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [editingOption, setEditingOption] = useState<ProductOption | null>(null);
  const [isAddOptionDialogOpen, setIsAddOptionDialogOpen] = useState(false);
  const [editingVariant, setEditingVariant] = useState<ProductVariant | null>(null);
  const [isAddVariantDialogOpen, setIsAddVariantDialogOpen] = useState(false);
  const [editingVariable, setEditingVariable] = useState<GlobalVariable | null>(null);
  const [isAddVariableDialogOpen, setIsAddVariableDialogOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [csvFile, setCsvFile] = useState<File | null>(null);

  const { data: products, isLoading: productsLoading } = useQuery<Product[]>({
    queryKey: ["/api/products"],
  });

  const addProductForm = useForm<InsertProduct>({
    resolver: zodResolver(insertProductSchema),
    defaultValues: {
      name: "",
      description: "",
      category: "",
      pricingFormula: "width * height * 0.05 * quantity",
      storeUrl: "",
      showStoreLink: true,
      isActive: true,
    },
  });

  const editProductForm = useForm<UpdateProduct>({
    resolver: zodResolver(insertProductSchema.partial()),
  });

  const optionForm = useForm<Omit<InsertProductOption, "productId">>({
    resolver: zodResolver(insertProductOptionSchema.omit({ productId: true })),
    defaultValues: {
      name: "",
      description: "",
      type: "toggle",
      defaultValue: "false",
      defaultSelection: "",
      isDefaultEnabled: false,
      setupCost: 0,
      priceFormula: "0",
      parentOptionId: null,
      displayOrder: 0,
      isActive: true,
    },
  });

  const variantForm = useForm<Omit<InsertProductVariant, "productId">>({
    resolver: zodResolver(insertProductVariantSchema.omit({ productId: true })),
    defaultValues: {
      name: "",
      description: "",
      basePricePerSqft: 0,
      isDefault: false,
      displayOrder: 0,
      isActive: true,
    },
  });

  const editVariantForm = useForm<Omit<InsertProductVariant, "productId">>({
    resolver: zodResolver(insertProductVariantSchema.omit({ productId: true })),
  });

  const variableForm = useForm<InsertGlobalVariable>({
    resolver: zodResolver(insertGlobalVariableSchema),
    defaultValues: {
      name: "",
      value: 0,
      description: "",
      category: "",
      isActive: true,
    },
  });

  const editVariableForm = useForm<InsertGlobalVariable>({
    resolver: zodResolver(insertGlobalVariableSchema),
  });

  const addProductMutation = useMutation({
    mutationFn: async (data: InsertProduct) => {
      return await apiRequest("POST", "/api/products", data);
    },
    onSuccess: () => {
      toast({
        title: "Product Added",
        description: "The product has been added successfully.",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/products"] });
      setIsAddDialogOpen(false);
      addProductForm.reset();
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const updateProductMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: UpdateProduct }) => {
      return await apiRequest("PATCH", `/api/products/${id}`, data);
    },
    onSuccess: () => {
      toast({
        title: "Product Updated",
        description: "The product has been updated successfully.",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/products"] });
      setEditingProduct(null);
      editProductForm.reset();
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const deleteProductMutation = useMutation({
    mutationFn: async (id: string) => {
      return await apiRequest("DELETE", `/api/products/${id}`);
    },
    onSuccess: () => {
      toast({
        title: "Product Deleted",
        description: "The product has been deleted successfully.",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/products"] });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const cloneProductMutation = useMutation({
    mutationFn: async (id: string) => {
      return await apiRequest("POST", `/api/products/${id}/clone`);
    },
    onSuccess: () => {
      toast({
        title: "Product Cloned",
        description: "The product has been cloned successfully. You can now edit the name and pricing.",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/products"] });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const importProductsMutation = useMutation({
    mutationFn: async (csvData: string) => {
      return await apiRequest("POST", "/api/products/import", { csvData });
    },
    onSuccess: (data: any) => {
      toast({
        title: "Products Imported",
        description: `Successfully imported ${data.imported.products} products, ${data.imported.variants} variants, and ${data.imported.options} options.`,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/products"] });
      setCsvFile(null);
    },
    onError: (error: Error) => {
      toast({
        title: "Import Failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleCsvUpload = async () => {
    if (!csvFile) {
      toast({
        title: "No File Selected",
        description: "Please select a CSV file to upload.",
        variant: "destructive",
      });
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      const csvData = e.target?.result as string;
      importProductsMutation.mutate(csvData);
    };
    reader.readAsText(csvFile);
  };

  const handleExportProducts = async () => {
    try {
      const response = await fetch('/api/products/export', {
        credentials: 'include',
      });
      if (!response.ok) {
        throw new Error('Failed to export products');
      }
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
      a.download = `products-export-${timestamp}.csv`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
      toast({
        title: "Export Successful",
        description: "Products exported to CSV successfully.",
      });
    } catch (error) {
      toast({
        title: "Export Failed",
        description: "Failed to export products to CSV.",
        variant: "destructive",
      });
    }
  };

  const handleDownloadTemplate = async () => {
    try {
      const response = await fetch('/api/products/csv-template', {
        credentials: 'include',
      });
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'product-import-template.csv';
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (error) {
      toast({
        title: "Download Failed",
        description: "Failed to download the CSV template.",
        variant: "destructive",
      });
    }
  };

  const { data: productOptions } = useQuery<ProductOption[]>({
    queryKey: ["/api/products", editingProduct?.id, "options"],
    enabled: !!editingProduct?.id,
  });

  const addOptionMutation = useMutation({
    mutationFn: async (data: Omit<InsertProductOption, "productId">) => {
      if (!editingProduct) throw new Error("No product selected");
      return await apiRequest("POST", `/api/products/${editingProduct.id}/options`, data);
    },
    onSuccess: () => {
      toast({
        title: "Option Added",
        description: "The product option has been added successfully.",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/products", editingProduct?.id, "options"] });
      setIsAddOptionDialogOpen(false);
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const updateOptionMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Omit<InsertProductOption, "productId"> }) => {
      if (!editingProduct) throw new Error("No product selected");
      const updateData: UpdateProductOption = { ...data, id, productId: editingProduct.id };
      return await apiRequest("PATCH", `/api/products/${editingProduct.id}/options/${id}`, updateData);
    },
    onSuccess: () => {
      toast({
        title: "Option Updated",
        description: "The product option has been updated successfully.",
      });
      // DON'T invalidate query - keeps product dialog open
      // User can close/reopen dialog to see changes
      setEditingOption(null);
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const deleteOptionMutation = useMutation({
    mutationFn: async (id: string) => {
      if (!editingProduct) throw new Error("No product selected");
      return await apiRequest("DELETE", `/api/products/${editingProduct.id}/options/${id}`);
    },
    onSuccess: () => {
      toast({
        title: "Option Deleted",
        description: "The product option has been deleted successfully.",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/products", editingProduct?.id, "options"] });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // Fetch all variants for all products
  const { data: allVariants, isLoading: variantsLoading } = useQuery<{ productId: string; productName: string; variants: ProductVariant[] }[]>({
    queryKey: ["/api/all-variants"],
    queryFn: async () => {
      if (!products) return [];
      const variantsData = await Promise.all(
        products.map(async (product) => {
          try {
            const response = await fetch(`/api/products/${product.id}/variants`);
            if (!response.ok) {
              console.error(`Failed to fetch variants for product ${product.id}:`, response.status);
              return {
                productId: product.id,
                productName: product.name,
                variants: [],
              };
            }
            const variants = await response.json();
            // Ensure variants is an array
            return {
              productId: product.id,
              productName: product.name,
              variants: Array.isArray(variants) ? variants : [],
            };
          } catch (error) {
            console.error(`Error fetching variants for product ${product.id}:`, error);
            return {
              productId: product.id,
              productName: product.name,
              variants: [],
            };
          }
        })
      );
      return variantsData;
    },
    enabled: !!products,
  });

  const addVariantMutation = useMutation({
    mutationFn: async ({ productId, data }: { productId: string; data: Omit<InsertProductVariant, "productId"> }) => {
      return await apiRequest("POST", `/api/products/${productId}/variants`, data);
    },
    onSuccess: () => {
      toast({
        title: "Variant Added",
        description: "The product variant has been added successfully.",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/all-variants"] });
      setIsAddVariantDialogOpen(false);
      variantForm.reset();
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const updateVariantMutation = useMutation({
    mutationFn: async ({ productId, id, data }: { productId: string; id: string; data: Omit<InsertProductVariant, "productId"> }) => {
      return await apiRequest("PATCH", `/api/products/${productId}/variants/${id}`, data);
    },
    onSuccess: (updatedVariant, variables) => {
      toast({
        title: "Variant Updated",
        description: "The product variant has been updated successfully.",
      });
      
      //  DON'T invalidate or update cache - keep product dialog open
      // The user can manually refresh to see changes, or close/reopen the dialog
      // Invalidating causes the product dialog to close due to re-renders
      
      // Close only the variant dialog
      setEditingVariant(null);
      editVariantForm.reset();
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const deleteVariantMutation = useMutation({
    mutationFn: async ({ productId, id }: { productId: string; id: string }) => {
      return await apiRequest("DELETE", `/api/products/${productId}/variants/${id}`);
    },
    onSuccess: () => {
      toast({
        title: "Variant Deleted",
        description: "The product variant has been deleted successfully.",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/all-variants"] });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const { data: globalVariables, isLoading: variablesLoading } = useQuery<GlobalVariable[]>({
    queryKey: ["/api/global-variables"],
  });

  const addVariableMutation = useMutation({
    mutationFn: async (data: InsertGlobalVariable) => {
      return await apiRequest("POST", "/api/global-variables", data);
    },
    onSuccess: () => {
      toast({
        title: "Variable Added",
        description: "The global variable has been added successfully.",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/global-variables"] });
      setIsAddVariableDialogOpen(false);
      variableForm.reset();
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const updateVariableMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: InsertGlobalVariable }) => {
      return await apiRequest("PATCH", `/api/global-variables/${id}`, data);
    },
    onSuccess: () => {
      toast({
        title: "Variable Updated",
        description: "The global variable has been updated successfully.",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/global-variables"] });
      setEditingVariable(null);
      editVariableForm.reset();
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const deleteVariableMutation = useMutation({
    mutationFn: async (id: string) => {
      return await apiRequest("DELETE", `/api/global-variables/${id}`);
    },
    onSuccess: () => {
      toast({
        title: "Variable Deleted",
        description: "The global variable has been deleted successfully.",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/global-variables"] });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleEditProduct = (product: Product) => {
    setEditingProduct(product);
    editProductForm.reset({
      name: product.name,
      description: product.description,
      category: product.category || "",
      pricingFormula: product.pricingFormula,
      storeUrl: product.storeUrl || "",
      showStoreLink: product.showStoreLink,
      isActive: product.isActive,
    });
  };

  const handleEditVariant = (variant: ProductVariant, productId: string) => {
    setEditingVariant({ ...variant, productId } as any);
    editVariantForm.reset({
      name: variant.name,
      description: variant.description || "",
      basePricePerSqft: Number(variant.basePricePerSqft),
      isDefault: variant.isDefault,
      displayOrder: variant.displayOrder,
      isActive: variant.isActive,
    });
  };

  const handleEditVariable = (variable: GlobalVariable) => {
    setEditingVariable(variable);
    editVariableForm.reset({
      name: variable.name,
      value: Number(variable.value),
      description: variable.description || "",
      category: variable.category || "",
      isActive: variable.isActive,
    });
  };

  const filteredVariables = globalVariables?.filter((variable) =>
    variable.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    variable.description?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    variable.category?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  if (productsLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Card data-testid="card-admin-settings">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <SettingsIcon className="w-5 h-5" />
            Admin Configuration
          </CardTitle>
          <CardDescription>
            Manage products, pricing formulas, and system settings
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue="products" data-testid="tabs-admin-settings">
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="products" data-testid="tab-products">Products</TabsTrigger>
              <TabsTrigger value="variables" data-testid="tab-variables">Global Variables</TabsTrigger>
              <TabsTrigger value="formulas" data-testid="tab-formulas">Pricing Formulas</TabsTrigger>
            </TabsList>

            <TabsContent value="products" className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle>Import Products from CSV</CardTitle>
                  <CardDescription>
                    Bulk import products with variants and options using a CSV file
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      onClick={handleDownloadTemplate}
                      data-testid="button-download-csv-template"
                    >
                      <Download className="w-4 h-4 mr-2" />
                      Download Template
                    </Button>
                    <Button
                      variant="outline"
                      onClick={handleExportProducts}
                      data-testid="button-export-csv"
                    >
                      <Download className="w-4 h-4 mr-2" />
                      Export CSV
                    </Button>
                    <div className="flex-1 flex gap-2">
                      <Input
                        type="file"
                        accept=".csv"
                        onChange={(e) => setCsvFile(e.target.files?.[0] || null)}
                        data-testid="input-csv-file"
                      />
                      <Button
                        onClick={handleCsvUpload}
                        disabled={!csvFile || importProductsMutation.isPending}
                        data-testid="button-upload-csv"
                      >
                        <Upload className="w-4 h-4 mr-2" />
                        {importProductsMutation.isPending ? "Importing..." : "Import CSV"}
                      </Button>
                    </div>
                  </div>
                  {csvFile && (
                    <p className="text-sm text-muted-foreground" data-testid="text-selected-file">
                      Selected file: {csvFile.name}
                    </p>
                  )}
                </CardContent>
              </Card>

              <div className="flex justify-between items-center">
                <h3 className="text-lg font-semibold">Product Management</h3>
                <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
                  <DialogTrigger asChild>
                    <Button data-testid="button-add-product">
                      <Plus className="w-4 h-4 mr-2" />
                      Add Product
                    </Button>
                  </DialogTrigger>
                  <DialogContent className="max-w-2xl" data-testid="dialog-add-product">
                    <DialogHeader>
                      <DialogTitle>Add New Product</DialogTitle>
                      <DialogDescription>
                        Create a new product with pricing formula
                      </DialogDescription>
                    </DialogHeader>
                    <Form {...addProductForm}>
                      <form onSubmit={addProductForm.handleSubmit((data) => {
                        const cleanData: any = {};
                        Object.entries(data).forEach(([k, v]) => {
                          // Convert empty strings to null, preserve null/undefined to let backend handle defaults
                          cleanData[k] = v === '' ? null : v;
                        });
                        addProductMutation.mutate(cleanData);
                      })} className="space-y-4">
                        <FormField
                          control={addProductForm.control}
                          name="name"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel data-testid="label-product-name">Product Name</FormLabel>
                              <FormControl>
                                <Input placeholder="Business Cards" {...field} data-testid="input-product-name" />
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
                              <FormLabel data-testid="label-product-description">Description</FormLabel>
                              <FormControl>
                                <Textarea
                                  placeholder="Professional business cards with custom designs..."
                                  {...field}
                                  data-testid="textarea-product-description"
                                />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        <FormField
                          control={addProductForm.control}
                          name="category"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel data-testid="label-product-category">Category (Optional)</FormLabel>
                              <FormControl>
                                <Input
                                  placeholder="flatbed, adhesive backed, paper, misc"
                                  {...field}
                                  value={field.value || ""}
                                  data-testid="input-product-category"
                                />
                              </FormControl>
                              <FormDescription>
                                Product category for filtering (e.g., flatbed, adhesive backed, paper, misc)
                              </FormDescription>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        <FormField
                          control={addProductForm.control}
                          name="pricingFormula"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel data-testid="label-product-formula">Pricing Formula</FormLabel>
                              <FormControl>
                                <Input
                                  placeholder="width * height * 0.05 * quantity"
                                  {...field}
                                  data-testid="input-product-formula"
                                />
                              </FormControl>
                              <FormDescription>
                                Use: width, height, quantity. Example: width * height * 0.05 * quantity
                              </FormDescription>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        <FormField
                          control={addProductForm.control}
                          name="variantLabel"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel data-testid="label-product-variant-label">Variant Label (Optional)</FormLabel>
                              <FormControl>
                                <Input
                                  placeholder="Material, Size, Type, etc. (default: Variant)"
                                  {...field}
                                  value={field.value || ""}
                                  data-testid="input-product-variant-label"
                                />
                              </FormControl>
                              <FormDescription>
                                Customize how variants are labeled (e.g., "Material", "Size", "Type")
                              </FormDescription>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        <FormField
                          control={addProductForm.control}
                          name="storeUrl"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel data-testid="label-product-url">Store URL (Optional)</FormLabel>
                              <FormControl>
                                <Input
                                  placeholder="https://example.com/business-cards"
                                  {...field}
                                  value={field.value || ""}
                                  data-testid="input-product-url"
                                />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        <FormField
                          control={addProductForm.control}
                          name="showStoreLink"
                          render={({ field }) => (
                            <FormItem className="flex flex-row items-center justify-between rounded-md border p-4">
                              <div className="space-y-0.5">
                                <FormLabel className="text-base" data-testid="label-show-store-link">
                                  Show Store Link
                                </FormLabel>
                                <FormDescription>
                                  Display "View in Store" button in calculator
                                </FormDescription>
                              </div>
                              <FormControl>
                                <Switch
                                  checked={field.value}
                                  onCheckedChange={field.onChange}
                                  data-testid="switch-show-store-link"
                                />
                              </FormControl>
                            </FormItem>
                          )}
                        />
                        <FormField
                          control={addProductForm.control}
                          name="isActive"
                          render={({ field }) => (
                            <FormItem className="flex flex-row items-center justify-between rounded-md border p-4">
                              <div className="space-y-0.5">
                                <FormLabel className="text-base" data-testid="label-product-active">
                                  Active
                                </FormLabel>
                                <FormDescription>
                                  Product will be available in the calculator
                                </FormDescription>
                              </div>
                              <FormControl>
                                <Switch
                                  checked={field.value}
                                  onCheckedChange={field.onChange}
                                  data-testid="switch-product-active"
                                />
                              </FormControl>
                            </FormItem>
                          )}
                        />
                        <DialogFooter>
                          <Button
                            type="submit"
                            disabled={addProductMutation.isPending}
                            data-testid="button-submit-add-product"
                          >
                            {addProductMutation.isPending ? "Adding..." : "Add Product"}
                          </Button>
                        </DialogFooter>
                      </form>
                    </Form>
                  </DialogContent>
                </Dialog>
              </div>

              <div className="border rounded-md">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead data-testid="header-name">Name</TableHead>
                      <TableHead data-testid="header-description">Description</TableHead>
                      <TableHead data-testid="header-formula">Formula</TableHead>
                      <TableHead data-testid="header-status">Status</TableHead>
                      <TableHead data-testid="header-actions" className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {products && products.length > 0 ? (
                      products.map((product) => (
                        <TableRow key={product.id} data-testid={`row-product-${product.id}`}>
                          <TableCell className="font-medium" data-testid={`cell-name-${product.id}`}>
                            {product.name}
                          </TableCell>
                          <TableCell className="max-w-xs truncate" data-testid={`cell-description-${product.id}`}>
                            {product.description}
                          </TableCell>
                          <TableCell className="font-mono text-sm" data-testid={`cell-formula-${product.id}`}>
                            {product.pricingFormula}
                          </TableCell>
                          <TableCell data-testid={`cell-status-${product.id}`}>
                            {product.isActive ? (
                              <span className="text-green-600 dark:text-green-400">Active</span>
                            ) : (
                              <span className="text-muted-foreground">Inactive</span>
                            )}
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="flex justify-end gap-2">
                              <Dialog
                                open={editingProduct?.id === product.id}
                                onOpenChange={(open) => !open && setEditingProduct(null)}
                              >
                                <DialogTrigger asChild>
                                  <Button
                                    variant="outline"
                                    size="icon"
                                    onClick={() => handleEditProduct(product)}
                                    data-testid={`button-edit-${product.id}`}
                                  >
                                    <Edit className="w-4 h-4" />
                                  </Button>
                                </DialogTrigger>
                                <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto" data-testid={`dialog-edit-${product.id}`}>
                                  <DialogHeader>
                                    <DialogTitle>Edit Product</DialogTitle>
                                    <DialogDescription>
                                      Update product details and pricing formula
                                    </DialogDescription>
                                  </DialogHeader>
                                  <Form {...editProductForm}>
                                    <form
                                      onSubmit={editProductForm.handleSubmit((data) => {
                                        const cleanData: any = {};
                                        Object.entries(data).forEach(([k, v]) => {
                                          // Convert empty strings to null, preserve null/undefined to let backend handle defaults
                                          cleanData[k] = v === '' ? null : v;
                                        });
                                        updateProductMutation.mutate({ id: product.id, data: cleanData });
                                      })}
                                      className="space-y-4"
                                    >
                                      <FormField
                                        control={editProductForm.control}
                                        name="name"
                                        render={({ field }) => (
                                          <FormItem>
                                            <FormLabel>Product Name</FormLabel>
                                            <FormControl>
                                              <Input {...field} data-testid={`input-edit-name-${product.id}`} />
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
                                              <Textarea {...field} data-testid={`textarea-edit-description-${product.id}`} />
                                            </FormControl>
                                            <FormMessage />
                                          </FormItem>
                                        )}
                                      />
                                      <FormField
                                        control={editProductForm.control}
                                        name="category"
                                        render={({ field }) => (
                                          <FormItem>
                                            <FormLabel>Category (Optional)</FormLabel>
                                            <FormControl>
                                              <Input 
                                                {...field} 
                                                value={field.value || ""} 
                                                placeholder="flatbed, adhesive backed, paper, misc"
                                                data-testid={`input-edit-category-${product.id}`} 
                                              />
                                            </FormControl>
                                            <FormDescription>
                                              Product category for filtering
                                            </FormDescription>
                                            <FormMessage />
                                          </FormItem>
                                        )}
                                      />
                                      <FormField
                                        control={editProductForm.control}
                                        name="pricingFormula"
                                        render={({ field }) => (
                                          <FormItem>
                                            <FormLabel>Pricing Formula</FormLabel>
                                            <FormControl>
                                              <Input {...field} data-testid={`input-edit-formula-${product.id}`} />
                                            </FormControl>
                                            <FormDescription>
                                              Use: width, height, quantity
                                            </FormDescription>
                                            <FormMessage />
                                          </FormItem>
                                        )}
                                      />
                                      <FormField
                                        control={editProductForm.control}
                                        name="variantLabel"
                                        render={({ field }) => (
                                          <FormItem>
                                            <FormLabel>Variant Label (Optional)</FormLabel>
                                            <FormControl>
                                              <Input 
                                                {...field} 
                                                value={field.value || ""} 
                                                placeholder="Material, Size, Type, etc. (default: Variant)"
                                                data-testid={`input-edit-variant-label-${product.id}`} 
                                              />
                                            </FormControl>
                                            <FormDescription>
                                              Customize how variants are labeled
                                            </FormDescription>
                                            <FormMessage />
                                          </FormItem>
                                        )}
                                      />
                                      <FormField
                                        control={editProductForm.control}
                                        name="storeUrl"
                                        render={({ field }) => (
                                          <FormItem>
                                            <FormLabel>Store URL (Optional)</FormLabel>
                                            <FormControl>
                                              <Input {...field} value={field.value || ""} data-testid={`input-edit-url-${product.id}`} />
                                            </FormControl>
                                            <FormMessage />
                                          </FormItem>
                                        )}
                                      />
                                      <FormField
                                        control={editProductForm.control}
                                        name="showStoreLink"
                                        render={({ field }) => (
                                          <FormItem className="flex flex-row items-center justify-between rounded-md border p-4">
                                            <div className="space-y-0.5">
                                              <FormLabel className="text-base">Show Store Link</FormLabel>
                                              <FormDescription>
                                                Display "View in Store" button in calculator
                                              </FormDescription>
                                            </div>
                                            <FormControl>
                                              <Switch
                                                checked={field.value}
                                                onCheckedChange={field.onChange}
                                                data-testid={`switch-edit-show-store-link-${product.id}`}
                                              />
                                            </FormControl>
                                          </FormItem>
                                        )}
                                      />
                                      <FormField
                                        control={editProductForm.control}
                                        name="isActive"
                                        render={({ field }) => (
                                          <FormItem className="flex flex-row items-center justify-between rounded-md border p-4">
                                            <div className="space-y-0.5">
                                              <FormLabel className="text-base">Active</FormLabel>
                                              <FormDescription>
                                                Product will be available in the calculator
                                              </FormDescription>
                                            </div>
                                            <FormControl>
                                              <Switch
                                                checked={field.value}
                                                onCheckedChange={field.onChange}
                                                data-testid={`switch-edit-active-${product.id}`}
                                              />
                                            </FormControl>
                                          </FormItem>
                                        )}
                                      />

                                      {/* Product Variants Section */}
                                      <div className="space-y-4 border-t pt-4 mt-4">
                                        <div className="flex items-center justify-between">
                                          <div>
                                            <h3 className="text-lg font-semibold">
                                              {product.variantLabel ?? "Variant"}s
                                            </h3>
                                            <p className="text-sm text-muted-foreground">
                                              Manage different {(product.variantLabel ?? "variant").toLowerCase()} options for this product
                                            </p>
                                          </div>
                                          <Dialog open={isAddVariantDialogOpen} onOpenChange={setIsAddVariantDialogOpen}>
                                            <DialogTrigger asChild>
                                              <Button
                                                variant="outline"
                                                size="sm"
                                                onClick={() => {
                                                  variantForm.reset({
                                                    name: "",
                                                    description: "",
                                                    basePricePerSqft: 0,
                                                    isDefault: false,
                                                    displayOrder: 0,
                                                    isActive: true,
                                                  });
                                                }}
                                                data-testid={`button-add-variant-${product.id}`}
                                              >
                                                <Plus className="w-4 h-4 mr-2" />
                                                Add {product.variantLabel ?? "Variant"}
                                              </Button>
                                            </DialogTrigger>
                                            <DialogContent className="max-w-2xl" data-testid="dialog-add-variant-inline">
                                              <DialogHeader>
                                                <DialogTitle>Add {product.variantLabel ?? "Variant"}</DialogTitle>
                                                <DialogDescription>
                                                  Create a new {(product.variantLabel || "variant").toLowerCase()} option for {product.name}
                                                </DialogDescription>
                                              </DialogHeader>
                                              <Form {...variantForm}>
                                                <form onSubmit={variantForm.handleSubmit((data) => addVariantMutation.mutate({ productId: product.id, data }))} className="space-y-4">
                                                  <FormField
                                                    control={variantForm.control}
                                                    name="name"
                                                    render={({ field }) => (
                                                      <FormItem>
                                                        <FormLabel>{product.variantLabel ?? "Variant"} Name</FormLabel>
                                                        <FormControl>
                                                          <Input placeholder="13oz Vinyl" {...field} data-testid="input-variant-name-inline" />
                                                        </FormControl>
                                                        <FormMessage />
                                                      </FormItem>
                                                    )}
                                                  />
                                                  <FormField
                                                    control={variantForm.control}
                                                    name="description"
                                                    render={({ field }) => (
                                                      <FormItem>
                                                        <FormLabel>Description (Optional)</FormLabel>
                                                        <FormControl>
                                                          <Textarea
                                                            placeholder="Standard vinyl banner material"
                                                            {...field}
                                                            value={field.value || ""}
                                                            data-testid="textarea-variant-description-inline"
                                                          />
                                                        </FormControl>
                                                        <FormMessage />
                                                      </FormItem>
                                                    )}
                                                  />
                                                  <FormField
                                                    control={variantForm.control}
                                                    name="basePricePerSqft"
                                                    render={({ field }) => (
                                                      <FormItem>
                                                        <FormLabel>Base Price per Square Foot</FormLabel>
                                                        <FormControl>
                                                          <Input
                                                            type="number"
                                                            step="0.0001"
                                                            {...field}
                                                            onChange={(e) => field.onChange(Number(e.target.value))}
                                                            data-testid="input-variant-price-inline"
                                                          />
                                                        </FormControl>
                                                        <FormMessage />
                                                      </FormItem>
                                                    )}
                                                  />
                                                  <FormField
                                                    control={variantForm.control}
                                                    name="isDefault"
                                                    render={({ field }) => (
                                                      <FormItem className="flex flex-row items-center justify-between rounded-md border p-4">
                                                        <div className="space-y-0.5">
                                                          <FormLabel className="text-base">Is Default {product.variantLabel ?? "Variant"}</FormLabel>
                                                          <FormDescription>
                                                            This {(product.variantLabel || "variant").toLowerCase()} will be pre-selected in the calculator
                                                          </FormDescription>
                                                        </div>
                                                        <FormControl>
                                                          <Switch
                                                            checked={field.value}
                                                            onCheckedChange={field.onChange}
                                                            data-testid="checkbox-variant-default-inline"
                                                          />
                                                        </FormControl>
                                                      </FormItem>
                                                    )}
                                                  />
                                                  <FormField
                                                    control={variantForm.control}
                                                    name="displayOrder"
                                                    render={({ field }) => (
                                                      <FormItem>
                                                        <FormLabel>Display Order</FormLabel>
                                                        <FormControl>
                                                          <Input
                                                            type="number"
                                                            {...field}
                                                            onChange={(e) => field.onChange(Number(e.target.value))}
                                                            data-testid="input-variant-order-inline"
                                                          />
                                                        </FormControl>
                                                        <FormMessage />
                                                      </FormItem>
                                                    )}
                                                  />
                                                  <DialogFooter>
                                                    <Button
                                                      type="submit"
                                                      disabled={addVariantMutation.isPending}
                                                      data-testid="button-submit-add-variant-inline"
                                                    >
                                                      {addVariantMutation.isPending ? "Adding..." : `Add ${product.variantLabel ?? "Variant"}`}
                                                    </Button>
                                                  </DialogFooter>
                                                </form>
                                              </Form>
                                            </DialogContent>
                                          </Dialog>
                                        </div>

                                        {/* Variants List */}
                                        <div className="space-y-2">
                                          {allVariants?.find(pv => pv.productId === product.id)?.variants.length ? (
                                            allVariants
                                              .find(pv => pv.productId === product.id)
                                              ?.variants.sort((a, b) => a.displayOrder - b.displayOrder)
                                              .map((variant) => (
                                                <Card key={variant.id} data-testid={`card-variant-${variant.id}`}>
                                                  <CardContent className="p-4">
                                                    <div className="flex items-start justify-between gap-4">
                                                      <div className="flex-1 space-y-2">
                                                        <div className="flex items-center gap-2">
                                                          <h4 className="font-semibold" data-testid={`text-variant-name-${variant.id}`}>
                                                            {variant.name}
                                                          </h4>
                                                          {variant.isDefault && (
                                                            <Badge variant="default" data-testid={`badge-default-variant-${variant.id}`}>Default</Badge>
                                                          )}
                                                          {!variant.isActive && (
                                                            <Badge variant="secondary">Inactive</Badge>
                                                          )}
                                                        </div>
                                                        {variant.description && (
                                                          <p className="text-sm text-muted-foreground" data-testid={`text-variant-description-${variant.id}`}>
                                                            {variant.description}
                                                          </p>
                                                        )}
                                                        <div className="text-sm font-mono" data-testid={`text-variant-price-${variant.id}`}>
                                                          Base Price: ${Number(variant.basePricePerSqft).toFixed(4)}/sqft
                                                        </div>
                                                      </div>
                                                      <div className="flex gap-2">
                                                        <Dialog
                                                          open={editingVariant?.id === variant.id}
                                                          onOpenChange={(open) => !open && setEditingVariant(null)}
                                                        >
                                                          <DialogTrigger asChild>
                                                            <Button
                                                              variant="outline"
                                                              size="icon"
                                                              onClick={() => handleEditVariant(variant, product.id)}
                                                              data-testid={`button-edit-variant-inline-${variant.id}`}
                                                            >
                                                              <Edit className="w-4 h-4" />
                                                            </Button>
                                                          </DialogTrigger>
                                                          <DialogContent className="max-w-2xl" data-testid={`dialog-edit-variant-inline-${variant.id}`}>
                                                            <DialogHeader>
                                                              <DialogTitle>Edit {product.variantLabel ?? "Variant"}</DialogTitle>
                                                              <DialogDescription>
                                                                Update {(product.variantLabel || "variant").toLowerCase()} details
                                                              </DialogDescription>
                                                            </DialogHeader>
                                                            <Form {...editVariantForm}>
                                                              <form onSubmit={(e) => {
                                                                e.stopPropagation();
                                                                editVariantForm.handleSubmit((data) => updateVariantMutation.mutate({ productId: product.id, id: variant.id, data }))(e);
                                                              }} className="space-y-4">
                                                                <FormField
                                                                  control={editVariantForm.control}
                                                                  name="name"
                                                                  render={({ field }) => (
                                                                    <FormItem>
                                                                      <FormLabel>{product.variantLabel ?? "Variant"} Name</FormLabel>
                                                                      <FormControl>
                                                                        <Input {...field} data-testid={`input-edit-variant-name-${variant.id}`} />
                                                                      </FormControl>
                                                                      <FormMessage />
                                                                    </FormItem>
                                                                  )}
                                                                />
                                                                <FormField
                                                                  control={editVariantForm.control}
                                                                  name="description"
                                                                  render={({ field }) => (
                                                                    <FormItem>
                                                                      <FormLabel>Description (Optional)</FormLabel>
                                                                      <FormControl>
                                                                        <Textarea {...field} value={field.value || ""} data-testid={`textarea-edit-variant-description-${variant.id}`} />
                                                                      </FormControl>
                                                                      <FormMessage />
                                                                    </FormItem>
                                                                  )}
                                                                />
                                                                <FormField
                                                                  control={editVariantForm.control}
                                                                  name="basePricePerSqft"
                                                                  render={({ field }) => (
                                                                    <FormItem>
                                                                      <FormLabel>Base Price per Square Foot</FormLabel>
                                                                      <FormControl>
                                                                        <Input
                                                                          type="number"
                                                                          step="0.0001"
                                                                          {...field}
                                                                          onChange={(e) => field.onChange(Number(e.target.value))}
                                                                          data-testid={`input-edit-variant-price-${variant.id}`}
                                                                        />
                                                                      </FormControl>
                                                                      <FormMessage />
                                                                    </FormItem>
                                                                  )}
                                                                />
                                                                <FormField
                                                                  control={editVariantForm.control}
                                                                  name="isDefault"
                                                                  render={({ field }) => (
                                                                    <FormItem className="flex flex-row items-center justify-between rounded-md border p-4">
                                                                      <div className="space-y-0.5">
                                                                        <FormLabel className="text-base">Is Default {product.variantLabel ?? "Variant"}</FormLabel>
                                                                        <FormDescription>
                                                                          This {(product.variantLabel || "variant").toLowerCase()} will be pre-selected
                                                                        </FormDescription>
                                                                      </div>
                                                                      <FormControl>
                                                                        <Switch
                                                                          checked={field.value}
                                                                          onCheckedChange={field.onChange}
                                                                          data-testid={`checkbox-edit-variant-default-${variant.id}`}
                                                                        />
                                                                      </FormControl>
                                                                    </FormItem>
                                                                  )}
                                                                />
                                                                <FormField
                                                                  control={editVariantForm.control}
                                                                  name="displayOrder"
                                                                  render={({ field }) => (
                                                                    <FormItem>
                                                                      <FormLabel>Display Order</FormLabel>
                                                                      <FormControl>
                                                                        <Input
                                                                          type="number"
                                                                          {...field}
                                                                          onChange={(e) => field.onChange(Number(e.target.value))}
                                                                          data-testid={`input-edit-variant-order-${variant.id}`}
                                                                        />
                                                                      </FormControl>
                                                                      <FormMessage />
                                                                    </FormItem>
                                                                  )}
                                                                />
                                                                <DialogFooter>
                                                                  <Button
                                                                    type="submit"
                                                                    disabled={updateVariantMutation.isPending}
                                                                    data-testid={`button-submit-edit-variant-${variant.id}`}
                                                                  >
                                                                    {updateVariantMutation.isPending ? "Updating..." : `Update ${product.variantLabel ?? "Variant"}`}
                                                                  </Button>
                                                                </DialogFooter>
                                                              </form>
                                                            </Form>
                                                          </DialogContent>
                                                        </Dialog>
                                                        <AlertDialog>
                                                          <AlertDialogTrigger asChild>
                                                            <Button
                                                              variant="outline"
                                                              size="icon"
                                                              data-testid={`button-delete-variant-inline-${variant.id}`}
                                                            >
                                                              <Trash2 className="w-4 h-4" />
                                                            </Button>
                                                          </AlertDialogTrigger>
                                                          <AlertDialogContent data-testid={`dialog-delete-variant-${variant.id}`}>
                                                            <AlertDialogHeader>
                                                              <AlertDialogTitle>Delete {product.variantLabel ?? "Variant"}?</AlertDialogTitle>
                                                              <AlertDialogDescription>
                                                                This will permanently delete "{variant.name}".
                                                              </AlertDialogDescription>
                                                            </AlertDialogHeader>
                                                            <AlertDialogFooter>
                                                              <AlertDialogCancel data-testid={`button-cancel-delete-variant-${variant.id}`}>
                                                                Cancel
                                                              </AlertDialogCancel>
                                                              <AlertDialogAction
                                                                onClick={() => deleteVariantMutation.mutate({ productId: product.id, id: variant.id })}
                                                                data-testid={`button-confirm-delete-variant-${variant.id}`}
                                                              >
                                                                Delete
                                                              </AlertDialogAction>
                                                            </AlertDialogFooter>
                                                          </AlertDialogContent>
                                                        </AlertDialog>
                                                      </div>
                                                    </div>
                                                  </CardContent>
                                                </Card>
                                              ))
                                          ) : (
                                            <div className="text-center py-8 text-muted-foreground">
                                              No {(product.variantLabel || "variant").toLowerCase()}s configured yet
                                            </div>
                                          )}
                                        </div>
                                      </div>

                                      {/* Product Options Section */}
                                      <div className="space-y-4 border-t pt-4 mt-4">
                                        <div className="flex items-center justify-between">
                                          <div>
                                            <h3 className="text-lg font-semibold">Product Options</h3>
                                            <p className="text-sm text-muted-foreground">
                                              Configure add-on options with custom pricing formulas
                                            </p>
                                          </div>
                                          <Dialog 
                                            open={isAddOptionDialogOpen} 
                                            onOpenChange={(open) => {
                                              setIsAddOptionDialogOpen(open);
                                              if (!open) {
                                                setEditingOption(null);
                                                optionForm.reset({
                                                  name: "",
                                                  description: "",
                                                  type: "toggle",
                                                  defaultValue: "false",
                                                  isDefaultEnabled: false,
                                                  setupCost: 0,
                                                  priceFormula: "0",
                                                  parentOptionId: null,
                                                  displayOrder: 0,
                                                  isActive: true,
                                                });
                                              }
                                            }}
                                          >
                                            <DialogTrigger asChild>
                                              <Button
                                                variant="outline"
                                                size="sm"
                                                onClick={() => {
                                                  setEditingOption(null);
                                                  optionForm.reset({
                                                    name: "",
                                                    description: "",
                                                    type: "toggle",
                                                    defaultValue: "false",
                                                    isDefaultEnabled: false,
                                                    setupCost: 0,
                                                    priceFormula: "0",
                                                    parentOptionId: null,
                                                    displayOrder: 0,
                                                    isActive: true,
                                                  });
                                                }}
                                                data-testid={`button-add-option-${product.id}`}
                                              >
                                                <Plus className="w-4 h-4 mr-2" />
                                                Add Option
                                              </Button>
                                            </DialogTrigger>
                                            <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto" data-testid={`dialog-add-option-${product.id}`}>
                                              <DialogHeader>
                                                <DialogTitle>{editingOption ? "Edit Option" : "Add Option"}</DialogTitle>
                                                <DialogDescription>
                                                  Configure option details and pricing formula
                                                </DialogDescription>
                                              </DialogHeader>
                                              <Form {...optionForm}>
                                                <form
                                                  onSubmit={(e) => {
                                                    e.stopPropagation();
                                                    optionForm.handleSubmit((data) => {
                                                      if (editingOption) {
                                                        updateOptionMutation.mutate({ id: editingOption.id, data });
                                                      } else {
                                                        addOptionMutation.mutate(data);
                                                      }
                                                    })(e);
                                                  }}
                                                  className="space-y-4"
                                                >
                                                  <div className="grid grid-cols-2 gap-4">
                                                    <FormField
                                                      control={optionForm.control}
                                                      name="name"
                                                      render={({ field }) => (
                                                        <FormItem>
                                                          <FormLabel>Option Name</FormLabel>
                                                          <FormControl>
                                                            <Input placeholder="Pole Pocket" {...field} data-testid="input-option-name" />
                                                          </FormControl>
                                                          <FormMessage />
                                                        </FormItem>
                                                      )}
                                                    />
                                                    <FormField
                                                      control={optionForm.control}
                                                      name="type"
                                                      render={({ field }) => (
                                                        <FormItem>
                                                          <FormLabel>Type</FormLabel>
                                                          <Select onValueChange={field.onChange} value={field.value}>
                                                            <FormControl>
                                                              <SelectTrigger data-testid="select-option-type">
                                                                <SelectValue />
                                                              </SelectTrigger>
                                                            </FormControl>
                                                            <SelectContent>
                                                              <SelectItem value="toggle">Toggle</SelectItem>
                                                              <SelectItem value="number">Number</SelectItem>
                                                              <SelectItem value="select">Select</SelectItem>
                                                            </SelectContent>
                                                          </Select>
                                                          <FormMessage />
                                                        </FormItem>
                                                      )}
                                                    />
                                                  </div>
                                                  <FormField
                                                    control={optionForm.control}
                                                    name="description"
                                                    render={({ field }) => (
                                                      <FormItem>
                                                        <FormLabel>Description</FormLabel>
                                                        <FormControl>
                                                          <Textarea
                                                            placeholder="Add a pole pocket for hanging..."
                                                            {...field}
                                                            value={field.value || ""}
                                                            data-testid="textarea-option-description"
                                                          />
                                                        </FormControl>
                                                        <FormMessage />
                                                      </FormItem>
                                                    )}
                                                  />
                                                  <FormField
                                                    control={optionForm.control}
                                                    name="defaultValue"
                                                    render={({ field }) => {
                                                      const optionType = optionForm.watch("type");
                                                      
                                                      if (optionType === "select") {
                                                        return (
                                                          <FormItem className="col-span-2">
                                                            <FormLabel>Dropdown Choices</FormLabel>
                                                            <FormControl>
                                                              <SelectChoicesInput
                                                                value={field.value || ""}
                                                                onChange={field.onChange}
                                                              />
                                                            </FormControl>
                                                            <FormDescription className="text-xs">
                                                              Add dropdown choices for users to select from
                                                            </FormDescription>
                                                            <FormMessage />
                                                          </FormItem>
                                                        );
                                                      }
                                                      
                                                      return (
                                                        <FormItem>
                                                          <FormLabel>Default Value</FormLabel>
                                                          <FormControl>
                                                            <Input
                                                              placeholder={optionType === "toggle" ? "false" : "0"}
                                                              {...field}
                                                              value={field.value || ""}
                                                              data-testid="input-option-default-value"
                                                            />
                                                          </FormControl>
                                                          <FormDescription className="text-xs">
                                                            {optionType === "toggle" ? "Use 'true' or 'false'" : "Default numeric value"}
                                                          </FormDescription>
                                                          <FormMessage />
                                                        </FormItem>
                                                      );
                                                    }}
                                                  />
                                                  {optionForm.watch("type") === "select" && (
                                                    <FormField
                                                      control={optionForm.control}
                                                      name="defaultSelection"
                                                      render={({ field }) => {
                                                        const choices = (optionForm.watch("defaultValue") || "")
                                                          .split(",")
                                                          .map(s => s.trim())
                                                          .filter(Boolean);
                                                        
                                                        return (
                                                          <FormItem>
                                                            <FormLabel>Default Selection</FormLabel>
                                                            <Select
                                                              onValueChange={(value) => {
                                                                field.onChange(value === "__none__" ? "" : value);
                                                              }}
                                                              value={field.value || "__none__"}
                                                            >
                                                              <FormControl>
                                                                <SelectTrigger data-testid="select-default-selection">
                                                                  <SelectValue placeholder="Select default choice (optional)" />
                                                                </SelectTrigger>
                                                              </FormControl>
                                                              <SelectContent>
                                                                {choices.length === 0 ? (
                                                                  <SelectItem value="__disabled__" disabled>
                                                                    Add choices first
                                                                  </SelectItem>
                                                                ) : (
                                                                  <>
                                                                    <SelectItem value="__none__">None (user must select)</SelectItem>
                                                                    {choices.map((choice) => (
                                                                      <SelectItem key={choice} value={choice}>
                                                                        {choice}
                                                                      </SelectItem>
                                                                    ))}
                                                                  </>
                                                                )}
                                                              </SelectContent>
                                                            </Select>
                                                            <FormDescription className="text-xs">
                                                              Which option should be selected by default
                                                            </FormDescription>
                                                            <FormMessage />
                                                          </FormItem>
                                                        );
                                                      }}
                                                    />
                                                  )}
                                                  <div className="grid grid-cols-2 gap-4">
                                                    <FormField
                                                      control={optionForm.control}
                                                      name="setupCost"
                                                      render={({ field }) => (
                                                        <FormItem>
                                                          <FormLabel>Setup Cost ($)</FormLabel>
                                                          <FormControl>
                                                            <Input
                                                              type="number"
                                                              step="0.01"
                                                              placeholder="0.00"
                                                              {...field}
                                                              onChange={(e) => field.onChange(parseFloat(e.target.value) || 0)}
                                                              data-testid="input-option-setup-cost"
                                                            />
                                                          </FormControl>
                                                          <FormMessage />
                                                        </FormItem>
                                                      )}
                                                    />
                                                  </div>
                                                  <FormField
                                                    control={optionForm.control}
                                                    name="priceFormula"
                                                    render={({ field }) => (
                                                      <FormItem>
                                                        <FormLabel>Price Formula</FormLabel>
                                                        <FormControl>
                                                          <Input
                                                            placeholder="width * 0.5"
                                                            className="font-mono"
                                                            {...field}
                                                            value={field.value || ""}
                                                            data-testid="input-option-formula"
                                                          />
                                                        </FormControl>
                                                        <FormDescription className="text-xs">
                                                          JavaScript expression. Available: width, height, quantity, setupCost
                                                        </FormDescription>
                                                        <FormMessage />
                                                      </FormItem>
                                                    )}
                                                  />
                                                  <div className="grid grid-cols-2 gap-4">
                                                    <FormField
                                                      control={optionForm.control}
                                                      name="parentOptionId"
                                                      render={({ field }) => (
                                                        <FormItem>
                                                          <FormLabel>Parent Option (Optional)</FormLabel>
                                                          <Select
                                                            onValueChange={(value) => field.onChange(value === "none" ? null : value)}
                                                            value={field.value || "none"}
                                                          >
                                                            <FormControl>
                                                              <SelectTrigger data-testid="select-option-parent">
                                                                <SelectValue placeholder="None (Top-level)" />
                                                              </SelectTrigger>
                                                            </FormControl>
                                                            <SelectContent>
                                                              <SelectItem value="none">None (Top-level)</SelectItem>
                                                              {productOptions
                                                                ?.filter((opt) => !opt.parentOptionId && opt.id !== editingOption?.id)
                                                                .map((opt) => (
                                                                  <SelectItem key={opt.id} value={opt.id}>
                                                                    {opt.name}
                                                                  </SelectItem>
                                                                ))}
                                                            </SelectContent>
                                                          </Select>
                                                          <FormMessage />
                                                        </FormItem>
                                                      )}
                                                    />
                                                    <FormField
                                                      control={optionForm.control}
                                                      name="displayOrder"
                                                      render={({ field }) => (
                                                        <FormItem>
                                                          <FormLabel>Display Order</FormLabel>
                                                          <FormControl>
                                                            <Input
                                                              type="number"
                                                              {...field}
                                                              onChange={(e) => field.onChange(parseInt(e.target.value) || 0)}
                                                              data-testid="input-option-order"
                                                            />
                                                          </FormControl>
                                                          <FormMessage />
                                                        </FormItem>
                                                      )}
                                                    />
                                                  </div>
                                                  {optionForm.watch("type") === "toggle" && (
                                                    <FormField
                                                      control={optionForm.control}
                                                      name="isDefaultEnabled"
                                                      render={({ field }) => (
                                                        <FormItem className="flex flex-row items-center justify-between rounded-md border p-4">
                                                          <div className="space-y-0.5">
                                                            <FormLabel className="text-base">Default On</FormLabel>
                                                            <FormDescription>
                                                              Toggle will be enabled by default
                                                            </FormDescription>
                                                          </div>
                                                          <FormControl>
                                                            <Switch
                                                              checked={field.value}
                                                              onCheckedChange={field.onChange}
                                                              data-testid="switch-option-is-default"
                                                            />
                                                          </FormControl>
                                                        </FormItem>
                                                      )}
                                                    />
                                                  )}
                                                  <FormField
                                                    control={optionForm.control}
                                                    name="isActive"
                                                    render={({ field }) => (
                                                      <FormItem className="flex flex-row items-center justify-between rounded-md border p-4">
                                                        <div className="space-y-0.5">
                                                          <FormLabel className="text-base">Active</FormLabel>
                                                          <FormDescription>
                                                            Option will be available in the calculator
                                                          </FormDescription>
                                                        </div>
                                                        <FormControl>
                                                          <Switch
                                                            checked={field.value}
                                                            onCheckedChange={field.onChange}
                                                            data-testid="switch-option-active"
                                                          />
                                                        </FormControl>
                                                      </FormItem>
                                                    )}
                                                  />
                                                  <DialogFooter>
                                                    <Button
                                                      type="submit"
                                                      disabled={addOptionMutation.isPending || updateOptionMutation.isPending}
                                                      data-testid="button-submit-option"
                                                    >
                                                      {addOptionMutation.isPending || updateOptionMutation.isPending
                                                        ? editingOption ? "Updating..." : "Adding..."
                                                        : editingOption ? "Update Option" : "Add Option"}
                                                    </Button>
                                                  </DialogFooter>
                                                </form>
                                              </Form>
                                            </DialogContent>
                                          </Dialog>
                                        </div>

                                        {/* Options List */}
                                        <div className="space-y-2">
                                          {productOptions && productOptions.length > 0 ? (
                                            productOptions
                                              .filter((opt) => !opt.parentOptionId)
                                              .sort((a, b) => a.displayOrder - b.displayOrder)
                                              .map((parentOpt) => (
                                                <div key={parentOpt.id} className="space-y-2">
                                                  <Card data-testid={`card-option-${parentOpt.id}`}>
                                                    <CardContent className="p-4">
                                                      <div className="flex items-start justify-between gap-4">
                                                        <div className="flex-1 space-y-2">
                                                          <div className="flex items-center gap-2">
                                                            <h4 className="font-semibold" data-testid={`text-option-name-${parentOpt.id}`}>
                                                              {parentOpt.name}
                                                            </h4>
                                                            <Badge variant="outline" data-testid={`badge-option-type-${parentOpt.id}`}>
                                                              {parentOpt.type}
                                                            </Badge>
                                                            {!parentOpt.isActive && (
                                                              <Badge variant="secondary">Inactive</Badge>
                                                            )}
                                                          </div>
                                                          {parentOpt.description && (
                                                            <p className="text-sm text-muted-foreground" data-testid={`text-option-description-${parentOpt.id}`}>
                                                              {parentOpt.description}
                                                            </p>
                                                          )}
                                                          <div className="flex gap-4 text-xs text-muted-foreground">
                                                            {parseFloat(parentOpt.setupCost.toString()) > 0 && (
                                                              <span data-testid={`text-option-setup-${parentOpt.id}`}>
                                                                Setup: ${parentOpt.setupCost}
                                                              </span>
                                                            )}
                                                            <span className="font-mono" data-testid={`text-option-formula-${parentOpt.id}`}>
                                                              Formula: {parentOpt.priceFormula}
                                                            </span>
                                                          </div>
                                                        </div>
                                                        <div className="flex gap-2">
                                                          <Button
                                                            type="button"
                                                            variant="outline"
                                                            size="icon"
                                                            onClick={() => {
                                                              setEditingOption(parentOpt);
                                                              optionForm.reset({
                                                                name: parentOpt.name,
                                                                description: parentOpt.description || "",
                                                                type: parentOpt.type,
                                                                defaultValue: parentOpt.defaultValue || "",
                                                                isDefaultEnabled: parentOpt.isDefaultEnabled,
                                                                setupCost: parseFloat(parentOpt.setupCost.toString()),
                                                                priceFormula: parentOpt.priceFormula || "0",
                                                                parentOptionId: parentOpt.parentOptionId,
                                                                displayOrder: parentOpt.displayOrder,
                                                                isActive: parentOpt.isActive,
                                                              });
                                                              setIsAddOptionDialogOpen(true);
                                                            }}
                                                            data-testid={`button-edit-option-${parentOpt.id}`}
                                                          >
                                                            <Edit className="w-4 h-4" />
                                                          </Button>
                                                          <AlertDialog>
                                                            <AlertDialogTrigger asChild>
                                                              <Button
                                                                variant="outline"
                                                                size="icon"
                                                                data-testid={`button-delete-option-${parentOpt.id}`}
                                                              >
                                                                <Trash2 className="w-4 h-4" />
                                                              </Button>
                                                            </AlertDialogTrigger>
                                                            <AlertDialogContent data-testid={`dialog-delete-option-${parentOpt.id}`}>
                                                              <AlertDialogHeader>
                                                                <AlertDialogTitle>Delete Option?</AlertDialogTitle>
                                                                <AlertDialogDescription>
                                                                  This will permanently delete "{parentOpt.name}" and all its child options.
                                                                </AlertDialogDescription>
                                                              </AlertDialogHeader>
                                                              <AlertDialogFooter>
                                                                <AlertDialogCancel data-testid={`button-cancel-delete-option-${parentOpt.id}`}>
                                                                  Cancel
                                                                </AlertDialogCancel>
                                                                <AlertDialogAction
                                                                  onClick={() => deleteOptionMutation.mutate(parentOpt.id)}
                                                                  data-testid={`button-confirm-delete-option-${parentOpt.id}`}
                                                                >
                                                                  Delete
                                                                </AlertDialogAction>
                                                              </AlertDialogFooter>
                                                            </AlertDialogContent>
                                                          </AlertDialog>
                                                        </div>
                                                      </div>
                                                    </CardContent>
                                                  </Card>

                                                  {/* Child Options */}
                                                  {productOptions
                                                    .filter((opt) => opt.parentOptionId === parentOpt.id)
                                                    .sort((a, b) => a.displayOrder - b.displayOrder)
                                                    .map((childOpt) => (
                                                      <Card
                                                        key={childOpt.id}
                                                        className="ml-6 border-l-4"
                                                        data-testid={`card-option-${childOpt.id}`}
                                                      >
                                                        <CardContent className="p-4">
                                                          <div className="flex items-start justify-between gap-4">
                                                            <div className="flex-1 space-y-2">
                                                              <div className="flex items-center gap-2">
                                                                <h4 className="font-semibold" data-testid={`text-option-name-${childOpt.id}`}>
                                                                  {childOpt.name}
                                                                </h4>
                                                                <Badge variant="outline" data-testid={`badge-option-type-${childOpt.id}`}>
                                                                  {childOpt.type}
                                                                </Badge>
                                                                {!childOpt.isActive && (
                                                                  <Badge variant="secondary">Inactive</Badge>
                                                                )}
                                                              </div>
                                                              {childOpt.description && (
                                                                <p className="text-sm text-muted-foreground" data-testid={`text-option-description-${childOpt.id}`}>
                                                                  {childOpt.description}
                                                                </p>
                                                              )}
                                                              <div className="flex gap-4 text-xs text-muted-foreground">
                                                                {parseFloat(childOpt.setupCost.toString()) > 0 && (
                                                                  <span data-testid={`text-option-setup-${childOpt.id}`}>
                                                                    Setup: ${childOpt.setupCost}
                                                                  </span>
                                                                )}
                                                                <span className="font-mono" data-testid={`text-option-formula-${childOpt.id}`}>
                                                                  Formula: {childOpt.priceFormula}
                                                                </span>
                                                              </div>
                                                            </div>
                                                            <div className="flex gap-2">
                                                              <Button
                                                                type="button"
                                                                variant="outline"
                                                                size="icon"
                                                                onClick={() => {
                                                                  setEditingOption(childOpt);
                                                                  optionForm.reset({
                                                                    name: childOpt.name,
                                                                    description: childOpt.description || "",
                                                                    type: childOpt.type,
                                                                    defaultValue: childOpt.defaultValue || "",
                                                                    isDefaultEnabled: childOpt.isDefaultEnabled,
                                                                    setupCost: parseFloat(childOpt.setupCost.toString()),
                                                                    priceFormula: childOpt.priceFormula || "0",
                                                                    parentOptionId: childOpt.parentOptionId,
                                                                    displayOrder: childOpt.displayOrder,
                                                                    isActive: childOpt.isActive,
                                                                  });
                                                                  setIsAddOptionDialogOpen(true);
                                                                }}
                                                                data-testid={`button-edit-option-${childOpt.id}`}
                                                              >
                                                                <Edit className="w-4 h-4" />
                                                              </Button>
                                                              <AlertDialog>
                                                                <AlertDialogTrigger asChild>
                                                                  <Button
                                                                    variant="outline"
                                                                    size="icon"
                                                                    data-testid={`button-delete-option-${childOpt.id}`}
                                                                  >
                                                                    <Trash2 className="w-4 h-4" />
                                                                  </Button>
                                                                </AlertDialogTrigger>
                                                                <AlertDialogContent data-testid={`dialog-delete-option-${childOpt.id}`}>
                                                                  <AlertDialogHeader>
                                                                    <AlertDialogTitle>Delete Option?</AlertDialogTitle>
                                                                    <AlertDialogDescription>
                                                                      This will permanently delete "{childOpt.name}".
                                                                    </AlertDialogDescription>
                                                                  </AlertDialogHeader>
                                                                  <AlertDialogFooter>
                                                                    <AlertDialogCancel data-testid={`button-cancel-delete-option-${childOpt.id}`}>
                                                                      Cancel
                                                                    </AlertDialogCancel>
                                                                    <AlertDialogAction
                                                                      onClick={() => deleteOptionMutation.mutate(childOpt.id)}
                                                                      data-testid={`button-confirm-delete-option-${childOpt.id}`}
                                                                    >
                                                                      Delete
                                                                    </AlertDialogAction>
                                                                  </AlertDialogFooter>
                                                                </AlertDialogContent>
                                                              </AlertDialog>
                                                            </div>
                                                          </div>
                                                        </CardContent>
                                                      </Card>
                                                    ))}
                                                </div>
                                              ))
                                          ) : (
                                            <p className="text-sm text-muted-foreground text-center py-8" data-testid="text-no-options">
                                              No options configured yet. Click "Add Option" to get started.
                                            </p>
                                          )}
                                        </div>
                                      </div>

                                      <DialogFooter>
                                        <Button
                                          type="submit"
                                          disabled={updateProductMutation.isPending}
                                          data-testid={`button-submit-edit-${product.id}`}
                                        >
                                          {updateProductMutation.isPending ? "Updating..." : "Update Product"}
                                        </Button>
                                      </DialogFooter>
                                    </form>
                                  </Form>
                                </DialogContent>
                              </Dialog>

                              <Button
                                variant="outline"
                                size="icon"
                                onClick={() => cloneProductMutation.mutate(product.id)}
                                disabled={cloneProductMutation.isPending}
                                data-testid={`button-clone-${product.id}`}
                              >
                                <Copy className="w-4 h-4" />
                              </Button>

                              <AlertDialog>
                                <AlertDialogTrigger asChild>
                                  <Button
                                    variant="outline"
                                    size="icon"
                                    data-testid={`button-delete-${product.id}`}
                                  >
                                    <Trash2 className="w-4 h-4" />
                                  </Button>
                                </AlertDialogTrigger>
                                <AlertDialogContent data-testid={`dialog-delete-${product.id}`}>
                                  <AlertDialogHeader>
                                    <AlertDialogTitle>Delete Product?</AlertDialogTitle>
                                    <AlertDialogDescription>
                                      This will permanently delete "{product.name}". This action cannot be undone.
                                    </AlertDialogDescription>
                                  </AlertDialogHeader>
                                  <AlertDialogFooter>
                                    <AlertDialogCancel data-testid={`button-cancel-delete-${product.id}`}>
                                      Cancel
                                    </AlertDialogCancel>
                                    <AlertDialogAction
                                      onClick={() => deleteProductMutation.mutate(product.id)}
                                      data-testid={`button-confirm-delete-${product.id}`}
                                    >
                                      Delete
                                    </AlertDialogAction>
                                  </AlertDialogFooter>
                                </AlertDialogContent>
                              </AlertDialog>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))
                    ) : (
                      <TableRow>
                        <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                          No products yet. Add your first product to get started.
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            </TabsContent>

            <TabsContent value="variables" className="space-y-4">
              <div className="flex justify-between items-center gap-4">
                <div className="flex-1 max-w-md">
                  <Input
                    placeholder="Search variables..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    data-testid="input-search-variables"
                  />
                </div>
                <Dialog open={isAddVariableDialogOpen} onOpenChange={setIsAddVariableDialogOpen}>
                  <DialogTrigger asChild>
                    <Button data-testid="button-add-variable">
                      <Plus className="w-4 h-4 mr-2" />
                      Add Variable
                    </Button>
                  </DialogTrigger>
                  <DialogContent className="max-w-2xl" data-testid="dialog-add-variable">
                    <DialogHeader>
                      <DialogTitle>Add New Global Variable</DialogTitle>
                      <DialogDescription>
                        Create a new global variable for use in pricing calculations
                      </DialogDescription>
                    </DialogHeader>
                    <Form {...variableForm}>
                      <form onSubmit={variableForm.handleSubmit((data) => addVariableMutation.mutate(data))} className="space-y-4">
                        <FormField
                          control={variableForm.control}
                          name="name"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel data-testid="label-variable-name">Variable Name</FormLabel>
                              <FormControl>
                                <Input placeholder="BASE_COST" {...field} data-testid="input-variable-name" />
                              </FormControl>
                              <FormDescription>
                                Use a unique, descriptive name (e.g., BASE_COST, TAX_RATE)
                              </FormDescription>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        <FormField
                          control={variableForm.control}
                          name="value"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel data-testid="label-variable-value">Value</FormLabel>
                              <FormControl>
                                <Input 
                                  type="number" 
                                  step="0.0001"
                                  placeholder="0"
                                  {...field}
                                  onChange={(e) => field.onChange(Number(e.target.value))}
                                  data-testid="input-variable-value"
                                />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        <FormField
                          control={variableForm.control}
                          name="description"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel data-testid="label-variable-description">Description</FormLabel>
                              <FormControl>
                                <Textarea
                                  placeholder="Description of what this variable is used for..."
                                  {...field}
                                  value={field.value || ""}
                                  data-testid="textarea-variable-description"
                                />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        <FormField
                          control={variableForm.control}
                          name="category"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel data-testid="label-variable-category">Category (Optional)</FormLabel>
                              <FormControl>
                                <Input 
                                  placeholder="Costs" 
                                  {...field} 
                                  value={field.value || ""}
                                  data-testid="input-variable-category"
                                />
                              </FormControl>
                              <FormDescription>
                                Group related variables by category
                              </FormDescription>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        <DialogFooter>
                          <Button
                            type="submit"
                            disabled={addVariableMutation.isPending}
                            data-testid="button-submit-add-variable"
                          >
                            {addVariableMutation.isPending ? "Adding..." : "Add Variable"}
                          </Button>
                        </DialogFooter>
                      </form>
                    </Form>
                  </DialogContent>
                </Dialog>
              </div>

              <div className="border rounded-md">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead data-testid="header-variable-name">Name</TableHead>
                      <TableHead data-testid="header-variable-value">Value</TableHead>
                      <TableHead data-testid="header-variable-description">Description</TableHead>
                      <TableHead data-testid="header-variable-category">Category</TableHead>
                      <TableHead data-testid="header-variable-actions" className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {variablesLoading ? (
                      <TableRow>
                        <TableCell colSpan={5} className="text-center py-8">
                          <Skeleton className="h-8 w-full" />
                        </TableCell>
                      </TableRow>
                    ) : filteredVariables && filteredVariables.length > 0 ? (
                      filteredVariables.map((variable) => (
                        <TableRow key={variable.id} data-testid={`row-variable-${variable.id}`}>
                          <TableCell className="font-medium font-mono" data-testid={`cell-variable-name-${variable.id}`}>
                            {variable.name}
                          </TableCell>
                          <TableCell className="font-mono" data-testid={`cell-variable-value-${variable.id}`}>
                            {Number(variable.value).toFixed(4)}
                          </TableCell>
                          <TableCell className="max-w-xs truncate" data-testid={`cell-variable-description-${variable.id}`}>
                            {variable.description || <span className="text-muted-foreground">—</span>}
                          </TableCell>
                          <TableCell data-testid={`cell-variable-category-${variable.id}`}>
                            {variable.category ? (
                              <Badge variant="outline" data-testid={`badge-category-${variable.id}`}>{variable.category}</Badge>
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="flex justify-end gap-2">
                              <Dialog
                                open={editingVariable?.id === variable.id}
                                onOpenChange={(open) => !open && setEditingVariable(null)}
                              >
                                <DialogTrigger asChild>
                                  <Button
                                    variant="outline"
                                    size="icon"
                                    onClick={() => handleEditVariable(variable)}
                                    data-testid={`button-edit-variable-${variable.id}`}
                                  >
                                    <Edit className="w-4 h-4" />
                                  </Button>
                                </DialogTrigger>
                                <DialogContent className="max-w-2xl" data-testid={`dialog-edit-variable-${variable.id}`}>
                                  <DialogHeader>
                                    <DialogTitle>Edit Global Variable</DialogTitle>
                                    <DialogDescription>
                                      Update variable details
                                    </DialogDescription>
                                  </DialogHeader>
                                  <Form {...editVariableForm}>
                                    <form
                                      onSubmit={editVariableForm.handleSubmit((data) =>
                                        updateVariableMutation.mutate({ id: variable.id, data })
                                      )}
                                      className="space-y-4"
                                    >
                                      <FormField
                                        control={editVariableForm.control}
                                        name="name"
                                        render={({ field }) => (
                                          <FormItem>
                                            <FormLabel>Variable Name</FormLabel>
                                            <FormControl>
                                              <Input {...field} data-testid={`input-edit-variable-name-${variable.id}`} />
                                            </FormControl>
                                            <FormMessage />
                                          </FormItem>
                                        )}
                                      />
                                      <FormField
                                        control={editVariableForm.control}
                                        name="value"
                                        render={({ field }) => (
                                          <FormItem>
                                            <FormLabel>Value</FormLabel>
                                            <FormControl>
                                              <Input 
                                                type="number" 
                                                step="0.0001"
                                                {...field}
                                                onChange={(e) => field.onChange(Number(e.target.value))}
                                                data-testid={`input-edit-variable-value-${variable.id}`}
                                              />
                                            </FormControl>
                                            <FormMessage />
                                          </FormItem>
                                        )}
                                      />
                                      <FormField
                                        control={editVariableForm.control}
                                        name="description"
                                        render={({ field }) => (
                                          <FormItem>
                                            <FormLabel>Description</FormLabel>
                                            <FormControl>
                                              <Textarea {...field} value={field.value || ""} data-testid={`textarea-edit-variable-description-${variable.id}`} />
                                            </FormControl>
                                            <FormMessage />
                                          </FormItem>
                                        )}
                                      />
                                      <FormField
                                        control={editVariableForm.control}
                                        name="category"
                                        render={({ field }) => (
                                          <FormItem>
                                            <FormLabel>Category</FormLabel>
                                            <FormControl>
                                              <Input {...field} value={field.value || ""} data-testid={`input-edit-variable-category-${variable.id}`} />
                                            </FormControl>
                                            <FormMessage />
                                          </FormItem>
                                        )}
                                      />
                                      <DialogFooter>
                                        <Button
                                          type="submit"
                                          disabled={updateVariableMutation.isPending}
                                          data-testid={`button-submit-edit-variable-${variable.id}`}
                                        >
                                          {updateVariableMutation.isPending ? "Updating..." : "Update Variable"}
                                        </Button>
                                      </DialogFooter>
                                    </form>
                                  </Form>
                                </DialogContent>
                              </Dialog>

                              <AlertDialog>
                                <AlertDialogTrigger asChild>
                                  <Button
                                    variant="outline"
                                    size="icon"
                                    data-testid={`button-delete-variable-${variable.id}`}
                                  >
                                    <Trash2 className="w-4 h-4" />
                                  </Button>
                                </AlertDialogTrigger>
                                <AlertDialogContent data-testid={`dialog-delete-variable-${variable.id}`}>
                                  <AlertDialogHeader>
                                    <AlertDialogTitle>Delete Variable?</AlertDialogTitle>
                                    <AlertDialogDescription>
                                      This will permanently delete "{variable.name}". This action cannot be undone.
                                    </AlertDialogDescription>
                                  </AlertDialogHeader>
                                  <AlertDialogFooter>
                                    <AlertDialogCancel data-testid={`button-cancel-delete-variable-${variable.id}`}>
                                      Cancel
                                    </AlertDialogCancel>
                                    <AlertDialogAction
                                      onClick={() => deleteVariableMutation.mutate(variable.id)}
                                      data-testid={`button-confirm-delete-variable-${variable.id}`}
                                    >
                                      Delete
                                    </AlertDialogAction>
                                  </AlertDialogFooter>
                                </AlertDialogContent>
                              </AlertDialog>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))
                    ) : searchTerm ? (
                      <TableRow>
                        <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                          No variables match your search.
                        </TableCell>
                      </TableRow>
                    ) : (
                      <TableRow>
                        <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                          No global variables yet. Add your first variable to get started.
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            </TabsContent>

            <TabsContent value="formulas" className="space-y-4">
              <div className="space-y-4">
                <h3 className="text-lg font-semibold">Pricing Formula Guide</h3>
                <Card data-testid="card-formula-guide">
                  <CardHeader>
                    <CardTitle>How to Write Pricing Formulas</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div>
                      <h4 className="font-medium mb-2">Available Variables:</h4>
                      <ul className="list-disc list-inside space-y-1 text-sm text-muted-foreground">
                        <li><code className="bg-muted px-1 rounded">width</code> - Product width in inches</li>
                        <li><code className="bg-muted px-1 rounded">height</code> - Product height in inches</li>
                        <li><code className="bg-muted px-1 rounded">quantity</code> - Number of items</li>
                      </ul>
                    </div>
                    <div>
                      <h4 className="font-medium mb-2">Example Formulas:</h4>
                      <div className="space-y-2 text-sm">
                        <div className="bg-muted p-2 rounded">
                          <code className="font-mono">width * height * 0.05 * quantity</code>
                          <p className="text-muted-foreground mt-1">Simple area-based pricing</p>
                        </div>
                        <div className="bg-muted p-2 rounded">
                          <code className="font-mono">(width * height * 0.05 * quantity) + 10</code>
                          <p className="text-muted-foreground mt-1">Area-based with setup fee</p>
                        </div>
                        <div className="bg-muted p-2 rounded">
                          <code className="font-mono">Math.max(50, width * height * 0.05 * quantity)</code>
                          <p className="text-muted-foreground mt-1">Minimum order price of $50</p>
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </div>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
}
