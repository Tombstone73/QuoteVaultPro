import { Router, type Request, type Response } from "express";
import type { Principal, PortalPrincipal } from "../../authorization/principals.js";
import { V2ApplicationError } from "../../errors/applicationError.js";
import type { PortalArtworkApplicationService } from "../../modules/portal/portalArtwork.js";
import { parseArtworkMultipart } from "./artworkRoutes.js";

export type PortalArtworkHttpDependencies = Readonly<{
  portalPrincipal: Readonly<{ principal(request: Request): Promise<Principal> }>;
  service: PortalArtworkApplicationService;
}>;

const status = (code: string): number => code === "VALIDATION_ERROR" ? 400 : code === "FORBIDDEN" ? 403 : code === "NOT_FOUND" || code === "WRONG_TENANT" ? 404 : code === "CONFLICT" || code === "STALE_STATE" || code === "IDEMPOTENCY_CONFLICT" ? 409 : code === "RETRYABLE_FAILURE" ? 503 : 500;
const fail = (response: Response, cause: unknown) => {
  const error = cause instanceof V2ApplicationError ? cause : new V2ApplicationError("INTERNAL_ERROR", "Artwork upload is unavailable.");
  return response.status(status(error.code)).json({ ok: false, error: { code: error.code, message: error.publicMessage } });
};

const principal = async (dependencies: PortalArtworkHttpDependencies, request: Request): Promise<PortalPrincipal> => {
  const actor = await dependencies.portalPrincipal.principal(request);
  if (actor.kind !== "portal") throw new V2ApplicationError("FORBIDDEN", "Portal access is required.");
  return actor;
};

/** POST /v2/portal/orders/:orderId/lines/:orderLineId/artwork: customer source only. */
export const createPortalArtworkRouter = (dependencies: PortalArtworkHttpDependencies) => {
  const router = Router();
  router.post("/orders/:orderId/lines/:orderLineId/artwork", async (request, response) => {
    try {
      const input = await parseArtworkMultipart(request);
      if (input.purpose && input.purpose !== "customer_supplied")
        throw new V2ApplicationError("VALIDATION_ERROR", "Portal uploads are customer-supplied source Artwork only.");
      if (input.side !== undefined && input.side !== "front" && input.side !== "back")
        throw new V2ApplicationError("VALIDATION_ERROR", "Artwork side is invalid.");
      if (input.supersedesArtworkAssignmentId || input.layerKey !== undefined || input.layerOrder !== undefined)
        throw new V2ApplicationError("VALIDATION_ERROR", "Portal Artwork replacement and layered Artwork are unavailable.");
      if ((input.orderId && input.orderId !== request.params.orderId) || (input.orderLineId && input.orderLineId !== request.params.orderLineId))
        throw new V2ApplicationError("VALIDATION_ERROR", "Artwork Order scope must match the request path.");
      const result = await dependencies.service.upload(await principal(dependencies, request), {
        businessRequestId: input.businessRequestId,
        orderId: request.params.orderId,
        orderLineId: request.params.orderLineId,
        ...(input.side ? { side: input.side } : {}),
        ...(input.sourcePageIndex !== undefined ? { sourcePageIndex: input.sourcePageIndex } : {}),
        filename: input.filename,
        contentType: input.contentType,
        bytes: input.bytes,
      });
      if (!result.ok) return fail(response, result.error);
      return response.status(201).json({ ok: true, data: result.value });
    } catch (cause) { return fail(response, cause); }
  });
  return router;
};
