import { AlertCircle, BarChart3 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DASHBOARD_PANELS, type DashboardPanel } from "@/components/dashboard/dashboardPanels";

type OrdersPipelineCardProps = {
  newOrders?: number | null;
  inProduction?: number | null;
  onHold?: number | null;
  slaRisk?: number | null;
  selectedPanel?: DashboardPanel;
  onSelectPanel?: (panel: DashboardPanel) => void;
};

function valueOrDash(value?: number | null) {
  return value ?? "—";
}

export default function OrdersPipelineCard({
  newOrders,
  inProduction,
  onHold,
  slaRisk,
  selectedPanel,
  onSelectPanel,
}: OrdersPipelineCardProps) {
  const rows = [
    { label: DASHBOARD_PANELS.orders_status_new.title.replace("Orders: ", ""), value: newOrders, panel: "orders_status_new" as const },
    { label: DASHBOARD_PANELS.orders_status_in_production.title.replace("Orders: ", ""), value: inProduction, panel: "orders_status_in_production" as const },
    { label: DASHBOARD_PANELS.orders_status_on_hold.title.replace("Orders: ", ""), value: onHold, panel: "orders_status_on_hold" as const },
  ];

  return (
    <Card className="border-border bg-card h-full">
      <CardHeader className="flex-row items-center justify-between space-y-0 border-b border-border pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <BarChart3 className="h-4 w-4 text-primary" />
          Orders Pipeline
        </CardTitle>
        <Badge variant="outline" className="text-[10px] uppercase tracking-wide text-muted-foreground">
          Sales Focus
        </Badge>
      </CardHeader>
      <CardContent className="space-y-3 pt-4">
        {rows.map((row) => {
          const isActive = selectedPanel === row.panel;
          return (
            <button
              key={row.panel}
              type="button"
              onClick={() => onSelectPanel?.(row.panel)}
              aria-selected={isActive}
              className={`flex w-full items-center justify-between rounded-md px-2 py-1.5 text-sm transition hover:bg-muted/20 ${isActive ? "bg-muted/30" : ""}`}
            >
              <span className="text-muted-foreground">• {row.label}</span>
              <span className="font-semibold">{valueOrDash(row.value)}</span>
            </button>
          );
        })}

        {slaRisk != null && (
          <div className="border-t border-border pt-3">
            <div className="flex items-center gap-2 rounded-md border border-red-900/40 bg-red-950/20 p-2 text-sm text-red-300">
              <AlertCircle className="h-4 w-4" />
              <span>{`${slaRisk} Orders at SLA Risk`}</span>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
