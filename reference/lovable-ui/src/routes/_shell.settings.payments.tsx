import { createFileRoute } from "@tanstack/react-router";
import { CreditCard } from "lucide-react";
import { ConnectionCard, DeepLink, EmptyBlock, ReadyChip, Section, SettingsPage, Unavailable } from "@/components/app/settings/shared";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/_shell/settings/payments")({
  head: () => ({
    meta: [
      { title: "Payments — PrintersHero V2 Settings" },
      { name: "description", content: "Connect a payment provider so customers can pay invoices online, and see which payment methods are ready." },
      { property: "og:title", content: "Payments — PrintersHero V2 Settings" },
      { property: "og:description", content: "Payment provider connection and readiness." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: PaymentsPage,
});

function PaymentsPage() {
  return (
    <SettingsPage
      title="Payments"
      description="Connect the provider PrintersHero uses to accept customer payments. Recorded payments and refunds live in Billing, not here."
      actions={<ReadyChip state="not-configured" />}
    >
      <Section title="Payment provider">
        <EmptyBlock
          title="No payment provider is connected"
          body="Without a provider, staff can still record cash, check and outside card payments against invoices. Online payment from the customer portal requires a connected provider."
          action={<Button size="sm" className="h-8 gap-1.5 text-[12px]" disabled><CreditCard className="size-3.5" /> Connect provider (coming soon)</Button>}
        />
        <div className="mt-3">
          <Unavailable>
            Self-service provider connection is not available yet. When it is, you will connect your own account here — PrintersHero
            will never ask you to paste secret keys.
          </Unavailable>
        </div>
      </Section>

      <Section title="Payment methods">
        <div className="grid gap-2 sm:grid-cols-2">
          <ConnectionCard name="Card payments" status="not-configured" detail="Requires a connected provider." />
          <ConnectionCard name="ACH / bank transfer" status="not-configured" detail="Requires a connected provider." />
          <ConnectionCard name="Cash and check" status="ready" detail="Recorded manually against invoices." />
          <ConnectionCard name="Outside card terminal" status="ready" detail="Recorded manually with a reference." />
        </div>
      </Section>

      <Section title="Where payments live" hint="Settings owns the connection. Billing owns the money.">
        <div className="flex flex-wrap items-center gap-2">
          <DeepLink to="/payments">Open payment ledger</DeepLink>
          <DeepLink to="/invoices">Open invoices</DeepLink>
        </div>
      </Section>
    </SettingsPage>
  );
}
