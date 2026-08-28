import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Plus, ShieldCheck } from "lucide-react";
import { AuditLine, ReadyChip, Section, SettingsPage } from "@/components/app/settings/shared";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { capabilityGroups, settingsPermissionSets } from "@/lib/mock/settings";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_shell/settings/permission-sets")({
  head: () => ({
    meta: [
      { title: "Permission Sets — PrintersHero V2 Settings" },
      { name: "description", content: "Reusable access profiles for sales, production, billing and administration staff." },
      { property: "og:title", content: "Permission Sets — PrintersHero V2 Settings" },
      { property: "og:description", content: "Grant access by role instead of hundreds of individual switches." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: PermissionSetsPage,
});

function PermissionSetsPage() {
  const [editing, setEditing] = useState<string | null>(null);
  const active = settingsPermissionSets.find((p) => p.id === editing);

  return (
    <SettingsPage
      title="Permission Sets"
      description="Each staff member is assigned one permission set. Editing a set changes access for everyone assigned to it."
      actions={<Button size="sm" className="h-8 gap-1.5 text-[12px]"><Plus className="size-3.5" /> New permission set</Button>}
    >
      <div className="space-y-2">
        {settingsPermissionSets.map((p) => (
          <div key={p.id} className={cn("panel flex flex-wrap items-center justify-between gap-3 p-3", editing === p.id && "border-primary")}>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-[13px] font-semibold">{p.name}</span>
                <span className="rounded border border-border px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                  {p.system ? "System" : "Custom"}
                </span>
                {p.floor && <ReadyChip state="ready" label="Full access" />}
              </div>
              <p className="mt-0.5 text-[12px] text-muted-foreground">{p.users} {p.users === 1 ? "user" : "users"} · {p.summary}</p>
            </div>
            <Button size="sm" variant="outline" className="h-7 text-[12px]" onClick={() => setEditing(editing === p.id ? null : p.id)}>
              {editing === p.id ? "Close" : "Edit"}
            </Button>
          </div>
        ))}
      </div>

      {active && (
        <Section title={`Editing · ${active.name}`} hint={`${active.users} ${active.users === 1 ? "person uses" : "people use"} this set today.`}>
          {active.floor && (
            <div className="mb-3 flex items-start gap-2 rounded-lg border border-border bg-surface-2/60 px-3 py-2.5 text-[12px]">
              <ShieldCheck className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
              <span>
                Administrator always keeps full access, including Settings and permissions. Your organization must always have at
                least one administrator, so these capabilities cannot be turned off.
              </span>
            </div>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            {capabilityGroups.map((g) => (
              <div key={g.group} className="panel overflow-hidden">
                <div className="border-b border-border bg-surface-2 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  {g.group}
                </div>
                <ul className="divide-y divide-border">
                  {g.items.map((item) => (
                    <li key={item} className="flex items-center justify-between px-3 py-1.5 text-[13px]">
                      <span>{item}</span>
                      <Switch defaultChecked={active.floor || active.name.toLowerCase().startsWith(g.group.toLowerCase().split(" ")[0] ?? "")} disabled={active.floor} />
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
          <div className="mt-3 flex items-center justify-between gap-2 border-t border-border pt-3">
            <AuditLine>Last changed by Dale Hensley · Aug 6, 2026</AuditLine>
            <div className="flex gap-2">
              <Button variant="ghost" size="sm" className="h-8 text-[12px]" onClick={() => setEditing(null)}>Cancel</Button>
              <Button size="sm" className="h-8 text-[12px]" onClick={() => setEditing(null)}>Save changes</Button>
            </div>
          </div>
        </Section>
      )}
    </SettingsPage>
  );
}
