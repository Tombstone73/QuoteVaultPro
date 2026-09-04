import { createHash, randomUUID } from "node:crypto";
import type { OperationContext } from "../../application/operation.js";
import { requireOperationPrincipalScope } from "../../application/operation.js";
import { AuthorityPolicy } from "../../authorization/authorityPolicy.js";
import { principalSubject, staffActorId } from "../../authorization/principals.js";
import {
  failure,
  success,
  type ApplicationResult,
  V2ApplicationError,
} from "../../errors/applicationError.js";
import type {
  BillingPort,
  BillingReadPort,
  DraftInvoiceSynchronizationInput,
  DraftInvoiceSynchronizationResult,
} from "../billing/contracts.js";
import type { CustomerContactReference, CustomersReadPort } from "../customers/contracts.js";
import type { PricingPort } from "../pricing/contracts.js";
import type {
  ProductPricingCompatibilityPort,
  ResolveActivePricingInput,
} from "../products/contracts.js";
import type { InstantiateRouteResult, RouteInstance, RoutingPort } from "../routing/contracts.js";
import type { RoutePrerequisite } from "../routing/routingLifecycle.js";
import {
  brandedId,
  canonicalJson,
  money,
  type CurrencyCode,
  type InvoiceId,
  type Money,
  type OrderId,
  type OrderLineId,
  type OrganizationId,
  type RouteTemplateId,
  type SalesLineId,
} from "../shared/commercialValues.js";
import {
  assertSalesLineSnapshot,
  type AttributionSnapshot,
  type ArchiveOrderCommand,
  type CancelOrderCommand,
  type CompleteOrderCommand,
  type CommercialTerms,
  type DuplicateOrderCommand,
  type MeaningfulAuditChange,
  type OrderCurrentState,
  type RequestedFulfillment,
  type SalesOrderAdjustment,
  type SalesLineSnapshot,
  type SellingPriceDecision,
} from "./contracts.js";
import type { OrderCompletionEligibility } from "./orderLifecycle.js";
import type { OrderAutomaticLifecycle } from "./orderAutomaticLifecycle.js";
import type { CommercialCharge } from "./taxComposition.js";
import type { SalesTaxComposition } from "./taxComposition.js";
import type { SalesDocumentNumber } from "./persistenceContracts.js";
import type { QuoteConversionTrace } from "./quoteConversionApplication.js";

/**
 * This is the server-side Order-entry input. It deliberately contains neither
 * a PBV2 tree nor caller-authored pricing evidence: Products resolves the
 * current configuration and Pricing produces the calculated evidence below.
 */
export type OrderLineInput = Readonly<{
  /** Opaque request-only correlation; never persisted as a commercial fact. */
  clientLineKey?: string;
  productId: string;
  description?: string;
  quantity: number;
  selections?: Readonly<Record<string, unknown>>;
  dimensions?: ResolveActivePricingInput["dimensions"];
  selling?: OrderSellingInstruction;
}>;

export type OrderSellingInstruction = Readonly<
  | { kind: "calculated" }
  | { kind: "unit_override"; unitCents: number; reason: string }
  | { kind: "total_override"; totalCents: number; reason: string }
>;

export type CreateOrderInput = Readonly<{
  businessRequestId: string;
  customerContact: CustomerContactReference;
  purchaseOrderNumber?: string;
  requestedDueDate?: string;
  requestedFulfillment?: RequestedFulfillment;
  sellingAdjustment?: SalesOrderAdjustment;
  commercialCharge?: CommercialCharge;
  terms?: CommercialTerms;
  lines: readonly OrderLineInput[];
}>;

/** Header-only in M1.9: line/routing edits require a later named coordination operation. */
export type UpdateOrderInput = Readonly<{
  businessRequestId: string;
  orderId: OrderId;
  expectedRevision: string;
  patch: Readonly<{
    customerContact?: CustomerContactReference;
    purchaseOrderNumber?: string | null;
    requestedDueDate?: string | null;
    terms?: CommercialTerms;
    requestedFulfillment?: RequestedFulfillment | null;
    sellingAdjustment?: SalesOrderAdjustment | null;
    commercialCharge?: CommercialCharge | null;
  }>;
  lineChanges?: readonly (
    | Readonly<{ kind: "add"; line: OrderLineInput }>
    | Readonly<{ kind: "update"; lineId: SalesLineId; line: OrderLineInput }>
    /** A Sales-owned presentation edit. It must not re-resolve or reprice a frozen line. */
    | Readonly<{ kind: "update_description"; lineId: SalesLineId; description: string }>
    | Readonly<{ kind: "remove"; lineId: SalesLineId }>
    | Readonly<{ kind: "duplicate"; sourceLineId: SalesLineId }>
    | Readonly<{ kind: "reorder"; lineIds: readonly SalesLineId[] }>
  )[];
}>;

export type OrderReadModel = Readonly<{
  order: OrderCurrentState;
  number: SalesDocumentNumber;
  revision: string;
  totals: Readonly<{
    calculated: Money;
    selling: Money;
  }>;
  draftInvoice?: Readonly<{
    invoiceId: InvoiceId;
    lifecycle: "draft";
    synchronizationVersion: string;
    lineCount: number;
    total: Money;
  }>;
  routes: readonly (RouteInstance & Readonly<{ currentPrerequisite?: RoutePrerequisite }>)[];
  completionEligibility: OrderCompletionEligibility;
}>;

export type OrderOperationResult = Readonly<{
  order: OrderReadModel;
  draftInvoiceId?: InvoiceId;
  routeInstances: readonly InstantiateRouteResult["routeInstance"][];
  lineCorrelations?: readonly Readonly<{ clientLineKey: string; orderLineId: SalesLineId }>[];
}>;

/**
 * A frozen commercial source is deliberately smaller than a Quote checkpoint:
 * it contains only the facts Sales owns that can seed a new Order.  Callers
 * must supply new line ids; a source document's line ids are never reused.
 */
export type FrozenOrderCommercialSource = Readonly<{
  customerContact: CustomerContactReference;
  purchaseOrderNumber?: string;
  requestedDueDate?: string;
  terms: CommercialTerms;
  requestedFulfillment?: RequestedFulfillment;
  sellingAdjustment?: SalesOrderAdjustment;
  commercialCharge?: CommercialCharge;
  /** Conversion supplies the accepted immutable composition; direct entry composes fresh evidence. */
  taxComposition?: SalesTaxComposition;
  lines: readonly SalesLineSnapshot[];
}>;

export type OrderOperationRequest = Readonly<{
  id: string;
  status: "in_progress" | "succeeded" | "retryable_failure" | "permanent_failure";
  resultJson: unknown | null;
}>;

export type OrderReservation = Readonly<{
  kind: "new" | "resumed" | "replay";
  request: OrderOperationRequest;
}>;

export type OrderAuditEvent = Readonly<{
  eventType: "order_created" | "order_updated" | "order_duplicated" | "order_cancelled" | "order_completed" | "order_archived" | "order_unarchived";
  resourceId: OrderId;
  changes: readonly MeaningfulAuditChange[];
}>;

/**
 * A transaction-scoped composition port. Its concrete M1.9 implementation is
 * constructed around one caller-owned PostgreSQL client: Sales, Billing and
 * Routing must never independently begin or commit a transaction here.
 */
