import * as React from "react";
import { useState, useEffect } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import { useNavigationGuard } from "@/contexts/NavigationGuardContext";
import {
  Home,
  Users,
  Contact2,
  FileText,
  Inbox,
  ShoppingCart,
  Factory,
  Boxes,
  Package,
  ClipboardList,
  Truck,
  Tag,
  BarChart3,
  Receipt,
  CreditCard,
  Settings,
  UserCog,
  Plus,
  ChevronLeft,
  ChevronDown,
  ChevronRight,
  LayoutGrid,
  ShieldCheck,
  Bug,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/useAuth";
import { useOrgPreferences } from "@/hooks/useOrgPreferences";
import { useQuery } from "@tanstack/react-query";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ROUTES } from "@/config/routes";
import { buildReferrer } from "@/lib/nav/smartBack";

// ============================================================
// NAV CONFIG - AUTHORITATIVE TITANOS NAVIGATION
// ============================================================

export type NavItemConfig = {
  id: string;
  name: string;
  icon: LucideIcon;
  path: string;
  roles?: string[];
  badge?: boolean; // If true, show operational badge from summary
  badgeQuery?: string; // Legacy single-item query key (kept for approvals)
  platformAdminOnly?: boolean; // Only shown to platform admins (isPlatformAdmin=true)
  conditional?: {
    requireApproval?: boolean; // Only show if org preference requireApproval=true
    approverOnly?: boolean; // Only show for internal users
  };
};

export type NavSectionConfig = {
  section: string;
  sectionKey: string; // Unique key for section (e.g., "sales", "production")
  items: NavItemConfig[];
};

export const NAV_CONFIG: NavSectionConfig[] = [
  {
    section: "SALES",
    sectionKey: "sales",
    items: [
      { id: "dashboard", name: "Dashboard", icon: Home, path: ROUTES.root },
      { id: "customers", name: "Customers", icon: Users, path: ROUTES.customers.list },
      { id: "contacts", name: "Contacts", icon: Contact2, path: ROUTES.contacts.list },
      { id: "quotes", name: "Quotes", icon: FileText, path: ROUTES.quotes.list },
      {
        id: "approvals",
        name: "Approvals",
        icon: ClipboardList,
        path: "/approvals",
        badge: true,
        badgeQuery: "/api/quotes/pending-approvals",
        conditional: {
          requireApproval: true,
          approverOnly: true,
        },
      },
      { id: "orders", name: "Orders", icon: ShoppingCart, path: ROUTES.orders.list },
      {
        id: "inbound-orders",
        name: "Inbound Orders",
        icon: Inbox,
        path: ROUTES.inboundOrders.list,
        badge: true,
      },
    ],
  },
  {
    section: "PRODUCTION",
    sectionKey: "production",
    items: [
      { id: "production-overview", name: "Overview", icon: LayoutGrid, path: ROUTES.production.board, badge: true },
      { id: "production-design", name: "Design", icon: FileText, path: ROUTES.production.design, badge: true },
      { id: "production-proofing", name: "Proofing", icon: ClipboardList, path: ROUTES.production.proofing, badge: true },
      { id: "production-prepress", name: "Prepress", icon: FileText, path: ROUTES.production.prepress, badge: true },
      { id: "production-flatbed", name: "Flatbed", icon: Factory, path: ROUTES.production.flatbed, badge: true },
      { id: "production-roll", name: "Roll", icon: Factory, path: ROUTES.production.roll, badge: true },
    ],
  },
  {
    section: "INVENTORY",
    sectionKey: "inventory",
    items: [
      { id: "materials", name: "Materials", icon: Boxes, path: ROUTES.materials.list },
      { id: "vendors", name: "Vendors", icon: Package, path: ROUTES.vendors.list },
      { id: "purchase-orders", name: "Purchase Orders", icon: ClipboardList, path: ROUTES.purchaseOrders.list },
    ],
  },
  {
    section: "SHIPPING & FULFILLMENT",
    sectionKey: "shipping",
    items: [
      { id: "fulfillment", name: "Fulfillment", icon: Truck, path: ROUTES.fulfillment.list, badge: true },
      { id: "shipping", name: "Labels", icon: Tag, path: "/shipping" },
      { id: "reports", name: "Reports", icon: BarChart3, path: "/reports" },
    ],
  },
  {
    section: "ACCOUNTING",
    sectionKey: "accounting",
    items: [
      { id: "invoices", name: "Invoices", icon: Receipt, path: ROUTES.invoices.list, badge: true },
      { id: "payments", name: "Finance", icon: CreditCard, path: "/payments" },
    ],
  },
  {
    section: "SYSTEM",
    sectionKey: "system",
    items: [
      { id: "admin-dashboard", name: "Admin Dashboard", icon: Home, path: ROUTES.system.adminDashboard, roles: ["admin", "owner"] },
      { id: "settings", name: "Settings", icon: Settings, path: ROUTES.settings.root, roles: ["admin", "owner"] },
      { id: "users", name: "Users", icon: UserCog, path: ROUTES.users.list, roles: ["admin", "owner"] },
      { id: "bug-reports", name: "Bug Reports", icon: Bug, path: ROUTES.admin.bugReports, roles: ["admin", "owner"] },
    ],
  },
  {
    section: "PLATFORM",
    sectionKey: "platform",
    items: [
      { id: "platform-orgs-new", name: "New Organization", icon: ShieldCheck, path: "/platform/orgs/new", platformAdminOnly: true },
    ],
  },
];

