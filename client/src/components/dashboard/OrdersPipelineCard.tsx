import { AlertCircle, BarChart3 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type OrdersPipelineCardProps = {
  newOrders?: number | null;
  scheduled?: number | null;
  inProduction?: number | null;
  readyForPickup?: number | null;
  onHold?: number | null;
  slaRisk?: number | null;
};

function valueOrDash(value?: number | null) {
  return value ?? "—";
}

export default function OrdersPipelineCard({
  newOrders,
  scheduled,
  inProduction,
  readyForPickup,
  onHold,
  slaRisk,
}: OrdersPipelineCardProps) {
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
        <div className="flex items-center justify-between text-sm"><span className="text-muted-foreground">New Orders</span><span className="font-semibold">{valueOrDash(newOrders)}</span></div>
        <div className="flex items-center justify-between text-sm"><span className="text-muted-foreground">Scheduled</span><span className="font-semibold">{valueOrDash(scheduled)}</span></div>
        <div className="flex items-center justify-between text-sm"><span className="text-muted-foreground">In Production</span><span className="font-semibold">{valueOrDash(inProduction)}</span></div>
        <div className="flex items-center justify-between text-sm"><span className="text-muted-foreground">Ready for Pickup</span><span className="font-semibold">{valueOrDash(readyForPickup)}</span></div>
        <div className="flex items-center justify-between text-sm"><span className="text-muted-foreground">On Hold</span><span className="font-semibold">{valueOrDash(onHold)}</span></div>

        <div className="border-t border-border pt-3">
          <div className="flex items-center gap-2 rounded-md border border-red-900/40 bg-red-950/20 p-2 text-sm text-red-300">
            <AlertCircle className="h-4 w-4" />
            <span>{slaRisk == null ? "Not available" : `${slaRisk} Orders at SLA Risk`}</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
