import type { CustomerContactReference } from "../customers/contracts.js";
import type { CustomerPresentationIdentity } from "../customers/contracts.js";
import type { PrincipalKind } from "../../authorization/principals.js";
import type { BusinessRequestId, CurrencyCode, CustomerId, InvoiceCheckpointId, InvoiceId, Money, OrderId, OrderLineId, OrganizationId, PaymentId, PercentageBasisPoints, ProductId, ProviderFinancialOperationId, RefundId, SalesLineId } from "../shared/commercialValues.js";

/** Sales supplies a projection; Billing owns any resulting Invoice row, math, and lifecycle. */
export type DraftInvoiceSynchronizationInput = Readonly<{
  organizationId: OrganizationId;
  orderId: OrderId;
  businessRequestId: BusinessRequestId;
  customerContact: CustomerContactReference;
  /** Sales-owned commercial header fact projected into Billing's current Draft. */
  purchaseOrderNumber?: string;
  currency: CurrencyCode;
  termsCode?: string;
  /**
   * Billing receives final Sales selling amounts and evidence. It must never
   * invoke Pricing or reconstruct a SellingPriceDecision from these values.
   */
  salesLines: readonly Readonly<{
    lineId: SalesLineId;
    productId: ProductId;
    description: string;
    quantity: number;
    sellingUnitAmount: Money;
    sellingLineAmount: Money;
    salesPricingEvidenceFingerprint: string;
  }>[];
  /** Sales may identify the commercial tax context; Billing owns calculator/version evidence. */
  taxInput: Readonly<{ taxContextReference?: string }>;
  sourceSalesStateToken: string;
}>;
export type CreateDraftInvoiceInput = DraftInvoiceSynchronizationInput;
export type DraftInvoiceSynchronizationResult =
  | Readonly<{ invoiceId: InvoiceId; status: "created" | "synchronized" | "unchanged"; synchronizationVersion: string }>
  | Readonly<{ invoiceId: InvoiceId; status: "not_editable"; reason: "invoice_issued" | "invoice_void" | "multiple_active_invoices"; synchronizationVersion?: string }>
  | Readonly<{ status: "not_editable"; reason: "invoice_missing" }>;
export type IssueInvoiceInput = Readonly<{ organizationId: OrganizationId; invoiceId: InvoiceId; businessRequestId: BusinessRequestId }>;
export type BillingAttributionSnapshot =
  | Readonly<{ principalKind: Exclude<PrincipalKind, "delegated_ai">; subjectId: string; staffActorUserId?: never }>
  | Readonly<{ principalKind: "delegated_ai"; subjectId: string; staffActorUserId: string }>;
export type InvoiceIssuedLineSnapshot = Readonly<{ lineId: SalesLineId; productId: ProductId; description: string; quantity: number; unitAmount: Money; lineAmount: Money; salesPricingEvidenceFingerprint: string }>;
export type IssuedInvoiceCheckpoint = Readonly<{
  schemaVersion: 1;
  checkpointId: InvoiceCheckpointId;
  evidenceFingerprint: string;
  invoiceId: InvoiceId;
  organizationId: OrganizationId;
  occurredAt: string;
  principal: BillingAttributionSnapshot;
  customerPresentation: CustomerPresentationIdentity;
  commercial: Readonly<{ currency: CurrencyCode; purchaseOrderNumber?: string; termsCode?: string; subtotal: Money; taxTotal: Money; total: Money }>;
  taxEvidence: Readonly<{ calculationId: string; calculatorVersion: string; contextReference?: string; components: readonly Readonly<{ jurisdiction: string; rateBasisPoints: PercentageBasisPoints; taxableBase: Money; amount: Money }>[] }>;
  lines: readonly InvoiceIssuedLineSnapshot[];
}>;
export type IssuedInvoiceBoundary = Readonly<{ invoiceId: InvoiceId; status: "issued"; checkpointId: InvoiceCheckpointId; silentOrderSynchronization: false }>;
export type IssuedInvoiceResult = Readonly<{ invoice: DraftInvoiceReadModel; checkpoint: IssuedInvoiceCheckpoint; boundary: IssuedInvoiceBoundary }>;

export interface BillingPort {
  createDraftInvoice(input: CreateDraftInvoiceInput): Promise<DraftInvoiceSynchronizationResult>;
  synchronizeDraftInvoice(input: DraftInvoiceSynchronizationInput): Promise<DraftInvoiceSynchronizationResult>;
}

