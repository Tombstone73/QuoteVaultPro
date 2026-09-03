import { ROUTES } from "@/config/routes";

export const DASHBOARD_PANELS = {
  my_work: {
    title: "My Work",
    entity: "my_work",
  },
  orders_due_today: {
    title: "Orders Due Today",
    entity: "orders",
  },
  orders_due_tomorrow: {
    title: "Orders Due Tomorrow",
    entity: "orders",
  },
  orders_status_new: {
    title: "Orders: New",
    entity: "orders",
  },
  orders_status_in_production: {
    title: "Orders: In Production",
    entity: "orders",
  },
  orders_status_on_hold: {
    title: "Orders: On Hold",
    entity: "orders",
  },
  quotes_pending: {
    title: "Quotes Pending",
    entity: "quotes",
  },
  invoices_overdue: {
    title: "Overdue Invoices",
    entity: "invoices",
  },
  invoices_unpaid: {
    title: "Unpaid Invoices",
    entity: "invoices",
  },
  ready_to_ship: {
    title: "Ready for Fulfillment",
    entity: "orders",
  },
  shipped_today: {
    title: "Shipped Today",
    entity: "orders",
  },
  low_inventory_items: {
    title: "Low Inventory Items",
    entity: "materials",
  },
} as const;

export type DashboardPanel = keyof typeof DASHBOARD_PANELS;

export function isDashboardPanel(value: string | null | undefined): value is DashboardPanel {
  return !!value && value in DASHBOARD_PANELS;
}

export function getPanelOpenTarget(panel: DashboardPanel): { label: string; href: string } | null {
  switch (panel) {
    case "orders_due_today":
      return { label: "Open in Orders", href: `${ROUTES.orders.list}?due=today` };
    case "orders_due_tomorrow":
      return { label: "Open in Orders", href: `${ROUTES.orders.list}?due=tomorrow` };
    case "orders_status_new":
      return { label: "Open in Orders", href: `${ROUTES.orders.list}?status=new` };
    case "orders_status_in_production":
      return { label: "Open in Orders", href: `${ROUTES.orders.list}?status=in_production` };
    case "orders_status_on_hold":
      return { label: "Open in Orders", href: `${ROUTES.orders.list}?status=on_hold` };
    case "ready_to_ship":
      return { label: "Open Fulfillment", href: ROUTES.fulfillment.list };
    case "shipped_today":
      return { label: "Open in Orders", href: ROUTES.orders.list };
    case "quotes_pending":
      return { label: "Open in Quotes", href: `${ROUTES.quotes.list}?status=pending_approval` };
    case "invoices_overdue":
      return { label: "Open in Invoices", href: `${ROUTES.invoices.list}?status=overdue` };
    case "invoices_unpaid":
      return { label: "Open in Invoices", href: ROUTES.invoices.list };
    case "low_inventory_items":
      return { label: "Open in Materials", href: ROUTES.materials.list };
    default:
      return null;
  }
}
