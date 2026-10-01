import type { ProductionDailyReport, ProductionDailyReportRequest } from "../../src/modules/production/productionDailyReport";
export type { ProductionDailyReport, ProductionDailyReportRow } from "../../src/modules/production/productionDailyReport";

export interface ProductionDailyReportClient {
  dailyReport(organizationId: string, request: ProductionDailyReportRequest, signal?: AbortSignal): Promise<ProductionDailyReport>;
}
/** Parent injects its authenticated API transport; this package owns no session or base-URL policy. */
export const createProductionDailyReportClient = (read: <T>(path: string, init: RequestInit) => Promise<T>): ProductionDailyReportClient => ({
  dailyReport(organizationId, request, signal) {
    const query = new URLSearchParams({ page: String(request.page ?? 1), pageSize: String(request.pageSize ?? 25), mode: request.mode ?? "page" });
    return read<ProductionDailyReport>(`/v2/organizations/${encodeURIComponent(organizationId)}/production/daily-report?${query}`, { method: "GET", signal, cache: "no-store" });
  },
});