export type DraftInvoiceReadLine = Readonly<{
  sourceOrderLineId: OrderLineId;
  productId: ProductId;
  description: string;
  quantity: number;
  sellingUnitAmount: Money;
  lineAmount: Money;
}>;
export type DraftInvoiceReadModel = Readonly<{
  source?: "v2" | "legacy";
  readOnly?: true;
  invoiceId: InvoiceId;
  organizationId: OrganizationId;
  sourceOrderId: OrderId;
  /** The Sales-owned Order number is context, never an invented Invoice number. */
  sourceOrderNumber?: string;
  customerId?: CustomerId;
  customerPresentation?: CustomerPresentationIdentity;
  lifecycle: "draft" | "issued" | "void";
  currency: CurrencyCode;
  synchronizationVersion: string;
  lines: readonly DraftInvoiceReadLine[];
  subtotal: Money;
  taxTotal: Money;
  total: Money;
  purchaseOrderNumber?: string;
  termsCode?: string;
  issuedAt?: string;
  /** Billing's immutable issued document snapshot; absent while the Invoice tracks the Order. */
  issuedCheckpoint?: IssuedInvoiceCheckpoint;
  createdAt: string;
  updatedAt: string;
}>;
export type InvoiceListRequest = Readonly<{ query?: string; lifecycle?: DraftInvoiceReadModel["lifecycle"]; limit?: number }>;
export type InvoiceListItem = Readonly<{
  invoiceId: InvoiceId;
  sourceOrderId: OrderId;
  sourceOrderNumber: string;
  customerId?: CustomerId;
  lifecycle: DraftInvoiceReadModel["lifecycle"];
  customerPresentation?: CustomerPresentationIdentity;
  currency: CurrencyCode;
  total: Money;
  issuedAt?: string;
  updatedAt: string;
}>;
export interface BillingReadPort {
  readInvoice(organizationId: OrganizationId, invoiceId: InvoiceId): Promise<DraftInvoiceReadModel | null>;
  readDraftForOrder(organizationId: OrganizationId, orderId: OrderId): Promise<DraftInvoiceReadModel | null>;
  listInvoices(organizationId: OrganizationId, request: InvoiceListRequest): Promise<readonly InvoiceListItem[]>;
}

export type PaymentMethod = "cash" | "check" | "external" | "card" | "ach" | "other";
export type ProviderReconciliationState = "pending" | "succeeded" | "failed" | "uncertain";
export type RecordManualPaymentInput = Readonly<{ organizationId: OrganizationId; invoiceId: InvoiceId; amount: Money; method: Exclude<PaymentMethod, "card" | "ach">; occurredAt: string; businessRequestId: BusinessRequestId }>;
export type RecordRefundInput = Readonly<{ organizationId: OrganizationId; invoiceId: InvoiceId; paymentId: PaymentId; amount: Money; occurredAt: string; businessRequestId: BusinessRequestId }>;
export type BeginProviderFinancialOperationInput = Readonly<{ organizationId: OrganizationId; invoiceId: InvoiceId; kind: "payment" | "refund"; paymentId?: PaymentId; amount: Money; provider: string; providerIdempotencyKey: string; businessRequestId: BusinessRequestId }>;
export type ProviderFinancialOperation = Readonly<{ providerOperationId: ProviderFinancialOperationId; invoiceId: InvoiceId; kind: "payment" | "refund"; paymentId?: PaymentId; amount: Money; provider: string; providerIdempotencyKey: string; providerTransactionId?: string; reconciliationState: ProviderReconciliationState }>;
export type ConfirmProviderPaymentInput = Readonly<{ organizationId: OrganizationId; invoiceId: InvoiceId; providerOperationId: ProviderFinancialOperationId; providerEventId: string; providerTransactionId: string; occurredAt: string; businessRequestId: BusinessRequestId }>;
export type ConfirmProviderRefundInput = Readonly<{ organizationId: OrganizationId; invoiceId: InvoiceId; paymentId: PaymentId; providerOperationId: ProviderFinancialOperationId; providerEventId: string; providerTransactionId: string; occurredAt: string; businessRequestId: BusinessRequestId }>;
export type PaymentFact = Readonly<{ paymentId: PaymentId; invoiceId: InvoiceId; amount: Money; method: PaymentMethod; source: "manual" | "provider"; providerOperationId?: ProviderFinancialOperationId; providerTransactionId?: string; occurredAt: string }>;
export type RefundFact = Readonly<{ refundId: RefundId; invoiceId: InvoiceId; paymentId: PaymentId; amount: Money; source: "manual" | "provider"; providerOperationId?: ProviderFinancialOperationId; providerTransactionId?: string; occurredAt: string }>;
export type InvoiceSettlement = Readonly<{ invoiceId: InvoiceId; gross: Money; successfulPayments: Money; successfulRefunds: Money; collectibleBalance: Money }>;
