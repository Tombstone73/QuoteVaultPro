import type { ReactNode } from "react";
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
import { useState } from "react";
import type { VisualAppearance, VisualTheme } from "./appearance";

export type V2VisualPage = "quotes" | "orders" | "proofing" | "prepress" | "production" | "appearance";

type NavigationItem = Readonly<{
  page?: V2VisualPage;
  label: string;
  icon: LucideIcon;
}>;
type NavigationSection = Readonly<{
  id: string;
  label: string;
  items: readonly NavigationItem[];
}>;

const sections: readonly NavigationSection[] = [
  { id: "home", label: "Home", items: [{ label: "Command Center", icon: LayoutDashboard }] },
  {
    id: "sales",
    label: "Sales",
    items: [
      { page: "quotes", label: "Quotes", icon: FileText },
      { page: "orders", label: "Orders", icon: ShoppingCart },
      { label: "Customers", icon: Building2 },
      { label: "Inbound Orders", icon: Bell },
    ],
  },
  {
    id: "products",
    label: "Products",
    items: [
      { label: "Products", icon: Package },
      { label: "Product Builder", icon: Layers },
      { label: "Nesting", icon: Grid2X2 },
      { label: "Materials", icon: Boxes },
      { label: "Inventory", icon: Warehouse },
      { label: "Procurement", icon: Box },
    ],
  },
  {
    id: "ops",
    label: "Operations",
    items: [
      { label: "Artwork", icon: Image },
      { label: "Design", icon: PenTool },
      { page: "proofing", label: "Proofing", icon: Stamp },
      { page: "prepress", label: "Prepress", icon: Ruler },
      { page: "production", label: "Production", icon: Printer },
      { label: "Routing", icon: RouteIcon },
      { label: "Fulfillment", icon: Activity },
      { label: "Shipping", icon: Truck },
    ],
  },
  {
    id: "finance",
    label: "Finance",
    items: [
      { label: "Invoices", icon: Receipt },
      { label: "Payments", icon: Wallet },
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
  const ThemeIcon = themeIcon[appearance.theme];
  const nextTheme =
    themeOrder[(themeOrder.indexOf(appearance.theme) + 1) % themeOrder.length]!;

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
                  section.items.map(({ page: target, label, icon: Icon }) => (
                    <button
                      key={label}
                      type="button"
                      title={label}
                      aria-current={target === page ? "page" : undefined}
                      className={`v2-nav-item ${target === page ? "is-active" : ""}`}
                      onClick={() => target && onNavigate(target)}
                    >
                      <Icon aria-hidden />
                      {!collapsed && <span>{label}</span>}
                    </button>
                  ))}
              </div>
            );
          })}
        </nav>
        <div className="v2-sidebar-footer">
          <button type="button" className="v2-nav-item" title="Customer Storefront">
            <CreditCard aria-hidden />
            {!collapsed && <span>Customer Storefront</span>}
          </button>
        </div>
      </aside>
      <div className="v2-shell-main">
        <header className="v2-topbar">
          <button type="button" className="v2-search-button" aria-label="Search V2 workspace">
            <Search aria-hidden />
            <span>Search customers, quotes, orders, invoicesâ€¦</span>
            <kbd>Ctrl K</kbd>
          </button>
          <div className="v2-topbar-actions">
            <button type="button" className="v2-primary-button v2-new-button" onClick={() => onNavigate("quotes")}>
              <Plus aria-hidden /> New
            </button>
            <button
              type="button"
              className="v2-icon-button"
              title={`Theme: ${themeLabel[appearance.theme]} â€” switch to ${themeLabel[nextTheme]}`}
              aria-label={`Switch theme to ${themeLabel[nextTheme]}`}
              onClick={() => setAppearance({ theme: nextTheme })}
            >
              <ThemeIcon aria-hidden />
            </button>
            <button type="button" className="v2-quiet-button" title="Report a problem">
              <Bug aria-hidden /> <span>Report a Problem</span>
            </button>
            <div className="v2-session-identity" aria-label="Authenticated V2 staff session">
              <div>
                <strong>Authenticated staff</strong>
                <span>V2 session</span>
              </div>
              <b>V2</b>
            </div>
          </div>
        </header>
        <main className="v2-workspace">{children}</main>
      </div>
    </div>
  );
};
