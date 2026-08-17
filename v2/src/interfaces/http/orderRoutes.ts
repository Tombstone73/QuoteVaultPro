import type { Request, Response, Router } from "express";
import { Router as expressRouter } from "express";
import type { OperationContext } from "../../application/operation.js";
import type { Principal } from "../../authorization/principals.js";
import {
  type ApplicationResult,
  V2ApplicationError,
} from "../../errors/applicationError.js";
import { brandedId, type OrderId } from "../../modules/shared/commercialValues.js";
import { AuthorityPolicy } from "../../authorization/authorityPolicy.js";
import type { SalesWorkspaceReadPort } from "../../modules/sales/workspaceReads.js";

/**
 * HTTP is deliberately an adapter over a future Order application service.
 * It obtains an authenticated, freshly-issued Principal and never accepts one
 * from request headers or bodies. Command validation and commercial rules
 * remain inside Sales, not in this transport boundary.
 */
export interface OrderHttpService {
  create(
    context: OperationContext,
    input: Readonly<Record<string, unknown>>,
  ): Promise<ApplicationResult<unknown>>;
  read(
    context: OperationContext,
    orderId: OrderId,
  ): Promise<ApplicationResult<unknown>>;
  update(
    context: OperationContext,
    input: Readonly<Record<string, unknown>>,
  ): Promise<ApplicationResult<unknown>>;
}

/** Authentication is injected by the trusted V2 host, never by a browser claim. */
export interface VerifiedV2OrderPrincipalProvider {
  principal(request: Request, organizationId: string): Promise<Principal>;
}

export type OrderHttpDependencies = Readonly<{
  service: OrderHttpService;
  principals: VerifiedV2OrderPrincipalProvider;
  workspace?: SalesWorkspaceReadPort;
}>;

const status = (code: string): number =>
  code === "VALIDATION_ERROR"
    ? 400
    : code === "FORBIDDEN"
      ? 403
      : code === "NOT_FOUND" || code === "WRONG_TENANT"
        ? 404
        : code === "CONFLICT" ||
              code === "STALE_STATE" ||
              code === "IDEMPOTENCY_CONFLICT"
          ? 409
          : code === "RETRYABLE_FAILURE"
            ? 503
            : 500;

const error = (response: Response, cause: unknown): void => {
  const safe =
    cause instanceof V2ApplicationError
      ? cause
      : new V2ApplicationError(
          "INTERNAL_ERROR",
          "Order operation could not be completed.",
        );
  response.status(status(safe.code)).json({
    ok: false,
    error: { code: safe.code, message: safe.publicMessage },
  });
};

const body = (value: unknown): Readonly<Record<string, unknown>> => {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new V2ApplicationError(
      "VALIDATION_ERROR",
      "An Order command object is required.",
    );
  return value as Readonly<Record<string, unknown>>;
};

const businessRequestId = (value: unknown): string => {
  const id = body(value).businessRequestId;
  if (typeof id !== "string" || !id.trim())
    throw new V2ApplicationError(
      "VALIDATION_ERROR",
      "businessRequestId is required.",
    );
  return id;
};

const context = async (
  request: Request,
  dependencies: OrderHttpDependencies,
  mutation = false,
): Promise<OperationContext> => {
  const organizationId = request.params.organizationId;
  if (!organizationId)
    throw new V2ApplicationError(
      "VALIDATION_ERROR",
      "organizationId is required.",
    );
  const principal = await dependencies.principals.principal(
    request,
    organizationId,
  );
  return {
    principal,
    organizationId,
    operationId: `http:${request.method}:${request.path}`,
    ...(mutation
      ? {
          businessRequest: {
            id: businessRequestId(request.body),
            // Sales derives the actual canonical fingerprint from its command.
            payloadFingerprint: "route-fingerprint-is-derived-by-operation",
          },
        }
      : {}),
  };
};

const send = (response: Response, result: ApplicationResult<unknown>): void => {
  if (!result.ok) return error(response, result.error);
  response
    .status(200)
    .type("application/json")
    .send(
      JSON.stringify(
        { ok: true, data: result.value },
        (_key, value: unknown) =>
          typeof value === "bigint" ? value.toString() : value,
      ),
    );
};

const commandForOrder = (
  request: Request,
): Readonly<Record<string, unknown>> => ({
  ...body(request.body),
  // The path is authoritative; a body value cannot retarget the Order.
  orderId: brandedId<"OrderId">(request.params.orderId),
});

/**
 * Authenticated transport only. It does not implement Sales, Billing,
 * Routing, persistence, or document calculations.
 */
export const createOrderRouter = (dependencies: OrderHttpDependencies): Router => {
  const router = expressRouter({ mergeParams: true });

  router.post("/", async (request, response) => {
    try {
      send(
        response,
        await dependencies.service.create(
          await context(request, dependencies, true),
          body(request.body),
        ),
      );
    } catch (cause) {
      error(response, cause);
    }
  });

  router.get("/", async (request, response) => {
    try {
      if (!dependencies.workspace)
        throw new V2ApplicationError("INTERNAL_ERROR", "Order list runtime is unavailable.");
      const operation = await context(request, dependencies);
      if (!new AuthorityPolicy().decide(operation.principal, { capability: "order.view", resource: { organizationId: operation.organizationId } }).allowed)
        throw new V2ApplicationError("FORBIDDEN", "Order access is unavailable.");
      const limit = Number(request.query.limit ?? 25);
      const data = await dependencies.workspace.listOrders(brandedId<"OrganizationId">(operation.organizationId), {
        ...(Number.isFinite(limit) ? { limit } : {}),
        ...(typeof request.query.cursor === "string" ? { cursor: request.query.cursor } : {}),
        ...(typeof request.query.q === "string" ? { search: request.query.q } : {}),
        ...(typeof request.query.lifecycle === "string" ? { lifecycle: request.query.lifecycle } : {}),
      });
      response.status(200).json({ ok: true, data });
    } catch (cause) { error(response, cause); }
  });

  router.get("/legacy/:recordId", async (request, response) => {
    try {
      if (!dependencies.workspace) throw new V2ApplicationError("INTERNAL_ERROR", "Order list runtime is unavailable.");
      const operation = await context(request, dependencies);
      if (!new AuthorityPolicy().decide(operation.principal, { capability: "order.view", resource: { organizationId: operation.organizationId } }).allowed)
        throw new V2ApplicationError("FORBIDDEN", "Order access is unavailable.");
      const value = await dependencies.workspace.readLegacyOrder(brandedId<"OrganizationId">(operation.organizationId), request.params.recordId);
      if (!value) throw new V2ApplicationError("NOT_FOUND", "Legacy Order was not found.");
      response.status(200).json({ ok: true, data: value });
    } catch (cause) { error(response, cause); }
  });

  router.get("/:orderId", async (request, response) => {
    try {
      send(
        response,
        await dependencies.service.read(
          await context(request, dependencies),
          brandedId<"OrderId">(request.params.orderId),
        ),
      );
    } catch (cause) {
      error(response, cause);
    }
  });

  router.patch("/:orderId", async (request, response) => {
    try {
      send(
        response,
        await dependencies.service.update(
          await context(request, dependencies, true),
          commandForOrder(request),
        ),
      );
    } catch (cause) {
      error(response, cause);
    }
  });

  return router;
};
