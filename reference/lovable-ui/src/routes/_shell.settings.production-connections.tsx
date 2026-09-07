import { createFileRoute } from "@tanstack/react-router";
import { ConnectionCard, DeepLink, ReadyChip, Section, SettingsPage, Unavailable } from "@/components/app/settings/shared";
import { Button } from "@/components/ui/button";
import { connections } from "@/lib/mock/settings";

export const Route = createFileRoute("/_shell/settings/production-connections")({
  head: () => ({
    meta: [
      { title: "Production Connections — PrintersHero V2 Settings" },
      { name: "description", content: "Where external production integrations such as device bridges and RIP hot folders will appear once they are supported." },
      { property: "og:title", content: "Production Connections — PrintersHero V2 Settings" },
      { property: "og:description", content: "Integration readiness for the systems that connect PrintersHero to your equipment." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: ProductionConnectionsPage,
});

function ProductionConnectionsPage() {
  const items = connections.filter((c) => c.category === "Production");

  return (
    <SettingsPage
      title="Production Connections"
      description="External systems that connect PrintersHero to your equipment. Stations, route templates and production work stay in Production."
      actions={<ReadyChip state="not-configured" />}
    >
      <Unavailable>
        External production integrations will appear here when they are supported. Until then, production handoff is manual and
        nothing in the shop is blocked.
      </Unavailable>

      <Section title="Planned integrations" hint="Shown for reference only. None of these are connected.">
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

      <Section title="Configured elsewhere" hint="These belong to Production, not Settings.">
        <div className="flex flex-wrap gap-2">
          <DeepLink to="/production">Stations & devices</DeepLink>
          <DeepLink to="/routing">Route templates</DeepLink>
          <DeepLink to="/materials">Materials</DeepLink>
        </div>
      </Section>
    </SettingsPage>
  );
}
