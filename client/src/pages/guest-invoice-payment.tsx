import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import StripePayDialog from "@/components/payments/StripePayDialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type GuestInvoice = { businessName: string; invoiceNumber: string; amountDue: number; amountPaid: number; total: number; currency: string; paymentStatusLabel: string; status: string };
const money = (value: number, currency: string) => new Intl.NumberFormat("en-US", { style: "currency", currency: currency || "USD" }).format(Number(value || 0));

export default function GuestInvoicePaymentPage() {
  const { token = "" } = useParams<{ token: string }>();
  const [invoice, setInvoice] = useState<GuestInvoice | null>(null);
  const [loading, setLoading] = useState(true);
  const [payOpen, setPayOpen] = useState(false);
  const load = async () => {
    setLoading(true);
    try {
      const response = await fetch(`/api/guest/invoices/${encodeURIComponent(token)}`);
      const payload = await response.json();
      setInvoice(response.ok ? payload.data : null);
    } catch { setInvoice(null); } finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, [token]);
  if (loading) return <div className="min-h-screen p-8 text-center">Loading invoice…</div>;
  if (!invoice) return <div className="min-h-screen p-8 text-center">This invoice payment link is invalid or expired.</div>;
  const payable = Number(invoice.amountDue || 0) > 0;
  return <main className="mx-auto min-h-screen max-w-xl p-5"><Card><CardHeader><CardTitle>{invoice.businessName}</CardTitle></CardHeader><CardContent className="space-y-4"><div><p className="text-sm text-muted-foreground">Invoice</p><p className="text-xl font-semibold">{invoice.invoiceNumber}</p></div><div className="flex justify-between"><span>Balance due</span><strong>{money(invoice.amountDue, invoice.currency)}</strong></div><div className="flex justify-between text-sm text-muted-foreground"><span>Total</span><span>{money(invoice.total, invoice.currency)}</span></div>{payable ? <Button className="w-full" onClick={() => setPayOpen(true)}>Pay Invoice</Button> : <p className="rounded-md bg-muted p-3 text-sm">Paid — no balance is due.</p>}</CardContent></Card><StripePayDialog open={payOpen} onOpenChange={setPayOpen} invoiceId={token} apiBasePath="/api/guest/invoices" onSettled={async ({ serverConfirmed }) => { await load(); return { reconciled: serverConfirmed }; }} /></main>;
}
