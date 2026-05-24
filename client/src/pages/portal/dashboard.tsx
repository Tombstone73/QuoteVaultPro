import { Link } from "react-router-dom";
import { AlertCircle, ArrowRight, Download, FileText, Loader2, Package, ReceiptText } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  portalFileDownloadUrl,
  usePortalDashboard,
  type PortalDashboardFileDto,
  type PortalInvoiceDto,
  type PortalOrderListDto,
  type PortalProofDto,
  type PortalQuoteListDto,
} from "@/hooks/usePortal";

function formatCurrency(amount: number, currency = "USD") {
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(Number(amount || 0));
  } catch {
    return `$${Number(amount || 0).toFixed(2)}`;
  }
}

function formatDate(value: string | null) {
  if (!value) return "Not set";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Not set";
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(date);
}

function invoiceVariant(invoice: PortalInvoiceDto): "default" | "secondary" | "destructive" | "outline" {
  if (invoice.status === "overdue") return "destructive";
  if (invoice.amountDue <= 0) return "default";
  return "outline";
}

function quoteVariant(quote: PortalQuoteListDto): "default" | "secondary" | "destructive" | "outline" {
  if (quote.displayStatus === "Expired" || quote.displayStatus === "Unavailable") return "secondary";
  if (quote.displayStatus === "Declined") return "secondary";
  return "outline";
}

function orderVariant(order: PortalOrderListDto): "default" | "secondary" | "destructive" | "outline" {
  const status = order.displayStatus.toLowerCase();
  if (status.includes("canceled")) return "destructive";
  if (status.includes("ready") || status.includes("shipped")) return "default";
  if (status.includes("awaiting")) return "secondary";
  return "outline";
}

function EmptyState({ text }: { text: string }) {
  return <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">{text}</p>;
}

function InvoiceItem({ invoice }: { invoice: PortalInvoiceDto }) {
  return (
    <div className="flex flex-col gap-3 rounded-md border p-4 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <Link to={`/portal/invoices/${invoice.id}`} className="font-medium hover:underline">
            Invoice #{invoice.invoiceNumber}
          </Link>
          <Badge variant={invoiceVariant(invoice)}>{invoice.status === "overdue" ? "Past Due" : invoice.paymentStatusLabel}</Badge>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">Due {formatDate(invoice.dueDate)}</p>
      </div>
      <div className="flex items-center gap-3 sm:justify-end">
        <div className="text-right">
          <p className="text-xs text-muted-foreground">Amount due</p>
          <p className="font-semibold">{formatCurrency(invoice.amountDue, invoice.currency)}</p>
        </div>
        <Button asChild size="sm">
          <Link to={`/portal/invoices/${invoice.id}`}>Pay</Link>
        </Button>
      </div>
    </div>
  );
}

function QuoteItem({ quote }: { quote: PortalQuoteListDto }) {
  return (
    <div className="flex flex-col gap-3 rounded-md border p-4 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <Link to={`/portal/quotes/${quote.id}`} className="font-medium hover:underline">
            Quote #{quote.quoteNumber ?? quote.id.slice(0, 8)}
          </Link>
          <Badge variant={quoteVariant(quote)}>{quote.displayStatus}</Badge>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">Valid until {formatDate(quote.validUntil)}</p>
      </div>
      <div className="flex items-center gap-3 sm:justify-end">
        <p className="font-semibold">{formatCurrency(quote.total)}</p>
        <Button asChild variant="outline" size="sm">
          <Link to={`/portal/quotes/${quote.id}`}>Review</Link>
        </Button>
      </div>
    </div>
  );
}

function OrderItem({ order }: { order: PortalOrderListDto }) {
  return (
    <div className="rounded-md border p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <Link to={`/portal/orders/${order.id}`} className="font-medium hover:underline">
              Order #{order.orderNumber}
            </Link>
            <Badge variant={orderVariant(order)}>{order.displayStatus}</Badge>
            {order.proofStatusSummary.actionRequired ? (
              <Badge variant="secondary">
                <AlertCircle className="mr-1 h-3 w-3" />
                Awaiting Your Approval
              </Badge>
            ) : null}
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {order.itemCount} item{order.itemCount === 1 ? "" : "s"} / {order.fulfillmentSummary.statusLabel}
          </p>
        </div>
        <Button asChild variant="outline" size="sm">
          <Link to={`/portal/orders/${order.id}`}>Open</Link>
        </Button>
      </div>
    </div>
  );
}

function ProofItem({ proof }: { proof: PortalProofDto }) {
  return (
    <div className="flex flex-col gap-3 rounded-md border p-4 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <Link to={`/portal/proofs/${proof.id}`} className="font-medium hover:underline">
            Proof v{proof.versionNumber} / Order #{proof.orderSummary.orderNumber}
          </Link>
          <Badge variant="secondary">Awaiting Your Approval</Badge>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">{proof.lineItemSummary.name}</p>
      </div>
      <Button asChild variant="outline" size="sm">
        <Link to={`/portal/proofs/${proof.id}`}>Review</Link>
      </Button>
    </div>
  );
}

