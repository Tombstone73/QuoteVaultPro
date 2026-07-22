import {
  assistantAttentionSummaryInputSchema,
  assistantAttentionSummaryResultSchema,
  assistantProductionQueueInputSchema,
  assistantProductionQueueResultSchema,
  type AssistantToolResultEnvelope,
} from "@shared/assistantContracts";
import { getProductionStationLabel } from "@shared/productionStations";
import type { OperationalSummary } from "../operationalSummary";
import {
  AssistantProductionReportingRepository,
  type AssistantProductionDateWindow,
  type AssistantProductionJobRecord,
  type AssistantProductionQueueFilters,
  type AssistantProductionStationRecord,
  type AssistantProductionStationAggregate,
} from "../../storage/assistantProductionReporting.repo";
import type { AssistantToolAdapters, AssistantTrustedToolContext } from "./toolRegistry";

type QueueInput = ReturnType<typeof assistantProductionQueueInputSchema.parse>;
type AttentionInput = ReturnType<typeof assistantAttentionSummaryInputSchema.parse>;

const FALLBACK_TIMEZONE = "UTC";
const SAFE_STATION_ROUTES: Record<string, string> = {
  design: "/production/design",
  prepress: "/production/prepress",
  flatbed: "/production/flatbed",
  roll: "/production/roll",
};

export interface AssistantProductionReportingToolDependencies {
  repository?: Pick<AssistantProductionReportingRepository, "getStations" | "getOrganizationTimezone" | "getStationAggregates" | "listUrgentJobs" | "getOldestActiveJob">;
  getOperationalSummary?: (organizationId: string) => Promise<OperationalSummary>;
  now?: () => Date;
  /** Test-only fallback when an organization has no configured IANA timezone. */
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

function zonedParts(date: Date, timezone: string) {
  const values = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  }).formatToParts(date);
  const part = (name: string) => Number(values.find((value) => value.type === name)?.value ?? 0);
  return { year: part("year"), month: part("month"), day: part("day"), hour: part("hour"), minute: part("minute"), second: part("second") };
}

function localMidnightToUtc(year: number, month: number, day: number, timezone: string): Date {
  // Convert a calendar midnight in the organization's timezone to an instant.
  // Reapplying the offset handles daylight-saving transitions without treating
  // the browser or Node host timezone as business data.
  const candidate = Date.UTC(year, month - 1, day);
  const initial = zonedParts(new Date(candidate), timezone);
  const observed = Date.UTC(initial.year, initial.month - 1, initial.day, initial.hour, initial.minute, initial.second);
  const adjusted = candidate - (observed - candidate);
  const final = zonedParts(new Date(adjusted), timezone);
  const finalObserved = Date.UTC(final.year, final.month - 1, final.day, final.hour, final.minute, final.second);
  return new Date(adjusted - (finalObserved - candidate));
}

export function productionDateWindow(now: Date, timezone: string): AssistantProductionDateWindow {
  const local = zonedParts(now, timezone);
  const cursor = new Date(Date.UTC(local.year, local.month - 1, local.day));
  const dateAtOffset = (offset: number) => {
    const next = new Date(cursor.getTime() + offset * 86_400_000);
    return localMidnightToUtc(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate(), timezone);
  };
  return { startOfToday: dateAtOffset(0), startOfTomorrow: dateAtOffset(1), startOfDayAfterTomorrow: dateAtOffset(2) };
}

function iso(value: Date | string | null | undefined): string | undefined {
  if (!value) return undefined;
  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
}