export interface OrderTransaction {
  readonly customers: CustomersReadPort;
  readonly products: ProductPricingCompatibilityPort;
  readonly pricing: PricingPort;
  readonly billing: BillingPort & Pick<BillingReadPort, "readDraftForOrder" | "readInvoiceForOrder">;
  readonly routing: RoutingPort;
  readonly materialRequirements: Readonly<{
    freeze(organizationId: string, orderId: OrderId, lines: readonly SalesLineSnapshot[]): Promise<void>;
    hasFrozen(organizationId: string, orderLineId: SalesLineId): Promise<boolean>;
  }>;
  reserve(input: Readonly<{
    organizationId: string;
    operation: string;
    businessRequestId: string;
    payloadFingerprint: string;
    principalKind: "staff" | "delegated_ai" | "portal" | "service";
    principalSubject: string;
    staffActorUserId?: string;
  }>): Promise<OrderReservation>;
  succeed(
    organizationId: string,
    requestId: string,
    result: OrderOperationResult,
  ): Promise<void>;
  attribute(input: Readonly<{
    organizationId: string;
    requestId: string;
    operation: string;
    resourceType: "order";
    resourceId: OrderId;
    principalKind: "staff" | "delegated_ai" | "portal" | "service";
    principalSubject: string;
    staffActorUserId?: string;
  }>): Promise<void>;
  audit(input: Readonly<{
    organizationId: string;
    requestId: string;
    operation: string;
    event: OrderAuditEvent;
    principalKind: "staff" | "delegated_ai" | "portal" | "service";
    principalSubject: string;
    staffActorUserId?: string;
  }>): Promise<void>;
  allocateNumber(organizationId: string): Promise<SalesDocumentNumber>;
  create(input: Readonly<{
    orderId: OrderId;
    organizationId: OrganizationId;
    number: SalesDocumentNumber;
    customerContact: CustomerContactReference;
    purchaseOrderNumber?: string;
    requestedDueDate?: string;
    terms: CommercialTerms;
    lines: readonly SalesLineSnapshot[];
    requestedFulfillment?: RequestedFulfillment;
    sellingAdjustment?: SalesOrderAdjustment;
    commercialCharge?: CommercialCharge;
    taxComposition?: SalesTaxComposition;
  }>, trace?: QuoteConversionTrace): Promise<void>;
  read(
    organizationId: OrganizationId,
    orderId: OrderId,
    forUpdate?: boolean,
  ): Promise<OrderReadModel | null>;
  update(input: Readonly<{
    organizationId: OrganizationId;
    orderId: OrderId;
    expectedRevision: number;
    customerContact: CustomerContactReference;
    purchaseOrderNumber?: string;
    requestedDueDate?: string;
    terms: CommercialTerms;
    lines: readonly SalesLineSnapshot[];
    requestedFulfillment?: RequestedFulfillment;
    sellingAdjustment?: SalesOrderAdjustment;
    commercialCharge?: CommercialCharge;
  }>): Promise<boolean>;
  removeLinesNotIn(organizationId: OrganizationId, orderId: OrderId, retainedLineIds: readonly SalesLineId[]): Promise<void>;
  hasRoute(organizationId: OrganizationId, orderId: OrderId, lineId: SalesLineId): Promise<boolean>;
  /** Downstream owners remain independent. Sales consumes only these facts to
   * decide whether cancellation would create an impossible state. */
  cancellationBlockers(organizationId: OrganizationId, orderId: OrderId): Promise<readonly string[]>;
  completionEligibility(organizationId: OrganizationId, orderId: OrderId): Promise<OrderCompletionEligibility>;
  /** A commercial revision invalidates a derived closed state before the
   * revised canonical Invoice and obligations are recalculated. */
  reopen(organizationId: OrganizationId, orderId: OrderId): Promise<boolean>;
  complete(input: Readonly<{
    organizationId: OrganizationId; orderId: OrderId; expectedRevision: number;
    principalKind: "staff" | "delegated_ai" | "portal" | "service"; principalSubject: string; staffActorUserId?: string;
  }>): Promise<boolean>;
  archive(input: Readonly<{
    organizationId: OrganizationId; orderId: OrderId; expectedRevision: number;
    principalKind: "staff" | "delegated_ai" | "portal" | "service"; principalSubject: string; staffActorUserId?: string;
  }>): Promise<boolean>;
  unarchive(input: Readonly<{ organizationId: OrganizationId; orderId: OrderId; expectedRevision: number }>): Promise<boolean>;
  cancel(input: Readonly<{
    organizationId: OrganizationId;
    orderId: OrderId;
    expectedRevision: number;
    reason: string;
  }>): Promise<boolean>;
}

export interface OrderTransactionRunner {
  transaction<T>(action: (transaction: OrderTransaction) => Promise<T>): Promise<T>;
}

const fingerprint = (value: unknown): string =>
  `sha256:${createHash("sha256").update(canonicalJson(value)).digest("hex")}`;

export const summarizeOrderTotals = (
  lines: readonly SalesLineSnapshot[],
  currency: CurrencyCode,
  adjustmentCents = 0,
): OrderReadModel["totals"] => {
  let calculatedCents = 0;
  let sellingCents = 0;
  for (const line of lines) {
    if (line.calculatedLineAmount.currency !== currency || line.sellingLineAmount.currency !== currency)
      throw new V2ApplicationError("INTERNAL_ERROR", "Order lines do not share the Order currency.");
    calculatedCents += line.calculatedLineAmount.cents;
    sellingCents += line.sellingLineAmount.cents;
    if (!Number.isSafeInteger(calculatedCents) || !Number.isSafeInteger(sellingCents))
      throw new V2ApplicationError("INTERNAL_ERROR", "Order totals are outside the safe money range.");
  }
  if (!Number.isSafeInteger(adjustmentCents) || !Number.isSafeInteger(sellingCents + adjustmentCents) || sellingCents + adjustmentCents < 0)
    throw new Error("Order selling adjustment is outside the supported money range.");
  return { calculated: money(currency, calculatedCents), selling: money(currency, sellingCents + adjustmentCents) };
};

const attribution = (context: OperationContext): AttributionSnapshot =>
  context.principal.kind === "delegated_ai"
    ? {
        principalKind: "delegated_ai",
        subjectId: principalSubject(context.principal),
        staffActorUserId: staffActorId(context.principal)!,
      }
    : { principalKind: context.principal.kind, subjectId: principalSubject(context.principal) };

const requireAllowed = (
  policy: AuthorityPolicy,
  context: OperationContext,
  capability: "order.view" | "order.create" | "order.edit" | "order.cancel" | "order.overridePrice",
  customerId?: string,
): void => {
  const decision = policy.decide(context.principal, {
    capability,
    resource: { organizationId: context.organizationId, customerId },
  });
  if (!decision.allowed)
    throw new V2ApplicationError("FORBIDDEN", "The principal does not have authority for this Order operation.");
};

const validateReference = async (
  organizationId: string,
  customers: CustomersReadPort,
  reference: CustomerContactReference,
): Promise<void> => {
  if (reference.organizationId !== organizationId || !(await customers.validateContactReference(reference)))
    throw new V2ApplicationError("NOT_FOUND", "Customer or contact is unavailable in this organization.");
};

