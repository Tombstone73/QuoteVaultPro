import * as React from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { TitanCard } from "@/components/titan";
import { PageHeader } from "@/components/titan";
import { useAuth } from "@/hooks/useAuth";
import { useTheme } from "@/hooks/useTheme";
import { cn } from "@/lib/utils";
import {
  Settings,
  Users,
  Package,
  Tag,
  DollarSign,
  Factory,
  Boxes,
  Bell,
  Palette,
  PlugZap,
  type LucideIcon,
} from "lucide-react";

function Guard({ children }: React.PropsWithChildren<{}>) {
  const { user } = useAuth();
  const allowed = user && (user.role === "owner" || user.role === "admin");
  if (!allowed) {
    return (
      <div className="min-h-screen bg-titan-bg-app p-6">
        <TitanCard className="p-6">
          <p className="text-titan-text-secondary">Access denied. Settings are only available to Owners and Admins.</p>
        </TitanCard>
      </div>
    );
  }
  return <>{children}</>;
}

type SettingsNavItem = {
  label: string;
  path: string;
  icon: LucideIcon;
  description?: string;
};

const SETTINGS_NAV_ITEMS: SettingsNavItem[] = [
  { 
    label: "Company", 
    path: "/settings/company", 
    icon: Settings,
    description: "Company info and defaults"
  },
  { 
    label: "Users & Roles", 
    path: "/settings/users", 
    icon: Users,
    description: "User management and permissions"
  },
  { 
    label: "Product Catalog", 
    path: "/settings/products", 
    icon: Package,
    description: "Products and pricing"
  },
  { 
    label: "Product Types", 
    path: "/settings/product-types", 
    icon: Tag,
    description: "Product categories and types"
  },
  { 
    label: "Pricing Formulas", 
    path: "/settings/pricing-formulas", 
    icon: DollarSign,
    description: "Pricing calculation rules"
  },
  { 
    label: "Accounting & Integrations", 
    path: "/settings/integrations", 
    icon: PlugZap,
    description: "QuickBooks and other integrations"
  },
  { 
    label: "Production & Operations", 
    path: "/settings/production", 
    icon: Factory,
    description: "Production workflow settings"
  },
  { 
    label: "Inventory & Procurement", 
    path: "/settings/inventory", 
    icon: Boxes,
    description: "Inventory and vendor settings"
  },
  { 
    label: "Notifications", 
    path: "/settings/notifications", 
    icon: Bell,
    description: "Email and notification preferences"
  },
  { 
    label: "Appearance / Themes", 
    path: "/settings/appearance", 
    icon: Palette,
    description: "UI theme and visual preferences"
  },
];

function SettingsNav() {
  const location = useLocation();
  
  return (
    <TitanCard className="p-3 h-fit sticky top-6">
      <div className="space-y-0.5">
        {SETTINGS_NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const active = 
            location.pathname === item.path || 
            (item.path === "/settings/company" && location.pathname === "/settings");
          
          return (
            <NavLink
              key={item.path}
              to={item.path}
              className={cn(
                "flex items-center gap-3 rounded-titan-md px-3 py-2 text-sm font-medium transition-colors w-full",
                "hover:bg-titan-bg-card-elevated",
                active
                  ? "bg-titan-accent text-white"
                  : "text-titan-text-secondary hover:text-titan-text-primary"
              )}
            >
              <Icon className="h-4 w-4 shrink-0" />
              <span className="truncate">{item.label}</span>
            </NavLink>
          );
        })}
      </div>
    </TitanCard>
  );
}

export function SettingsLayout() {
  return (
    <Guard>
      <div className="min-h-screen bg-titan-bg-app p-6">
        <PageHeader
          title="Settings"
          subtitle="Configure TitanOS, your account, and integrations"
        />
        
        <div className="grid grid-cols-1 lg:grid-cols-[260px_1fr] gap-6 mt-6">
          {/* Left: Settings Navigation */}
          <SettingsNav />
          
          {/* Right: Settings Content */}
          <div className="min-w-0">
            <Outlet />
          </div>
        </div>
      </div>
    </Guard>
  );
}

// Placeholder components for settings sub-pages
export function CompanySettings() {
  return (
    <TitanCard className="p-6">
      <div className="space-y-6">
        <div>
          <h2 className="text-titan-lg font-semibold text-titan-text-primary">Company Settings</h2>
          <p className="text-titan-sm text-titan-text-secondary mt-1">
            Configure your company information, defaults, and general preferences
          </p>
        </div>
        
        <div className="h-px bg-titan-border-subtle" />
        
        <div className="space-y-4">
          <p className="text-titan-sm text-titan-text-muted">
            Company settings UI will be implemented here
          </p>
        </div>
      </div>
    </TitanCard>
  );
}

