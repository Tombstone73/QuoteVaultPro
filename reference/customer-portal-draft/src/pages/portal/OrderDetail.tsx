import { useParams, useNavigate } from "react-router-dom";
import { useOrderDetail } from "@/hooks/useOrderDetail";
import { useRuntimeConfig } from "@/contexts/RuntimeConfigContext";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  AlertCircle,
  ArrowLeft,
  Download,
  FileText,
  Package,
  RefreshCw,
  ShieldAlert,
  Truck,
} from "lucide-react";
import type { OrderState, LineItemWorkflowState } from "@/types/portal";

const STATE_BADGE_VARIANT: Record<OrderState, "default" | "secondary" | "destructive" | "outline"> = {
  open: "default",
  production_complete: "secondary",
  closed: "outline",
  canceled: "destructive",
};

const WORKFLOW_BADGE_VARIANT: Record<LineItemWorkflowState, "default" | "secondary" | "destructive" | "outline"> = {
  processing: "default",
  in_production: "secondary",
  ready: "outline",
  on_hold: "destructive",
  canceled: "destructive",
};

const SHIPPING_LABELS: Record<string, string> = {
  pickup: "Customer Pickup",
  ship: "Shipped",
  deliver: "Delivery",
};

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(amount);
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export default function OrderDetail() {
  const { orderId } = useParams<{ orderId: string }>();
  const navigate = useNavigate();
  const { isMockMode } = useRuntimeConfig();
  const { data: order, isLoading, isError, error, refetch } = useOrderDetail(orderId);

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-60 w-full" />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center space-y-4">
        <AlertCircle className="h-10 w-10 text-destructive" />
        <div>
          <p className="text-lg font-medium text-foreground">Unable to load order</p>
          <p className="text-sm text-muted-foreground mt-1">
            {error instanceof Error ? error.message : "An unexpected error occurred."}
          </p>
        </div>
        <Button variant="outline" onClick={() => refetch()}>
          <RefreshCw className="mr-2 h-4 w-4" />
          Try Again
        </Button>
      </div>
    );
  }

  if (!order) return null;

  return (
    <div className="space-y-6">
      {/* Demo-only security banner */}
      {isMockMode && (
        <div className="flex items-center gap-2 rounded-md border border-border bg-muted px-4 py-2 text-sm text-muted-foreground">
          <ShieldAlert className="h-4 w-4 shrink-0" />
          <span>
            Demo only — backend customer ownership validation required before production use.
          </span>
        </div>
      )}

      {/* Header */}
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={() => navigate("/orders")}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold tracking-tight text-foreground">
              {order.orderNumber}
            </h1>
            <Badge variant={STATE_BADGE_VARIANT[order.state]}>{order.stateLabel}</Badge>
          </div>
          {order.poNumber && (
            <p className="text-sm text-muted-foreground mt-0.5">PO: {order.poNumber}</p>
          )}
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Subtotal</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xl font-bold text-foreground">{formatCurrency(order.subtotal)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Tax</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xl font-bold text-foreground">{formatCurrency(order.tax)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Total</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xl font-bold text-foreground">{formatCurrency(order.total)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Priority</CardTitle>
          </CardHeader>
          <CardContent>
            <p className={`text-xl font-bold ${order.priority === "rush" ? "text-destructive" : "text-foreground"}`}>
              {order.priority === "rush" ? "Rush" : order.priority === "low" ? "Low" : "Normal"}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Shipping & Dates */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Truck className="h-4 w-4" />
            Shipping & Dates
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <p className="text-sm text-muted-foreground">Shipping Method</p>
              <p className="font-medium text-foreground">
                {SHIPPING_LABELS[order.shippingMethod] ?? order.shippingMethod}
              </p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Due Date</p>
              <p className="font-medium text-foreground">{formatDate(order.dueDate)}</p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Promised Date</p>
              <p className="font-medium text-foreground">{formatDate(order.promisedDate)}</p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">
                {order.shippingMethod === "ship" ? "Tracking #" : "Shipped At"}
              </p>
              <p className="font-medium text-foreground">
                {order.trackingNumber ?? formatDate(order.shippedAt)}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Line Items */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Package className="h-4 w-4" />
            Line Items ({order.lineItems.length})
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="rounded-md border-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Description</TableHead>
                  <TableHead className="hidden sm:table-cell">Qty</TableHead>
                  <TableHead className="hidden sm:table-cell">Unit Price</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {order.lineItems.map((li) => (
                  <TableRow key={li.id}>
                    <TableCell className="font-medium">{li.description}</TableCell>
                    <TableCell className="hidden sm:table-cell text-muted-foreground">
                      {li.quantity}
                    </TableCell>
                    <TableCell className="hidden sm:table-cell text-muted-foreground">
                      {formatCurrency(li.unitPrice)}
                    </TableCell>
                    <TableCell className="text-right font-medium">
                      {formatCurrency(li.total)}
                    </TableCell>
                    <TableCell>
                      <Badge variant={WORKFLOW_BADGE_VARIANT[li.workflowState]}>
                        {li.workflowStateLabel}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Files */}
      {order.files.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <FileText className="h-4 w-4" />
              Attachments ({order.files.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {order.files.map((file) => (
                <div
                  key={file.id}
                  className="flex items-center justify-between rounded-md border border-border px-4 py-3"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-foreground truncate">
                        {file.fileName}
                      </p>
                      <p className="text-xs text-muted-foreground">{file.fileRoleLabel}</p>
                    </div>
                  </div>
                  <Button variant="ghost" size="sm" asChild>
                    <a href={`/api${file.downloadUrl}`} target="_blank" rel="noopener noreferrer">
                      <Download className="mr-1.5 h-3.5 w-3.5" />
                      Download
                    </a>
                  </Button>
                </div>
              ))}
            </div>
            <Separator className="my-3" />
            <p className="text-xs text-muted-foreground">
              Only artwork and customer PO files are shown. File downloads require backend security
              hardening for production use.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
