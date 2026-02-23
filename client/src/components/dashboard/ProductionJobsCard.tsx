import { Factory } from "lucide-react";
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
  const stageRows = [
    { label: "Printing", value: printing },
    { label: "Finishing", value: finishing },
    { label: "QA / Inspection", value: qaInspection },
  ].filter((row) => row.value != null);

  const showBottleneck = !!(bottleneckLabel || bottleneckDetails);
  const showUnassigned = unassignedJobs != null;

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
        {(artworkPending != null || plateReady != null) && (
          <div className="grid grid-cols-2 gap-3">
            {artworkPending != null && (
              <div className="rounded-md border border-border bg-muted/30 p-3">
                <div className="text-xs text-muted-foreground">Artwork Pending</div>
                <div className="text-xl font-bold">{valueOrDash(artworkPending)}</div>
              </div>
            )}
            {plateReady != null && (
              <div className="rounded-md border border-border bg-muted/30 p-3">
                <div className="text-xs text-muted-foreground">Plate Ready</div>
                <div className="text-xl font-bold">{valueOrDash(plateReady)}</div>
              </div>
            )}
          </div>
        )}

        {stageRows.length > 0 && (
          <div className="space-y-2 border-l-2 border-border pl-3">
            {stageRows.map((row) => (
              <div key={row.label} className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">{row.label}</span>
                <span className="font-semibold">{valueOrDash(row.value)}</span>
              </div>
            ))}
          </div>
        )}

        {(showBottleneck || showUnassigned) && (
          <div className="space-y-2 border-t border-border pt-3">
            {showBottleneck && (
              <div className="rounded-md border border-border bg-muted/30 p-2 text-sm text-muted-foreground">
                <div className="leading-tight">
                  {bottleneckLabel ? <div>{bottleneckLabel}</div> : null}
                  {bottleneckDetails ? <div className="text-xs opacity-80">{bottleneckDetails}</div> : null}
                </div>
              </div>
            )}
            {showUnassigned && (
              <div className="text-center text-xs text-muted-foreground">
                Unassigned Jobs: <span className="font-semibold">{valueOrDash(unassignedJobs)}</span>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
