import { addMonths, format, isSameMonth, subMonths } from "date-fns";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { ProductionJobListItem } from "@/hooks/useProduction";
import { cn } from "@/lib/utils";
import { getProductionOrderNumber } from "@/lib/productionDocumentNumbers";
import type { ProductionDocumentNumberDisplayMode } from "@shared/documentNumbering";
import {
  buildProductionCalendarDays,
  groupProductionJobsByDueDate,
  productionDueUrgency,
  resolveProductionOverviewDueDate,
} from "./productionOverviewCalendarModel";

type ProductionOverviewCalendarProps = {
  jobs: ProductionJobListItem[];
  month: Date;
  onMonthChange: (month: Date) => void;
  onOpenJob: (jobId: string) => void;
  stationLabels: ReadonlyMap<string, string>;
  documentNumberDisplayMode: ProductionDocumentNumberDisplayMode;
  now?: Date;
};

const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function CalendarJob({
  job,
  stationLabel,
  documentNumberDisplayMode,
  onOpen,
  now,
}: {
  job: ProductionJobListItem;
  stationLabel: string;
  documentNumberDisplayMode: ProductionDocumentNumberDisplayMode;
  onOpen: () => void;
  now: Date;
}) {
  const dueDate = resolveProductionOverviewDueDate(job);
  const urgency = productionDueUrgency(dueDate, now);
  const priority = String(job.order.priority || "normal").toLowerCase();
  const number = getProductionOrderNumber(job, documentNumberDisplayMode) || job.order.orderNumber;

  return (
    <button
      type="button"
      onClick={onOpen}
      data-testid={`production-calendar-job-${job.id}`}
      data-urgency={urgency}
      className={cn(
        "w-full rounded-md border px-2 py-2 text-left text-xs transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        urgency === "overdue" && "border-red-500/60 bg-red-500/10",
        urgency === "today" && "border-amber-500/70 bg-amber-500/10",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="font-semibold">{number}{job.lineNumber ? ` · Line ${job.lineNumber}` : ""}</span>
        {priority !== "normal" ? <Badge variant="outline" className="h-4 px-1 text-[9px] uppercase">{priority}</Badge> : null}
      </div>
      <div className="mt-1 truncate font-medium">{job.order.customerName}</div>
      <div className="truncate text-muted-foreground">{job.media || job.jobDescription || "Production job"}</div>
      <div className="mt-1 flex items-center justify-between gap-2 text-[10px] text-muted-foreground">
        <span className="truncate">{stationLabel}</span>
        <span className="shrink-0 capitalize">{job.status.replace(/_/g, " ")}</span>
      </div>
    </button>
  );
}

export function ProductionOverviewCalendar({
  jobs,
  month,
  onMonthChange,
  onOpenJob,
  stationLabels,
  documentNumberDisplayMode,
  now = new Date(),
}: ProductionOverviewCalendarProps) {
  const days = buildProductionCalendarDays(month);
  const grouped = groupProductionJobsByDueDate(jobs);

  const renderJob = (job: ProductionJobListItem) => (
    <CalendarJob
      key={job.id}
      job={job}
      stationLabel={stationLabels.get(String(job.stationKey ?? "")) ?? job.stationKey ?? "Unassigned"}
      documentNumberDisplayMode={documentNumberDisplayMode}
      onOpen={() => onOpenJob(job.id)}
      now={now}
    />
  );

  return (
    <div className="min-w-0 space-y-4" data-testid="production-calendar-view">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0 pb-3">
          <div className="flex items-center gap-2">
            <CalendarDays className="h-5 w-5 text-muted-foreground" />
            <CardTitle className="text-base">{format(month, "MMMM yyyy")}</CardTitle>
          </div>
          <div className="flex items-center gap-1">
            <Button variant="outline" size="icon" className="h-8 w-8" aria-label="Previous month" onClick={() => onMonthChange(subMonths(month, 1))}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button variant="outline" size="sm" className="h-8" onClick={() => onMonthChange(new Date())}>Today</Button>
            <Button variant="outline" size="icon" className="h-8 w-8" aria-label="Next month" onClick={() => onMonthChange(addMonths(month, 1))}>
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="max-w-full overflow-x-auto overscroll-x-contain [scrollbar-gutter:stable]">
            <div className="min-w-[980px]" data-testid="production-calendar-grid">
              <div className="grid grid-cols-7 border-y bg-muted/40">
                {weekdays.map((day) => <div key={day} className="px-2 py-2 text-xs font-semibold text-muted-foreground">{day}</div>)}
              </div>
              <div className="grid grid-cols-7">
                {days.map((day) => {
                  const key = format(day, "yyyy-MM-dd");
                  const dayJobs = grouped.byDate.get(key) ?? [];
                  return (
                    <div
                      key={key}
                      data-date={key}
                      className={cn(
                        "min-h-[150px] border-b border-r p-2 first:border-l",
                        !isSameMonth(day, month) && "bg-muted/20 text-muted-foreground",
                      )}
                    >
                      <div className="mb-2 text-xs font-semibold">{format(day, "d")}</div>
                      <div className="space-y-1.5">{dayJobs.map(renderJob)}</div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card data-testid="production-calendar-no-due-date">
        <CardHeader className="pb-3"><CardTitle className="text-base">No due date ({grouped.noDueDate.length})</CardTitle></CardHeader>
        <CardContent>
          {grouped.noDueDate.length ? (
            <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">{grouped.noDueDate.map(renderJob)}</div>
          ) : <p className="text-sm text-muted-foreground">Every visible production job has a due date.</p>}
        </CardContent>
      </Card>
    </div>
  );
}
