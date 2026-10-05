import { createHash, randomUUID } from "node:crypto";
import type { OperationContext } from "../../application/operation.js";
import { requireOperationPrincipalScope } from "../../application/operation.js";
import { AuthorityPolicy } from "../../authorization/authorityPolicy.js";
import {
  principalSubject,
  staffActorId,
} from "../../authorization/principals.js";
import {
  failure,
  success,
  type ApplicationResult,
  V2ApplicationError,
} from "../../errors/applicationError.js";
import type {
  CustomerContactReference,
  CustomerPresentationIdentity,
  CustomersReadPort,
} from "../customers/contracts.js";
import type { PricingPort } from "../pricing/contracts.js";
import { explainPricingResult, type OperatorPricingExplanation } from "../pricing/operatorPricingExplanation.js";
import type {
  ProductPricingCompatibilityPort,
  ResolveActivePricingInput,
} from "../products/contracts.js";
import {
  brandedId,
  canonicalJson,
  currencyCode,
  freezeCheckpoint,
  money,
  percentageBasisPoints,
  type Money,
  type OrganizationId,
  type QuoteCheckpointId,
  type QuoteId,
  type SalesLineId,
} from "../shared/commercialValues.js";
import {
  assertSalesLineSnapshot,
  normalizeSalesJobLabel,
  type AttributionSnapshot,
  type CommercialTerms,
  type DuplicateQuoteCommand,
  type MeaningfulAuditChange,
  type PreparedQuoteDeliveryEvidence,
  type QuoteCheckpoint,
  type QuoteCurrentState,
  type QuoteSentDeliveryEvidence,
  type SalesLineSnapshot,
  type SellingPriceDecision,
  quoteCommercialSnapshot,
} from "./contracts.js";
import type { DocumentOrganizationIdentity } from "../organization/businessProfile.js";
import type { CommercialCharge, SalesTaxComposition } from "./taxComposition.js";
import {
  toQuoteCheckpointPersistenceEnvelope,
  toSalesDocumentTermsPersistence,
  toSalesLinePersistenceEnvelope,
  type SalesDocumentNumber,
} from "./persistenceContracts.js";

export type QuoteSellingInstruction = Readonly<
  | { kind: "calculated" }
  | { kind: "unit_override"; unitCents: number; reason: string }
  | { kind: "total_override"; totalCents: number; reason: string }
  | { kind: "discount"; discountBasisPoints: number; reason: string }
>;
export type QuoteLineInput = Readonly<{
  productId: string;
  description?: string;
  quantity: number;
  selections?: Readonly<Record<string, unknown>>;
  dimensions?: ResolveActivePricingInput["dimensions"];
  selling?: QuoteSellingInstruction;
}>;
/** Read-only Sales/Pricing evaluation for pre-persistence entry. */
export type QuoteLinePricingPreviewInput = Omit<QuoteLineInput, "selling">;
export type QuoteLinePricingPreview = Readonly<{
  calculatedUnitAmount: Money;
  calculatedLineAmount: Money;
  currency: string;
  explanation: OperatorPricingExplanation;
}>;
export type CreateQuoteInput = Readonly<{
  businessRequestId: string;
  customerContact: CustomerContactReference;
  jobLabel?: string | null;
  purchaseOrderNumber?: string;
  requestedDueDate?: string;
  terms?: CommercialTerms;
  expiresAt?: string;
  requestedFulfillment?: import("./contracts.js").RequestedFulfillment;
  sellingAdjustment?: import("./contracts.js").SalesOrderAdjustment;
  commercialCharge?: CommercialCharge;
  lines: readonly QuoteLineInput[];
}>;
export type UpdateQuoteInput = Readonly<{
  businessRequestId: string;
  quoteId: QuoteId;
  expectedRevision: string;
  patch?: Readonly<{
    customerContact?: CustomerContactReference;
    jobLabel?: string | null;
    purchaseOrderNumber?: string | null;
    requestedDueDate?: string | null;
    expiresAt?: string | null;
    terms?: CommercialTerms;
    requestedFulfillment?: import("./contracts.js").RequestedFulfillment | null;
    sellingAdjustment?: import("./contracts.js").SalesOrderAdjustment | null;
    commercialCharge?: CommercialCharge | null;
  }>;
  lineChanges?: readonly (
    | { kind: "add"; line: QuoteLineInput }
    | { kind: "update"; lineId: SalesLineId; line: QuoteLineInput }
    | { kind: "remove"; lineId: SalesLineId }
    | { kind: "duplicate"; sourceLineId: SalesLineId }
    | { kind: "reorder"; lineIds: readonly SalesLineId[] }
  )[];
}>;
export type QuoteLifecycleInput = Readonly<{
  businessRequestId: string;
  quoteId: QuoteId;
  expectedRevision: string;
}>;
/** Only the delivery adapter may commit a sent lifecycle transition.  The
 * quote domain still owns the immutable checkpoint; this evidence prevents an
 * HTTP caller from representing a Quote as sent without a provider result. */
export type QuoteDeliveredInput = QuoteLifecycleInput & Readonly<{
  deliveryAttemptId: string;
  providerMessageId: string;
  /** Immutable pre-provider facts from the same prepared Quote and document. */
  preparedSnapshot: PreparedQuoteDeliveryEvidence;
  /** Captured by the delivery adapter before provider invocation. It is
   * persisted atomically with the pending attempt and must be the exact
   * composition recorded in the immutable sent checkpoint. */
  frozenTaxComposition?: SalesTaxComposition;
}>;
export type QuoteTerminalInput = QuoteLifecycleInput & Readonly<{ reason: string }>;
export type QuoteReadModel = Readonly<{
  quote: QuoteCurrentState;
  number: SalesDocumentNumber;
  revision: string;
  /** Null or absent evidence never authorizes acceptance. Current adapters
   * explicitly identify the committed successful publication. */
  publishedCheckpointId?: QuoteCheckpointId | null;
  publishedEvidenceStatus?: "modern" | "historical" | null;
  checkpoints: readonly Readonly<{
    checkpointId: QuoteCheckpointId;
    kind: QuoteCheckpoint["kind"];
    occurredAt: string;
  }>[];
}>;
export type QuoteOperationResult = Readonly<{
  quote: QuoteReadModel;
  checkpointId?: QuoteCheckpointId;
}>;

