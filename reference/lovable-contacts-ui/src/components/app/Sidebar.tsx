import { Link, useRouterState } from "@tanstack/react-router";
import { useState } from "react";
import {
  Activity, Bell, Bot, Box, Boxes, Bug, Building2, ChevronDown, CreditCard, FileText,
  Gauge, Grid2x2, Image, Layers, LayoutDashboard, Link2, Package, Palette, PanelLeftClose, PenTool,
  PanelLeft, Printer, Receipt, Route as RouteIcon, Ruler, ScrollText, Settings, ShieldCheck,
  ShoppingCart, Stamp, Truck, Users, Wallet, Warehouse,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useApp } from "@/lib/app-store";

type Item = { to: string; label: string; icon: typeof Gauge };
type Section = { id: string; label: string; items: Item[] };

const SECTIONS: Section[] = [
  { id: "home", label: "Home", items: [{ to: "/", label: "Command Center", icon: LayoutDashboard }] },
  {
    id: "sales", label: "Sales", items: [
      { to: "/quotes", label: "Quotes", icon: FileText },
      { to: "/orders", label: "Orders", icon: ShoppingCart },
      { to: "/customers", label: "Customers", icon: Building2 },
      { to: "/contacts", label: "Contacts", icon: Users },
      { to: "/inbound", label: "Inbound Orders", icon: Bell },
    ],
  },
  {
    id: "products", label: "Products", items: [
      { to: "/products", label: "Products", icon: Package },
      { to: "/product-builder", label: "Product Builder", icon: Layers },
      { to: "/nesting", label: "Nesting", icon: Grid2x2 },
      { to: "/materials", label: "Materials", icon: Boxes },
      { to: "/inventory", label: "Inventory", icon: Warehouse },
      { to: "/procurement", label: "Procurement", icon: Box },
    ],
  },
  {
    id: "ops", label: "Operations", items: [
      { to: "/artwork", label: "Artwork", icon: Image },
      { to: "/design", label: "Design", icon: PenTool },
      { to: "/proofing", label: "Proofing", icon: Stamp },
      { to: "/prepress", label: "Prepress", icon: Ruler },
      { to: "/production", label: "Production", icon: Printer },
      { to: "/routing", label: "Routing", icon: RouteIcon },
      { to: "/fulfillment", label: "Fulfillment", icon: Activity },
      { to: "/shipping", label: "Shipping", icon: Truck },
    ],
  },
  {
    id: "finance", label: "Finance", items: [
      { to: "/invoices", label: "Invoices", icon: Receipt },
      { to: "/payments", label: "Payments", icon: Wallet },
      { to: "/reports", label: "Reports", icon: Gauge },
    ],
  },
  {
    id: "platform", label: "Platform", items: [
      { to: "/assistant", label: "AI Assistant", icon: Bot },
      { to: "/communications", label: "Communications", icon: ScrollText },
      { to: "/integrations", label: "Integrations", icon: Link2 },
      { to: "/bugs", label: "Bug Reports", icon: Bug },
    ],
  },
  {
    id: "admin", label: "Administration", items: [
      { to: "/users", label: "Users & Permissions", icon: ShieldCheck },
      { to: "/settings", label: "Settings", icon: Settings },
      { to: "/appearance", label: "Themes / Appearance", icon: Palette },
    ],
  },
];

export function Sidebar() {
  const { appearance, setAppearance } = useApp();
  const collapsed = appearance.sidebar === "collapsed";
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const [closed, setClosed] = useState<Record<string, boolean>>({});

  return (
    <aside
      className={cn(
        "flex shrink-0 flex-col border-r border-sidebar-border bg-sidebar transition-[width] duration-150",
        collapsed ? "w-[56px]" : "w-[216px]",
      )}
    >
      <div className="flex h-12 items-center gap-2 border-b border-sidebar-border px-3">
        <div className="flex size-6 shrink-0 items-center justify-center rounded bg-primary text-[11px] font-bold text-primary-foreground">
          PH
        </div>
        {!collapsed && (
          <div className="min-w-0 flex-1">
            <div className="truncate text-[13px] font-semibold leading-none">PrintersHero</div>
            <div className="truncate text-[10px] text-muted-foreground">Hensley Print Co.</div>
          </div>
        )}
        <button
          type="button"
          aria-label="Toggle sidebar"
          onClick={() => setAppearance({ sidebar: collapsed ? "expanded" : "collapsed" })}
          className="rounded p-1 text-muted-foreground hover:bg-sidebar-accent hover:text-foreground"
        >
          {collapsed ? <PanelLeft className="size-4" /> : <PanelLeftClose className="size-4" />}
        </button>
      </div>

      <nav className="flex-1 overflow-y-auto py-2">
        {SECTIONS.map((s) => {
          const isClosed = closed[s.id] ?? false;
          return (
            <div key={s.id} className="px-2 pb-1">
              {!collapsed && s.items.length > 1 && (
                <button
                  type="button"
                  onClick={() => setClosed((c) => ({ ...c, [s.id]: !isClosed }))}
                  className="flex w-full items-center gap-1 px-1.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground"
                >
                  <ChevronDown className={cn("size-3 transition-transform", isClosed && "-rotate-90")} />
                  {s.label}
                </button>
              )}
              {!isClosed &&
                s.items.map((it) => {
                  const active = it.to === "/" ? pathname === "/" : pathname.startsWith(it.to);
                  return (
                    <Link
                      key={it.to}
                      to={it.to}
                      title={it.label}
                      className={cn(
                        "mb-0.5 flex items-center gap-2 rounded-md px-2 py-1.5 text-[13px] text-sidebar-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground",
                        active && "bg-primary/12 font-medium text-primary",
                        collapsed && "justify-center px-0",
                      )}
                    >
                      <it.icon className="size-4 shrink-0" />
                      {!collapsed && <span className="truncate">{it.label}</span>}
                    </Link>
                  );
                })}
            </div>
          );
        })}
      </nav>

      <div className="border-t border-sidebar-border p-2">
        <Link
          to="/storefront/$slug"
          params={{ slug: "delta" }}
          className={cn(
            "flex items-center gap-2 rounded-md px-2 py-1.5 text-[12px] text-muted-foreground hover:bg-sidebar-accent hover:text-foreground",
            collapsed && "justify-center px-0",
          )}
        >
          <CreditCard className="size-4 shrink-0" />
          {!collapsed && "Customer Storefront"}
        </Link>
      </div>
    </aside>
  );
}
