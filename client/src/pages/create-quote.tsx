import { useQuery, useMutation } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { useToast } from "@/hooks/use-toast";
import { queryClient } from "@/lib/queryClient";
import type { Product } from "@shared/schema";
import { DocumentCreateForm } from "@/features/documents/create/DocumentCreateForm";

export default function CreateQuote() {
  const navigate = useNavigate();
  const { toast } = useToast();

  // Fetch products
  const { data: products, isLoading: productsLoading } = useQuery<Product[]>({
    queryKey: ["/api/products"],
    queryFn: async () => {
      const response = await fetch("/api/products", { credentials: "include" });
      if (!response.ok) throw new Error("Failed to fetch products");
      return response.json();
    },
  });

  // Create quote mutation
  const createQuoteMutation = useMutation({
    mutationFn: async (formData: any) => {
      const response = await fetch("/api/quotes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customerId: formData.customerId,
          contactId: formData.contactId,
          jobLabel: formData.description,
          requestedDueDate: formData.requestedDueDate,
          priority: formData.priority,
          poNumber: formData.poNumber,
          shippingMethod: formData.deliveryMethod,
          shippingInstructions: formData.shippingInstructions,
          lineItems: formData.lineItems,
          subtotal: formData.subtotal,
          taxRate: formData.taxRate,
          taxAmount: formData.taxAmount,
          total: formData.total,
        }),
        credentials: "include",
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || "Failed to create quote");
      }
      return response.json();
    },
    onSuccess: (data) => {
      toast({
        title: "Success",
        description: "Quote created successfully",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/quotes"] });
      navigate(`/quotes/${data.id}`);
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  return (
    <DocumentCreateForm
      mode="quote"
      products={products}
      productsLoading={productsLoading}
      onNavigateBack={() => navigate("/quotes")}
      onSubmit={async (formData) => {
        createQuoteMutation.mutate(formData);
      }}
      isSubmitting={createQuoteMutation.isPending}
    />
  );
}
