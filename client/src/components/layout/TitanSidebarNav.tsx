import * as React from "react";
import { useState, useEffect } from "react";
import { useLocation } from "react-router-dom";
import { useNavigationGuard } from "@/contexts/NavigationGuardContext";
import {
  Plus,
  ChevronLeft,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/useAuth";
import { useActiveOrganizationRole } from "@/hooks/useActiveOrganizationRole";
import { useInboundEmailIntakeSettings } from "@/hooks/useInboundEmailIntakeSettings";
import { useOrgPreferences } from "@/hooks/useOrgPreferences";
import { useQuery } from "@tanstack/react-query";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ROUTES } from "@/config/routes";
import { buildReferrer } from "@/lib/nav/smartBack";
import { SHIELD_LOGO_SRC } from "@/lib/branding";
import { filterNavByRole, NAV_CONFIG, type NavItemConfig, type NavSectionConfig } from "@/lib/titanNavigation";

export { filterNavByRole, NAV_CONFIG };
export type { NavItemConfig, NavSectionConfig };

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
  const hasBadgeSlot = item.badge && badgeCount !== undefined;

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
          <span className="min-w-0 flex-1 truncate text-left">{item.name}</span>
          {hasBadgeSlot && (
            <Badge variant={badgeCount > 0 ? "default" : "secondary"} className="ml-auto h-5 min-w-[20px] shrink-0 px-1.5 text-xs tabular-nums">
              {badgeCount ?? 0}
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
  const emptySummary: OperationalSummaryData = {
    inboundOrders: 0,
    overview: 0,
    design: 0,
    proofing: 0,
    prepress: 0,
    flatbed: 0,
    roll: 0,
    fulfillment: 0,
    invoices: { pendingSend: 0, unpaid: 0 },
  };
  const safeSummary = summary ?? emptySummary;
  return {
    approvals: approvalCount,
    "inbound-orders": safeSummary.inboundOrders,
    "production-overview": safeSummary.overview,
    "production-design": safeSummary.design,
    "production-proofing": safeSummary.proofing,
    "production-prepress": safeSummary.prepress,
    "production-flatbed": safeSummary.flatbed,
    "production-roll": safeSummary.roll,
    fulfillment: safeSummary.fulfillment,
    invoices: safeSummary.invoices.pendingSend,
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
  const { role, isApprover } = useActiveOrganizationRole({ enabled: Boolean(user) });
  const { preferences } = useOrgPreferences();
  const inboundEmailSettingsQuery = useInboundEmailIntakeSettings();
  const location = useLocation();
  const { guardedNavigate } = useNavigationGuard();
  const navPreferences = {
    ...preferences,
    inboundEmail: inboundEmailSettingsQuery.data,
  };
  const filteredSections = filterNavByRole(NAV_CONFIG, role, navPreferences, user?.isPlatformAdmin ?? false, user?.isPlatformDeveloper ?? false);

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
    summaryQuery.isError ? undefined : summaryQuery.data ?? undefined,
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
          title={isCollapsed ? "Expand sidebar" : "Printers Hero"}
          aria-label={isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          <div className={cn(
            "h-8 w-8 shrink-0 rounded-titan-lg flex items-center justify-center transition-transform",
            isCollapsed && "group-hover:scale-110"
          )}>
            <img src={SHIELD_LOGO_SRC} alt="" className="h-8 w-8" aria-hidden="true" />
          </div>
          {!isCollapsed && (
            <span className="text-base font-semibold text-titan-text-primary">Printers Hero</span>
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
          onClick={() => guardedNavigate(ROUTES.orders.new)}
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
