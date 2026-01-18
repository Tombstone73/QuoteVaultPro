import { useMemo, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { ROUTES } from "@/config/routes";
import {
  ProductionJobListItem,
  useCompleteProductionJob,
  useProductionJobs,
  useReopenProductionJob,
  useStartProductionTimer,
  useStopProductionTimer,
} from "@/hooks/useProduction";
import { Play, Square, CheckCircle2, RotateCcw } from "lucide-react";

type ProductionStatus = "queued" | "in_progress" | "done";

function formatSeconds(totalSeconds: number) {
  const s = Math.max(0, Math.floor(totalSeconds));
  const hh = Math.floor(s / 3600);
  const mm = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(hh)}:${pad(mm)}:${pad(ss)}`;
}

function ProductionJobCard({ job }: { job: ProductionJobListItem }) {
  const navigate = useNavigate();
  const start = useStartProductionTimer(job.id);
  const stop = useStopProductionTimer(job.id);
  const complete = useCompleteProductionJob(job.id);
  const reopen = useReopenProductionJob(job.id);

  const [tickSeconds, setTickSeconds] = useState(job.timer.currentSeconds);

  useEffect(() => {
    setTickSeconds(job.timer.currentSeconds);
  }, [job.timer.currentSeconds]);

  useEffect(() => {
    if (!job.timer.isRunning) return;
    const t = window.setInterval(() => {
      setTickSeconds((prev) => prev + 1);
    }, 1000);
    return () => window.clearInterval(t);
  }, [job.timer.isRunning]);

  const dueLabel = useMemo(() => {
    if (!job.order.dueDate) return null;
    const d = new Date(job.order.dueDate);
    if (Number.isNaN(d.getTime())) return null;
    return d.toLocaleDateString();
  }, [job.order.dueDate]);

  const isBusy = start.isPending || stop.isPending || complete.isPending || reopen.isPending;

  return (
    <Card className="bg-titan-bg-card border-titan-border-subtle hover:border-titan-border transition-colors">
      <CardHeader className="p-4 pb-2">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-sm font-semibold text-titan-text-primary truncate">
              {job.order.customerName}
            </div>
            <div className="text-xs text-titan-text-muted truncate">
              Order {job.order.orderNumber}
              {dueLabel ? ` • Due ${dueLabel}` : ""}
            </div>
          </div>
          <div className="flex items-center gap-2">
            {job.order.priority === "rush" && <Badge variant="destructive">RUSH</Badge>}
            <Badge variant="outline" className="text-titan-text-secondary">
              {job.status.replace("_", " ")}
            </Badge>
          </div>
        </div>
      </CardHeader>

      <CardContent className="p-4 pt-2">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-xs text-titan-text-muted">Timer</div>
            <div className="text-lg font-mono text-titan-text-primary">{formatSeconds(tickSeconds)}</div>
            {job.timer.isRunning && (
              <div className="text-xs text-titan-text-secondary">Running</div>
            )}
          </div>

          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant={job.timer.isRunning ? "secondary" : "default"}
              onClick={() => (job.timer.isRunning ? stop.mutate() : start.mutate())}
              disabled={isBusy}
            >
              {job.timer.isRunning ? (
                <>
                  <Square className="w-4 h-4 mr-2" /> Stop
                </>
              ) : (
                <>
                  <Play className="w-4 h-4 mr-2" /> Start
                </>
              )}
            </Button>

            {job.status !== "done" ? (
              <Button
                size="sm"
                variant="outline"
                onClick={() => complete.mutate({ skipProduction: job.status === "queued" })}
                disabled={isBusy}
              >
                <CheckCircle2 className="w-4 h-4 mr-2" /> Complete
              </Button>
            ) : (
              <Button size="sm" variant="outline" onClick={() => reopen.mutate()} disabled={isBusy}>
                <RotateCcw className="w-4 h-4 mr-2" /> Reopen
              </Button>
            )}

            <Button
              size="sm"
              variant="ghost"
              onClick={() => navigate(ROUTES.production.jobDetail(job.id))}
            >
              Details
            </Button>
          </div>
        </div>

        <Separator className="my-3" />

        <div className="flex items-center justify-between text-xs text-titan-text-muted">
          <div>Reprints: {job.reprintCount}</div>
          <Button
            size="sm"
            variant="link"
            className="h-auto p-0 text-xs"
            onClick={() => navigate(ROUTES.orders.detail(job.order.id))}
          >
            Open order
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export default function FlatbedProductionView(props: { viewKey: string; status: ProductionStatus }) {
  const { data, isLoading, error } = useProductionJobs({ status: props.status, view: props.viewKey });

  if (isLoading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {Array.from({ length: 6 }).map((_, i) => (
          <Card key={i} className="bg-titan-bg-card border-titan-border-subtle">
            <CardContent className="p-4">
              <div className="h-4 w-1/2 bg-titan-bg-muted rounded" />
              <div className="h-3 w-1/3 bg-titan-bg-muted rounded mt-2" />
              <div className="h-8 w-2/3 bg-titan-bg-muted rounded mt-4" />
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <Card className="bg-titan-bg-card border-titan-border-subtle">
        <CardContent className="p-4 text-sm text-titan-text-muted">
          Failed to load production jobs.
        </CardContent>
      </Card>
    );
  }

  const jobs = data || [];

  if (jobs.length === 0) {
    if (props.status === "queued") {
      return (
        <Card className="bg-titan-bg-card border-titan-border-subtle">
          <CardContent className="p-6">
            <div className="text-sm font-medium text-titan-text-primary">No production jobs yet</div>
            <div className="mt-1 text-sm text-titan-text-muted">
              Production jobs are created from Orders. Open an order and click <span className="font-medium">Production Job</span>
              to generate the first job.
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <Button asChild size="sm">
                <Link to={ROUTES.orders.list}>Go to Orders</Link>
              </Button>
              <Button asChild size="sm" variant="outline">
                <Link to={ROUTES.settings.production}>Production Settings</Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      );
    }

    return (
      <Card className="bg-titan-bg-card border-titan-border-subtle">
        <CardContent className="p-4 text-sm text-titan-text-muted">No jobs in this state.</CardContent>
      </Card>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
      {jobs.map((job) => (
        <ProductionJobCard key={job.id} job={job} />
      ))}
    </div>
  );
}
