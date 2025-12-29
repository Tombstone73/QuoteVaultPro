import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
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
import { ArrowLeft, Calendar, User, Package, DollarSign, Trash2, Edit, Check, X, Plus, UserCog, Truck, ExternalLink, FileText } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useOrder, useDeleteOrder, useUpdateOrder, useUpdateOrderLineItem, useCreateOrderLineItem, useDeleteOrderLineItem } from "@/hooks/useOrders";
import { useQuery } from "@tanstack/react-query";
import { OrderLineItemDialog } from "@/components/order-line-item-dialog";
import type { OrderLineItem as HookOrderLineItem, OrderWithRelations as HookOrderWithRelations } from "@/hooks/useOrders";
import { OrderStatusBadge, OrderPriorityBadge, LineItemStatusBadge } from "@/components/order-status-badge";
import { FulfillmentStatusBadge } from "@/components/FulfillmentStatusBadge";
import { ShipmentForm } from "@/components/ShipmentForm";
import { PackingSlipModal } from "@/components/PackingSlipModal";
import { OrderArtworkPanel } from "@/components/OrderArtworkPanel";
import { useShipments, useDeleteShipment, useUpdateShipment, useGeneratePackingSlip, useSendShipmentEmail, useUpdateFulfillmentStatus } from "@/hooks/useShipments";
import type { Shipment } from "@shared/schema";
import { format } from "date-fns";
import { useToast } from "@/hooks/use-toast";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Page, PageHeader, ContentLayout, DataCard, StatusPill } from "@/components/titan";
import { TimelinePanel } from "@/components/TimelinePanel";

/**
 * OrderDetail renders some legacy "bill to / ship to / shipping" snapshot fields
 * that are returned by the API but are not part of the current `OrderWithRelations`
 * type in `@shared/schema`.
 *
 * We model them here as optional fields to keep runtime behavior identical while
 * satisfying TypeScript without weakening types globally.
 */
type OrderAddressSnapshotFields = {
  billToName?: string | null;
  billToCompany?: string | null;
  billToAddress1?: string | null;
  billToAddress2?: string | null;
  billToCity?: string | null;
  billToState?: string | null;
  billToPostalCode?: string | null;
  billToPhone?: string | null;
  billToEmail?: string | null;

  shipToName?: string | null;
  shipToCompany?: string | null;
  shipToAddress1?: string | null;
  shipToAddress2?: string | null;
  shipToCity?: string | null;
  shipToState?: string | null;
  shipToPostalCode?: string | null;

  shippingMethod?: string | null;
  carrier?: string | null;
  trackingNumber?: string | null;
};

type OrderDetailOrder = HookOrderWithRelations & OrderAddressSnapshotFields;
type OrderDetailLineItem = HookOrderWithRelations["lineItems"][number];

