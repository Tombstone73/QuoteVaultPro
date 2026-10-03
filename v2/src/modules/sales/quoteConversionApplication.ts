import { createHash, randomUUID } from "node:crypto";
import type { OperationContext } from "../../application/operation.js";
import { requireOperationPrincipalScope } from "../../application/operation.js";
import { AuthorityPolicy } from "../../authorization/authorityPolicy.js";
import { principalSubject, staffActorId } from "../../authorization/principals.js";
import { failure, success, type ApplicationResult, V2ApplicationError } from "../../errors/applicationError.js";
import { brandedId, canonicalJson, freezeCheckpoint, type QuoteCheckpointId, type QuoteId, type SalesLineId } from "../shared/commercialValues.js";
import type { ConvertQuoteCommand, ConvertQuoteResult, QuoteCheckpoint, QuoteCurrentState, SalesLineSnapshot } from "./contracts.js";
import { assertSalesLineSnapshot, quoteCommercialSnapshot } from "./contracts.js";
import type { FrozenOrderCommercialSource, OrderApplicationService, OrderTransaction } from "./orderApplication.js";
import { type QuoteConversionPersistencePort, type QuoteLifecycleInput, type QuoteReadModel } from "./quoteApplication.js";

/** Transaction-scoped only: artwork conversion consumes an already accepted
 * snapshot and writes Order associations before the encompassing commit. */
export interface QuoteArtworkConversionPort {
  snapshotAccepted(organizationId: string, quoteId: string, checkpointId: string): Promise<void>;
  carryAcceptedToOrder(input: Readonly<{ organizationId: string; quoteId: string; acceptanceCheckpointId: string; orderId: string; lineMap: ReadonlyMap<string, string> }>): Promise<void>;
}
export type QuoteConversionTransaction = Readonly<{ quote: QuoteConversionPersistencePort; order: OrderTransaction; artwork: QuoteArtworkConversionPort }>;
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
  // SQLSTATE is structural diagnostic data, not a customer value.  Preserve
  // other PostgreSQL classes too so an integration error is not mislabeled as
  // an application exception.
  if (code && /^[0-9A-Z]{5}$/.test(code)) return `DATABASE_SQLSTATE_${code}`;
  return "UNEXPECTED_EXCEPTION";
};

/** Keep diagnostic detail structural.  In particular, never copy a driver
 * message or SQL fragment into the DEV trace: those can contain customer
 * values.  These classifications are enough to distinguish a missing adapter
 * method from a database or ordinary application failure. */
const safeFailureDetail = (cause: unknown): string | undefined => {
  if (cause && typeof cause === "object") {
    const message = "message" in cause && typeof cause.message === "string" ? cause.message : "";
    if (/is not a function/i.test(message)) return "missing_method";
    if (/cannot read propert(?:y|ies)/i.test(message)) return "missing_property";
    const name = "name" in cause && typeof cause.name === "string" ? cause.name : "";
    if (name === "Error") return "error_without_database_code";
    if (/^[A-Za-z][A-Za-z0-9]{0,63}$/.test(name)) return `error_${name.toLowerCase()}`;
  }
  return undefined;
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
  const emit = (stage: string, result: string, classification?: string, durable?: string, constraint?: string, detail?: string): void => {
    const message = `V2_QUOTE_CONVERSION_TRACE request=${requestId} stage=${stage} result=${result}`
      + (classification ? ` class=${classification}` : "")
      + (durable ? ` durable=${durable}` : "")
      + (constraint ? ` constraint=${constraint}` : "")
      + (detail ? ` detail=${detail}` : "");
    try { sink(message); } catch { /* Diagnostics must never affect conversion. */ }
  };
  return Object.freeze({
    requestId,
    event: (stage, result) => emit(stage, result),
    failure: (stage, cause) => emit(stage, "failed", safeFailureClassification(cause), undefined, safeConstraintIdentifier(cause), safeFailureDetail(cause)),
    durableRequest: (businessRequestId, status) => emit("durable_request", status === "replay" ? "replayed" : "ok", undefined, durableRequestClassification(businessRequestId)),
  });
};

