import { useState } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/hooks/useAuth";
import OrderForm from "@/components/order-form";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";

export default function CreateOrder() {
  const [, navigate] = useLocation();
  const { user } = useAuth();
  const [formOpen, setFormOpen] = useState(true);

  const handleSuccess = (orderId: string) => {
    navigate(`/orders/${orderId}`);
  };

  const handleCancel = () => {
    navigate("/orders");
  };

  return (
    <div className="container mx-auto py-8">
      <div className="mb-6">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => navigate("/orders")}
          className="mb-4"
        >
          <ArrowLeft className="w-4 h-4 mr-2" />
          Back to Orders
        </Button>
        <h1 className="text-3xl font-bold">Create New Order</h1>
        <p className="text-muted-foreground mt-2">
          Create a new order with line items, customer details, and scheduling information.
        </p>
      </div>

      <OrderForm
        open={formOpen}
        onOpenChange={(open) => {
          setFormOpen(open);
          if (!open) handleCancel();
        }}
        onSuccess={handleSuccess}
      />
    </div>
  );
}
