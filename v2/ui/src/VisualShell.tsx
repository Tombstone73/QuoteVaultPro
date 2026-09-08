import React, { type ReactNode, useState } from "react";
import {
  Activity,
  Bell,
  Building2,
  ChevronDown,
  Coffee,
  Contrast,
  FileText,
  Image,
  LayoutDashboard,
  Link2,
  MonitorCog,
  Moon,
  Package,
  Calculator,
  Palette,
  PanelLeft,
  PanelLeftClose,
  Plus,
  Printer,
  Receipt,
  Route as RouteIcon,
  Ruler,
  Settings,
  ShieldCheck,
  ShoppingCart,
  Stamp,
  Sun,
  SunDim,
  Users,
  Wallet,
  Warehouse,
  type LucideIcon,
} from "lucide-react";
import type { VisualAppearance, VisualTheme } from "./appearance";
import type { UiBootstrap } from "./api";
import { InventoryWorkspace } from "./InventoryWorkspace";
import { useAuthSessionControls } from "./AuthGate";

export type V2VisualPage = "home" | "quotes" | "orders" | "inboundOrders" | "customers" | "contacts" | "products" | "productBuilder" | "formulas" | "artwork" | "proofing" | "prepress" | "production" | "fulfillment" | "routing" | "invoices" | "payments" | "settings" | "appearance";

type ShellCapabilities = UiBootstrap["capabilities"];

type NavigationItem = Readonly<{
  page?: V2VisualPage;
  href?: string;
  label: string;
  icon: LucideIcon;
  /** The sidebar is a convenience only; each target still enforces this on
   * its own server/workspace boundary. */
  requiresAny?: readonly (keyof ShellCapabilities)[];
}>;
type NavigationSection = Readonly<{
  id: string;
  label: string;
  items: readonly NavigationItem[];
}>;

const sections: readonly NavigationSection[] = [
  { id: "home", label: "Home", items: [{ page: "home", label: "Command Center", icon: LayoutDashboard }] },
  { id: "pricing", label: "Pricing", items: [{ page: "formulas", label: "Formula Library", icon: Calculator, requiresAny: ["pricingConfigure"] }] },
  {
    id: "sales",
    label: "Sales",
    items: [
      { page: "quotes", label: "Quotes", icon: FileText, requiresAny: ["quoteView"] },
      { page: "orders", label: "Orders", icon: ShoppingCart, requiresAny: ["orderView"] },
      { page: "customers", label: "Customers", icon: Building2, requiresAny: ["customerView"] },
      { page: "contacts", label: "Contacts", icon: Users, requiresAny: ["customerView"] },
      { page: "inboundOrders", label: "Inbound Orders", icon: Bell, requiresAny: ["inboundView"] },
    ],
  },
  {
    id: "products",
    label: "Products",
    items: [
      { page: "products", label: "Products", icon: Package, requiresAny: ["productView"] },
      { href: "/inventory", label: "Inventory", icon: Warehouse, requiresAny: ["inventoryView"] },
    ],
  },
  {
    id: "ops",
    label: "Operations",
    items: [
      { page: "artwork", label: "Artwork", icon: Image, requiresAny: ["artworkView"] },
      { page: "proofing", label: "Proofing", icon: Stamp, requiresAny: ["proofView"] },
      { page: "prepress", label: "Prepress", icon: Ruler, requiresAny: ["prepressView"] },
      { page: "production", label: "Production", icon: Printer, requiresAny: ["productionView"] },
      { href: "/production/flatbed", label: "Flatbed", icon: Printer, requiresAny: ["productionView"] },
      { href: "/production/roll", label: "Roll", icon: Printer, requiresAny: ["productionView"] },
      { page: "routing", label: "Routing", icon: RouteIcon, requiresAny: ["routeView"] },
      { page: "fulfillment", label: "Fulfillment", icon: Activity, requiresAny: ["fulfillmentView"] },
    ],
  },
  {
    id: "finance",
    label: "Finance",
    items: [
      { page: "invoices", label: "Invoices", icon: Receipt, requiresAny: ["invoiceView"] },
      { page: "payments", label: "Payments", icon: Wallet, requiresAny: ["paymentView"] },
      { href: "/settings?section=accounting", label: "QuickBooks", icon: Link2, requiresAny: ["organizationConfigure"] },
    ],
  },
  {
    id: "admin",
    label: "Administration",
    items: [
      { href: "/settings?section=staff", label: "Users & Permissions", icon: ShieldCheck, requiresAny: ["permissionsView"] },
      { page: "settings", label: "Settings", icon: Settings, requiresAny: ["pricingConfigure", "organizationConfigure", "numberingConfigure", "communicationsConfigure", "permissionsView"] },
      { page: "appearance", label: "Themes / Appearance", icon: Palette },
    ],
  },
];

const canSee = (item: NavigationItem, capabilities?: ShellCapabilities): boolean =>
  !item.requiresAny?.length ||
  !capabilities ||
  item.requiresAny.some((capability) => capabilities[capability] === true);

/**
 * Keeps the shell honest: navigation advertises only mounted operational
 * destinations, and reflects the authenticated capability snapshot once it
 * has loaded. It intentionally does not replace server-side authorization.
 */
export const visibleNavigationSections = (capabilities?: ShellCapabilities): readonly NavigationSection[] =>
  sections
    .map((section) => ({ ...section, items: section.items.filter((item) => canSee(item, capabilities)) }))
    .filter((section) => section.items.length > 0);