const validateFulfillment = (value: RequestedFulfillment | undefined): RequestedFulfillment | undefined => {
  if (!value) return undefined;
  if (value.method !== "pickup" && value.method !== "shipping" && value.method !== "local_delivery")
    throw new V2ApplicationError("VALIDATION_ERROR", "Requested fulfillment method is invalid.");
  const instructions = value.instructions?.trim() || undefined;
  if ((value.method === "shipping" || value.method === "local_delivery") && !value.destination)
    throw new V2ApplicationError("VALIDATION_ERROR", "Shipping or local delivery requires an Order destination snapshot.");
  if (value.method === "pickup" && value.destination)
    throw new V2ApplicationError("VALIDATION_ERROR", "Pickup does not use a shipping destination.");
  if (!value.destination) return { method: value.method, ...(instructions ? { instructions } : {}) };
  const destination = value.destination;
  if (!destination.addressLine1?.trim() || !destination.city?.trim())
    throw new V2ApplicationError("VALIDATION_ERROR", "Order destination requires a street address and city.");
  return { method: value.method, destination: { ...destination, addressLine1: destination.addressLine1.trim(), city: destination.city.trim() }, ...(instructions ? { instructions } : {}) };
};

const validateAdjustment = (value: SalesOrderAdjustment | undefined): SalesOrderAdjustment | undefined => {
  if (!value) return undefined;
  if (!Number.isSafeInteger(value.cents) || value.cents === 0 || !value.reason.trim())
    throw new V2ApplicationError("VALIDATION_ERROR", "An Order adjustment needs a non-zero whole-cent amount and reason.");
  return { cents: value.cents, reason: value.reason.trim() };
};
const validateCommercialCharge = (value: CommercialCharge | undefined): CommercialCharge | undefined => {
  if (!value) return undefined;
  if (!Number.isSafeInteger(value.cents) || value.cents < 0)
    throw new V2ApplicationError("VALIDATION_ERROR", "A commercial charge must be a non-negative whole-cent amount.");
  return { ...value, ...(value.description?.trim() ? { description: value.description.trim() } : {}) };
};

const calculatedDecision = (
  pricing: SalesLineSnapshot["pricingResult"],
  context: OperationContext,
  instruction?: OrderSellingInstruction,
): SellingPriceDecision => {
  const quantity = pricing.normalizedInput.quantity;
  const cents = (value: number, name: string): number => {
    if (!Number.isSafeInteger(value) || value < 0)
      throw new V2ApplicationError("VALIDATION_ERROR", `${name} must be a non-negative integer-cent amount.`);
    return value;
  };
  const base = {
    pricingResultId: pricing.id,
    calculatedUnitAmount: pricing.calculatedUnitAmount,
    calculatedLineAmount: pricing.calculatedLineAmount,
    decidedAt: new Date().toISOString(),
    authorityReference: attribution(context),
  };
  if (!instruction || instruction.kind === "calculated")
    return { ...base, kind: "calculated", resultingUnitAmount: pricing.calculatedUnitAmount, resultingLineAmount: pricing.calculatedLineAmount };
  if (!instruction.reason.trim())
    throw new V2ApplicationError("VALIDATION_ERROR", "A selling-price override reason is required.");
  const total = instruction.kind === "unit_override"
    ? cents(instruction.unitCents, "Unit override") * quantity
    : cents(instruction.totalCents, "Total override");
  if (!Number.isSafeInteger(total)) throw new V2ApplicationError("VALIDATION_ERROR", "Selling price is outside safe money range.");
  const resultingLineAmount = money(pricing.currency, total);
  const resultingUnitAmount = instruction.kind === "unit_override"
    ? money(pricing.currency, instruction.unitCents)
    : money(pricing.currency, Math.round(total / quantity));
  return instruction.kind === "unit_override"
    ? { ...base, kind: "unit_override", reason: instruction.reason, resultingUnitAmount, resultingLineAmount }
    : { ...base, kind: "total_override", reason: instruction.reason, resultingUnitAmount, resultingLineAmount };
};

const asDraftFailure = (
  result: Extract<DraftInvoiceSynchronizationResult, { status: "not_editable" }>,
): never => {
  throw new V2ApplicationError(
    "CONFLICT",
    result.reason === "multiple_active_invoices"
      ? "The Order has multiple active Draft Invoices."
      : result.reason === "invoice_missing"
        ? "The Order Draft Invoice is missing."
        : "The Draft Invoice cannot be synchronized.",
  );
};

/**
 * The M1.9 Sales application boundary. It owns Order commercial facts and
 * only orchestrates Billing and Routing through their typed ports. It never
 * writes Invoice or Routing persistence directly.
 */
export class OrderApplicationService {
  constructor(
    private readonly runner: OrderTransactionRunner,
    private readonly authority = new AuthorityPolicy(),
    private readonly automaticLifecycle?: OrderAutomaticLifecycle,
  ) {}

  async create(
    context: OperationContext,
    input: CreateOrderInput,
  ): Promise<ApplicationResult<OrderOperationResult>> {
    return this.mutate(context, "sales.order.create.v1", input, "order.create", async (tx, request) => {
      await validateReference(context.organizationId, tx.customers, input.customerContact);
      requireAllowed(this.authority, context, "order.create", input.customerContact.customerId);
      const clientLineKeys = new Set<string>();
      for (const line of input.lines) {
        if (line.clientLineKey === undefined) continue;
        if (!/^[A-Za-z0-9_-]{1,120}$/u.test(line.clientLineKey))
          throw new V2ApplicationError("VALIDATION_ERROR", "Order line correlation is invalid.");
        if (clientLineKeys.has(line.clientLineKey))
          throw new V2ApplicationError("VALIDATION_ERROR", "Order line correlations must be unique.");
        clientLineKeys.add(line.clientLineKey);
      }
      const lines = await this.buildLines(tx, context, input.lines);
      if (!lines.length)
        throw new V2ApplicationError("VALIDATION_ERROR", "An Order requires at least one commercial line.");

      const created = await this.createFromCommercialSnapshot(tx, context, request.id, {
        customerContact: input.customerContact,
        purchaseOrderNumber: input.purchaseOrderNumber,
        requestedDueDate: input.requestedDueDate,
        terms: input.terms ?? {},
        requestedFulfillment: validateFulfillment(input.requestedFulfillment),
        sellingAdjustment: validateAdjustment(input.sellingAdjustment),
        commercialCharge: validateCommercialCharge(input.commercialCharge),
        lines,
      }, "sales.order.create.v1");
      const lineCorrelations = input.lines.flatMap((line, index) => {
        if (line.clientLineKey === undefined) return [];
        const createdLine = lines[index];
        if (!createdLine) throw new Error("Created Order line correlation is unavailable.");
        return [{ clientLineKey: line.clientLineKey, orderLineId: createdLine.lineId }];
      });
      return lineCorrelations.length ? { ...created, lineCorrelations } : created;
    });
  }

