import { Outlet, createFileRoute, useNavigate, useRouterState, Link } from "@tanstack/react-router";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_shell/settings")({
  component: SettingsLayout,
});

export const NAV: { group: string; items: { to: string; label: string }[] }[] = [
  { group: "", items: [{ to: "/settings", label: "Overview" }] },
  { group: "Organization", items: [
    { to: "/settings/business-profile", label: "Business Profile" },
    { to: "/settings/documents", label: "Documents & Branding" },
    { to: "/settings/numbering", label: "Numbering" },
  ] },
  { group: "Team & Access", items: [
    { to: "/settings/staff", label: "Staff & Users" },
    { to: "/settings/permission-sets", label: "Permission Sets" },
    { to: "/settings/portal-access", label: "Customer Portal Access" },
  ] },
  { group: "Sales", items: [{ to: "/settings/sales-tax", label: "Sales Tax" }] },
  { group: "Communications", items: [{ to: "/settings/email", label: "Email Delivery" }] },
  { group: "Billing & Payments", items: [
    { to: "/settings/invoice-defaults", label: "Invoice Defaults" },
    { to: "/settings/payments", label: "Payments" },
  ] },
  { group: "Integrations", items: [
    { to: "/settings/accounting", label: "Accounting" },
    { to: "/settings/shipping", label: "Shipping & Carriers" },
    { to: "/settings/production-connections", label: "Production Connections" },
  ] },
  { group: "My Preferences", items: [
    { to: "/settings/preferences", label: "Appearance" },
    { to: "/settings/notifications", label: "Notifications" },
  ] },
];

function SettingsLayout() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const navigate = useNavigate();
  const flat = NAV.flatMap((g) => g.items);

  return (
    <div className="flex min-h-full flex-col lg:flex-row">
      <nav className="hidden w-[212px] shrink-0 border-r border-border bg-surface-2/40 py-3 lg:block">
        {NAV.map((g) => (
          <div key={g.group || "root"} className="px-2 pb-2">
            {g.group && (
              <div className="px-2 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{g.group}</div>
            )}
            {g.items.map((it) => {
              const active = it.to === "/settings" ? pathname === "/settings" : pathname.startsWith(it.to);
              return (
                <Link
                  key={it.to}
                  to={it.to}
                  className={cn(
                    "mb-0.5 block rounded-md px-2 py-1.5 text-[13px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground",
                    active && "bg-primary/12 font-medium text-primary",
                  )}
                >
                  {it.label}
                </Link>
              );
            })}
          </div>
        ))}
      </nav>

      <div className="border-b border-border p-3 lg:hidden">
        <label className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground" htmlFor="settings-nav">Settings section</label>
        <select
          id="settings-nav"
          className="mt-1 h-9 w-full rounded-md border border-border bg-surface px-2 text-[13px]"
          value={flat.find((i) => (i.to === "/settings" ? pathname === "/settings" : pathname.startsWith(i.to)))?.to ?? "/settings"}
          onChange={(e) => navigate({ to: e.target.value })}
        >
          {NAV.map((g) => (
            <optgroup key={g.group || "root"} label={g.group || "Settings"}>
              {g.items.map((i) => <option key={i.to} value={i.to}>{i.label}</option>)}
            </optgroup>
          ))}
        </select>
      </div>

      <div className="min-w-0 flex-1">
        <Outlet />
      </div>
    </div>
  );
}
