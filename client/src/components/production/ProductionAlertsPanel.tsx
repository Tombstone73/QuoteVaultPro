import type React from "react";
import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  type ProductionAlertSummary,
  useAcknowledgeProductionAlert,
} from "@/hooks/useProduction";

function formatAlertType(value: string): string {
  return value
    .split("_")
    .filter(Boolean)
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1))
    .join(" ");
}

function formatDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function alertClasses(severity: ProductionAlertSummary["severity"]) {
  switch (severity) {
    case "critical":
      return {
        wrapper: "border-red-500 bg-red-950/65 text-red-50 shadow-[0_0_0_1px_rgba(239,68,68,0.35)]",
        label: "text-red-100",
        message: "text-red-50",
        badge: "bg-red-100 text-red-900 border-red-200",
        icon: "text-red-200",
      };
    case "warning":
      return {
        wrapper: "border-amber-400/70 bg-amber-950/45 text-amber-50",
        label: "text-amber-100",
        message: "text-amber-50",
        badge: "bg-amber-100 text-amber-900 border-amber-200",
        icon: "text-amber-200",
      };
    default:
      return {
        wrapper: "border-sky-400/50 bg-sky-950/35 text-sky-50",
        label: "text-sky-100",
        message: "text-sky-50",
        badge: "bg-sky-100 text-sky-900 border-sky-200",
        icon: "text-sky-200",
      };
  }
}

export function ProductionAlertsPanel({
  alerts,
  productionJobId,
  showAcknowledge = true,
  compact = false,
  empty = null,
}: {
  alerts: ProductionAlertSummary[] | undefined | null;
  productionJobId?: string;
  showAcknowledge?: boolean;
  compact?: boolean;
  empty?: React.ReactNode;
}) {
  const acknowledge = useAcknowledgeProductionAlert(productionJobId);
  const visibleAlerts = (alerts ?? []).filter((alert) => alert.status !== "cancelled" && alert.status !== "archived");

  if (visibleAlerts.length === 0) {
    return empty ? <>{empty}</> : null;
  }

  return (
    <div className={cn("space-y-2", compact && "space-y-1.5")}>
      {visibleAlerts.map((alert) => {
        const styles = alertClasses(alert.severity);
        const acknowledged = alert.status === "acknowledged" || !!alert.acknowledgedAt;
        const created = formatDate(alert.createdAt);
        const acknowledgedAt = formatDate(alert.acknowledgedAt);

        return (
          <div
            key={alert.id}
            className={cn(
              "rounded-md border px-3 py-2",
              compact ? "text-xs" : "text-sm",
              styles.wrapper,
              acknowledged && "opacity-85",
            )}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className={cn("flex items-center gap-2 font-bold uppercase tracking-wide", styles.label)}>
                  <AlertTriangle className={cn("h-4 w-4 shrink-0", styles.icon)} />
                  {alert.severity === "critical" ? "Special Production Alert" : "Production Alert"}
                </div>
                <div className={cn("mt-1 break-words font-semibold", alert.severity === "critical" ? "text-base" : "text-sm")}>
                  {alert.title}
                </div>
                {alert.message ? (
                  <div className={cn("mt-1 whitespace-pre-wrap break-words", styles.message)}>
                    {alert.message}
                  </div>
                ) : null}
                <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] opacity-90">
                  <Badge variant="outline" className={styles.badge}>
                    {formatAlertType(alert.alertType)}
                  </Badge>
                  <span>{alert.severity.toUpperCase()}</span>
                  {created ? <span>Created {created}</span> : null}
                  {acknowledged ? (
                    <span className="inline-flex items-center gap-1">
                      <CheckCircle2 className="h-3 w-3" />
                      Acknowledged{acknowledgedAt ? ` ${acknowledgedAt}` : ""}
                    </span>
                  ) : null}
                </div>
              </div>
              {showAcknowledge && !acknowledged ? (
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  onClick={() => acknowledge.mutate(alert.id)}
                  disabled={acknowledge.isPending}
                  className="shrink-0 bg-white/90 text-slate-950 hover:bg-white"
                >
                  Acknowledge
                </Button>
              ) : null}
            </div>
          </div>
        );
      })}
    </div>
  );
}
