import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { RefreshCw, Unplug } from "lucide-react";
import { ConnectionCard, DeepLink, ReadyChip, Section, SettingsPage, Unavailable } from "@/components/app/settings/shared";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { connections } from "@/lib/mock/settings";

export const Route = createFileRoute("/_shell/settings/production-connections")({
  head: () => ({
    meta: [
      { title: "Production Connections — PrintersHero V2 Settings" },
      { name: "description", content: "External production connections such as the local device bridge and RIP hot folders." },
      { property: "og:title", content: "Production Connections — PrintersHero V2 Settings" },
      { property: "og:description", content: "Status of the systems that connect PrintersHero to your equipment." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: ProductionConnectionsPage,
});

function ProductionConnectionsPage() {
  const items = connections.filter((c) => c.category === "Production");
  const [disconnect, setDisconnect] = useState<string | null>(null);

  return (
    <SettingsPage
      title="Production Connections"
      description="External systems that connect PrintersHero to your equipment. Stations, route templates and production work stay in Production."
      actions={<ReadyChip state="attention" />}
    >
      <Section title="Connections">
        <div className="grid gap-2">
          {items.map((c) => (
            <ConnectionCard
              key={c.name}
              name={c.name}
              status={c.status}
              detail={c.detail}
              actions={
                <>
                  {c.status === "error" && <Button size="sm" className="h-7 gap-1.5 text-[12px]"><RefreshCw className="size-3.5" /> Retry</Button>}
                  <Button size="sm" variant="outline" className="h-7 gap-1.5 text-[12px]" onClick={() => setDisconnect(c.name)}>
                    <Unplug className="size-3.5" /> Disconnect
                  </Button>
                </>
              }
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

      <Unavailable>Additional production integrations will appear here as they are supported.</Unavailable>

      <Dialog open={disconnect !== null} onOpenChange={(o) => !o && setDisconnect(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Disconnect {disconnect}?</DialogTitle>
            <DialogDescription>
              Work will keep flowing, but handoff to this system becomes manual until it is reconnected.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={() => setDisconnect(null)}>Cancel</Button>
            <Button variant="destructive" size="sm" onClick={() => setDisconnect(null)}>Disconnect</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </SettingsPage>
  );
}
