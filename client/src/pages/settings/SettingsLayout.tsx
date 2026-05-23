import * as React from "react";
import { Link, NavLink, Outlet, useLocation } from "react-router-dom";
import { TitanCard } from "@/components/titan";
import { PageHeader } from "@/components/titan";
import { useAuth } from "@/hooks/useAuth";
import { useTheme } from "@/hooks/useTheme";
import { useOrgPreferences } from "@/hooks/useOrgPreferences";
import { useLowStockAlerts } from "@/hooks/useMaterials";
import { useVendors } from "@/hooks/useVendors";
import { MaterialsSettingsPanel } from "@/features/materials/MaterialsSettingsPanel";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
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
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { AlertTriangle, ChevronDown, CircleHelp, Loader2, Ticket } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  useProductionLineItemStatusRules,
  useProductionStationSteps,
  useProductionStations,
  useSaveProductionLineItemStatusRules,
  type ProductionLineItemStatusRule,
} from "@/hooks/useProductionSettings";
import { StationStepEditor } from "@/components/production/StationStepEditor";
import { JobStatusSettings } from "@/components/job-status-settings";
import { InvoiceRemindersTab } from "@/components/admin-settings";
import {
  useOrderWorkflow,
  usePublishOrderWorkflow,
  useSaveOrderWorkflowDraft,
} from "@/hooks/useOrders";
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
  HardDrive,
  Wrench,
  Hash,
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
    label: "Storage",
    path: "/settings/storage",
    icon: HardDrive,
    description: "Canonical storage routing and provider status"
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
  {
    label: "System Setup",
    path: "/settings/setup",
    icon: Hash,
    description: "System initialization: document numbering sequences",
  },
  {
    label: "Admin Tools",
    path: "/settings/admin-tools",
    icon: Wrench,
    description: "Data portability and system administration"
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
          subtitle="Configure Printers Hero, your account, and integrations"
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

type WorkflowDraftRow = {
  key: string;
  label: string;
  category: "new" | "active" | "ready" | "completed" | "canceled" | "on_hold";
  color?: string | null;
  sortOrder: number;
  isDefaultForNew: boolean;
  isActive: boolean;
};

type StationOption = {
  key: string;
  name: string;
};

type StationStepLike = {
  key: string;
  active?: boolean | null;
};

const normalizeWorkflowKey = (value: string) => value.trim().toLowerCase();

function getRoutingRulesWarningCount(
  routingRules: ProductionLineItemStatusRule[],
  stations: StationOption[],
  stationSteps: Record<string, StationStepLike[]> | undefined,
): number {
  const stationKeys = new Set(stations.map((station) => station.key));

  return routingRules.filter((rule) => {
    if (rule.sendToProduction !== true) return false;

    const stationKey = String(rule.stationKey ?? "").trim();
    if (!stationKey || !stationKeys.has(stationKey)) {
      return true;
    }

    const stepKey = String(rule.stepKey ?? rule.defaultStepKey ?? "").trim();
    if (!stepKey) return false;

    const stepsForStation = stationSteps?.[stationKey] ?? [];
    const step = stepsForStation.find((candidate) => String(candidate.key ?? "").trim() === stepKey);
    return !step || step.active === false;
  }).length;
}

function getWorkflowEditorWarningCount(
  stations: StationOption[],
  stationSteps: Record<string, StationStepLike[]> | undefined,
  routingRules: ProductionLineItemStatusRule[],
): number {
  const stationKeys = new Set(stations.map((station) => station.key));
  let issues = 0;

  for (const rule of routingRules) {
    if (rule.sendToProduction !== true) continue;

    const stationKey = String(rule.stationKey ?? "").trim();
    const stepKey = String(rule.stepKey ?? rule.defaultStepKey ?? "").trim();
    if (!stationKey || !stepKey || !stationKeys.has(stationKey)) continue;

    const stepsForStation = stationSteps?.[stationKey] ?? [];
    const step = stepsForStation.find((candidate) => String(candidate.key ?? "").trim() === stepKey);
    if (!step || step.active === false) {
      issues += 1;
    }
  }

  for (const station of stations) {
    const duplicateKeys = new Set<string>();
    const seenKeys = new Set<string>();
    const stepsForStation = stationSteps?.[station.key] ?? [];

    for (const step of stepsForStation) {
      const key = String(step.key ?? "").trim();
      if (!key) continue;
      if (seenKeys.has(key)) {
        duplicateKeys.add(key);
      } else {
        seenKeys.add(key);
      }
    }

    issues += duplicateKeys.size;
  }

  return issues;
}

function getCustomerStatusesWarningCount(statuses: WorkflowDraftRow[]): number {
  const seenKeys = new Set<string>();
  const duplicateKeys = new Set<string>();

  for (const status of statuses) {
    const key = normalizeWorkflowKey(status.key);
    if (!key) continue;
    if (seenKeys.has(key)) {
      duplicateKeys.add(key);
    } else {
      seenKeys.add(key);
    }
  }

  return duplicateKeys.size;
}

function InlineHelp({ label }: { label: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          className="inline-flex h-4 w-4 items-center justify-center rounded-sm text-titan-text-muted transition-colors hover:text-titan-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-titan-accent"
          aria-label={label}
        >
          <CircleHelp className="h-3.5 w-3.5" />
        </button>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs text-xs leading-5">
        {label}
      </TooltipContent>
    </Tooltip>
  );
}

function SectionLabel({ title, help }: { title: string; help?: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <span>{title}</span>
      {help ? <InlineHelp label={help} /> : null}
    </div>
  );
}

function ProductionSettingsSection({
  title,
  summary,
  help,
  defaultOpen,
  warningCount = 0,
  actions,
  children,
}: React.PropsWithChildren<{
  title: string;
  summary: string;
  help?: string;
  defaultOpen?: boolean;
  warningCount?: number;
  actions?: React.ReactNode;
}>) {
  const [open, setOpen] = React.useState(Boolean(defaultOpen || warningCount > 0));

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <div className="rounded-titan-lg border border-titan-border-subtle bg-transparent overflow-hidden">
        <div className={cn(
          "flex flex-wrap items-start gap-3 px-4 py-3",
          warningCount > 0 && "bg-amber-50/40"
        )}>
          <CollapsibleTrigger asChild>
            <button
              type="button"
              className="flex min-w-0 flex-1 items-start gap-3 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-titan-accent rounded-titan-md"
              aria-label={`${open ? "Collapse" : "Expand"} ${title}`}
            >
              <ChevronDown className={cn("mt-0.5 h-4 w-4 shrink-0 text-titan-text-muted transition-transform", open && "rotate-180")} />
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-titan-md font-semibold text-titan-text-primary">{title}</h3>
                  {help ? <InlineHelp label={help} /> : null}
                </div>
                <div className="mt-1 text-xs text-titan-text-muted">{summary}</div>
              </div>
            </button>
          </CollapsibleTrigger>

          <div className="ml-auto flex shrink-0 items-center gap-2">
            {warningCount > 0 ? (
              <Badge variant="outline" className="h-5 min-w-5 px-1.5 border-amber-300 bg-amber-100 text-amber-900">
                <AlertTriangle className="mr-1 h-3 w-3" />
                {warningCount}
              </Badge>
            ) : null}
            {actions && open ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
          </div>
        </div>

        <CollapsibleContent>
          <div className="border-t border-titan-border-subtle px-4 py-4">
            {children}
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}

const dedupeWorkflowStatuses = (statuses: Array<{
  key: string;
  label: string;
  category: WorkflowDraftRow["category"];
  color?: string | null;
  sortOrder: number;
  isDefaultForNew: boolean;
  isActive: boolean;
}>) => {
  const byKey = new Map<string, WorkflowDraftRow>();
  const removedKeys = new Set<string>();

  for (const status of [...statuses].sort((a, b) => a.sortOrder - b.sortOrder)) {
    const key = normalizeWorkflowKey(status.key);
    if (!key) continue;

    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, {
        key,
        label: status.label,
        category: status.category,
        color: status.color ?? null,
        sortOrder: status.sortOrder,
        isDefaultForNew: status.isDefaultForNew,
        isActive: status.isActive,
      });
      continue;
    }

    removedKeys.add(key);
    byKey.set(key, {
      ...existing,
      label: existing.label || status.label,
      color: existing.color ?? status.color ?? null,
      sortOrder: Math.min(existing.sortOrder, status.sortOrder),
      isDefaultForNew: existing.isDefaultForNew || status.isDefaultForNew,
      isActive: existing.isActive || status.isActive,
    });
  }

  return {
    statuses: Array.from(byKey.values()).sort((a, b) => a.sortOrder - b.sortOrder || a.label.localeCompare(b.label)),
    removedKeys: Array.from(removedKeys.values()),
  };
};

