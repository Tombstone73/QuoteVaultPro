import * as React from "react";
import { Link, useLocation } from "wouter";
import { NAV_ITEMS, filterNavByRole, NavItem } from "@/lib/nav";
import { useAuth } from "@/hooks/useAuth";

function Item({ item, activePath }: { item: NavItem; activePath: string }) {
  const isActive = item.path && (activePath === item.path || activePath.startsWith(item.path + "/"));
  const Icon = item.icon as any;
  if (item.children && item.children.length > 0) {
    return (
      <div className="mb-2">
        <div className="px-3 pt-3 pb-1 text-xs uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>
          <div className="flex items-center gap-2"><Icon className="h-4 w-4" /> {item.label}</div>
        </div>
        <div className="mt-1 space-y-1">
          {item.children.map((c) => (
            <Item key={c.id} item={c} activePath={activePath} />
          ))}
        </div>
      </div>
    );
  }
  if (!item.path) return null;
  return (
    <Link href={item.path}>
      <a
        className={`flex items-center gap-3 rounded-md px-3 py-2 text-sm hover:bg-white/5 ${isActive ? "bg-white/10" : ""}`}
        style={{ color: isActive ? "var(--text-primary)" : "var(--text-muted)" }}
      >
        <Icon className="h-4 w-4" />
        <span>{item.label}</span>
      </a>
    </Link>
  );
}

export function SidebarNav() {
  const [loc] = useLocation();
  const { user } = useAuth();
  const role = user?.role ?? null;
  const items = filterNavByRole(NAV_ITEMS, role);
  return (
    <aside
      className="hidden h-screen w-64 shrink-0 border-r md:flex md:flex-col"
      style={{
        backgroundColor: "var(--app-sidebar-bg)",
        borderColor: "var(--app-sidebar-border-color)",
        color: "var(--text-primary)"
      }}
    >
      <div className="px-4 py-4 text-sm font-semibold" style={{ color: "var(--text-primary)" }}>TitanOS</div>
      <div className="flex-1 overflow-y-auto">
        <nav className="p-2">
          {items.map((i) => (
            <Item key={i.id} item={i} activePath={loc} />
          ))}
        </nav>
      </div>
      <div className="px-3 py-3 text-xs" style={{ color: "var(--text-muted)" }}>vNext</div>
    </aside>
  );
}
