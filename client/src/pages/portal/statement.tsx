import { Download, FileText, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { portalStatementPdfUrl, usePortalStatement } from "@/hooks/usePortal";
import { usePortalDownload } from "@/hooks/usePortalDownload";

const money = (cents: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);

function date(value: string | null) {
  if (!value) return "—";
  // Statement and invoice dates are calendar dates. Noon keeps date-only
  // values from shifting backward in western time zones.
  const parsed = new Date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T12:00:00` : value);
  return Number.isNaN(parsed.getTime()) ? "—" : new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(parsed);
}

function statementFilename(customerName: string, statementDate: string) {
  const safeName = customerName.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "") || "Customer";
  return `${safeName}-Statement-${statementDate}.pdf`;
}

export default function PortalStatementPage() {
  const statement = usePortalStatement();
  const { download, downloading } = usePortalDownload();

  if (statement.isLoading) {
    return <div className="flex min-h-[360px] items-center justify-center text-muted-foreground"><Loader2 className="mr-2 h-5 w-5 animate-spin" />Loading account statement…</div>;
  }

  if (statement.isError || !statement.data) {
    return <Card><CardContent className="py-10 text-center"><p className="font-medium text-destructive">Could not load your account statement</p><p className="mt-1 text-sm text-muted-foreground">{statement.error instanceof Error ? statement.error.message : "Please try again."}</p></CardContent></Card>;
  }

  const data = statement.data;
  const handleDownload = () => void download(portalStatementPdfUrl(true), statementFilename(data.customer.companyName, data.statementDate));

  return <div className="mx-auto w-full max-w-6xl space-y-6" data-testid="portal-statement-page">
    <header className="flex flex-wrap items-start justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-normal">Account Statement</h1>
        <p className="mt-1 text-sm text-muted-foreground">{data.customer.companyName} · As of {date(data.statementDate)}</p>
        {data.customer.billingAddress ? <p className="mt-1 text-sm text-muted-foreground">{data.customer.billingAddress}</p> : null}
      </div>
      <Button type="button" variant="outline" onClick={handleDownload} disabled={downloading}>
        {downloading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}
        Download Statement
      </Button>
    </header>

    <section className="grid gap-4 md:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
      <Card className="border-primary/25 bg-primary/[0.03]">
        <CardContent className="p-5">
          <p className="text-sm font-medium text-muted-foreground">Current amount due</p>
          <p className="mt-1 text-4xl font-semibold tracking-tight">{money(data.summary.amountDueCents)}</p>
          {data.summary.unappliedCreditCents > 0 ? <p className="mt-2 text-sm text-muted-foreground">Includes {money(data.summary.unappliedCreditCents)} in available account credit.</p> : <p className="mt-2 text-sm text-muted-foreground">Based on your current open invoices.</p>}
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm font-medium">Aging summary</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-3">
          <span className="text-muted-foreground">Current <b className="ml-1 text-foreground">{money(data.summary.agingCents.current)}</b></span>
          <span className="text-muted-foreground">1–30 <b className="ml-1 text-foreground">{money(data.summary.agingCents.oneToThirty)}</b></span>
          <span className="text-muted-foreground">31–60 <b className="ml-1 text-foreground">{money(data.summary.agingCents.thirtyOneToSixty)}</b></span>
          <span className="text-muted-foreground">61–90 <b className="ml-1 text-foreground">{money(data.summary.agingCents.sixtyOneToNinety)}</b></span>
          <span className="text-muted-foreground">90+ <b className="ml-1 text-foreground">{money(data.summary.agingCents.ninetyPlus)}</b></span>
          {data.summary.unappliedCreditCents > 0 ? <span className="text-muted-foreground">Credit <b className="ml-1 text-foreground">{money(data.summary.unappliedCreditCents)}</b></span> : null}
        </CardContent>
      </Card>
    </section>

    <Card>
      <CardHeader><CardTitle>Open invoices</CardTitle></CardHeader>
      <CardContent className="p-0">
        {data.openItems.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-14 text-center"><FileText className="mb-3 h-9 w-9 text-muted-foreground" /><p className="font-medium">Your account is up to date</p><p className="mt-1 text-sm text-muted-foreground">There are no outstanding statement items. Current amount due: {money(data.summary.amountDueCents)}</p></div>
        ) : (
          <>
          <div className="divide-y md:hidden">
            {data.openItems.map((item) => <article key={item.invoiceId} className="space-y-3 p-4">
              <div className="flex items-start justify-between gap-4"><div><p className="font-semibold">Invoice {item.invoiceNumber}</p><p className="mt-1 text-sm text-muted-foreground">Due {date(item.dueDate)}</p></div><p className="text-right text-lg font-semibold">{money(item.remainingCents)}</p></div>
              <p className="text-sm text-muted-foreground">{[item.poNumber, item.orderNumber ? `Job ${item.orderNumber}` : null].filter(Boolean).join(" · ") || "No PO or job reference"}</p>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-2 border-t pt-3 text-sm"><div><dt className="text-muted-foreground">Original</dt><dd className="font-medium">{money(item.originalCents)}</dd></div><div><dt className="text-muted-foreground">Payments / credits</dt><dd className="font-medium">{money(item.paidCents)}</dd></div></dl>
            </article>)}
          </div>
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full min-w-[760px] text-sm">
              <thead className="border-y bg-muted/50"><tr><th className="p-3 text-left font-medium">Invoice</th><th className="p-3 text-left font-medium">Issued</th><th className="p-3 text-left font-medium">Due</th><th className="p-3 text-left font-medium">PO / Job</th><th className="p-3 text-right font-medium">Original</th><th className="p-3 text-right font-medium">Payments / Credits</th><th className="p-3 text-right font-medium">Balance</th></tr></thead>
              <tbody>{data.openItems.map((item) => <tr key={item.invoiceId} className="border-b last:border-0"><td className="p-3 font-medium">{item.invoiceNumber}</td><td className="p-3 text-muted-foreground">{date(item.issueDate)}</td><td className="p-3 text-muted-foreground">{date(item.dueDate)}</td><td className="p-3 text-muted-foreground">{[item.poNumber, item.orderNumber ? `Job ${item.orderNumber}` : null].filter(Boolean).join(" · ") || "—"}</td><td className="p-3 text-right">{money(item.originalCents)}</td><td className="p-3 text-right">{money(item.paidCents)}</td><td className="p-3 text-right font-semibold">{money(item.remainingCents)}</td></tr>)}</tbody>
            </table>
          </div>
          </>
        )}
      </CardContent>
    </Card>

    {(data.recentPayments.length > 0 || data.unappliedCredits.length > 0) ? <section className="grid gap-4 lg:grid-cols-2" aria-label="Account activity">
      {data.recentPayments.length > 0 ? <Card><CardHeader><CardTitle className="text-base">Recent payments</CardTitle></CardHeader><CardContent className="space-y-3">
        {data.recentPayments.map((payment) => <div key={payment.id} className="flex items-start justify-between gap-4 border-b pb-3 last:border-0 last:pb-0"><div><p className="font-medium">{payment.method || "Payment"}</p><p className="mt-0.5 text-sm text-muted-foreground">{date(payment.paidAt)} · Applied to invoice</p></div><p className="font-semibold">{money(payment.amountCents)}</p></div>)}
      </CardContent></Card> : null}
      {data.unappliedCredits.length > 0 ? <Card><CardHeader><CardTitle className="text-base">Available credits</CardTitle></CardHeader><CardContent className="space-y-3">
        {data.unappliedCredits.map((credit) => <div key={credit.id} className="flex items-start justify-between gap-4 border-b pb-3 last:border-0 last:pb-0"><div><p className="font-medium">{credit.sourceType || "Account credit"}</p><p className="mt-0.5 text-sm text-muted-foreground">{date(credit.createdAt)}{credit.reference ? ` · ${credit.reference}` : ""}{credit.reason ? ` · ${credit.reason}` : ""}</p></div><p className="font-semibold">{money(credit.amountCents)}</p></div>)}
      </CardContent></Card> : null}
    </section> : null}
  </div>;
}
