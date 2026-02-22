import { AlertTriangle, CalendarClock, Boxes, FileClock, ReceiptText } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { DASHBOARD_PANELS, type DashboardPanel } from "@/components/dashboard/dashboardPanels";

type CriticalAlertsRowProps = {
  dueToday?: number | null;
  dueTomorrow?: number | null;
  lowInventoryItems?: number | null;
  quotesPending?: number | null;
  overdueInvoices?: number | null;
  selectedPanel?: DashboardPanel;
  onSelectPanel?: (panel: DashboardPanel) => void;
};

function displayCount(value?: number | null) {
  return value ?? "—";
}

export default function CriticalAlertsRow({
  dueToday,
  dueTomorrow,
  lowInventoryItems,
  quotesPending,
  overdueInvoices,
  selectedPanel,
  onSelectPanel,
}: CriticalAlertsRowProps) {
  const tiles = [
    { key: "dueToday", panel: "orders_due_today" as const, label: DASHBOARD_PANELS.orders_due_today.title, value: dueToday, icon: AlertTriangle, border: "border-l-red-500", iconColor: "text-red-400" },
    { key: "dueTomorrow", panel: "orders_due_tomorrow" as const, label: DASHBOARD_PANELS.orders_due_tomorrow.title, value: dueTomorrow, icon: CalendarClock, border: "border-l-yellow-500", iconColor: "text-yellow-400" },
    { key: "lowInventoryItems", panel: "low_inventory_items" as const, label: DASHBOARD_PANELS.low_inventory_items.title, value: lowInventoryItems, icon: Boxes, border: "border-l-orange-500", iconColor: "text-orange-400" },
    { key: "quotesPending", panel: "quotes_pending" as const, label: DASHBOARD_PANELS.quotes_pending.title, value: quotesPending, icon: FileClock, border: "border-l-blue-500", iconColor: "text-blue-400" },
    { key: "overdueInvoices", panel: "invoices_overdue" as const, label: DASHBOARD_PANELS.invoices_overdue.title, value: overdueInvoices, icon: ReceiptText, border: "border-l-rose-500", iconColor: "text-rose-400" },
  ].filter((tile) => tile.value != null);

  return (
    <section className="space-y-3">
      <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Critical Alerts</h2>
      {tiles.length > 0 ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5">
          {tiles.map((tile) => {
            const Icon = tile.icon;
            const isActive = selectedPanel === tile.panel;
            return (
              <Card
                key={tile.key}
                role="button"
                tabIndex={0}
                aria-selected={isActive}
                onClick={() => onSelectPanel?.(tile.panel)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    onSelectPanel?.(tile.panel);
                  }
                }}
                className={`border-border bg-card border-l-2 transition hover:bg-muted/20 cursor-pointer ${tile.border} ${isActive ? "ring-1 ring-primary" : ""}`}
              >
                <CardContent className="p-4">
                  <div className="mb-2 flex items-start justify-between">
                    <span className="text-3xl font-bold text-foreground">{displayCount(tile.value)}</span>
                    <Icon className={`h-4 w-4 ${tile.iconColor}`} />
                  </div>
                  <p className="text-sm text-muted-foreground">{tile.label}</p>
                </CardContent>
              </Card>
            );
          })}
        </div>
      ) : (
        <div className="rounded-md border border-dashed border-border bg-muted/20 p-4 text-sm text-muted-foreground">
          No critical alert metrics available.
        </div>
      )}
    </section>
  );
}