export default function OrderDetail() {
  const { user } = useAuth();
  const params = useParams();
  const navigate = useNavigate();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [showCustomerDialog, setShowCustomerDialog] = useState(false);
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(null);
  const [editingDueDate, setEditingDueDate] = useState(false);
  const [editingPromisedDate, setEditingPromisedDate] = useState(false);
  const [tempDueDate, setTempDueDate] = useState("");
  const [tempPromisedDate, setTempPromisedDate] = useState("");
  const [showLineItemDialog, setShowLineItemDialog] = useState(false);
  const [editingLineItem, setEditingLineItem] = useState<(OrderDetailLineItem & { product: any; productVariant?: any }) | null>(null);
  const [lineItemToDelete, setLineItemToDelete] = useState<string | null>(null);
  
  // Inline price editing state
  const [editingPriceItemId, setEditingPriceItemId] = useState<string | null>(null);
  const [editingPriceType, setEditingPriceType] = useState<'unit' | 'total' | null>(null);
  const [tempPrice, setTempPrice] = useState("");
  
  // Inline status editing state
  const [editingStatusItemId, setEditingStatusItemId] = useState<string | null>(null);
  const [tempStatus, setTempStatus] = useState("");

  // Fulfillment state
  const [showShipmentForm, setShowShipmentForm] = useState(false);
  const [editingShipment, setEditingShipment] = useState<Shipment | null>(null);
  const [showPackingSlipModal, setShowPackingSlipModal] = useState(false);
  const [shipmentToDelete, setShipmentToDelete] = useState<string | null>(null);

  const orderId = params.id;
  const { data: orderRaw, isLoading } = useOrder(orderId);
  const order = orderRaw as OrderDetailOrder | undefined;
  const deleteOrder = useDeleteOrder();
  const updateOrder = useUpdateOrder(orderId!);
  const updateLineItem = useUpdateOrderLineItem(orderId!);
  const createLineItem = useCreateOrderLineItem(orderId!);
  const deleteLineItem = useDeleteOrderLineItem(orderId!);

  // Fulfillment hooks
  const { data: shipments = [] } = useShipments(orderId!);
  const deleteShipmentMutation = useDeleteShipment(orderId!);
  const updateShipmentMutation = useUpdateShipment(orderId!);
  const generatePackingSlip = useGeneratePackingSlip(orderId!);
  const updateFulfillmentStatus = useUpdateFulfillmentStatus(orderId!);

  // Check if user is admin or owner
  const isAdminOrOwner = user?.isAdmin || user?.role === 'owner' || user?.role === 'admin';
  const isManagerOrHigher = isAdminOrOwner || user?.role === 'manager';

  // Fetch customers for the customer change dialog
  const { data: customers = [] } = useQuery({
    queryKey: ["/api/customers"],
    queryFn: async () => {
      const response = await fetch("/api/customers", { credentials: "include" });
      if (!response.ok) throw new Error("Failed to fetch customers");
      return response.json();
    },
  });

  // Customer change mutation
  const changeCustomerMutation = useMutation({
    mutationFn: async (customerId: string) => {
      const response = await fetch(`/api/orders/${orderId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customerId, contactId: null }), // Reset contact when changing customer
        credentials: "include",
      });
      if (!response.ok) throw new Error("Failed to update customer");
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/orders/${orderId}`] });
      toast({
        title: "Success",
        description: "Customer updated successfully",
      });
      setShowCustomerDialog(false);
      setSelectedCustomerId(null);
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const formatCurrency = (amount: string | number) => {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
    }).format(typeof amount === "string" ? parseFloat(amount) : amount);
  };

  const formatDate = (dateString: string | null | undefined) => {
    if (!dateString) return "-";
    try {
      return format(new Date(dateString), "PPP");
    } catch {
      return "-";
    }
  };

  const handleDelete = async () => {
    if (!orderId) return;
    try {
      await deleteOrder.mutateAsync(orderId);
      navigate("/orders");
    } catch (error) {
      // Error toast handled by mutation
    }
  };

  const handleStatusChange = async (newStatus: string) => {
    try {
      await updateOrder.mutateAsync({ status: newStatus });
    } catch (error) {
      // Error toast handled by mutation
    }
  };

  const handlePriorityChange = async (newPriority: string) => {
    try {
      await updateOrder.mutateAsync({ priority: newPriority });
    } catch (error) {
      // Error toast handled by mutation
    }
  };

  const handleDueDateEdit = () => {
    setTempDueDate(order?.dueDate ? format(new Date(order.dueDate), 'yyyy-MM-dd') : '');
    setEditingDueDate(true);
  };

  const handleDueDateSave = async () => {
    try {
      // Convert string to Date or null
      const dateValue = tempDueDate ? new Date(tempDueDate) : null;
      await updateOrder.mutateAsync({ dueDate: dateValue });
      setEditingDueDate(false);
    } catch (error) {
      // Error toast handled by mutation
    }
  };

  const handleDueDateCancel = () => {
    setEditingDueDate(false);
    setTempDueDate('');
  };

  const handlePromisedDateEdit = () => {
    setTempPromisedDate(order?.promisedDate ? format(new Date(order.promisedDate), 'yyyy-MM-dd') : '');
    setEditingPromisedDate(true);
  };

  const handlePromisedDateSave = async () => {
    try {
      // Convert string to Date or null
      const dateValue = tempPromisedDate ? new Date(tempPromisedDate) : null;
      await updateOrder.mutateAsync({ promisedDate: dateValue });
      setEditingPromisedDate(false);
    } catch (error) {
      // Error toast handled by mutation
    }
  };

  const handlePromisedDateCancel = () => {
    setEditingPromisedDate(false);
    setTempPromisedDate('');
  };

  const handleCustomerChange = () => {
    setSelectedCustomerId(order?.customerId || null);
    setShowCustomerDialog(true);
  };

  const handleCustomerSelect = () => {
    if (selectedCustomerId) {
      changeCustomerMutation.mutate(selectedCustomerId);
    }
  };

  const handleAddLineItem = () => {
    setEditingLineItem(null);
    setShowLineItemDialog(true);
  };

  const handleEditLineItem = (lineItem: OrderDetailLineItem & { product: any; productVariant?: any }) => {
    console.log("handleEditLineItem called with:", lineItem);
    console.log("productVariantId:", lineItem.productVariantId, "Type:", typeof lineItem.productVariantId);
    setEditingLineItem(lineItem);
    setShowLineItemDialog(true);
  };

  const handleDeleteLineItem = async (lineItemId: string) => {
    try {
      await deleteLineItem.mutateAsync(lineItemId);
      setLineItemToDelete(null);
      
      // Recalculate order totals
      await recalculateOrderTotals();
    } catch (error) {
      // Error toast handled by mutation
    }
  };

  const handleSaveLineItem = async (data: any) => {
    if (editingLineItem) {
      // Edit existing
      await updateLineItem.mutateAsync({ id: editingLineItem.id, data });
    } else {
      // Create new
      await createLineItem.mutateAsync(data);
    }
    
    // Recalculate order totals
    await recalculateOrderTotals();
  };

  const recalculateOrderTotals = async () => {
    if (!order) return;
    
    // Fetch fresh order data
    const response = await fetch(`/api/orders/${orderId}`, { credentials: "include" });
    if (!response.ok) return;
    const freshOrder = await response.json();
    
    // Calculate new totals from line items
    const subtotal = freshOrder.lineItems.reduce((sum: number, item: any) => {
      return sum + parseFloat(item.totalPrice);
    }, 0);
    
    const discount = parseFloat(freshOrder.discount) || 0;
    const tax = parseFloat(freshOrder.tax) || 0;
    const total = subtotal - discount + tax;
    
    // Update order totals
    await updateOrder.mutateAsync({
      subtotal: subtotal.toFixed(2),
      total: total.toFixed(2),
    });
  };

  // Inline price editing handlers
  const handleEditPrice = (itemId: string, priceType: 'unit' | 'total', currentValue: string) => {
    setEditingPriceItemId(itemId);
    setEditingPriceType(priceType);
    setTempPrice(currentValue);
  };

  const handleSavePrice = async (item: OrderDetailLineItem) => {
    if (!tempPrice || !editingPriceType) return;

    try {
      const newPrice = parseFloat(tempPrice);
      if (isNaN(newPrice) || newPrice < 0) {
        toast({
          title: "Invalid Price",
          description: "Please enter a valid price",
          variant: "destructive",
        });
        return;
      }

      let unitPrice: number;
      let totalPrice: number;

      if (editingPriceType === 'unit') {
        // User edited unit price, recalculate total
        unitPrice = newPrice;
        totalPrice = unitPrice * item.quantity;
      } else {
        // User edited total, recalculate unit price
        totalPrice = newPrice;
        unitPrice = totalPrice / item.quantity;
      }

      await updateLineItem.mutateAsync({
        id: item.id,
        data: {
          unitPrice: unitPrice.toFixed(2),
          totalPrice: totalPrice.toFixed(2),
        },
      });

      // Recalculate order totals
      await recalculateOrderTotals();

      setEditingPriceItemId(null);
      setEditingPriceType(null);
      setTempPrice("");
    } catch (error) {
      // Error toast handled by mutation
    }
  };

  const handleCancelPrice = () => {
    setEditingPriceItemId(null);
    setEditingPriceType(null);
    setTempPrice("");
  };

  // Inline status editing handlers
  const handleEditStatus = (itemId: string, currentStatus: string) => {
    setEditingStatusItemId(itemId);
    setTempStatus(currentStatus);
  };

  const handleSaveStatus = async (itemId: string) => {
    if (!tempStatus) return;

    try {
      await updateLineItem.mutateAsync({
        id: itemId,
        data: {
          status: tempStatus,
        },
      });

      setEditingStatusItemId(null);
      setTempStatus("");
    } catch (error) {
      // Error toast handled by mutation
    }
  };

  const handleCancelStatus = () => {
    setEditingStatusItemId(null);
    setTempStatus("");
  };

  const handleLineItemStatusChange = async (lineItemId: string, newStatus: string) => {
    // This would need a hook similar to useUpdateOrderLineItem
    // For now, just show a toast
    toast({
      title: "Feature coming soon",
      description: "Line item status updates will be available soon",
    });
  };

  // Fulfillment handlers
  const handleAddShipment = () => {
    setEditingShipment(null);
    setShowShipmentForm(true);
  };

  const handleEditShipment = (shipment: Shipment) => {
    setEditingShipment(shipment);
    setShowShipmentForm(true);
  };

  const handleDeleteShipment = async (shipmentId: string) => {
    try {
      await deleteShipmentMutation.mutateAsync(shipmentId);
      toast({ title: "Success", description: "Shipment deleted successfully" });
      setShipmentToDelete(null);
    } catch (error: any) {
      toast({ 
        title: "Error", 
        description: error.message || "Failed to delete shipment", 
        variant: "destructive" 
      });
    }
  };

  const handleMarkDelivered = async (shipment: Shipment) => {
    try {
      await updateShipmentMutation.mutateAsync({
        id: shipment.id,
        updates: {
          deliveredAt: new Date(),
        } as any,
      });
      toast({ title: "Success", description: "Shipment marked as delivered" });
    } catch (error: any) {
      toast({ 
        title: "Error", 
        description: error.message || "Failed to update shipment", 
        variant: "destructive" 
      });
    }
  };

  const handleGeneratePackingSlip = async () => {
    try {
      await generatePackingSlip.mutateAsync();
      setShowPackingSlipModal(true);
    } catch (error: any) {
      toast({ 
        title: "Error", 
        description: error.message || "Failed to generate packing slip", 
        variant: "destructive" 
      });
    }
  };

  const handleFulfillmentStatusChange = async (newStatus: "pending" | "packed" | "shipped" | "delivered") => {
    try {
      await updateFulfillmentStatus.mutateAsync(newStatus);
      toast({ title: "Success", description: `Fulfillment status updated to ${newStatus}` });
    } catch (error: any) {
      toast({ 
        title: "Error", 
        description: error.message || "Failed to update fulfillment status", 
        variant: "destructive" 
      });
    }
  };

  const getTrackingUrl = (carrier: string, trackingNumber: string): string => {
    const urls: Record<string, string> = {
      UPS: `https://www.ups.com/track?tracknum=${trackingNumber}`,
      FedEx: `https://www.fedex.com/fedextrack/?trknbr=${trackingNumber}`,
      USPS: `https://tools.usps.com/go/TrackConfirmAction?tLabels=${trackingNumber}`,
      DHL: `https://www.dhl.com/en/express/tracking.html?AWB=${trackingNumber}`,
    };
    return urls[carrier] || '#';
  };

  if (isLoading) {
    return (
      <Page>
        <div className="flex items-center justify-center min-h-[400px]">
          <div className="flex items-center gap-2">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-titan-accent"></div>
            <span className="text-titan-text-secondary">Loading order...</span>
          </div>
        </div>
      </Page>
    );
  }

  if (!order) {
    return (
      <Page>
        <ContentLayout>
          <DataCard className="bg-titan-bg-card border-titan-border-subtle">
            <div className="py-16 text-center">
              <h2 className="text-titan-xl font-bold mb-2 text-titan-text-primary">Order not found</h2>
              <p className="text-titan-text-muted mb-4">The order you're looking for doesn't exist.</p>
              <Link to="/orders">
                <Button className="bg-titan-accent hover:bg-titan-accent-hover text-white rounded-titan-md">
                  Back to Orders
                </Button>
              </Link>
            </div>
          </DataCard>
        </ContentLayout>
      </Page>
    );
  }

  return (
    <Page>
      <PageHeader
        title={order.orderNumber}
        subtitle={`Created ${formatDate(order.createdAt)}`}
        className="pb-3"
        backButton={
          <Link to="/orders">
            <Button 
              variant="ghost" 
              size="sm"
              className="text-titan-text-secondary hover:text-titan-text-primary hover:bg-titan-bg-card-elevated rounded-titan-md"
            >
              <ArrowLeft className="w-4 h-4 mr-2" />
              Back
            </Button>
          </Link>
        }
        actions={
          isAdminOrOwner ? (
            <Button
              variant="destructive"
              size="sm"
              onClick={() => setShowDeleteDialog(true)}
              disabled={deleteOrder.isPending}
              className="rounded-titan-md"
            >
              <Trash2 className="w-4 h-4 mr-2" />
              Delete
            </Button>
          ) : null
        }
      />

      <ContentLayout>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* Main Content */}
          <div className="lg:col-span-2 space-y-4">
            {/* Order Details */}
            <Card className="bg-titan-bg-card border-titan-border-subtle">
              <CardHeader>
                <CardTitle>Order Details</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-sm font-medium text-muted-foreground">Status</label>
                    <Select value={order.status} onValueChange={handleStatusChange}>
                      <SelectTrigger className="mt-1">
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
                    <label className="text-sm font-medium text-muted-foreground">Priority</label>
                    <Select value={order.priority} onValueChange={handlePriorityChange}>
                      <SelectTrigger className="mt-1">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="rush">Rush</SelectItem>
                        <SelectItem value="normal">Normal</SelectItem>
                        <SelectItem value="low">Low</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-sm font-medium text-muted-foreground">Due Date</label>
                    {editingDueDate ? (
                      <div className="flex items-center gap-2 mt-1">
                        <Input
                          type="date"
                          value={tempDueDate}
                          onChange={(e) => setTempDueDate(e.target.value)}
                          className="h-8"
                        />
                        <Button size="icon" variant="ghost" className="h-8 w-8" onClick={handleDueDateSave}>
                          <Check className="h-4 w-4" />
                        </Button>
                        <Button size="icon" variant="ghost" className="h-8 w-8" onClick={handleDueDateCancel}>
                          <X className="h-4 w-4" />
                        </Button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2 mt-1">
                        <div className="text-sm">{formatDate(order.dueDate)}</div>
                        <Button size="icon" variant="ghost" className="h-6 w-6" onClick={handleDueDateEdit}>
                          <Edit className="h-3 w-3" />
                        </Button>
                      </div>
                    )}
                  </div>
                  <div>
                    <label className="text-sm font-medium text-muted-foreground">Promised Date</label>
                    {editingPromisedDate ? (
                      <div className="flex items-center gap-2 mt-1">
                        <Input
                          type="date"
                          value={tempPromisedDate}
                          onChange={(e) => setTempPromisedDate(e.target.value)}
                          className="h-8"
                        />
                        <Button size="icon" variant="ghost" className="h-8 w-8" onClick={handlePromisedDateSave}>
                          <Check className="h-4 w-4" />
                        </Button>
                        <Button size="icon" variant="ghost" className="h-8 w-8" onClick={handlePromisedDateCancel}>
                          <X className="h-4 w-4" />
                        </Button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2 mt-1">
                        <div className="text-sm">{formatDate(order.promisedDate)}</div>
                        <Button size="icon" variant="ghost" className="h-6 w-6" onClick={handlePromisedDateEdit}>
                          <Edit className="h-3 w-3" />
                        </Button>
                      </div>
                    )}
                  </div>
                </div>

                {order.notesInternal && (
                  <div>
                    <label className="text-sm font-medium text-muted-foreground">Internal Notes</label>
                    <div className="mt-1 text-sm p-3 bg-muted rounded-md whitespace-pre-wrap">
                      {order.notesInternal}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Line Items */}
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle>Order Items</CardTitle>
                    <CardDescription>{order.lineItems.length} items</CardDescription>
                  </div>
                  {isAdminOrOwner && (
                    <Button onClick={handleAddLineItem} size="sm">
                      <Plus className="w-4 h-4 mr-2" />
                      Add Item
                    </Button>
                  )}
                </div>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Product</TableHead>
                      <TableHead>Specs</TableHead>
                      <TableHead>Quantity</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Unit Price</TableHead>
                      <TableHead className="text-right">Total</TableHead>
                      {isAdminOrOwner && <TableHead className="text-right">Actions</TableHead>}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {order.lineItems.map((item) => (
                      <TableRow key={item.id}>
                        <TableCell>
                          <div>
                            <div className="font-medium">{item.product.name}</div>
                            {item.productVariant && (
                              <div className="text-xs text-muted-foreground">
                                {item.productVariant.name}
                              </div>
                            )}
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="text-sm">
                            {item.width && item.height ? (
                              <div>{item.width}" × {item.height}"</div>
                            ) : (
                              <span className="text-muted-foreground">-</span>
                            )}
                            {item.sqft && (
                              <div className="text-xs text-muted-foreground">
                                {parseFloat(item.sqft).toFixed(2)} sq ft
                              </div>
                            )}
                          </div>
                        </TableCell>
                        <TableCell>{item.quantity.toLocaleString()}</TableCell>
                        <TableCell onClick={(e) => e.stopPropagation()}>
                          {isAdminOrOwner && editingStatusItemId === item.id ? (
                            <div className="flex items-center gap-1">
                              <Select value={tempStatus} onValueChange={setTempStatus}>
                                <SelectTrigger className="h-8 w-[120px]">
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
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7"
                                onClick={() => handleSaveStatus(item.id)}
                              >
                                <Check className="h-3 w-3" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7"
                                onClick={handleCancelStatus}
                              >
                                <X className="h-3 w-3" />
                              </Button>
                            </div>
                          ) : (
                            <div 
                              className={isAdminOrOwner ? "cursor-pointer hover:bg-muted/50 px-2 py-1 rounded inline-block" : ""}
                              onClick={() => isAdminOrOwner && handleEditStatus(item.id, item.status)}
                            >
                              <LineItemStatusBadge status={item.status} />
                            </div>
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          {isAdminOrOwner && editingPriceItemId === item.id && editingPriceType === 'unit' ? (
                            <div className="flex items-center justify-end gap-1">
                              <Input
                                type="number"
                                step="0.01"
                                min="0"
                                value={tempPrice}
                                onChange={(e) => setTempPrice(e.target.value)}
                                className="h-7 w-24 text-right"
                                autoFocus
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') handleSavePrice(item);
                                  if (e.key === 'Escape') handleCancelPrice();
                                }}
                              />
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7"
                                onClick={() => handleSavePrice(item)}
                              >
                                <Check className="h-3 w-3" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7"
                                onClick={handleCancelPrice}
                              >
                                <X className="h-3 w-3" />
                              </Button>
                            </div>
                          ) : (
                            <div 
                              className={isAdminOrOwner ? "cursor-pointer hover:bg-muted/50 px-2 py-1 rounded" : ""}
                              onClick={() => isAdminOrOwner && handleEditPrice(item.id, 'unit', item.unitPrice)}
                            >
                              {formatCurrency(item.unitPrice)}
                            </div>
                          )}
                        </TableCell>
                        <TableCell className="text-right font-medium">
                          {isAdminOrOwner && editingPriceItemId === item.id && editingPriceType === 'total' ? (
                            <div className="flex items-center justify-end gap-1">
                              <Input
                                type="number"
                                step="0.01"
                                min="0"
                                value={tempPrice}
                                onChange={(e) => setTempPrice(e.target.value)}
                                className="h-7 w-24 text-right"
                                autoFocus
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') handleSavePrice(item);
                                  if (e.key === 'Escape') handleCancelPrice();
                                }}
                              />
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7"
                                onClick={() => handleSavePrice(item)}
                              >
                                <Check className="h-3 w-3" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7"
                                onClick={handleCancelPrice}
                              >
                                <X className="h-3 w-3" />
                              </Button>
                            </div>
                          ) : (
                            <div 
                              className={isAdminOrOwner ? "cursor-pointer hover:bg-muted/50 px-2 py-1 rounded" : ""}
                              onClick={() => isAdminOrOwner && handleEditPrice(item.id, 'total', item.totalPrice)}
                            >
                              {formatCurrency(item.totalPrice)}
                            </div>
                          )}
                        </TableCell>
                        {isAdminOrOwner && (
                          <TableCell className="text-right">
                            <div className="flex items-center justify-end gap-2">
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8"
                                onClick={() => handleEditLineItem(item)}
                              >
                                <Edit className="h-4 w-4" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 text-destructive hover:text-destructive"
                                onClick={() => setLineItemToDelete(item.id)}
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </div>
                          </TableCell>
                        )}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>

                <Separator className="my-4" />

                {/* Totals */}
                <div className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Subtotal</span>
                    <span>{formatCurrency(order.subtotal)}</span>
                  </div>
                  {parseFloat(order.discount) > 0 && (
                    <div className="flex justify-between text-sm text-red-500">
                      <span>Discount</span>
                      <span>-{formatCurrency(order.discount)}</span>
                    </div>
                  )}
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Tax</span>
                    <span>{formatCurrency(order.tax)}</span>
                  </div>
                  <Separator />
                  <div className="flex justify-between font-bold text-lg">
                    <span>Total</span>
                    <span>{formatCurrency(order.total)}</span>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Material Usage */}
            <Card>
              <CardHeader>
                <CardTitle>Material Usage</CardTitle>
                <CardDescription>Automatic deductions recorded for this order</CardDescription>
              </CardHeader>
              <CardContent>
                <MaterialUsageTable orderId={order.id} />
              </CardContent>
            </Card>

            {/* Fulfillment & Shipping */}
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle>Fulfillment & Shipping</CardTitle>
                  <div className="flex items-center gap-2">
                    {order.fulfillmentStatus && (
                      <FulfillmentStatusBadge status={order.fulfillmentStatus as any} />
                    )}
                  </div>
                </div>
                <CardDescription>
                  Track shipments and manage order fulfillment
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Manual Status Override (Manager+) */}
                {isManagerOrHigher && (
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Manual Status Override</label>
                    <Select
                      value={order.fulfillmentStatus || "pending"}
                      onValueChange={(value) => handleFulfillmentStatusChange(value as any)}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="pending">Pending</SelectItem>
                        <SelectItem value="packed">Packed</SelectItem>
                        <SelectItem value="shipped">Shipped</SelectItem>
                        <SelectItem value="delivered">Delivered</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                )}

                {/* Packing Slip */}
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">Packing Slip</span>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleGeneratePackingSlip}
                    disabled={generatePackingSlip.isPending}
                  >
                    <FileText className="h-4 w-4 mr-2" />
                    {generatePackingSlip.isPending ? "Generating..." : "Generate & View"}
                  </Button>
                </div>

                <Separator />

                {/* Shipments */}
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">Shipments ({shipments.length})</span>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleAddShipment}
                    >
                      <Truck className="h-4 w-4 mr-2" />
                      Add Shipment
                    </Button>
                  </div>

                  {shipments.length === 0 ? (
                    <div className="text-center py-8 text-muted-foreground">
                      <Truck className="h-12 w-12 mx-auto mb-3 opacity-20" />
                      <p className="text-sm">No shipments yet</p>
                      <p className="text-xs mt-1">Add a shipment to track delivery</p>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {shipments.map((shipment) => (
                        <div
                          key={shipment.id}
                          className="border rounded-lg p-3 space-y-2"
                        >
                          <div className="flex items-start justify-between">
                            <div className="space-y-1">
                              <div className="flex items-center gap-2">
                                <Badge variant="outline" className="text-xs">
                                  {shipment.carrier}
                                </Badge>
                                {shipment.deliveredAt && (
                                  <Badge className="bg-green-500/10 text-green-500 border-green-500/20 text-xs">
                                    Delivered
                                  </Badge>
                                )}
                              </div>
                              <div className="flex items-center gap-2">
                                <span className="text-sm font-mono">
                                  {shipment.trackingNumber}
                                </span>
                                {shipment.carrier !== "Other" && shipment.trackingNumber && (
                                  <a
                                    href={getTrackingUrl(shipment.carrier, shipment.trackingNumber)}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-primary hover:underline"
                                  >
                                    <ExternalLink className="h-3 w-3" />
                                  </a>
                                )}
                              </div>
                              <div className="text-xs text-muted-foreground">
                                Shipped: {format(new Date(shipment.shippedAt), "MMM d, yyyy h:mm a")}
                              </div>
                              {shipment.deliveredAt && (
                                <div className="text-xs text-muted-foreground">
                                  Delivered: {format(new Date(shipment.deliveredAt), "MMM d, yyyy h:mm a")}
                                </div>
                              )}
                              {shipment.notes && (
                                <div className="text-xs text-muted-foreground italic mt-1">
                                  {shipment.notes}
                                </div>
                              )}
                            </div>
                            <div className="flex items-center gap-1">
                              {!shipment.deliveredAt && (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => handleMarkDelivered(shipment)}
                                  title="Mark as delivered"
                                >
                                  <Check className="h-4 w-4" />
                                </Button>
                              )}
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => handleEditShipment(shipment)}
                              >
                                <Edit className="h-4 w-4" />
                              </Button>
                              {isAdminOrOwner && (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => setShipmentToDelete(shipment.id)}
                                  className="text-destructive hover:text-destructive"
                                >
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              )}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>

            {/* Artwork & Files */}
            <OrderArtworkPanel orderId={order.id} isAdminOrOwner={isAdminOrOwner} />
          </div>

          {/* Sidebar */}
          <div className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Timeline</CardTitle>
              </CardHeader>
              <CardContent>
                <TimelinePanel orderId={order.id} quoteId={order.quoteId ?? undefined} />
              </CardContent>
            </Card>

            {/* Bill To */}
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base">Bill To</CardTitle>
                  {isAdminOrOwner && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={handleCustomerChange}
                      disabled={changeCustomerMutation.isPending}
                      title="Change customer will refresh bill to/ship to snapshot"
                    >
                      <UserCog className="w-4 h-4 mr-1" />
                      Change
                    </Button>
                  )}
                </div>
              </CardHeader>
              <CardContent className="space-y-2">
                {order.billToName ? (
                  <>
                    <div className="font-medium text-base">{order.billToName}</div>
                    {order.billToCompany && (
                      <div className="text-sm text-muted-foreground">{order.billToCompany}</div>
                    )}
                    {order.billToAddress1 && (
                      <div className="text-sm text-muted-foreground">{order.billToAddress1}</div>
                    )}
                    {order.billToAddress2 && (
                      <div className="text-sm text-muted-foreground">{order.billToAddress2}</div>
                    )}
                    {(order.billToCity || order.billToState || order.billToPostalCode) && (
                      <div className="text-sm text-muted-foreground">
                        {order.billToCity && `${order.billToCity}, `}
                        {order.billToState && `${order.billToState} `}
                        {order.billToPostalCode}
                      </div>
                    )}
                    {order.billToPhone && (
                      <div className="text-sm text-muted-foreground">{order.billToPhone}</div>
                    )}
                    {order.billToEmail && (
                      <div className="text-sm text-muted-foreground">{order.billToEmail}</div>
                    )}
                    {order.customer && (
                      <div className="mt-3 pt-3 border-t">
                        <Link to={`/customers/${order.customer.id}`}>
                          <Button variant="link" className="p-0 h-auto text-xs text-muted-foreground hover:text-primary">
                            View Customer Record
                          </Button>
                        </Link>
                      </div>
                    )}
                  </>
                ) : (
                  <div className="text-sm text-muted-foreground">
                    {order.customer ? (
                      <Link to={`/customers/${order.customer.id}`}>
                        <Button variant="link" className="p-0 h-auto font-medium text-base">
                          {order.customer.companyName}
                        </Button>
                      </Link>
                    ) : (
                      '—'
                    )}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Ship To */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Ship To</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {order.shipToName ? (
                  <>
                    <div className="font-medium text-base">{order.shipToName}</div>
                    {order.shipToCompany && (
                      <div className="text-sm text-muted-foreground">{order.shipToCompany}</div>
                    )}
                    {order.shipToAddress1 && (
                      <div className="text-sm text-muted-foreground">{order.shipToAddress1}</div>
                    )}
                    {order.shipToAddress2 && (
                      <div className="text-sm text-muted-foreground">{order.shipToAddress2}</div>
                    )}
                    {(order.shipToCity || order.shipToState || order.shipToPostalCode) && (
                      <div className="text-sm text-muted-foreground">
                        {order.shipToCity && `${order.shipToCity}, `}
                        {order.shipToState && `${order.shipToState} `}
                        {order.shipToPostalCode}
                      </div>
                    )}
                    {order.shippingMethod && (
                      <div className="mt-2">
                        <Badge variant="outline" className="text-xs">
                          {order.shippingMethod}
                        </Badge>
                      </div>
                    )}
                    {order.carrier && (
                      <div className="text-sm text-muted-foreground">
                        Carrier: {order.carrier}
                      </div>
                    )}
                    {order.trackingNumber && (
                      <div className="text-sm">
                        <span className="text-muted-foreground">Tracking: </span>
                        <span className="font-mono">{order.trackingNumber}</span>
                      </div>
                    )}
                  </>
                ) : (
                  <div className="text-sm text-muted-foreground">—</div>
                )}
              </CardContent>
            </Card>

            {/* Source Quote */}
            {order.quote && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Source Quote</CardTitle>
                </CardHeader>
                <CardContent>
                  <Link to={`/quotes/${order.quoteId}`}>
                    <Button variant="outline" size="sm" className="w-full text-titan-accent hover:text-titan-accent-hover">
                      View Quote #{order.quote.quoteNumber}
                    </Button>
                  </Link>
                </CardContent>
              </Card>
            )}

            {/* Created By */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Created By</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex items-center gap-2">
                  <User className="w-4 h-4 text-muted-foreground" />
                  <div>
                    <div className="font-medium">
                      {order.createdByUser.firstName} {order.createdByUser.lastName}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {order.createdByUser.email}
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </ContentLayout>

      {/* Change Customer Dialog */}
      <Dialog open={showCustomerDialog} onOpenChange={setShowCustomerDialog}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Change Customer</DialogTitle>
            <DialogDescription>
              Select a new customer for this order. The contact will be reset.
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[400px] overflow-y-auto">
            <div className="space-y-2">
              {customers.map((customer: any) => (
                <div
                  key={customer.id}
                  className={`p-3 border rounded-lg cursor-pointer transition-colors ${
                    selectedCustomerId === customer.id
                      ? "border-primary bg-primary/5"
                      : "hover:border-muted-foreground"
                  }`}
                  onClick={() => setSelectedCustomerId(customer.id)}
                >
                  <div className="font-medium">{customer.companyName}</div>
                  {customer.email && (
                    <div className="text-sm text-muted-foreground">{customer.email}</div>
                  )}
                </div>
              ))}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCustomerDialog(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleCustomerSelect}
              disabled={!selectedCustomerId || changeCustomerMutation.isPending}
            >
              {changeCustomerMutation.isPending ? "Updating..." : "Update Customer"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Order</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete order {order.orderNumber}? This action cannot be undone.
              All line items will also be deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete Line Item Confirmation Dialog */}
      <AlertDialog open={!!lineItemToDelete} onOpenChange={() => setLineItemToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Line Item</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this line item? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => lineItemToDelete && handleDeleteLineItem(lineItemToDelete)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Line Item Add/Edit Dialog */}
      <OrderLineItemDialog
        open={showLineItemDialog}
        onOpenChange={setShowLineItemDialog}
        lineItem={editingLineItem ? {
          ...editingLineItem,
          productVariantId: editingLineItem.productVariantId,
          product: editingLineItem.product,
          productVariant: editingLineItem.productVariant,
        } : undefined}
        orderId={orderId!}
        onSave={handleSaveLineItem}
        mode={editingLineItem ? "edit" : "add"}
      />

      {/* Shipment Form Dialog */}
      <ShipmentForm
        open={showShipmentForm}
        onOpenChange={setShowShipmentForm}
        orderId={orderId!}
        shipment={editingShipment || undefined}
        mode={editingShipment ? "edit" : "create"}
      />

      {/* Packing Slip Modal */}
      {order.packingSlipHtml && (
        <PackingSlipModal
          open={showPackingSlipModal}
          onOpenChange={setShowPackingSlipModal}
          packingSlipHtml={order.packingSlipHtml}
        />
      )}

      {/* Delete Shipment Confirmation Dialog */}
      <AlertDialog open={!!shipmentToDelete} onOpenChange={() => setShipmentToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Shipment</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this shipment? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => shipmentToDelete && handleDeleteShipment(shipmentToDelete)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Page>
  );
}

function MaterialUsageTable({ orderId }: { orderId: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ["/api/orders", orderId, "material-usage"],
    queryFn: async () => {
      const res = await fetch(`/api/orders/${orderId}/material-usage`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch material usage");
      const json = await res.json();
      return json.success ? json.data : json;
    },
  });
  if (isLoading) return <div className="text-sm">Loading usage...</div>;
  if (!data || data.length === 0) return <div className="text-sm text-muted-foreground">No material usage recorded.</div>;
  return (
    <div className="overflow-auto max-h-64">
      <table className="min-w-full text-xs">
        <thead>
          <tr className="text-left">
            <th className="p-2">Material</th>
            <th className="p-2">Qty Used</th>
            <th className="p-2">Unit</th>
            <th className="p-2">Line Item</th>
            <th className="p-2">Date</th>
          </tr>
        </thead>
        <tbody>
          {data.map((u: any) => (
            <tr key={u.id} className="border-t">
              <td className="p-2"><a href={`/materials/${u.materialId}`} className="underline text-primary">{u.materialId.substring(0,8)}</a></td>
              <td className="p-2">{u.quantityUsed}</td>
              <td className="p-2">{u.unitOfMeasure}</td>
              <td className="p-2">{u.orderLineItemId.substring(0,8)}</td>
              <td className="p-2">{new Date(u.createdAt).toLocaleDateString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
