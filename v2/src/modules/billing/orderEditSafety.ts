import { V2ApplicationError } from "../../errors/applicationError.js";

export type OrderEditBillingSafetyRequest = Readonly<{
  organizationId: string;
  orderId: string;
}>;

export type OrderEditBillingSafetyReason =
  | "order_missing"
  | "base_invoice_missing"
  | "base_invoice_void"
  | "multiple_active_base_invoices"
  | "invalid_base_invoice_relation"
  | "retained_shipping_charges";

/** Existing synchronization safety, not payment, credit or production-release policy. */
export type OrderEditBillingSafetyAssessment = Readonly<{
  baseInvoiceId?: string;
  synchronizationVersion?: string;
  /** Presence on the resolved base only; ambiguity is blocked independently.
   * Includes zero rows to preserve evidence without claiming an amount loss. */
  hasRetainedShippingCharges: boolean;
  editability: "editable" | "blocked";
  reason?: OrderEditBillingSafetyReason;
}>;

/** The authorized Sales coordinator supplies transaction-local composition.
 * Apply blockers to canonical mutations, not a TEMP-only no-op receipt. */
export interface OrderEditBillingSafetyPort {
  assessOrderEditBilling(request: OrderEditBillingSafetyRequest): Promise<OrderEditBillingSafetyAssessment>;
}

export function assertOrderEditBillingSafetyRequest(request: OrderEditBillingSafetyRequest): void {
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (!request || typeof request !== "object" || Array.isArray(request)
    || Object.keys(request).some(key => key !== "organizationId" && key !== "orderId")
    || typeof request.organizationId !== "string" || !uuid.test(request.organizationId)
    || typeof request.orderId !== "string" || !uuid.test(request.orderId)) {
    throw new V2ApplicationError("VALIDATION_ERROR", "Order edit Billing safety requires organization and Order UUIDs.");
  }
}
