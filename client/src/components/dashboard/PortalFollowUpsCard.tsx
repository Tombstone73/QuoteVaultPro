import { Link } from "react-router-dom";
import { AlertCircle, CheckCircle2, Clock3, ExternalLink } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { usePortalFollowUps, useUpdatePortalFollowUpStatus, type PortalFollowUpDto } from "@/hooks/usePortalFollowUps";
import { cn } from "@/lib/utils";

function formatRelativeDate(value: string | null): string {
  if (!value) return "Recently";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Recently";
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function statusLabel(status: PortalFollowUpDto["status"]): string {
  if (status === "pending") return "Pending";
  if (status === "completed") return "Completed";
  return "New";
}

function statusClass(status: PortalFollowUpDto["status"]): string {
  if (status === "pending") return "border-blue-200 bg-blue-50 text-blue-700";
  if (status === "completed") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  return "border-amber-200 bg-amber-50 text-amber-700";
}

export function PortalFollowUpsCard({ enabled }: { enabled: boolean }) {
  const { data, isLoading, isError } = usePortalFollowUps(enabled);
  const updateStatus = useUpdatePortalFollowUpStatus();

  if (!enabled || isError) return null;

  const items = data?.items ?? [];
  const count = data?.unresolvedCount ?? 0;

  if (!isLoading && count === 0) return null;

  return (
    <Card className="mb-6 border-l-4 border-l-sky-600 bg-sky-50/80 dark:bg-sky-950/20">
      <CardContent className="p-4">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="flex items-start gap-3">
            <div className="rounded-full bg-sky-100 p-2 dark:bg-sky-900/40">
              <AlertCircle className="h-5 w-5 text-sky-700 dark:text-sky-300" />
            </div>
            <div>
              <h3 className="font-semibold text-sm text-sky-950 dark:text-sky-100">Customer Portal Follow-Ups</h3>
              <p className="text-sm text-sky-800 dark:text-sky-200">
                {isLoading ? "Checking recent customer actions..." : `${count} unresolved customer ${count === 1 ? "action" : "actions"}`}
              </p>
            </div>
          </div>

          {items.length > 0 && (
            <div className="grid flex-1 gap-2">
              {items.map((item) => (
                <div
                  key={item.id}
                  className="flex flex-col gap-3 rounded-md border border-sky-200 bg-white/80 p-3 shadow-sm dark:border-sky-900/50 dark:bg-slate-950/40 md:flex-row md:items-center md:justify-between"
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="truncate text-sm font-medium text-slate-950 dark:text-slate-100">{item.title}</p>
                      <Badge variant="outline" className={cn("h-5 text-[11px]", statusClass(item.status))}>
                        {statusLabel(item.status)}
                      </Badge>
                    </div>
                    <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">
                      {[item.customerName, item.followUpArea, formatRelativeDate(item.createdAt)].filter(Boolean).join(" - ")}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {item.actionUrl && (
                      <Button asChild variant="ghost" size="sm" className="h-8 px-2">
                        <Link to={item.actionUrl} aria-label={`Open ${item.title}`}>
                          <ExternalLink className="h-4 w-4" />
                        </Link>
                      </Button>
                    )}
                    {item.status === "new" && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-8"
                        onClick={() => updateStatus.mutate({ id: item.id, status: "pending" })}
                        disabled={updateStatus.isPending}
                      >
                        <Clock3 className="mr-1.5 h-4 w-4" />
                        Acknowledge
                      </Button>
                    )}
                    {item.status !== "completed" && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-8"
                        onClick={() => updateStatus.mutate({ id: item.id, status: "completed" })}
                        disabled={updateStatus.isPending}
                      >
                        <CheckCircle2 className="mr-1.5 h-4 w-4" />
                        Resolve
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
