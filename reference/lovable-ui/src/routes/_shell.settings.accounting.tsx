import { createFileRoute } from "@tanstack/react-router";
import { ConnectionCard, EmptyBlock, ReadyChip, Section, SettingsPage, Unavailable } from "@/components/app/settings/shared";
import { Button } from "@/components/ui/button";
import { connections } from "@/lib/mock/settings";

export const Route = createFileRoute("/_shell/settings/accounting")({
  head: () => ({
    meta: [
      { title: "Accounting — PrintersHero V2 Settings" },
      { name: "description", content: "Connect accounting systems such as QuickBooks Online and see the readiness of the connection." },
      { property: "og:title", content: "Accounting — PrintersHero V2 Settings" },
      { property: "og:description", content: "Accounting integration status for your organization." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: AccountingPage,
});

function AccountingPage() {
  const items = connections.filter((c) => c.category === "Accounting");
  return (
    <SettingsPage
      title="Accounting"
      description="Send invoices and payments to your accounting system instead of rekeying them."
      actions={<ReadyChip state="not-configured" />}
    >
      <Section title="Providers">
        <div className="grid gap-2">
          {items.map((c) => (
            <ConnectionCard
              key={c.name}
              name={c.name}
              status={c.status}
              detail={c.detail}
              badge={c.available ? undefined : "Not available yet"}
              actions={<Button size="sm" variant="outline" className="h-7 text-[12px]" disabled={!c.available}>Connect</Button>}
            />
          ))}
        </div>
      </Section>

      <Unavailable>
        Accounting connections are not available in this build. When they are, you will authorize your accounting provider directly
        and see the connected company name here.
      </Unavailable>

      <EmptyBlock
        title="No accounting integration is connected"
        body="Until an accounting system is connected, invoices and payments stay inside PrintersHero and must be entered into your books manually. Nothing else in the shop is blocked."
      />
    </SettingsPage>
  );
}
