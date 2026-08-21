import React, { type ReactNode, useState } from "react";
import {
  Activity,
  Bell,
  Bot,
  Box,
  Boxes,
  Bug,
  Building2,
  ChevronDown,
  Coffee,
  Contrast,
  CreditCard,
  FileText,
  Gauge,
  Grid2X2,
  Image,
  Layers,
  LayoutDashboard,
  Link2,
  MonitorCog,
  Moon,
  Package,
  Palette,
  PanelLeft,
  PanelLeftClose,
  PenTool,
  Plus,
  Printer,
  Receipt,
  Route as RouteIcon,
  Ruler,
  ScrollText,
  Search,
  Settings,
  ShieldCheck,
  ShoppingCart,
  Stamp,
  Sun,
  SunDim,
  Truck,
  Users,
  Wallet,
  Warehouse,
  type LucideIcon,
} from "lucide-react";
import type { VisualAppearance, VisualTheme } from "./appearance";
import { InventoryWorkspace } from "./InventoryWorkspace";
import { useAuthSessionControls } from "./AuthGate";

export type V2VisualPage = "home" | "quotes" | "orders" | "customers" | "contacts" | "products" | "artwork" | "proofing" | "prepress" | "production" | "fulfillment" | "routing" | "invoices" | "payments" | "appearance";

type NavigationItem = Readonly<{
  page?: V2VisualPage;
  href?: string;
  label: string;
  icon: LucideIcon;
}>;
type NavigationSection = Readonly<{
  id: string;
  label: string;
  items: readonly NavigationItem[];
}>;

const sections: readonly NavigationSection[] = [
  { id: "home", label: "Home", items: [{ page: "home", label: "Command Center", icon: LayoutDashboard }] },
  {
    id: "sales",
    label: "Sales",
    items: [
      { page: "quotes", label: "Quotes", icon: FileText },
      { page: "orders", label: "Orders", icon: ShoppingCart },
      { page: "customers", label: "Customers", icon: Building2 },
      { page: "contacts", label: "Contacts", icon: Users },
      { label: "Inbound Orders", icon: Bell },
    ],
  },
  {
    id: "products",
    label: "Products",
    items: [
      { page: "products", label: "Products", icon: Package },
      { label: "Product Builder", icon: Layers },
      { label: "Nesting", icon: Grid2X2 },
      { label: "Materials", icon: Boxes },
      { href: "/inventory", label: "Inventory", icon: Warehouse },
      { label: "Procurement", icon: Box },
    ],
  },
  {
    id: "ops",
    label: "Operations",
    items: [
      { page: "artwork", label: "Artwork", icon: Image },
      { label: "Design", icon: PenTool },
      { page: "proofing", label: "Proofing", icon: Stamp },
      { page: "prepress", label: "Prepress", icon: Ruler },
      { page: "production", label: "Production", icon: Printer },
      { page: "routing", label: "Routing", icon: RouteIcon },
      { page: "fulfillment", label: "Fulfillment", icon: Activity },
      { label: "Shipping", icon: Truck },
    ],
  },
  {
    id: "finance",
    label: "Finance",
    items: [
      { page: "invoices", label: "Invoices", icon: Receipt },
      { page: "payments", label: "Payments", icon: Wallet },
      { label: "Reports", icon: Gauge },
    ],
  },
  {
    id: "platform",
    label: "Platform",
    items: [
      { label: "AI Assistant", icon: Bot },
      { label: "Communications", icon: ScrollText },
      { label: "Integrations", icon: Link2 },
      { label: "Bug Reports", icon: Bug },
    ],
  },
  {
    id: "admin",
    label: "Administration",
    items: [
      { label: "Users & Permissions", icon: ShieldCheck },
      { label: "Settings", icon: Settings },
      { page: "appearance", label: "Themes / Appearance", icon: Palette },
    ],
  },
];

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
}: Readonly<{
  children: ReactNode;
  page: V2VisualPage;
  onNavigate: (page: V2VisualPage) => void;
  appearance: VisualAppearance;
  setAppearance: (patch: Partial<VisualAppearance>) => void;
}>) => {
  const collapsed = appearance.sidebar === "collapsed";
  const [closed, setClosed] = useState<Record<string, boolean>>({});
  const [newOpen, setNewOpen] = useState(false);
  const session = useAuthSessionControls();
  const ThemeIcon = themeIcon[appearance.theme];
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
          {sections.map((section) => {
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
                  section.items.filter(({ page, href }) => Boolean(page) || Boolean(href)).map(({ page: target, href, label, icon: Icon }) => href ? (
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
          <button type="button" className="v2-search-button" aria-label="Search V2 workspace" disabled title="Search requires a future canonical read model">
            <Search aria-hidden />
            <span>Search customers, quotes, orders, invoicesâ€¦</span>
            <kbd>Ctrl K</kbd>
          </button>
          <div className="v2-topbar-actions">
            <button type="button" className="v2-primary-button v2-new-button" aria-expanded={newOpen} aria-haspopup="menu" onClick={() => setNewOpen((open) => !open)}>
              <Plus aria-hidden /> New
            </button>
            {newOpen && <div className="v2-new-menu" role="menu" aria-label="Create new record"><button type="button" role="menuitem" onClick={() => { setNewOpen(false); create("quotes"); }}>New Quote</button><button type="button" role="menuitem" onClick={() => { setNewOpen(false); create("orders"); }}>New Order</button></div>}
            <button
              type="button"
              className="v2-icon-button"
              title={`Theme: ${themeLabel[appearance.theme]} â€” switch to ${themeLabel[nextTheme]}`}
              aria-label={`Switch theme to ${themeLabel[nextTheme]}`}
              onClick={() => setAppearance({ theme: nextTheme })}
            >
              <ThemeIcon aria-hidden />
            </button>
            <button type="button" className="v2-quiet-button" title="Bug reporting is not yet a V2 workspace" disabled>
              <Bug aria-hidden /> <span>Report a Problem</span>
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
