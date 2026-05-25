import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, CalendarClock, CheckCircle2, FileText, Loader2, MessageSquare, XCircle } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import PortalFilesCard from "@/components/portal/PortalFilesCard";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import {
  portalOrderKeys,
  portalQuoteKeys,
  usePortalQuoteAction,
  usePortalQuoteFiles,
  useQuoteCheckout,
  type PortalQuoteAction,
} from "@/hooks/usePortal";

function formatDate(value: string | null) {
  if (!value) return "Not set";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Not set";
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(date);
}

function formatCurrency(amount: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(Number(amount || 0));
}

function statusVariant(status: string): "default" | "secondary" | "destructive" | "outline" {
  if (status === "Expired" || status === "Unavailable" || status === "Declined") return "secondary";
  if (status === "Accepted" || status === "Converted to Order") return "default";
  return "outline";
}

export default function PortalQuoteDetailPage() {
  const { id } = useParams<{ id: string }>();
  const quoteId = id || "";
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const quoteQuery = useQuoteCheckout(quoteId);
  const filesQuery = usePortalQuoteFiles(quoteId);
  const actionMutation = usePortalQuoteAction(quoteId);
  const quote = quoteQuery.data;
  const files = filesQuery.data ?? [];
  const [selectedAction, setSelectedAction] = useState<PortalQuoteAction | null>(null);
  const [note, setNote] = useState("");
  const [createdOrder, setCreatedOrder] = useState<{ id: string; orderNumber: string; displayStatus: string } | null>(null);

  const actionLabels: Record<PortalQuoteAction, { title: string; description: string; confirm: string }> = {
    approve: {
      title: "Approve quote",
      description: "This will approve the quote and create an order for your account.",
      confirm: "Approve Quote",
    },
    decline: {
      title: "Decline quote",
      description: "This will mark the quote as declined. You can include a short note for your account team.",
      confirm: "Decline Quote",
    },
    request_revision: {
      title: "Request revision",
      description: "Tell us what should change. Your account team will review the request.",
      confirm: "Request Revision",
    },
  };

  const beginAction = (action: PortalQuoteAction) => {
    setSelectedAction(action);
    setNote("");
  };

  const submitAction = async () => {
    if (!selectedAction) return;
    try {
      const result = await actionMutation.mutateAsync({
        action: selectedAction,
        note: note.trim() || null,
      });
      setCreatedOrder(result.order ?? null);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: portalQuoteKeys.all }),
        queryClient.invalidateQueries({ queryKey: portalQuoteKeys.detail(quoteId) }),
        queryClient.invalidateQueries({ queryKey: portalOrderKeys.all }),
        result.order ? queryClient.invalidateQueries({ queryKey: portalOrderKeys.detail(result.order.id) }) : Promise.resolve(),
      ]);
      toast({
        title: actionLabels[selectedAction].title,
        description: result.message,
      });
      setSelectedAction(null);
      setNote("");
    } catch (error) {
      toast({
        title: "Quote action failed",
        description: error instanceof Error ? error.message : "The quote could not be updated.",
        variant: "destructive",
      });
    }
  };

  if (quoteQuery.isLoading) {
    return (
      <div className="flex min-h-[360px] items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!quote) {
    return (
      <div className="mx-auto w-full max-w-4xl space-y-4">
        <Button asChild variant="ghost">
          <Link to="/portal/quotes">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to quotes
          </Link>
        </Button>
        <Card>
          <CardContent className="py-12 text-center">
            <p className="font-medium">Quote not found</p>
            <p className="mt-1 text-sm text-muted-foreground">This quote is unavailable or you do not have access.</p>
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
            <Link to="/portal/quotes">
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back to quotes
            </Link>
          </Button>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-normal">Quote #{quote.quoteNumber ?? quote.id.slice(0, 8)}</h1>
            <Badge variant={statusVariant(quote.displayStatus)}>{quote.displayStatus}</Badge>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Created {formatDate(quote.createdAt)} / {quote.expirationSummary.expirationLabel}
          </p>
        </div>
        <div className="flex flex-wrap gap-2 md:justify-end">
          {quote.customerVisibleActions.canApprove ? (
            <Button onClick={() => beginAction("approve")} disabled={actionMutation.isPending}>
              <CheckCircle2 className="mr-2 h-4 w-4" />
              Approve Quote
            </Button>
          ) : null}
          {quote.customerVisibleActions.canRequestRevision ? (
            <Button variant="outline" onClick={() => beginAction("request_revision")} disabled={actionMutation.isPending}>
              <MessageSquare className="mr-2 h-4 w-4" />
              Request Revision
            </Button>
          ) : null}
          {quote.customerVisibleActions.canDecline ? (
            <Button variant="outline" onClick={() => beginAction("decline")} disabled={actionMutation.isPending}>
              <XCircle className="mr-2 h-4 w-4" />
              Decline Quote
            </Button>
          ) : null}
          {!quote.customerVisibleActions.canApprove &&
          !quote.customerVisibleActions.canRequestRevision &&
          !quote.customerVisibleActions.canDecline ? (
            <Button disabled title={quote.customerVisibleActions.disabledReason || undefined}>
              {quote.customerVisibleActions.disabledReason || "Actions unavailable"}
            </Button>
          ) : null}
        </div>
      </div>

      {createdOrder ? (
        <Card>
          <CardContent className="flex flex-col gap-3 py-4 md:flex-row md:items-center md:justify-between">
            <div>
              <p className="font-medium">Order #{createdOrder.orderNumber} created</p>
              <p className="text-sm text-muted-foreground">Status: {createdOrder.displayStatus}</p>
            </div>
            <Button asChild variant="outline">
              <Link to={`/portal/orders/${createdOrder.id}`}>View Order</Link>
            </Button>
          </CardContent>
        </Card>
      ) : null}

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Total</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold">{formatCurrency(quote.total)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <FileText className="h-4 w-4" />
              Items
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold">{quote.itemCount}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <CalendarClock className="h-4 w-4" />
              Expiration
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="font-medium">{quote.expirationSummary.expirationLabel}</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Line Items</CardTitle>
        </CardHeader>
        <CardContent className="divide-y p-0">
          {quote.lineItems.map((item) => (
            <div key={item.id} className="grid gap-3 px-4 py-4 md:grid-cols-[1fr_auto_auto] md:items-center">
              <div className="min-w-0">
                <p className="font-medium">{item.name}</p>
                {item.description ? <p className="mt-1 text-sm text-muted-foreground">{item.description}</p> : null}
                <p className="mt-1 text-sm text-muted-foreground">
                  Qty {item.quantity}
                  {item.dimensions.width && item.dimensions.height
                    ? ` / ${item.dimensions.width} x ${item.dimensions.height}`
                    : ""}
                </p>
                {item.displayOptions.length > 0 ? (
                  <p className="mt-1 text-sm text-muted-foreground">{item.displayOptions.join(" / ")}</p>
                ) : null}
              </div>
              <p className="text-sm text-muted-foreground md:text-right">{formatCurrency(item.unitPrice)} each</p>
              <p className="font-medium md:text-right">{formatCurrency(item.lineTotal)}</p>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Quote Summary</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Subtotal</span>
            <span>{formatCurrency(quote.subtotal)}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Tax</span>
            <span>{formatCurrency(quote.tax)}</span>
          </div>
          <Separator />
          <div className="flex justify-between font-medium">
            <span>Total</span>
            <span>{formatCurrency(quote.total)}</span>
          </div>
        </CardContent>
      </Card>

      <PortalFilesCard
        title="Quote Documents"
        files={files}
        isLoading={filesQuery.isLoading}
        error={filesQuery.error}
        entity="quotes"
        entityId={quote.id}
      />

      <Dialog open={!!selectedAction} onOpenChange={(open) => !open && setSelectedAction(null)}>
        <DialogContent>
          {selectedAction ? (
            <>
              <DialogHeader>
                <DialogTitle>{actionLabels[selectedAction].title}</DialogTitle>
                <DialogDescription>{actionLabels[selectedAction].description}</DialogDescription>
              </DialogHeader>
              {selectedAction !== "approve" ? (
                <div className="space-y-2">
                  <label className="text-sm font-medium" htmlFor="quote-action-note">
                    Note optional
                  </label>
                  <Textarea
                    id="quote-action-note"
                    value={note}
                    onChange={(event) => setNote(event.target.value)}
                    placeholder="Add a short note"
                    maxLength={1000}
                  />
                </div>
              ) : null}
              <DialogFooter>
                <Button variant="outline" onClick={() => setSelectedAction(null)} disabled={actionMutation.isPending}>
                  Cancel
                </Button>
                <Button
                  variant={selectedAction === "decline" ? "destructive" : "default"}
                  onClick={submitAction}
                  disabled={actionMutation.isPending}
                >
                  {actionMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                  {actionLabels[selectedAction].confirm}
                </Button>
              </DialogFooter>
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
