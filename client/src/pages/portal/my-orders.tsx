import { Link } from "react-router-dom";
import { AlertCircle, Loader2, Package, Truck } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useMyOrders, type PortalOrderListDto } from "@/hooks/usePortal";

function formatDate(value: string | null) {
  if (!value) return "Not set";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Not set";
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(date);
}

function formatCurrency(amount: number, currency = "USD") {
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(Number(amount || 0));
  } catch {
    return `$${Number(amount || 0).toFixed(2)}`;
  }
}

function statusVariant(status: string): "default" | "secondary" | "destructive" | "outline" {
  const normalized = status.toLowerCase();
  if (normalized.includes("completed") || normalized.includes("shipped") || normalized.includes("ready")) return "default";
  if (normalized.includes("canceled")) return "destructive";
  if (normalized.includes("awaiting") || normalized.includes("hold")) return "secondary";
  return "outline";
}

function OrderRow({ order }: { order: PortalOrderListDto }) {
  return (
    <div className="grid gap-4 border-b px-4 py-4 last:border-b-0 md:grid-cols-[1fr_auto_auto] md:items-center">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <Link to={`/portal/orders/${order.id}`} className="font-medium text-foreground hover:underline">
            Order {order.displayNumber || order.orderNumber}
          </Link>
          <Badge variant={statusVariant(order.displayStatus)}>{order.displayStatus}</Badge>
          {order.proofStatusSummary.actionRequired ? (
            <Badge variant="secondary">
              <AlertCircle className="mr-1 h-3 w-3" />
              Your approval needed
            </Badge>
          ) : null}
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          Created {formatDate(order.createdAt)}
          {order.customerPoNumber ? ` / PO ${order.customerPoNumber}` : ""}
        </p>
        <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-sm text-muted-foreground">
          <span>{order.itemCount} item{order.itemCount === 1 ? "" : "s"}</span>
          <span>{order.proofStatusSummary.statusLabel}</span>
          <span className="inline-flex items-center gap-1">
            <Truck className="h-3.5 w-3.5" />
            {order.fulfillmentSummary.methodLabel || "Fulfillment"}: {order.fulfillmentSummary.statusLabel}
          </span>
        </div>
      </div>

      <div className="text-sm md:text-right">
        <p className="text-muted-foreground">Total</p>
        <p className="font-medium text-foreground">{formatCurrency(order.total)}</p>
      </div>

      <div className="flex w-full md:w-auto md:justify-end">
        <Button asChild variant="outline" size="sm" className="w-full md:w-auto">
          <Link to={`/portal/orders/${order.id}`}>View order</Link>
        </Button>
      </div>
    </div>
  );
}

export default function MyOrders() {
  const { data: orders = [], isLoading, error } = useMyOrders();

  if (isLoading) {
    return (
      <div className="flex min-h-[360px] items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-normal">Orders</h1>
        <p className="mt-1 text-sm text-muted-foreground">Track order status, review proofs, and follow fulfillment progress.</p>
      </div>

      {error ? (
        <Card>
          <CardContent className="py-10 text-center">
            <p className="font-medium text-destructive">Could not load orders</p>
            <p className="mt-1 text-sm text-muted-foreground">{(error as Error).message}</p>
          </CardContent>
        </Card>
      ) : orders.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-14 text-center">
            <Package className="mb-3 h-9 w-9 text-muted-foreground" />
            <p className="font-medium">No orders yet</p>
            <p className="mt-1 text-sm text-muted-foreground">Orders will appear here when they are ready for you.</p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            {orders.map((order) => (
              <OrderRow key={order.id} order={order} />
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
