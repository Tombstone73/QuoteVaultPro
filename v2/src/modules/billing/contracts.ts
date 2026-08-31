import type { CustomerContactReference } from "../customers/contracts.js";
import type { CustomerPresentationIdentity } from "../customers/contracts.js";
import type { PrincipalKind } from "../../authorization/principals.js";
import type { BusinessRequestId, CurrencyCode, InvoiceCheckpointId, InvoiceId, Money, OrderId, OrganizationId, PercentageBasisPoints, ProductId, SalesLineId } from "../shared/commercialValues.js";

/** Sales supplies a projection; Billing owns any resulting Invoice row, math, and lifecycle. */
/** Live invoice projection from the editable Order; Billing owns the row and math. */
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
export type DraftInvoiceSynchronizationInput = OrderBackedInvoiceSynchronizationInput;
export type CreateDraftInvoiceInput = OrderBackedInvoiceSynchronizationInput;
export type DraftInvoiceSynchronizationResult = Readonly<{ invoiceId: InvoiceId; status: "created" | "synchronized" | "unchanged" | "not_editable"; reason?: "invoice_issued" | "invoice_void" | "invoice_missing" | "multiple_active_invoices"; synchronizationVersion?: string }>;
/** Canonical name; Draft* aliases remain only for incremental adapter compatibility. */
export type OrderBackedInvoiceSynchronizationResult = DraftInvoiceSynchronizationResult;
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

export interface BillingPort {
  createDraftInvoice(input: CreateDraftInvoiceInput): Promise<DraftInvoiceSynchronizationResult>;
  synchronizeDraftInvoice(input: DraftInvoiceSynchronizationInput): Promise<DraftInvoiceSynchronizationResult>;
}
