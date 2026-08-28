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

export type QuoteConversionTrace = Readonly<{
  requestId: string;
  event(stage: string, result: "started" | "ok" | "replayed" | "committed" | "rolled_back"): void;
  failure(stage: string, cause: unknown): void;
  durableRequest(businessRequestId: string, status: "new" | "resumed" | "replay"): void;
}>;

export type QuoteConversionTraceOptions = Readonly<{
  requestId?: string;
  sink?: (message: string) => void;
}>;

const safeFailureClassification = (cause: unknown): string => {
  if (cause instanceof V2ApplicationError) return `V2_APPLICATION_ERROR_${cause.code}`;
  if (cause instanceof TypeError) return "TYPE_ERROR";
  const code = cause && typeof cause === "object" && "code" in cause && typeof cause.code === "string" ? cause.code : undefined;
  if (code && /^23\d{3}$/.test(code)) return "DATABASE_CONSTRAINT";
  if (code && /^22\d{3}$/.test(code)) return "DATABASE_DATA";
  return "UNEXPECTED_EXCEPTION";
};

/** PostgreSQL constraint identifiers are schema-owned diagnostic labels, not
 * customer data. Keep the retained trace bounded to ordinary identifier text
 * so a driver error message can never reach the DEV log sink. */
const safeConstraintIdentifier = (cause: unknown): string | undefined => {
  const constraint = cause && typeof cause === "object" && "constraint" in cause
    && typeof cause.constraint === "string" ? cause.constraint : undefined;
  return constraint && /^[a-z0-9_]{1,128}$/i.test(constraint) ? constraint : undefined;
};

const durableRequestClassification = (businessRequestId: string): string =>
  createHash("sha256").update(businessRequestId).digest("hex").slice(0, 16);

/**
 * A bounded plaintext diagnostic specifically for the temporary conversion
 * investigation. The message, rather than logger metadata, carries every
 * useful field because the DEV log aggregator discards structured stderr.
 */