export function UsersSettings() {
  return (
    <TitanCard className="p-6">
      <div className="space-y-6">
        <div>
          <h2 className="text-titan-lg font-semibold text-titan-text-primary">Users & Roles</h2>
          <p className="text-titan-sm text-titan-text-secondary mt-1">
            Manage user accounts, roles, and permissions
          </p>
        </div>
        
        <div className="h-px bg-titan-border-subtle" />
        
        <div className="space-y-4">
          <p className="text-titan-sm text-titan-text-muted">
            User management UI will be implemented here
          </p>
        </div>
      </div>
    </TitanCard>
  );
}

export function AccountingSettings() {
  return (
    <TitanCard className="p-6">
      <div className="space-y-6">
        <div>
          <h2 className="text-titan-lg font-semibold text-titan-text-primary">Accounting & Integrations</h2>
          <p className="text-titan-sm text-titan-text-secondary mt-1">
            Connect QuickBooks and manage accounting integrations
          </p>
        </div>
        
        <div className="h-px bg-titan-border-subtle" />
        
        <div className="space-y-4">
          <p className="text-titan-sm text-titan-text-muted">
            QuickBooks integration UI will be implemented here
          </p>
        </div>
      </div>
    </TitanCard>
  );
}

export function ProductionSettings() {
  return (
    <TitanCard className="p-6">
      <div className="space-y-6">
        <div>
          <h2 className="text-titan-lg font-semibold text-titan-text-primary">Production & Operations</h2>
          <p className="text-titan-sm text-titan-text-secondary mt-1">
            Configure production workflow and operational settings
          </p>
        </div>
        
        <div className="h-px bg-titan-border-subtle" />
        
        <div className="space-y-4">
          <p className="text-titan-sm text-titan-text-muted">
            Production settings UI will be implemented here
          </p>
        </div>
      </div>
    </TitanCard>
  );
}

export function InventorySettings() {
  return (
    <TitanCard className="p-6">
      <div className="space-y-6">
        <div>
          <h2 className="text-titan-lg font-semibold text-titan-text-primary">Inventory & Procurement</h2>
          <p className="text-titan-sm text-titan-text-secondary mt-1">
            Manage inventory settings and procurement preferences
          </p>
        </div>
        
        <div className="h-px bg-titan-border-subtle" />
        
        <div className="space-y-4">
          <p className="text-titan-sm text-titan-text-muted">
            Inventory settings UI will be implemented here
          </p>
        </div>
      </div>
    </TitanCard>
  );
}

export function NotificationsSettings() {
  return (
    <TitanCard className="p-6">
      <div className="space-y-6">
        <div>
          <h2 className="text-titan-lg font-semibold text-titan-text-primary">Notifications</h2>
          <p className="text-titan-sm text-titan-text-secondary mt-1">
            Configure email and notification preferences
          </p>
        </div>
        
        <div className="h-px bg-titan-border-subtle" />
        
        <div className="space-y-4">
          <p className="text-titan-sm text-titan-text-muted">
            Notification settings UI will be implemented here
          </p>
        </div>
      </div>
    </TitanCard>
  );
}

export function AppearanceSettings() {
  const { theme, setTheme, availableThemes, getMeta } = useTheme();
  return (
    <TitanCard className="p-6">
      <div className="space-y-6">
        <div>
          <h2 className="text-titan-lg font-semibold text-titan-text-primary">Appearance / Themes</h2>
          <p className="text-titan-sm text-titan-text-secondary mt-1">
            Select a theme. Stored locally for now; will sync to profile later.
          </p>
        </div>
        
        <div className="h-px bg-titan-border-subtle" />
        
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
                className={cn(
                  "relative rounded-titan-lg border border-titan-border-subtle px-4 py-4 text-left transition-all",
                  "hover:bg-titan-bg-card-elevated hover:border-titan-accent/50",
                  "focus:outline-none focus-visible:ring-2 focus-visible:ring-titan-accent",
                  active && "ring-2 ring-titan-accent border-titan-accent",
                  disabled && "opacity-60 cursor-not-allowed hover:bg-transparent hover:border-titan-border-subtle"
                )}
              >
                <div className="mb-3 font-medium text-titan-text-primary text-titan-sm">
                  {meta.label}
                </div>
                <div
                  className="h-20 rounded-titan-md border border-titan-border-subtle"
                  style={{
                    background: "linear-gradient(to bottom right, var(--app-card-gradient-start), var(--app-card-gradient-end))",
                    boxShadow: "var(--app-card-shadow)"
                  }}
                />
                {active && (
                  <span className="absolute top-2 right-2 rounded-titan-sm bg-titan-accent px-2 py-1 text-[10px] font-semibold text-white">
                    Active
                  </span>
                )}
                {disabled && !active && (
                  <span className="absolute top-2 right-2 rounded-titan-sm bg-titan-bg-card-elevated border border-titan-border-subtle px-2 py-1 text-[10px] font-medium text-titan-text-muted">
                    Coming Soon
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>
    </TitanCard>
  );
}
