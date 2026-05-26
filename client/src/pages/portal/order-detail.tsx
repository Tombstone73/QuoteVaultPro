import { Link, useParams } from "react-router-dom";
import { ArrowLeft, FileCheck, FileText, Loader2, Package, ReceiptText, Truck } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import PortalFilesCard from "@/components/portal/PortalFilesCard";
import { Separator } from "@/components/ui/separator";
import { usePortalOrder, usePortalOrderFiles, usePortalProofs } from "@/hooks/usePortal";

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

export default function PortalOrderDetailPage() {
  const { id } = useParams<{ id: string }>();
  const orderId = id || "";
  const orderQuery = usePortalOrder(orderId);
  const filesQuery = usePortalOrderFiles(orderId);
  const proofsQuery = usePortalProofs();
  const order = orderQuery.data;
  const files = filesQuery.data ?? [];
  const proofs = (proofsQuery.data ?? []).filter((proof) => proof.orderSummary.id === orderId);

  if (orderQuery.isLoading) {
    return (
      <div className="flex min-h-[360px] items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!order) {
    return (
      <div className="mx-auto w-full max-w-4xl space-y-4">
        <Button asChild variant="ghost">
          <Link to="/portal/orders">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to orders
          </Link>
        </Button>
        <Card>
          <CardContent className="py-12 text-center">
            <p className="font-medium">Order not found</p>
            <p className="mt-1 text-sm text-muted-foreground">This order is unavailable or you do not have access.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <Button asChild variant="ghost" className="mb-2 px-0">
            <Link to="/portal/orders">
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back to orders
            </Link>
          </Button>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-normal">Order {order.displayNumber || order.orderNumber}</h1>
            <Badge variant={statusVariant(order.displayStatus)}>{order.displayStatus}</Badge>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Created {formatDate(order.createdAt)}
            {order.customerPoNumber ? ` / PO ${order.customerPoNumber}` : ""}
          </p>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <Package className="h-4 w-4" />
              Items
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold">{order.itemCount}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <FileText className="h-4 w-4" />
              Proofs
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="font-medium">{order.proofStatusSummary.statusLabel}</p>
            {order.proofStatusSummary.latestVersionNumber ? (
              <p className="mt-1 text-sm text-muted-foreground">Latest version {order.proofStatusSummary.latestVersionNumber}</p>
            ) : null}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <Truck className="h-4 w-4" />
              Fulfillment
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="font-medium">{order.fulfillmentSummary.statusLabel}</p>
            <p className="mt-1 text-sm text-muted-foreground">{order.fulfillmentSummary.methodLabel || "Fulfillment"}</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Line Items</CardTitle>
        </CardHeader>
        <CardContent className="divide-y p-0">
          {order.lineItems.map((item) => (
            <div key={item.id} className="grid gap-3 px-4 py-4 md:grid-cols-[1fr_auto] md:items-center">
              <div className="min-w-0">
                <p className="font-medium">{item.name}</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Qty {item.quantity}
                  {item.dimensions.width && item.dimensions.height
                    ? ` / ${item.dimensions.width} x ${item.dimensions.height}`
                    : ""}
                </p>
                {item.proofStatus ? <p className="mt-1 text-sm text-muted-foreground">{item.proofStatus}</p> : null}
              </div>
              <Badge variant={statusVariant(item.displayStatus)}>{item.displayStatus}</Badge>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileCheck className="h-4 w-4" />
            Proof Reviews
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {proofs.length ? (
            proofs.map((proof) => (
              <div key={proof.id} className="flex flex-col gap-3 rounded-md border p-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">Proof v{proof.versionNumber}</span>
                    <Badge variant={proof.customerActionRequired ? "secondary" : "outline"}>{proof.displayStatus}</Badge>
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">{proof.lineItemSummary.name}</p>
                </div>
                <Button asChild variant="outline" size="sm">
                  <Link to={`/portal/proofs/${proof.id}`}>{proof.customerActionRequired ? "Review" : "Open"}</Link>
                </Button>
              </div>
            ))
          ) : proofsQuery.isLoading ? (
            <p className="text-sm text-muted-foreground">Loading proofs...</p>
          ) : (
            <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">No proofs are available for this order.</p>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Proof Summary</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="flex justify-between gap-4">
              <span className="text-muted-foreground">Status</span>
              <span className="text-right font-medium">{order.proofStatusSummary.statusLabel}</span>
            </div>
            <div className="flex justify-between gap-4">
              <span className="text-muted-foreground">Action needed</span>
              <span className="text-right">{order.proofStatusSummary.actionRequired ? "Yes" : "No"}</span>
            </div>
            <div className="flex justify-between gap-4">
              <span className="text-muted-foreground">Required items</span>
              <span className="text-right">{order.proofStatusSummary.requiredCount}</span>
            </div>
            <p className="text-muted-foreground">Proof review links are sent separately.</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Fulfillment Summary</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="flex justify-between gap-4">
              <span className="text-muted-foreground">Method</span>
              <span className="text-right">{order.fulfillmentSummary.methodLabel || "Not set"}</span>
            </div>
            <div className="flex justify-between gap-4">
              <span className="text-muted-foreground">Status</span>
              <span className="text-right font-medium">{order.fulfillmentSummary.statusLabel}</span>
            </div>
            {order.fulfillmentSummary.trackingNumber ? (
              <div className="flex justify-between gap-4">
                <span className="text-muted-foreground">Tracking</span>
                <span className="text-right">{order.fulfillmentSummary.trackingNumber}</span>
              </div>
            ) : null}
            {order.fulfillmentSummary.shippedAt ? (
              <div className="flex justify-between gap-4">
                <span className="text-muted-foreground">Shipped</span>
                <span className="text-right">{formatDate(order.fulfillmentSummary.shippedAt)}</span>
              </div>
            ) : null}
          </CardContent>
        </Card>
      </div>

      {order.invoiceSummary ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ReceiptText className="h-4 w-4" />
              Invoice Summary
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="flex justify-between gap-4">
              <span className="text-muted-foreground">Invoices</span>
              <span>{order.invoiceSummary.invoiceCount}</span>
            </div>
            <Separator />
            <div className="flex justify-between gap-4 font-medium">
              <span>Amount due</span>
              <span>{formatCurrency(order.invoiceSummary.amountDue, order.invoiceSummary.currency)}</span>
            </div>
          </CardContent>
        </Card>
      ) : null}

      <PortalFilesCard
        title="Order Documents"
        files={files}
        isLoading={filesQuery.isLoading}
        error={filesQuery.error}
        entity="orders"
        entityId={order.id}
      />
    </div>
  );
}
