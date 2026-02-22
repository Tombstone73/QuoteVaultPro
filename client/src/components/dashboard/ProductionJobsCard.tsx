import { Factory, Hourglass } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type ProductionJobsCardProps = {
  artworkPending?: number | null;
  plateReady?: number | null;
  printing?: number | null;
  finishing?: number | null;
  qaInspection?: number | null;
  bottleneckLabel?: string | null;
  bottleneckDetails?: string | null;
  unassignedJobs?: number | null;
};

function valueOrDash(value?: number | null) {
  return value ?? "—";
}

export default function ProductionJobsCard({
  artworkPending,
  plateReady,
  printing,
  finishing,
  qaInspection,
  bottleneckLabel,
  bottleneckDetails,
  unassignedJobs,
}: ProductionJobsCardProps) {
  return (
    <Card className="border-border bg-card h-full">
      <CardHeader className="flex-row items-center justify-between space-y-0 border-b border-border pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Factory className="h-4 w-4 text-primary" />
          Production & Jobs
        </CardTitle>
        <Badge variant="outline" className="text-[10px] uppercase tracking-wide text-muted-foreground">
          Floor View
        </Badge>
      </CardHeader>
      <CardContent className="space-y-4 pt-4">
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-md border border-border bg-muted/30 p-3">
            <div className="text-xs text-muted-foreground">Artwork Pending</div>
            <div className="text-xl font-bold">{valueOrDash(artworkPending)}</div>
          </div>
          <div className="rounded-md border border-border bg-muted/30 p-3">
            <div className="text-xs text-muted-foreground">Plate Ready</div>
            <div className="text-xl font-bold">{valueOrDash(plateReady)}</div>
          </div>
        </div>

        <div className="space-y-2 border-l-2 border-border pl-3">
          <div className="flex items-center justify-between text-sm"><span className="text-muted-foreground">Printing</span><span className="font-semibold">{valueOrDash(printing)}</span></div>
          <div className="flex items-center justify-between text-sm"><span className="text-muted-foreground">Finishing</span><span className="font-semibold">{valueOrDash(finishing)}</span></div>
          <div className="flex items-center justify-between text-sm"><span className="text-muted-foreground">QA / Inspection</span><span className="font-semibold">{valueOrDash(qaInspection)}</span></div>
        </div>

        <div className="space-y-2 border-t border-border pt-3">
          <div className="flex items-center gap-2 rounded-md border border-orange-900/40 bg-orange-950/20 p-2 text-sm text-orange-300">
            <Hourglass className="h-4 w-4" />
            <div className="leading-tight">
              <div>{bottleneckLabel || "Not available"}</div>
              <div className="text-xs text-orange-200/70">{bottleneckDetails || "Not available"}</div>
            </div>
          </div>
          <div className="text-center text-xs text-muted-foreground">Unassigned Jobs: <span className="font-semibold">{valueOrDash(unassignedJobs)}</span></div>
        </div>
      </CardContent>
    </Card>
  );
}
