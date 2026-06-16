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
  LayoutGrid,
  ShieldCheck,
  Bug,
  type LucideIcon,
} from "lucide-react";
import { ROUTES } from "@/config/routes";
import { canUseProductPlanning } from "@/lib/productPlanningAccess";
import { canUsePlatformTools } from "@/lib/platformAccess";

export type NavItemConfig = {
  id: string;
  name: string;
  icon: LucideIcon;
  path: string;
  roles?: string[];
  badge?: boolean;
  badgeQuery?: string;
  platformAdminOnly?: boolean;
  platformOnly?: boolean;
  developerOrAdminOnly?: boolean;
  conditional?: {
    requireApproval?: boolean;
    approverOnly?: boolean;
    requireInboundEmailIntake?: boolean;
  };
};

export type NavSectionConfig = {
  section: string;
  sectionKey: string;
  items: NavItemConfig[];
};

export const NAV_CONFIG: NavSectionConfig[] = [
  {
    section: "SALES",
    sectionKey: "sales",
    items: [
      { id: "dashboard", name: "Dashboard", icon: Home, path: ROUTES.dashboard },
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
        conditional: {
          requireInboundEmailIntake: true,
        },
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
    ],
  },
  {
    section: "PLATFORM",
    sectionKey: "platform",
    items: [
      { id: "product-planning", name: "Product Planning", icon: ClipboardList, path: ROUTES.productPlanning.dashboard, developerOrAdminOnly: true },
      { id: "bug-reports", name: "Bug Reports", icon: Bug, path: ROUTES.admin.bugReports, roles: ["admin", "owner"] },
      { id: "platform-tools", name: "Developer Tools", icon: LayoutGrid, path: ROUTES.platform.tools, platformOnly: true },
      { id: "platform-orgs-new", name: "New Organization", icon: ShieldCheck, path: ROUTES.platform.orgsNew, platformAdminOnly: true },
    ],
  },
];

export function filterNavByRole(
  sections: NavSectionConfig[],
  role?: string | null,
  orgPreferences?: { quotes?: { requireApproval?: boolean }; inboundEmail?: { inboundEmailIntakeEnabled?: boolean } },
  isPlatformAdmin?: boolean,
  isPlatformDeveloper?: boolean,
): NavSectionConfig[] {
  const userRole = (role || "").toLowerCase();
  const isOwner = userRole === "owner";
  const isApprover = ["owner", "admin", "manager", "employee"].includes(userRole);
  const requireApproval = orgPreferences?.quotes?.requireApproval || false;

  return sections
    .map((section) => ({
      ...section,
      items: section.items.filter((item) => {
        if (item.platformAdminOnly && !isPlatformAdmin) return false;
        if (item.platformOnly && !canUsePlatformTools({ isPlatformAdmin, isPlatformDeveloper })) return false;
        if (item.developerOrAdminOnly && !canUseProductPlanning({ role: userRole, isPlatformAdmin, isPlatformDeveloper })) return false;

        if (!item.roles) {
          // No role restriction.
        } else if (isOwner) {
          // Owner sees owner/admin tenant items.
        } else if (!item.roles.includes(userRole)) {
          return false;
        }

        if (item.conditional) {
          if (item.conditional.requireApproval && !requireApproval) return false;
          if (item.conditional.approverOnly && !isApprover) return false;
          if (item.conditional.requireInboundEmailIntake && orgPreferences?.inboundEmail?.inboundEmailIntakeEnabled === false) return false;
        }

        return true;
      }),
    }))
    .filter((section) => section.items.length > 0);
}
