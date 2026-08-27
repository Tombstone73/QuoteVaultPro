import type { CustomerContactReference, CustomerPresentationIdentity } from "../customers/contracts.js";
import { assertPricingResultEvidence, type PricingResult, type ResolvedProductConfiguration } from "../pricing/contracts.js";
import type {
  BusinessRequestId, CommercialCheckpointId, ContactId, CurrencyCode, CustomerId, InvoiceId, Money,
  OrderId, OrganizationId, PercentageBasisPoints, PricingResultId, ProductId, ProductTypeId, QuoteCheckpointId, QuoteId,
  SalesLineId,
} from "../shared/commercialValues.js";
import type { PrincipalKind } from "../../authorization/principals.js";
import type { CommercialCharge, SalesTaxComposition } from "./taxComposition.js";

type SellingPriceBase = Readonly<{
  pricingResultId: PricingResultId;
  calculatedUnitAmount: Money;
  calculatedLineAmount: Money;
  resultingUnitAmount: Money;
  resultingLineAmount: Money;
  decidedAt: string;
  authorityReference?: AttributionSnapshot;
}>;
export type SellingPriceDecision =
  | Readonly<SellingPriceBase & { kind: "calculated" }>
  | Readonly<SellingPriceBase & { kind: "unit_override" | "total_override"; reason: string }>
  | Readonly<SellingPriceBase & { kind: "discount"; discountBasisPoints: PercentageBasisPoints; reason: string }>
  | Readonly<SellingPriceBase & { kind: "locked"; reason: string }>;

export type AttributionSnapshot =
  | Readonly<{ principalKind: Exclude<PrincipalKind, "delegated_ai">; subjectId: string; staffActorUserId?: never }>
  | Readonly<{ principalKind: "delegated_ai"; subjectId: string; staffActorUserId: string }>;

export const assertSellingPriceDecision = (decision: SellingPriceDecision, pricingResult: PricingResult): SellingPriceDecision => {
  if (decision.pricingResultId !== pricingResult.id) throw new Error("Selling price must reference its PricingResult.");
  if ([decision.calculatedUnitAmount, decision.calculatedLineAmount, decision.resultingUnitAmount, decision.resultingLineAmount].some((amount) => amount.currency !== pricingResult.currency)) throw new Error("Selling price currency must match PricingResult.");
  if (decision.calculatedUnitAmount.cents !== pricingResult.calculatedUnitAmount.cents || decision.calculatedLineAmount.cents !== pricingResult.calculatedLineAmount.cents) throw new Error("Selling price must retain calculated amounts.");
  if (decision.kind === "calculated" && (decision.resultingUnitAmount.cents !== pricingResult.calculatedUnitAmount.cents || decision.resultingLineAmount.cents !== pricingResult.calculatedLineAmount.cents)) throw new Error("Calculated decision cannot alter calculated price.");
  return decision;
};

export type SalesLineInput = Readonly<{
  productId: ProductId;
  productTypeId?: ProductTypeId;
  description: string;
  quantity: number;
  resolvedConfiguration: ResolvedProductConfiguration;
  pricingResult: PricingResult;
  sellingPriceDecision: SellingPriceDecision;
}>;

export type SalesLineSnapshot = Readonly<SalesLineInput & {
  lineId: SalesLineId;
  calculatedLineAmount: Money;
  sellingLineAmount: Money;
  /** Frozen at commercial-line creation from the current Product. */
  taxability?: Readonly<{ taxable: boolean; source: "product" | "legacy_compatibility" }>;
}>;
export type SalesLineResult = SalesLineSnapshot;

