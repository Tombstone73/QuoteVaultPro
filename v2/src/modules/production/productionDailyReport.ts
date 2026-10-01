import { requireOperationPrincipalScope, type OperationContext } from "../../application/operation.js";
import { AuthorityPolicy } from "../../authorization/authorityPolicy.js";
import { failure, success, V2ApplicationError, type ApplicationResult } from "../../errors/applicationError.js";
import { brandedId, type OrganizationId } from "../shared/commercialValues.js";
import type { ProductionStationKey, ProductionWorkState } from "./contracts.js";

/** Settings supplies these calendar dates. No browser or local timezone arithmetic participates. */
export type ProductionCalendar = Readonly<{
  asOf: string;
  timeZone: string;
  todayDate: string;
  tomorrowDate: string;
}>;
export type ProductionDueCategory = "overdue" | "today" | "tomorrow" | "future" | "undated";
export type ProductionDailyReportRequest = Readonly<{ page?: number; pageSize?: number; mode?: "page" | "print" }>;
export type ProductionDailyReportScope = Readonly<{
  productionWorkId: string;
  orderId: string;
  orderLineId: string;
  requirementKey: string;
  replacementObligationId?: string;
}>;
/** Owner-provided operational result, independent of payment/Invoice settlement.
 * Work/line/unit identities retain original and exact replacement scopes independently.
 * A completed line must not inherit attention from another line on the same Order.
 * Only lineage-resolved scopes are submitted. An omitted replacement ID is not
 * evidence of original scope until the Production ancestry read establishes it.
 * Missing/invalid results fail the read; a policy blocker excludes only that work.
 * The adapter supplying this result must use the caller's read-only snapshot, not another pool.
 */
export type ProductionDailyReportAttention = Readonly<ProductionDailyReportScope & (
  | { state: "requires_attention" | "operationally_complete" }
  | { state: "blocked"; reason: string }
)>;
/** Blocked work has no inferred original/replacement classification or destination. */
export type ProductionDailyReportBlockedWork = Readonly<{
  productionWorkId: string;
  orderId: string;
  orderLineId: string;
  requirementKey: string;
  reasonCode: "unresolved_replacement_rework_lineage" | "conflicting_frozen_station" | "owner_policy_ambiguity";
  reason: string;
}>;
export type ProductionDailyReportRow = Readonly<{
  productionWorkId: string;
  orderId: string;
  orderLineId: string;
  requirementKey: string;
  replacementObligationId: string | null;
  predecessorProductionWorkId: string | null;
  reworkCycleId: string | null;
  destination: ProductionStationKey | "unknown";
  dueDate: string | null;
  dueCategory: ProductionDueCategory;
  orderNumber: string | null;
  customerName: string | null;
  purchaseOrderNumber: string | null;
  jobLabel: string | null;
  lineDescription: string | null;
  requestedFulfillment: "pickup" | "shipping" | "local_delivery" | "not_recorded";
  orderedQuantity: number;
  remainingGoodQuantity: number;
  activeAttemptId: string | null;
  state: ProductionWorkState;
}>;
export type ProductionDailyReportSummaryFact = Pick<ProductionDailyReportRow, "productionWorkId" | "orderId" | "destination" | "dueDate" | "activeAttemptId">;
export type ProductionDailyReportSummary = Readonly<{
  totalActive: number;
  overdue: number;
  dueToday: number;
  dueTomorrow: number;
  future: number;
  noDue: number;
  roll: number;
  flatbed: number;
  unknownDestination: number;
  distinctOrders: number;
  activeAttempts: number;
}>;
export type ProductionDailyReport = Readonly<{
  calendar: ProductionCalendar;
  summary: ProductionDailyReportSummary;
  rows: readonly ProductionDailyReportRow[];
  blockedWork: readonly ProductionDailyReportBlockedWork[];
  pagination: Readonly<{ page: number; pageSize: number; totalPages: number; totalCount: number }>;
  coverage: Readonly<{ truncated: boolean; countsComplete: boolean; candidateLimit: number; blockedWorkCount: number }>;
  mode: "page" | "print";
}>;
export interface ProductionDailyReportReadPort {
  readDailyReport(organizationId: OrganizationId, request: Required<ProductionDailyReportRequest>): Promise<ProductionDailyReport>;
}

