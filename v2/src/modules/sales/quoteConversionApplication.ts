import { createHash, randomUUID } from "node:crypto";
import type { OperationContext } from "../../application/operation.js";
import { requireOperationPrincipalScope } from "../../application/operation.js";
import { AuthorityPolicy } from "../../authorization/authorityPolicy.js";
import { principalSubject, staffActorId } from "../../authorization/principals.js";
import { failure, success, type ApplicationResult, V2ApplicationError } from "../../errors/applicationError.js";
import { brandedId, canonicalJson, type OrderId, type QuoteCheckpointId, type QuoteId, type SalesLineId } from "../shared/commercialValues.js";
import type { ConvertQuoteCommand, ConvertQuoteResult, QuoteCheckpoint, SalesLineSnapshot } from "./contracts.js";
import { assertSalesLineSnapshot } from "./contracts.js";
import type { FrozenOrderCommercialSource, OrderApplicationService, OrderTransaction } from "./orderApplication.js";
import type { QuoteConversionPersistencePort } from "./quoteApplication.js";

export type QuoteConversionTransaction = Readonly<{
  quote: QuoteConversionPersistencePort;
  order: OrderTransaction;
}>;
export interface QuoteConversionTransactionRunner {
  transaction<T>(action: (transaction: QuoteConversionTransaction) => Promise<T>): Promise<T>;
}
export type QuoteConversionOperationResult = Readonly<ConvertQuoteResult & { orderNumber: string }>;
/** Test-only deterministic barriers; production composition never supplies them. */
export type QuoteConversionTestHooks = Readonly<{ afterQuoteLocked?: () => Promise<void> }>;

const fingerprint = (value: unknown): string =>
  `sha256:${createHash("sha256").update(canonicalJson(value)).digest("hex")}`;
const attribution = (context: OperationContext) => context.principal.kind === "delegated_ai"
  ? { principalKind: "delegated_ai" as const, subjectId: principalSubject(context.principal), staffActorUserId: staffActorId(context.principal)! }
  : { principalKind: context.principal.kind, subjectId: principalSubject(context.principal) };

const cloneLines = (lines: readonly SalesLineSnapshot[]): readonly SalesLineSnapshot[] =>
  lines.map((line) => {
    assertSalesLineSnapshot(line);
    return Object.freeze({ ...line, lineId: brandedId<"SalesLineId">(randomUUID()) });
  });

/**
 * Converts only an accepted immutable Quote checkpoint.  Pricing is absent
 * from this module by design: the Order inherits the accepted calculation and
 * selling evidence byte-for-byte (apart from new Order-line identities).
 */
export class QuoteConversionApplicationService {
  constructor(
    private readonly runner: QuoteConversionTransactionRunner,
    private readonly orders: OrderApplicationService,
    private readonly authority = new AuthorityPolicy(),
    private readonly hooks?: QuoteConversionTestHooks,
  ) {}