  /** A repeat Order keeps commercial decisions but starts a wholly new job. */
  async duplicate(
    context: OperationContext,
    input: DuplicateOrderCommand,
  ): Promise<ApplicationResult<OrderOperationResult>> {
    return this.mutate(context, "sales.order.duplicate.v1", input, "order.create", async (tx, request) => {
      const source = await tx.read(brandedId<"OrganizationId">(context.organizationId), input.orderId, true);
      if (!source) throw new V2ApplicationError("NOT_FOUND", "Order was not found.");
      requireAllowed(this.authority, context, "order.view", source.order.customerContact.customerId);
      requireAllowed(this.authority, context, "order.create", source.order.customerContact.customerId);
      if (source.order.lines.some((line) => line.sellingPriceDecision.kind !== "calculated"))
        requireAllowed(this.authority, context, "order.overridePrice", source.order.customerContact.customerId);
      const lines = source.order.lines.map((line) => Object.freeze({ ...line, lineId: brandedId<"SalesLineId">(randomUUID()) }));
      const created = await this.createFromCommercialSnapshot(tx, context, request.id, {
        customerContact: source.order.customerContact,
        // New Orders deliberately require an intentional PO and due-date.
        terms: source.order.terms,
        requestedFulfillment: source.order.requestedFulfillment,
        sellingAdjustment: source.order.sellingAdjustment,
        commercialCharge: source.order.commercialCharge,
        lines,
      }, "sales.order.duplicate.v1");
      // The new Order already has its one creation audit row for this request.
      // Record the duplication relationship against the source Order instead
      // of attempting a second request/resource audit row for the new Order.
      await this.history(tx, context, request.id, "sales.order.duplicate.v1", {
        eventType: "order_duplicated",
        resourceId: input.orderId,
        changes: [{ group: "line", kind: "line_added", summary: `New Order ${created.order.number.display} duplicated from ${source.number.display}.` }],
      });
      return created;
    });
  }

  /**
   * Canonical Order creation choreography shared by direct entry and Quote
   * conversion.  It intentionally performs no M0 reservation/attribution:
   * the enclosing operation owns those facts.  In particular it never calls
   * Pricing, so a conversion can persist accepted commercial evidence intact.
   */
  async createFromCommercialSnapshot(
    tx: OrderTransaction,
    context: OperationContext,
    operationRequestId: string,
    source: FrozenOrderCommercialSource,
    auditOperation: string,
    trace?: QuoteConversionTrace,
  ): Promise<OrderOperationResult> {
    let stage = "order_reference_validation";
    try {
      trace?.event(stage, "started");
      await validateReference(context.organizationId, tx.customers, source.customerContact);
      trace?.event(stage, "ok");
      if (!source.lines.length)
        throw new V2ApplicationError("VALIDATION_ERROR", "An Order requires at least one commercial line.");
      for (const line of source.lines) assertSalesLineSnapshot(line);
      const currency = source.lines[0]!.pricingResult.currency;
      if (source.lines.some((line) => line.pricingResult.currency !== currency))
        throw new V2ApplicationError("VALIDATION_ERROR", "Order lines must share one currency.");
      // Pricing/configuration are frozen above. Products/Routing validates the
      // exact priced Product Version before any Order, Invoice, or Route work
      // is written. It never invents a route for compatibility Products.
      stage = "routing_resolution";
      trace?.event(stage, "started");
      const lines = await Promise.all(source.lines.map(async (line) => {
        const routability = await tx.products.resolveOrderRoutability(
          brandedId<"OrganizationId">(context.organizationId), line.productId,
          line.resolvedConfiguration.pricingConfigurationId,
        );
        if (routability.kind === "unroutable")
          throw new V2ApplicationError("CONFLICT", `${routability.productName} is not fully configured for production routing.`);
        return Object.freeze({ ...line, ...(routability.productTypeId ? { productTypeId: routability.productTypeId } : {}) });
      }));
      trace?.event(stage, "ok");
      const orderId = brandedId<"OrderId">(randomUUID());
      stage = "number_allocation";
      trace?.event(stage, "started");
      const number = await tx.allocateNumber(context.organizationId);
      trace?.event(stage, "ok");
      stage = "order_persistence";
      await tx.create({ orderId, organizationId: brandedId<"OrganizationId">(context.organizationId), number,
        customerContact: source.customerContact, purchaseOrderNumber: source.purchaseOrderNumber,
        requestedDueDate: source.requestedDueDate, terms: source.terms, lines, requestedFulfillment: source.requestedFulfillment, sellingAdjustment: source.sellingAdjustment, commercialCharge: source.commercialCharge, taxComposition: source.taxComposition }, trace);
      // The source checkpoint has immutable Product Version/configuration facts.
      // Freeze expected material requirements in this same conversion transaction
      // before Billing or Routing can observe a partially-created Order.
      stage = "material_freeze";
      trace?.event("material_requirements", "started");
      await tx.materialRequirements.freeze(context.organizationId, orderId, lines);
      trace?.event("material_requirements", "ok");
      stage = "draft_invoice";
      trace?.event(stage, "started");
      const draft = await tx.billing.createDraftInvoice(this.draftInput(
        context.organizationId, orderId, operationRequestId, source.customerContact,
        source.purchaseOrderNumber, source.terms, lines, source.sellingAdjustment, source.commercialCharge, "1",
      ));
      if (draft.status !== "created") {
        if (draft.status === "not_editable") asDraftFailure(draft);
        throw new V2ApplicationError("CONFLICT", "The Order already has a Draft Invoice projection.");
      }
      trace?.event(stage, "ok");
      stage = "route_instantiation";
      trace?.event(stage, "started");
      const routeInstances = await this.instantiateRoutes(tx, context, orderId, lines);
      trace?.event(stage, "ok");
      stage = "order_read";
      trace?.event("order_reread", "started");
      const order = await tx.read(brandedId<"OrganizationId">(context.organizationId), orderId);
      if (!order) throw new Error("Created Order could not be read.");
      trace?.event("order_reread", "ok");
      stage = "audit";
      trace?.event(stage, "started");
      await this.history(tx, context, operationRequestId, auditOperation, {
        eventType: "order_created", resourceId: orderId,
        changes: [{ group: "line", kind: "line_added", summary: `Order created with ${source.lines.length} line(s).` }],
      });
      trace?.event(stage, "ok");
      return { order, draftInvoiceId: draft.invoiceId, routeInstances };
    } catch (cause) {
      trace?.failure(stage, cause);
      throw cause;
    }
  }

  async read(
    context: OperationContext,
    orderId: OrderId,
  ): Promise<ApplicationResult<OrderReadModel>> {
    try {
      requireOperationPrincipalScope(context);
      const result = await this.runner.transaction(async (tx) => {
        const order = await tx.read(brandedId<"OrganizationId">(context.organizationId), orderId);
        if (!order) throw new V2ApplicationError("NOT_FOUND", "Order was not found.");
        requireAllowed(this.authority, context, "order.view", order.order.customerContact.customerId);
        return order;
      });
      return success(result);
    } catch (error) {
      return failure(this.error(error));
    }
  }

