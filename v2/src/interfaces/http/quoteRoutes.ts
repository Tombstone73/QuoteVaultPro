import type { Request, Response, Router } from "express";
import { Router as expressRouter } from "express";
import type { OperationContext } from "../../application/operation.js";
import type { Principal } from "../../authorization/principals.js";
import { V2ApplicationError } from "../../errors/applicationError.js";
import { AuthorityPolicy } from "../../authorization/authorityPolicy.js";
import type {
  CreateQuoteInput,
  QuoteApplicationService,
  QuoteLifecycleInput,
  QuoteOperationResult,
  QuoteReadModel,
  UpdateQuoteInput,
} from "../../modules/sales/quoteApplication.js";
import { brandedId } from "../../modules/shared/commercialValues.js";

/** Authentication is injected by the real V2 host; routes never trust headers or body principal claims. */
export interface VerifiedV2PrincipalProvider {
  principal(request: Request, organizationId: string): Promise<Principal>;
}
export interface QuoteFormReadPort {
  customers(organizationId: string, query?: string): Promise<readonly Readonly<{ customerId: string; displayName: string }>[]>;
  contacts(organizationId: string, customerId: string): Promise<readonly Readonly<{ contactId: string; displayName: string }>[]>;
  products(organizationId: string, query?: string): Promise<readonly Readonly<{ productId: string; displayName: string; measurementMode: "dimensions_required" | "quantity_only"; requiresDimensions: boolean }>[]>;
  configuration(organizationId: string, productId: string, selections?: Record<string, unknown>): Promise<unknown | null>;
}
export type QuoteHttpDependencies = Readonly<{
  service: QuoteApplicationService;
  principals: VerifiedV2PrincipalProvider;
  formReads: QuoteFormReadPort;
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
  response.status(status(safe.code)).json({
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
/** Browser projection: commercial facts only; no repository or PBV2 editor state. */
const quoteForUi = (value: QuoteReadModel) => {
  const lines = value.quote.lines.map((line, index) => ({
    lineId: line.lineId,
    position: index + 1,
    productId: line.productId,
    ...(line.productTypeId ? { productTypeId: line.productTypeId } : {}),
    description: line.description,
    quantity: line.quantity,
    resolvedConfiguration: line.resolvedConfiguration,
    calculatedUnitAmount: line.pricingResult.calculatedUnitAmount,
    calculatedLineAmount: line.calculatedLineAmount,
    sellingUnitAmount: line.sellingPriceDecision.resultingUnitAmount,
    sellingLineAmount: line.sellingLineAmount,
    sellingPriceDecision: line.sellingPriceDecision,
  }));
  const currency = value.quote.currency;
  return {
    quote: {
      quoteId: value.quote.quoteId,
      customerContact: value.quote.customerContact,
      purchaseOrderNumber: value.quote.purchaseOrderNumber,
      requestedDueDate: value.quote.requestedDueDate,
      terms: value.quote.terms,
      currency,
      expiresAt: value.quote.expiresAt,
      deliveryState: value.quote.deliveryState,
      acceptanceState: value.quote.acceptanceState,
      lines,
    },
    number: value.number,
    revision: value.revision,
    checkpoints: value.checkpoints,
    totals: {
      currency,
      calculatedLineAmount: {
        currency,
        cents: lines.reduce((total, line) => total + line.calculatedLineAmount.cents, 0),
      },
      sellingLineAmount: {
        currency,
        cents: lines.reduce((total, line) => total + line.sellingLineAmount.cents, 0),
      },
    },
  };
};
const uiResult = (value: QuoteOperationResult) => ({
  quote: quoteForUi(value.quote),
  ...(value.checkpointId ? { checkpointId: value.checkpointId } : {}),
});
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
  response
    .status(200)
    .type("application/json")
    .send(
      JSON.stringify(
        { ok: true, data: uiResult(result.value) },
        (_key, value: unknown) =>
          typeof value === "bigint" ? value.toString() : value,
      ),
    );
};

export const createQuoteRouter = (
  dependencies: QuoteHttpDependencies,
): Router => {
  const router = expressRouter({ mergeParams: true });
  const readForm = async (request: Request, response: Response, read: () => Promise<unknown>) => {
    try {
      const operation = await context(request, dependencies);
      if (!new AuthorityPolicy().decide(operation.principal, { capability: "quote.view", resource: { organizationId: operation.organizationId } }).allowed)
        throw new V2ApplicationError("FORBIDDEN", "Quote access is unavailable.");
      response.json({ ok: true, data: await read() });
    } catch (cause) { error(response, cause); }
  };
  router.get("/form/customers", (request, response) => readForm(request, response, () => dependencies.formReads.customers(String((request.params as Record<string, string>).organizationId), String(request.query.q ?? ""))));
  router.get("/form/customers/:customerId/contacts", (request, response) => readForm(request, response, () => dependencies.formReads.contacts(String((request.params as Record<string, string>).organizationId), request.params.customerId)));
  router.get("/form/products", (request, response) => readForm(request, response, () => dependencies.formReads.products(String((request.params as Record<string, string>).organizationId), String(request.query.q ?? ""))));
  router.get("/form/products/:productId/configuration", (request, response) => readForm(request, response, async () => {
    const value = await dependencies.formReads.configuration(String((request.params as Record<string, string>).organizationId), request.params.productId);
    if (!value) throw new V2ApplicationError("NOT_FOUND", "Product configuration is unavailable.");
    return value;
  }));
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
      response
        .status(200)
        .type("application/json")
        .send(
          JSON.stringify(
            { ok: true, data: quoteForUi(result.value) },
            (_key, value: unknown) =>
              typeof value === "bigint" ? value.toString() : value,
          ),
        );
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
