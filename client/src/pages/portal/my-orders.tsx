import { useMyOrders } from "@/hooks/usePortal";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Link } from "wouter";
import { Loader2, Package } from "lucide-react";

export default function MyOrders() {
  const { data: orders, isLoading, error } = useMyOrders();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px] text-center">
        <p className="text-destructive mb-2">Failed to load orders</p>
        <p className="text-sm text-muted-foreground">{(error as Error).message}</p>
      </div>
    );
  }

  const getStatusBadge = (status: string) => {
    const statusMap: Record<string, string> = {
      new: "secondary",
      scheduled: "default",
      in_production: "default",
      ready_for_pickup: "default",
      shipped: "default",
      completed: "default",
      on_hold: "secondary",
      canceled: "destructive",
    };
    const displayName = status.replace(/_/g, " ").replace(/\b\w/g, (l) => l.toUpperCase());
    return (
      <Badge variant={statusMap[status] as any || "secondary"}>
        {displayName}
      </Badge>
    );
  };

  return (
    <div className="container mx-auto py-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-3xl font-bold">My Orders</h1>
          <p className="text-muted-foreground">
            Track your production orders
          </p>
        </div>
      </div>

      {!orders || orders.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Package className="h-12 w-12 text-muted-foreground mb-4" />
            <p className="text-muted-foreground">No orders found</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4">
          {orders.map((order: any) => (
            <Card key={order.id}>
              <CardHeader>
                <div className="flex items-start justify-between">
                  <div>
                    <CardTitle className="text-xl">
                      Order #{order.orderNumber}
                    </CardTitle>
                    <p className="text-sm text-muted-foreground mt-1">
                      Created {new Date(order.createdAt).toLocaleDateString()}
                      {order.dueDate && (
                        <> • Due {new Date(order.dueDate).toLocaleDateString()}</>
                      )}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {getStatusBadge(order.status)}
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <div className="border-t pt-4">
                    <p className="text-sm text-muted-foreground mb-2">
                      {order.lineItems?.length || 0} item(s)
                    </p>
                    <div className="flex items-center justify-between">
                      <div className="text-2xl font-bold">
                        ${parseFloat(order.total || 0).toFixed(2)}
                      </div>
                      <Link href={`/orders/${order.id}`}>
                        <Button variant="outline" size="sm">
                          View Details
                        </Button>
                      </Link>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
