import { createFileRoute } from "@tanstack/react-router";
import { ConnectionCard, DeepLink, ReadyChip, Section, SettingsPage, Unavailable } from "@/components/app/settings/shared";
import { Button } from "@/components/ui/button";
import { connections } from "@/lib/mock/settings";

export const Route = createFileRoute("/_shell/settings/shipping")({
  head: () => ({
    meta: [
      { title: "Shipping & Carriers — PrintersHero V2 Settings" },
      { name: "description", content: "Carrier connection readiness for shipped work. Manual fulfillment is available today." },
      { property: "og:title", content: "Shipping & Carriers — PrintersHero V2 Settings" },
      { property: "og:description", content: "Carrier integrations and current shipping capability." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: ShippingPage,
});

function ShippingPage() {
  const items = connections.filter((c) => c.category === "Shipping");
  return (
    <SettingsPage
      title="Shipping & Carriers"
      description="Manual fulfillment is available today. Carrier integrations can be configured here when they are supported."
      actions={<ReadyChip state="optional" />}
    >
      <div className="panel flex flex-wrap items-center justify-between gap-3 px-3 py-2.5">
        <div className="text-[12px] text-muted-foreground">
          <div className="text-[13px] font-medium text-foreground">Manual shipping is ready</div>
          Staff enter carrier, service and tracking when a shipment goes out.
        </div>
        <DeepLink to="/shipping">Open Shipping</DeepLink>
      </div>

      <Section title="Carrier connections">
        <div className="grid gap-2">
          {items.map((c) => (
            <ConnectionCard
              key={c.name}
              name={c.name}
              status={c.status}
              detail={c.detail}
              badge="Not available yet"
              actions={<Button size="sm" variant="outline" className="h-7 text-[12px]" disabled>Connect</Button>}
            />
          ))}
        </div>
      </Section>

      <Unavailable>
        Carrier accounts, negotiated rates and label purchase are not part of this build. Nothing here is connected to a live
        carrier account.
      </Unavailable>
    </SettingsPage>
  );
}
