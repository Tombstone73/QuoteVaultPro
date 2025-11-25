import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";

export type Order = {
  id: string;
  orderNumber: string;
  quoteId: string | null;
  customerId: string;
  contactId: string | null;
  status: string;
  priority: string;
  dueDate: string | null;
  promisedDate: string | null;
  subtotal: string;
  tax: string;
  total: string;
  discount: string;
  notesInternal: string | null;
  fulfillmentStatus: "pending" | "packed" | "shipped" | "delivered" | null;
  shippingAddress: any;
  packingSlipHtml: string | null;
  createdByUserId: string;
  createdAt: string;
  updatedAt: string;
};

export type OrderLineItem = {
  id: string;
  orderId: string;
  quoteLineItemId: string | null;
  productId: string;
  productVariantId: string | null;
  description: string;
  width: string | null;
  height: string | null;
  quantity: number;
  sqft: string | null;
  unitPrice: string;
  totalPrice: string;
  status: string;
  nestingConfigSnapshot: any;
  specsJson?: any;
  createdAt: string;
  updatedAt: string;
};

export type OrderWithRelations = Order & {
  customer: any;
  contact?: any;
  quote?: any;
  createdByUser: any;
  lineItems: (OrderLineItem & {
    product: any;
    productVariant?: any;
  })[];
};

export function useOrders(filters?: {
  search?: string;
  status?: string;
  priority?: string;
  customerId?: string;
  startDate?: string;
  endDate?: string;
}) {
  return useQuery<Order[]>({
    queryKey: ["/api/orders", filters],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (filters?.search) params.append("search", filters.search);
      if (filters?.status) params.append("status", filters.status);
      if (filters?.priority) params.append("priority", filters.priority);
      if (filters?.customerId) params.append("customerId", filters.customerId);
      if (filters?.startDate) params.append("startDate", filters.startDate);
      if (filters?.endDate) params.append("endDate", filters.endDate);

      const url = `/api/orders${params.toString() ? `?${params.toString()}` : ""}`;
      const response = await fetch(url, { credentials: "include" });
      if (!response.ok) throw new Error("Failed to fetch orders");
      return response.json();
    },
  });
}

export function useOrder(id: string | undefined) {
  return useQuery<OrderWithRelations>({
    queryKey: ["/api/orders", id],
    queryFn: async () => {
      if (!id) throw new Error("Order ID is required");
      const response = await fetch(`/api/orders/${id}`, { credentials: "include" });
      if (!response.ok) throw new Error("Failed to fetch order");
      return response.json();
    },
    enabled: !!id,
  });
}

export function useCreateOrder() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (data: any) => {
      const response = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
        credentials: "include",
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || "Failed to create order");
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/orders"] });
      toast({
        title: "Success",
        description: "Order created successfully",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });
}

export function useUpdateOrder(id: string) {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (data: any) => {
      const response = await fetch(`/api/orders/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
        credentials: "include",
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || "Failed to update order");
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/orders"] });
      queryClient.invalidateQueries({ queryKey: ["/api/orders", id] });
      toast({
        title: "Success",
        description: "Order updated successfully",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });
}

export function useDeleteOrder() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (id: string) => {
      const response = await fetch(`/api/orders/${id}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || "Failed to delete order");
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/orders"] });
      toast({
        title: "Success",
        description: "Order deleted successfully",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });
}

export function useConvertQuoteToOrder() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({ quoteId, ...data }: { quoteId: string; dueDate?: string; promisedDate?: string; priority?: string; notesInternal?: string; customerId?: string; contactId?: string }) => {
      const response = await fetch(`/api/orders/from-quote/${quoteId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
        credentials: "include",
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || "Failed to convert quote to order");
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/orders"] });
      queryClient.invalidateQueries({ queryKey: ["/api/quotes"] });
      toast({
        title: "Success",
        description: "Quote converted to order successfully",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });
}

export function useUpdateOrderLineItem(orderId: string) {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({ id, data }: { id: string; data: any }) => {
      // Ensure numeric values are sent as numbers, not strings
      const payload = {
        ...data,
        unitPrice: data.unitPrice ? Number(data.unitPrice) : undefined,
        totalPrice: data.totalPrice ? Number(data.totalPrice) : undefined,
        quantity: data.quantity ? Number(data.quantity) : undefined,
        width: data.width ? Number(data.width) : undefined,
        height: data.height ? Number(data.height) : undefined,
        sqft: data.sqft ? Number(data.sqft) : undefined,
      };

      console.log("useUpdateOrderLineItem - Input data:", data);
      console.log("useUpdateOrderLineItem - Payload to API:", payload);

      const response = await fetch(`/api/order-line-items/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        credentials: "include",
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || "Failed to update line item");
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/orders", orderId] });
      queryClient.invalidateQueries({ queryKey: ["/api/orders"] });
      toast({
        title: "Success",
        description: "Line item updated successfully",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });
}

export function useCreateOrderLineItem(orderId: string) {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (data: any) => {
      // Ensure numeric values are sent as numbers, not strings
      const payload = {
        ...data,
        unitPrice: data.unitPrice ? Number(data.unitPrice) : 0,
        totalPrice: data.totalPrice ? Number(data.totalPrice) : 0,
        quantity: data.quantity ? Number(data.quantity) : 1,
        width: data.width ? Number(data.width) : undefined,
        height: data.height ? Number(data.height) : undefined,
        sqft: data.sqft ? Number(data.sqft) : undefined,
      };

      console.log("useCreateOrderLineItem - Input data:", data);
      console.log("useCreateOrderLineItem - Payload to API:", payload);

      const response = await fetch("/api/order-line-items", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        credentials: "include",
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || "Failed to create line item");
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/orders", orderId] });
      queryClient.invalidateQueries({ queryKey: ["/api/orders"] });
      toast({
        title: "Success",
        description: "Line item added successfully",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });
}

export function useDeleteOrderLineItem(orderId: string) {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (id: string) => {
      const response = await fetch(`/api/order-line-items/${id}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || "Failed to delete line item");
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/orders", orderId] });
      queryClient.invalidateQueries({ queryKey: ["/api/orders"] });
      toast({
        title: "Success",
        description: "Line item deleted successfully",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });
}
