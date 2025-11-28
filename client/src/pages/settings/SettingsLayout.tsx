import * as React from "react";
import { Link, Route, Switch, useLocation } from "wouter";
import { TitanCard } from "@/components/ui/TitanCard";
import { useAuth } from "@/hooks/useAuth";
import { useTheme } from "@/hooks/useTheme";
import { THEMES } from "@/hooks/useTheme";

function Guard({ children }: React.PropsWithChildren<{}>) {
  const { user } = useAuth();
  const allowed = user && (user.role === "owner" || user.role === "admin");
  if (!allowed) return <div className="text-white/80">Access denied.</div>;
  return <>{children}</>;
}

function SettingsNav() {
  const [loc] = useLocation();
  const items = [
    { label: "Company", path: "/settings/company" },
    { label: "Users & Roles", path: "/settings/users" },
    { label: "Accounting & Integrations", path: "/settings/accounting" },
    { label: "Production & Operations", path: "/settings/production" },
    { label: "Inventory & Procurement", path: "/settings/inventory" },
    { label: "Notifications", path: "/settings/notifications" },
    { label: "Appearance / Themes", path: "/settings/appearance" },
  ];
  return (
    <div className="w-64 space-y-1">
      {items.map((i) => {
        const active = loc === i.path;
        return (
          <Link key={i.path} href={i.path}>
            <a className={`block rounded-md px-3 py-2 text-sm text-white/80 hover:bg-white/5 hover:text-white ${active ? "bg-white/10 text-white" : ""}`}>{i.label}</a>
          </Link>
        );
      })}
    </div>
  );
}

export function SettingsLayout() {
  return (
    <Guard>
      <div className="flex gap-6">
        <SettingsNav />
        <div className="flex-1">
          <TitanCard className="p-6 text-white/80">
            <Switch>
              <Route path="/settings" component={CompanySettings} />
              <Route path="/settings/company" component={CompanySettings} />
              <Route path="/settings/users" component={UsersSettings} />
              <Route path="/settings/accounting" component={AccountingSettings} />
              <Route path="/settings/production" component={ProductionSettings} />
              <Route path="/settings/inventory" component={InventorySettings} />
              <Route path="/settings/notifications" component={NotificationsSettings} />
              <Route path="/settings/appearance" component={AppearanceSettings} />
              <Route>Not Found</Route>
            </Switch>
          </TitanCard>
        </div>
      </div>
    </Guard>
  );
}

export function CompanySettings() { return <div>Company settings (placeholder)</div>; }
export function UsersSettings() { return <div>Users & Roles (placeholder)</div>; }
export function AccountingSettings() { return <div>Accounting & Integrations (QuickBooks UI goes here)</div>; }
export function ProductionSettings() { return <div>Production & Operations (placeholder)</div>; }
export function InventorySettings() { return <div>Inventory & Procurement (placeholder)</div>; }
export function NotificationsSettings() { return <div>Notifications (placeholder)</div>; }
export function AppearanceSettings() {
  const { theme, setTheme, availableThemes, getMeta } = useTheme();
  return (
    <div className="space-y-6">
      <h2 className="text-xl font-semibold text-white">Appearance / Themes</h2>
      <p className="text-sm text-white/60">Select a theme. Stored locally for now; will sync to profile later.</p>
      <div className="grid gap-4 md:grid-cols-2">
        {availableThemes.map((t) => {
          const active = t === theme;
          const meta = getMeta(t)!;
          const disabled = !meta.implemented;
          return (
            <button
              key={t}
              onClick={() => !disabled && setTheme(t)}
              disabled={disabled}
              className={`relative rounded-lg border px-4 py-4 text-left text-sm transition hover:bg-white/5 ${active ? "ring-2 ring-blue-500" : ""} ${disabled ? "opacity-60 cursor-not-allowed" : ""}`}
              style={{ borderColor: "var(--app-card-border-color)" }}
            >
              <div className="mb-2 font-medium text-white/80">{meta.label}</div>
              <div
                className="h-20 rounded-md border"
                style={{
                  background: "linear-gradient(to bottom right, var(--app-card-gradient-start), var(--app-card-gradient-end))",
                  borderColor: "var(--app-card-border-color)",
                  boxShadow: "var(--app-card-shadow)"
                }}
              />
              {active && <span className="absolute top-2 right-2 rounded bg-blue-600 px-2 py-1 text-xs text-white">Active</span>}
              {disabled && !active && (
                <span className="absolute top-2 right-2 rounded bg-white/10 border border-white/10 px-2 py-1 text-xs text-white/70">Coming Soon</span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