export type QuoteOperationRequest = Readonly<{
  id: string;
  status:
    "in_progress" | "succeeded" | "retryable_failure" | "permanent_failure";
  resultJson: unknown | null;
}>;
export type QuoteReservation = Readonly<{
  kind: "new" | "resumed" | "replay";
  request: QuoteOperationRequest;
}>;
export type QuoteAuditEvent = Readonly<{
  eventType: string;
  resourceId: string;
  changes: readonly MeaningfulAuditChange[];
}>;
export interface QuoteTransaction {
  readonly customers: CustomersReadPort;
  readonly products: ProductPricingCompatibilityPort;
  readonly pricing: PricingPort;
  reserve(
    input: Readonly<{
      organizationId: string;
      operation: string;
      businessRequestId: string;
      payloadFingerprint: string;
      principalKind: "staff" | "delegated_ai" | "portal" | "service";
      principalSubject: string;
      staffActorUserId?: string;
    }>,
  ): Promise<QuoteReservation>;
  succeed(
    organizationId: string,
    requestId: string,
    result: QuoteOperationResult,
  ): Promise<void>;
  attribute(
    input: Readonly<{
      organizationId: string;
      requestId: string;
      operation: string;
      resourceType: string;
      resourceId: string;
      principalKind: "staff" | "delegated_ai" | "portal" | "service";
      principalSubject: string;
      staffActorUserId?: string;
    }>,
  ): Promise<void>;
  audit(
    input: Readonly<{
      organizationId: string;
      requestId: string;
      operation: string;
      event: QuoteAuditEvent;
      principalKind: "staff" | "delegated_ai" | "portal" | "service";
      principalSubject: string;
      staffActorUserId?: string;
    }>,
  ): Promise<void>;
  allocateNumber(organizationId: string): Promise<SalesDocumentNumber>;
  create(
    input: Readonly<{
      quoteId: QuoteId;
      organizationId: OrganizationId;
      number: SalesDocumentNumber;
      customerContact: CustomerContactReference;
      jobLabel?: string;
      purchaseOrderNumber?: string;
      requestedDueDate?: string;
      terms: CommercialTerms;
      expiresAt?: string;
      requestedFulfillment?: import("./contracts.js").RequestedFulfillment;
      sellingAdjustment?: import("./contracts.js").SalesOrderAdjustment;
      commercialCharge?: CommercialCharge;
      lines: readonly SalesLineSnapshot[];
    }>,
  ): Promise<void>;
  read(
    organizationId: OrganizationId,
    quoteId: QuoteId,
    forUpdate?: boolean,
  ): Promise<QuoteReadModel | null>;
  readCheckpoint?(organizationId: OrganizationId, quoteId: QuoteId, checkpointId: QuoteCheckpointId): Promise<QuoteCheckpoint | null>;
  readPublishedCheckpoints?(organizationId: OrganizationId, quoteId: QuoteId): Promise<readonly QuoteCheckpoint[]>;
  update(
    input: Readonly<{
      organizationId: OrganizationId;
      quoteId: QuoteId;
      expectedRevision: number;
      customerContact: CustomerContactReference;
      jobLabel?: string;
      purchaseOrderNumber?: string;
      requestedDueDate?: string;
      expiresAt?: string;
      terms: CommercialTerms;
      lines: readonly SalesLineSnapshot[];
      requestedFulfillment?: import("./contracts.js").RequestedFulfillment;
      sellingAdjustment?: import("./contracts.js").SalesOrderAdjustment;
      commercialCharge?: CommercialCharge;
    }>,
  ): Promise<boolean>;
  transition(
    input: Readonly<{
      organizationId: OrganizationId;
      quoteId: QuoteId;
      expectedRevision: number;
      kind: "send" | "accept" | "decline" | "void";
      checkpoint: QuoteCheckpoint;
      operationRequestId: string;
      /** A send transition may only consume the composition atomically
       * frozen during delivery preparation. */
      frozenTaxComposition?: SalesTaxComposition;
    }>,
  ): Promise<boolean>;
  /** The customer-document adapter owns this explicit mutation boundary.
   * Normal Quote reads must never call it. */
  freezeTaxComposition(input: Readonly<{
    organizationId: OrganizationId;
    quoteId: QuoteId;
    expectedRevision: string;
  }>): Promise<QuoteReadModel | null>;
}

/** Conversion-only persistence operations.  They are intentionally separate
 * from normal Quote editing so direct Quote code cannot manufacture lineage. */
export interface QuoteConversionPersistencePort extends QuoteTransaction {
  readCheckpoint(
    organizationId: OrganizationId,
    quoteId: QuoteId,
    checkpointId: QuoteCheckpointId,
  ): Promise<QuoteCheckpoint | null>;
  appendConvertedCheckpoint(input: Readonly<{
    organizationId: OrganizationId;
    quoteId: QuoteId;
    checkpoint: QuoteCheckpoint;
    operationRequestId: string;
  }>): Promise<void>;
  createConversionLineage(input: Readonly<{
    organizationId: OrganizationId;
    quoteId: QuoteId;
    sourceCheckpointId: QuoteCheckpointId;
    convertedCheckpointId: QuoteCheckpointId;
    orderId: import("../shared/commercialValues.js").OrderId;
    operationRequestId: string;
  }>): Promise<void>;
  succeedConversion(
    organizationId: string,
    requestId: string,
    quoteId: QuoteId,
    result: unknown,
  ): Promise<void>;
}
export interface QuoteTransactionRunner {
  transaction<T>(
    action: (transaction: QuoteTransaction) => Promise<T>,
  ): Promise<T>;
}

const fingerprint = (value: unknown): string =>
  `sha256:${createHash("sha256").update(canonicalJson(value)).digest("hex")}`;
const toAttribution = (context: OperationContext): AttributionSnapshot =>
  context.principal.kind === "delegated_ai"
    ? {
        principalKind: "delegated_ai",
        subjectId: principalSubject(context.principal),
        staffActorUserId: staffActorId(context.principal)!,
      }
    : {
        principalKind: context.principal.kind,
        subjectId: principalSubject(context.principal),
      };

/**
 * Lifecycle checkpoints are Sales-owned evidence.  Acceptance-and-conversion
 * reuses this constructor inside its one transaction rather than recreating
 * an accepted-only state in a separate application service.
 */
