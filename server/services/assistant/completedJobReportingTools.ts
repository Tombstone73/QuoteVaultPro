import {
  assistantCompletedJobReportInputSchema,
  assistantCompletedJobReportResultSchema,
  type AssistantToolResultEnvelope,
} from "@shared/assistantContracts";
import type { AssistantCompletedJobReportingRepository } from "../../storage/assistantCompletedJobReporting.repo";
import type { AssistantOrderDueSummaryRepository } from "../../storage/assistantOrderDueSummary.repo";
import { AssistantToolExecutionError } from "./orchestration";
import { lastWeekThroughCurrentWeekWindow } from "./orderDueSummaryTools";
import type { AssistantToolAdapters } from "./toolRegistry";

const FALLBACK_TIMEZONE = "UTC";

export interface AssistantCompletedJobReportingToolDependencies {
  repository?: Pick<AssistantCompletedJobReportingRepository, "countCompletedJobs" | "listCompletedJobs">;
  timezoneRepository?: Pick<AssistantOrderDueSummaryRepository, "getOrganizationTimezone">;
  now?: () => Date;
  timezone?: string;
}

function validTimezone(value: string | undefined): string {
  try {
    if (value) new Intl.DateTimeFormat("en-US", { timeZone: value });
    return value || FALLBACK_TIMEZONE;
  } catch {
    return FALLBACK_TIMEZONE;
  }
}

function numberOrNull(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

/** Read-only customer-scoped production completion report. Completion is
 * defined solely by a completed production job with its canonical completedAt
 * timestamp inside the requested tenant-calendar range. */
export function createAssistantCompletedJobReportingToolAdapters(deps: AssistantCompletedJobReportingToolDependencies = {}): AssistantToolAdapters {
  const now = deps.now ?? (() => new Date());
  return {
    "production.get_completed_jobs": {
      async execute(rawInput, context): Promise<AssistantToolResultEnvelope> {
        const input = assistantCompletedJobReportInputSchema.parse(rawInput);
        if (!input.customer.id) throw new AssistantToolExecutionError("adapter_failed", "adapter_failed", "resolve_customer");
        const repository = deps.repository ?? new (await import("../../storage/assistantCompletedJobReporting.repo")).AssistantCompletedJobReportingRepository();
        const timezoneRepository = deps.timezoneRepository ?? new (await import("../../storage/assistantOrderDueSummary.repo")).AssistantOrderDueSummaryRepository();
        const timezone = validTimezone(await timezoneRepository.getOrganizationTimezone(context.scope.organizationId) ?? deps.timezone);
        const capturedAt = now();
        const dates = lastWeekThroughCurrentWeekWindow(capturedAt, timezone);
        if (!dates.rangeStart || !dates.rangeEnd) throw new AssistantToolExecutionError("adapter_failed", "adapter_failed", "date_window");
        const filters = { customerId: input.customer.id, limit: input.limit ?? 10 };
        let totalMatchingJobs: number;
        let rows: Awaited<ReturnType<AssistantCompletedJobReportingRepository["listCompletedJobs"]>>;
        try {
          [totalMatchingJobs, rows] = await Promise.all([
            repository.countCompletedJobs(context.scope.organizationId, dates as Required<typeof dates>, filters),
            repository.listCompletedJobs(context.scope.organizationId, dates as Required<typeof dates>, filters),
          ]);
        } catch {
          throw new AssistantToolExecutionError("core_query_failed", "core_query_failed", "lookup_completed_jobs");
        }
        const warnings = totalMatchingJobs > rows.length
          ? [`Showing the first ${rows.length} of ${totalMatchingJobs} completed jobs.`]
          : [];
        const data = assistantCompletedJobReportResultSchema.parse({
          totalMatchingJobs,
          jobs: rows.map((row) => ({
            productionJobId: row.productionJobId,
            orderId: row.orderId,
            orderNumber: row.orderNumber,
            customerName: row.customerName,
            productOrLineItemDescription: row.productOrLineItemDescription || "Production job",
            completedAt: new Date(row.completedAt).toISOString(),
            quantity: numberOrNull(row.quantity),
            productionStatus: row.productionStatus,
            invoiceState: row.invoiceState,
            sourceLink: { label: `Production job for ${row.orderNumber}`, href: `/production/jobs/${row.productionJobId}`, entityType: "production_job" as const, entityId: row.productionJobId, capturedAt: new Date(row.completedAt).toISOString() },
            orderSourceLink: { label: `Order ${row.orderNumber}`, href: `/orders/${row.orderId}`, entityType: "order" as const, entityId: row.orderId, capturedAt: new Date(row.completedAt).toISOString() },
          })),
          timezone,
          warnings,
        });
        return {
          status: "succeeded",
          data,
          provenance: {
            sourceLinks: data.jobs.map((job) => job.sourceLink),
            freshness: { capturedAt: capturedAt.toISOString() },
          },
          ...(warnings.length ? { warning: warnings.join(" ") } : {}),
        };
      },
    },
  };
}
