import {
  assertOrderEditBillingSafetyRequest,
  type OrderEditBillingSafetyAssessment,
  type OrderEditBillingSafetyRequest,
} from "../../src/modules/billing/orderEditSafety.js";
import type { TransactionalClient } from "../persistence/types.js";

type InvoiceRow = Readonly<{
  id: string;
  invoice_state: "draft" | "issued" | "void";
  replacement_obligation_id: string | null;
  invoice_sequence: number | null;
  synchronization_version: string;
}>;

/** Caller owns authorization and BEGIN/COMMIT/ROLLBACK. Invoke before the caller
 * locks the Order for mutation. This locks the current scoped Invoice set, not
 * future inserts, and does not repair legacy lock sequences or financial math. */
export async function assessOrderEditBillingInTransaction(
  client: TransactionalClient,
  request: OrderEditBillingSafetyRequest,
): Promise<OrderEditBillingSafetyAssessment> {
  assertOrderEditBillingSafetyRequest(request);
  const { organizationId, orderId } = request;
  const blocked = { hasRetainedShippingCharges: false, editability: "blocked" as const };
  const order = await client.query<{ id: string }>(
    `SELECT d.id FROM v2_sales_documents d
     JOIN v2_sales_order_details o ON o.organization_id=d.organization_id AND o.document_id=d.id
     WHERE d.organization_id=$1 AND d.id=$2 AND d.document_kind='order'`,
    [organizationId, orderId],
  );
  if (!order.rows.length) return { ...blocked, reason: "order_missing" };

  // Include replacement and void rows so later same-client Sales reconciliation
  // does not acquire another existing Invoice before its already-locked peers.
  const invoices = await client.query<InvoiceRow>(
    `SELECT id,invoice_state,replacement_obligation_id,invoice_sequence,
       synchronization_version::text AS synchronization_version
     FROM v2_billing_invoices
     WHERE organization_id=$1 AND sales_order_document_id=$2
     ORDER BY id FOR UPDATE`,
    [organizationId, orderId],
  );
  const primary = invoices.rows.filter(invoice => invoice.replacement_obligation_id === null);
  const active = primary.filter(invoice => invoice.invoice_state !== "void");
  if (active.length > 1) return { ...blocked, reason: "multiple_active_base_invoices" };
  const base = active[0] ?? (primary.length === 1 ? primary[0] : undefined);
  if (!base) return { ...blocked, reason: primary.length ? "base_invoice_void" : "base_invoice_missing" };

  const identity = { baseInvoiceId: base.id, synchronizationVersion: base.synchronization_version };
  const validSequence = base.invoice_state === "draft" ? base.invoice_sequence === null : base.invoice_sequence === 1;
  if (!validSequence) return { ...blocked, ...identity, reason: "invalid_base_invoice_relation" };
  const charges = await client.query<{ present: boolean }>(
    `SELECT EXISTS(
       SELECT 1 FROM v2_billing_invoice_additional_charges
       WHERE organization_id=$1 AND sales_order_document_id=$2 AND invoice_id=$3 AND charge_kind='shipping'
     ) AS present`,
    [organizationId, orderId, base.id],
  );
  const hasRetainedShippingCharges = charges.rows[0].present;
  if (base.invoice_state === "void") return { ...blocked, ...identity, hasRetainedShippingCharges, reason: "base_invoice_void" };
  if (hasRetainedShippingCharges) return { ...blocked, ...identity, hasRetainedShippingCharges, reason: "retained_shipping_charges" };
  return { ...identity, hasRetainedShippingCharges, editability: "editable" };
}