  async convert(
    context: OperationContext,
    input: ConvertQuoteCommand,
  ): Promise<ApplicationResult<QuoteConversionOperationResult>> {
    try {
      requireOperationPrincipalScope(context);
      if (input.organizationId !== context.organizationId)
        throw new V2ApplicationError("WRONG_TENANT", "Quote is unavailable in this organization.");
      if (!context.businessRequest || context.businessRequest.id !== input.businessRequestId)
        throw new V2ApplicationError("VALIDATION_ERROR", "The command business request identity does not match the operation context.");
      return success(await this.runner.transaction(async ({ quote, order }) => {
        const reservation = await quote.reserve({
          organizationId: context.organizationId, operation: "sales.quote.convert.v1",
          businessRequestId: input.businessRequestId, payloadFingerprint: fingerprint(input),
          principalKind: context.principal.kind, principalSubject: principalSubject(context.principal),
          ...(staffActorId(context.principal) ? { staffActorUserId: staffActorId(context.principal) } : {}),
        });
        if (reservation.kind === "replay") return reservation.request.resultJson as QuoteConversionOperationResult;
        const current = await quote.read(brandedId<"OrganizationId">(context.organizationId), input.quoteId, true);
        if (!current) throw new V2ApplicationError("NOT_FOUND", "Quote was not found.");
        await this.hooks?.afterQuoteLocked?.();
        if (!this.authority.decide(context.principal, { capability: "quote.convert", resource: { organizationId: context.organizationId, customerId: current.quote.customerContact.customerId } }).allowed)
          throw new V2ApplicationError("FORBIDDEN", "The principal does not have authority to convert this Quote.");
        if (current.revision !== input.expectedStateToken)
          throw new V2ApplicationError("STALE_STATE", "Quote has changed; reload before conversion.");
        if (current.quote.convertedOrderId)
          throw new V2ApplicationError("CONFLICT", "Quote has already been converted.");
        if (current.quote.deliveryState !== "sent" || current.quote.acceptanceState !== "accepted")
          throw new V2ApplicationError("CONFLICT", "Only a sent and accepted Quote can be converted.");
        const source = await quote.readCheckpoint(brandedId<"OrganizationId">(context.organizationId), input.quoteId, input.sourceCheckpointId);
        if (!source || source.kind !== "quote_accepted")
          throw new V2ApplicationError("CONFLICT", "The accepted Quote checkpoint is required for conversion.");
        if (source.sourceDocument.quoteId !== input.quoteId)
          throw new V2ApplicationError("WRONG_TENANT", "Quote checkpoint is unavailable.");
        const frozen: FrozenOrderCommercialSource = {
          customerContact: current.quote.customerContact,
          purchaseOrderNumber: source.commercial.purchaseOrderNumber,
          requestedDueDate: source.commercial.requestedDueDate,
          terms: source.commercial.terms,
          lines: cloneLines(source.commercial.lines),
        };
        const created = await this.orders.createFromCommercialSnapshot(order, context, reservation.request.id, frozen, "sales.quote.convert.v1");
        const checkpointId = brandedId<"QuoteCheckpointId">(randomUUID());
        const converted: QuoteCheckpoint = Object.freeze({
          ...source, checkpointId, kind: "quote_converted", occurredAt: new Date().toISOString(),
          principal: attribution(context), sourceCheckpointId: input.sourceCheckpointId,
          sourceDocument: { quoteId: input.quoteId, orderId: created.order.order.orderId },
          evidenceFingerprint: fingerprint({ sourceCheckpointId: input.sourceCheckpointId, orderId: created.order.order.orderId, commercial: source.commercial }),
        });
        await quote.appendConvertedCheckpoint({ organizationId: brandedId<"OrganizationId">(context.organizationId), quoteId: input.quoteId, checkpoint: converted, operationRequestId: reservation.request.id });
        await quote.createConversionLineage({ organizationId: brandedId<"OrganizationId">(context.organizationId), quoteId: input.quoteId, sourceCheckpointId: input.sourceCheckpointId, convertedCheckpointId: checkpointId, orderId: created.order.order.orderId, operationRequestId: reservation.request.id });
        await quote.audit({ organizationId: context.organizationId, requestId: reservation.request.id, operation: "sales.quote.convert.v1", event: { eventType: "quote_converted", resourceId: input.quoteId, changes: [] }, principalKind: context.principal.kind, principalSubject: principalSubject(context.principal), ...(staffActorId(context.principal) ? { staffActorUserId: staffActorId(context.principal) } : {}) });
        await quote.attribute({ organizationId: context.organizationId, requestId: reservation.request.id, operation: "sales.quote.convert.v1", resourceType: "quote", resourceId: input.quoteId, principalKind: context.principal.kind, principalSubject: principalSubject(context.principal), ...(staffActorId(context.principal) ? { staffActorUserId: staffActorId(context.principal) } : {}) });
        const result: QuoteConversionOperationResult = { quoteId: input.quoteId, sourceCheckpointId: input.sourceCheckpointId, conversionCheckpointId: checkpointId, orderId: created.order.order.orderId, draftInvoiceId: created.draftInvoiceId, orderNumber: created.order.number.display };
        await quote.succeedConversion(context.organizationId, reservation.request.id, input.quoteId, result);
        return result;
      }));
    } catch (cause) {
      return failure(cause instanceof V2ApplicationError ? cause : new V2ApplicationError("INTERNAL_ERROR", "Quote conversion could not be completed."));
    }
  }
}