const fingerprint = (value: unknown): string => `sha256:${createHash("sha256").update(canonicalJson(value)).digest("hex")}`;
const attribution = (context: OperationContext) => context.principal.kind === "delegated_ai"
  ? { principalKind: "delegated_ai" as const, subjectId: principalSubject(context.principal), staffActorUserId: staffActorId(context.principal)! }
  : { principalKind: context.principal.kind, subjectId: principalSubject(context.principal) };
const requireCapability = (authority: AuthorityPolicy, context: OperationContext, capability: "quote.edit" | "quote.convert", customerId?: string): void => {
  if (!authority.decide(context.principal, { capability, resource: { organizationId: context.organizationId, customerId } }).allowed)
    throw new V2ApplicationError("FORBIDDEN", "The principal does not have authority for this Quote operation.");
};

const authorizeQuoteReplay = async (
  quote: QuoteConversionPersistencePort,
  authority: AuthorityPolicy,
  context: OperationContext,
  quoteId: QuoteId,
  capabilities: readonly ("quote.edit" | "quote.convert")[],
): Promise<void> => {
  const current = await quote.read(brandedId<"OrganizationId">(context.organizationId), quoteId);
  if (!current) throw new V2ApplicationError("NOT_FOUND", "Quote was not found.");
  for (const capability of capabilities) requireCapability(authority, context, capability, current.quote.customerContact.customerId);
};

const readCorrespondingSentCheckpoint = async (
  quote: QuoteConversionPersistencePort,
  context: OperationContext,
  current: QuoteReadModel,
): Promise<Extract<QuoteCheckpoint, { kind: "quote_sent" }>> => {
  const sentSummaries = current.checkpoints.filter((item) => item.kind === "quote_sent");
  if (current.quote.deliveryState !== "sent" || sentSummaries.length !== 1)
    throw new V2ApplicationError("CONFLICT", "The exact sent Quote checkpoint is required before acceptance or conversion.");

  const sent = await quote.readCheckpoint(brandedId<"OrganizationId">(context.organizationId), current.quote.quoteId, sentSummaries[0]!.checkpointId);
  if (!sent || sent.kind !== "quote_sent" || sent.organizationId !== context.organizationId || sent.sourceDocument.quoteId !== current.quote.quoteId)
    throw new V2ApplicationError("CONFLICT", "The exact sent Quote checkpoint is unavailable.");

  const delivery = sent.sentEvidence;
  if (!delivery || !delivery.customerContact || delivery.customerContact.organizationId !== context.organizationId
    || !delivery.deliveryAttemptId || !delivery.recipientEmail || !/^sha256:[0-9a-f]{64}$/u.test(delivery.documentSha256)
    || !delivery.documentNumber || !delivery.documentDate || !delivery.providerMessageId)
    throw new V2ApplicationError("CONFLICT", "The sent Quote checkpoint does not contain complete delivery evidence.");

  return sent;
};

const readBoundAcceptanceCheckpoint = async (
  quote: QuoteConversionPersistencePort,
  context: OperationContext,
  current: QuoteReadModel,
  sent: Extract<QuoteCheckpoint, { kind: "quote_sent" }>,
): Promise<Extract<QuoteCheckpoint, { kind: "quote_accepted" }>> => {
  const acceptedSummaries = current.checkpoints.filter((item) => item.kind === "quote_accepted");
  const checkpointId = acceptedSummaries.length === 1 ? acceptedSummaries[0]!.checkpointId : undefined;
  const accepted = checkpointId
    ? await quote.readCheckpoint(brandedId<"OrganizationId">(context.organizationId), current.quote.quoteId, checkpointId)
    : null;
  if (!accepted || !acceptanceIsBoundToSent(accepted, sent))
    throw new V2ApplicationError("CONFLICT", "The accepted Quote checkpoint is not bound to its sent proposal.");
  return accepted;
};

