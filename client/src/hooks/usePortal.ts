import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";

export function usePortalProducts() {
  return useQuery({
    queryKey: ["portal", "products"],
    queryFn: async () => {
      const response = await fetch("/api/portal/products", {
        credentials: "include",
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to fetch products");
      }
      const result = await response.json();
      return result.data || [];
    },
  });
}

export function useMyQuotes() {
  return useQuery({
    queryKey: ["portal", "my-quotes"],
    queryFn: async () => {
      const response = await fetch("/api/portal/my-quotes", {
        credentials: "include",
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to fetch quotes");
      }
      const result = await response.json();
      return result.data || [];
    },
  });
}

export function useMyOrders() {
  return useQuery({
    queryKey: ["portal", "my-orders"],
    queryFn: async () => {
      const response = await fetch("/api/portal/my-orders", {
        credentials: "include",
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to fetch orders");
      }
      const result = await response.json();
      return result.data || [];
    },
  });
}

export function useQuoteCheckout(quoteId: string | undefined) {
  return useQuery({
    queryKey: ["quotes", quoteId],
    queryFn: async () => {
      if (!quoteId) throw new Error("Quote ID required");
      const response = await fetch(`/api/quotes/${quoteId}`, {
        credentials: "include",
      });
      if (!response.ok) {
        throw new Error("Failed to fetch quote details");
      }
      return response.json();
    },
    enabled: !!quoteId,
  });
}

export function useConvertPortalQuoteToOrder() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({
      quoteId,
      priority,
      customerNotes,
      dueDate,
    }: {
      quoteId: string;
      priority?: string;
      customerNotes?: string;
      dueDate?: string;
    }) => {
      const response = await fetch(`/api/portal/convert-quote/${quoteId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ priority, customerNotes, dueDate }),
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to convert quote to order");
      }
      const result = await response.json();
      return result.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["portal", "my-quotes"] });
      queryClient.invalidateQueries({ queryKey: ["portal", "my-orders"] });
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

export function useUploadOrderFile(orderId: string) {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (fileData: {
      fileName: string;
      fileUrl: string;
      fileSize?: number;
      mimeType?: string;
      description?: string;
    }) => {
      const response = await fetch(`/api/orders/${orderId}/files`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(fileData),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to attach file");
      }
      const result = await response.json();
      return result.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["orders", orderId] });
      queryClient.invalidateQueries({ queryKey: ["orders", orderId, "files"] });
      toast({
        title: "File attached",
        description: "Your file has been attached to the order",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Upload failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });
}

export function useOrderFiles(orderId: string | undefined) {
  return useQuery({
    queryKey: ["orders", orderId, "files"],
    queryFn: async () => {
      if (!orderId) throw new Error("Order ID required");
      const response = await fetch(`/api/orders/${orderId}/files`, {
        credentials: "include",
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to fetch files");
      }
      const result = await response.json();
      return result.data || [];
    },
    enabled: !!orderId,
  });
}