export const createQuoteLifecycleCheckpoint = (
  quote: QuoteCurrentState,
  kind: "send" | "accept" | "decline" | "void",
  checkpointId: QuoteCheckpointId,
  presentation: CustomerPresentationIdentity,
  context: OperationContext,
  reason?: string,
  organizationPresentation?: DocumentOrganizationIdentity,
  sentEvidence?: QuoteSentDeliveryEvidence,
): QuoteCheckpoint => {
  const raw = {
    schemaVersion: 1 as const,
    checkpointId,
    evidenceFingerprint: "",
    organizationId: quote.organizationId,
    occurredAt: new Date().toISOString(),
    principal: toAttribution(context),
    customerPresentation: presentation,
    ...(organizationPresentation ? { organizationPresentation } : {}),
    ...(kind === "send" && sentEvidence ? { sentEvidence } : {}),
    commercial: quoteCommercialSnapshot(quote),
    kind: kind === "send" ? ("quote_sent" as const) : kind === "accept" ? ("quote_accepted" as const) : kind === "decline" ? ("quote_declined" as const) : ("quote_voided" as const),
    ...((kind === "decline" || kind === "void") ? { reason: reason ?? "" } : {}),
    sourceDocument: { quoteId: quote.quoteId },
  };
  return freezeCheckpoint({
    ...raw,
    evidenceFingerprint: fingerprint(raw),
  }) as QuoteCheckpoint;
};
const requireAllowed = (
  policy: AuthorityPolicy,
  context: OperationContext,
  capability:
    | "quote.view"
    | "quote.create"
    | "quote.edit"
    | "quote.send"
    | "quote.overridePrice",
  customerId?: string,
): void => {
  const decision = policy.decide(context.principal, {
    capability,
    resource: { organizationId: context.organizationId, customerId },
  });
  if (!decision.allowed)
    throw new V2ApplicationError(
      "FORBIDDEN",
      "The principal does not have authority for this Quote operation.",
    );
};
const validateReference = async (
  organizationId: string,
  customers: CustomersReadPort,
  reference: CustomerContactReference,
): Promise<void> => {
  if (reference.organizationId !== organizationId)
    throw new V2ApplicationError(
      "WRONG_TENANT",
      "Customer or contact is unavailable in this organization.",
    );
  if (!(await customers.validateContactReference(reference)))
    throw new V2ApplicationError(
      "NOT_FOUND",
      "Customer or contact is unavailable in this organization.",
    );
};
const resolvedTerms = async (customers: CustomersReadPort, organizationId: string, reference: CustomerContactReference, requested: CommercialTerms): Promise<CommercialTerms> => {
  if (requested.termsCode || !reference.customerId || !customers.getCommercialPolicy) return requested;
  const policy = await customers.getCommercialPolicy(organizationId as OrganizationId, reference.customerId);
  return policy?.paymentTerms ? { ...requested, termsCode: policy.paymentTerms } : requested;
};
const validateFulfillment = (value: import("./contracts.js").RequestedFulfillment | undefined): import("./contracts.js").RequestedFulfillment | undefined => {
  if (!value) return undefined;
  if ((value.method === "shipping" || value.method === "local_delivery") && !value.destination)
    throw new V2ApplicationError("VALIDATION_ERROR", "Shipping or local delivery requires a Quote destination snapshot.");
  if (value.method === "pickup" && value.destination)
    throw new V2ApplicationError("VALIDATION_ERROR", "Pickup does not use a destination.");
  if (!value.destination) return { method: value.method, ...(value.instructions?.trim() ? { instructions: value.instructions.trim() } : {}) };
  if (!value.destination.addressLine1?.trim() || !value.destination.city?.trim() || !value.destination.country?.trim() || !value.destination.region?.trim())
    throw new V2ApplicationError("VALIDATION_ERROR", "Quote destination requires street, city, region, and country for tax sourcing.");
  return { method: value.method, destination: { ...value.destination, addressLine1: value.destination.addressLine1.trim(), city: value.destination.city.trim(), country: value.destination.country.trim(), region: value.destination.region.trim() }, ...(value.instructions?.trim() ? { instructions: value.instructions.trim() } : {}) };
};
const validateAdjustment = (value: import("./contracts.js").SalesOrderAdjustment | undefined): import("./contracts.js").SalesOrderAdjustment | undefined => {
  if (!value) return undefined;
  if (!Number.isSafeInteger(value.cents) || value.cents === 0 || !value.reason.trim()) throw new V2ApplicationError("VALIDATION_ERROR", "A Quote adjustment needs a non-zero whole-cent amount and reason.");
  return { cents: value.cents, reason: value.reason.trim() };
};
const validateCommercialCharge = (value: CommercialCharge | undefined): CommercialCharge | undefined => {
  if (!value) return undefined;
  if (!Number.isSafeInteger(value.cents) || value.cents < 0) throw new V2ApplicationError("VALIDATION_ERROR", "A commercial charge must be a non-negative whole-cent amount.");
  return { ...value, ...(value.description?.trim() ? { description: value.description.trim() } : {}) };
};
export const calculatedDecision = (
  pricing: SalesLineSnapshot["pricingResult"],
  instruction: QuoteSellingInstruction | undefined,
  attribution: AttributionSnapshot,
): SellingPriceDecision => {
  const calculated = pricing.calculatedLineAmount;
  const quantity = pricing.normalizedInput.quantity;
  const assertCents = (value: number, name: string): number => {
    if (!Number.isSafeInteger(value) || value < 0)
      throw new V2ApplicationError(
        "VALIDATION_ERROR",
        `${name} must be a non-negative integer-cent amount.`,
      );
    return value;
  };
  const base = {
    pricingResultId: pricing.id,
    calculatedUnitAmount: pricing.calculatedUnitAmount,
    calculatedLineAmount: calculated,
    decidedAt: new Date().toISOString(),
    authorityReference: attribution,
  };
  if (!instruction || instruction.kind === "calculated")
    return {
      ...base,
      kind: "calculated",
      resultingUnitAmount: pricing.calculatedUnitAmount,
      resultingLineAmount: calculated,
    };
  if (!instruction.reason.trim())
    throw new V2ApplicationError(
      "VALIDATION_ERROR",
      "A selling-price override reason is required.",
    );
  if (
    instruction.kind === "discount" &&
    (instruction.discountBasisPoints < 0 ||
      instruction.discountBasisPoints > 10_000)
  )
    throw new V2ApplicationError(
      "VALIDATION_ERROR",
      "Discount basis points must be between 0 and 10000.",
    );
  const total =
    instruction.kind === "unit_override"
      ? assertCents(instruction.unitCents, "Unit override") * quantity
      : instruction.kind === "total_override"
        ? assertCents(instruction.totalCents, "Total override")
        : Math.round(
            (calculated.cents *
              (10_000 -
                assertCents(
                  instruction.discountBasisPoints,
                  "Discount basis points",
                ))) /
              10_000,
          );
  if (!Number.isSafeInteger(total))
    throw new V2ApplicationError(
      "VALIDATION_ERROR",
      "Selling price is outside safe money range.",
    );
  const resultingLineAmount = money(pricing.currency, total);
  const resultingUnitAmount = money(
    pricing.currency,
    Math.round(total / quantity),
  );
  return instruction.kind === "unit_override"
    ? {
        ...base,
        kind: "unit_override",
        reason: instruction.reason,
        resultingUnitAmount: money(pricing.currency, instruction.unitCents),
        resultingLineAmount,
      }
    : instruction.kind === "total_override"
      ? {
          ...base,
          kind: "total_override",
          reason: instruction.reason,
          resultingUnitAmount,
          resultingLineAmount,
        }
      : {
          ...base,
          kind: "discount",
          reason: instruction.reason,
          discountBasisPoints: percentageBasisPoints(
            instruction.discountBasisPoints,
          ),
          resultingUnitAmount,
          resultingLineAmount,
        };
};

