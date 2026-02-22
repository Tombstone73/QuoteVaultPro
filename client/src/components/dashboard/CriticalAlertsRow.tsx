import { AlertTriangle, CalendarClock, Boxes, FileClock, ReceiptText } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";

type CriticalAlertsRowProps = {
  dueToday?: number | null;
  dueTomorrow?: number | null;
  lowInventoryItems?: number | null;
  quotesPending?: number | null;
  overdueInvoices?: number | null;
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
}: CriticalAlertsRowProps) {
  return (
    <section className="space-y-3">
      <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Critical Alerts</h2>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <Card className="border-border bg-card border-l-2 border-l-red-500">
          <CardContent className="p-4">
            <div className="mb-2 flex items-start justify-between">
              <span className="text-3xl font-bold text-foreground">{displayCount(dueToday)}</span>
              <AlertTriangle className="h-4 w-4 text-red-400" />
            </div>
            <p className="text-sm text-muted-foreground">Due Today</p>
          </CardContent>
        </Card>

        <Card className="border-border bg-card border-l-2 border-l-yellow-500">
          <CardContent className="p-4">
            <div className="mb-2 flex items-start justify-between">
              <span className="text-3xl font-bold text-foreground">{displayCount(dueTomorrow)}</span>
              <CalendarClock className="h-4 w-4 text-yellow-400" />
            </div>
            <p className="text-sm text-muted-foreground">Due Tomorrow</p>
          </CardContent>
        </Card>

        <Card className="border-border bg-card border-l-2 border-l-orange-500">
          <CardContent className="p-4">
            <div className="mb-2 flex items-start justify-between">
              <span className="text-3xl font-bold text-foreground">{displayCount(lowInventoryItems)}</span>
              <Boxes className="h-4 w-4 text-orange-400" />
            </div>
            <p className="text-sm text-muted-foreground">Low Inventory Items</p>
          </CardContent>
        </Card>

        <Card className="border-border bg-card border-l-2 border-l-blue-500">
          <CardContent className="p-4">
            <div className="mb-2 flex items-start justify-between">
              <span className="text-3xl font-bold text-foreground">{displayCount(quotesPending)}</span>
              <FileClock className="h-4 w-4 text-blue-400" />
            </div>
            <p className="text-sm text-muted-foreground">Quotes Pending</p>
          </CardContent>
        </Card>

        <Card className="border-border bg-card border-l-2 border-l-rose-500">
          <CardContent className="p-4">
            <div className="mb-2 flex items-start justify-between">
              <span className="text-3xl font-bold text-foreground">{displayCount(overdueInvoices)}</span>
              <ReceiptText className="h-4 w-4 text-rose-400" />
            </div>
            <p className="text-sm text-muted-foreground">Overdue Invoices</p>
          </CardContent>
        </Card>
      </div>
    </section>
  );
}
