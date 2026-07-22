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
  type AssistantFulfillmentReadyOrderRecord,
  type AssistantProductionJobRecord,
  type AssistantProductionQueueFilters,
  type AssistantProductionScopeTotals,
  type AssistantProductionStationRecord,
  type AssistantProductionStationAggregate,
} from "../../storage/assistantProductionReporting.repo";
import { resolveAssistantStationReference } from "./assistantStationResolution";
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
  repository?: Pick<AssistantProductionReportingRepository, "getStations" | "getOrganizationTimezone" | "getStationAggregates" | "listUrgentJobs" | "listReadyForFulfillmentOrders" | "getOldestActiveJob"> & Partial<Pick<AssistantProductionReportingRepository, "getProductionScopeTotals">>;
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

function displayStatus(value: string | null | undefined): string {
  const normalized = value?.trim().toLowerCase() ?? "";
  if (!normalized) return "Unspecified";
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

function dueState(dueDate: string | undefined, dates: AssistantProductionDateWindow): "overdue" | "due_today" | "due_tomorrow" | "future" | "undated" {
  if (!dueDate) return "undated";
  const value = new Date(dueDate).getTime();
  if (value < dates.startOfToday.getTime()) return "overdue";
  if (value < dates.startOfTomorrow.getTime()) return "due_today";
  if (value < dates.startOfDayAfterTomorrow.getTime()) return "due_tomorrow";
  return "future";
}

function toUrgentJob(row: AssistantProductionJobRecord, dates: AssistantProductionDateWindow, capturedAt: string) {
  const dueDate = iso(row.dueDate);
  const state = dueState(dueDate, dates);
  const orderSourceLink = { label: `Order ${row.orderNumber}`, href: `/orders/${row.orderId}`, entityType: "order" as const, entityId: row.orderId, capturedAt };
  return {
    jobId: row.jobId,
    orderId: row.orderId,
    orderNumber: row.orderNumber,
    ...(row.customerName ? { customerName: row.customerName } : {}),
    ...(row.lineItemId ? { orderLineItemId: row.lineItemId } : { orderLineItemId: null }),
    ...(row.lineItemSequence ? { lineItemSequence: row.lineItemSequence } : {}),
    ...(row.lineItemLabel ? { lineItemLabel: row.lineItemLabel } : {}),
    ...(row.orderedQuantity !== null ? { orderedQuantity: row.orderedQuantity } : { orderedQuantity: null }),
    productionRequiredQuantity: null,
    completedQuantity: null,
    remainingQuantity: null,
    quantityUnit: row.quantityUnit,
    progressAvailable: false,
    progressSource: row.progressSource,
    progressWarning: row.progressWarning,
    label: row.label?.trim() || "Production job",
    stationKey: row.stationKey,
    stationLabel: stationLabel(row.stationKey),
    productionStep: displayStatus(row.productionStep),
    status: displayStatus(row.status),
    ...(dueDate ? { dueDate } : {}),
    dueState: state,
    overdue: state === "overdue",
    inclusionReason: state === "overdue" ? "Overdue production job" : "Active production job",
    orderSourceLink,
    sourceLink: { label: `Production job for order ${row.orderNumber}`, href: `/production/jobs/${row.jobId}`, entityType: "production_job" as const, entityId: row.jobId, capturedAt },
  };
}

/** Rows are grouped only for presentation. A job remains an individual item
 * inside its order; no matching labels, stations, or quantities are merged. */
function groupJobsByOrder(jobs: ReturnType<typeof toUrgentJob>[]) {
  const groups = new Map<string, { orderId: string; orderNumber: string; customerName?: string; dueDate?: string; dueState: ReturnType<typeof dueState>; orderSourceLink: ReturnType<typeof toUrgentJob>["orderSourceLink"]; items: ReturnType<typeof toUrgentJob>[] }>();
  for (const job of jobs) {
    const existing = groups.get(job.orderId);
    if (existing) { existing.items.push(job); continue; }
    groups.set(job.orderId, {
      orderId: job.orderId, orderNumber: job.orderNumber, ...(job.customerName ? { customerName: job.customerName } : {}),
      ...(job.dueDate ? { dueDate: job.dueDate } : {}), dueState: job.dueState, orderSourceLink: job.orderSourceLink, items: [job],
    });
  }
  return Array.from(groups.values());
}

function toAttentionItem(row: AssistantProductionJobRecord, dates: AssistantProductionDateWindow, capturedAt: string, reason: string) {
  return { ...toUrgentJob(row, dates, capturedAt), reason };
}

function toFulfillmentAttentionItem(row: AssistantFulfillmentReadyOrderRecord, dates: AssistantProductionDateWindow, capturedAt: string) {
  const dueDate = iso(row.dueDate);
  return {
    orderId: row.orderId,
    orderNumber: row.orderNumber,
    ...(row.customerName ? { customerName: row.customerName } : {}),
    label: "Ready for fulfillment",
    stationLabel: "Fulfillment",
    status: displayStatus(row.fulfillmentStatus || "ready"),
    ...(dueDate ? { dueDate } : {}),
    overdue: Boolean(dueDate && new Date(dueDate).getTime() < dates.startOfToday.getTime()),
    reason: "Ready for fulfillment",
    sourceLink: { label: `Order ${row.orderNumber}`, href: `/orders/${row.orderId}`, entityType: "order" as const, entityId: row.orderId, capturedAt },
  };
}

function zeroAggregate(stationKey: string): AssistantProductionStationAggregate {
  return {
    stationKey,
    activeJobs: 0,
    activeLineItems: 0,
    uniqueOrders: 0,
    progressAvailableJobs: 0,
    confirmedRemainingQuantity: null,
    queuedJobs: 0,
    inProductionJobs: 0,
    overdueJobs: 0,
    dueTodayJobs: 0,
    dueTomorrowJobs: 0,
  };
}

function sourceLinksFor(stations: Array<{ boardLink: { label: string; href: string; capturedAt: string } }>, urgentJobs: Array<{ sourceLink: any; orderId: string; orderNumber: string }>, capturedAt: string) {
  const links = [
    ...urgentJobs.map((job) => job.sourceLink),
    ...stations.map((station) => station.boardLink),
  ];
  return links.filter((link, index) => links.findIndex((candidate) => candidate.href === link.href) === index).slice(0, 10);
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
    const stationResolution = input.stationKey
      ? resolveAssistantStationReference(input.stationKey, stationsMetadata)
      : null;
    if (stationResolution && stationResolution.kind !== "unique") {
      const warning = stationResolution.kind === "ambiguous"
        ? `More than one active station matches ${stationResolution.query}. Choose one of: ${stationResolution.candidates.map((station) => station.name).join(", ")}.`
        : stationResolution.kind === "inactive"
          ? `${stationResolution.candidates.map((station) => station.name).join(", ")} is inactive. Choose an active production station.`
          : `No active production station matches ${stationResolution.query}. Try the station name shown on your production board.`;
      return { status: "not_found", data: null, warning };
    }
    const requestedStation = stationResolution?.station;
    const filters: AssistantProductionQueueFilters = {
      ...(requestedStation ? { stationKey: requestedStation.key } : {}),
      ...(input.status ? { status: input.status } : {}),
      ...(input.due ? { due: input.due } : {}),
      ...(input.includeOverdue !== undefined ? { includeOverdue: input.includeOverdue } : {}),
    };
    const [aggregates, jobs, oldest, totals] = await Promise.all([
      repository.getStationAggregates(context.scope.organizationId, dates, filters),
      repository.listUrgentJobs(context.scope.organizationId, dates, { ...filters, limit: input.limit ?? 10 }),
      repository.getOldestActiveJob(context.scope.organizationId, filters),
      repository.getProductionScopeTotals?.(context.scope.organizationId, dates, filters) ?? Promise.resolve<AssistantProductionScopeTotals | null>(null),
    ]);
    const aggregateByStation = new Map(aggregates.map((aggregate) => [aggregate.stationKey, aggregate]));
    // The two canonical production boards are shown even when empty, while
    // every additional station represented by active tenant data is included.
    const metadataByKey = new Map(stationsMetadata.map((station) => [station.key, station]));
    const stationKeys = requestedStation
      ? [requestedStation.key]
      : stationsMetadata.filter((station) => station.active).map((station) => station.key);
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
        uniqueLineItems: aggregate.activeLineItems,
        uniqueOrders: aggregate.uniqueOrders,
        remainingQuantity: aggregate.confirmedRemainingQuantity,
        progressAvailableJobs: aggregate.progressAvailableJobs,
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
    const warnings = [
      ...(requestedStation && !aggregateByStation.has(requestedStation.key) ? [`There are no active jobs in ${requestedStation!.name}.`] : []),
      ...((totals?.activeJobs ?? aggregates.reduce((sum, aggregate) => sum + aggregate.activeJobs, 0)) > 0 && !(totals?.progressAvailableJobs ?? 0)
        ? ["Ordered line quantity is available where linked, but completed and remaining print quantity are unavailable because production records do not store authoritative quantity progress."] : []),
    ];
    const data = assistantProductionQueueResultSchema.parse({ stations, urgentJobs, orderGroups: groupJobsByOrder(urgentJobs), timezone, warnings });
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
    const stationResolution = input.stationKey
      ? resolveAssistantStationReference(input.stationKey, stationsMetadata)
      : null;
    if (stationResolution && stationResolution.kind !== "unique") {
      const warning = stationResolution.kind === "ambiguous"
        ? `More than one active station matches ${stationResolution.query}. Choose one of: ${stationResolution.candidates.map((station) => station.name).join(", ")}.`
        : stationResolution.kind === "inactive"
          ? `${stationResolution.candidates.map((station) => station.name).join(", ")} is inactive. Choose an active production station.`
          : `No active production station matches ${stationResolution.query}. Try the station name shown on your production board.`;
      return { status: "not_found", data: null, warning };
    }
    const attentionFilter = input.filter ?? "all_attention";
    const productionFilters: AssistantProductionQueueFilters = stationResolution?.station ? { stationKey: stationResolution.station.key } : {};
    if (attentionFilter === "overdue") productionFilters.due = "overdue";
    if (attentionFilter === "today" || attentionFilter === "due_today") productionFilters.due = "today";
    if (attentionFilter === "tomorrow" || attentionFilter === "due_tomorrow") productionFilters.due = "tomorrow";
    if (attentionFilter === "in_production") productionFilters.status = "in_progress";
    if (attentionFilter === "waiting_prepress" && !productionFilters.stationKey) productionFilters.stationKey = "prepress";
    if (input.dueWithinDays) productionFilters.dueWithinDays = input.dueWithinDays;
    const requiresFulfillmentRecords = attentionFilter === "ready_for_fulfillment";
    // Artwork and proof queues have canonical counts, but no canonical
    // production-job identity. Returning generic jobs here would falsely
    // imply that they matched the requested filter.
    const unavailableItemFilter = attentionFilter === "waiting_artwork" || attentionFilter === "waiting_proof";
    const [aggregates, jobs, operational, totals] = await Promise.all([
      repository.getStationAggregates(context.scope.organizationId, dates, productionFilters),
      unavailableItemFilter || requiresFulfillmentRecords
        ? Promise.resolve([])
        : repository.listUrgentJobs(context.scope.organizationId, dates, { ...productionFilters, limit: input.limit ?? 10 }),
      getOperationalSummary(context.scope.organizationId).catch(() => null),
      repository.getProductionScopeTotals?.(context.scope.organizationId, dates, productionFilters) ?? Promise.resolve<AssistantProductionScopeTotals | null>(null),
    ]);
    const fulfillmentRows = requiresFulfillmentRecords
      ? await repository.listReadyForFulfillmentOrders(context.scope.organizationId, input.limit ?? 10)
      : [];
    const attentionReason = attentionFilter === "overdue" ? "Overdue"
      : attentionFilter === "today" || attentionFilter === "due_today" ? "Due today"
        : attentionFilter === "tomorrow" || attentionFilter === "due_tomorrow" ? "Due tomorrow"
          : attentionFilter === "in_production" ? "In production"
            : attentionFilter === "waiting_prepress" ? "Waiting on prepress"
              : attentionFilter === "urgent" ? "Urgent production work"
                : input.dueWithinDays ? `Due within ${input.dueWithinDays} day${input.dueWithinDays === 1 ? "" : "s"}`
                  : "Active production job";
    const urgentJobs = jobs.map((row) => toUrgentJob(row, dates, retrievedAt));
    const attentionItems = requiresFulfillmentRecords
      ? fulfillmentRows.map((row) => toFulfillmentAttentionItem(row, dates, retrievedAt))
      : jobs.map((row) => toAttentionItem(row, dates, retrievedAt, attentionReason));
    const metadataByKey = new Map(stationsMetadata.map((station) => [station.key, station]));
    const stations = aggregates.flatMap((aggregate) => {
      const metadata = metadataByKey.get(aggregate.stationKey);
      if (!metadata) return [];
      return [{
      stationKey: aggregate.stationKey, stationLabel: metadata.name || stationLabel(aggregate.stationKey), active: metadata.active,
      activeJobs: aggregate.activeJobs, queuedJobs: aggregate.queuedJobs, inProductionJobs: aggregate.inProductionJobs,
      uniqueLineItems: aggregate.activeLineItems, uniqueOrders: aggregate.uniqueOrders,
      remainingQuantity: aggregate.confirmedRemainingQuantity, progressAvailableJobs: aggregate.progressAvailableJobs,
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
    const filterMap: Partial<Record<NonNullable<AttentionInput["filter"]>, string>> = {
      overdue: "overdue", today: "due_today", due_today: "due_today", tomorrow: "due_tomorrow", due_tomorrow: "due_tomorrow", waiting_artwork: "waiting_artwork", waiting_proof: "waiting_proof", waiting_prepress: "waiting_prepress", in_production: "in_production", ready_for_fulfillment: "ready_for_fulfillment",
    };
    const categoryKey = input.filter ? filterMap[input.filter] : undefined;
    const filteredCategories = categoryKey ? categories.filter((category) => category.key === categoryKey) : categories;
    const data = assistantAttentionSummaryResultSchema.parse({
      totalActiveJobs: totals?.activeJobs ?? sum("activeJobs"),
      ...(totals ? { totalActiveLineItems: totals.activeLineItems, totalActiveOrders: totals.uniqueOrders, remainingQuantity: totals.confirmedRemainingQuantity, progressAvailableJobs: totals.progressAvailableJobs } : {}),
      categories: filteredCategories,
      ...(mostLoadedStation ? { mostLoadedStation } : {}), ...(earliestDueJob ? { earliestDueJob } : {}),
      attentionItems,
      ...(!requiresFulfillmentRecords && urgentJobs.length ? { orderGroups: groupJobsByOrder(urgentJobs) } : {}),
      timezone,
      warnings: [
        ...(operational ? [] : ["Some workflow queue metrics are unavailable; active production-job metrics remain current."]),
        ...(unavailableItemFilter
          ? [attentionFilter === "waiting_artwork"
            ? "Artwork-waiting is unavailable because no single canonical migrated field identifies matching jobs."
            : "The proof queue count is current, but it cannot safely be joined to a production-job identity here."]
          : []),
        ...(requiresFulfillmentRecords && operational && operational.fulfillment > attentionItems.length
          ? [`Showing the first ${attentionItems.length} of ${operational.fulfillment} ready-for-fulfillment orders.`]
          : []),
        ...(requiresFulfillmentRecords
          ? ["Fulfillment readiness is order-workflow based. Print progress cannot be independently verified because production records do not store authoritative completed quantities."]
          : []),
        ...((totals?.activeJobs ?? sum("activeJobs")) > 0 && !(totals?.progressAvailableJobs ?? 0)
          ? ["Completed and remaining print quantities are unavailable for active production jobs because no authoritative quantity-progress source is persisted."]
          : []),
      ],
    });
    return { status: "succeeded", data, provenance: { sourceLinks: sourceLinksFor(stations, attentionItems, retrievedAt), freshness: { capturedAt: retrievedAt } } };
  };

  return {
    "production.get_queue_summary": { execute: queue },
    "operations.get_attention_summary": { execute: attention },
  };
}
