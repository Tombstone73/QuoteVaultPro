import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { CheckCircle2, CreditCard, Loader2, Receipt } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EmptyState, Money, Notice, PortalPage, Section } from "@/components/portal/ui";
import { invoices } from "@/lib/portal/data";
import { portalApi, shortDate } from "@/lib/portal/service";
import { usePortalStore } from "@/lib/portal/store";

export const Route = createFileRoute("/portal/pay")({
  head: () => ({
    meta: [
      { title: "Pay Invoices — Hensley Print Co." },
      { name: "description", content: "Review your allocation and settle several invoices with one payment." },
      { property: "og:title", content: "Pay Invoices — Hensley Print Co." },
      { property: "og:description", content: "One payment, allocated across the invoices you choose." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: PayPage,
});

function PayPage() {
  const { selectedForPayment, setSelectedForPayment, paidInvoices, recordPayment } = usePortalStore();
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [state, setState] = useState<"review" | "processing" | "success" | "failed">("review");
  const [confirmation, setConfirmation] = useState<{ confirmation: string; total: number } | null>(null);

  const selected = useMemo(
    () =>
      invoices
        .filter((i) => selectedForPayment.includes(i.id))
        .map((i) => ({ ...i, balance: Math.max(0, i.balance - (paidInvoices[i.id] ?? 0)) })),
    [selectedForPayment, paidInvoices],
  );

  const allocations = selected
    .filter((i) => i.balance > 0)
    .map((i) => {
      const entered = Number(amounts[i.id] ?? i.balance);
      const amount = Math.min(Math.max(0, isNaN(entered) ? 0 : entered), i.balance);
      return { invoiceId: i.id, number: i.number, amount, balance: i.balance, allowsPartial: i.allowsPartial, dueOn: i.dueOn };
    });

  const alreadyPaid = selected.filter((i) => i.balance === 0);
  const total = allocations.reduce((s, a) => s + a.amount, 0);

  if (state === "success" && confirmation) {
    return (
      <PortalPage title="Payment received" description={`Confirmation ${confirmation.confirmation}`}>
        <Section>
          <div className="flex items-start gap-3">
            <CheckCircle2 className="mt-0.5 size-6 shrink-0 text-ok" aria-hidden />
            <div>
              <p className="text-lg font-semibold">
                <Money value={confirmation.total} /> paid
              </p>
              <p className="text-[13px] text-muted-foreground">
                One payment, allocated across {allocations.length} invoice{allocations.length === 1 ? "" : "s"}. A receipt is on its way to your email.
              </p>
            </div>
          </div>
          <ul className="mt-4 divide-y divide-border border-t border-border pt-2 text-[13px]">
            {allocations.map((a) => (
              <li key={a.invoiceId} className="flex justify-between py-2">
                <span>{a.number}</span>
                <Money value={a.amount} />
              </li>
            ))}
          </ul>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button asChild onClick={() => setSelectedForPayment([])}>
              <Link to="/portal/invoices">Back to invoices</Link>
            </Button>
            <Button variant="outline" asChild onClick={() => setSelectedForPayment([])}>
              <Link to="/portal">Portal home</Link>
            </Button>
          </div>
        </Section>
      </PortalPage>
    );
  }

  if (allocations.length === 0) {
    return (
      <PortalPage title="Pay invoices">
        <Section bare>
          <EmptyState
            icon={Receipt}
            title="No invoices selected"
            message="Choose the open invoices you'd like to pay and they'll appear here."
            action={<Button asChild><Link to="/portal/invoices">Select invoices</Link></Button>}
          />
        </Section>
      </PortalPage>
    );
  }

  return (
    <PortalPage title="Pay invoices" description="One payment, allocated across the invoices you selected.">
      {alreadyPaid.length > 0 && (
        <Notice tone="info" title="Some invoices were already settled">
          {alreadyPaid.map((i) => i.number).join(", ")} {alreadyPaid.length === 1 ? "has" : "have"} a zero balance and
          {alreadyPaid.length === 1 ? " was" : " were"} removed from this payment.
        </Notice>
      )}
      {state === "failed" && (
        <Notice tone="danger" title="Payment failed">
          Your card was not charged. Check the card details or try a different payment method.
        </Notice>
      )}

      <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <Section title="Invoices in this payment" bare>
          <ul className="divide-y divide-border">
            {allocations.map((a) => (
              <li key={a.invoiceId} className="grid gap-3 px-4 py-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:px-5">
                <div className="min-w-0">
                  <p className="text-sm font-medium">{a.number}</p>
                  <p className="text-[12px] text-muted-foreground">
                    Balance <Money value={a.balance} /> · Due {shortDate(a.dueOn)}
                    {!a.allowsPartial && " · Full balance required"}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[12px] text-muted-foreground">Paying</span>
                  <Input
                    className="h-9 w-28 text-right tabular-nums"
                    inputMode="decimal"
                    value={amounts[a.invoiceId] ?? a.balance.toFixed(2)}
                    disabled={!a.allowsPartial}
                    onChange={(e) => setAmounts((m) => ({ ...m, [a.invoiceId]: e.target.value }))}
                    aria-label={`Amount to pay on ${a.number}`}
                  />
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-8"
                    onClick={() => setSelectedForPayment(selectedForPayment.filter((x) => x !== a.invoiceId))}
                  >
                    Remove
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </Section>

        <div className="space-y-4 lg:sticky lg:top-20 lg:self-start">
          <Section title="Payment review">
            <dl className="space-y-2 text-[13px]">
              {allocations.map((a) => (
                <div key={a.invoiceId} className="flex justify-between">
                  <dt className="text-muted-foreground">{a.number}</dt>
                  <dd><Money value={a.amount} /></dd>
                </div>
              ))}
              <div className="flex justify-between border-t border-border pt-2 text-base font-semibold">
                <dt>Total</dt>
                <dd><Money value={total} /></dd>
              </div>
            </dl>
            <p className="mt-3 text-[12px] text-muted-foreground">
              This is a single payment allocated across the invoices above — not separate charges.
            </p>
            <div className="mt-3 flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-[13px]">
              <CreditCard className="size-4 text-muted-foreground" aria-hidden />
              Visa ending 4242
              <span className="ml-auto text-[12px] text-muted-foreground">Default</span>
            </div>
            <Button
              className="mt-3 w-full"
              disabled={state === "processing" || total <= 0}
              onClick={() => {
                setState("processing");
                portalApi
                  .payInvoices(allocations.map((a) => ({ invoiceId: a.invoiceId, amount: a.amount })))
                  .then((res) => {
                    recordPayment(allocations.map((a) => ({ invoiceId: a.invoiceId, amount: a.amount })));
                    setConfirmation(res);
                    setState("success");
                  })
                  .catch(() => setState("failed"));
              }}
            >
              {state === "processing" && <Loader2 className="mr-2 size-4 animate-spin" />}
              {state === "processing" ? "Processing payment" : `Pay ${total.toLocaleString("en-US", { style: "currency", currency: "USD" })}`}
            </Button>
          </Section>
        </div>
      </div>
    </PortalPage>
  );
}
