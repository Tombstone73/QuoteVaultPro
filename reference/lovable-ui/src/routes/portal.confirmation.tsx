import { createFileRoute, Link } from "@tanstack/react-router";
import { CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Money, PortalPage, Section, StatusPill } from "@/components/portal/ui";
import { usePortalStore } from "@/lib/portal/store";

export const Route = createFileRoute("/portal/confirmation")({
  head: () => ({
    meta: [
      { title: "Order Received — Hensley Print Co." },
      { name: "description", content: "Your print order has been received. See what happens next and track its progress." },
      { property: "og:title", content: "Order Received — Hensley Print Co." },
      { property: "og:description", content: "We've got your order — here's what happens next." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ConfirmationPage,
});

function ConfirmationPage() {
  const { cart, lastOrderNumber, po, method, clearCart } = usePortalStore();
  const subtotal = cart.reduce((s, l) => s + l.lineTotal, 0);
  const artworkPending = cart.some((l) => l.artworkLater);

  return (
    <PortalPage title="Order received" description="Your order is with our team.">
      <Section>
        <div className="flex items-start gap-3">
          <CheckCircle2 className="mt-0.5 size-6 shrink-0 text-ok" aria-hidden />
          <div className="min-w-0">
            <p className="text-lg font-semibold">{lastOrderNumber ?? "SO-10684"}</p>
            <p className="text-[13px] text-muted-foreground">
              {po ? `PO ${po} · ` : ""}
              {method === "Ship" ? "Shipping to your warehouse" : "For pickup at our counter"} · {cart.length} item
              {cart.length === 1 ? "" : "s"} · <Money value={subtotal} />
            </p>
            <div className="mt-2">
              <StatusPill value={artworkPending ? "Awaiting Your Approval" : "Received"} />
            </div>
          </div>
        </div>

        <ol className="mt-5 space-y-3 border-t border-border pt-4 text-[13px]">
          <li className="grid grid-cols-[auto_minmax(0,1fr)] gap-3">
            <span className="grid size-6 place-items-center rounded-full bg-accent text-[12px] font-semibold">1</span>
            <span>
              <span className="font-medium">We review your files.</span>{" "}
              {artworkPending
                ? "We're holding this order until your artwork arrives — send it whenever you're ready."
                : "Our prepress team checks size, resolution and bleed."}
            </span>
          </li>
          <li className="grid grid-cols-[auto_minmax(0,1fr)] gap-3">
            <span className="grid size-6 place-items-center rounded-full bg-accent text-[12px] font-semibold">2</span>
            <span>
              <span className="font-medium">You approve a proof.</span> We&apos;ll email you and it will appear under Proofs.
            </span>
          </li>
          <li className="grid grid-cols-[auto_minmax(0,1fr)] gap-3">
            <span className="grid size-6 place-items-center rounded-full bg-accent text-[12px] font-semibold">3</span>
            <span>
              <span className="font-medium">We print, finish and ship.</span> Tracking appears on the order as each shipment leaves.
            </span>
          </li>
        </ol>

        <div className="mt-5 flex flex-wrap gap-2 border-t border-border pt-4">
          <Button asChild onClick={() => clearCart()}>
            <Link to="/portal/orders">View my orders</Link>
          </Button>
          <Button variant="outline" asChild onClick={() => clearCart()}>
            <Link to="/portal/shop">Start another order</Link>
          </Button>
        </div>
      </Section>
    </PortalPage>
  );
}