export const createQuoteConversionTrace = (options: QuoteConversionTraceOptions = {}): QuoteConversionTrace => {
  const requestId = options.requestId ?? randomUUID();
  const sink = options.sink ?? ((message: string) => console.log(message));
  const emit = (stage: string, result: string, classification?: string, durable?: string, constraint?: string): void => {
    const message = `V2_QUOTE_CONVERSION_TRACE request=${requestId} stage=${stage} result=${result}`
      + (classification ? ` class=${classification}` : "")
      + (durable ? ` durable=${durable}` : "")
      + (constraint ? ` constraint=${constraint}` : "");
    try { sink(message); } catch { /* Diagnostics must never affect conversion. */ }
  };
  return Object.freeze({
    requestId,
    event: (stage, result) => emit(stage, result),
    failure: (stage, cause) => emit(stage, "failed", safeFailureClassification(cause), undefined, safeConstraintIdentifier(cause)),
    durableRequest: (businessRequestId, status) => emit("durable_request", status === "replay" ? "replayed" : "ok", undefined, durableRequestClassification(businessRequestId)),
  });
};

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

  async accept(context: OperationContext, input: QuoteLifecycleInput, trace?: QuoteConversionTrace): Promise<ApplicationResult<QuoteAcceptanceOperationResult>> {
    let stage = "acceptance_request_received";
    let transactionStarted = false;
    try {
      requireOperationPrincipalScope(context);
      if (!context.businessRequest || context.businessRequest.id !== input.businessRequestId)
        throw new V2ApplicationError("VALIDATION_ERROR", "The command business request identity does not match the operation context.");
      transactionStarted = true;
      trace?.event("transaction", "started");
      const result = await this.runner.transaction(async ({ quote, order }) => {
        stage = "durable_request";
        trace?.event(stage, "started");
        const reservation = await quote.reserve({ organizationId: context.organizationId, operation: "sales.quote.accept_and_convert.v1", businessRequestId: input.businessRequestId, payloadFingerprint: fingerprint(input), principalKind: context.principal.kind, principalSubject: principalSubject(context.principal), ...(staffActorId(context.principal) ? { staffActorUserId: staffActorId(context.principal) } : {}) });
        trace?.durableRequest(input.businessRequestId, reservation.kind);
        if (reservation.kind === "replay") return reservation.request.resultJson as QuoteAcceptanceOperationResult;
        stage = "quote_loaded";
        trace?.event(stage, "started");
        const current = await quote.read(brandedId<"OrganizationId">(context.organizationId), input.quoteId, true);
        if (!current) throw new V2ApplicationError("NOT_FOUND", "Quote was not found.");
        trace?.event(stage, "ok");
        await this.hooks?.afterQuoteLocked?.();
        stage = "quote_state_validated";
        trace?.event(stage, "started");
        requireCapability(this.authority, context, "quote.edit", current.quote.customerContact.customerId);
        requireCapability(this.authority, context, "quote.convert", current.quote.customerContact.customerId);
        if (current.revision !== input.expectedRevision) throw new V2ApplicationError("STALE_STATE", "Quote has changed; reload before acceptance.");
        if (current.quote.taxComposition?.status === "unresolved")
          throw new V2ApplicationError("VALIDATION_ERROR", "Tax jurisdiction not configured. Configure the receipt jurisdiction before accepting this Quote.");
        trace?.event("quote_state_validated", "ok");
        if (current.quote.convertedOrderId) {
          const result = await this.existingAcceptance(quote, order, context, current);
          stage = "durable_request_completed";
          trace?.event(stage, "started");
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
          stage = "acceptance_checkpoint";
          trace?.event(stage, "started");
          const checkpointId = current.checkpoints.find((item) => item.kind === "quote_accepted")?.checkpointId;
          const source = checkpointId && await quote.readCheckpoint(brandedId<"OrganizationId">(context.organizationId), input.quoteId, checkpointId);
          if (!source || source.kind !== "quote_accepted") throw new V2ApplicationError("CONFLICT", "The accepted Quote checkpoint is required for conversion.");
          checkpoint = source;
          trace?.event(stage, "ok");
        } else {
          if (current.quote.deliveryState !== "sent" || current.quote.acceptanceState !== "not_accepted")
            throw new V2ApplicationError("CONFLICT", "Only a sent, unaccepted Quote can be accepted.");
          stage = "acceptance_checkpoint";
          trace?.event(stage, "started");
          const presentation = await quote.customers.getPresentationIdentity(current.quote.customerContact);
          checkpoint = createQuoteLifecycleCheckpoint(current.quote, "accept", brandedId<"QuoteCheckpointId">(randomUUID()), presentation, context) as Extract<QuoteCheckpoint, { kind: "quote_accepted" }>;
          const applied = await quote.transition({ organizationId: brandedId<"OrganizationId">(context.organizationId), quoteId: input.quoteId, expectedRevision: Number(current.revision), kind: "accept", checkpoint, operationRequestId: reservation.request.id });
          if (!applied) throw new V2ApplicationError("STALE_STATE", "Quote has changed; reload before acceptance.");
          trace?.event(stage, "ok");
          stage = "accepted_quote_read";
          trace?.event(stage, "started");
          const reread = await quote.read(brandedId<"OrganizationId">(context.organizationId), input.quoteId, true);
          if (!reread) throw new Error("Accepted Quote could not be read.");
          trace?.event(stage, "ok");
          accepted = reread;
          stage = "audit";
          trace?.event(stage, "started");
          await quote.audit({ organizationId: context.organizationId, requestId: reservation.request.id, operation: "sales.quote.accept_and_convert.v1", event: { eventType: "quote_accepted", resourceId: input.quoteId, changes: [] }, principalKind: context.principal.kind, principalSubject: principalSubject(context.principal), ...(staffActorId(context.principal) ? { staffActorUserId: staffActorId(context.principal) } : {}) });
          trace?.event(stage, "ok");
        }
        stage = "order_creation";
        trace?.event(stage, "started");
        const converted = await this.convertAccepted({ quote, order }, context, reservation.request.id, accepted, checkpoint, "sales.quote.accept_and_convert.v1", trace, (next) => { stage = next; });
        stage = "conversion_quote_read";
        trace?.event(stage, "started");
        const read = await quote.read(brandedId<"OrganizationId">(context.organizationId), input.quoteId);
        if (!read?.quote.convertedOrderId) throw new Error("Accepted Quote conversion could not be read.");
        trace?.event(stage, "ok");
        const result: QuoteAcceptanceOperationResult = { ...converted, quote: read };
        stage = "durable_request_completed";
        trace?.event(stage, "started");
        await quote.succeedConversion(context.organizationId, reservation.request.id, input.quoteId, result);
        trace?.event(stage, "ok");
        return result;
      });
      trace?.event("transaction", "committed");
      return success(result);
    } catch (cause) {
      trace?.failure(stage, cause);
      if (transactionStarted) trace?.event("transaction", "rolled_back");
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

  private async convertAccepted(transaction: QuoteConversionTransaction, context: OperationContext, operationRequestId: string, current: QuoteReadModel, source: Extract<QuoteCheckpoint, { kind: "quote_accepted" }>, operation: string, trace?: QuoteConversionTrace, setStage?: (stage: string) => void): Promise<QuoteConversionOperationResult> {
    if (source.sourceDocument.quoteId !== current.quote.quoteId) throw new V2ApplicationError("WRONG_TENANT", "Quote checkpoint is unavailable.");
    const frozen: FrozenOrderCommercialSource = { customerContact: current.quote.customerContact, purchaseOrderNumber: source.commercial.purchaseOrderNumber, requestedDueDate: source.commercial.requestedDueDate, terms: source.commercial.terms, requestedFulfillment: source.commercial.requestedFulfillment, sellingAdjustment: source.commercial.sellingAdjustment, commercialCharge: source.commercial.commercialCharge, taxComposition: source.commercial.taxComposition, lines: cloneLines(source.commercial.lines) };
    trace?.event("commercial_snapshot_loaded", "ok");
    setStage?.("order_creation");
    const created = await this.orders.createFromCommercialSnapshot(transaction.order, context, operationRequestId, frozen, operation, trace);
    setStage?.("conversion_link");
    trace?.event("conversion_link", "started");
    const checkpointId = brandedId<"QuoteCheckpointId">(randomUUID());
    const converted: QuoteCheckpoint = Object.freeze({ ...source, checkpointId, kind: "quote_converted", occurredAt: new Date().toISOString(), principal: attribution(context), sourceCheckpointId: source.checkpointId, sourceDocument: { quoteId: current.quote.quoteId, orderId: created.order.order.orderId }, evidenceFingerprint: fingerprint({ sourceCheckpointId: source.checkpointId, orderId: created.order.order.orderId, commercial: source.commercial }) });
    await transaction.quote.appendConvertedCheckpoint({ organizationId: brandedId<"OrganizationId">(context.organizationId), quoteId: current.quote.quoteId, checkpoint: converted, operationRequestId });
    await transaction.quote.createConversionLineage({ organizationId: brandedId<"OrganizationId">(context.organizationId), quoteId: current.quote.quoteId, sourceCheckpointId: source.checkpointId, convertedCheckpointId: checkpointId, orderId: created.order.order.orderId, operationRequestId });
    trace?.event("conversion_link", "ok");
    setStage?.("audit");
    trace?.event("audit", "started");
    await transaction.quote.audit({ organizationId: context.organizationId, requestId: operationRequestId, operation, event: { eventType: "quote_converted", resourceId: current.quote.quoteId, changes: [] }, principalKind: context.principal.kind, principalSubject: principalSubject(context.principal), ...(staffActorId(context.principal) ? { staffActorUserId: staffActorId(context.principal) } : {}) });
    await transaction.quote.attribute({ organizationId: context.organizationId, requestId: operationRequestId, operation, resourceType: "quote", resourceId: current.quote.quoteId, principalKind: context.principal.kind, principalSubject: principalSubject(context.principal), ...(staffActorId(context.principal) ? { staffActorUserId: staffActorId(context.principal) } : {}) });
    trace?.event("audit", "ok");
    return { quoteId: current.quote.quoteId, sourceCheckpointId: source.checkpointId, conversionCheckpointId: checkpointId, orderId: created.order.order.orderId, draftInvoiceId: created.draftInvoiceId, orderNumber: created.order.number.display };
  }
}
