import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { ArrowLeft, Mail, DollarSign, Trash2, RefreshCw } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useInvoice, useApplyInvoicePayment, useBillInvoice, useRetryInvoiceQbSync, useSendInvoice, useDeletePayment, useRefreshInvoiceStatus, useDeleteInvoice, useMarkInvoiceSent } from "@/hooks/useInvoices";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";

const statusColors: Record<string, string> = {
  draft: "bg-gray-500",
  billed: "bg-blue-600",
  sent: "bg-blue-500",
  partially_paid: "bg-yellow-500",
  paid: "bg-green-500",
  overdue: "bg-red-500",
  void: "bg-zinc-500",
};

const statusLabels: Record<string, string> = {
  draft: "Draft",
  billed: "Billed",
  sent: "Sent",
  partially_paid: "Partially Paid",
  paid: "Paid",
  overdue: "Overdue",
  void: "Void",
};

export default function InvoiceDetailPage() {
  const params = useParams();
  const navigate = useNavigate();
  const invoiceId = (params as any)?.id as string | undefined;
  const { user } = useAuth();
  const { toast } = useToast();

  const { data, isLoading, refetch } = useInvoice(invoiceId);
  const applyPayment = useApplyInvoicePayment();
  const billInvoice = useBillInvoice();
  const retryQbSync = useRetryInvoiceQbSync();
  const sendInvoice = useSendInvoice();
  const markSent = useMarkInvoiceSent();
  const deletePayment = useDeletePayment();
  const refreshStatus = useRefreshInvoiceStatus();
  const deleteInvoice = useDeleteInvoice();

  const [paymentDialogOpen, setPaymentDialogOpen] = useState(false);
  const [paymentAmount, setPaymentAmount] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("check");
  const [paymentNotes, setPaymentNotes] = useState("");

  const [emailDialogOpen, setEmailDialogOpen] = useState(false);
  const [recipientEmail, setRecipientEmail] = useState("");

  const isAdminOrOwner = user?.isAdmin || user?.role === 'owner' || user?.role === 'admin';

  const formatCurrency = (amount: string | number) => {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
    }).format(Number(amount));
  };

  const formatDate = (dateString: string | Date | null) => {
    if (!dateString) return "-";
    try {
      return format(new Date(dateString), "MMM d, yyyy");
    } catch {
      return "-";
    }
  };

  const handleApplyPayment = async () => {
    if (!invoiceId || !paymentAmount) return;
    try {
      await applyPayment.mutateAsync({
        invoiceId,
        amount: Number(paymentAmount),
        method: paymentMethod,
        note: paymentNotes || undefined,
      });
      toast({ title: "Success", description: "Payment applied successfully" });
      setPaymentDialogOpen(false);
      setPaymentAmount("");
      setPaymentNotes("");
      refetch();
    } catch (error: any) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    }
  };

  const handleSendEmail = async () => {
    if (!invoiceId) return;
    try {
      await sendInvoice.mutateAsync({ id: invoiceId, toEmail: recipientEmail || undefined });
      toast({ title: "Success", description: "Invoice sent successfully" });
      setEmailDialogOpen(false);
      setRecipientEmail("");
      refetch();
    } catch (error: any) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    }
  };

  const handleDeletePayment = async (paymentId: string) => {
    if (!invoiceId || !confirm("Delete this payment?")) return;
    try {
      await deletePayment.mutateAsync({ id: paymentId, invoiceId });
      toast({ title: "Success", description: "Payment deleted" });
      refetch();
    } catch (error: any) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    }
  };

  const handleRefreshStatus = async () => {
    if (!invoiceId) return;
    try {
      await refreshStatus.mutateAsync(invoiceId);
      toast({ title: "Success", description: "Status refreshed" });
      refetch();
    } catch (error: any) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    }
  };

  const handleDelete = async () => {
    if (!invoiceId || !confirm("Delete this invoice? This cannot be undone.")) return;
    try {
      await deleteInvoice.mutateAsync(invoiceId);
      toast({ title: "Success", description: "Invoice deleted" });
      navigate("/invoices");
    } catch (error: any) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    }
  };

  const handleBill = async () => {
    if (!invoiceId) return;
    try {
      await billInvoice.mutateAsync(invoiceId);
      toast({ title: 'Success', description: 'Invoice finalized (sync attempted)' });
      refetch();
    } catch (error: any) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    }
  };

  const handleMarkSent = async () => {
    if (!invoiceId) return;
    try {
      await markSent.mutateAsync({ id: invoiceId, via: 'manual' });
      toast({ title: 'Success', description: 'Marked as sent' });
      refetch();
    } catch (error: any) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    }
  };

  const handleRetryQb = async () => {
    if (!invoiceId) return;
    try {
      await retryQbSync.mutateAsync(invoiceId);
      toast({ title: 'Success', description: 'QuickBooks sync retried' });
      refetch();
    } catch (error: any) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    }
  };

  if (isLoading) {
    return (
      <div className="p-6">
        <div className="max-w-5xl mx-auto">
          <div className="text-center py-12">Loading invoice...</div>
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="p-6">
        <div className="max-w-5xl mx-auto">
          <div className="text-center py-12">Invoice not found</div>
        </div>
      </div>
    );
  }

  const { invoice, lineItems, payments } = data;
  const balanceDue = Number(invoice.balanceDue || Number(invoice.total) - Number(invoice.amountPaid));
  const invoiceStatus = String(invoice.status || '').toLowerCase();
  const qbFailed = (invoice as any).qbSyncStatus === 'failed' || !!(invoice as any).qbLastError;

  const invoiceVersion = Number((invoice as any).invoiceVersion || 1);
  const lastSentVersion = (invoice as any).lastSentVersion == null ? null : Number((invoice as any).lastSentVersion);
  const lastQbSyncedVersion = (invoice as any).lastQbSyncedVersion == null ? null : Number((invoice as any).lastQbSyncedVersion);

  const invoiceLifecycleStatus = invoiceStatus === 'paid' ? 'Paid' : (invoiceStatus === 'draft' ? 'Draft' : 'Finalized');
  const customerHasLatest = lastSentVersion === invoiceVersion;
  const qbUpToDate = lastQbSyncedVersion === invoiceVersion;

  return (
    <div className="p-6">
      <div className="max-w-5xl mx-auto space-y-6">
        {qbFailed && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">QuickBooks Sync</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center justify-between gap-4">
                <div className="text-sm text-muted-foreground">
                  Sync failed. Local billing is not blocked.
                </div>
                {isAdminOrOwner && (
                  <Button variant="outline" onClick={handleRetryQb} disabled={retryQbSync.isPending}>
                    <RefreshCw className="mr-2 h-4 w-4" />
                    {retryQbSync.isPending ? 'Retrying…' : 'Retry Sync'}
                  </Button>
                )}
              </div>
              {(invoice as any).qbLastError && (
                <div className="text-xs font-mono text-muted-foreground whitespace-pre-wrap">
                  {(invoice as any).qbLastError}
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Button variant="outline" size="icon" asChild>
              <Link to="/invoices">
                <ArrowLeft className="h-4 w-4" />
              </Link>
            </Button>
            <div>
              <h1 className="text-3xl font-bold">Invoice #{invoice.invoiceNumber}</h1>
              <p className="text-muted-foreground">Issued {formatDate((invoice as any).issuedAt || invoice.issueDate)}</p>
            </div>
            <Badge className={statusColors[invoiceStatus] || "bg-gray-500"}>
              {statusLabels[invoiceStatus] || invoice.status}
            </Badge>
          </div>
          <div className="flex gap-2">
            {isAdminOrOwner && (
              <>
                <Button variant="outline" onClick={handleRefreshStatus}>
                  <RefreshCw className="mr-2 h-4 w-4" />
                  Refresh
                </Button>
                {invoiceStatus === 'draft' && (
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button onClick={handleBill} disabled={billInvoice.isPending}>
                          {billInvoice.isPending ? 'Finalizing…' : 'Finalize & Sync'}
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>
                        Finalizes the invoice and attempts QuickBooks sync. Local billing is not blocked if sync fails.
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                )}

                <Button variant="outline" onClick={handleMarkSent} disabled={markSent.isPending}>
                  {markSent.isPending ? 'Marking…' : 'Mark as Sent'}
                </Button>

                {invoice.status === 'draft' && payments.length === 0 && (
                  <Button variant="destructive" onClick={handleDelete}>
                    <Trash2 className="mr-2 h-4 w-4" />
                    Delete
                  </Button>
                )}
                <Dialog open={emailDialogOpen} onOpenChange={setEmailDialogOpen}>
                  <DialogTrigger asChild>
                    <Button variant="outline">
                      <Mail className="mr-2 h-4 w-4" />
                      Send Email
                    </Button>
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>Send Invoice</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4">
                      <div>
                        <Label htmlFor="email">Recipient Email (optional)</Label>
                        <Input
                          id="email"
                          type="email"
                          value={recipientEmail}
                          onChange={(e) => setRecipientEmail(e.target.value)}
                          placeholder="Leave blank to use customer email"
                        />
                      </div>
                    </div>
                    <DialogFooter>
                      <Button onClick={handleSendEmail} disabled={sendInvoice.isPending}>
                        {sendInvoice.isPending ? "Sending..." : "Send"}
                      </Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
                {balanceDue > 0 && invoiceStatus !== 'void' && (
                  <Dialog open={paymentDialogOpen} onOpenChange={setPaymentDialogOpen}>
                    <DialogTrigger asChild>
                      <Button>
                        <DollarSign className="mr-2 h-4 w-4" />
                        Record Payment
                      </Button>
                    </DialogTrigger>
                    <DialogContent>
                      <DialogHeader>
                        <DialogTitle>Record Payment</DialogTitle>
                      </DialogHeader>
                      <div className="space-y-4">
                        <div>
                          <Label htmlFor="amount">Amount *</Label>
                          <Input
                            id="amount"
                            type="number"
                            step="0.01"
                            value={paymentAmount}
                            onChange={(e) => setPaymentAmount(e.target.value)}
                            placeholder="0.00"
                          />
                          <p className="text-sm text-muted-foreground mt-1">
                            Balance due: {formatCurrency(balanceDue)}
                          </p>
                        </div>
                        <div>
                          <Label htmlFor="method">Payment Method *</Label>
                          <Select value={paymentMethod} onValueChange={setPaymentMethod}>
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="cash">Cash</SelectItem>
                              <SelectItem value="check">Check</SelectItem>
                              <SelectItem value="credit_card">Credit Card</SelectItem>
                              <SelectItem value="ach">ACH</SelectItem>
                              <SelectItem value="other">Other</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        <div>
                          <Label htmlFor="notes">Notes</Label>
                          <Textarea
                            id="notes"
                            value={paymentNotes}
                            onChange={(e) => setPaymentNotes(e.target.value)}
                            placeholder="Optional payment notes..."
                          />
                        </div>
                      </div>
                      <DialogFooter>
                        <Button onClick={handleApplyPayment} disabled={applyPayment.isPending || !paymentAmount}>
                          {applyPayment.isPending ? "Processing..." : "Record Payment"}
                        </Button>
                      </DialogFooter>
                    </DialogContent>
                  </Dialog>
                )}
              </>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3 text-sm">
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground">Invoice Status:</span>
            <Badge variant="secondary">{invoiceLifecycleStatus}</Badge>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground">Customer Status:</span>
            <Badge variant="secondary">{customerHasLatest ? 'Customer has latest' : 'Customer has NOT been sent latest'}</Badge>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground">Accounting Status:</span>
            <Badge variant="secondary">{qbUpToDate ? 'QuickBooks up to date' : 'QuickBooks out of date'}</Badge>
          </div>
        </div>

        {/* Invoice Details */}
        <div className="grid gap-4 md:grid-cols-3">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-medium">Total</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{formatCurrency(invoice.total)}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-medium">Paid</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-green-600">{formatCurrency(invoice.amountPaid)}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-medium">Balance Due</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-red-600">{formatCurrency(balanceDue)}</div>
            </CardContent>
          </Card>
        </div>

        {/* Line Items */}
        <Card>
          <CardHeader>
            <CardTitle>Line Items</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Description</TableHead>
                  <TableHead>Quantity</TableHead>
                  <TableHead>Unit Price</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {lineItems.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell>
                      <div className="font-medium">{item.description}</div>
                      {item.width && item.height && (
                        <div className="text-sm text-muted-foreground">
                          {item.width}" × {item.height}"
                        </div>
                      )}
                    </TableCell>
                    <TableCell>{item.quantity}</TableCell>
                    <TableCell>{formatCurrency(item.unitPrice)}</TableCell>
                    <TableCell className="text-right font-medium">
                      {formatCurrency(item.totalPrice)}
                    </TableCell>
                  </TableRow>
                ))}
                <TableRow>
                  <TableCell colSpan={3} className="text-right font-medium">Subtotal</TableCell>
                  <TableCell className="text-right">{formatCurrency(invoice.subtotal)}</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell colSpan={3} className="text-right font-medium">Tax</TableCell>
                  <TableCell className="text-right">{formatCurrency(invoice.tax)}</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell colSpan={3} className="text-right text-lg font-bold">Total</TableCell>
                  <TableCell className="text-right text-lg font-bold">{formatCurrency(invoice.total)}</TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        {/* Payment History */}
        <Card>
          <CardHeader>
            <CardTitle>Payment History</CardTitle>
          </CardHeader>
          <CardContent>
            {payments.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">No payments recorded</div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Method</TableHead>
                    <TableHead>Amount</TableHead>
                    <TableHead>Notes</TableHead>
                    {isAdminOrOwner && invoice.status !== 'paid' && <TableHead>Actions</TableHead>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {payments.map((payment) => (
                    <TableRow key={payment.id}>
                      <TableCell>{formatDate(payment.appliedAt)}</TableCell>
                      <TableCell className="capitalize">{payment.method.replace('_', ' ')}</TableCell>
                      <TableCell className="font-medium">{formatCurrency(payment.amount)}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{payment.notes || "-"}</TableCell>
                      {isAdminOrOwner && invoice.status !== 'paid' && (
                        <TableCell>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleDeletePayment(payment.id)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </TableCell>
                      )}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        {/* Notes */}
        {(invoice.notesPublic || invoice.notesInternal) && (
          <Card>
            <CardHeader>
              <CardTitle>Notes</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {invoice.notesPublic && (
                <div>
                  <h4 className="font-medium mb-2">Public Notes</h4>
                  <p className="text-sm text-muted-foreground">{invoice.notesPublic}</p>
                </div>
              )}
              {invoice.notesInternal && (
                <div>
                  <h4 className="font-medium mb-2">Internal Notes</h4>
                  <p className="text-sm text-muted-foreground">{invoice.notesInternal}</p>
                </div>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
