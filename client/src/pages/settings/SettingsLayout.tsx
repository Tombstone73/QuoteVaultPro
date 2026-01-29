import * as React from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { TitanCard } from "@/components/titan";
import { PageHeader } from "@/components/titan";
import { useAuth } from "@/hooks/useAuth";
import { useTheme } from "@/hooks/useTheme";
import { useOrgPreferences } from "@/hooks/useOrgPreferences";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  useProductionLineItemStatusRules,
  useSaveProductionLineItemStatusRules,
  type ProductionLineItemStatusRule,
} from "@/hooks/useProductionSettings";
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
  Sliders,
  Mail,
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
    label: "Preferences", 
    path: "/settings/preferences", 
    icon: Sliders,
    description: "Workflow and behavior preferences"
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
    label: "Email Settings", 
    path: "/settings/email", 
    icon: Mail,
    description: "Email configuration for invoices and quotes"
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
  const { data, isLoading, isError, error } = useProductionLineItemStatusRules();
  const save = useSaveProductionLineItemStatusRules();
  const [draft, setDraft] = React.useState<ProductionLineItemStatusRule[]>([]);

  React.useEffect(() => {
    if (Array.isArray(data)) setDraft(data);
  }, [data]);

  const validation = React.useMemo(() => {
    const errors: string[] = [];
    const keys = new Set<string>();
    for (const r of draft) {
      const k = (r.id || r.key || "").trim();
      const label = (r.label || "").trim();
      if (!k) errors.push("Each status needs an id.");
      if (!label) errors.push("Each status needs a label.");
      if (k) {
        if (keys.has(k)) errors.push(`Duplicate id: ${k}`);
        keys.add(k);
      }
      if (r.sendToProduction) {
        const station = (r.stationKey || "").trim();
        if (!station) errors.push(`Status '${k || "(missing key)"}' routes to production but has no station.`);
      }
    }
    return { isValid: errors.length === 0, errors };
  }, [draft]);

  const setRule = (idx: number, patch: Partial<ProductionLineItemStatusRule>) => {
    setDraft((prev) => prev.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  };

  const addRule = () => {
    setDraft((prev) => [
      ...prev,
      {
        id: "",
        label: "",
        color: null,
        sendToProduction: false,
        stationKey: "flatbed",
        stepKey: "prepress",
        sortOrder: prev.length,
      },
    ]);
  };

  const removeRule = (idx: number) => {
    setDraft((prev) => prev.filter((_, i) => i !== idx));
  };

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
          <div className="flex items-center justify-between gap-3">
            <div>
              <h3 className="text-titan-md font-semibold text-titan-text-primary">Line Item Status Routing</h3>
              <p className="text-titan-sm text-titan-text-muted mt-1">
                Define the allowed line-item statuses and choose which statuses automatically create/update a production job.
              </p>
            </div>

            <div className="flex items-center gap-2">
              <Button variant="outline" onClick={addRule}>
                Add status
              </Button>
              <Button
                onClick={() => save.mutate(draft)}
                disabled={save.isPending || !validation.isValid}
              >
                {save.isPending ? "Saving…" : "Save"}
              </Button>
            </div>
          </div>

          {isLoading ? (
            <div className="flex items-center gap-2 text-titan-sm text-titan-text-muted">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading…
            </div>
          ) : isError ? (
            <div className="text-titan-sm text-red-600">{(error as any)?.message || "Failed to load"}</div>
          ) : null}

          {validation.errors.length > 0 ? (
            <div className="rounded-md border border-titan-border-subtle bg-titan-bg-subtle p-3 text-titan-sm text-titan-text-secondary">
              <div className="font-medium text-titan-text-primary">Fix these before saving:</div>
              <ul className="list-disc pl-5 mt-1 space-y-1">
                {Array.from(new Set(validation.errors)).slice(0, 6).map((e) => (
                  <li key={e}>{e}</li>
                ))}
              </ul>
            </div>
          ) : null}

          <div className="rounded-md border border-titan-border-subtle overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[180px]">ID</TableHead>
                  <TableHead>Label</TableHead>
                  <TableHead className="w-[140px]">Color</TableHead>
                  <TableHead className="w-[160px]">Send to Production</TableHead>
                  <TableHead className="w-[180px]">Station</TableHead>
                  <TableHead className="w-[180px]">Step</TableHead>
                  <TableHead className="w-[120px]">Sort</TableHead>
                  <TableHead className="w-[100px]"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {draft.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={8} className="text-titan-sm text-titan-text-muted">
                      No statuses configured yet. Add one to start.
                    </TableCell>
                  </TableRow>
                ) : (
                  draft.map((r, idx) => (
                    <TableRow key={`${idx}-${(r.id ?? r.key ?? "") as any}`.trim()}>
                      <TableCell>
                        <Input
                          value={(r.id ?? r.key ?? "") as any}
                          onChange={(e) => setRule(idx, { id: e.target.value })}
                          placeholder="prepress"
                        />
                      </TableCell>
                      <TableCell>
                        <Input
                          value={r.label ?? ""}
                          onChange={(e) => setRule(idx, { label: e.target.value })}
                          placeholder="Queued"
                        />
                      </TableCell>
                      <TableCell>
                        <Input
                          value={r.color ?? ""}
                          onChange={(e) => setRule(idx, { color: e.target.value || null })}
                          placeholder="blue"
                        />
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Switch
                            checked={r.sendToProduction === true}
                            onCheckedChange={(v) => setRule(idx, { sendToProduction: v })}
                          />
                          <span className="text-titan-sm text-titan-text-muted">
                            {r.sendToProduction ? "Yes" : "No"}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Select
                          value={(r.stationKey ?? "").trim() || "flatbed"}
                          onValueChange={(v) => setRule(idx, { stationKey: v })}
                          disabled={!r.sendToProduction}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Station" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="flatbed">Flatbed</SelectItem>
                          </SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell>
                        <Select
                          value={String((r.stepKey ?? r.defaultStepKey ?? "")).trim() || "prepress"}
                          onValueChange={(v) => setRule(idx, { stepKey: v })}
                          disabled={!r.sendToProduction}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Step" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="prepress">Prepress</SelectItem>
                            <SelectItem value="print">Print</SelectItem>
                            <SelectItem value="finish">Finish</SelectItem>
                          </SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell>
                        <Input
                          inputMode="numeric"
                          value={r.sortOrder ?? ""}
                          onChange={(e) => {
                            const raw = e.target.value;
                            if (!raw.trim()) return setRule(idx, { sortOrder: null });
                            const n = Number(raw);
                            setRule(idx, { sortOrder: Number.isFinite(n) ? n : r.sortOrder ?? null });
                          }}
                          placeholder="0"
                        />
                      </TableCell>
                      <TableCell>
                        <Button variant="outline" onClick={() => removeRule(idx)}>
                          Remove
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
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
            // Theme metadata currently tracks only basic info (id/label/isDark). Treat all themes as implemented.
            const disabled = false;
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

export function PreferencesSettings() {
  const {
    preferences,
    isLoading,
    updatePreferences,
    isUpdating,
    updateInventoryPolicy,
    isUpdatingInventoryPolicy,
  } = useOrgPreferences();

  type InventoryUiMode = "off" | "advisory" | "enforced";

  const toUiMode = (mode: any): InventoryUiMode => {
    if (mode === "enforced") return "enforced";
    if (mode === "advisory") return "advisory";
    // Back-compat: older stored values
    if (mode === "block_on_shortage") return "enforced";
    if (mode === "warn_only") return "advisory";
    return "off";
  };

  const enabledFromPrefs = toUiMode((preferences as any)?.inventoryPolicy?.mode) !== "off";
  const modeFromPrefs: InventoryUiMode = toUiMode((preferences as any)?.inventoryPolicy?.mode);

  const [inventoryEnabledDraft, setInventoryEnabledDraft] = React.useState<boolean>(enabledFromPrefs);
  const [inventoryModeDraft, setInventoryModeDraft] = React.useState<InventoryUiMode>(modeFromPrefs);

  React.useEffect(() => {
    setInventoryEnabledDraft(enabledFromPrefs);
    setInventoryModeDraft(modeFromPrefs);
  }, [enabledFromPrefs, modeFromPrefs]);
  
  const handleQuoteToggle = async (key: string, value: boolean) => {
    await updatePreferences({
      ...preferences,
      quotes: {
        ...preferences?.quotes,
        [key]: value,
      },
    });
  };
  
  const handleOrderToggle = async (key: string, value: boolean) => {
    await updatePreferences({
      ...preferences,
      orders: {
        ...preferences?.orders,
        [key]: value,
      },
    });
  };
  
  if (isLoading) {
    return (
      <TitanCard className="p-6">
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-titan-text-muted" />
        </div>
      </TitanCard>
    );
  }
  
  return (
    <TitanCard className="p-6">
      <div className="space-y-6">
        <div>
          <h2 className="text-titan-lg font-semibold text-titan-text-primary">Preferences</h2>
          <p className="text-titan-sm text-titan-text-secondary mt-1">
            Configure workflow behavior and system preferences
          </p>
        </div>
        
        <div className="h-px bg-titan-border-subtle" />
        
        {/* Quotes Section */}
        <div className="space-y-4">
          <div>
            <h3 className="text-titan-base font-medium text-titan-text-primary">Quotes</h3>
            <p className="text-titan-sm text-titan-text-muted mt-1">
              Control quote workflow behavior
            </p>
          </div>
          
          <div className="space-y-4">
            <div className="flex items-start justify-between gap-4 rounded-titan-lg border border-titan-border-subtle p-4">
              <div className="flex-1 space-y-1">
                <Label htmlFor="require-approval" className="text-titan-sm font-medium text-titan-text-primary cursor-pointer">
                  Require quote approval
                </Label>
                <p className="text-titan-xs text-titan-text-muted">
                  When enabled, quotes must be explicitly approved by an authorized user (Owner/Admin/Manager/Employee) before they can be sent to customers.
                </p>
              </div>
              <Switch
                id="require-approval"
                checked={preferences?.quotes?.requireApproval ?? false}
                onCheckedChange={(checked) => handleQuoteToggle('requireApproval', checked)}
                disabled={isUpdating}
              />
            </div>
          </div>
        </div>
        
        {/* Orders Section */}
        <div className="space-y-4">
          <div>
            <h3 className="text-titan-base font-medium text-titan-text-primary">Orders</h3>
            <p className="text-titan-sm text-titan-text-muted mt-1">
              Control order transition requirements
            </p>
          </div>
          
          <div className="space-y-4">
            <div className="flex items-start justify-between gap-4 rounded-titan-lg border border-titan-border-subtle p-4">
              <div className="flex-1 space-y-1">
                <Label htmlFor="require-due-date" className="text-titan-sm font-medium text-titan-text-primary cursor-pointer">
                  Require due date for production
                </Label>
                <p className="text-titan-xs text-titan-text-muted">
                  When enabled, orders must have a due date set before they can be moved to production status.
                </p>
              </div>
              <Switch
                id="require-due-date"
                checked={preferences?.orders?.requireDueDateForProduction ?? true}
                onCheckedChange={(checked) => handleOrderToggle('requireDueDateForProduction', checked)}
                disabled={isUpdating}
              />
            </div>
            
            <div className="flex items-start justify-between gap-4 rounded-titan-lg border border-titan-border-subtle p-4">
              <div className="flex-1 space-y-1">
                <Label htmlFor="require-billing" className="text-titan-sm font-medium text-titan-text-primary cursor-pointer">
                  Require billing address for production
                </Label>
                <p className="text-titan-xs text-titan-text-muted">
                  When enabled, orders must have billing information (name or company) before they can be moved to production status.
                </p>
              </div>
              <Switch
                id="require-billing"
                checked={preferences?.orders?.requireBillingAddressForProduction ?? true}
                onCheckedChange={(checked) => handleOrderToggle('requireBillingAddressForProduction', checked)}
                disabled={isUpdating}
              />
            </div>
            
            <div className="flex items-start justify-between gap-4 rounded-titan-lg border border-titan-border-subtle p-4">
              <div className="flex-1 space-y-1">
                <Label htmlFor="require-shipping" className="text-titan-sm font-medium text-titan-text-primary cursor-pointer">
                  Require shipping address for production
                </Label>
                <p className="text-titan-xs text-titan-text-muted">
                  When enabled, orders must have shipping information (name or company) before they can be moved to production status.
                </p>
              </div>
              <Switch
                id="require-shipping"
                checked={preferences?.orders?.requireShippingAddressForProduction ?? false}
                onCheckedChange={(checked) => handleOrderToggle('requireShippingAddressForProduction', checked)}
                disabled={isUpdating}
              />
            </div>

            <div className="flex items-start justify-between gap-4 rounded-titan-lg border border-titan-border-subtle p-4">
              <div className="flex-1 space-y-1">
                <Label htmlFor="require-line-items-done" className="text-titan-sm font-medium text-titan-text-primary cursor-pointer">
                  Require all line items done to complete production
                </Label>
                <p className="text-titan-xs text-titan-text-muted">
                  When enabled, every line item must be marked Done (or Canceled) before an order can be moved to Production Complete.
                </p>
              </div>
              <Switch
                id="require-line-items-done"
                checked={preferences?.orders?.requireAllLineItemsDoneToComplete ?? true}
                onCheckedChange={(checked) => handleOrderToggle('requireAllLineItemsDoneToComplete', checked)}
                disabled={isUpdating}
              />
            </div>
          </div>
        </div>

        {/* Inventory Reservations Section */}
        <div className="space-y-4">
          <div>
            <h3 className="text-titan-base font-medium text-titan-text-primary">Inventory Reservations</h3>
            <p className="text-titan-sm text-titan-text-muted mt-1">
              Off: reservation endpoints disabled. Advisory: reservations allowed; warnings only. Enforced (future): will block on shortages once availability checks are wired.
            </p>
          </div>

          <div className="space-y-4">
            <div className="flex items-start justify-between gap-4 rounded-titan-lg border border-titan-border-subtle p-4">
              <div className="flex-1 space-y-1">
                <Label htmlFor="inventory-reservations-enabled" className="text-titan-sm font-medium text-titan-text-primary cursor-pointer">
                  Enable inventory reservations
                </Label>
                <p className="text-titan-xs text-titan-text-muted">
                  Controls access to order reservation endpoints and related UI.
                </p>
              </div>
              <Switch
                id="inventory-reservations-enabled"
                checked={inventoryEnabledDraft}
                onCheckedChange={async (checked) => {
                  setInventoryEnabledDraft(checked);
                  const nextMode: InventoryUiMode = checked
                    ? (inventoryModeDraft === "off" ? "advisory" : inventoryModeDraft)
                    : "off";
                  setInventoryModeDraft(nextMode);
                  await updateInventoryPolicy({ mode: nextMode });
                }}
                disabled={isUpdatingInventoryPolicy}
              />
            </div>

            <div className="flex items-start justify-between gap-4 rounded-titan-lg border border-titan-border-subtle p-4">
              <div className="flex-1 space-y-1">
                <Label className="text-titan-sm font-medium text-titan-text-primary">Reservation mode</Label>
                <p className="text-titan-xs text-titan-text-muted">
                  Advisory is the recommended starting mode. Enforced is reserved for future stock-shortage blocking.
                </p>
              </div>
              <div className="w-[180px]">
                <Select
                  value={inventoryEnabledDraft ? inventoryModeDraft : "off"}
                  onValueChange={async (value) => {
                    const nextMode = value as InventoryUiMode;
                    setInventoryModeDraft(nextMode);

                    const nextEnabled = nextMode !== "off";
                    setInventoryEnabledDraft(nextEnabled);

                    await updateInventoryPolicy({ mode: nextMode });
                  }}
                  disabled={isUpdatingInventoryPolicy}
                >
                  <SelectTrigger className={cn("h-9", isUpdatingInventoryPolicy && "opacity-70")}
                    aria-label="Inventory reservation mode"
                  >
                    <SelectValue placeholder="Select mode" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="off">Off</SelectItem>
                    <SelectItem value="advisory">Advisory</SelectItem>
                    <SelectItem value="enforced">Enforced (future)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
        </div>
      </div>
    </TitanCard>
  );
}