// Filter nav items by user role and conditional visibility
function filterNavByRole(
  sections: NavSectionConfig[],
  role?: string | null,
  orgPreferences?: { quotes?: { requireApproval?: boolean } },
  isPlatformAdmin?: boolean
): NavSectionConfig[] {
  const userRole = (role || "").toLowerCase();
  const isOwner = userRole === "owner";
  const isApprover = ['owner', 'admin', 'manager', 'employee'].includes(userRole);
  const requireApproval = orgPreferences?.quotes?.requireApproval || false;

  return sections
    .map((section) => ({
      ...section,
      items: section.items.filter((item) => {
        // Platform-admin-only items
        if (item.platformAdminOnly && !isPlatformAdmin) return false;

        // Check role-based visibility
        if (!item.roles) {
          // No role restriction
        } else if (isOwner) {
          // Owner sees everything
        } else if (!item.roles.includes(userRole)) {
          return false;
        }

        // Check conditional visibility
        if (item.conditional) {
          if (item.conditional.requireApproval && !requireApproval) {
            return false;
          }
          if (item.conditional.approverOnly && !isApprover) {
            return false;
          }
        }

        return true;
      }),
    }))
    .filter((section) => section.items.length > 0);
}

// Helper to determine which section a path belongs to
function getSectionKeyForPath(pathname: string, sections: NavSectionConfig[]): string | null {
  for (const section of sections) {
    for (const item of section.items) {
      if (pathname === item.path || (item.path !== "/" && pathname.startsWith(item.path))) {
        return section.sectionKey;
      }
    }
  }
  return null;
}

// LocalStorage helpers for section collapse state
const STORAGE_KEY = "titan_sidebar_sections";

function loadSectionState(sections: NavSectionConfig[]): Record<string, boolean> {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      return JSON.parse(saved);
    }
  } catch (e) {
    console.warn("Failed to load sidebar section state:", e);
  }
  // Default: all sections open
  return sections.reduce((acc, section) => {
    acc[section.sectionKey] = true;
    return acc;
  }, {} as Record<string, boolean>);
}

function saveSectionState(state: Record<string, boolean>): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (e) {
    console.warn("Failed to save sidebar section state:", e);
  }
}

// ============================================================
// NAV ITEM COMPONENT
// ============================================================

interface NavItemProps {
  item: NavItemConfig;
  isCollapsed: boolean;
  badgeCount?: number;
}

function NavItem({ item, isCollapsed, badgeCount }: NavItemProps) {
  const Icon = item.icon;
  const location = useLocation();
  const { guardedNavigate } = useNavigationGuard();

  // Active state: exact match or nested route prefix
  // Special case: /production should ONLY match exact /production, not /production/flatbed
  const isActiveCheck = (pathname: string) => {
    if (pathname === item.path) return true;
    if (item.path === "/production") return false; // Exact match only for Overview
    return item.path !== "/" && pathname.startsWith(item.path + "/");
  };

  const active = isActiveCheck(location.pathname);

  return (
    <button
      type="button"
      onClick={() =>
        guardedNavigate(item.path, {
          state: { referrer: buildReferrer(location) },
        })
      }
      title={isCollapsed ? item.name : undefined}
      className={cn(
        "w-full flex items-center gap-3 rounded-titan-md px-3 py-1.5 text-sm font-medium transition-colors",
        "hover:bg-titan-bg-card-elevated hover:text-titan-text-primary",
        active
          ? "bg-titan-accent/10 text-titan-accent border-l-2 border-titan-accent"
          : "text-titan-text-secondary",
        isCollapsed && "justify-center px-2"
      )}
    >
      <Icon className="h-4 w-4 shrink-0" />
      {!isCollapsed && (
        <>
          <span className="truncate flex-1">{item.name}</span>
          {badgeCount !== undefined && badgeCount > 0 && (
            <Badge variant="default" className="ml-auto h-5 min-w-[20px] px-1.5 text-xs">
              {badgeCount}
            </Badge>
          )}
        </>
      )}
    </button>
  );
}