function FileItem({ file }: { file: PortalDashboardFileDto }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-md border p-4">
      <div className="min-w-0">
        <p className="truncate font-medium">{file.displayName}</p>
        <p className="mt-1 text-sm text-muted-foreground">
          {file.categoryLabel} / {file.sourceLabel}
        </p>
      </div>
      {file.downloadAvailable ? (
        <Button asChild variant="outline" size="icon" title="Download document">
          <a href={portalFileDownloadUrl(`${file.entityType}s` as "invoices" | "orders" | "quotes", file.entityId, file.id)}>
            <Download className="h-4 w-4" />
          </a>
        </Button>
      ) : null}
    </div>
  );
}

export default function PortalDashboardPage() {
  const { data, isLoading, error } = usePortalDashboard();

  if (isLoading) {
    return (
      <div className="flex min-h-[360px] items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="mx-auto max-w-5xl">
        <Card>
          <CardContent className="py-10 text-center">
            <p className="font-medium text-destructive">Could not load your dashboard</p>
            <p className="mt-1 text-sm text-muted-foreground">{(error as Error)?.message || "Please try again."}</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-normal">Dashboard</h1>
          <p className="mt-1 text-sm text-muted-foreground">A quick look at what needs attention and what is moving.</p>
        </div>
      </div>

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <div className="rounded-md border p-4">
          <ReceiptText className="mb-3 h-5 w-5 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">Unpaid invoices</p>
          <p className="mt-1 text-2xl font-semibold">{data.summary.openInvoiceCount}</p>
        </div>
        <div className="rounded-md border p-4">
          <p className="text-sm text-muted-foreground">Payable balance</p>
          <p className="mt-1 text-2xl font-semibold">{formatCurrency(data.summary.outstandingBalance)}</p>
        </div>
        <div className="rounded-md border p-4">
          <FileText className="mb-3 h-5 w-5 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">Quotes to review</p>
          <p className="mt-1 text-2xl font-semibold">{data.summary.quotesNeedingAction}</p>
        </div>
        <div className="rounded-md border p-4">
          <Package className="mb-3 h-5 w-5 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">Active orders</p>
          <p className="mt-1 text-2xl font-semibold">{data.summary.activeOrderCount}</p>
        </div>
        <div className="rounded-md border p-4">
          <AlertCircle className="mb-3 h-5 w-5 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">Proofs waiting</p>
          <p className="mt-1 text-2xl font-semibold">{data.summary.proofsAwaitingApproval}</p>
        </div>
      </section>

      <section className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>Outstanding Invoices</CardTitle>
            <Button asChild variant="ghost" size="sm">
              <Link to="/portal/invoices">
                View all
                <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
            </Button>
          </CardHeader>
          <CardContent className="space-y-3">
            {data.invoices.length ? data.invoices.map((invoice) => <InvoiceItem key={invoice.id} invoice={invoice} />) : <EmptyState text="No unpaid invoices" />}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>Quotes Requiring Attention</CardTitle>
            <Button asChild variant="ghost" size="sm">
              <Link to="/portal/my-quotes">
                View all
                <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
            </Button>
          </CardHeader>
          <CardContent className="space-y-3">
            {data.quotes.length ? data.quotes.map((quote) => <QuoteItem key={quote.id} quote={quote} />) : <EmptyState text="No quotes awaiting action" />}
          </CardContent>
        </Card>
      </section>

      <section className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>Active Orders</CardTitle>
            <Button asChild variant="ghost" size="sm">
              <Link to="/portal/my-orders">
                View all
                <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
            </Button>
          </CardHeader>
          <CardContent className="space-y-3">
            {data.activeOrders.length ? data.activeOrders.map((order) => <OrderItem key={order.id} order={order} />) : <EmptyState text="No active orders" />}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>Proofs Awaiting Approval</CardTitle>
            <Button asChild variant="ghost" size="sm">
              <Link to="/portal/proofs">
                View all
                <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
            </Button>
          </CardHeader>
          <CardContent className="space-y-3">
            {data.proofs.length ? data.proofs.map((proof) => <ProofItem key={proof.id} proof={proof} />) : <EmptyState text="No proofs awaiting approval" />}
          </CardContent>
        </Card>
      </section>

      <section className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>Recent Documents</CardTitle>
            <Button asChild variant="ghost" size="sm">
              <Link to="/portal/documents">
                View all
                <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
            </Button>
          </CardHeader>
          <CardContent className="space-y-3">
            {data.recentFiles.length ? data.recentFiles.slice(0, 5).map((file) => <FileItem key={`${file.entityType}-${file.entityId}-${file.id}`} file={file} />) : <EmptyState text="No recent documents" />}
          </CardContent>
        </Card>
      </section>

      <section>
        <Card>
          <CardHeader>
            <CardTitle>Recent Activity</CardTitle>
          </CardHeader>
          <CardContent>
            {data.recentActivity.length ? (
              <div className="space-y-3">
                {data.recentActivity.map((item) => (
                  <div key={item.id} className="flex items-center justify-between gap-4 rounded-md border p-3">
                    <p className="text-sm">{item.label}</p>
                    <p className="shrink-0 text-xs text-muted-foreground">{formatDate(item.occurredAt)}</p>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState text="No recent activity" />
            )}
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