export const assertSalesLineSnapshot = (line: SalesLineSnapshot): SalesLineSnapshot => {
  assertPricingResultEvidence(line.pricingResult);
  const resolved = line.resolvedConfiguration;
  const priced = line.pricingResult.normalizedInput;
  if (line.productId !== resolved.productId || line.quantity !== resolved.quantity || resolved.organizationId !== priced.organizationId || resolved.productId !== priced.productId || resolved.pricingConfigurationId !== priced.pricingConfigurationId || resolved.pricingConfigurationVersion !== priced.pricingConfigurationVersion || resolved.pricingConfigurationContentHash !== priced.pricingConfigurationContentHash || resolved.quantity !== priced.quantity) throw new Error("Sales line product/configuration lineage mismatch.");
  assertSellingPriceDecision(line.sellingPriceDecision, line.pricingResult);
  if (line.calculatedLineAmount.currency !== line.pricingResult.currency || line.sellingLineAmount.currency !== line.pricingResult.currency || line.calculatedLineAmount.cents !== line.pricingResult.calculatedLineAmount.cents || line.sellingLineAmount.cents !== line.sellingPriceDecision.resultingLineAmount.cents) throw new Error("Sales line totals must preserve Pricing and selling-decision amounts.");
  return line;
};

export type CommercialTerms = Readonly<{ termsCode?: string; taxContextReference?: string; salesRepresentativeId?: string; commercialNotes?: string }>;
/** Sales-owned requested logistics snapshot. It never points at mutable CRM addresses. */
export type RequestedFulfillment = Readonly<{
  method: "pickup" | "shipping" | "local_delivery";
  destination?: Readonly<{ recipient?: string; company?: string; addressLine1: string; addressLine2?: string; city: string; region?: string; postalCode?: string; country?: string; phone?: string }>;
  instructions?: string;
}>;
export type SalesOrderAdjustment = Readonly<{ cents: number; reason: string }>;
export type SalesDocumentCurrentState = Readonly<{
  organizationId: OrganizationId;
  customerContact: CustomerContactReference;
  purchaseOrderNumber?: string;
  requestedDueDate?: string;
  currency: CurrencyCode;
  terms: CommercialTerms;
  lines: readonly SalesLineSnapshot[];
}>;

export type QuoteCurrentState = Readonly<SalesDocumentCurrentState & {
  quoteId: QuoteId;
  expiresAt?: string;
  deliveryState: "not_sent" | "sent";
  acceptanceState: "not_accepted" | "accepted";
  lifecycleState: "open" | "declined" | "voided";
  convertedOrderId?: OrderId;
  requestedFulfillment?: RequestedFulfillment;
  sellingAdjustment?: SalesOrderAdjustment;
  commercialCharge?: CommercialCharge;
  taxComposition?: SalesTaxComposition;
}>;
export type OrderCurrentState = Readonly<SalesDocumentCurrentState & {
  orderId: OrderId;
  sourceQuoteId?: QuoteId;
  sourceQuoteCheckpointId?: QuoteCheckpointId;
  commercialState: "open" | "cancelled";
  billingInvoiceReference?: InvoiceId;
  requestedFulfillment?: RequestedFulfillment;
  sellingAdjustment?: SalesOrderAdjustment;
  commercialCharge?: CommercialCharge;
  taxComposition?: SalesTaxComposition;
}>;

type QuoteCheckpointBase = Readonly<{
  schemaVersion: 1;
  checkpointId: QuoteCheckpointId;
  evidenceFingerprint: string;
  organizationId: OrganizationId;
  occurredAt: string;
  principal: AttributionSnapshot;
  customerPresentation: CustomerPresentationIdentity;
  commercial: Readonly<{ purchaseOrderNumber?: string; requestedDueDate?: string; currency: CurrencyCode; terms: CommercialTerms; lines: readonly SalesLineSnapshot[]; requestedFulfillment?: RequestedFulfillment; sellingAdjustment?: SalesOrderAdjustment; commercialCharge?: CommercialCharge; taxComposition?: SalesTaxComposition; taxEvidence?: Readonly<{ policyVersion: string; amounts: readonly Money[] }> }>;
  sourceCheckpointId?: QuoteCheckpointId;
}>;
export type QuoteCheckpoint =
  | Readonly<QuoteCheckpointBase & { kind: "quote_sent"; sourceDocument: Readonly<{ quoteId: QuoteId }> }>
  | Readonly<QuoteCheckpointBase & { kind: "quote_accepted"; sourceDocument: Readonly<{ quoteId: QuoteId }> }>
  | Readonly<QuoteCheckpointBase & { kind: "quote_converted"; sourceDocument: Readonly<{ quoteId: QuoteId; orderId: OrderId }> }>
  | Readonly<QuoteCheckpointBase & { kind: "quote_declined"; reason: string; sourceDocument: Readonly<{ quoteId: QuoteId }> }>
  | Readonly<QuoteCheckpointBase & { kind: "quote_voided"; reason: string; sourceDocument: Readonly<{ quoteId: QuoteId }> }>;