const currentCommercialMatchesSent = (
  current: QuoteReadModel,
  sent: Extract<QuoteCheckpoint, { kind: "quote_sent" }>,
  acceptedCheckpoint?: Extract<QuoteCheckpoint, { kind: "quote_accepted" }>,
): boolean => {
  if (canonicalJson(sent.sentEvidence.customerContact) !== canonicalJson(current.quote.customerContact)) return false;
  const currentCommercial = quoteCommercialSnapshot(current.quote);
  if (!acceptedCheckpoint) return canonicalJson(sent.commercial) === canonicalJson(currentCommercial);

  // A validated acceptance checkpoint freezes Job Label for the Order; only this
  // operational header field may diverge after acceptance.
  const currentWithoutJobLabel: Record<string, unknown> = { ...currentCommercial };
  const sentWithoutJobLabel: Record<string, unknown> = { ...sent.commercial };
  delete currentWithoutJobLabel.jobLabel;
  delete sentWithoutJobLabel.jobLabel;
  return canonicalJson(sentWithoutJobLabel) === canonicalJson(currentWithoutJobLabel);
};

const createAcceptanceCheckpoint = (
  sent: Extract<QuoteCheckpoint, { kind: "quote_sent" }>,
  checkpointId: QuoteCheckpointId,
  context: OperationContext,
): Extract<QuoteCheckpoint, { kind: "quote_accepted" }> => {
  const raw = {
    ...sent,
    checkpointId,
    evidenceFingerprint: "",
    occurredAt: new Date().toISOString(),
    principal: attribution(context),
    sourceCheckpointId: sent.checkpointId,
    kind: "quote_accepted" as const,
  };
  return freezeCheckpoint({ ...raw, evidenceFingerprint: fingerprint(raw) }) as Extract<QuoteCheckpoint, { kind: "quote_accepted" }>;
};

const checkpointPreservesSent = (
  checkpoint: QuoteCheckpoint,
  sent: Extract<QuoteCheckpoint, { kind: "quote_sent" }>,
): boolean => checkpoint.organizationId === sent.organizationId
  && checkpoint.sourceDocument.quoteId === sent.sourceDocument.quoteId
  && !!checkpoint.sentEvidence
  && canonicalJson(checkpoint.sentEvidence) === canonicalJson(sent.sentEvidence)
  && canonicalJson(checkpoint.commercial) === canonicalJson(sent.commercial)
  && canonicalJson(checkpoint.customerPresentation) === canonicalJson(sent.customerPresentation)
  && canonicalJson(checkpoint.organizationPresentation ?? null) === canonicalJson(sent.organizationPresentation ?? null);

