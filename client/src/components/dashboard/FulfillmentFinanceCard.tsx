import { DollarSign, Truck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type FulfillmentFinanceCardProps = {
  readyToShip?: number | null;
  shippedToday?: number | null;
  invoicesUnpaid?: number | null;
  overdueLabel?: string | null;
  overdueAmountCents?: number | null;
  collectedTodayCents?: number | null;
  collectedWeekCents?: number | null;
  collectionsPulsePercent?: number | null;
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
  collectedWeekCents,
  collectionsPulsePercent,
}: FulfillmentFinanceCardProps) {
  const pulseWidth = Math.min(100, Math.max(0, collectionsPulsePercent ?? 0));

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
      <CardContent className="space-y-4 pt-4">
        <div className="space-y-2">
          <div className="flex items-center justify-between border-b border-border pb-2 text-sm">
            <span className="text-muted-foreground">Ready to Ship</span>
            <span className="font-semibold">{valueOrDash(readyToShip)}</span>
          </div>
          <div className="flex items-center justify-between border-b border-border pb-2 text-sm">
            <span className="text-muted-foreground">Shipped Today</span>
            <span className="font-semibold">{valueOrDash(shippedToday)}</span>
          </div>
          <div className="flex items-center justify-between text-sm">
            <div>
              <div className="text-muted-foreground">Invoices Unpaid</div>
              <div className="text-xs text-rose-300">{overdueLabel || "Not available"}</div>
            </div>
            <div className="text-right">
              <div className="font-semibold">{valueOrDash(invoicesUnpaid)}</div>
              <div className="text-xs text-muted-foreground">{formatCurrency(overdueAmountCents)}</div>
            </div>
          </div>
        </div>

        <div className="rounded-md border border-border bg-muted/30 p-3">
          <div className="mb-2 flex items-center gap-2 text-xs uppercase tracking-wide text-muted-foreground">
            <DollarSign className="h-3.5 w-3.5" />
            Collections Pulse
          </div>
          <div className="mb-2 flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Collected Today</span>
            <span className="font-semibold">{formatCurrency(collectedTodayCents)}</span>
          </div>
          <div className="mb-3 h-1.5 w-full rounded-full bg-muted">
            <div className="h-1.5 rounded-full bg-emerald-500" style={{ width: `${pulseWidth}%` }} />
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">This Week</span>
            <span className="font-semibold">{formatCurrency(collectedWeekCents)}</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
