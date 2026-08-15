import type { Request, Response, Router } from "express";
import { Router as expressRouter } from "express";
import type { OperationContext } from "../../application/operation.js";
import type { Principal } from "../../authorization/principals.js";
import { V2ApplicationError } from "../../errors/applicationError.js";
import type {
  CreateQuoteInput,
  QuoteApplicationService,
  QuoteLifecycleInput,
  UpdateQuoteInput,
} from "../../modules/sales/quoteApplication.js";
import { brandedId } from "../../modules/shared/commercialValues.js";

/** Authentication is injected by the real V2 host; routes never trust headers or body principal claims. */
export interface VerifiedV2PrincipalProvider {
  principal(request: Request, organizationId: string): Promise<Principal>;
}
export type QuoteHttpDependencies = Readonly<{
  service: QuoteApplicationService;
  principals: VerifiedV2PrincipalProvider;
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
const error = (response: Response, value: unknown): void => {
  const safe =
    value instanceof V2ApplicationError
      ? value
      : new V2ApplicationError(
          "INTERNAL_ERROR",
          "Quote operation could not be completed.",
        );
  response
    .status(status(safe.code))
    .json({
      ok: false,
      error: { code: safe.code, message: safe.publicMessage },
    });
};
const requestId = (body: unknown): string => {
  const value =
    body && typeof body === "object"
      ? (body as { businessRequestId?: unknown }).businessRequestId
      : undefined;
  if (typeof value !== "string" || !value.trim())
    throw new V2ApplicationError(
      "VALIDATION_ERROR",
      "businessRequestId is required.",
    );
  return value;
};
const context = async (
  request: Request,
  dependencies: QuoteHttpDependencies,
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
            id: requestId(request.body),
            payloadFingerprint: "route-fingerprint-is-derived-by-operation",
          },
        }
      : {}),
  };
};
const send = async (
  response: Response,
  result: Awaited<ReturnType<QuoteApplicationService["create"]>>,
): Promise<void> => {
  if (!result.ok) return error(response, result.error);
  response.status(200).json({ ok: true, data: result.value });
};

export const createQuoteRouter = (
  dependencies: QuoteHttpDependencies,
): Router => {
  const router = expressRouter({ mergeParams: true });
  router.post("/", async (request, response) => {
    try {
      await send(
        response,
        await dependencies.service.create(
          await context(request, dependencies, true),
          request.body as CreateQuoteInput,
        ),
      );
    } catch (cause) {
      error(response, cause);
    }
  });
  router.get("/:quoteId", async (request, response) => {
    try {
      const result = await dependencies.service.read(
        await context(request, dependencies),
        brandedId<"QuoteId">(request.params.quoteId),
      );
      if (!result.ok) return error(response, result.error);
      response.status(200).json({ ok: true, data: result.value });
    } catch (cause) {
      error(response, cause);
    }
  });
  router.patch("/:quoteId", async (request, response) => {
    try {
      const body = {
        ...(request.body as Omit<UpdateQuoteInput, "quoteId">),
        quoteId: brandedId<"QuoteId">(request.params.quoteId),
      };
      await send(
        response,
        await dependencies.service.update(
          await context(request, dependencies, true),
          body,
        ),
      );
    } catch (cause) {
      error(response, cause);
    }
  });
  for (const action of ["send", "accept"] as const)
    router.post(`/:quoteId/${action}`, async (request, response) => {
      try {
        const body: QuoteLifecycleInput = {
          businessRequestId: requestId(request.body),
          quoteId: brandedId<"QuoteId">(request.params.quoteId),
          expectedRevision: String(
            (request.body as { expectedRevision?: unknown }).expectedRevision ??
              "",
          ),
        };
        await send(
          response,
          await dependencies.service[action](
            await context(request, dependencies, true),
            body,
          ),
        );
      } catch (cause) {
        error(response, cause);
      }
    });
  return router;
};
