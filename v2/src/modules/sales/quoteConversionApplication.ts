import { createHash, randomUUID } from "node:crypto";
import type { OperationContext } from "../../application/operation.js";
import { requireOperationPrincipalScope } from "../../application/operation.js";
import { AuthorityPolicy } from "../../authorization/authorityPolicy.js";
import { principalSubject, staffActorId } from "../../authorization/principals.js";
import { failure, success, type ApplicationResult, V2ApplicationError } from "../../errors/applicationError.js";
import { brandedId, canonicalJson, type QuoteCheckpointId, type SalesLineId } from "../shared/commercialValues.js";
import type { ConvertQuoteCommand, ConvertQuoteResult, QuoteCheckpoint, SalesLineSnapshot } from "./contracts.js";
import { assertSalesLineSnapshot } from "./contracts.js";
import type { FrozenOrderCommercialSource, OrderApplicationService, OrderTransaction } from "./orderApplication.js";
import { createQuoteLifecycleCheckpoint, type QuoteConversionPersistencePort, type QuoteLifecycleInput, type QuoteReadModel } from "./quoteApplication.js";

export type QuoteConversionTransaction = Readonly<{ quote: QuoteConversionPersistencePort; order: OrderTransaction }>;
export interface QuoteConversionTransactionRunner { transaction<T>(action: (transaction: QuoteConversionTransaction) => Promise<T>): Promise<T>; }
export type QuoteConversionOperationResult = Readonly<ConvertQuoteResult & { orderNumber: string }>;
export type QuoteAcceptanceOperationResult = Readonly<QuoteConversionOperationResult & { quote: QuoteReadModel }>;
/** Test-only deterministic barriers; production composition never supplies them. */
export type QuoteConversionTestHooks = Readonly<{ afterQuoteLocked?: () => Promise<void> }>;

const fingerprint = (value: unknown): string => `sha256:${createHash("sha256").update(canonicalJson(value)).digest("hex")}`;
const attribution = (context: OperationContext) => context.principal.kind === "delegated_ai"
  ? { principalKind: "delegated_ai" as const, subjectId: principalSubject(context.principal), staffActorUserId: staffActorId(context.principal)! }
  : { principalKind: context.principal.kind, subjectId: principalSubject(context.principal) };
const cloneLines = (lines: readonly SalesLineSnapshot[]): readonly SalesLineSnapshot[] => lines.map((line) => {
  assertSalesLineSnapshot(line);
  return Object.freeze({ ...line, lineId: brandedId<"SalesLineId">(randomUUID()) });
});
const requireCapability = (authority: AuthorityPolicy, context: OperationContext, capability: "quote.edit" | "quote.convert", customerId?: string): void => {
  if (!authority.decide(context.principal, { capability, resource: { organizationId: context.organizationId, customerId } }).allowed)
    throw new V2ApplicationError("FORBIDDEN", "The principal does not have authority for this Quote operation.");
};

/** Acceptance and Order construction share a single transaction: an accepted Quote can never commit without its Order. */
export class QuoteConversionApplicationService {
  constructor(private readonly runner: QuoteConversionTransactionRunner, private readonly orders: OrderApplicationService, private readonly authority = new AuthorityPolicy(), private readonly hooks?: QuoteConversionTestHooks) {}

