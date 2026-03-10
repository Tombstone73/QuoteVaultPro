import { useQuery, useMutation } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { useToast } from "@/hooks/use-toast";
import { queryClient } from "@/lib/queryClient";
import type { Product, Organization } from "@shared/schema";
import { DocumentCreateForm } from "@/features/documents/create/DocumentCreateForm";

export default function CreateOrder() {
  const navigate = useNavigate();
  const { toast } = useToast();

  // Fetch organization for tax rate
  const { data: organization } = useQuery<Organization>({
    queryKey: ["/api/organization"],
    queryFn: async () => {
      const response = await fetch("/api/organization", { credentials: "include" });
      if (!response.ok) throw new Error("Failed to fetch organization");
      return response.json();
    },
  });

  // Fetch products
  const { data: products, isLoading: productsLoading } = useQuery<Product[]>({
    queryKey: ["/api/products?activeOnly=true"],
    queryFn: async () => {
      const response = await fetch("/api/products?activeOnly=true", { credentials: "include" });
      if (!response.ok) throw new Error("Failed to fetch products");
      return response.json();
    },
  });

  // Create order mutation
  const createOrderMutation = useMutation({
    mutationFn: async (formData: any) => {
      const response = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...formData,
          shippingMethod: formData.deliveryMethod,
          shippingMode: 'single_shipment',
        }),
        credentials: "include",
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || "Failed to create order");
      }
      return response.json();
    },
    onSuccess: (data) => {
      toast({
        title: "Success",
        description: "Order created successfully",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/orders"] });
      navigate(`/orders/${data.id}`);
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
      mode="order"
      products={products}
      productsLoading={productsLoading}
      onNavigateBack={() => navigate("/orders")}
      onSubmit={async (formData) => {
        createOrderMutation.mutate(formData);
      }}
      isSubmitting={createOrderMutation.isPending}
    />
  );
}
