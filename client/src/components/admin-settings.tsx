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
import { Edit, Plus, Settings as SettingsIcon, Trash2 } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import type {
  Product,
  InsertProduct,
  UpdateProduct,
  ProductOption,
  InsertProductOption,
  UpdateProductOption
} from "@shared/schema";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { insertProductSchema, insertProductOptionSchema } from "@shared/schema";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";

export default function AdminSettings() {
  const { toast } = useToast();
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [editingOption, setEditingOption] = useState<ProductOption | null>(null);
  const [isAddOptionDialogOpen, setIsAddOptionDialogOpen] = useState(false);

  const { data: products, isLoading: productsLoading } = useQuery<Product[]>({
    queryKey: ["/api/products"],
  });

  const addProductForm = useForm<InsertProduct>({
    resolver: zodResolver(insertProductSchema),
    defaultValues: {
      name: "",
      description: "",
      pricingFormula: "width * height * 0.05 * quantity",
      storeUrl: "",
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
      isDefaultEnabled: false,
      setupCost: 0,
      priceFormula: "0",
      parentOptionId: null,
      displayOrder: 0,
      isActive: true,
    },
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
      queryClient.invalidateQueries({ queryKey: ["/api/products", editingProduct?.id, "options"] });
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

  const handleEditProduct = (product: Product) => {
    setEditingProduct(product);
    editProductForm.reset({
      name: product.name,
      description: product.description,
      pricingFormula: product.pricingFormula,
      storeUrl: product.storeUrl || "",
      isActive: product.isActive,
    });
  };

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
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="products" data-testid="tab-products">Products</TabsTrigger>
              <TabsTrigger value="formulas" data-testid="tab-formulas">Pricing Formulas</TabsTrigger>
            </TabsList>

            <TabsContent value="products" className="space-y-4">
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
                      <form onSubmit={addProductForm.handleSubmit((data) => addProductMutation.mutate(data))} className="space-y-4">
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
                                <DialogContent className="max-w-2xl" data-testid={`dialog-edit-${product.id}`}>
                                  <DialogHeader>
                                    <DialogTitle>Edit Product</DialogTitle>
                                    <DialogDescription>
                                      Update product details and pricing formula
                                    </DialogDescription>
                                  </DialogHeader>
                                  <Form {...editProductForm}>
                                    <form
                                      onSubmit={editProductForm.handleSubmit((data) =>
                                        updateProductMutation.mutate({ id: product.id, data })
                                      )}
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
                                                  onSubmit={optionForm.handleSubmit((data) => {
                                                    if (editingOption) {
                                                      updateOptionMutation.mutate({ id: editingOption.id, data });
                                                    } else {
                                                      addOptionMutation.mutate(data);
                                                    }
                                                  })}
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
                                                  <div className="grid grid-cols-2 gap-4">
                                                    <FormField
                                                      control={optionForm.control}
                                                      name="defaultValue"
                                                      render={({ field }) => (
                                                        <FormItem>
                                                          <FormLabel>Default Value</FormLabel>
                                                          <FormControl>
                                                            <Input placeholder="false" {...field} value={field.value || ""} data-testid="input-option-default-value" />
                                                          </FormControl>
                                                          <FormDescription className="text-xs">
                                                            For toggle: "true"/"false", number: "0", select: option value
                                                          </FormDescription>
                                                          <FormMessage />
                                                        </FormItem>
                                                      )}
                                                    />
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