  async accept(context: OperationContext, input: QuoteLifecycleInput): Promise<ApplicationResult<QuoteAcceptanceOperationResult>> {
    try {
      requireOperationPrincipalScope(context);
      if (!context.businessRequest || context.businessRequest.id !== input.businessRequestId)
        throw new V2ApplicationError("VALIDATION_ERROR", "The command business request identity does not match the operation context.");
      return success(await this.runner.transaction(async ({ quote, order }) => {
        const reservation = await quote.reserve({ organizationId: context.organizationId, operation: "sales.quote.accept_and_convert.v1", businessRequestId: input.businessRequestId, payloadFingerprint: fingerprint(input), principalKind: context.principal.kind, principalSubject: principalSubject(context.principal), ...(staffActorId(context.principal) ? { staffActorUserId: staffActorId(context.principal) } : {}) });
        if (reservation.kind === "replay") return reservation.request.resultJson as QuoteAcceptanceOperationResult;
        const current = await quote.read(brandedId<"OrganizationId">(context.organizationId), input.quoteId, true);
        if (!current) throw new V2ApplicationError("NOT_FOUND", "Quote was not found.");
        await this.hooks?.afterQuoteLocked?.();
        requireCapability(this.authority, context, "quote.edit", current.quote.customerContact.customerId);
        requireCapability(this.authority, context, "quote.convert", current.quote.customerContact.customerId);
        if (current.revision !== input.expectedRevision) throw new V2ApplicationError("STALE_STATE", "Quote has changed; reload before acceptance.");
        if (current.quote.taxComposition?.status === "unresolved")
          throw new V2ApplicationError("VALIDATION_ERROR", "Tax jurisdiction not configured. Configure the receipt jurisdiction before accepting this Quote.");
        if (current.quote.convertedOrderId) {
          const result = await this.existingAcceptance(quote, order, context, current);
          await quote.succeedConversion(
            context.organizationId,
            reservation.request.id,
            input.quoteId,
            result,
          );
          return result;
        }

        let accepted = current;
        let checkpoint: Extract<QuoteCheckpoint, { kind: "quote_accepted" }>;
        if (current.quote.acceptanceState === "accepted") {
          const checkpointId = current.checkpoints.find((item) => item.kind === "quote_accepted")?.checkpointId;
          const source = checkpointId && await quote.readCheckpoint(brandedId<"OrganizationId">(context.organizationId), input.quoteId, checkpointId);
          if (!source || source.kind !== "quote_accepted") throw new V2ApplicationError("CONFLICT", "The accepted Quote checkpoint is required for conversion.");
          checkpoint = source;
        } else {
          if (current.quote.deliveryState !== "sent" || current.quote.acceptanceState !== "not_accepted")
            throw new V2ApplicationError("CONFLICT", "Only a sent, unaccepted Quote can be accepted.");
          const presentation = await quote.customers.getPresentationIdentity(current.quote.customerContact);
          checkpoint = createQuoteLifecycleCheckpoint(current.quote, "accept", brandedId<"QuoteCheckpointId">(randomUUID()), presentation, context) as Extract<QuoteCheckpoint, { kind: "quote_accepted" }>;
          const applied = await quote.transition({ organizationId: brandedId<"OrganizationId">(context.organizationId), quoteId: input.quoteId, expectedRevision: Number(current.revision), kind: "accept", checkpoint, operationRequestId: reservation.request.id });
          if (!applied) throw new V2ApplicationError("STALE_STATE", "Quote has changed; reload before acceptance.");
          const reread = await quote.read(brandedId<"OrganizationId">(context.organizationId), input.quoteId, true);
          if (!reread) throw new Error("Accepted Quote could not be read.");
          accepted = reread;
          await quote.audit({ organizationId: context.organizationId, requestId: reservation.request.id, operation: "sales.quote.accept_and_convert.v1", event: { eventType: "quote_accepted", resourceId: input.quoteId, changes: [] }, principalKind: context.principal.kind, principalSubject: principalSubject(context.principal), ...(staffActorId(context.principal) ? { staffActorUserId: staffActorId(context.principal) } : {}) });
        }
        const converted = await this.convertAccepted({ quote, order }, context, reservation.request.id, accepted, checkpoint, "sales.quote.accept_and_convert.v1");
        const read = await quote.read(brandedId<"OrganizationId">(context.organizationId), input.quoteId);
        if (!read?.quote.convertedOrderId) throw new Error("Accepted Quote conversion could not be read.");
        const result: QuoteAcceptanceOperationResult = { ...converted, quote: read };
        await quote.succeedConversion(context.organizationId, reservation.request.id, input.quoteId, result);
        return result;
      }));
    } catch (cause) {
      return failure(cause instanceof V2ApplicationError ? cause : new V2ApplicationError("INTERNAL_ERROR", "Quote acceptance could not create its Order."));
    }
  }

  async convert(context: OperationContext, input: ConvertQuoteCommand): Promise<ApplicationResult<QuoteConversionOperationResult>> {
    try {
      requireOperationPrincipalScope(context);
      if (input.organizationId !== context.organizationId) throw new V2ApplicationError("WRONG_TENANT", "Quote is unavailable in this organization.");
      if (!context.businessRequest || context.businessRequest.id !== input.businessRequestId) throw new V2ApplicationError("VALIDATION_ERROR", "The command business request identity does not match the operation context.");
      return success(await this.runner.transaction(async ({ quote, order }) => {
        const reservation = await quote.reserve({ organizationId: context.organizationId, operation: "sales.quote.convert.v1", businessRequestId: input.businessRequestId, payloadFingerprint: fingerprint(input), principalKind: context.principal.kind, principalSubject: principalSubject(context.principal), ...(staffActorId(context.principal) ? { staffActorUserId: staffActorId(context.principal) } : {}) });
        if (reservation.kind === "replay") return reservation.request.resultJson as QuoteConversionOperationResult;
        const current = await quote.read(brandedId<"OrganizationId">(context.organizationId), input.quoteId, true);
        if (!current) throw new V2ApplicationError("NOT_FOUND", "Quote was not found.");
        await this.hooks?.afterQuoteLocked?.();
        requireCapability(this.authority, context, "quote.convert", current.quote.customerContact.customerId);
        if (current.revision !== input.expectedStateToken) throw new V2ApplicationError("STALE_STATE", "Quote has changed; reload before conversion.");
        if (current.quote.convertedOrderId) throw new V2ApplicationError("CONFLICT", "Quote has already been converted.");
        if (current.quote.lifecycleState !== "open") throw new V2ApplicationError("CONFLICT", "A declined or voided Quote cannot be converted.");
        if (current.quote.deliveryState !== "sent" || current.quote.acceptanceState !== "accepted") throw new V2ApplicationError("CONFLICT", "Only a sent and accepted Quote can be converted.");
        if (current.quote.taxComposition?.status === "unresolved") throw new V2ApplicationError("VALIDATION_ERROR", "Tax jurisdiction not configured. This Quote cannot be converted.");
        const source = await quote.readCheckpoint(brandedId<"OrganizationId">(context.organizationId), input.quoteId, input.sourceCheckpointId);
        if (!source || source.kind !== "quote_accepted" || source.sourceDocument.quoteId !== input.quoteId) throw new V2ApplicationError("CONFLICT", "The accepted Quote checkpoint is required for conversion.");
        const result = await this.convertAccepted({ quote, order }, context, reservation.request.id, current, source, "sales.quote.convert.v1");
        await quote.succeedConversion(context.organizationId, reservation.request.id, input.quoteId, result);
        return result;
      }));
    } catch (cause) {
      return failure(cause instanceof V2ApplicationError ? cause : new V2ApplicationError("INTERNAL_ERROR", "Quote conversion could not be completed."));
    }
  }

