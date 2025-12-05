import * as React from "react";
import { useState } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import {
  Home,
  Users,
  Contact2,
  FileText,
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
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/useAuth";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Button } from "@/components/ui/button";
import { ROUTES } from "@/config/routes";

// ============================================================
// NAV CONFIG - AUTHORITATIVE TITANOS NAVIGATION
// ============================================================

export type NavItemConfig = {
  id: string;
  name: string;
  icon: LucideIcon;
  path: string;
  roles?: string[];
};

export type NavSectionConfig = {
  section: string;
  items: NavItemConfig[];
};

export const NAV_CONFIG: NavSectionConfig[] = [
  {
    section: "SALES",
    items: [
      { id: "dashboard", name: "Dashboard", icon: Home, path: ROUTES.dashboard },
      { id: "customers", name: "Customers", icon: Users, path: ROUTES.customers.list },
      { id: "contacts", name: "Contacts", icon: Contact2, path: ROUTES.contacts.list },
      { id: "quotes", name: "Quotes", icon: FileText, path: ROUTES.quotes.list },
      { id: "orders", name: "Orders", icon: ShoppingCart, path: ROUTES.orders.list },
    ],
  },
  {
    section: "PRODUCTION",
    items: [
      { id: "production", name: "Production Board", icon: Factory, path: ROUTES.production.board },
    ],
  },
  {
    section: "INVENTORY",
    items: [
      { id: "materials", name: "Materials", icon: Boxes, path: ROUTES.materials.list },
      { id: "vendors", name: "Vendors", icon: Package, path: ROUTES.vendors.list },
      { id: "purchase-orders", name: "Purchase Orders", icon: ClipboardList, path: ROUTES.purchaseOrders.list },
    ],
  },
  {
    section: "SHIPPING & FULFILLMENT",
    items: [
      { id: "fulfillment", name: "Fulfillment", icon: Truck, path: "/fulfillment" },
      { id: "shipping", name: "Shipping Labels", icon: Tag, path: "/shipping" },
      { id: "reports", name: "Reports", icon: BarChart3, path: "/reports" },
    ],
  },
  {
    section: "ACCOUNTING",
    items: [
      { id: "invoices", name: "Invoices", icon: Receipt, path: ROUTES.invoices.list },
      { id: "payments", name: "Payments", icon: CreditCard, path: "/payments" },
    ],
  },
  {
    section: "SYSTEM",
    items: [
      { id: "settings", name: "Settings", icon: Settings, path: ROUTES.settings.root, roles: ["admin", "owner"] },
      { id: "users", name: "Users", icon: UserCog, path: ROUTES.users.list, roles: ["admin", "owner"] },
    ],
  },
];

// Filter nav items by user role
function filterNavByRole(sections: NavSectionConfig[], role?: string | null): NavSectionConfig[] {
  const userRole = (role || "").toLowerCase();
  const isOwner = userRole === "owner";

  return sections
    .map((section) => ({
      ...section,
      items: section.items.filter((item) => {
        if (!item.roles) return true;
        if (isOwner) return true;
        return item.roles.includes(userRole);
      }),
    }))
    .filter((section) => section.items.length > 0);
}

// ============================================================
// NAV ITEM COMPONENT
// ============================================================

interface NavItemProps {
  item: NavItemConfig;
  isCollapsed: boolean;
}

function NavItem({ item, isCollapsed }: NavItemProps) {
  const location = useLocation();
  const Icon = item.icon;

  // Check if this item is active (exact match or starts with for nested routes)
  const isActive =
    location.pathname === item.path ||
    (item.path !== "/" && location.pathname.startsWith(item.path));

  return (
    <NavLink
      to={item.path}
      className={cn(
        "flex items-center gap-3 rounded-titan-md px-3 py-2.5 text-sm font-medium transition-colors",
        "hover:bg-titan-bg-card-elevated hover:text-titan-text-primary",
        isActive
          ? "bg-titan-accent/10 text-titan-accent border-l-2 border-titan-accent"
          : "text-titan-text-secondary",
        isCollapsed && "justify-center px-2"
      )}
      title={isCollapsed ? item.name : undefined}
    >
      <Icon className="h-4 w-4 shrink-0" />
      {!isCollapsed && <span className="truncate">{item.name}</span>}
    </NavLink>
  );
}

// ============================================================
// SECTION COMPONENT
// ============================================================

interface NavSectionProps {
  section: NavSectionConfig;
  isCollapsed: boolean;
}

function NavSection({ section, isCollapsed }: NavSectionProps) {
  return (
    <div className="mb-2">
      {!isCollapsed && (
        <div className="px-3 pt-4 pb-2 text-[10px] font-semibold uppercase tracking-widest text-titan-text-muted">
          {section.section}
        </div>
      )}
      {isCollapsed && <div className="h-4" />}
      <div className="space-y-1 px-2">
        {section.items.map((item) => (
          <NavItem key={item.id} item={item} isCollapsed={isCollapsed} />
        ))}
      </div>
    </div>
  );
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
  const navigate = useNavigate();
  const role = user?.role ?? null;
  const filteredSections = filterNavByRole(NAV_CONFIG, role);

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
        "flex items-center border-b border-titan-border-subtle px-3 py-4",
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
      <div className={cn("px-3 py-3", isCollapsed && "px-2")}>
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
      <nav className="flex-1 overflow-y-auto py-2">
        {filteredSections.map((section) => (
          <NavSection key={section.section} section={section} isCollapsed={isCollapsed} />
        ))}
      </nav>

      {/* Footer */}
      <div className={cn(
        "border-t border-titan-border-subtle px-3 py-3",
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
