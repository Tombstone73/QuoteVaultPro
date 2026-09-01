import type { CustomerContactReference } from "../customers/contracts.js";
import type { CustomerPresentationIdentity } from "../customers/contracts.js";
import type { PrincipalKind } from "../../authorization/principals.js";
import type { BusinessRequestId, CurrencyCode, InvoiceCheckpointId, InvoiceId, Money, OrderId, OrganizationId, PercentageBasisPoints, ProductId, SalesLineId } from "../shared/commercialValues.js";

/** Sales supplies a projection; Billing owns any resulting Invoice row, math, and lifecycle. */
/** A live Invoice mirrors its editable Order commercial state. */
export type OrderBackedInvoiceSynchronizationInput = Readonly<{
  organizationId: OrganizationId;
  orderId: OrderId;
  businessRequestId: BusinessRequestId;
  customerContact: CustomerContactReference;
  currency: CurrencyCode;
  termsCode?: string;
  salesLines: readonly Readonly<{ lineId: SalesLineId; productId: ProductId; description: string; quantity: number; sellingLineAmount: Money }>[];
  taxInput: Readonly<{ taxContextReference?: string; compatibilityCalculatorVersion?: string }>;
  sourceSalesStateToken: string;
}>;
export type CreateOrderBackedInvoiceInput = OrderBackedInvoiceSynchronizationInput;
export type OrderBackedInvoiceSynchronizationResult = Readonly<{ invoiceId: InvoiceId; status: "created" | "synchronized" | "unchanged" | "not_editable"; reason?: "invoice_void" | "invoice_missing" | "multiple_active_invoices" | "external_accounting_resync_required"; synchronizationVersion?: string }>;
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

export interface BillingPort {
  createOrderBackedInvoice(input: CreateOrderBackedInvoiceInput): Promise<OrderBackedInvoiceSynchronizationResult>;
  synchronizeOrderBackedInvoice(input: OrderBackedInvoiceSynchronizationInput): Promise<OrderBackedInvoiceSynchronizationResult>;
}

/**
 * Shared billing delivery boundary. V2 does not yet expose an invoice-list UI;
 * when it does, that UI must call the same tenant-scoped durable delivery queue
 * rather than implementing browser-side email loops.
 */
export type BulkInvoiceDeliveryRequest = Readonly<{
  organizationId: OrganizationId;
  invoiceIds: readonly InvoiceId[];
  idempotencyKey: BusinessRequestId;
}>;

export type BulkInvoiceDeliveryResult = Readonly<{
  selected: number;
  queued: number;
  alreadyQueued: number;
  skipped: readonly Readonly<{ invoiceId: InvoiceId; reason: string }>[];
}>;

export interface BulkInvoiceDeliveryPort {
  queueBulkInvoiceDelivery(input: BulkInvoiceDeliveryRequest): Promise<BulkInvoiceDeliveryResult>;
}