  /** Commercial edits keep frozen route identity stable; routed lines cannot be removed or retargeted. */
  async update(
    context: OperationContext,
    input: UpdateOrderInput,
  ): Promise<ApplicationResult<OrderOperationResult>> {
    const result = await this.mutate(context, "sales.order.edit.v1", input, "order.edit", async (tx, request) => {
      const current = await tx.read(brandedId<"OrganizationId">(context.organizationId), input.orderId, true);
      if (!current) throw new V2ApplicationError("NOT_FOUND", "Order was not found.");
      requireAllowed(this.authority, context, "order.edit", current.order.customerContact.customerId);
      if (current.order.commercialState === "cancelled")
        throw new V2ApplicationError("CONFLICT", "A cancelled Order cannot be edited.");
      if (current.revision !== input.expectedRevision)
        throw new V2ApplicationError("STALE_STATE", "Order has changed; reload before editing.");
      const wasCompleted = current.order.commercialState === "completed";

      const patch = input.patch;
      const customerContact = patch.customerContact ?? current.order.customerContact;
      await validateReference(context.organizationId, tx.customers, customerContact);
      requireAllowed(this.authority, context, "order.edit", customerContact.customerId);
      const purchaseOrderNumber = patch.purchaseOrderNumber === null ? undefined : (patch.purchaseOrderNumber ?? current.order.purchaseOrderNumber);
      const requestedDueDate = patch.requestedDueDate === null ? undefined : (patch.requestedDueDate ?? current.order.requestedDueDate);
      const terms = patch.terms ?? current.order.terms;
      const requestedFulfillment = patch.requestedFulfillment === null ? undefined : validateFulfillment(patch.requestedFulfillment ?? current.order.requestedFulfillment);
      const sellingAdjustment = patch.sellingAdjustment === null ? undefined : validateAdjustment(patch.sellingAdjustment ?? current.order.sellingAdjustment);
      const commercialCharge = patch.commercialCharge === null ? undefined : validateCommercialCharge(patch.commercialCharge ?? current.order.commercialCharge);
      const lines = await this.applyLineChanges(tx, context, current, input.lineChanges ?? []);
      const unchanged = customerContact.customerId === current.order.customerContact.customerId
        && customerContact.contactId === current.order.customerContact.contactId
        && purchaseOrderNumber === current.order.purchaseOrderNumber
        && requestedDueDate === current.order.requestedDueDate
        && terms.termsCode === current.order.terms.termsCode
        && terms.taxContextReference === current.order.terms.taxContextReference
        && terms.salesRepresentativeId === current.order.terms.salesRepresentativeId
        && terms.commercialNotes === current.order.terms.commercialNotes
        && canonicalJson(requestedFulfillment ?? {}) === canonicalJson(current.order.requestedFulfillment ?? {})
        && canonicalJson(sellingAdjustment ?? {}) === canonicalJson(current.order.sellingAdjustment ?? {})
        && canonicalJson(commercialCharge ?? {}) === canonicalJson(current.order.commercialCharge ?? {})
        && canonicalJson(lines) === canonicalJson(current.order.lines);
      if (unchanged) {
        const invoiceId = current.order.billingInvoiceReference;
        if (!invoiceId) throw new V2ApplicationError("CONFLICT", "The Order Draft Invoice is missing.");
        return { order: current, draftInvoiceId: invoiceId, routeInstances: [] };
      }
      if (wasCompleted && !await tx.reopen(brandedId<"OrganizationId">(context.organizationId), input.orderId))
        throw new V2ApplicationError("STALE_STATE", "Order lifecycle changed; reload before editing.");

      const applied = await tx.update({
        organizationId: brandedId<"OrganizationId">(context.organizationId),
        orderId: input.orderId,
        expectedRevision: Number(current.revision),
        customerContact,
        purchaseOrderNumber,
        requestedDueDate,
        terms,
        lines,
        requestedFulfillment,
        sellingAdjustment,
        commercialCharge,
      });
      if (!applied) throw new V2ApplicationError("STALE_STATE", "Order has changed; reload before editing.");
      const added = lines.filter((line) => !current.order.lines.some((prior) => prior.lineId === line.lineId));
      if (added.length)
        await tx.materialRequirements.freeze(context.organizationId, input.orderId, added);
      const draft = await tx.billing.synchronizeDraftInvoice(this.draftInput(
        context.organizationId,
        input.orderId,
        request.id,
        customerContact,
        purchaseOrderNumber,
        terms,
        lines,
        sellingAdjustment,
        commercialCharge,
        String(Number(current.revision) + 1),
      ));
      // Until an explicit Billing correction operation exists, an issued or
      // void Invoice is an atomic commercial boundary: do not let Sales
      // commit a header that its Billing Draft cannot truthfully project.
      if (draft.status === "not_editable") {
        asDraftFailure(draft);
      }
      if (!("invoiceId" in draft)) {
        throw new V2ApplicationError("CONFLICT", "The Order Draft Invoice is missing.");
      }
      await tx.removeLinesNotIn(brandedId<"OrganizationId">(context.organizationId), input.orderId, lines.map((line) => line.lineId));
      const routeInstances = await this.instantiateRoutes(tx, context, input.orderId, added);
      const order = await tx.read(brandedId<"OrganizationId">(context.organizationId), input.orderId);
      if (!order) throw new Error("Updated Order could not be read.");
      const lifecycleChanges: readonly MeaningfulAuditChange[] = wasCompleted ? [{ group: "lifecycle", kind: "order_auto_reopened", summary: "Order reopened because its current commercial facts are being revised." }] : [];
      const changes = [...lifecycleChanges, ...this.headerChanges(current.order, order.order), ...this.lineChanges(current.order.lines, order.order.lines)];
      await this.history(tx, context, request.id, "sales.order.edit.v1", {
        eventType: "order_updated", resourceId: input.orderId, changes,
      });
      return { order, draftInvoiceId: draft.invoiceId, routeInstances };
    });
    if (result.ok) await this.automaticLifecycle?.reconcileOrder(brandedId<"OrganizationId">(context.organizationId), input.orderId);
    return result;
  }

  /**
   * Sales owns the commercial cancellation fact only.  It deliberately does
   * not void an Invoice, delete a route, or amend Production/Fulfillment
   * history.  Those owners expose their own correction workflows.
   */
  async cancel(
    context: OperationContext,
    input: CancelOrderCommand,
  ): Promise<ApplicationResult<OrderOperationResult>> {
    return this.mutate(context, "sales.order.cancel.v1", input, "order.cancel", async (tx, request) => {
      const current = await tx.read(brandedId<"OrganizationId">(context.organizationId), input.orderId, true);
      if (!current) throw new V2ApplicationError("NOT_FOUND", "Order was not found.");
      requireAllowed(this.authority, context, "order.cancel", current.order.customerContact.customerId);
      const reason = input.reason.trim();
      if (!reason) throw new V2ApplicationError("VALIDATION_ERROR", "A cancellation reason is required.");
      if (current.order.commercialState === "cancelled")
        throw new V2ApplicationError("CONFLICT", "This Order is already cancelled.");
      if (current.order.commercialState === "completed")
        throw new V2ApplicationError("CONFLICT", "A completed Order cannot be cancelled.");
      if (current.revision !== input.expectedStateToken)
        throw new V2ApplicationError("STALE_STATE", "Order has changed; reload before cancelling.");
      const blockers = await tx.cancellationBlockers(brandedId<"OrganizationId">(context.organizationId), input.orderId);
      if (blockers.length)
        throw new V2ApplicationError("CONFLICT", `Order cannot be cancelled while ${blockers.join(", ")}.`);
      if (!await tx.cancel({ organizationId: brandedId<"OrganizationId">(context.organizationId), orderId: input.orderId, expectedRevision: Number(current.revision), reason }))
        throw new V2ApplicationError("STALE_STATE", "Order has changed; reload before cancelling.");
      const order = await tx.read(brandedId<"OrganizationId">(context.organizationId), input.orderId);
      if (!order) throw new Error("Cancelled Order could not be read.");
      await this.history(tx, context, request.id, "sales.order.cancel.v1", {
        eventType: "order_cancelled", resourceId: input.orderId,
        changes: [{ group: "lifecycle", kind: "order_cancelled", summary: "Order cancelled; downstream records were preserved." }],
      });
      const invoiceId = order.order.billingInvoiceReference;
      if (!invoiceId)
        throw new V2ApplicationError("CONFLICT", "The Order Draft Invoice projection is missing; reconcile Billing before cancellation.");
      return { order, draftInvoiceId: invoiceId, routeInstances: [] };
    });
  }

