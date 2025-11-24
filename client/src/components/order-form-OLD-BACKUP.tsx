import { useState, useEffect } from "react";
import { useForm, useFieldArray } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useQuery } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { useCreateOrder } from "@/hooks/useOrders";
import { Trash2, Plus, Search } from "lucide-react";
import { format } from "date-fns";

const orderLineItemSchema = z.object({
  productId: z.string().min(1, "Product is required"),
  productVariantId: z.string().optional().nullable(),
  description: z.string().min(1, "Description is required"),
  width: z.number().positive().optional().nullable(),
  height: z.number().positive().optional().nullable(),
  quantity: z.number().int().positive("Quantity must be positive"),
  sqft: z.number().positive().optional().nullable(),
  unitPrice: z.number().min(0, "Unit price must be positive"),
  totalPrice: z.number().min(0, "Total price must be positive"),
  status: z.enum(["queued", "printing", "finishing", "done", "canceled"]).default("queued"),
});

const orderSchema = z.object({
  customerId: z.string().min(1, "Customer is required"),
  contactId: z.string().optional().nullable(),
  status: z.enum(["new", "scheduled", "in_production", "ready_for_pickup", "shipped", "completed", "on_hold", "canceled"]).default("new"),
  priority: z.enum(["rush", "normal", "low"]).default("normal"),
  dueDate: z.string().optional().nullable(),
  promisedDate: z.string().optional().nullable(),
  discount: z.number().min(0).default(0),
  notesInternal: z.string().optional().nullable(),
  lineItems: z.array(orderLineItemSchema).min(1, "At least one line item is required"),
});

type OrderFormData = z.infer<typeof orderSchema>;

interface OrderFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: (orderId: string) => void;
}

