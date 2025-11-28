import { type LucideIcon, Home, Users, ClipboardList, Receipt, Factory, Boxes, Package, Truck, FileText, Settings as SettingsIcon } from "lucide-react";

export type UserRole = "owner" | "admin" | "manager" | "employee" | "staff" | "csr" | "accounting" | "viewer";

export type NavItem = {
  id: string;
  label: string;
  icon: LucideIcon;
  path?: string;
  children?: NavItem[];
  roles?: UserRole[];
};

export const NAV_ITEMS: NavItem[] = [
  { id: "dashboard", label: "Dashboard", icon: Home, path: "/" },
  {
    id: "sales",
    label: "Sales",
    icon: ClipboardList,
    children: [
      { id: "customers", label: "Customers", icon: Users, path: "/customers", roles: ["staff", "admin", "owner", "manager"] },
      { id: "quotes", label: "Quotes", icon: ClipboardList, path: "/quotes", roles: ["staff", "admin", "owner", "manager"] },
      { id: "orders", label: "Orders", icon: Receipt, path: "/orders", roles: ["staff", "admin", "owner", "manager"] },
    ],
  },
  {
    id: "production",
    label: "Production",
    icon: Factory,
    children: [
      { id: "board", label: "Production Board", icon: Factory, path: "/production", roles: ["staff", "admin", "owner", "manager"] },
    ],
  },
  {
    id: "inventory",
    label: "Inventory",
    icon: Boxes,
    children: [
      { id: "materials", label: "Materials", icon: Boxes, path: "/materials", roles: ["admin", "owner", "manager"] },
      { id: "vendors", label: "Vendors", icon: Package, path: "/vendors", roles: ["admin", "owner", "manager"] },
      { id: "purchase-orders", label: "Purchase Orders", icon: ClipboardList, path: "/purchase-orders", roles: ["admin", "owner", "manager"] },
    ],
  },
  {
    id: "shipping",
    label: "Shipping",
    icon: Truck,
    children: [
      { id: "fulfillment", label: "Fulfillment", icon: Truck, path: "/fulfillment", roles: ["staff", "admin", "owner", "manager"] },
    ],
  },
  { id: "reports", label: "Reports", icon: FileText, path: "/reports", roles: ["admin", "owner", "manager"] },
  { id: "settings", label: "Settings", icon: SettingsIcon, path: "/settings", roles: ["admin", "owner"] },
];

export function filterNavByRole(items: NavItem[], role?: string | null): NavItem[] {
  const r = (role || "").toLowerCase() as UserRole | "";
  const allow = (allowed?: UserRole[]) => !allowed || allowed.includes(r as UserRole) || r === "owner";
  const walk = (nodes: NavItem[]): NavItem[] =>
    nodes
      .map((n) => {
        if (!allow(n.roles)) return null as any;
        const children = n.children ? walk(n.children) : undefined;
        return { ...n, children } as NavItem;
      })
      .filter(Boolean) as NavItem[];
  return walk(items);
}