export function ProductionSettings() {
  const { data, isLoading, isError, error } = useProductionLineItemStatusRules();
  const {
    data: stations,
    isLoading: isStationsLoading,
    isError: isStationsError,
    error: stationsError,
  } = useProductionStations();
  const {
    data: stationSteps,
    isLoading: isStepsLoading,
    isError: isStepsError,
    error: stepsError,
  } = useProductionStationSteps();
  const save = useSaveProductionLineItemStatusRules();
  const {
    preferences,
    updatePreferences,
    isLoading: isOrgPreferencesLoading,
    isUpdating: isOrgPreferencesUpdating,
  } = useOrgPreferences();
  const [draft, setDraft] = React.useState<ProductionLineItemStatusRule[]>([]);
  const [disclaimerDraft, setDisclaimerDraft] = React.useState(
    preferences.proofing?.defaultProofDisclaimerText ?? ""
  );
  React.useEffect(() => {
    setDisclaimerDraft(preferences.proofing?.defaultProofDisclaimerText ?? "");
  }, [preferences.proofing?.defaultProofDisclaimerText]);
  const savedDisclaimer = preferences.proofing?.defaultProofDisclaimerText ?? "";
  const workflow = useOrderWorkflow();
  const saveWorkflowDraft = useSaveOrderWorkflowDraft();
  const publishWorkflow = usePublishOrderWorkflow();
  const [workflowDraft, setWorkflowDraft] = React.useState<WorkflowDraftRow[]>([]);

  React.useEffect(() => {
    if (Array.isArray(data)) setDraft(data);
  }, [data]);

  React.useEffect(() => {
    if (workflow.data?.statuses) {
      setWorkflowDraft(
        dedupeWorkflowStatuses(
          workflow.data.statuses.map((s) => ({
            key: s.key,
            label: s.label,
            category: s.category,
            color: s.color ?? null,
            sortOrder: s.sortOrder,
            isDefaultForNew: s.isDefaultForNew,
            isActive: s.isActive,
          })),
        ).statuses,
      );
    }
  }, [workflow.data]);

  const collapsedWorkflowKeys = React.useMemo(() => {
    if (!workflow.data?.statuses) return [] as string[];
    return dedupeWorkflowStatuses(
      workflow.data.statuses.map((s) => ({
        key: s.key,
        label: s.label,
        category: s.category,
        color: s.color ?? null,
        sortOrder: s.sortOrder,
        isDefaultForNew: s.isDefaultForNew,
        isActive: s.isActive,
      })),
    ).removedKeys;
  }, [workflow.data]);

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
        const stepKey = String((r.stepKey ?? r.defaultStepKey ?? "")).trim();
        if (stepKey && station && !isStepsLoading && !isStepsError) {
          const stationStepList = stationSteps?.[station] ?? [];
          const match = stationStepList.find((step) => step.key === stepKey);
          if (!match) {
            errors.push(`Status '${k || "(missing key)"}' references missing step '${stepKey}' for station '${station}'.`);
          } else if (match.active === false) {
            errors.push(`Status '${k || "(missing key)"}' references inactive step '${stepKey}' for station '${station}'.`);
          }
        }
      }
    }
    return { isValid: errors.length === 0, errors };
  }, [draft, stationSteps, isStepsLoading, isStepsError]);

  const stationOptions = React.useMemo(() => {
    const list = Array.isArray(stations) ? stations : [];
    return list
      .map((s) => ({ key: String(s.key ?? "").trim(), name: String(s.name ?? s.key ?? "").trim() }))
      .filter((s) => s.key.length > 0);
  }, [stations]);

  const stationLoadError = isStationsError
    ? ((stationsError as any)?.message || "Unable to load stations")
    : null;

  const stepLoadError = isStepsError
    ? ((stepsError as any)?.message || "Unable to load managed steps")
    : null;

  const stationCards = React.useMemo(() => {
    return stationOptions.map((station) => {
      const steps = stationSteps?.[station.key] ?? [];
      const activeSteps = steps.filter((step) => step.active !== false);
      return {
        ...station,
        steps,
        activeSteps,
        defaultStepLabel: activeSteps[0]?.label ?? "Queued",
      };
    });
  }, [stationOptions, stationSteps]);

  const setRule = (idx: number, patch: Partial<ProductionLineItemStatusRule>) => {
    setDraft((prev) => prev.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  };

  const setRuleStation = (idx: number, stationKey: string) => {
    const activeSteps = (stationSteps?.[stationKey] ?? []).filter((step) => step.active !== false);
    setDraft((prev) =>
      prev.map((r, i) =>
        i === idx
          ? {
              ...r,
              stationKey,
              stepKey: activeSteps.some((step) => step.key === r.stepKey) ? r.stepKey : activeSteps[0]?.key ?? null,
            }
          : r,
      ),
    );
  };

  const toggleRuleRouting = (idx: number, enabled: boolean) => {
    setDraft((prev) =>
      prev.map((r, i) => {
        if (i !== idx) return r;
        const nextStationKey = (r.stationKey ?? "").trim() || stationOptions[0]?.key || "flatbed";
        const activeSteps = (stationSteps?.[nextStationKey] ?? []).filter((step) => step.active !== false);
        return {
          ...r,
          sendToProduction: enabled,
          stationKey: enabled ? nextStationKey : null,
          stepKey: enabled ? (activeSteps.some((step) => step.key === r.stepKey) ? r.stepKey : activeSteps[0]?.key ?? null) : null,
        };
      }),
    );
  };

  const addRule = () => {
    setDraft((prev) => [
      ...prev,
      {
        id: "",
        label: "",
        color: null,
        sendToProduction: false,
        stationKey: stationOptions[0]?.key ?? "flatbed",
        stepKey: (stationSteps?.[stationOptions[0]?.key ?? "flatbed"] ?? []).find((step) => step.active !== false)?.key ?? null,
        sortOrder: prev.length * 10 + 10,
      },
    ]);
  };

  const removeRule = (idx: number) => {
    setDraft((prev) => prev.filter((_, i) => i !== idx));
  };

  const setWorkflowRule = (idx: number, patch: Partial<(typeof workflowDraft)[number]>) => {
    setWorkflowDraft((prev) => prev.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  };

  const addWorkflowRule = () => {
    setWorkflowDraft((prev) => [
      ...prev,
      {
        key: "",
        label: "",
        category: "active",
        color: null,
        sortOrder: prev.length * 10 + 10,
        isDefaultForNew: prev.length === 0,
        isActive: true,
      },
    ]);
  };

  const removeWorkflowRule = (idx: number) => {
    setWorkflowDraft((prev) => prev.filter((_, i) => i !== idx));
  };

  const prepressDefaultEnabled = (preferences as any)?.prepressDefaultEnabled ?? true;

  const handlePrepressDefaultToggle = async (enabled: boolean) => {
    await updatePreferences({
      ...preferences,
      prepressDefaultEnabled: enabled,
    });
  };

  const workflowValidation = React.useMemo(() => {
    const errors: string[] = [];
    const keys = new Set<string>();
    for (const row of workflowDraft) {
      const key = row.key.trim().toLowerCase();
      if (!key) errors.push("Each order status requires a key.");
      if (!row.label.trim()) errors.push("Each order status requires a label.");
      if (key) {
        if (keys.has(key)) errors.push(`Duplicate order status key: ${key}`);
        keys.add(key);
      }
    }
    if (workflowDraft.length > 0 && !workflowDraft.some((r) => r.isDefaultForNew)) {
      errors.push("At least one order status must be marked as default for new orders.");
    }
    return { isValid: errors.length === 0, errors };
  }, [workflowDraft]);

  const routingRules = React.useMemo(
    () => [...draft].sort((a, b) => Number(a.sortOrder ?? 0) - Number(b.sortOrder ?? 0) || String(a.label ?? "").localeCompare(String(b.label ?? ""))),
    [draft],
  );

  const routingWarningCount = React.useMemo(
    () => getRoutingRulesWarningCount(routingRules, stationOptions, stationSteps),
    [routingRules, stationOptions, stationSteps],
  );

  const workflowWarningCount = React.useMemo(
    () => getWorkflowEditorWarningCount(stationOptions, stationSteps, routingRules),
    [stationOptions, stationSteps, routingRules],
  );

  const workflowStatuses = React.useMemo(
    () => [...workflowDraft].sort((a, b) => a.sortOrder - b.sortOrder || a.label.localeCompare(b.label)),
    [workflowDraft],
  );

  const statusWarningCount = React.useMemo(
    () => getCustomerStatusesWarningCount(workflowDraft),
    [workflowDraft],
  );

  const orderCategoryOptions: WorkflowDraftRow["category"][] = ["new", "active", "ready", "on_hold", "completed", "canceled"];
  const workflowEditorSummary = React.useMemo(() => {
    if (stationCards.length === 0) return "No active stations";
    const preview = stationCards.slice(0, 3).map((station) => `${station.name}: ${station.activeSteps.length} steps`);
    const overflow = stationCards.length - preview.length;
    return overflow > 0 ? `${preview.join(", ")} +${overflow} more` : preview.join(", ");
  }, [stationCards]);
  const routingRulesSummary = React.useMemo(() => {
    if (routingRules.length === 0) return "No routing rules configured";
    return `${routingRules.length} rule${routingRules.length === 1 ? "" : "s"}, ${routingWarningCount} invalid`;
  }, [routingRules, routingWarningCount]);
  const customerStatusesSummary = React.useMemo(() => {
    const activeCount = workflowStatuses.filter((row) => row.isActive).length;
    return `${activeCount} active status${activeCount === 1 ? "" : "es"}`;
  }, [workflowStatuses]);
  const initialRoutingSummary = prepressDefaultEnabled ? "Default route: Prepress first" : "Default route: Direct to production";

  return (
    <TooltipProvider delayDuration={150}>
    <TitanCard className="p-6">
      <div className="space-y-6">
        <div>
          <h2 className="text-titan-lg font-semibold text-titan-text-primary">Production & Operations</h2>
          <p className="text-titan-sm text-titan-text-secondary mt-1">
            Configure production workflow and operational settings
          </p>
        </div>
        
        <div className="h-px bg-titan-border-subtle" />

        <ProductionSettingsSection
          title="Initial Production Routing"
          summary={initialRoutingSummary}
          help="Sets the organization-wide default intake path. Product-level rules can still override this."
          defaultOpen={true}
        >
          <div className="flex items-start justify-between gap-4 rounded-titan-lg border border-titan-border-subtle p-4">
            <div className="flex-1 space-y-1">
              <Label htmlFor="prepress-default-enabled" className="text-titan-sm font-medium text-titan-text-primary cursor-pointer">
                Default: Send all production to Prepress first
              </Label>
              <p className="text-titan-xs text-titan-text-muted">
                When enabled, new production routing starts at prepress unless the product type override explicitly skips it.
              </p>
            </div>
            <Switch
              id="prepress-default-enabled"
              checked={prepressDefaultEnabled}
              onCheckedChange={handlePrepressDefaultToggle}
              disabled={isOrgPreferencesLoading || isOrgPreferencesUpdating}
            />
          </div>
        </ProductionSettingsSection>

        <ProductionSettingsSection
          title="Ticket Printing"
          summary="Print a sample ticket to verify this station's printer"
          help="Tickets print through the normal browser/Windows print dialog. Use the test ticket to confirm the Epson TM-L90 (or other ticket printer) is selected and aligned."
        >
          <div className="flex items-start justify-between gap-4 rounded-titan-lg border border-titan-border-subtle p-4">
            <div className="flex-1 space-y-1">
              <Label className="text-titan-sm font-medium text-titan-text-primary">
                Test ticket
              </Label>
              <p className="text-titan-xs text-titan-text-muted">
                Opens a sample ticket with mock data so you can confirm printer setup
                without touching a real production job.
              </p>
            </div>
            <Button
              variant="outline"
              className="gap-1.5"
              onClick={() => window.open("/production/jobs/sample/ticket", "_blank")}
            >
              <Ticket className="h-4 w-4" /> Print Test Ticket
            </Button>
          </div>
        </ProductionSettingsSection>

        <ProductionSettingsSection
          title="Job Workflow Statuses"
          summary="Production job status labels used by active job records"
          help="This is the canonical editor for job_statuses and jobs.statusKey. It replaces the legacy Admin Settings workflow tab."
        >
          <JobStatusSettings />
        </ProductionSettingsSection>

        <ProductionSettingsSection
          title="Workflow Editor"
          summary={workflowEditorSummary}
          help="Defines how jobs move through each production station after a production job is created."
          warningCount={workflowWarningCount}
        >
          <div className="space-y-4">

          {stationLoadError ? (
            <div className="text-xs text-red-600">Unable to load stations: {stationLoadError}</div>
          ) : null}

          {stepLoadError ? (
            <div className="text-xs text-red-600">Unable to load steps: {stepLoadError}</div>
          ) : null}

          <div className="space-y-4">
            {stationCards.length === 0 ? (
              <div className="rounded-md border border-titan-border-subtle p-4 text-sm text-titan-text-muted">
                No active stations were found.
              </div>
            ) : (
              stationCards.map((station) => (
                <StationStepEditor
                  key={station.key}
                  stationKey={station.key}
                  stationLabel={station.name}
                  steps={station.steps}
                  isLoading={isStepsLoading}
                />
              ))
            )}
          </div>
          </div>
        </ProductionSettingsSection>

        <div className="h-px bg-titan-border-subtle" />

        <ProductionSettingsSection
          title="Routing Rules"
          summary={routingRulesSummary}
          help="Controls which internal line-item statuses create or move production jobs, and which station step they start in."
          defaultOpen={true}
          warningCount={routingWarningCount}
          actions={
            <>
              <Button variant="outline" onClick={addRule}>Add routing rule</Button>
              <Button onClick={() => save.mutate(draft)} disabled={save.isPending || !validation.isValid}>
                {save.isPending ? "Saving…" : "Save"}
              </Button>
            </>
          }
        >
          <div className="space-y-4">

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
          <div className="space-y-3">
            {routingRules.length === 0 ? (
              <div className="rounded-md border border-titan-border-subtle p-4 text-sm text-titan-text-muted">
                No routing rules configured yet. Add a rule to define when a line item should enter production.
              </div>
            ) : (
              routingRules.map((r) => {
                const idx = draft.findIndex((row) => row === r);
                const selectedStationKey = (r.stationKey ?? "").trim() || stationOptions[0]?.key || "";
                const allStationSteps = stationSteps?.[selectedStationKey] ?? [];
                const activeStationSteps = allStationSteps.filter((step) => step.active !== false);
                const selectedStepKey = String((r.stepKey ?? r.defaultStepKey ?? "")).trim();
                const selectedStepMeta = allStationSteps.find((step) => step.key === selectedStepKey) ?? null;
                const hasMissingStep = !!selectedStepKey && !selectedStepMeta;
                const hasInactiveStep = !!selectedStepMeta && selectedStepMeta.active === false;

                return (
                  <div key={`${idx}-${(r.id ?? r.key ?? "") as any}`.trim()} className="rounded-titan-lg border border-titan-border-subtle p-4 space-y-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="text-sm font-semibold text-titan-text-primary">{r.label?.trim() || "New routing rule"}</div>
                        <div className="text-xs text-titan-text-muted">Internal line-item status trigger</div>
                      </div>
                      <Button variant="outline" onClick={() => removeRule(idx)}>Remove</Button>
                    </div>

                    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                      <div className="space-y-2">
                        <Label><SectionLabel title="Internal Trigger Status" help="The internal line-item status that should create or move a production job when reached." /></Label>
                        <Input value={(r.id ?? r.key ?? "") as any} onChange={(e) => setRule(idx, { id: e.target.value })} placeholder="prepress" />
                      </div>
                      <div className="space-y-2">
                        <Label>Label</Label>
                        <Input value={r.label ?? ""} onChange={(e) => setRule(idx, { label: e.target.value })} placeholder="Sent to Prepress" />
                      </div>
                      <div className="space-y-2">
                        <Label>Color</Label>
                        <Input value={r.color ?? ""} onChange={(e) => setRule(idx, { color: e.target.value || null })} placeholder="blue" />
                      </div>
                      <div className="space-y-2">
                        <Label>Sort Order</Label>
                        <Input
                          inputMode="numeric"
                          value={r.sortOrder ?? ""}
                          onChange={(e) => {
                            const raw = e.target.value;
                            if (!raw.trim()) return setRule(idx, { sortOrder: null });
                            const n = Number(raw);
                            setRule(idx, { sortOrder: Number.isFinite(n) ? n : r.sortOrder ?? null });
                          }}
                          placeholder="10"
                        />
                      </div>
                    </div>

                    <div className="rounded-md bg-titan-bg-subtle p-4 space-y-4">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <div className="text-sm font-medium text-titan-text-primary">Production intake</div>
                          <div className="text-xs text-titan-text-muted">Turn this on only when this status should create or move a production job.</div>
                        </div>
                        <div className="flex items-center gap-2">
                          <Switch checked={r.sendToProduction === true} onCheckedChange={(v) => toggleRuleRouting(idx, v)} />
                          <span className="text-sm text-titan-text-muted">{r.sendToProduction ? "Enabled" : "Disabled"}</span>
                        </div>
                      </div>

                      <div className="grid gap-4 md:grid-cols-2">
                        <div className="space-y-2">
                          <Label><SectionLabel title="Destination Station" help="Which production station should receive the job when this rule fires." /></Label>
                          <Select
                            value={selectedStationKey || undefined}
                            onValueChange={(value) => setRuleStation(idx, value)}
                            disabled={!r.sendToProduction || isStationsLoading || !!stationLoadError || stationOptions.length === 0}
                          >
                            <SelectTrigger>
                              <SelectValue placeholder="Select station" />
                            </SelectTrigger>
                            <SelectContent>
                              {stationOptions.map((station) => (
                                <SelectItem key={station.key} value={station.key}>{station.name}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>

                        <div className="space-y-2">
                          <Label><SectionLabel title="Starting Step" help="The first managed step to place the job in for the selected station. Leave queued fallback if no specific step is needed." /></Label>
                          <Select
                            value={selectedStepKey || "__none__"}
                            onValueChange={(value) => setRule(idx, { stepKey: value === "__none__" ? null : value })}
                            disabled={!r.sendToProduction || isStepsLoading || !selectedStationKey}
                          >
                            <SelectTrigger>
                              <SelectValue placeholder="queued (fallback)" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="__none__">queued (fallback)</SelectItem>
                              {activeStationSteps.map((step) => (
                                <SelectItem key={step.key} value={step.key}>{step.label}</SelectItem>
                              ))}
                              {(hasMissingStep || hasInactiveStep) && selectedStepKey ? (
                                <SelectItem value={selectedStepKey}>
                                  {hasInactiveStep ? `${selectedStepMeta?.label ?? selectedStepKey} (inactive)` : `${selectedStepKey} (missing)`}
                                </SelectItem>
                              ) : null}
                            </SelectContent>
                          </Select>
                        </div>
                      </div>

                      {(hasMissingStep || hasInactiveStep) && r.sendToProduction ? (
                        <Badge variant="destructive" className="text-[11px]">
                          {hasInactiveStep ? "Selected step is inactive" : "Selected step is missing"}
                        </Badge>
                      ) : null}
                    </div>
                  </div>
                );
              })
            )}
          </div>
          </div>
        </ProductionSettingsSection>

          <div className="h-px bg-titan-border-subtle" />

        <ProductionSettingsSection
          title="Customer Order Statuses"
          summary={customerStatusesSummary}
          help="Customer-facing order statuses only. These do not control production routing."
          warningCount={statusWarningCount}
          actions={
            <>
              <Button variant="outline" onClick={addWorkflowRule}>Add status</Button>
              <Button
                variant="outline"
                onClick={() => saveWorkflowDraft.mutate({ statuses: workflowDraft })}
                disabled={saveWorkflowDraft.isPending || !workflowValidation.isValid}
              >
                {saveWorkflowDraft.isPending ? "Saving…" : "Save Draft"}
              </Button>
              <Button
                onClick={() => publishWorkflow.mutate()}
                disabled={publishWorkflow.isPending}
              >
                {publishWorkflow.isPending ? "Publishing…" : "Publish"}
              </Button>
            </>
          }
        >
          <div className="space-y-4">

            {workflow.isLoading ? (
              <div className="flex items-center gap-2 text-titan-sm text-titan-text-muted">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading workflow…
              </div>
            ) : workflow.isError ? (
              <div className="text-titan-sm text-red-600">{(workflow.error as any)?.message || "Failed to load order workflow"}</div>
            ) : null}

            {collapsedWorkflowKeys.length > 0 ? (
              <div className="rounded-md border border-titan-border-subtle bg-titan-bg-subtle p-3 text-titan-sm text-titan-text-secondary">
                Collapsed duplicate status keys from the current workflow: {collapsedWorkflowKeys.join(", ")}
              </div>
            ) : null}

            {workflowValidation.errors.length > 0 ? (
              <div className="rounded-md border border-titan-border-subtle bg-titan-bg-subtle p-3 text-titan-sm text-titan-text-secondary">
                <div className="font-medium text-titan-text-primary">Fix these before saving draft:</div>
                <ul className="list-disc pl-5 mt-1 space-y-1">
                  {Array.from(new Set(workflowValidation.errors)).slice(0, 6).map((e) => (
                    <li key={e}>{e}</li>
                  ))}
                </ul>
              </div>
            ) : null}

            <div className="rounded-md border border-titan-border-subtle overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[170px]">Key</TableHead>
                    <TableHead>Label</TableHead>
                    <TableHead className="w-[140px]">Category</TableHead>
                    <TableHead className="w-[120px]">Default</TableHead>
                    <TableHead className="w-[120px]">Active</TableHead>
                    <TableHead className="w-[100px]">Sort</TableHead>
                    <TableHead className="w-[100px]"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {workflowDraft.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={7} className="text-titan-sm text-titan-text-muted">
                        No order statuses configured.
                      </TableCell>
                    </TableRow>
                  ) : (
                    workflowStatuses.map((r) => {
                      const idx = workflowDraft.findIndex((row) => row === r);
                      return (
                      <TableRow key={`${r.key}-${idx}`}>
                        <TableCell>
                          <Input
                            value={r.key}
                            onChange={(e) => setWorkflowRule(idx, { key: normalizeWorkflowKey(e.target.value) })}
                            placeholder="in_production"
                          />
                        </TableCell>
                        <TableCell>
                          <Input
                            value={r.label}
                            onChange={(e) => setWorkflowRule(idx, { label: e.target.value })}
                            placeholder="In Production"
                          />
                        </TableCell>
                        <TableCell>
                          <Select
                            value={r.category}
                            onValueChange={(v: any) => setWorkflowRule(idx, { category: v })}
                          >
                            <SelectTrigger>
                              <SelectValue placeholder="Category" />
                            </SelectTrigger>
                            <SelectContent>
                                {orderCategoryOptions.map((option) => (
                                  <SelectItem key={option} value={option}>{option}</SelectItem>
                                ))}
                            </SelectContent>
                          </Select>
                        </TableCell>
                        <TableCell>
                          <Switch
                            checked={r.isDefaultForNew}
                            onCheckedChange={(v) => {
                              if (!v) {
                                setWorkflowRule(idx, { isDefaultForNew: false });
                                return;
                              }
                              setWorkflowDraft((prev) => prev.map((row, i) => ({ ...row, isDefaultForNew: i === idx })));
                            }}
                          />
                        </TableCell>
                        <TableCell>
                          <Switch
                            checked={r.isActive}
                            onCheckedChange={(v) => setWorkflowRule(idx, { isActive: v })}
                          />
                        </TableCell>
                        <TableCell>
                          <Input
                            inputMode="numeric"
                            value={r.sortOrder}
                            onChange={(e) => setWorkflowRule(idx, { sortOrder: Number(e.target.value || 0) })}
                          />
                        </TableCell>
                        <TableCell>
                          <Button variant="outline" onClick={() => removeWorkflowRule(idx)}>Remove</Button>
                        </TableCell>
                      </TableRow>
                    );
                  })
                  )}
                </TableBody>
              </Table>
            </div>
          </div>
            </ProductionSettingsSection>

          <div className="h-px bg-titan-border-subtle" />

          <ProductionSettingsSection
            title="Proof Defaults"
            summary="Default disclaimer text shown to customers on every proof review page"
          >
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="proof-disclaimer">Default proof disclaimer</Label>
                <p className="text-xs text-titan-text-muted">
                  Shown below the proof specs on the customer portal for every proof sent. Leave blank to show no disclaimer.
                </p>
                <Textarea
                  id="proof-disclaimer"
                  rows={4}
                  value={disclaimerDraft}
                  onChange={(e) => setDisclaimerDraft(e.target.value)}
                  placeholder="e.g. Please review all text, colors, and dimensions carefully before approving. Approved proofs will proceed to production without further review."
                  disabled={isOrgPreferencesUpdating}
                />
              </div>
              <Button
                size="sm"
                onClick={() =>
                  updatePreferences({
                    ...preferences,
                    proofing: {
                      ...preferences.proofing,
                      defaultProofDisclaimerText: disclaimerDraft.trim() || undefined,
                    },
                  })
                }
                disabled={isOrgPreferencesUpdating || disclaimerDraft.trim() === savedDisclaimer.trim()}
              >
                {isOrgPreferencesUpdating ? "Saving…" : "Save"}
              </Button>
            </div>
          </ProductionSettingsSection>
        </div>
    </TitanCard>
    </TooltipProvider>
  );
}

export function InventorySettings() {
  const { data: lowStockMaterials = [] } = useLowStockAlerts();
  const { data: vendors = [] } = useVendors({ isActive: undefined });

  return (
    <div className="space-y-6">
      <TitanCard className="p-6">
        <div className="space-y-4">
          <div>
            <h2 className="text-titan-lg font-semibold text-titan-text-primary">Inventory & Procurement</h2>
            <p className="mt-1 text-titan-sm text-titan-text-secondary">
              Permanent admin home for material catalog, supplier assignments, stock thresholds, and purchasing follow-through.
            </p>
          </div>

          <div className="grid gap-3 md:grid-cols-3">
            <div className="rounded-titan-md border border-titan-border-subtle bg-titan-bg-card-elevated p-4">
              <p className="text-xs uppercase tracking-wide text-titan-text-muted">Materials Needing Attention</p>
              <p className="mt-2 text-2xl font-semibold text-titan-text-primary">{lowStockMaterials.length}</p>
              <p className="mt-1 text-sm text-titan-text-secondary">Materials at or below their configured reorder threshold.</p>
            </div>
            <div className="rounded-titan-md border border-titan-border-subtle bg-titan-bg-card-elevated p-4">
              <p className="text-xs uppercase tracking-wide text-titan-text-muted">Suppliers</p>
              <p className="mt-2 text-2xl font-semibold text-titan-text-primary">{vendors.length}</p>
              <p className="mt-1 text-sm text-titan-text-secondary">Vendor records available for preferred supplier assignments and purchasing.</p>
            </div>
            <div className="rounded-titan-md border border-titan-border-subtle bg-titan-bg-card-elevated p-4">
              <p className="text-xs uppercase tracking-wide text-titan-text-muted">Quick Create Guardrail</p>
              <p className="mt-2 text-sm text-titan-text-primary">Product-level “Add material” remains a shortcut only.</p>
              <p className="mt-1 text-sm text-titan-text-secondary">Full inventory and procurement data must be completed here, not in product setup.</p>
            </div>
          </div>
        </div>
      </TitanCard>

      <TitanCard className="p-6">
        <div className="mb-4 space-y-1">
          <h3 className="text-base font-semibold text-titan-text-primary">Materials</h3>
          <p className="text-sm text-titan-text-secondary">
            Create, edit, activate, deactivate, and adjust permanent material records without leaving settings.
          </p>
        </div>
        <MaterialsSettingsPanel />
      </TitanCard>

      <div className="grid gap-6 lg:grid-cols-2">
        <TitanCard className="p-6">
          <div className="space-y-3">
            <div>
              <h3 className="text-base font-semibold text-titan-text-primary">Suppliers / Purchasing</h3>
              <p className="mt-1 text-sm text-titan-text-secondary">
                Vendor records and purchase orders remain the permanent homes for supplier management and purchasing workflows.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button asChild variant="outline" size="sm">
                <Link to="/vendors">Open Vendors</Link>
              </Button>
              <Button asChild variant="outline" size="sm">
                <Link to="/purchase-orders">Open Purchase Orders</Link>
              </Button>
            </div>
          </div>
        </TitanCard>

        <TitanCard className="p-6">
          <div className="space-y-3">
            <div>
              <h3 className="text-base font-semibold text-titan-text-primary">Reorder Rules</h3>
              <p className="mt-1 text-sm text-titan-text-secondary">
                Reorder behavior currently derives from each material’s on-hand quantity and minimum stock alert. There is no separate archived or reorder-workflow state in the current schema.
              </p>
            </div>
            <p className="text-sm text-titan-text-muted">
              Use the Materials section above to maintain stock quantity, reorder threshold, vendor SKU, vendor cost, and preferred supplier.
            </p>
          </div>
        </TitanCard>
      </div>
    </div>
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
          <InvoiceRemindersTab />
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

  const materialsOverrideInProductionEnabled = (preferences as any)?.production?.materialsOverrideMode !== "prepress_only";

  const handleMaterialsOverrideModeToggle = async (enabled: boolean) => {
    await updatePreferences({
      ...preferences,
      production: {
        ...(preferences as any)?.production,
        materialsOverrideMode: enabled ? "prepress_and_production" : "prepress_only",
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

            <div className="flex items-start justify-between gap-4 rounded-titan-lg border border-titan-border-subtle p-4">
              <div className="flex-1 space-y-1">
                <Label htmlFor="allow-material-overrides-production" className="text-titan-sm font-medium text-titan-text-primary cursor-pointer">
                  Allow material overrides in production
                </Label>
                <p className="text-titan-xs text-titan-text-muted">
                  Off: material overrides are limited to prepress stages. On: overrides remain available through production until terminal done/complete states.
                </p>
              </div>
              <Switch
                id="allow-material-overrides-production"
                checked={materialsOverrideInProductionEnabled}
                onCheckedChange={handleMaterialsOverrideModeToggle}
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

        <div className="h-px bg-titan-border-subtle" />

        {/* Sidebar Section */}
        <div className="space-y-4">
          <div>
            <h3 className="text-titan-base font-medium text-titan-text-primary">Sidebar</h3>
            <p className="text-titan-sm text-titan-text-muted mt-1">
              Control sidebar display preferences
            </p>
          </div>

          <div className="flex items-start justify-between gap-4 rounded-titan-lg border border-titan-border-subtle p-4">
            <div className="flex-1 space-y-1">
              <Label htmlFor="show-operational-badges" className="text-titan-sm font-medium text-titan-text-primary cursor-pointer">
                Show operational badges
              </Label>
              <p className="text-titan-xs text-titan-text-muted">
                Display live work-queue counts next to sidebar navigation items so you can see pending workload at a glance.
              </p>
            </div>
            <Switch
              id="show-operational-badges"
              checked={preferences?.sidebar?.showOperationalBadges !== false}
              onCheckedChange={async (checked) => {
                await updatePreferences({
                  ...preferences,
                  sidebar: {
                    ...preferences?.sidebar,
                    showOperationalBadges: checked,
                  },
                });
              }}
              disabled={isUpdating}
            />
          </div>
        </div>
      </div>
    </TitanCard>
  );
}