  private async existingAcceptance(quote: QuoteConversionPersistencePort, order: OrderTransaction, context: OperationContext, current: QuoteReadModel): Promise<QuoteAcceptanceOperationResult> {
    const orderRead = await order.read(brandedId<"OrganizationId">(context.organizationId), current.quote.convertedOrderId!);
    const source = current.checkpoints.find((item) => item.kind === "quote_accepted");
    const converted = current.checkpoints.find((item) => item.kind === "quote_converted");
    if (!orderRead || !source || !converted || !orderRead.draftInvoice) throw new V2ApplicationError("CONFLICT", "The converted Quote is missing canonical conversion evidence.");
    const read = await quote.read(brandedId<"OrganizationId">(context.organizationId), current.quote.quoteId);
    if (!read) throw new Error("Converted Quote could not be read.");
    return { quote: read, quoteId: current.quote.quoteId, sourceCheckpointId: source.checkpointId, conversionCheckpointId: converted.checkpointId, orderId: current.quote.convertedOrderId!, draftInvoiceId: orderRead.draftInvoice.invoiceId, orderNumber: orderRead.number.display };
  }

  private async convertAccepted(transaction: QuoteConversionTransaction, context: OperationContext, operationRequestId: string, current: QuoteReadModel, source: Extract<QuoteCheckpoint, { kind: "quote_accepted" }>, operation: string): Promise<QuoteConversionOperationResult> {
    if (source.sourceDocument.quoteId !== current.quote.quoteId) throw new V2ApplicationError("WRONG_TENANT", "Quote checkpoint is unavailable.");
    const frozen: FrozenOrderCommercialSource = { customerContact: current.quote.customerContact, purchaseOrderNumber: source.commercial.purchaseOrderNumber, requestedDueDate: source.commercial.requestedDueDate, terms: source.commercial.terms, requestedFulfillment: source.commercial.requestedFulfillment, sellingAdjustment: source.commercial.sellingAdjustment, commercialCharge: source.commercial.commercialCharge, taxComposition: source.commercial.taxComposition, lines: cloneLines(source.commercial.lines) };
    const created = await this.orders.createFromCommercialSnapshot(transaction.order, context, operationRequestId, frozen, operation);
    const checkpointId = brandedId<"QuoteCheckpointId">(randomUUID());
    const converted: QuoteCheckpoint = Object.freeze({ ...source, checkpointId, kind: "quote_converted", occurredAt: new Date().toISOString(), principal: attribution(context), sourceCheckpointId: source.checkpointId, sourceDocument: { quoteId: current.quote.quoteId, orderId: created.order.order.orderId }, evidenceFingerprint: fingerprint({ sourceCheckpointId: source.checkpointId, orderId: created.order.order.orderId, commercial: source.commercial }) });
    await transaction.quote.appendConvertedCheckpoint({ organizationId: brandedId<"OrganizationId">(context.organizationId), quoteId: current.quote.quoteId, checkpoint: converted, operationRequestId });
    await transaction.quote.createConversionLineage({ organizationId: brandedId<"OrganizationId">(context.organizationId), quoteId: current.quote.quoteId, sourceCheckpointId: source.checkpointId, convertedCheckpointId: checkpointId, orderId: created.order.order.orderId, operationRequestId });
    await transaction.quote.audit({ organizationId: context.organizationId, requestId: operationRequestId, operation, event: { eventType: "quote_converted", resourceId: current.quote.quoteId, changes: [] }, principalKind: context.principal.kind, principalSubject: principalSubject(context.principal), ...(staffActorId(context.principal) ? { staffActorUserId: staffActorId(context.principal) } : {}) });
    await transaction.quote.attribute({ organizationId: context.organizationId, requestId: operationRequestId, operation, resourceType: "quote", resourceId: current.quote.quoteId, principalKind: context.principal.kind, principalSubject: principalSubject(context.principal), ...(staffActorId(context.principal) ? { staffActorUserId: staffActorId(context.principal) } : {}) });
    return { quoteId: current.quote.quoteId, sourceCheckpointId: source.checkpointId, conversionCheckpointId: checkpointId, orderId: created.order.order.orderId, draftInvoiceId: created.draftInvoiceId, orderNumber: created.order.number.display };
  }
}