  async complete(
    context: OperationContext,
    input: CompleteOrderCommand,
  ): Promise<ApplicationResult<OrderOperationResult>> {
    return this.mutate(context, "sales.order.complete.v1", input, "order.edit", async (tx, request) => {
      const current = await tx.read(brandedId<"OrganizationId">(context.organizationId), input.orderId, true);
      if (!current) throw new V2ApplicationError("NOT_FOUND", "Order was not found.");
      requireAllowed(this.authority, context, "order.edit", current.order.customerContact.customerId);
      if (current.order.commercialState === "completed")
        throw new V2ApplicationError("CONFLICT", "This Order is already completed.");
      if (current.order.commercialState === "cancelled")
        throw new V2ApplicationError("CONFLICT", "A cancelled Order cannot be completed.");
      if (current.revision !== input.expectedStateToken)
        throw new V2ApplicationError("STALE_STATE", "Order has changed; reload before completing it.");
      const eligibility = await tx.completionEligibility(brandedId<"OrganizationId">(context.organizationId), input.orderId);
      if (!eligibility.eligible)
        throw new V2ApplicationError("CONFLICT", eligibility.blockers.map((blocker) => blocker.reason).join(" "));
      const actor = attribution(context);
      if (!await tx.complete({
        organizationId: brandedId<"OrganizationId">(context.organizationId), orderId: input.orderId,
        expectedRevision: Number(current.revision), principalKind: actor.principalKind,
        principalSubject: actor.subjectId, ...(actor.staffActorUserId ? { staffActorUserId: actor.staffActorUserId } : {}),
      })) throw new V2ApplicationError("STALE_STATE", "Order has changed; reload before completing it.");
      const order = await tx.read(brandedId<"OrganizationId">(context.organizationId), input.orderId);
      if (!order) throw new Error("Completed Order could not be read.");
      await this.history(tx, context, request.id, "sales.order.complete.v1", {
        eventType: "order_completed", resourceId: input.orderId,
        changes: [{ group: "lifecycle", kind: "order_completed", summary: "Order operational work marked complete; financial facts were unchanged." }],
      });
      return this.existingResult(order);
    });
  }

  async archive(
    context: OperationContext,
    input: ArchiveOrderCommand,
  ): Promise<ApplicationResult<OrderOperationResult>> {
    return this.mutate(context, "sales.order.archive.v1", input, "order.edit", async (tx, request) => {
      const current = await tx.read(brandedId<"OrganizationId">(context.organizationId), input.orderId, true);
      if (!current) throw new V2ApplicationError("NOT_FOUND", "Order was not found.");
      requireAllowed(this.authority, context, "order.edit", current.order.customerContact.customerId);
      if (current.order.archivedAt) throw new V2ApplicationError("CONFLICT", "This Order is already archived.");
      if (current.order.commercialState === "open") throw new V2ApplicationError("CONFLICT", "An open Order cannot be archived. Complete or cancel it first.");
      if (current.revision !== input.expectedStateToken) throw new V2ApplicationError("STALE_STATE", "Order has changed; reload before archiving it.");
      const actor = attribution(context);
      if (!await tx.archive({ organizationId: brandedId<"OrganizationId">(context.organizationId), orderId: input.orderId,
        expectedRevision: Number(current.revision), principalKind: actor.principalKind, principalSubject: actor.subjectId,
        ...(actor.staffActorUserId ? { staffActorUserId: actor.staffActorUserId } : {}) }))
        throw new V2ApplicationError("STALE_STATE", "Order has changed; reload before archiving it.");
      const order = await tx.read(brandedId<"OrganizationId">(context.organizationId), input.orderId);
      if (!order) throw new Error("Archived Order could not be read.");
      await this.history(tx, context, request.id, "sales.order.archive.v1", { eventType: "order_archived", resourceId: input.orderId,
        changes: [{ group: "lifecycle", kind: "order_archived", summary: "Terminal Order archived; operational and financial history were preserved." }] });
      return this.existingResult(order);
    });
  }

  async unarchive(
    context: OperationContext,
    input: ArchiveOrderCommand,
  ): Promise<ApplicationResult<OrderOperationResult>> {
    return this.mutate(context, "sales.order.unarchive.v1", input, "order.edit", async (tx, request) => {
      const current = await tx.read(brandedId<"OrganizationId">(context.organizationId), input.orderId, true);
      if (!current) throw new V2ApplicationError("NOT_FOUND", "Order was not found.");
      requireAllowed(this.authority, context, "order.edit", current.order.customerContact.customerId);
      if (!current.order.archivedAt) throw new V2ApplicationError("CONFLICT", "This Order is not archived.");
      if (current.revision !== input.expectedStateToken) throw new V2ApplicationError("STALE_STATE", "Order has changed; reload before restoring it.");
      if (!await tx.unarchive({ organizationId: brandedId<"OrganizationId">(context.organizationId), orderId: input.orderId, expectedRevision: Number(current.revision) }))
        throw new V2ApplicationError("STALE_STATE", "Order has changed; reload before restoring it.");
      const order = await tx.read(brandedId<"OrganizationId">(context.organizationId), input.orderId);
      if (!order) throw new Error("Restored Order could not be read.");
      await this.history(tx, context, request.id, "sales.order.unarchive.v1", { eventType: "order_unarchived", resourceId: input.orderId,
        changes: [{ group: "lifecycle", kind: "order_unarchived", summary: "Order restored to terminal history visibility; operational state was unchanged." }] });
      return this.existingResult(order);
    });
  }

  private existingResult(order: OrderReadModel): OrderOperationResult {
    const invoiceId = order.order.billingInvoiceReference;
    return { order, ...(invoiceId ? { draftInvoiceId: invoiceId } : {}), routeInstances: [] };
  }

