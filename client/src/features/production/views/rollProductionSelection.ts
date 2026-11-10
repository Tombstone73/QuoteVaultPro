import type { ProductionJobListItem } from "@/hooks/useProduction";

/** Board candidacy only. Canonical services revalidate ownership and workflow on execution. */
export function rollProductionSelectionBlocker(job: ProductionJobListItem): string | null {
  if (job.kind === "production_run") return "Owned by a Combined Run; use the run controls.";
  if (!job.id || !job.lineItemId || !((job as any).orderId || job.order?.id)) return "Production job is missing its Order or line item. Refresh and review its routing.";
  const station = String(job.stationKey ?? "").trim().toLowerCase();
  if (!station) return "Production station is missing. Review the job's routing before bulk production.";
  if (station !== "roll" && station !== "wide_roll") return `Owned by station ${station}; use that station's controls.`;
  if (!["queued", "in_progress", "paused"].includes(job.status)) return `Job is ${job.status}; reopen or restore it before bulk production.`;
  return null;
}

export type RollBulkTransition = "start" | "done" | "queued" | "in_progress";

export function rollProductionTransitionBlocker(job: ProductionJobListItem, action: RollBulkTransition): string | null {
  const structural = rollProductionSelectionBlocker(job);
  if (structural) return structural;
  if (action === "start") return job.status === "queued" ? null : `Job is ${job.status.replace(/_/g, " ")}; Start requires a queued job.`;
  return job.status === "in_progress" || job.status === "paused" ? null : `Job is ${job.status}; start production before ${action === "done" ? "completing" : "updating"} it.`;
}
