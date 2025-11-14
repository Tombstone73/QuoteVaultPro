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
import type { Product, InsertProduct, UpdateProduct } from "@shared/schema";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { insertProductSchema } from "@shared/schema";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";

export default function AdminSettings() {
  const { toast } = useToast();
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);

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
                                              <Input {...field} data-testid={`input-edit-url-${product.id}`} />
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