export class QuoteApplicationService {
  constructor(
    private readonly runner: QuoteTransactionRunner,
    private readonly authority = new AuthorityPolicy(),
  ) {}
  async preview(
    context: OperationContext,
    input: QuoteLinePricingPreviewInput,
  ): Promise<ApplicationResult<QuoteLinePricingPreview>> {
    try {
      requireOperationPrincipalScope(context);
      requireAllowed(this.authority, context, "quote.create");
      return success(await this.runner.transaction(async (tx) => {
        const line = (await this.buildLines(tx, context, [{ ...input, selling: { kind: "calculated" } }], []))[0];
        if (!line) throw new Error("Pricing preview did not resolve a line.");
        return {
          calculatedUnitAmount: line.pricingResult.calculatedUnitAmount,
          calculatedLineAmount: line.pricingResult.calculatedLineAmount,
          currency: line.pricingResult.currency,
          explanation: explainPricingResult(line.pricingResult),
        };
      }));
    } catch (error) {
      return failure(error instanceof V2ApplicationError ? error : new V2ApplicationError("RETRYABLE_FAILURE", "Pricing preview is unavailable."));
    }
  }
  async create(
    context: OperationContext,
    input: CreateQuoteInput,
  ): Promise<ApplicationResult<QuoteOperationResult>> {
    return this.mutate(
      context,
      "sales.quote.create.v1",
      input,
      "quote.create",
      async (tx, request) => {
        await validateReference(
          context.organizationId,
          tx.customers,
          input.customerContact,
        );
        requireAllowed(
          this.authority,
          context,
          "quote.create",
          input.customerContact.customerId,
        );
        const lines = await this.buildLines(tx, context, input.lines, []);
        const quoteId = brandedId<"QuoteId">(randomUUID());
        const number = await tx.allocateNumber(context.organizationId);
        await tx.create({
          quoteId,
          organizationId: brandedId<"OrganizationId">(context.organizationId),
          number,
          customerContact: input.customerContact,
          jobLabel: normalizeSalesJobLabel(input.jobLabel),
          purchaseOrderNumber: input.purchaseOrderNumber,
          requestedDueDate: input.requestedDueDate,
          terms: await resolvedTerms(tx.customers, context.organizationId, input.customerContact, input.terms ?? {}),
          expiresAt: input.expiresAt,
          requestedFulfillment: validateFulfillment(input.requestedFulfillment),
          sellingAdjustment: validateAdjustment(input.sellingAdjustment),
          commercialCharge: validateCommercialCharge(input.commercialCharge),
          lines,
        });
        const read = await tx.read(
          brandedId<"OrganizationId">(context.organizationId),
          quoteId,
        );
        if (!read) throw new Error("Created Quote could not be read.");
        await this.history(tx, context, request.id, "sales.quote.create.v1", {
          eventType: "quote_created",
          resourceId: quoteId,
          changes: [
            {
              group: "line",
              kind: "line_added",
              summary: `Quote created with ${lines.length} line(s).`,
            },
          ],
        });
        return { quote: read };
      },
    );
  }
  async read(
    context: OperationContext,
    quoteId: QuoteId,
  ): Promise<ApplicationResult<QuoteReadModel>> {
    try {
      requireOperationPrincipalScope(context);
      if (context.principal.kind === "portal") throw new V2ApplicationError("FORBIDDEN", "Use the customer-safe published Quote read.");
      const result = await this.runner.transaction(async (tx) => {
        const quote = await tx.read(
          brandedId<"OrganizationId">(context.organizationId),
          quoteId,
        );
        if (!quote)
          throw new V2ApplicationError("NOT_FOUND", "Quote was not found.");
        requireAllowed(
          this.authority,
          context,
          "quote.view",
          quote.quote.customerContact.customerId,
        );
        return quote;
      });
      return success(result);
    } catch (error) {
      return failure(this.error(error));
    }
  }
  async publicationHistory(context: OperationContext, quoteId: QuoteId): Promise<ApplicationResult<readonly QuoteCheckpoint[]>> {
    try {
      requireOperationPrincipalScope(context);
      if (context.principal.kind === "portal") throw new V2ApplicationError("FORBIDDEN", "Use the customer-safe published Quote read.");
      return success(await this.runner.transaction(async tx => {
        const current = await tx.read(brandedId<"OrganizationId">(context.organizationId), quoteId);
        if (!current) throw new V2ApplicationError("NOT_FOUND", "Quote was not found.");
        requireAllowed(this.authority, context, "quote.view", current.quote.customerContact.customerId);
        if (!tx.readPublishedCheckpoints) throw new V2ApplicationError("RETRYABLE_FAILURE", "Committed Quote history is unavailable.");
        const checkpoints = await tx.readPublishedCheckpoints(brandedId<"OrganizationId">(context.organizationId), quoteId);
        for (const checkpoint of checkpoints) {
          if (checkpoint.kind !== "quote_sent" || !current.checkpoints.some(summary => summary.kind === "quote_sent" && summary.checkpointId === checkpoint.checkpointId)
            || checkpoint.organizationId !== context.organizationId || checkpoint.sourceDocument?.quoteId !== quoteId)
            throw new V2ApplicationError("CONFLICT", "Quote history evidence is unavailable.");
          requireAllowed(this.authority, context, "quote.view", checkpoint.sentEvidence?.customerContact?.customerId);
        }
        return checkpoints;
      }));
    } catch (cause) { return failure(this.error(cause)); }
  }
  /** Creates a fresh Draft from frozen commercial facts, never lifecycle evidence. */
  async duplicate(
    context: OperationContext,
    input: DuplicateQuoteCommand,
  ): Promise<ApplicationResult<QuoteOperationResult>> {
    return this.mutate(context, "sales.quote.duplicate.v1", input, "quote.create", async (tx, request) => {
      const source = await tx.read(brandedId<"OrganizationId">(context.organizationId), input.quoteId, true);
      if (!source) throw new V2ApplicationError("NOT_FOUND", "Quote was not found.");
      requireAllowed(this.authority, context, "quote.view", source.quote.customerContact.customerId);
      requireAllowed(this.authority, context, "quote.create", source.quote.customerContact.customerId);
      if (source.quote.lines.some((line) => line.sellingPriceDecision.kind !== "calculated"))
        requireAllowed(this.authority, context, "quote.overridePrice", source.quote.customerContact.customerId);
      const quoteId = brandedId<"QuoteId">(randomUUID());
      const lines = source.quote.lines.map((line) => Object.freeze({ ...line, lineId: brandedId<"SalesLineId">(randomUUID()) }));
      await tx.create({
        quoteId,
        organizationId: brandedId<"OrganizationId">(context.organizationId),
        number: await tx.allocateNumber(context.organizationId),
        customerContact: source.quote.customerContact,
        jobLabel: source.quote.jobLabel,
        purchaseOrderNumber: source.quote.purchaseOrderNumber,
        requestedDueDate: source.quote.requestedDueDate,
        terms: source.quote.terms,
        expiresAt: source.quote.expiresAt,
        requestedFulfillment: source.quote.requestedFulfillment,
        sellingAdjustment: source.quote.sellingAdjustment,
        commercialCharge: source.quote.commercialCharge,
        lines,
      });
      const quote = await tx.read(brandedId<"OrganizationId">(context.organizationId), quoteId);
      if (!quote) throw new Error("Duplicated Quote could not be read.");
      await this.history(tx, context, request.id, "sales.quote.duplicate.v1", {
        eventType: "quote_duplicated",
        resourceId: quoteId,
        changes: [{ group: "line", kind: "line_added", summary: `Draft Quote duplicated from ${source.number.display}.` }],
      });
      return { quote };
    });
  }
  async update(
    context: OperationContext,
    input: UpdateQuoteInput,
  ): Promise<ApplicationResult<QuoteOperationResult>> {
    return this.mutate(
      context,
      "sales.quote.edit.v1",
      input,
      "quote.edit",
      async (tx, request) => {
        const current = await tx.read(
          brandedId<"OrganizationId">(context.organizationId),
          input.quoteId,
          true,
        );
        if (!current)
          throw new V2ApplicationError("NOT_FOUND", "Quote was not found.");
        if (current.quote.convertedOrderId)
          throw new V2ApplicationError("CONFLICT", "A converted Quote cannot be edited.");
        if (current.quote.lifecycleState !== "open")
          throw new V2ApplicationError("CONFLICT", "A declined or voided Quote cannot be edited.");
        if (current.quote.acceptanceState === "accepted")
          throw new V2ApplicationError("CONFLICT", "An accepted Quote is an immutable commercial source.");
        requireAllowed(
          this.authority,
          context,
          "quote.edit",
          current.quote.customerContact.customerId,
        );
        if (current.revision !== input.expectedRevision)
          throw new V2ApplicationError(
            "STALE_STATE",
            "Quote has changed; reload before editing.",
          );
        const patch = input.patch ?? {};
        const reference =
          patch.customerContact ?? current.quote.customerContact;
        await validateReference(
          context.organizationId,
          tx.customers,
          reference,
        );
        requireAllowed(this.authority, context, "quote.edit", reference.customerId);
        const lines = await this.applyLineChanges(
          tx,
          context,
          input.lineChanges ?? [],
          current.quote.lines,
        );
        const terms = patch.terms ?? current.quote.terms;
        const jobLabel = patch.jobLabel === undefined ? current.quote.jobLabel : normalizeSalesJobLabel(patch.jobLabel);
        const purchaseOrderNumber =
          patch.purchaseOrderNumber === null
            ? undefined
            : (patch.purchaseOrderNumber ?? current.quote.purchaseOrderNumber);
        const requestedDueDate =
          patch.requestedDueDate === null
            ? undefined
            : (patch.requestedDueDate ?? current.quote.requestedDueDate);
        const expiresAt = patch.expiresAt === null ? undefined : (patch.expiresAt ?? current.quote.expiresAt);
        const requestedFulfillment = patch.requestedFulfillment === null ? undefined : validateFulfillment(patch.requestedFulfillment ?? current.quote.requestedFulfillment);
        const sellingAdjustment = patch.sellingAdjustment === null ? undefined : validateAdjustment(patch.sellingAdjustment ?? current.quote.sellingAdjustment);
        const commercialCharge = patch.commercialCharge === null ? undefined : validateCommercialCharge(patch.commercialCharge ?? current.quote.commercialCharge);
        const headerUnchanged =
          reference.customerId === current.quote.customerContact.customerId &&
          reference.contactId === current.quote.customerContact.contactId &&
          jobLabel === current.quote.jobLabel &&
          purchaseOrderNumber === current.quote.purchaseOrderNumber &&
          requestedDueDate === current.quote.requestedDueDate &&
          expiresAt === current.quote.expiresAt &&
          terms.termsCode === current.quote.terms.termsCode &&
          terms.taxContextReference ===
            current.quote.terms.taxContextReference &&
          terms.salesRepresentativeId ===
            current.quote.terms.salesRepresentativeId &&
          terms.commercialNotes === current.quote.terms.commercialNotes;
        const commercialUnchanged = canonicalJson(requestedFulfillment ?? null) === canonicalJson(current.quote.requestedFulfillment ?? null)
          && canonicalJson(sellingAdjustment ?? null) === canonicalJson(current.quote.sellingAdjustment ?? null)
          && canonicalJson(commercialCharge ?? null) === canonicalJson(current.quote.commercialCharge ?? null);
        // When a command does not change lines, preserve their persisted snapshots
        // exactly rather than treating explanatory pricing evidence as comparison DTOs.
        // Line-changing commands are necessarily meaningful commercial edits.
        const unchanged =
          headerUnchanged && commercialUnchanged && (input.lineChanges?.length ?? 0) === 0;
        if (unchanged) return { quote: current };
        const applied = await tx.update({
          organizationId: brandedId<"OrganizationId">(context.organizationId),
          quoteId: input.quoteId,
          expectedRevision: Number(current.revision),
          customerContact: reference,
          jobLabel,
          purchaseOrderNumber,
          requestedDueDate,
          expiresAt,
          terms,
          lines,
          requestedFulfillment,
          sellingAdjustment,
          commercialCharge,
        });
        if (!applied)
          throw new V2ApplicationError(
            "STALE_STATE",
            "Quote has changed; reload before editing.",
          );
        const read = await tx.read(
          brandedId<"OrganizationId">(context.organizationId),
          input.quoteId,
        );
        if (!read) throw new Error("Updated Quote could not be read.");
        const changes: MeaningfulAuditChange[] = [];
        if (jobLabel !== current.quote.jobLabel)
          changes.push({ group: "commercial_terms", kind: "terms_changed", summary: "Job Label updated." });
        if (reference.customerId !== current.quote.customerContact.customerId)
          changes.push({
            group: "customer",
            kind: "customer_changed",
            summary: "Customer changed.",
          });
        if (reference.contactId !== current.quote.customerContact.contactId)
          changes.push({
            group: "customer",
            kind: "contact_changed",
            summary: "Contact changed.",
          });
        if (purchaseOrderNumber !== current.quote.purchaseOrderNumber)
          changes.push({
            group: "commercial_terms",
            kind: "po_changed",
            summary: "PO number updated.",
          });
        if (requestedDueDate !== current.quote.requestedDueDate)
          changes.push({
            group: "commercial_terms",
            kind: "requested_due_date_changed",
            summary: "Requested due date changed.",
          });
        if (expiresAt !== current.quote.expiresAt)
          changes.push({ group: "commercial_terms", kind: "terms_changed", summary: "Quote expiry updated." });
        if (terms.commercialNotes !== current.quote.terms.commercialNotes)
          changes.push({
            group: "notes",
            kind: "notes_changed",
            summary: "Commercial notes updated.",
          });
        if (
          terms.termsCode !== current.quote.terms.termsCode ||
          terms.taxContextReference !==
            current.quote.terms.taxContextReference ||
          terms.salesRepresentativeId !==
            current.quote.terms.salesRepresentativeId
        )
          changes.push({
            group: "commercial_terms",
            kind: "terms_changed",
            summary: "Commercial terms updated.",
          });
        for (const change of input.lineChanges ?? [])
          changes.push({
            group: "line",
            kind:
              change.kind === "add"
                ? "line_added"
                : change.kind === "remove"
                  ? "line_removed"
                  : "configuration_changed",
            ...(change.kind === "update" ? { resourceId: change.lineId } : {}),
            summary:
              change.kind === "add"
                ? "Quote line added."
                : change.kind === "remove"
                  ? "Quote line removed."
                  : "Quote line updated.",
          });
        await this.history(tx, context, request.id, "sales.quote.edit.v1", {
          eventType: "quote_updated",
          resourceId: input.quoteId,
          changes,
        });
        return { quote: read };
      },
    );
  }
  /** Starts a new internal revision without changing the published checkpoint.
   * Accepted/converted sources remain locked; this never reopens an Order. */
  async revise(context: OperationContext, input: QuoteLifecycleInput): Promise<ApplicationResult<QuoteOperationResult>> {
    return this.mutate(context, "sales.quote.revise.v1", input, "quote.edit", async (tx, request) => {
      const organizationId = brandedId<"OrganizationId">(context.organizationId);
      const current = await tx.read(organizationId, input.quoteId, true);
      if (!current) throw new V2ApplicationError("NOT_FOUND", "Quote was not found.");
      requireAllowed(this.authority, context, "quote.edit", current.quote.customerContact.customerId);
      if (current.revision !== input.expectedRevision) throw new V2ApplicationError("STALE_STATE", "Quote has changed; reload before revising.");
      if (current.quote.deliveryState !== "sent" || current.quote.acceptanceState !== "not_accepted" || current.quote.lifecycleState !== "open" || current.quote.convertedOrderId)
        throw new V2ApplicationError("CONFLICT", "Only an open, unaccepted sent Quote can start another internal revision.");
      await validateReference(context.organizationId, tx.customers, current.quote.customerContact);
      const applied = await tx.update({ organizationId, quoteId: input.quoteId, expectedRevision: Number(current.revision),
        customerContact: current.quote.customerContact, jobLabel: current.quote.jobLabel, purchaseOrderNumber: current.quote.purchaseOrderNumber,
        requestedDueDate: current.quote.requestedDueDate, expiresAt: current.quote.expiresAt, terms: current.quote.terms, lines: current.quote.lines,
        requestedFulfillment: current.quote.requestedFulfillment, sellingAdjustment: current.quote.sellingAdjustment, commercialCharge: current.quote.commercialCharge });
      if (!applied) throw new V2ApplicationError("STALE_STATE", "Quote has changed; reload before revising.");
      const quote = await tx.read(organizationId, input.quoteId);
      if (!quote) throw new Error("Revised Quote could not be read.");
      await this.history(tx, context, request.id, "sales.quote.revise.v1", { eventType: "quote_internal_revision_started", resourceId: input.quoteId,
        changes: [{ group: "commercial_terms", kind: "terms_changed", summary: "New internal revision started. Published sent history is unchanged." }] });
      return { quote };
    });
  }
  async recordDelivered(
    context: OperationContext,
    input: QuoteDeliveredInput,
  ): Promise<ApplicationResult<QuoteOperationResult>> {
    if (!input.deliveryAttemptId.trim() || !input.providerMessageId.trim())
      return failure(new V2ApplicationError("VALIDATION_ERROR", "Provider delivery evidence is required before recording a sent Quote."));
    const prepared = input.preparedSnapshot as PreparedQuoteDeliveryEvidence | undefined;
    if (!prepared || prepared.schemaVersion !== 1
      || !prepared.quoteId || !prepared.organizationId || !prepared.expectedRevision
      || !prepared.customerContact || !prepared.customerPresentation || !prepared.commercial
      || typeof prepared.recipientEmail !== "string" || !prepared.recipientEmail.trim()
      || typeof prepared.documentNumber !== "string" || !prepared.documentNumber.trim()
      || typeof prepared.documentDate !== "string" || !prepared.documentDate.trim()
      || !prepared.organizationPresentation || typeof prepared.organizationPresentation.name !== "string" || !prepared.organizationPresentation.name.trim()
      || typeof prepared.documentSha256 !== "string" || !/^sha256:[0-9a-f]{64}$/u.test(prepared.documentSha256))
      return failure(new V2ApplicationError("VALIDATION_ERROR", "Prepared Quote document evidence is required before recording a sent Quote."));
    return this.lifecycle(
      context,
      input,
      "send",
      "quote.send",
      "sales.quote.send.v1",
    );
  }
  async decline(context: OperationContext, input: QuoteTerminalInput): Promise<ApplicationResult<QuoteOperationResult>> {
    return this.terminal(context, input, "decline");
  }
  async void(context: OperationContext, input: QuoteTerminalInput): Promise<ApplicationResult<QuoteOperationResult>> {
    return this.terminal(context, input, "void");
  }
  private async terminal(context: OperationContext, input: QuoteTerminalInput, kind: "decline" | "void"): Promise<ApplicationResult<QuoteOperationResult>> {
    return this.mutate(context, `sales.quote.${kind}.v1`, input, "quote.edit", async (tx, request) => {
      const current = await tx.read(brandedId<"OrganizationId">(context.organizationId), input.quoteId, true);
      if (!current) throw new V2ApplicationError("NOT_FOUND", "Quote was not found.");
      requireAllowed(this.authority, context, "quote.edit", current.quote.customerContact.customerId);
      const reason = input.reason.trim();
      if (!reason) throw new V2ApplicationError("VALIDATION_ERROR", "A reason is required.");
      if (current.quote.convertedOrderId || current.quote.lifecycleState !== "open") throw new V2ApplicationError("CONFLICT", "This Quote cannot receive a terminal outcome.");
      if (current.revision !== input.expectedRevision) throw new V2ApplicationError("STALE_STATE", "Quote has changed; reload before transition.");
      if (kind === "decline" && current.quote.deliveryState !== "sent") throw new V2ApplicationError("CONFLICT", "Only a delivered Quote can be recorded as declined.");
      const checkpoint = createQuoteLifecycleCheckpoint(current.quote, kind, brandedId<"QuoteCheckpointId">(randomUUID()), await tx.customers.getPresentationIdentity(current.quote.customerContact), context, reason);
      const applied = await tx.transition({ organizationId: brandedId<"OrganizationId">(context.organizationId), quoteId: input.quoteId, expectedRevision: Number(current.revision), kind, checkpoint, operationRequestId: request.id });
      if (!applied) throw new V2ApplicationError("STALE_STATE", "Quote has changed; reload before transition.");
      const read = await tx.read(brandedId<"OrganizationId">(context.organizationId), input.quoteId);
      if (!read) throw new Error("Transitioned Quote could not be read.");
      await this.history(tx, context, request.id, `sales.quote.${kind}.v1`, { eventType: kind === "decline" ? "quote_declined" : "quote_voided", resourceId: input.quoteId, changes: [] });
      return { quote: read, checkpointId: checkpoint.checkpointId };
    });
  }
  private async lifecycle(
    context: OperationContext,
    input: QuoteDeliveredInput,
    kind: "send",
    capability: "quote.send",
    operation: string,
  ): Promise<ApplicationResult<QuoteOperationResult>> {
    const requestCommand = {
      businessRequestId: input.businessRequestId,
      quoteId: input.quoteId,
      expectedRevision: input.expectedRevision,
      deliveryAttemptId: input.deliveryAttemptId,
      providerMessageId: input.providerMessageId,
      ...(input.frozenTaxComposition ? { frozenTaxComposition: input.frozenTaxComposition } : {}),
      preparedSnapshot: input.preparedSnapshot,
    };
    return this.mutate(
      context,
      operation,
      requestCommand,
      capability,
      async (tx, request) => {
        const current = await tx.read(
          brandedId<"OrganizationId">(context.organizationId),
          input.quoteId,
          true,
        );
        if (!current)
          throw new V2ApplicationError("NOT_FOUND", "Quote was not found.");
        if (current.quote.convertedOrderId)
          throw new V2ApplicationError("CONFLICT", "A converted Quote cannot transition.");
        if (current.quote.lifecycleState !== "open")
          throw new V2ApplicationError("CONFLICT", "A declined or voided Quote cannot transition.");
        requireAllowed(
          this.authority,
          context,
          capability,
          current.quote.customerContact.customerId,
        );
        if (current.revision !== input.expectedRevision)
          throw new V2ApplicationError(
            "STALE_STATE",
            "Quote has changed; reload before transition.",
          );
        if (input.preparedSnapshot.organizationId !== context.organizationId
          || input.preparedSnapshot.quoteId !== input.quoteId
          || input.preparedSnapshot.expectedRevision !== input.expectedRevision
          || current.quote.quoteId !== input.preparedSnapshot.quoteId
          || current.quote.organizationId !== input.preparedSnapshot.organizationId
          || canonicalJson(current.quote.customerContact) !== canonicalJson(input.preparedSnapshot.customerContact)
          || canonicalJson(quoteCommercialSnapshot(current.quote)) !== canonicalJson(input.preparedSnapshot.commercial))
          throw new V2ApplicationError("STALE_STATE", "The Quote changed after its customer document was prepared.");
        if (current.quote.acceptanceState === "accepted")
          throw new V2ApplicationError(
            "CONFLICT",
            "An accepted Quote cannot be resent; create a new draft instead.",
          );
        const frozenTaxComposition = input.frozenTaxComposition ?? current.quote.taxComposition;
        if (!frozenTaxComposition || frozenTaxComposition.status !== "resolved")
          throw new V2ApplicationError("CONFLICT", "A customer document requires resolved authoritative tax.");
        if (canonicalJson(frozenTaxComposition) !== canonicalJson(input.preparedSnapshot.commercial.taxComposition))
          throw new V2ApplicationError("STALE_STATE", "Prepared Quote tax evidence no longer matches the Quote.");
        const checkpointId = brandedId<"QuoteCheckpointId">(randomUUID());
        const sentEvidence: QuoteSentDeliveryEvidence = {
          customerContact: input.preparedSnapshot.customerContact,
          deliveryAttemptId: input.deliveryAttemptId,
          recipientEmail: input.preparedSnapshot.recipientEmail,
          documentSha256: input.preparedSnapshot.documentSha256,
          documentNumber: input.preparedSnapshot.documentNumber,
          documentDate: input.preparedSnapshot.documentDate,
          providerMessageId: input.providerMessageId,
        };
        const checkpoint = createQuoteLifecycleCheckpoint(
          current.quote,
          kind,
          checkpointId,
          input.preparedSnapshot.customerPresentation,
          context,
          undefined,
          input.preparedSnapshot.organizationPresentation,
          sentEvidence,
        );
        const applied = await tx.transition({
          organizationId: brandedId<"OrganizationId">(context.organizationId),
          quoteId: input.quoteId,
          expectedRevision: Number(current.revision),
          kind,
          checkpoint,
          operationRequestId: request.id,
          frozenTaxComposition,
        });
        if (!applied)
          throw new V2ApplicationError(
            "STALE_STATE",
            "Quote has changed; reload before transition.",
          );
        const read = await tx.read(
          brandedId<"OrganizationId">(context.organizationId),
          input.quoteId,
        );
        if (!read) throw new Error("Transitioned Quote could not be read.");
        await this.history(tx, context, request.id, operation, {
          eventType: kind === "send" ? "quote_sent" : "quote_accepted",
          resourceId: input.quoteId,
          changes: [],
        });
        return { quote: read, checkpointId };
      },
    );
  }
  private async mutate(
    context: OperationContext,
    operation: string,
    command: unknown,
    capability: "quote.create" | "quote.edit" | "quote.send",
    work: (
      tx: QuoteTransaction,
      request: QuoteOperationRequest,
    ) => Promise<QuoteOperationResult>,
  ): Promise<ApplicationResult<QuoteOperationResult>> {
    try {
      requireOperationPrincipalScope(context);
      requireAllowed(this.authority, context, capability);
      if (!context.businessRequest)
        throw new V2ApplicationError(
          "VALIDATION_ERROR",
          "A business request identity is required.",
        );
      if (
        !command ||
        typeof command !== "object" ||
        (command as { businessRequestId?: unknown }).businessRequestId !==
          context.businessRequest.id
      )
        throw new V2ApplicationError(
          "VALIDATION_ERROR",
          "The command business request identity does not match the operation context.",
        );
      return success(
        await this.runner.transaction(async (tx) => {
          const reservation = await tx.reserve({
            organizationId: context.organizationId,
            operation,
            businessRequestId: context.businessRequest!.id,
            payloadFingerprint: fingerprint(command),
            principalKind: context.principal.kind,
            principalSubject: principalSubject(context.principal),
            ...(staffActorId(context.principal)
              ? { staffActorUserId: staffActorId(context.principal) }
              : {}),
          });
          if (reservation.kind === "replay") {
            const saved = reservation.request.resultJson as QuoteOperationResult | null;
            if (!saved?.quote || saved.quote.quote.organizationId !== context.organizationId)
              throw new V2ApplicationError("CONFLICT", "The Quote request has no safe completed result.");
            const current = await tx.read(brandedId<"OrganizationId">(context.organizationId), saved.quote.quote.quoteId);
            if (!current) throw new V2ApplicationError("NOT_FOUND", "Quote was not found.");
            requireAllowed(this.authority, context, capability, current.quote.customerContact.customerId);
            requireAllowed(this.authority, context, capability, saved.quote.quote.customerContact.customerId);
            return saved;
          }
          const result = await work(tx, reservation.request);
          await tx.attribute({
            organizationId: context.organizationId,
            requestId: reservation.request.id,
            operation,
            resourceType: "quote",
            resourceId: result.quote.quote.quoteId,
            principalKind: context.principal.kind,
            principalSubject: principalSubject(context.principal),
            ...(staffActorId(context.principal)
              ? { staffActorUserId: staffActorId(context.principal) }
              : {}),
          });
          await tx.succeed(
            context.organizationId,
            reservation.request.id,
            result,
          );
          return result;
        }),
      );
    } catch (error) {
      return failure(this.error(error));
    }
  }
  private async history(
    tx: QuoteTransaction,
    context: OperationContext,
    requestId: string,
    operation: string,
    event: QuoteAuditEvent,
  ): Promise<void> {
    await tx.audit({
      organizationId: context.organizationId,
      requestId,
      operation,
      event,
      principalKind: context.principal.kind,
      principalSubject: principalSubject(context.principal),
      ...(staffActorId(context.principal)
        ? { staffActorUserId: staffActorId(context.principal) }
        : {}),
    });
  }
  private async buildLines(
    tx: QuoteTransaction,
    context: OperationContext,
    inputs: readonly QuoteLineInput[],
    existing: readonly SalesLineSnapshot[],
  ): Promise<SalesLineSnapshot[]> {
    const lines: SalesLineSnapshot[] = [];
    for (const [index, input] of inputs.entries()) {
      if (!Number.isSafeInteger(input.quantity) || input.quantity <= 0)
        throw new V2ApplicationError(
          "VALIDATION_ERROR",
          "Line quantity must be a positive integer.",
        );
      if (input.selling && input.selling.kind !== "calculated")
        requireAllowed(this.authority, context, "quote.overridePrice");
      const resolved = await tx.products.resolveActivePricingInput({
        organizationId: brandedId<"OrganizationId">(context.organizationId),
        productId: brandedId<"ProductId">(input.productId),
        quantity: input.quantity,
        ...(input.selections ? { selections: input.selections as never } : {}),
        ...(input.dimensions ? { dimensions: input.dimensions } : {}),
      });
      if (!resolved.ok) throw resolved.error;
      const taxability = await tx.products.resolveCurrentTaxability(
        brandedId<"OrganizationId">(context.organizationId),
        resolved.value.sellableProduct.productId,
      );
      if (!taxability) throw new V2ApplicationError("NOT_FOUND", "The Product taxability policy is unavailable.");
      const pricing = await tx.pricing.calculate({
        organizationId: brandedId<"OrganizationId">(context.organizationId),
        sellableProduct: resolved.value.sellableProduct,
        resolvedConfiguration: resolved.value.resolvedConfiguration,
        pricingContext: {
          channel:
            context.principal.kind === "staff"
              ? "staff"
              : context.principal.kind === "portal"
                ? "portal"
                : context.principal.kind === "service"
                  ? "service"
                  : "ai",
          effectiveAt: new Date().toISOString(),
        },
        rules: resolved.value.rules,
        ...(resolved.value.nestingEstimate
          ? { nestingEstimate: resolved.value.nestingEstimate }
          : {}),
      });
      const decision = calculatedDecision(
        pricing,
        input.selling,
        toAttribution(context),
      );
      const prior = existing[index];
      const line: SalesLineSnapshot = {
        lineId: prior?.lineId ?? brandedId<"SalesLineId">(randomUUID()),
        productId: resolved.value.sellableProduct.productId,
        ...(resolved.value.sellableProduct.productTypeId
          ? { productTypeId: resolved.value.sellableProduct.productTypeId }
          : {}),
        description:
          input.description?.trim() ||
          resolved.value.sellableProduct.displayName,
        quantity: input.quantity,
        resolvedConfiguration: resolved.value.resolvedConfiguration,
        pricingResult: pricing,
        sellingPriceDecision: decision,
        calculatedLineAmount: pricing.calculatedLineAmount,
        sellingLineAmount: decision.resultingLineAmount,
        taxability: { taxable: taxability.taxable, source: "product" },
      };
      assertSalesLineSnapshot(line);
      lines.push(line);
    }
    return lines;
  }
  private async applyLineChanges(
    tx: QuoteTransaction,
    context: OperationContext,
    changes: NonNullable<UpdateQuoteInput["lineChanges"]>,
    current: readonly SalesLineSnapshot[],
  ): Promise<SalesLineSnapshot[]> {
    const next = [...current];
    for (const change of changes) {
      if (change.kind === "reorder") {
        if (change.lineIds.length !== next.length || new Set(change.lineIds).size !== next.length || change.lineIds.some((id) => !next.some((line) => line.lineId === id)))
          throw new V2ApplicationError("VALIDATION_ERROR", "Quote line order must include every line exactly once.");
        next.splice(0, next.length, ...change.lineIds.map((id) => next.find((line) => line.lineId === id)!));
        continue;
      }
      if (change.kind === "duplicate") {
        const index = next.findIndex((line) => line.lineId === change.sourceLineId);
        if (index < 0) throw new V2ApplicationError("NOT_FOUND", "Quote line was not found.");
        const source = next[index]!;
        if (source.sellingPriceDecision.kind !== "calculated") requireAllowed(this.authority, context, "quote.overridePrice");
        next.splice(index + 1, 0, Object.freeze({ ...source, lineId: brandedId<"SalesLineId">(randomUUID()) }));
        continue;
      }
      if (change.kind === "remove") {
        const index = next.findIndex((line) => line.lineId === change.lineId);
        if (index < 0)
          throw new V2ApplicationError(
            "NOT_FOUND",
            "Quote line was not found.",
          );
        next.splice(index, 1);
        continue;
      }
      if (change.kind === "add") {
        next.push(...(await this.buildLines(tx, context, [change.line], [])));
        continue;
      }
      const index = next.findIndex((line) => line.lineId === change.lineId);
      if (index < 0)
        throw new V2ApplicationError("NOT_FOUND", "Quote line was not found.");
      const replacement = await this.buildLines(
        tx,
        context,
        [change.line],
        [next[index]!],
      );
      next[index] = replacement[0]!;
    }
    return next;
  }
  private error(error: unknown): V2ApplicationError {
    return error instanceof V2ApplicationError
      ? error
      : new V2ApplicationError(
          "INTERNAL_ERROR",
          "Quote operation could not be completed.",
        );
  }
}