function displayStatus(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (normalized === "in_progress") return "In production";
  if (normalized === "queued") return "Queued";
  if (normalized === "paused") return "Paused";
  return normalized.replace(/[_-]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function stationLabel(stationKey: string): string {
  const canonical = getProductionStationLabel(stationKey);
  if (canonical !== "Auto / Suggested") return canonical;
  return stationKey.replace(/[_-]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function stationBoardLink(stationKey: string, capturedAt: string) {
  const label = stationLabel(stationKey);
  return { label: `View ${label} board`, href: SAFE_STATION_ROUTES[stationKey] ?? "/production", capturedAt };
}

function toUrgentJob(row: AssistantProductionJobRecord, dates: AssistantProductionDateWindow, capturedAt: string) {
  const dueDate = iso(row.dueDate);
  const overdue = Boolean(dueDate && new Date(dueDate).getTime() < dates.startOfToday.getTime());
  return {
    jobId: row.jobId,
    orderId: row.orderId,
    orderNumber: row.orderNumber,
    ...(row.customerName ? { customerName: row.customerName } : {}),
    label: row.label?.trim() || "Production job",
    stationKey: row.stationKey,
    stationLabel: stationLabel(row.stationKey),
    status: displayStatus(row.status),
    ...(dueDate ? { dueDate } : {}),
    overdue,
    sourceLink: { label: `Production job for order ${row.orderNumber}`, href: `/production/jobs/${row.jobId}`, entityType: "production_job" as const, entityId: row.jobId, capturedAt },
  };
}

function zeroAggregate(stationKey: string): AssistantProductionStationAggregate {
  return { stationKey, activeJobs: 0, queuedJobs: 0, inProductionJobs: 0, overdueJobs: 0, dueTodayJobs: 0, dueTomorrowJobs: 0 };
}

function sourceLinksFor(stations: Array<{ boardLink: { label: string; href: string; capturedAt: string } }>, urgentJobs: Array<{ sourceLink: any; orderId: string; orderNumber: string }>, capturedAt: string) {
  return [
    ...stations.map((station) => station.boardLink),
    ...urgentJobs.flatMap((job) => [job.sourceLink, { label: `Order ${job.orderNumber}`, href: `/orders/${job.orderId}`, entityType: "order" as const, entityId: job.orderId, capturedAt }]),
  ].slice(0, 10);
}

export function createAssistantProductionReportingToolAdapters(
  deps: AssistantProductionReportingToolDependencies = {},
): AssistantToolAdapters {
  const repository = deps.repository ?? new AssistantProductionReportingRepository();
  const now = deps.now ?? (() => new Date());
  const getOperationalSummary = deps.getOperationalSummary ?? (async (organizationId: string) => {
    const { computeOperationalSummary } = await import("../operationalSummary");
    return computeOperationalSummary(organizationId);
  });
  const resolveTimezone = async (organizationId: string) => validTimezone(
    ("getOrganizationTimezone" in repository ? await repository.getOrganizationTimezone(organizationId) : null) ?? deps.timezone,
  );

  const queue = async (rawInput: unknown, context: AssistantTrustedToolContext): Promise<AssistantToolResultEnvelope> => {
    const input = assistantProductionQueueInputSchema.parse(rawInput) as QueueInput;
    const [retrievedAt, stationsMetadata, timezone] = await Promise.all([
      Promise.resolve(now().toISOString()),
      repository.getStations(context.scope.organizationId),
      resolveTimezone(context.scope.organizationId),
    ]);
    const dates = productionDateWindow(new Date(retrievedAt), timezone);
    const filters: AssistantProductionQueueFilters = {
      ...(input.stationKey ? { stationKey: input.stationKey } : {}),
      ...(input.status ? { status: input.status } : {}),
      ...(input.due ? { due: input.due } : {}),
      ...(input.includeOverdue !== undefined ? { includeOverdue: input.includeOverdue } : {}),
    };
    const requestedStation = input.stationKey ? stationsMetadata.find((station) => station.key === input.stationKey) : undefined;
    if (input.stationKey && !requestedStation) return { status: "not_found", data: null };
    const [aggregates, jobs, oldest] = await Promise.all([
      repository.getStationAggregates(context.scope.organizationId, dates, filters),
      repository.listUrgentJobs(context.scope.organizationId, dates, { ...filters, limit: input.limit ?? 10 }),
      repository.getOldestActiveJob(context.scope.organizationId, filters),
    ]);
    const aggregateByStation = new Map(aggregates.map((aggregate) => [aggregate.stationKey, aggregate]));
    // The two canonical production boards are shown even when empty, while
    // every additional station represented by active tenant data is included.
    const metadataByKey = new Map(stationsMetadata.map((station) => [station.key, station]));
    const stationKeys = input.stationKey
      ? [input.stationKey]
      : stationsMetadata.map((station) => station.key);
    const urgentJobs = jobs.map((row) => toUrgentJob(row, dates, retrievedAt));
    const oldestJob = oldest ? toUrgentJob(oldest, dates, retrievedAt) : undefined;
    const stations = stationKeys.map((stationKey) => {
      const metadata = metadataByKey.get(stationKey)!;
      const aggregate = aggregateByStation.get(stationKey) ?? zeroAggregate(stationKey);
      const earliestDueJob = urgentJobs.find((job) => job.stationKey === stationKey && job.dueDate);
      return {
        stationKey,
        stationLabel: metadata.name || stationLabel(stationKey),
        active: metadata.active,
        activeJobs: aggregate.activeJobs,
        queuedJobs: aggregate.queuedJobs,
        inProductionJobs: aggregate.inProductionJobs,
        overdueJobs: aggregate.overdueJobs,
        dueTodayJobs: aggregate.dueTodayJobs,
        dueTomorrowJobs: aggregate.dueTomorrowJobs,
        ...(earliestDueJob ? { earliestDueJob } : {}),
        ...(oldestJob?.stationKey === stationKey ? { oldestActiveJob: oldestJob } : {}),
        boardLink: stationBoardLink(stationKey, retrievedAt),
      };
    });
    const warnings = input.stationKey && !aggregateByStation.has(input.stationKey)
      ? [`There are no active jobs in ${requestedStation!.name}.`]
      : [];
    const data = assistantProductionQueueResultSchema.parse({ stations, urgentJobs, timezone, warnings });
    return { status: "succeeded", data, provenance: { sourceLinks: sourceLinksFor(stations, urgentJobs, retrievedAt), freshness: { capturedAt: retrievedAt } } };
  };

  const attention = async (rawInput: unknown, context: AssistantTrustedToolContext): Promise<AssistantToolResultEnvelope> => {
    const input = assistantAttentionSummaryInputSchema.parse(rawInput) as AttentionInput;
    const [retrievedAt, stationsMetadata, timezone] = await Promise.all([
      Promise.resolve(now().toISOString()),
      repository.getStations(context.scope.organizationId),
      resolveTimezone(context.scope.organizationId),
    ]);
    const dates = productionDateWindow(new Date(retrievedAt), timezone);
    const productionFilters: AssistantProductionQueueFilters = input.stationKey ? { stationKey: input.stationKey } : {};
    if (input.stationKey && !stationsMetadata.some((station) => station.key === input.stationKey)) return { status: "not_found", data: null };
    const [aggregates, jobs, operational] = await Promise.all([
      repository.getStationAggregates(context.scope.organizationId, dates, productionFilters),
      repository.listUrgentJobs(context.scope.organizationId, dates, { ...productionFilters, limit: input.limit ?? 10 }),
      getOperationalSummary(context.scope.organizationId).catch(() => null),
    ]);
    const urgentJobs = jobs.map((row) => toUrgentJob(row, dates, retrievedAt));
    const metadataByKey = new Map(stationsMetadata.map((station) => [station.key, station]));
    const stations = aggregates.flatMap((aggregate) => {
      const metadata = metadataByKey.get(aggregate.stationKey);
      if (!metadata) return [];
      return [{
      stationKey: aggregate.stationKey, stationLabel: metadata.name || stationLabel(aggregate.stationKey), active: metadata.active,
      activeJobs: aggregate.activeJobs, queuedJobs: aggregate.queuedJobs, inProductionJobs: aggregate.inProductionJobs,
      overdueJobs: aggregate.overdueJobs, dueTodayJobs: aggregate.dueTodayJobs, dueTomorrowJobs: aggregate.dueTomorrowJobs,
      ...(urgentJobs.find((job) => job.stationKey === aggregate.stationKey && job.dueDate) ? { earliestDueJob: urgentJobs.find((job) => job.stationKey === aggregate.stationKey && job.dueDate) } : {}),
      boardLink: stationBoardLink(aggregate.stationKey, retrievedAt),
    }]; });
    const sum = (key: keyof AssistantProductionStationAggregate) => aggregates.reduce((total, item) => total + Number(item[key] ?? 0), 0);
    const categories = [
      { key: "overdue" as const, label: "Overdue production jobs", count: sum("overdueJobs"), available: true },
      { key: "due_today" as const, label: "Due today", count: sum("dueTodayJobs"), available: true },
      { key: "due_tomorrow" as const, label: "Due tomorrow", count: sum("dueTomorrowJobs"), available: true },
      { key: "waiting_artwork" as const, label: "Waiting on artwork", count: null, available: false, note: "Artwork-waiting is not represented by a single canonical migrated field." },
      { key: "waiting_proof" as const, label: "Waiting on proof", count: operational?.proofing ?? null, available: Boolean(operational), ...(operational ? {} : { note: "The canonical proof queue is unavailable right now." }) },
      { key: "waiting_prepress" as const, label: "Waiting on prepress", count: operational?.prepress ?? null, available: Boolean(operational), ...(operational ? {} : { note: "The canonical prepress queue is unavailable right now." }) },
      { key: "in_production" as const, label: "Currently in production", count: sum("inProductionJobs"), available: true },
      { key: "ready_for_fulfillment" as const, label: "Ready for fulfillment", count: operational?.fulfillment ?? null, available: Boolean(operational), ...(operational ? {} : { note: "The canonical fulfillment queue is unavailable right now." }) },
    ];
    const mostLoadedStation = [...stations].sort((a, b) => b.activeJobs - a.activeJobs || b.overdueJobs - a.overdueJobs || a.stationKey.localeCompare(b.stationKey))[0];
    const earliestDueJob = urgentJobs.find((job) => job.dueDate);
    const filterMap: Record<NonNullable<AttentionInput["filter"]>, string> = {
      overdue: "overdue", today: "due_today", tomorrow: "due_tomorrow", waiting_artwork: "waiting_artwork", waiting_proof: "waiting_proof", waiting_prepress: "waiting_prepress", in_production: "in_production", ready_for_fulfillment: "ready_for_fulfillment",
    };
    const filteredCategories = input.filter ? categories.filter((category) => category.key === filterMap[input.filter!]) : categories;
    const data = assistantAttentionSummaryResultSchema.parse({
      totalActiveJobs: sum("activeJobs"), categories: filteredCategories,
      ...(mostLoadedStation ? { mostLoadedStation } : {}), ...(earliestDueJob ? { earliestDueJob } : {}),
      attentionItems: urgentJobs, timezone,
      warnings: operational ? [] : ["Some workflow queue metrics are unavailable; active production-job metrics remain current."],
    });
    return { status: "succeeded", data, provenance: { sourceLinks: sourceLinksFor(stations, urgentJobs, retrievedAt), freshness: { capturedAt: retrievedAt } } };
  };

  return {
    "production.get_queue_summary": { execute: queue },
    "operations.get_attention_summary": { execute: attention },
  };
}
