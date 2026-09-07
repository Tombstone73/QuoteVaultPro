import { useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Loader2, ShoppingBag, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { EmptyState, KeyValue, Money, Notice, PortalPage, Section, StatusPill } from "@/components/portal/ui";
import { account } from "@/lib/portal/data";
import { portalApi } from "@/lib/portal/service";
import { usePortalStore } from "@/lib/portal/store";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/portal/review")({
  head: () => ({
    meta: [
      { title: "Review Your Order — Hensley Print Co." },
      { name: "description", content: "Check items, artwork, PO and delivery before placing your print order." },
      { property: "og:title", content: "Review Your Order — Hensley Print Co." },
      { property: "og:description", content: "One last look before your order reaches the shop floor." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ReviewPage,
});

function ReviewPage() {
  const navigate = useNavigate();
  const { cart, removeLine, po, setPo, orderNotes, setOrderNotes, method, setMethod, setLastOrderNumber } = usePortalStore();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const subtotal = cart.reduce((s, l) => s + l.lineTotal, 0);
  const tax = Math.round(subtotal * 0.07 * 100) / 100;
  const total = subtotal + tax;

  if (cart.length === 0) {
    return (
      <PortalPage title="Review order">
        <Section bare>
          <EmptyState
            icon={ShoppingBag}
            title="Your order draft is empty"
            message="Add a product from the shop and it will appear here for review."
            action={<Button asChild><Link to="/portal/shop">Browse products</Link></Button>}
          />
        </Section>
      </PortalPage>
    );
  }

  return (
    <PortalPage title="Review order" description="Check everything below, then place your order.">
      {error && (
        <Notice tone="danger" title="We couldn't create your order">
          {error} Nothing was submitted — you can try again.
        </Notice>
      )}

      <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-4">
          <Section title="Account">
            <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3">
              <KeyValue label="Customer">{account.company}</KeyValue>
              <KeyValue label="Contact">{account.contactName}</KeyValue>
              <KeyValue label="Terms">{account.terms}</KeyValue>
            </dl>
          </Section>

          <Section title={`Items (${cart.length})`} bare>
            <ul className="divide-y divide-border">
              {cart.map((l) => (
                <li key={l.id} className="grid gap-3 px-4 py-4 sm:px-5">
                  <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold">{l.productName}</p>
                      <ul className="mt-1 flex flex-wrap gap-1.5">
                        {l.config.map((c) => (
                          <li key={c.label} className="rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground">
                            {c.label}: {c.value}
                          </li>
                        ))}
                        <li className="rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground">
                          Qty: {l.qty.toLocaleString()}
                        </li>
                      </ul>
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        {l.artworkLater ? (
                          <StatusPill value="Awaiting Your Approval" icon={false} className="!bg-warn/15" />
                        ) : (
                          l.artwork.map((a) => (
                            <span key={a.id} className="truncate rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground">
                              {a.name}
                            </span>
                          ))
                        )}
                        {l.artworkLater && <span className="text-[12px] text-muted-foreground">Artwork to follow</span>}
                      </div>
                      {l.notes && <p className="mt-2 text-[12px] text-muted-foreground">Note: {l.notes}</p>}
                    </div>
                    <div className="text-right">
                      <Money value={l.lineTotal} className="block text-sm font-semibold" />
                      <span className="text-[12px] text-muted-foreground">
                        <Money value={l.unitPrice} /> each
                      </span>
                      <div className="mt-2 flex justify-end gap-1">
                        <Button size="sm" variant="ghost" className="h-7" asChild>
                          <Link to="/portal/shop/$productId" params={{ productId: l.productId }}>
                            Edit
                          </Link>
                        </Button>
                        <Button size="icon" variant="ghost" className="size-7" aria-label="Remove item" onClick={() => removeLine(l.id)}>
                          <Trash2 className="size-4" />
                        </Button>
                      </div>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </Section>

          <Section title="Order details">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="po">Your PO number</Label>
                <Input id="po" value={po} onChange={(e) => setPo(e.target.value)} placeholder="e.g. BRO-2301" />
              </div>
              <div className="space-y-1.5">
                <Label>Delivery</Label>
                <div className="inline-flex rounded-lg border border-border p-0.5">
                  {(["Ship", "Pickup"] as const).map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setMethod(m)}
                      className={cn(
                        "rounded-md px-3 py-1.5 text-[13px] font-medium transition-colors",
                        method === m ? "bg-accent text-foreground" : "text-muted-foreground",
                      )}
                    >
                      {m}
                    </button>
                  ))}
                </div>
                <p className="text-[12px] text-muted-foreground">
                  {method === "Ship" ? account.addresses[1]?.lines.join(", ") : "Will call — Hensley Print Co."}
                </p>
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="onotes">Order notes</Label>
                <Textarea id="onotes" rows={2} value={orderNotes} onChange={(e) => setOrderNotes(e.target.value)} />
              </div>
            </div>
          </Section>
        </div>

        <div className="space-y-4 lg:sticky lg:top-20 lg:self-start">
          <Section title="Order total">
            <dl className="space-y-2 text-[13px]">
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Subtotal</dt>
                <dd><Money value={subtotal} /></dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Estimated tax</dt>
                <dd><Money value={tax} /></dd>
              </div>
              <div className="flex justify-between border-t border-border pt-2 text-base font-semibold">
                <dt>Total</dt>
                <dd><Money value={total} /></dd>
              </div>
            </dl>
            <p className="mt-3 text-[12px] text-muted-foreground">
              Final pricing, tax and freight are confirmed by our team. No payment is taken now — you&apos;ll be invoiced on {account.terms}.
            </p>
            <Button
              className="mt-3 w-full"
              disabled={submitting}
              onClick={() => {
                setError(null);
                setSubmitting(true);
                portalApi
                  .submitOrder()
                  .then((res) => {
                    setLastOrderNumber(res.orderNumber);
                    navigate({ to: "/portal/confirmation" });
                  })
                  .catch(() => setError("Something went wrong on our end."))
                  .finally(() => setSubmitting(false));
              }}
            >
              {submitting && <Loader2 className="mr-2 size-4 animate-spin" />}
              {submitting ? "Placing order" : "Place order"}
            </Button>
          </Section>
        </div>
      </div>
    </PortalPage>
  );
}