export const normalizeProductionDailyReportRequest = (request: ProductionDailyReportRequest = {}): Required<ProductionDailyReportRequest> => {
  const { page = 1, pageSize = 25, mode = "page" } = request;
  if (!Number.isSafeInteger(page) || page < 1 || page > 1_000_000 || !Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 100 || (mode !== "page" && mode !== "print"))
    throw new V2ApplicationError("VALIDATION_ERROR", "The Production report page, page size, or mode is invalid.");
  return { page, pageSize, mode };
};
export const validateProductionCalendar = (calendar: ProductionCalendar): void => {
  const date = /^\d{4}-\d{2}-\d{2}$/;
  if (!date.test(calendar.todayDate) || !date.test(calendar.tomorrowDate) || calendar.todayDate >= calendar.tomorrowDate || !calendar.timeZone?.trim() || !/T.*(?:Z|[+-]\d{2}:\d{2})$/.test(calendar.asOf) || !Number.isFinite(Date.parse(calendar.asOf)))
    throw new V2ApplicationError("INTERNAL_ERROR", "The organization reporting calendar is unavailable.");
};
export const productionDueCategory = (dueDate: string | null, calendar: ProductionCalendar): ProductionDueCategory => {
  if (dueDate === null) return "undated";
  if (dueDate < calendar.todayDate) return "overdue";
  if (dueDate === calendar.todayDate) return "today";
  if (dueDate === calendar.tomorrowDate) return "tomorrow";
  return "future";
};
/** Counts the supplied eligible population only. It makes no lifecycle or successor-supply decision. */
export const summarizeProductionDailyReport = (rows: readonly ProductionDailyReportSummaryFact[], calendar: ProductionCalendar): ProductionDailyReportSummary => {
  const summary = { totalActive: 0, overdue: 0, dueToday: 0, dueTomorrow: 0, future: 0, noDue: 0, roll: 0, flatbed: 0, unknownDestination: 0, distinctOrders: 0, activeAttempts: 0 };
  const works = new Set<string>(), orders = new Set<string>(), attempts = new Set<string>();
  for (const row of rows) {
    if (works.has(row.productionWorkId)) throw new V2ApplicationError("CONFLICT", "The Production report contains duplicate work identities.");
    works.add(row.productionWorkId); orders.add(row.orderId);
    if (row.activeAttemptId) attempts.add(row.activeAttemptId);
    summary.totalActive++;
    const category = productionDueCategory(row.dueDate, calendar);
    summary[category === "today" ? "dueToday" : category === "tomorrow" ? "dueTomorrow" : category === "undated" ? "noDue" : category]++;
    summary[row.destination === "unknown" ? "unknownDestination" : row.destination]++;
  }
  return { ...summary, distinctOrders: orders.size, activeAttempts: attempts.size };
};

export class ProductionDailyReportService {
  constructor(private readonly read: ProductionDailyReportReadPort, private readonly authority = new AuthorityPolicy()) {}
  async dailyReport(context: OperationContext, request: ProductionDailyReportRequest = {}): Promise<ApplicationResult<ProductionDailyReport>> {
    try {
      requireOperationPrincipalScope(context);
      if (!this.authority.decide(context.principal, { capability: "production.view", resource: { organizationId: context.organizationId } }).allowed)
        throw new V2ApplicationError("FORBIDDEN", "You do not have permission to view the Production daily report.");
      return success(await this.read.readDailyReport(brandedId<"OrganizationId">(context.organizationId), normalizeProductionDailyReportRequest(request)));
    } catch (error) {
      return failure(error instanceof V2ApplicationError ? error : new V2ApplicationError("INTERNAL_ERROR", "The Production daily report is unavailable."));
    }
  }
}