const acceptanceIsBoundToSent = (
  accepted: QuoteCheckpoint,
  sent: Extract<QuoteCheckpoint, { kind: "quote_sent" }>,
): accepted is Extract<QuoteCheckpoint, { kind: "quote_accepted" }> => accepted.kind === "quote_accepted"
  && accepted.sourceCheckpointId === sent.checkpointId
  && checkpointPreservesSent(accepted, sent);

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
      const result = await this.runner.transaction(async ({ quote, order, artwork }) => {
        stage = "durable_request";
        trace?.event(stage, "started");
        const reservation = await quote.reserve({ organizationId: context.organizationId, operation: "sales.quote.accept_and_convert.v1", businessRequestId: input.businessRequestId, payloadFingerprint: fingerprint(input), principalKind: context.principal.kind, principalSubject: principalSubject(context.principal), ...(staffActorId(context.principal) ? { staffActorUserId: staffActorId(context.principal) } : {}) });
        trace?.durableRequest(input.businessRequestId, reservation.kind);
        if (reservation.kind === "replay") {
          await authorizeQuoteReplay(quote, this.authority, context, input.quoteId, ["quote.edit", "quote.convert"]);
          if (reservation.request.resultJson === null) throw new V2ApplicationError("CONFLICT", "The Quote request has no completed result to replay.");
          return reservation.request.resultJson as QuoteAcceptanceOperationResult;
        }
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
        const sent = await readCorrespondingSentCheckpoint(quote, context, current);
        const acceptedCheckpoint = current.quote.acceptanceState === "accepted"
          ? await readBoundAcceptanceCheckpoint(quote, context, current, sent)
          : null;
        if (!currentCommercialMatchesSent(current, sent, acceptedCheckpoint ?? undefined))
          throw new V2ApplicationError("CONFLICT", "The current Quote no longer matches the proposal in its sent checkpoint.");
        if (current.quote.taxComposition?.status === "unresolved")
          throw new V2ApplicationError("VALIDATION_ERROR", "Tax jurisdiction not configured. Configure the receipt jurisdiction before accepting this Quote.");
        trace?.event("quote_state_validated", "ok");
        if (current.quote.convertedOrderId) {
          if (!acceptedCheckpoint) throw new V2ApplicationError("CONFLICT", "The converted Quote is missing its sent-bound acceptance checkpoint.");
          const result = await this.existingAcceptance(quote, order, context, current, sent, acceptedCheckpoint);
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
          checkpoint = acceptedCheckpoint!;
          trace?.event(stage, "ok");
        } else {
          if (current.quote.deliveryState !== "sent" || current.quote.acceptanceState !== "not_accepted")
            throw new V2ApplicationError("CONFLICT", "Only a sent, unaccepted Quote can be accepted.");
          stage = "acceptance_checkpoint";
          trace?.event(stage, "started");
          checkpoint = createAcceptanceCheckpoint(sent, brandedId<"QuoteCheckpointId">(randomUUID()), context);
          const applied = await quote.transition({ organizationId: brandedId<"OrganizationId">(context.organizationId), quoteId: input.quoteId, expectedRevision: Number(current.revision), kind: "accept", checkpoint, operationRequestId: reservation.request.id });
          if (!applied) throw new V2ApplicationError("STALE_STATE", "Quote has changed; reload before acceptance.");
          trace?.event(stage, "ok");
          stage = "accepted_quote_read";
          trace?.event(stage, "started");
          const reread = await quote.read(brandedId<"OrganizationId">(context.organizationId), input.quoteId, true);
          if (!reread) throw new Error("Accepted Quote could not be read.");
          trace?.event(stage, "ok");
          accepted = reread;
          // This combined operation leaves one Quote audit row. Acceptance is
          // immutable checkpoint evidence inside the same transaction; the
          // final conversion audit is the one semantic operation record and
          // satisfies the one request/resource audit invariant.
        }
        stage = "order_creation";
        trace?.event(stage, "started");
        // Quote-artwork mutations lock the same Quote header. Capturing this
        // normalized snapshot while that lock is held makes commercial and
        // artwork evidence one accepted state, never two racing projections.
        stage = "accepted_artwork_snapshot";
        trace?.event(stage, "started");
        await artwork.snapshotAccepted(context.organizationId, input.quoteId, checkpoint.checkpointId);
        trace?.event(stage, "ok");
        const converted = await this.convertAccepted({ quote, order, artwork }, context, reservation.request.id, accepted, checkpoint, "sales.quote.accept_and_convert.v1", trace, (next) => { stage = next; });
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
      return success(await this.runner.transaction(async ({ quote, order, artwork }) => {
        const reservation = await quote.reserve({ organizationId: context.organizationId, operation: "sales.quote.convert.v1", businessRequestId: input.businessRequestId, payloadFingerprint: fingerprint(input), principalKind: context.principal.kind, principalSubject: principalSubject(context.principal), ...(staffActorId(context.principal) ? { staffActorUserId: staffActorId(context.principal) } : {}) });
        if (reservation.kind === "replay") {
          await authorizeQuoteReplay(quote, this.authority, context, input.quoteId, ["quote.convert"]);
          if (reservation.request.resultJson === null) throw new V2ApplicationError("CONFLICT", "The Quote request has no completed result to replay.");
          return reservation.request.resultJson as QuoteConversionOperationResult;
        }
        const current = await quote.read(brandedId<"OrganizationId">(context.organizationId), input.quoteId, true);
        if (!current) throw new V2ApplicationError("NOT_FOUND", "Quote was not found.");
        await this.hooks?.afterQuoteLocked?.();
        requireCapability(this.authority, context, "quote.convert", current.quote.customerContact.customerId);
        if (current.revision !== input.expectedStateToken) throw new V2ApplicationError("STALE_STATE", "Quote has changed; reload before conversion.");
        if (current.quote.convertedOrderId) throw new V2ApplicationError("CONFLICT", "Quote has already been converted.");
        if (current.quote.lifecycleState !== "open") throw new V2ApplicationError("CONFLICT", "A declined or voided Quote cannot be converted.");
        if (current.quote.deliveryState !== "sent" || current.quote.acceptanceState !== "accepted") throw new V2ApplicationError("CONFLICT", "Only a sent and accepted Quote can be converted.");
        if (current.quote.taxComposition?.status === "unresolved") throw new V2ApplicationError("VALIDATION_ERROR", "Tax jurisdiction not configured. This Quote cannot be converted.");
        const sent = await readCorrespondingSentCheckpoint(quote, context, current);
        const source = await readBoundAcceptanceCheckpoint(quote, context, current, sent);
        if (!currentCommercialMatchesSent(current, sent, source) || source.checkpointId !== input.sourceCheckpointId)
          throw new V2ApplicationError("CONFLICT", "The accepted Quote checkpoint is not bound to its sent proposal.");
        await artwork.snapshotAccepted(context.organizationId, input.quoteId, source.checkpointId);
        const result = await this.convertAccepted({ quote, order, artwork }, context, reservation.request.id, current, source, "sales.quote.convert.v1");
        await quote.succeedConversion(context.organizationId, reservation.request.id, input.quoteId, result);
        return result;
      }));
    } catch (cause) {
      return failure(cause instanceof V2ApplicationError ? cause : new V2ApplicationError("INTERNAL_ERROR", "Quote conversion could not be completed."));
    }
  }

  private async existingAcceptance(quote: QuoteConversionPersistencePort, order: OrderTransaction, context: OperationContext, current: QuoteReadModel, sent: Extract<QuoteCheckpoint, { kind: "quote_sent" }>, source: Extract<QuoteCheckpoint, { kind: "quote_accepted" }>): Promise<QuoteAcceptanceOperationResult> {
    const orderRead = await order.read(brandedId<"OrganizationId">(context.organizationId), current.quote.convertedOrderId!);
    const convertedSummaries = current.checkpoints.filter((item) => item.kind === "quote_converted");
    const converted = convertedSummaries.length === 1
      ? await quote.readCheckpoint(brandedId<"OrganizationId">(context.organizationId), current.quote.quoteId, convertedSummaries[0]!.checkpointId)
      : null;
    if (!orderRead || !converted || converted.kind !== "quote_converted"
      || converted.sourceCheckpointId !== source.checkpointId || converted.sourceDocument.quoteId !== current.quote.quoteId
      || converted.sourceDocument.orderId !== current.quote.convertedOrderId || !checkpointPreservesSent(converted, sent) || !orderRead.draftInvoice)
      throw new V2ApplicationError("CONFLICT", "The converted Quote is missing canonical conversion evidence bound to its sent proposal.");
    const read = await quote.read(brandedId<"OrganizationId">(context.organizationId), current.quote.quoteId);
    if (!read) throw new Error("Converted Quote could not be read.");
    return { quote: read, quoteId: current.quote.quoteId, sourceCheckpointId: source.checkpointId, conversionCheckpointId: converted.checkpointId, orderId: current.quote.convertedOrderId!, draftInvoiceId: orderRead.draftInvoice.invoiceId, orderNumber: orderRead.number.display };
  }

  private async convertAccepted(transaction: QuoteConversionTransaction, context: OperationContext, operationRequestId: string, current: QuoteReadModel, source: Extract<QuoteCheckpoint, { kind: "quote_accepted" }>, operation: string, trace?: QuoteConversionTrace, setStage?: (stage: string) => void): Promise<QuoteConversionOperationResult> {
    if (source.sourceDocument.quoteId !== current.quote.quoteId) throw new V2ApplicationError("WRONG_TENANT", "Quote checkpoint is unavailable.");
    const customerContact = source.sentEvidence?.customerContact;
    if (!customerContact || customerContact.organizationId !== context.organizationId)
      throw new V2ApplicationError("CONFLICT", "The accepted Quote is missing its immutable sent Customer Contact reference.");
    const sourceToOrderLine = new Map<string, string>();
    const lines = source.commercial.lines.map((line) => {
      const orderLine = Object.freeze({ ...line, lineId: brandedId<"SalesLineId">(randomUUID()) });
      sourceToOrderLine.set(line.lineId, orderLine.lineId);
      return orderLine;
    });
    const frozen: FrozenOrderCommercialSource = { customerContact, jobLabel: source.commercial.jobLabel, purchaseOrderNumber: source.commercial.purchaseOrderNumber, requestedDueDate: source.commercial.requestedDueDate, terms: source.commercial.terms, requestedFulfillment: source.commercial.requestedFulfillment, sellingAdjustment: source.commercial.sellingAdjustment, commercialCharge: source.commercial.commercialCharge, taxComposition: source.commercial.taxComposition, lines };
    trace?.event("commercial_snapshot_loaded", "ok");
    setStage?.("order_creation");
    const created = await this.orders.createFromCommercialSnapshot(transaction.order, context, operationRequestId, frozen, operation, trace);
    setStage?.("artwork_lineage");
    trace?.event("artwork_lineage", "started");
    await transaction.artwork.carryAcceptedToOrder({ organizationId: context.organizationId, quoteId: current.quote.quoteId, acceptanceCheckpointId: source.checkpointId, orderId: created.order.order.orderId, lineMap: sourceToOrderLine });
    trace?.event("artwork_lineage", "ok");
    setStage?.("conversion_link");
    trace?.event("conversion_link", "started");
    const checkpointId = brandedId<"QuoteCheckpointId">(randomUUID());
    const convertedRaw = { ...source, checkpointId, kind: "quote_converted" as const, occurredAt: new Date().toISOString(), principal: attribution(context), sourceCheckpointId: source.checkpointId, sourceDocument: { quoteId: current.quote.quoteId, orderId: created.order.order.orderId }, evidenceFingerprint: "" };
    const converted = freezeCheckpoint({ ...convertedRaw, evidenceFingerprint: fingerprint(convertedRaw) }) as QuoteCheckpoint;
    await transaction.quote.appendConvertedCheckpoint({ organizationId: brandedId<"OrganizationId">(context.organizationId), quoteId: current.quote.quoteId, checkpoint: converted, operationRequestId });
    await transaction.quote.createConversionLineage({ organizationId: brandedId<"OrganizationId">(context.organizationId), quoteId: current.quote.quoteId, sourceCheckpointId: source.checkpointId, convertedCheckpointId: checkpointId, orderId: created.order.order.orderId, operationRequestId });
    trace?.event("conversion_link", "ok");
    setStage?.("audit");
    trace?.event("audit", "started");
    await transaction.quote.audit({ organizationId: context.organizationId, requestId: operationRequestId, operation, event: { eventType: "quote_converted", resourceId: current.quote.quoteId, changes: [] }, principalKind: context.principal.kind, principalSubject: principalSubject(context.principal), ...(staffActorId(context.principal) ? { staffActorUserId: staffActorId(context.principal) } : {}) });
    await transaction.quote.attribute({ organizationId: context.organizationId, requestId: operationRequestId, operation, resourceType: "quote", resourceId: current.quote.quoteId, principalKind: context.principal.kind, principalSubject: principalSubject(context.principal), ...(staffActorId(context.principal) ? { staffActorUserId: staffActorId(context.principal) } : {}) });
    trace?.event("audit", "ok");
    if (!created.draftInvoiceId) throw new Error("Converted Order did not create its required Billing projection.");
    return { quoteId: current.quote.quoteId, sourceCheckpointId: source.checkpointId, conversionCheckpointId: checkpointId, orderId: created.order.order.orderId, draftInvoiceId: created.draftInvoiceId, orderNumber: created.order.number.display };
  }
}