  private async buildLines(
    tx: OrderTransaction,
    context: OperationContext,
    inputs: readonly OrderLineInput[],
    existing: readonly SalesLineSnapshot[] = [],
  ): Promise<SalesLineSnapshot[]> {
    const lines: SalesLineSnapshot[] = [];
    for (const [index, input] of inputs.entries()) {
      if (!Number.isSafeInteger(input.quantity) || input.quantity <= 0)
        throw new V2ApplicationError("VALIDATION_ERROR", "Line quantity must be a positive integer.");
      if (input.selling && input.selling.kind !== "calculated")
        requireAllowed(this.authority, context, "order.overridePrice");
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
          channel: context.principal.kind === "staff" ? "staff" : context.principal.kind === "portal" ? "portal" : context.principal.kind === "service" ? "service" : "ai",
          effectiveAt: new Date().toISOString(),
        },
        rules: resolved.value.rules,
        ...(resolved.value.nestingEstimate ? { nestingEstimate: resolved.value.nestingEstimate } : {}),
      });
      const prior = existing[index];
      const inherited = !input.selling && prior && prior.sellingPriceDecision.kind !== "calculated"
        ? this.sellingInstruction(prior.sellingPriceDecision)
        : input.selling;
      if (inherited && inherited.kind !== "calculated") requireAllowed(this.authority, context, "order.overridePrice");
      const freshDecision = calculatedDecision(pricing, context, inherited);
      const decision = !input.selling && prior && prior.sellingPriceDecision.kind !== "calculated"
        ? { ...freshDecision, decidedAt: prior.sellingPriceDecision.decidedAt, authorityReference: prior.sellingPriceDecision.authorityReference }
        : freshDecision;
      const line: SalesLineSnapshot = {
        lineId: prior?.lineId ?? brandedId<"SalesLineId">(randomUUID()),
        productId: resolved.value.sellableProduct.productId,
        ...(resolved.value.sellableProduct.productTypeId ? { productTypeId: resolved.value.sellableProduct.productTypeId } : {}),
        description: input.description?.trim() || resolved.value.sellableProduct.displayName,
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
    tx: OrderTransaction,
    context: OperationContext,
    current: OrderReadModel,
    changes: NonNullable<UpdateOrderInput["lineChanges"]>,
  ): Promise<SalesLineSnapshot[]> {
    const lines = [...current.order.lines];
    for (const change of changes) {
      if (change.kind === "reorder") {
        if (change.lineIds.length !== lines.length || new Set(change.lineIds).size !== lines.length || change.lineIds.some((id) => !lines.some((line) => line.lineId === id)))
          throw new V2ApplicationError("VALIDATION_ERROR", "Order line order must include every line exactly once.");
        lines.splice(0, lines.length, ...change.lineIds.map((id) => lines.find((line) => line.lineId === id)!));
        continue;
      }
      if (change.kind === "duplicate") {
        const index = lines.findIndex((line) => line.lineId === change.sourceLineId);
        if (index < 0) throw new V2ApplicationError("NOT_FOUND", "Order line was not found in this Order.");
        const source = lines[index]!;
        if (source.sellingPriceDecision.kind !== "calculated") requireAllowed(this.authority, context, "order.overridePrice");
        lines.splice(index + 1, 0, Object.freeze({ ...source, lineId: brandedId<"SalesLineId">(randomUUID()) }));
        continue;
      }
      if (change.kind === "add") {
        lines.push((await this.buildLines(tx, context, [change.line]))[0]!);
        continue;
      }
      const index = lines.findIndex((line) => line.lineId === change.lineId);
      if (index < 0) throw new V2ApplicationError("NOT_FOUND", "Order line was not found in this Order.");
      const prior = lines[index]!;
      const routed = await tx.hasRoute(current.order.organizationId, current.order.orderId, prior.lineId);
      const materialFrozen = await tx.materialRequirements.hasFrozen(current.order.organizationId, prior.lineId);
      if (change.kind === "remove") {
        if (materialFrozen) throw new V2ApplicationError("CONFLICT", "A line with frozen material requirements cannot be removed.");
        if (routed) throw new V2ApplicationError("CONFLICT", "A routed Order line cannot be removed without an explicit Routing operation.");
        lines.splice(index, 1);
        continue;
      }
      if (change.kind === "update_description") {
        const description = change.description.trim();
        if (!description) throw new V2ApplicationError("VALIDATION_ERROR", "Order line description is required.");
        // This is intentionally permitted after material freeze: it preserves
        // the Product identity, configuration, quantities, and all pricing
        // evidence. Billing synchronization below remains the financial lock.
        lines[index] = { ...prior, description };
        continue;
      }
      const intended: OrderLineInput = {
        ...change.line,
        description: change.line.description ?? prior.description,
        selections: change.line.selections ?? prior.resolvedConfiguration.selections,
        dimensions: change.line.dimensions ?? prior.resolvedConfiguration.dimensions,
      };
      const replacement = (await this.buildLines(tx, context, [intended], [prior]))[0]!;
      if (materialFrozen && canonicalJson(replacement) !== canonicalJson(prior))
        throw new V2ApplicationError("CONFLICT", "A line with frozen material requirements cannot be changed.");
      if (replacement.productId !== prior.productId)
        throw new V2ApplicationError("CONFLICT", "An existing Order line cannot be retargeted to another Product; remove/add or use a future Routing operation.");
      if (replacement.productTypeId !== prior.productTypeId)
        throw new V2ApplicationError("CONFLICT", "Changing an existing line's Product Type requires an explicit Routing operation.");
      const explicitConfiguration = change.line.selections !== undefined || change.line.dimensions !== undefined;
      if (!explicitConfiguration) {
        const before = prior.resolvedConfiguration, after = replacement.resolvedConfiguration;
        const stable = before.pricingConfigurationId === after.pricingConfigurationId
          && before.pricingConfigurationVersion === after.pricingConfigurationVersion
          && before.pricingConfigurationContentHash === after.pricingConfigurationContentHash
          && canonicalJson(before.selections) === canonicalJson(after.selections)
          && canonicalJson(before.dimensions ?? null) === canonicalJson(after.dimensions ?? null);
        if (!stable) throw new V2ApplicationError("CONFLICT", "The Product definition changed; explicitly review and adopt the current configuration before repricing.");
      }
      lines[index] = replacement;
    }
    if (!lines.length) throw new V2ApplicationError("VALIDATION_ERROR", "An Order requires at least one commercial line.");
    return lines;
  }

  private sellingInstruction(decision: SellingPriceDecision): OrderSellingInstruction {
    if (decision.kind === "unit_override") return { kind: "unit_override", unitCents: decision.resultingUnitAmount.cents, reason: decision.reason };
    if (decision.kind === "total_override") return { kind: "total_override", totalCents: decision.resultingLineAmount.cents, reason: decision.reason };
    return { kind: "calculated" };
  }

  private lineChanges(before: readonly SalesLineSnapshot[], after: readonly SalesLineSnapshot[]): MeaningfulAuditChange[] {
    const changes: MeaningfulAuditChange[] = [];
    for (const line of after) {
      const prior = before.find((candidate) => candidate.lineId === line.lineId);
      if (!prior) changes.push({ group: "line", kind: "line_added", resourceId: line.lineId, summary: "Order line added." });
      else {
        if (prior.quantity !== line.quantity) changes.push({ group: "line", kind: "quantity_changed", resourceId: line.lineId, summary: "Order line quantity changed." });
        if (prior.description !== line.description) changes.push({ group: "line", kind: "description_changed", resourceId: line.lineId, summary: "Order line description updated." });
        if (canonicalJson(prior.resolvedConfiguration) !== canonicalJson(line.resolvedConfiguration)) changes.push({ group: "line", kind: "configuration_changed", resourceId: line.lineId, summary: "Order line configuration changed." });
        if (canonicalJson(prior.sellingPriceDecision) !== canonicalJson(line.sellingPriceDecision)) changes.push({ group: "price", kind: "selling_price_changed", resourceId: line.lineId, summary: "Order line selling price changed." });
      }
    }
    for (const line of before) if (!after.some((candidate) => candidate.lineId === line.lineId))
      changes.push({ group: "line", kind: "line_removed", resourceId: line.lineId, summary: "Order line removed." });
    return changes;
  }

  private async instantiateRoutes(
    tx: OrderTransaction,
    context: OperationContext,
    orderId: OrderId,
    lines: readonly SalesLineSnapshot[],
  ): Promise<InstantiateRouteResult["routeInstance"][]> {
    const routes: InstantiateRouteResult["routeInstance"][] = [];
    for (const line of lines) {
      const routability = await tx.products.resolveOrderRoutability(
        brandedId<"OrganizationId">(context.organizationId), line.productId, line.resolvedConfiguration.pricingConfigurationId,
      );
      if (routability.kind === "unroutable")
        throw new V2ApplicationError("CONFLICT", `${routability.productName} is not fully configured for production routing.`);
      const policy = routability.routing;
      // Existing versions without a spec use the compatibility reader's
      // explicit Product Type fallback. An explicitly unconfigured/no-route
      // version creates no synthetic route.
      if (policy.kind === "no_route" || policy.kind === "unconfigured") continue;
      const route = await tx.routing.instantiateRoute({
        organizationId: brandedId<"OrganizationId">(context.organizationId),
        work: {
          kind: "sales_order_line",
          organizationId: brandedId<"OrganizationId">(context.organizationId),
          orderId,
          orderLineId: brandedId<"OrderLineId">(line.lineId),
        },
        definition: {
          sourceTemplate: {
            routeTemplateId: brandedId<"RouteTemplateId">(policy.routeTemplateId),
            revision: policy.sourceTemplateRevision ?? "1",
            definitionFingerprint: policy.sourceTemplateFingerprint ?? "legacy-product-type",
          },
          steps: policy.steps,
        },
      });
      routes.push(route.routeInstance);
    }
    return routes;
  }

  private draftInput(
    organizationId: string,
    orderId: OrderId,
    businessRequestId: string,
    customerContact: CustomerContactReference,
    purchaseOrderNumber: string | undefined,
    terms: CommercialTerms,
    lines: readonly SalesLineSnapshot[],
    sellingAdjustment: SalesOrderAdjustment | undefined,
    commercialCharge: CommercialCharge | undefined,
    sourceSalesStateToken: string,
  ): DraftInvoiceSynchronizationInput {
    const currency = lines[0]?.pricingResult.currency;
    if (!currency) throw new V2ApplicationError("VALIDATION_ERROR", "An Order requires at least one commercial line.");
    return {
      organizationId: brandedId<"OrganizationId">(organizationId),
      orderId,
      businessRequestId: brandedId<"BusinessRequestId">(businessRequestId),
      customerContact,
      ...(purchaseOrderNumber ? { purchaseOrderNumber } : {}),
      currency,
      ...(terms.termsCode ? { termsCode: terms.termsCode } : {}),
      salesLines: lines.map((line) => ({
        lineId: line.lineId,
        productId: line.productId,
        description: line.description,
        quantity: line.quantity,
        sellingUnitAmount: line.sellingPriceDecision.resultingUnitAmount,
        sellingLineAmount: line.sellingLineAmount,
        salesPricingEvidenceFingerprint: line.pricingResult.evidenceFingerprint,
      })),
      ...(sellingAdjustment ? { salesAdjustment: sellingAdjustment } : {}),
      ...(commercialCharge ? { salesCommercialCharge: commercialCharge } : {}),
      taxInput: {
        ...(terms.taxContextReference ? { taxContextReference: terms.taxContextReference } : {}),
      },
      sourceSalesStateToken,
    };
  }

  private headerChanges(before: OrderCurrentState, after: OrderCurrentState): MeaningfulAuditChange[] {
    const changes: MeaningfulAuditChange[] = [];
    if (before.customerContact.customerId !== after.customerContact.customerId)
      changes.push({ group: "customer", kind: "customer_changed", summary: "Customer changed." });
    if (before.customerContact.contactId !== after.customerContact.contactId)
      changes.push({ group: "customer", kind: "contact_changed", summary: "Contact changed." });
    if (before.purchaseOrderNumber !== after.purchaseOrderNumber)
      changes.push({ group: "commercial_terms", kind: "po_changed", summary: "PO number updated." });
    if (before.requestedDueDate !== after.requestedDueDate)
      changes.push({ group: "commercial_terms", kind: "requested_due_date_changed", summary: "Requested due date changed." });
    if (before.terms.commercialNotes !== after.terms.commercialNotes)
      changes.push({ group: "notes", kind: "notes_changed", summary: "Commercial notes updated." });
    if (before.terms.termsCode !== after.terms.termsCode
      || before.terms.taxContextReference !== after.terms.taxContextReference
      || before.terms.salesRepresentativeId !== after.terms.salesRepresentativeId)
      changes.push({ group: "commercial_terms", kind: "terms_changed", summary: "Commercial terms updated." });
    if (canonicalJson(before.requestedFulfillment ?? {}) !== canonicalJson(after.requestedFulfillment ?? {}))
      changes.push({ group: "fulfillment", kind: "fulfillment_intent_changed", summary: "Requested fulfillment updated." });
    if (canonicalJson(before.sellingAdjustment ?? {}) !== canonicalJson(after.sellingAdjustment ?? {}))
      changes.push({ group: "price", kind: "order_adjustment_changed", summary: "Order selling adjustment updated." });
    return changes;
  }

  private async mutate(
    context: OperationContext,
    operation: "sales.order.create.v1" | "sales.order.duplicate.v1" | "sales.order.edit.v1" | "sales.order.cancel.v1" | "sales.order.complete.v1" | "sales.order.archive.v1" | "sales.order.unarchive.v1",
    command: CreateOrderInput | DuplicateOrderCommand | UpdateOrderInput | CancelOrderCommand | CompleteOrderCommand | ArchiveOrderCommand,
    capability: "order.create" | "order.edit" | "order.cancel",
    work: (tx: OrderTransaction, request: OrderOperationRequest) => Promise<OrderOperationResult>,
  ): Promise<ApplicationResult<OrderOperationResult>> {
    try {
      requireOperationPrincipalScope(context);
      if (!context.businessRequest)
        throw new V2ApplicationError("VALIDATION_ERROR", "A business request identity is required.");
      if (command.businessRequestId !== context.businessRequest.id)
        throw new V2ApplicationError("VALIDATION_ERROR", "The command business request identity does not match the operation context.");
      return success(await this.runner.transaction(async (tx) => {
        const reservation = await tx.reserve({
          organizationId: context.organizationId,
          operation,
          businessRequestId: context.businessRequest!.id,
          payloadFingerprint: fingerprint(command),
          principalKind: context.principal.kind,
          principalSubject: principalSubject(context.principal),
          ...(staffActorId(context.principal) ? { staffActorUserId: staffActorId(context.principal) } : {}),
        });
        if (reservation.kind === "replay") return reservation.request.resultJson as OrderOperationResult;
        const result = await work(tx, reservation.request);
        await tx.attribute({
          organizationId: context.organizationId,
          requestId: reservation.request.id,
          operation,
          resourceType: "order",
          resourceId: result.order.order.orderId,
          principalKind: context.principal.kind,
          principalSubject: principalSubject(context.principal),
          ...(staffActorId(context.principal) ? { staffActorUserId: staffActorId(context.principal) } : {}),
        });
        await tx.succeed(context.organizationId, reservation.request.id, result);
        return result;
      }));
    } catch (error) {
      return failure(this.error(error));
    }
  }

  private async history(
    tx: OrderTransaction,
    context: OperationContext,
    requestId: string,
    operation: string,
    event: OrderAuditEvent,
  ): Promise<void> {
    await tx.audit({
      organizationId: context.organizationId,
      requestId,
      operation,
      event,
      principalKind: context.principal.kind,
      principalSubject: principalSubject(context.principal),
      ...(staffActorId(context.principal) ? { staffActorUserId: staffActorId(context.principal) } : {}),
    });
  }

  private error(error: unknown): V2ApplicationError {
    return error instanceof V2ApplicationError
      ? error
      : new V2ApplicationError("INTERNAL_ERROR", "Order operation could not be completed.");
  }
}
