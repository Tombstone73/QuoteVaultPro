import { Router, type Request } from "express";
import { AuthorityPolicy } from "../../authorization/authorityPolicy.js";
import { V2ApplicationError } from "../../errors/applicationError.js";
import type { Principal } from "../../authorization/principals.js";
import type { RoutingWorkspaceReadPort } from "../../modules/routing/workspaceReads.js";
import type { RoutingLifecycleApplicationService } from "../../modules/routing/routingLifecycle.js";
import type { RouteInstanceId } from "../../modules/shared/commercialValues.js";
import type { OperationContext } from "../../application/operation.js";

export type RoutingHttpDependencies = Readonly<{
  workspace: RoutingWorkspaceReadPort;
  service: RoutingLifecycleApplicationService;
  principals: Readonly<{ principal(request: Request, organizationId: string): Promise<Principal> }>;
}>;

const status = (code: string): number => code === "VALIDATION_ERROR" ? 400 : code === "FORBIDDEN" ? 403 : code === "NOT_FOUND" || code === "WRONG_TENANT" ? 404 : code === "CONFLICT" || code === "STALE_STATE" || code === "IDEMPOTENCY_CONFLICT" ? 409 : 500;
const body = (value: unknown): Readonly<Record<string, unknown>> => { if (!value || typeof value !== "object" || Array.isArray(value)) throw new V2ApplicationError("VALIDATION_ERROR", "A Routing command object is required."); return value as Readonly<Record<string, unknown>>; };
const context = async (request: Request, dependencies: RoutingHttpDependencies): Promise<OperationContext> => { const organizationId = request.params.organizationId; if (!organizationId) throw new V2ApplicationError("VALIDATION_ERROR", "organizationId is required."); const command = body(request.body); const businessRequestId = command.businessRequestId; if (typeof businessRequestId !== "string" || !businessRequestId.trim()) throw new V2ApplicationError("VALIDATION_ERROR", "businessRequestId is required."); return { principal: await dependencies.principals.principal(request, organizationId), organizationId, operationId: `http:${request.method}:${request.path}`, businessRequest: { id: businessRequestId, payloadFingerprint: "routing-fingerprint-is-derived-by-operation" } }; };

/** Read-first Routing transport plus a narrow named frozen-route transition. */
export const createRoutingRouter = (dependencies: RoutingHttpDependencies): Router => {
  const router = Router({ mergeParams: true });
  router.get("/workspace", async (request, response) => {
    try {
      const organizationId = (request.params as Readonly<{ organizationId?: string }>).organizationId;
      if (!organizationId) throw new V2ApplicationError("VALIDATION_ERROR", "organizationId is required.");
      const principal = await dependencies.principals.principal(request, organizationId);
      if (!new AuthorityPolicy().decide(principal, { capability: "route.view", resource: { organizationId } }).allowed)
        throw new V2ApplicationError("FORBIDDEN", "You do not have permission to view Routing.");
      response.json({ ok: true, data: await dependencies.workspace.workspace(organizationId) });
    } catch (error) {
      const cause = error instanceof V2ApplicationError ? error : new V2ApplicationError("INTERNAL_ERROR", "Routing workspace is unavailable.");
      response.status(cause.code === "FORBIDDEN" ? 403 : cause.code === "VALIDATION_ERROR" ? 400 : 500).json({ ok: false, error: { code: cause.code, message: cause.publicMessage } });
    }
  });
  router.post("/instances/:routeInstanceId/complete-current", async (request, response) => {
    try {
      const command = body(request.body);
      const expectedRevision = command.expectedRevision;
      if (typeof expectedRevision !== "string" || !expectedRevision.trim()) throw new V2ApplicationError("VALIDATION_ERROR", "expectedRevision is required.");
      const routeInstanceId = request.params.routeInstanceId;
      if (!routeInstanceId?.trim()) throw new V2ApplicationError("VALIDATION_ERROR", "routeInstanceId is required.");
      const result = await dependencies.service.completeCurrentStep(await context(request, dependencies), { businessRequestId: command.businessRequestId as string, routeInstanceId: routeInstanceId as RouteInstanceId, expectedRevision });
      if (!result.ok) return response.status(status(result.error.code)).json({ ok: false, error: { code: result.error.code, message: result.error.publicMessage } });
      return response.status(200).json({ ok: true, data: result.value });
    } catch (error) {
      const cause = error instanceof V2ApplicationError ? error : new V2ApplicationError("INTERNAL_ERROR", "Routing transition is unavailable.");
      return response.status(status(cause.code)).json({ ok: false, error: { code: cause.code, message: cause.publicMessage } });
    }
  });
  return router;
};
