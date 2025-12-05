import { useMyOrders } from "@/hooks/usePortal";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Link } from "react-router-dom";
import { Loader2, Package } from "lucide-react";
import { Page, PageHeader, ContentLayout, DataCard, StatusPill } from "@/components/titan";

export default function MyOrders() {
  const { data: orders, isLoading, error } = useMyOrders();

  if (isLoading) {
    return (
      <Page>
        <div className="flex items-center justify-center min-h-[400px]">
          <Loader2 className="h-8 w-8 animate-spin text-titan-text-muted" />
        </div>
      </Page>
    );
  }

  if (error) {
    return (
      <Page>
        <ContentLayout>
          <DataCard className="bg-titan-bg-card border-titan-border-subtle">
            <div className="flex flex-col items-center justify-center min-h-[400px] text-center">
              <p className="text-titan-error mb-2">Failed to load orders</p>
              <p className="text-titan-sm text-titan-text-muted">{(error as Error).message}</p>
            </div>
          </DataCard>
        </ContentLayout>
      </Page>
    );
  }

  const getStatusVariant = (status: string): "success" | "warning" | "error" | "info" | "default" => {
    const statusMap: Record<string, "success" | "warning" | "error" | "info" | "default"> = {
      new: "info",
      scheduled: "info",
      in_production: "warning",
      ready_for_pickup: "success",
      shipped: "success",
      completed: "success",
      on_hold: "warning",
      canceled: "error",
    };
    return statusMap[status] || "default";
  };

  const getStatusLabel = (status: string) => {
    return status.replace(/_/g, " ").replace(/\b\w/g, (l) => l.toUpperCase());
  };

  return (
    <Page>
      <PageHeader
        title="My Orders"
        subtitle="Track your production orders"
        className="pb-3"
      />

      <ContentLayout className="space-y-4">
        {!orders || orders.length === 0 ? (
          <DataCard className="bg-titan-bg-card border-titan-border-subtle">
            <div className="flex flex-col items-center justify-center py-12">
              <Package className="h-12 w-12 text-titan-text-muted mb-4" />
              <p className="text-titan-text-muted">No orders found</p>
            </div>
          </DataCard>
        ) : (
          <div className="grid gap-4">
            {orders.map((order: any) => (
              <DataCard key={order.id} className="bg-titan-bg-card border-titan-border-subtle">
                <div className="flex items-start justify-between mb-4">
                  <div>
                    <h3 className="text-titan-lg font-semibold text-titan-text-primary">
                      Order #{order.orderNumber}
                    </h3>
                    <p className="text-titan-sm text-titan-text-muted mt-1">
                      Created {new Date(order.createdAt).toLocaleDateString()}
                      {order.dueDate && (
                        <> • Due {new Date(order.dueDate).toLocaleDateString()}</>
                      )}
                    </p>
                  </div>
                  <StatusPill variant={getStatusVariant(order.status)}>
                    {getStatusLabel(order.status)}
                  </StatusPill>
                </div>
                <div className="border-t border-titan-border-subtle pt-4">
                  <p className="text-titan-sm text-titan-text-muted mb-2">
                    {order.lineItems?.length || 0} item(s)
                  </p>
                  <div className="flex items-center justify-between">
                    <div className="text-titan-xl font-bold text-titan-text-primary">
                      ${parseFloat(order.total || 0).toFixed(2)}
                    </div>
                    <Link to={`/orders/${order.id}`}>
                      <Button 
                        variant="outline" 
                        size="sm"
                        className="border-titan-border text-titan-text-secondary hover:text-titan-text-primary hover:bg-titan-bg-card-elevated rounded-titan-md"
                      >
                        View Details
                      </Button>
                    </Link>
                  </div>
                </div>
              </DataCard>
            ))}
          </div>
        )}
      </ContentLayout>
    </Page>
  );
}
