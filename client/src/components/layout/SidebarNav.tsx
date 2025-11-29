import * as React from "react";
import { NavLink } from "react-router-dom";
import { NAV_ITEMS, filterNavByRole, NavItem } from "@/lib/nav";
import { useAuth } from "@/hooks/useAuth";
import { ThemeToggle } from "@/components/ThemeToggle";

function Item({ item }: { item: NavItem }) {
  const Icon = item.icon as any;

  // Group / section
  if (item.children && item.children.length > 0) {
    return (
      <div className="mb-2">
        <div
          className="px-3 pt-3 pb-1 text-[10px] uppercase tracking-[0.2em]"
          style={{ color: "var(--text-muted)" }}
        >
          <div className="flex items-center gap-2">
            {Icon && <Icon className="h-4 w-4" />}
            <span>{item.label}</span>
          </div>
        </div>
        <div className="mt-1 space-y-1">
          {item.children.map((child) => (
            <Item key={child.id} item={child} />
          ))}
        </div>
      </div>
    );
  }

  // Leaf without a path – nothing to render
  if (!item.path) return null;

  // Leaf nav item
  return (
    <NavLink
      to={item.path}
      className={({ isActive }) =>
        [
          "flex items-center gap-3 rounded-md px-3 py-2 text-xs font-medium transition-colors",
          "hover:bg-white/5",
          isActive ? "bg-white/10" : "",
        ]
          .filter(Boolean)
          .join(" ")
      }
      style={({ isActive }) => ({
        color: isActive ? "var(--text-primary)" : "var(--text-muted)",
      })}
    >
      {Icon && <Icon className="h-4 w-4" />}
      <span>{item.label}</span>
    </NavLink>
  );
}

export function SidebarNav() {
  const { user } = useAuth();
  const role = user?.role ?? null;
  const items = filterNavByRole(NAV_ITEMS, role);

  return (
    <aside
      className="hidden h-screen w-64 shrink-0 border-r md:flex md:flex-col"
      style={{
        backgroundColor: "var(--app-sidebar-bg)",
        borderColor: "var(--app-sidebar-border-color)",
        color: "var(--text-primary)",
      }}
    >
      {/* Top brand / theme toggle */}
      <div className="flex items-center justify-between px-4 py-4">
        <div
          className="text-sm font-semibold"
          style={{ color: "var(--text-primary)" }}
        >
          TitanOS
        </div>
        <ThemeToggle />
      </div>

      {/* Nav items */}
      <div className="flex-1 overflow-y-auto">
        <nav className="p-2">
          {items.map((item) => (
            <Item key={item.id} item={item} />
          ))}
        </nav>
      </div>

      {/* Footer */}
      <div
        className="px-3 py-3 text-[10px]"
        style={{ color: "var(--text-muted)" }}
      >
        vNext
      </div>
    </aside>
  );
}
