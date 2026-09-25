import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import StripePayDialog from "@/components/payments/StripePayDialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type GuestInvoice = { paymentEligibility?: { payable: boolean; blockedReason: string | null }; businessName: string; invoiceNumber: string; amountDue: number; amountPaid: number; total: number; currency: string; paymentStatusLabel: string; status: string };
const money = (value: number, currency: string) => new Intl.NumberFormat("en-US", { style: "currency", currency: currency || "USD" }).format(Number(value || 0));

export default function GuestInvoicePaymentPage() {
  const { token = "" } = useParams<{ token: string }>();
  const [invoice, setInvoice] = useState<GuestInvoice | null>(null);
  const [loadMessage, setLoadMessage] = useState("Unable to load this payment page.");
  const [loading, setLoading] = useState(true);
  const [payOpen, setPayOpen] = useState(false);
  const load = async () => {
    setLoading(true);
    try {
      const response = await fetch(`/api/guest/invoices/${encodeURIComponent(token)}`);
      const payload = await response.json().catch(() => ({}));
      setInvoice(response.ok ? payload.data : null);
      if (!response.ok) setLoadMessage(String(payload?.message || "This invoice payment link is invalid or expired."));
    } catch { setInvoice(null); setLoadMessage("Unable to load this payment page. Please try the link again or contact us for help."); } finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, [token]);
  if (loading) return <div className="min-h-screen p-8 text-center">Loading invoice…</div>;
  if (!invoice) return <main className="mx-auto flex min-h-screen max-w-xl items-center p-5"><Card className="w-full"><CardHeader><CardTitle>Invoice payment unavailable</CardTitle></CardHeader><CardContent className="space-y-2 text-sm text-muted-foreground"><p>{loadMessage}</p><p>Please contact the business that sent this invoice if you need a new payment link.</p></CardContent></Card></main>;
  const payable = invoice.paymentEligibility?.payable === true;
  return <main className="mx-auto min-h-screen max-w-xl p-5"><Card><CardHeader><CardTitle>{invoice.businessName}</CardTitle></CardHeader><CardContent className="space-y-4"><div><p className="text-sm text-muted-foreground">Invoice</p><p className="text-xl font-semibold">{invoice.invoiceNumber}</p></div><div className="flex justify-between"><span>Balance due</span><strong>{money(invoice.amountDue, invoice.currency)}</strong></div><div className="flex justify-between text-sm text-muted-foreground"><span>Total</span><span>{money(invoice.total, invoice.currency)}</span></div>{payable ? <Button className="w-full" onClick={() => setPayOpen(true)}>Pay Invoice</Button> : <p className="rounded-md bg-muted p-3 text-sm">Paid — no balance is due.</p>}</CardContent></Card><StripePayDialog open={payOpen} onOpenChange={setPayOpen} invoiceId={token} apiBasePath="/api/guest/invoices" onSettled={async ({ serverConfirmed }) => { await load(); return { reconciled: serverConfirmed }; }} /></main>;
}
