import { Router, type Request } from "express";
import type { OperationContext } from "../../application/operation.js";
import type { Principal } from "../../authorization/principals.js";
import { V2ApplicationError, type ApplicationResult } from "../../errors/applicationError.js";
import type { ProductionDailyReport, ProductionDailyReportRequest } from "../../modules/production/productionDailyReport.js";

export type ProductionDailyReportHttpDependencies = Readonly<{
  service: { dailyReport(context: OperationContext, request: ProductionDailyReportRequest): Promise<ApplicationResult<ProductionDailyReport>> };
  principals: { principal(request: Request, organizationId: string): Promise<Principal> };
}>;
const number = (value: unknown, fallback: number) => {
  if (value === undefined) return fallback;
  if (typeof value !== "string" || !/^\d+$/.test(value)) throw new V2ApplicationError("VALIDATION_ERROR", "The report pagination is invalid.");
  return Number(value);
};
/** Parent mounts beneath the authenticated organization-scoped Production route. GET only. */
export const createProductionDailyReportRouter = (dependencies: ProductionDailyReportHttpDependencies): Router => {
  const router = Router({ mergeParams: true });
  router.get("/daily-report", async (request, response) => {
    response.setHeader("Cache-Control", "private, no-store");
    try {
      const organizationId = (request.params as { organizationId?: string }).organizationId;
      if (!organizationId) throw new V2ApplicationError("VALIDATION_ERROR", "organizationId is required.");
      const principal = await dependencies.principals.principal(request, organizationId);
      const mode = request.query.mode;
      if (mode !== undefined && mode !== "page" && mode !== "print") throw new V2ApplicationError("VALIDATION_ERROR", "The report mode is invalid.");
      const result = await dependencies.service.dailyReport({ principal, organizationId, operationId: `http:${request.method}:${request.path}` }, { page: number(request.query.page, 1), pageSize: number(request.query.pageSize, 25), mode: mode ?? "page" });
      if (!result.ok) throw result.error;
      response.status(200).json({ ok: true, data: result.value });
    } catch (cause) {
      const error = cause instanceof V2ApplicationError ? cause : new V2ApplicationError("INTERNAL_ERROR", "The Production daily report is unavailable.");
      const status = error.code === "VALIDATION_ERROR" ? 400 : error.code === "FORBIDDEN" ? 403 : error.code === "WRONG_TENANT" || error.code === "NOT_FOUND" ? 404 : error.code === "CONFLICT" ? 409 : 500;
      response.status(status).json({ ok: false, error: { code: error.code, message: error.publicMessage } });
    }
  });
  return router;
};