// ============================================================
// SECTION COMPONENT
// ============================================================

interface NavSectionProps {
  section: NavSectionConfig;
  isCollapsed: boolean;
  isExpanded: boolean;
  onToggle: () => void;
  badgeCounts: Record<string, number>;
}

function NavSection({ section, isCollapsed, isExpanded, onToggle, badgeCounts }: NavSectionProps) {
  const sectionId = `nav-section-${section.sectionKey}`;
  const ChevronIcon = isExpanded ? ChevronDown : ChevronRight;

  return (
    <div className="mb-1">
      {!isCollapsed && (
        <button
          type="button"
          onClick={onToggle}
          className={cn(
            "w-full flex items-center justify-between px-3 py-1.5 rounded-titan-md",
            "text-[10px] font-semibold uppercase tracking-widest text-titan-text-muted",
            "hover:bg-titan-bg-card-elevated/50 transition-colors",
            "focus:outline-none focus-visible:ring-2 focus-visible:ring-titan-accent"
          )}
          aria-expanded={isExpanded}
          aria-controls={sectionId}
        >
          <span>{section.section}</span>
          <ChevronIcon className="h-3 w-3" />
        </button>
      )}
      {isCollapsed && <div className="h-3" />}
      {isExpanded && (
        <div id={sectionId} className="space-y-0.5 px-2 mt-1">
          {section.items.map((item) => (
            <NavItem
              key={item.id}
              item={item}
              isCollapsed={isCollapsed}
              badgeCount={item.badge ? badgeCounts[item.id] : undefined}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ============================================================
// OPERATIONAL SUMMARY RESPONSE SHAPE
// ============================================================

interface OperationalSummaryData {
  inboundOrders: number;
  overview: number;
  design: number;
  proofing: number;
  prepress: number;
  flatbed: number;
  roll: number;
  fulfillment: number;
  invoices: {
    pendingSend: number;
    unpaid: number;
  };
}

// Map operational summary data to per-nav-item-id counts.
// Invoice badge shows pendingSend for the primary count.
function buildBadgeCounts(
  summary: OperationalSummaryData | undefined,
  approvalCount: number,
): Record<string, number> {
  if (!summary) return { approvals: approvalCount };
  return {
    approvals: approvalCount,
    "inbound-orders": summary.inboundOrders,
    "production-overview": summary.overview,
    "production-design": summary.design,
    "production-proofing": summary.proofing,
    "production-prepress": summary.prepress,
    "production-flatbed": summary.flatbed,
    "production-roll": summary.roll,
    fulfillment: summary.fulfillment,
    invoices: summary.invoices.pendingSend,
  };
}

// ============================================================
// MAIN SIDEBAR COMPONENT
// ============================================================

interface TitanSidebarNavProps {
  isCollapsed?: boolean;
  onToggleCollapse?: () => void;
}

export function TitanSidebarNav({ isCollapsed = false, onToggleCollapse }: TitanSidebarNavProps) {
  const { user } = useAuth();
  const { preferences } = useOrgPreferences();
  const location = useLocation();
  const navigate = useNavigate();
  const role = user?.role ?? null;
  const filteredSections = filterNavByRole(NAV_CONFIG, role, preferences, user?.isPlatformAdmin ?? false);

  const roleLower = String(role || '').toLowerCase();
  const isApprover = ['owner', 'admin', 'manager', 'employee'].includes(roleLower);
  const requireApproval = preferences?.quotes?.requireApproval === true;

  // Sidebar badge toggle — default ON (true when unset)
  const showBadges = preferences?.sidebar?.showOperationalBadges !== false;

  // Approvals badge (legacy single-item query — kept as separate query per existing pattern)
  const approvalsQuery = useQuery({
    queryKey: ["/api/quotes/pending-approvals"],
    queryFn: async () => {
      const res = await fetch("/api/quotes/pending-approvals", { credentials: "include" });
      if (!res.ok) return { count: 0 };
      return res.json();
    },
    enabled: showBadges && isApprover && requireApproval,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    refetchInterval: false,
  });

  // Operational summary — single payload for all other sidebar badges
  const summaryQuery = useQuery({
    queryKey: ["/api/operational-summary"],
    queryFn: async () => {
      const res = await fetch("/api/operational-summary", { credentials: "include" });
      if (!res.ok) return null;
      const json = await res.json();
      return (json.data ?? null) as OperationalSummaryData | null;
    },
    enabled: showBadges,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    // Refresh counts every 2 minutes in the background — lightweight count queries,
    // stays within the 5-minute React Query cache TTL window.
    refetchInterval: showBadges ? 120_000 : false,
  });

  const badgeCounts = buildBadgeCounts(
    summaryQuery.data ?? undefined,
    approvalsQuery.data?.count ?? 0,
  );

  // Initialize section open/close state
  const [openSections, setOpenSections] = useState<Record<string, boolean>>(() => {
    const savedState = loadSectionState(filteredSections);
    // Auto-expand section containing current route
    const currentSectionKey = getSectionKeyForPath(location.pathname, filteredSections);
    if (currentSectionKey) {
      savedState[currentSectionKey] = true;
    }
    return savedState;
  });

  // Auto-expand section when route changes
  useEffect(() => {
    const currentSectionKey = getSectionKeyForPath(location.pathname, filteredSections);
    if (currentSectionKey) {
      setOpenSections((prev) => {
        // Only update if the section is currently closed
        if (!prev[currentSectionKey]) {
          const newState = { ...prev, [currentSectionKey]: true };
          saveSectionState(newState);
          return newState;
        }
        return prev;
      });
    }
  }, [location.pathname, filteredSections]);

  // Toggle section open/close
  const toggleSection = (sectionKey: string) => {
    setOpenSections((prev) => {
      const newState = { ...prev, [sectionKey]: !prev[sectionKey] };
      saveSectionState(newState);
      return newState;
    });
  };

  return (
    <aside
      className={cn(
        "hidden h-screen shrink-0 flex-col border-r border-titan-border-subtle bg-titan-bg-card md:flex",
        "transition-all duration-200 ease-in-out",
        isCollapsed ? "w-16" : "w-64"
      )}
    >
      {/* Logo / Brand - ALWAYS rendered with consistent toggle location */}
      <div className={cn(
        "flex items-center border-b border-titan-border-subtle px-3 py-3",
        isCollapsed ? "justify-center" : "justify-between"
      )}>
        {/* Logo + App Name (clickable to toggle) */}
        <button
          type="button"
          onClick={onToggleCollapse}
          className={cn(
            "flex items-center gap-2 rounded-titan-md transition-all",
            "hover:opacity-80 focus:outline-none focus-visible:ring-2 focus-visible:ring-titan-accent",
            isCollapsed && "justify-center group"
          )}
          title={isCollapsed ? "Expand sidebar" : "TitanOS"}
          aria-label={isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          <div className={cn(
            "h-8 w-8 shrink-0 rounded-titan-lg bg-titan-accent flex items-center justify-center transition-transform",
            isCollapsed && "group-hover:scale-110"
          )}>
            <span className="text-sm font-bold text-white">T</span>
          </div>
          {!isCollapsed && (
            <span className="text-base font-semibold text-titan-text-primary">TitanOS</span>
          )}
        </button>

        {/* Primary toggle button - visible when expanded */}
        {onToggleCollapse && !isCollapsed && (
          <button
            type="button"
            onClick={onToggleCollapse}
            className={cn(
              "inline-flex items-center justify-center w-8 h-8 shrink-0",
              "rounded-titan-md bg-titan-bg-card-elevated border border-titan-border-subtle",
              "text-titan-text-muted hover:text-titan-text-primary hover:bg-titan-bg-input",
              "transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-titan-accent"
            )}
            aria-label="Collapse sidebar"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* New Order Button */}
      <div className={cn("px-3 py-2", isCollapsed && "px-2")}>
        <Button
          onClick={() => navigate(ROUTES.orders.new)}
          className={cn(
            "w-full bg-titan-accent hover:bg-titan-accent/90 text-white font-medium shadow-titan-sm",
            "flex items-center justify-center gap-2",
            isCollapsed && "px-0"
          )}
          size={isCollapsed ? "icon" : "default"}
        >
          <Plus className="h-4 w-4" />
          {!isCollapsed && <span>New Order</span>}
        </Button>
      </div>

      {/* Navigation Sections */}
      <nav className="flex-1 overflow-y-auto py-1">
        {filteredSections.map((section) => (
          <NavSection
            key={section.section}
            section={section}
            isCollapsed={isCollapsed}
            isExpanded={openSections[section.sectionKey] ?? true}
            onToggle={() => toggleSection(section.sectionKey)}
            badgeCounts={showBadges ? badgeCounts : {}}
          />
        ))}
      </nav>

      {/* Footer */}
      <div className={cn(
        "border-t border-titan-border-subtle px-3 py-2",
        "flex items-center",
        isCollapsed ? "justify-center" : "justify-between"
      )}>
        {!isCollapsed && (
          <span className="text-[10px] text-titan-text-muted">v1.0</span>
        )}
        <ThemeToggle />
      </div>
    </aside>
  );
}

export default TitanSidebarNav;
