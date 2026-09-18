import { DollarSign, Truck } from "lucide-react";
import { Link } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { DashboardPanel } from "@/components/dashboard/dashboardPanels";
import { ROUTES } from "@/config/routes";

type FulfillmentFinanceCardProps = {
  readyToShip?: number | null;
  shippedToday?: number | null;
  invoicesUnpaid?: number | null;
  overdueLabel?: string | null;
  overdueAmountCents?: number | null;
  collectedTodayCents?: number | null;
  collectedMonthCents?: number | null;
  collectionsPulsePercent?: number | null;
  selectedPanel?: DashboardPanel;
  onSelectPanel?: (panel: DashboardPanel) => void;
};

function valueOrDash(value?: number | null) {
  return value ?? "—";
}

function formatCurrency(cents?: number | null) {
  if (cents == null) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(cents / 100);
}

export default function FulfillmentFinanceCard({
  readyToShip,
  shippedToday,
  invoicesUnpaid,
  overdueLabel,
  overdueAmountCents,
  collectedTodayCents,
  collectedMonthCents,
  collectionsPulsePercent,
  selectedPanel,
  onSelectPanel,
}: FulfillmentFinanceCardProps) {
  const pulseWidth = Math.min(100, Math.max(0, collectionsPulsePercent ?? 0));
  const showCollections = collectedTodayCents != null || collectedMonthCents != null;

  return (
    <Card className="border-border bg-card h-full">
      <CardHeader className="flex-row items-center justify-between space-y-0 border-b border-border pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Truck className="h-4 w-4 text-primary" />
          Fulfillment & Finance
        </CardTitle>
        <Badge variant="outline" className="text-[10px] uppercase tracking-wide text-muted-foreground">
          Results
        </Badge>
      </CardHeader>
      <CardContent className="space-y-3 pt-4">
        {showCollections && (
          <div className="rounded-md border border-border bg-muted/30 p-3">
            <div className="mb-2 flex items-center gap-2 text-xs uppercase tracking-wide text-muted-foreground">
              <DollarSign className="h-3.5 w-3.5" />
              Collections Pulse
            </div>
            <Link to={`${ROUTES.payments.list}?datePreset=today`} className="mb-2 flex items-center justify-between rounded px-1 py-0.5 text-sm hover:bg-muted/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <span className="text-muted-foreground">Collected Today</span>
              <span className="font-semibold">{formatCurrency(collectedTodayCents)}</span>
            </Link>
            <div className="mb-2 h-1.5 w-full rounded-full bg-muted">
              <div className="h-1.5 rounded-full bg-emerald-500" style={{ width: `${pulseWidth}%` }} />
            </div>
            <Link to={`${ROUTES.payments.list}?datePreset=this-month`} className="flex items-center justify-between rounded px-1 py-0.5 text-sm hover:bg-muted/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <span className="text-muted-foreground">This Month</span>
              <span className="font-semibold">{formatCurrency(collectedMonthCents)}</span>
            </Link>
          </div>
        )}

        <div className="space-y-2">
          <button
            type="button"
            onClick={() => onSelectPanel?.("ready_to_ship")}
            className={`flex w-full items-center justify-between rounded-md border-b border-border px-2 pb-2 text-sm hover:bg-muted/20 ${selectedPanel === "ready_to_ship" ? "bg-muted/30" : ""}`}
          >
            <span className="text-muted-foreground">Ready for Fulfillment</span>
            <span className="font-semibold">{valueOrDash(readyToShip)}</span>
          </button>
          <button
            type="button"
            onClick={() => onSelectPanel?.("shipped_today")}
            className={`flex w-full items-center justify-between rounded-md border-b border-border px-2 pb-2 text-sm hover:bg-muted/20 ${selectedPanel === "shipped_today" ? "bg-muted/30" : ""}`}
          >
            <span className="text-muted-foreground">Shipped Today</span>
            <span className="font-semibold">{valueOrDash(shippedToday)}</span>
          </button>
          <button
            type="button"
            onClick={() => onSelectPanel?.("invoices_unpaid")}
            className={`flex w-full items-center justify-between rounded-md px-2 text-sm hover:bg-muted/20 ${selectedPanel === "invoices_unpaid" ? "bg-muted/30" : ""}`}
          >
            <div>
              <div className="text-muted-foreground">Invoices Unpaid</div>
              {overdueLabel ? <div className="text-xs text-rose-300">{overdueLabel}</div> : null}
            </div>
            <div className="text-right">
              <div className="font-semibold">{valueOrDash(invoicesUnpaid)}</div>
              <div className="text-xs text-muted-foreground">{formatCurrency(overdueAmountCents)}</div>
            </div>
          </button>
        </div>
      </CardContent>
    </Card>
  );
}
