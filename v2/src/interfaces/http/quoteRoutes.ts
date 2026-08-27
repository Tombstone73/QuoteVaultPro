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
import type { QuoteConversionApplicationService } from "../../modules/sales/quoteConversionApplication.js";
import type { ConvertQuoteCommand } from "../../modules/sales/contracts.js";
import { brandedId } from "../../modules/shared/commercialValues.js";
import type { SalesWorkspaceReadPort } from "../../modules/sales/workspaceReads.js";

export interface QuoteCustomerDocumentPort {
  quotePdf(organizationId: import("../../modules/shared/commercialValues.js").OrganizationId, quoteId: import("../../modules/shared/commercialValues.js").QuoteId): Promise<Uint8Array>;
  quote(organizationId: import("../../modules/shared/commercialValues.js").OrganizationId, quoteId: import("../../modules/shared/commercialValues.js").QuoteId): Promise<Readonly<{ kind: "quote" | "order"; number: string }>>;
}
export interface QuoteDeliveryPort {
  send(context: OperationContext, input: QuoteLifecycleInput): Promise<import("../../errors/applicationError.js").ApplicationResult<QuoteOperationResult>>;
}

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
  conversion?: QuoteConversionApplicationService;
  principals: VerifiedV2PrincipalProvider;
  formReads: QuoteFormReadPort;
  workspace?: SalesWorkspaceReadPort;
  documents?: QuoteCustomerDocumentPort;
  delivery?: QuoteDeliveryPort;
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
    taxability: line.taxability,
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
      lifecycleState: value.quote.lifecycleState,
      convertedOrderId: value.quote.convertedOrderId,
      requestedFulfillment: value.quote.requestedFulfillment,
      sellingAdjustment: value.quote.sellingAdjustment,
      commercialCharge: value.quote.commercialCharge,
      taxComposition: value.quote.taxComposition,
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
      ...(value.quote.taxComposition ? { tax: value.quote.taxComposition } : {}),
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
  router.post("/form/products/:productId/configuration/resolve", (request, response) => readForm(request, response, async () => {
    const body = request.body as { selections?: Record<string, unknown> };
    const value = await dependencies.formReads.configuration(String((request.params as Record<string, string>).organizationId), request.params.productId, body.selections ?? {});
    if (!value) throw new V2ApplicationError("NOT_FOUND", "Product configuration is unavailable.");
    return value;
  }));
  router.post("/form/products/:productId/pricing-preview", (request, response) => void (async () => {
    try {
      const payload = request.body && typeof request.body === "object" && !Array.isArray(request.body) ? request.body as Record<string, unknown> : {};
      const dimensions = payload.dimensions && typeof payload.dimensions === "object" && !Array.isArray(payload.dimensions) ? payload.dimensions as Record<string, unknown> : undefined;
      const result = await dependencies.service.preview(await context(request, dependencies), {
        productId: request.params.productId,
        quantity: Number(payload.quantity),
        ...(payload.selections && typeof payload.selections === "object" && !Array.isArray(payload.selections) ? { selections: payload.selections as Record<string, unknown> } : {}),
        ...(dimensions && typeof dimensions.width === "string" && typeof dimensions.height === "string" && (dimensions.unit === "in" || dimensions.unit === "ft" || dimensions.unit === "mm") ? { dimensions: { width: dimensions.width as never, height: dimensions.height as never, unit: dimensions.unit } } : {}),
      });
      if (!result.ok) return error(response, result.error);
      response.status(200).json({ ok: true, data: result.value });
    } catch (cause) { error(response, cause); }
  })());
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
  router.get("/", async (request, response) => {
    try {
      if (!dependencies.workspace)
        throw new V2ApplicationError("INTERNAL_ERROR", "Quote list runtime is unavailable.");
      const operation = await context(request, dependencies);
      if (!new AuthorityPolicy().decide(operation.principal, { capability: "quote.view", resource: { organizationId: operation.organizationId } }).allowed)
        throw new V2ApplicationError("FORBIDDEN", "Quote access is unavailable.");
      const limit = Number(request.query.limit ?? 25);
      const data = await dependencies.workspace.listQuotes(brandedId<"OrganizationId">(operation.organizationId), {
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
      if (!dependencies.workspace) throw new V2ApplicationError("INTERNAL_ERROR", "Quote list runtime is unavailable.");
      const operation = await context(request, dependencies);
      if (!new AuthorityPolicy().decide(operation.principal, { capability: "quote.view", resource: { organizationId: operation.organizationId } }).allowed)
        throw new V2ApplicationError("FORBIDDEN", "Quote access is unavailable.");
      const value = await dependencies.workspace.readLegacyQuote(brandedId<"OrganizationId">(operation.organizationId), request.params.recordId);
      if (!value) throw new V2ApplicationError("NOT_FOUND", "Legacy Quote was not found.");
      response.status(200).json({ ok: true, data: value });
    } catch (cause) { error(response, cause); }
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
  router.get("/:quoteId/document.pdf", async (request, response) => {
    try {
      if (!dependencies.documents) throw new V2ApplicationError("INTERNAL_ERROR", "Quote document runtime is unavailable.");
      const operation = await context(request, dependencies);
      const quoteId = brandedId<"QuoteId">(request.params.quoteId);
      const read = await dependencies.service.read(operation, quoteId);
      if (!read.ok) return error(response, read.error);
      const document = await dependencies.documents.quote(brandedId<"OrganizationId">(operation.organizationId), quoteId);
      const bytes = await dependencies.documents.quotePdf(brandedId<"OrganizationId">(operation.organizationId), quoteId);
      response.status(200).setHeader("content-type", "application/pdf");
      response.setHeader("content-disposition", `inline; filename=\"Quote_${document.number.replace(/[^a-z0-9._-]+/gi, "-")}.pdf\"`);
      response.send(Buffer.from(bytes));
    } catch (cause) { error(response, cause); }
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
  router.post("/:quoteId/send", async (request, response) => {
    try {
      if (!dependencies.delivery) throw new V2ApplicationError("INTERNAL_ERROR", "Quote delivery runtime is unavailable.");
      const body: QuoteLifecycleInput = {
        businessRequestId: requestId(request.body),
        quoteId: brandedId<"QuoteId">(request.params.quoteId),
        expectedRevision: String((request.body as { expectedRevision?: unknown }).expectedRevision ?? ""),
      };
      await send(response, await dependencies.delivery.send(await context(request, dependencies, true), body));
    } catch (cause) { error(response, cause); }
  });
  for (const terminal of ["decline", "void"] as const) router.post(`/:quoteId/${terminal}`, async (request, response) => {
    try {
      const raw = request.body as { expectedRevision?: unknown; reason?: unknown };
      if (typeof raw.reason !== "string" || !raw.reason.trim()) throw new V2ApplicationError("VALIDATION_ERROR", "A reason is required.");
      const body = { businessRequestId: requestId(request.body), quoteId: brandedId<"QuoteId">(request.params.quoteId), expectedRevision: String(raw.expectedRevision ?? ""), reason: raw.reason.trim() };
      await send(response, terminal === "decline" ? await dependencies.service.decline(await context(request, dependencies, true), body) : await dependencies.service.void(await context(request, dependencies, true), body));
    } catch (cause) { error(response, cause); }
  });
  router.post("/:quoteId/accept", async (request, response) => {
    try {
      if (!dependencies.conversion)
        throw new V2ApplicationError("INTERNAL_ERROR", "Quote acceptance runtime is unavailable.");
      const body: QuoteLifecycleInput = {
        businessRequestId: requestId(request.body),
        quoteId: brandedId<"QuoteId">(request.params.quoteId),
        expectedRevision: String((request.body as { expectedRevision?: unknown }).expectedRevision ?? ""),
      };
      const result = await dependencies.conversion.accept(await context(request, dependencies, true), body);
      if (!result.ok) return error(response, result.error);
      response.status(200).json({ ok: true, data: { ...result.value, quote: quoteForUi(result.value.quote) } });
    } catch (cause) { error(response, cause); }
  });
  router.post("/:quoteId/convert", async (request, response) => {
    try {
      if (!dependencies.conversion)
        throw new V2ApplicationError("INTERNAL_ERROR", "Quote conversion runtime is unavailable.");
      const sourceCheckpointId = (request.body as { sourceCheckpointId?: unknown }).sourceCheckpointId;
      if (typeof sourceCheckpointId !== "string" || !sourceCheckpointId.trim())
        throw new V2ApplicationError("VALIDATION_ERROR", "sourceCheckpointId is required.");
      const body: ConvertQuoteCommand = {
        organizationId: brandedId<"OrganizationId">(String((request.params as Record<string, string>).organizationId)),
        quoteId: brandedId<"QuoteId">(request.params.quoteId),
        sourceCheckpointId: brandedId<"QuoteCheckpointId">(sourceCheckpointId),
        businessRequestId: brandedId<"BusinessRequestId">(requestId(request.body)),
        expectedStateToken: String((request.body as { expectedRevision?: unknown }).expectedRevision ?? ""),
      };
      const result = await dependencies.conversion.convert(await context(request, dependencies, true), body);
      if (!result.ok) return error(response, result.error);
      response.status(200).json({ ok: true, data: result.value });
    } catch (cause) { error(response, cause); }
  });
  return router;
};
