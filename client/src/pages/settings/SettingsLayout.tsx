import * as React from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { TitanCard } from "@/components/ui/TitanCard";
import { useAuth } from "@/hooks/useAuth";
import { useTheme } from "@/hooks/useTheme";

function Guard({ children }: React.PropsWithChildren<{}>) {
  const { user } = useAuth();
  const allowed = user && (user.role === "owner" || user.role === "admin");
  if (!allowed) return <div className="text-white/80">Access denied.</div>;
  return <>{children}</>;
}

function SettingsNav() {
  const location = useLocation();
  const items = [
    { label: "Company", path: "/settings/company" },
    { label: "Users & Roles", path: "/settings/users" },
    { label: "Product Catalog", path: "/settings/products" },
    { label: "Product Types", path: "/settings/product-types" },
    { label: "Pricing Formulas", path: "/settings/pricing-formulas" },
    { label: "Accounting & Integrations", path: "/settings/integrations" },
    { label: "Production & Operations", path: "/settings/production" },
    { label: "Inventory & Procurement", path: "/settings/inventory" },
    { label: "Notifications", path: "/settings/notifications" },
    { label: "Appearance / Themes", path: "/settings/appearance" },
  ];
  return (
    <div className="w-64 space-y-1 shrink-0">
      {items.map((i) => {
        const active = location.pathname === i.path || (i.path === "/settings/company" && location.pathname === "/settings");
        return (
          <NavLink
            key={i.path}
            to={i.path}
            className={`block rounded-md px-3 py-2 text-sm hover:bg-white/5 hover:text-white ${active ? "bg-white/10 text-white" : "text-white/70"}`}
          >
            {i.label}
          </NavLink>
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
        <div className="flex-1 min-w-0">
          <Outlet />
        </div>
      </div>
    </Guard>
  );
}

// Placeholder components for settings sub-pages
export function CompanySettings() {
  return (
    <TitanCard className="p-6">
      <h2 className="text-xl font-semibold mb-2">Company Settings</h2>
      <p className="text-muted-foreground">Company settings (placeholder)</p>
    </TitanCard>
  );
}

export function UsersSettings() {
  return (
    <TitanCard className="p-6">
      <h2 className="text-xl font-semibold mb-2">Users & Roles</h2>
      <p className="text-muted-foreground">Users & Roles (placeholder)</p>
    </TitanCard>
  );
}

export function AccountingSettings() {
  return (
    <TitanCard className="p-6">
      <h2 className="text-xl font-semibold mb-2">Accounting & Integrations</h2>
      <p className="text-muted-foreground">QuickBooks UI goes here</p>
    </TitanCard>
  );
}

export function ProductionSettings() {
  return (
    <TitanCard className="p-6">
      <h2 className="text-xl font-semibold mb-2">Production & Operations</h2>
      <p className="text-muted-foreground">Production & Operations (placeholder)</p>
    </TitanCard>
  );
}

export function InventorySettings() {
  return (
    <TitanCard className="p-6">
      <h2 className="text-xl font-semibold mb-2">Inventory & Procurement</h2>
      <p className="text-muted-foreground">Inventory & Procurement (placeholder)</p>
    </TitanCard>
  );
}

export function NotificationsSettings() {
  return (
    <TitanCard className="p-6">
      <h2 className="text-xl font-semibold mb-2">Notifications</h2>
      <p className="text-muted-foreground">Notifications (placeholder)</p>
    </TitanCard>
  );
}

export function AppearanceSettings() {
  const { theme, setTheme, availableThemes, getMeta } = useTheme();
  return (
    <TitanCard className="p-6">
      <div className="space-y-6">
        <h2 className="text-xl font-semibold">Appearance / Themes</h2>
        <p className="text-sm text-muted-foreground">Select a theme. Stored locally for now; will sync to profile later.</p>
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
                <div className="mb-2 font-medium">{meta.label}</div>
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
                  <span className="absolute top-2 right-2 rounded bg-white/10 border border-white/10 px-2 py-1 text-xs text-muted-foreground">Coming Soon</span>
                )}
              </button>
            );
          })}
        </div>
      </div>
    </TitanCard>
  );
}