export type CreateQuoteCommand = Readonly<{ organizationId: OrganizationId; businessRequestId: BusinessRequestId; current: Omit<SalesDocumentCurrentState, "organizationId" | "lines"> & Readonly<{ lines: readonly SalesLineInput[] }> }>;
export type SalesDocumentPatch = Readonly<{
  customerContact?: CustomerContactReference;
  purchaseOrderNumber?: string;
  requestedDueDate?: string;
  terms?: CommercialTerms;
  lines?: readonly SalesLineInput[];
}>;
export type EditQuoteCommand = Readonly<{ organizationId: OrganizationId; quoteId: QuoteId; businessRequestId: BusinessRequestId; expectedStateToken: string; patch: SalesDocumentPatch }>;
/** Creates a fresh Draft from an existing Quote's frozen commercial facts. */
export type DuplicateQuoteCommand = Readonly<{ organizationId: OrganizationId; quoteId: QuoteId; businessRequestId: BusinessRequestId }>;
export type SendQuoteCommand = Readonly<{ organizationId: OrganizationId; quoteId: QuoteId; businessRequestId: BusinessRequestId; expectedStateToken: string }>;
export type AcceptQuoteCommand = Readonly<{ organizationId: OrganizationId; quoteId: QuoteId; checkpointId: QuoteCheckpointId; businessRequestId: BusinessRequestId; expectedStateToken: string }>;
export type ConvertQuoteCommand = Readonly<{ organizationId: OrganizationId; quoteId: QuoteId; sourceCheckpointId: QuoteCheckpointId; businessRequestId: BusinessRequestId; expectedStateToken: string }>;
export type CreateOrderCommand = Readonly<{ organizationId: OrganizationId; businessRequestId: BusinessRequestId; current: Omit<SalesDocumentCurrentState, "organizationId" | "lines"> & Readonly<{ lines: readonly SalesLineInput[] }> }>;
/** Creates a fresh open Order from an existing Order's frozen commercial facts. */
export type DuplicateOrderCommand = Readonly<{ organizationId: OrganizationId; orderId: OrderId; businessRequestId: BusinessRequestId }>;
export type EditOrderCommand = Readonly<{ organizationId: OrganizationId; orderId: OrderId; businessRequestId: BusinessRequestId; expectedStateToken: string; patch: SalesDocumentPatch }>;
/** Cancellation is an optimistic, auditable Sales lifecycle action.  It never
 * deletes the Order or any downstream operational/financial history. */
export type CancelOrderCommand = Readonly<{ organizationId: OrganizationId; orderId: OrderId; businessRequestId: BusinessRequestId; expectedStateToken: string; reason: string }>;

export type QuoteCommandResult = Readonly<{ quoteId: QuoteId; checkpointId?: QuoteCheckpointId }>;
export type OrderCommandResult = Readonly<{ orderId: OrderId; draftInvoiceId?: InvoiceId }>;
export type ConvertQuoteResult = Readonly<{ quoteId: QuoteId; sourceCheckpointId: QuoteCheckpointId; conversionCheckpointId: QuoteCheckpointId; orderId: OrderId; draftInvoiceId: InvoiceId }>;

/** Semantic audit, not column diffs, UI events, or a document version. */
export type MeaningfulAuditChange = Readonly<{
  group: "customer" | "commercial_terms" | "line" | "price" | "notes" | "fulfillment" | "lifecycle";
  kind: "customer_changed" | "contact_changed" | "po_changed" | "requested_due_date_changed" | "terms_changed" | "line_added" | "line_removed" | "quantity_changed" | "configuration_changed" | "description_changed" | "selling_price_changed" | "order_adjustment_changed" | "discount_changed" | "notes_changed" | "fulfillment_intent_changed" | "order_cancelled";
  resourceId?: SalesLineId | CustomerId | ContactId;
  summary: string;
}>;
