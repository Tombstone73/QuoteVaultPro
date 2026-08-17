import { Router, type Request } from "express";
import { AuthorityPolicy } from "../../authorization/authorityPolicy.js";
import { V2ApplicationError } from "../../errors/applicationError.js";
import type { Principal } from "../../authorization/principals.js";
import type { RoutingWorkspaceReadPort } from "../../modules/routing/workspaceReads.js";

export type RoutingHttpDependencies = Readonly<{
  workspace: RoutingWorkspaceReadPort;
  principals: Readonly<{ principal(request: Request, organizationId: string): Promise<Principal> }>;
}>;

/** Read-first Routing transport. Template/workflow mutations require named Routing operations. */
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
  return router;
};
