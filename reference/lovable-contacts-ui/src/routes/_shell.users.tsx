import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { PageHeader, Panel, Status } from "@/components/app/primitives";
import { Switch } from "@/components/ui/switch";
import { useApp } from "@/lib/app-store";
import { permissionGroups, permissionSets } from "@/lib/mock/data";

export const Route = createFileRoute("/_shell/users")({
  head: () => ({
    meta: [
      { title: "Users & Permissions — PrintersHero V2" },
      { name: "description", content: "Granular permission sets for owners, sales reps, production managers and front desk staff." },
      { property: "og:title", content: "Users & Permissions — PrintersHero V2" },
      { property: "og:description", content: "Permission sets that map to how a print shop is actually staffed." },
    ],
  }),
  component: UsersPage,
});

function UsersPage() {
  const { grants, toggleGrant } = useApp();
  const [set, setSet] = useState(permissionSets[0]!.id);

  return (
    <div className="space-y-3 p-4">
      <PageHeader title="Users & Permissions" subtitle="Permission sets are assigned to staff and to portal customers." />
      <div className="grid gap-4 lg:grid-cols-[280px_minmax(0,1fr)]">
        <Panel title="Permission sets" dense>
          <ul className="divide-y divide-border">
            {permissionSets.map((p) => (
              <li key={p.id}>
                <button onClick={() => setSet(p.id)} className={`w-full px-3 py-2.5 text-left ${set === p.id ? "bg-accent" : "hover:bg-accent/60"}`}>
                  <div className="flex items-center justify-between"><span className="text-[13px] font-medium">{p.name}</span><Status value={p.active ? "Active" : "Inactive"} /></div>
                  <div className="text-[11px] text-muted-foreground">{p.users} users · {p.description}</div>
                </button>
              </li>
            ))}
          </ul>
        </Panel>

        <div className="grid gap-3 sm:grid-cols-2">
          {permissionGroups.map((g) => (
            <Panel key={g.group} title={g.group} dense>
              <ul className="divide-y divide-border">
                {g.items.map((item) => (
                  <li key={item} className="flex items-center justify-between px-3 py-1.5 text-[13px]">
                    <span>{item}</span>
                    <Switch checked={(grants[set] ?? []).includes(item)} onCheckedChange={() => toggleGrant(set, item)} />
                  </li>
                ))}
              </ul>
            </Panel>
          ))}
        </div>
      </div>
    </div>
  );
}