export default function OrderForm({ open, onOpenChange, onSuccess }: OrderFormProps) {
  const { toast } = useToast();
  const createOrder = useCreateOrder();
  const [searchProduct, setSearchProduct] = useState("");
  const [searchCustomer, setSearchCustomer] = useState("");

  const {
    register,
    handleSubmit,
    control,
    formState: { errors },
    setValue,
    watch,
    reset,
  } = useForm<OrderFormData>({
    resolver: zodResolver(orderSchema),
    defaultValues: {
      customerId: "",
      contactId: null,
      status: "new",
      priority: "normal",
      dueDate: null,
      promisedDate: null,
      discount: 0,
      notesInternal: "",
      lineItems: [],
    },
  });

  const { fields, append, remove } = useFieldArray({
    control,
    name: "lineItems",
  });

  // Fetch customers
  const { data: customers } = useQuery<any[]>({
    queryKey: ["/api/customers"],
    queryFn: async () => {
      const response = await fetch("/api/customers", { credentials: "include" });
      if (!response.ok) throw new Error("Failed to fetch customers");
      return response.json();
    },
  });

  // Fetch products
  const { data: products } = useQuery<any[]>({
    queryKey: ["/api/products"],
    queryFn: async () => {
      const response = await fetch("/api/products", { credentials: "include" });
      if (!response.ok) throw new Error("Failed to fetch products");
      return response.json();
    },
  });

  // Fetch contacts for selected customer
  const customerId = watch("customerId");
  const { data: contacts } = useQuery<any[]>({
    queryKey: ["/api/customers", customerId, "contacts"],
    queryFn: async () => {
      if (!customerId) return [];
      const response = await fetch(`/api/customers/${customerId}/contacts`, { credentials: "include" });
      if (!response.ok) throw new Error("Failed to fetch contacts");
      return response.json();
    },
    enabled: !!customerId,
  });

  const onSubmit = async (data: OrderFormData) => {
    try {
      const result = await createOrder.mutateAsync(data);
      reset();
      onOpenChange(false);
      if (onSuccess && result?.id) {
        onSuccess(result.id);
      }
    } catch (error) {
      // Error toast handled by mutation
    }
  };

  const addLineItem = () => {
    append({
      productId: "",
      productVariantId: null,
      description: "",
      width: null,
      height: null,
      quantity: 1,
      sqft: null,
      unitPrice: 0,
      totalPrice: 0,
      status: "queued",
    });
  };

  const calculateLineItemTotal = (index: number) => {
    const lineItem = watch(`lineItems.${index}`);
    if (lineItem) {
      const total = lineItem.quantity * lineItem.unitPrice;
      setValue(`lineItems.${index}.totalPrice`, total);
      
      // Calculate sqft if width and height are provided
      if (lineItem.width && lineItem.height) {
        const sqft = (lineItem.width * lineItem.height * lineItem.quantity) / 144;
        setValue(`lineItems.${index}.sqft`, sqft);
      }
    }
  };

  const filteredCustomers = customers?.filter(c =>
    c.companyName.toLowerCase().includes(searchCustomer.toLowerCase())
  ) || [];

  const filteredProducts = products?.filter(p =>
    p.name.toLowerCase().includes(searchProduct.toLowerCase())
  ) || [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Create New Order</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
          {/* Customer Selection */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Customer Information</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="customerId">Customer *</Label>
                  <Select
                    value={watch("customerId")}
                    onValueChange={(value) => setValue("customerId", value)}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select customer" />
                    </SelectTrigger>
                    <SelectContent>
                      <div className="p-2">
                        <Input
                          placeholder="Search customers..."
                          value={searchCustomer}
                          onChange={(e) => setSearchCustomer(e.target.value)}
                          className="mb-2"
                        />
                      </div>
                      {filteredCustomers.map((customer) => (
                        <SelectItem key={customer.id} value={customer.id}>
                          {customer.companyName}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {errors.customerId && (
                    <p className="text-sm text-destructive mt-1">{errors.customerId.message}</p>
                  )}
                </div>

                <div>
                  <Label htmlFor="contactId">Contact</Label>
                  <Select
                    value={watch("contactId") || undefined}
                    onValueChange={(value) => setValue("contactId", value)}
                    disabled={!customerId}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select contact (optional)" />
                    </SelectTrigger>
                    <SelectContent>
                      {contacts?.map((contact) => (
                        <SelectItem key={contact.id} value={contact.id}>
                          {contact.firstName} {contact.lastName}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Order Details */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Order Details</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="status">Status</Label>
                  <Select
                    value={watch("status")}
                    onValueChange={(value: any) => setValue("status", value)}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="new">New</SelectItem>
                      <SelectItem value="scheduled">Scheduled</SelectItem>
                      <SelectItem value="in_production">In Production</SelectItem>
                      <SelectItem value="ready_for_pickup">Ready for Pickup</SelectItem>
                      <SelectItem value="shipped">Shipped</SelectItem>
                      <SelectItem value="completed">Completed</SelectItem>
                      <SelectItem value="on_hold">On Hold</SelectItem>
                      <SelectItem value="canceled">Canceled</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <Label htmlFor="priority">Priority</Label>
                  <Select
                    value={watch("priority")}
                    onValueChange={(value: any) => setValue("priority", value)}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="rush">Rush</SelectItem>
                      <SelectItem value="normal">Normal</SelectItem>
                      <SelectItem value="low">Low</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <Label htmlFor="dueDate">Due Date</Label>
                  <Input
                    type="date"
                    {...register("dueDate")}
                  />
                </div>

                <div>
                  <Label htmlFor="promisedDate">Promised Date</Label>
                  <Input
                    type="date"
                    {...register("promisedDate")}
                  />
                </div>

                <div>
                  <Label htmlFor="discount">Discount Amount</Label>
                  <Input
                    type="number"
                    step="0.01"
                    {...register("discount", { valueAsNumber: true })}
                  />
                </div>
              </div>

              <div>
                <Label htmlFor="notesInternal">Internal Notes</Label>
                <Textarea
                  {...register("notesInternal")}
                  placeholder="Add internal notes about this order..."
                  rows={3}
                />
              </div>
            </CardContent>
          </Card>

          {/* Line Items */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="text-base">Line Items</CardTitle>
                <Button type="button" size="sm" onClick={addLineItem}>
                  <Plus className="w-4 h-4 mr-2" />
                  Add Item
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {fields.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <p>No line items added yet</p>
                  <Button type="button" variant="outline" size="sm" onClick={addLineItem} className="mt-2">
                    <Plus className="w-4 h-4 mr-2" />
                    Add First Item
                  </Button>
                </div>
              ) : (
                <div className="space-y-4">
                  {fields.map((field, index) => (
                    <Card key={field.id} className="relative">
                      <CardContent className="pt-6">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => remove(index)}
                          className="absolute top-2 right-2"
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>

                        <div className="grid grid-cols-3 gap-4">
                          <div className="col-span-2">
                            <Label>Product *</Label>
                            <Select
                              value={watch(`lineItems.${index}.productId`)}
                              onValueChange={(value) => {
                                setValue(`lineItems.${index}.productId`, value);
                                const product = products?.find(p => p.id === value);
                                if (product) {
                                  setValue(`lineItems.${index}.description`, product.name);
                                }
                              }}
                            >
                              <SelectTrigger>
                                <SelectValue placeholder="Select product" />
                              </SelectTrigger>
                              <SelectContent>
                                {products?.map((product) => (
                                  <SelectItem key={product.id} value={product.id}>
                                    {product.name}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>

                          <div>
                            <Label>Quantity *</Label>
                            <Input
                              type="number"
                              {...register(`lineItems.${index}.quantity`, { valueAsNumber: true })}
                              onChange={() => calculateLineItemTotal(index)}
                            />
                          </div>

                          <div className="col-span-3">
                            <Label>Description *</Label>
                            <Textarea
                              {...register(`lineItems.${index}.description`)}
                              rows={2}
                            />
                          </div>

                          <div>
                            <Label>Width (inches)</Label>
                            <Input
                              type="number"
                              step="0.01"
                              {...register(`lineItems.${index}.width`, { valueAsNumber: true })}
                              onChange={() => calculateLineItemTotal(index)}
                            />
                          </div>

                          <div>
                            <Label>Height (inches)</Label>
                            <Input
                              type="number"
                              step="0.01"
                              {...register(`lineItems.${index}.height`, { valueAsNumber: true })}
                              onChange={() => calculateLineItemTotal(index)}
                            />
                          </div>

                          <div>
                            <Label>Sq Ft</Label>
                            <Input
                              type="number"
                              step="0.01"
                              {...register(`lineItems.${index}.sqft`, { valueAsNumber: true })}
                              disabled
                            />
                          </div>

                          <div>
                            <Label>Unit Price *</Label>
                            <Input
                              type="number"
                              step="0.01"
                              {...register(`lineItems.${index}.unitPrice`, { valueAsNumber: true })}
                              onChange={() => calculateLineItemTotal(index)}
                            />
                          </div>

                          <div>
                            <Label>Total Price</Label>
                            <Input
                              type="number"
                              step="0.01"
                              {...register(`lineItems.${index}.totalPrice`, { valueAsNumber: true })}
                              disabled
                            />
                          </div>

                          <div>
                            <Label>Status</Label>
                            <Select
                              value={watch(`lineItems.${index}.status`)}
                              onValueChange={(value: any) => setValue(`lineItems.${index}.status`, value)}
                            >
                              <SelectTrigger>
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="queued">Queued</SelectItem>
                                <SelectItem value="printing">Printing</SelectItem>
                                <SelectItem value="finishing">Finishing</SelectItem>
                                <SelectItem value="done">Done</SelectItem>
                                <SelectItem value="canceled">Canceled</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}
              {errors.lineItems && (
                <p className="text-sm text-destructive mt-2">{errors.lineItems.message}</p>
              )}
            </CardContent>
          </Card>

          {/* Form Actions */}
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                reset();
                onOpenChange(false);
              }}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={createOrder.isPending}>
              {createOrder.isPending ? "Creating..." : "Create Order"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