const themeOrder: readonly VisualTheme[] = [
  "light",
  "dark",
  "command",
  "contrast",
  "lowglare",
  "warm",
];
const themeIcon: Record<VisualTheme, typeof Sun> = {
  light: Sun,
  dark: Moon,
  command: MonitorCog,
  contrast: Contrast,
  lowglare: SunDim,
  warm: Coffee,
};
const themeLabel: Record<VisualTheme, string> = {
  light: "Light",
  dark: "Dark",
  command: "Command Center",
  contrast: "High Contrast",
  lowglare: "Low Glare",
  warm: "Warm Neutral",
};

export const V2VisualShell = ({
  children,
  page,
  onNavigate,
  appearance,
  setAppearance,
  capabilities,
}: Readonly<{
  children: ReactNode;
  page: V2VisualPage;
  onNavigate: (page: V2VisualPage) => void;
  appearance: VisualAppearance;
  setAppearance: (patch: Partial<VisualAppearance>) => void;
  capabilities?: ShellCapabilities;
}>) => {
  const collapsed = appearance.sidebar === "collapsed";
  const [closed, setClosed] = useState<Record<string, boolean>>({});
  const [newOpen, setNewOpen] = useState(false);
  const session = useAuthSessionControls();
  const ThemeIcon = themeIcon[appearance.theme];
  const navigation = visibleNavigationSections(capabilities);
  const canCreateQuote = !capabilities || capabilities.quoteCreate === true;
  const canCreateOrder = !capabilities || capabilities.orderCreate === true;
  const canCreate = canCreateQuote || canCreateOrder;
  const nextTheme =
    themeOrder[(themeOrder.indexOf(appearance.theme) + 1) % themeOrder.length]!;
  const create = (target: "quotes" | "orders") => {
    try { sessionStorage.setItem(`ph.v2.new-${target === "quotes" ? "quote" : "order"}`, "1"); } catch {}
    onNavigate(target);
    window.dispatchEvent(new Event(`v2:new-${target === "quotes" ? "quote" : "order"}`));
  };

  return (
    <div className="v2-visual-shell">
      <aside className={`v2-sidebar ${collapsed ? "is-collapsed" : ""}`}>
        <div className="v2-sidebar-brand">
          <div className="v2-logo">PH</div>
          {!collapsed && (
            <div className="v2-brand-label">
              <strong>PrintersHero</strong>
              <span>V2 workspace</span>
            </div>
          )}
          <button
            type="button"
            aria-label="Toggle sidebar"
            className="v2-icon-button"
            onClick={() =>
              setAppearance({ sidebar: collapsed ? "expanded" : "collapsed" })
            }
          >
            {collapsed ? <PanelLeft aria-hidden /> : <PanelLeftClose aria-hidden />}
          </button>
        </div>
        <nav className="v2-sidebar-nav" aria-label="Application">
          {navigation.map((section) => {
            const isClosed = closed[section.id] ?? false;
            return (
              <div key={section.id} className="v2-nav-section">
                {!collapsed && section.items.length > 1 && (
                  <button
                    type="button"
                    className="v2-nav-section-label"
                    onClick={() =>
                      setClosed((current) => ({
                        ...current,
                        [section.id]: !isClosed,
                      }))
                    }
                  >
                    <ChevronDown className={isClosed ? "is-closed" : ""} aria-hidden />
                    {section.label}
                  </button>
                )}
                {!isClosed &&
                  section.items.map(({ page: target, href, label, icon: Icon }) => href ? (
                    <a
                      key={label}
                      href={href}
                      title={label}
                      aria-current={window.location.pathname === href ? "page" : undefined}
                      className={`v2-nav-item ${window.location.pathname === href ? "is-active" : ""}`}
                    >
                      <Icon aria-hidden />
                      {!collapsed && <span>{label}</span>}
                    </a>
                  ) : (
                    <button key={label} type="button" title={label} aria-current={target === page ? "page" : undefined} className={`v2-nav-item ${target === page ? "is-active" : ""}`} onClick={() => target && onNavigate(target)}><Icon aria-hidden />{!collapsed && <span>{label}</span>}</button>
                  ))}
              </div>
            );
          })}
        </nav>
      </aside>
      <div className="v2-shell-main">
        <header className="v2-topbar">
          <div className="v2-topbar-actions">
            {canCreate && <><button type="button" className="v2-primary-button v2-new-button" aria-expanded={newOpen} aria-haspopup="menu" onClick={() => setNewOpen((open) => !open)}>
              <Plus aria-hidden /> New
            </button>
            {newOpen && <div className="v2-new-menu" role="menu" aria-label="Create new record">{canCreateQuote && <button type="button" role="menuitem" onClick={() => { setNewOpen(false); create("quotes"); }}>New Quote</button>}{canCreateOrder && <button type="button" role="menuitem" onClick={() => { setNewOpen(false); create("orders"); }}>New Order</button>}</div>}</>}
            <button
              type="button"
              className="v2-icon-button"
              title={`Theme: ${themeLabel[appearance.theme]} â€” switch to ${themeLabel[nextTheme]}`}
              aria-label={`Switch theme to ${themeLabel[nextTheme]}`}
              onClick={() => setAppearance({ theme: nextTheme })}
            >
              <ThemeIcon aria-hidden />
            </button>
            {session && <div className="v2-auth-session" aria-label="Authenticated V2 staff session">
              <span title={session.displayName}>{session.displayName}</span>
              <button className="button secondary" disabled={session.busy} onClick={session.signOut}>Sign out</button>
            </div>}
          </div>
        </header>
        <main className="v2-workspace">{typeof window !== "undefined" && window.location.pathname === "/inventory" ? <InventoryWorkspace /> : children}</main>
      </div>
    </div>
  );
};
