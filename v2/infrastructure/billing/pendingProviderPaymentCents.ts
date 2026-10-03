import type { PoolClient } from "pg";

export type BillingQueryClient = Pick<PoolClient, "query">;

/** Sum pending scalar reservations and allocation-backed PaymentIntent reservations once. */
export const readPendingProviderPaymentCents = async (
  client: BillingQueryClient,
  organizationId: string,
  invoiceId: string,
): Promise<number> => {
  const result = await client.query<{ cents: string }>(
    `SELECT COALESCE(SUM(
       CASE
         WHEN jsonb_array_length(operation.allocation_intent) > 0 THEN
           CASE WHEN allocation.entry->>'invoiceId'=$2
             THEN COALESCE((allocation.entry->>'amountCents')::bigint,0)
             ELSE 0
           END
         WHEN operation.invoice_id=$2 THEN operation.amount_cents
         ELSE 0
       END
     ),0)::text cents
       FROM v2_billing_provider_financial_operations operation
       LEFT JOIN LATERAL jsonb_array_elements(operation.allocation_intent) AS allocation(entry) ON true
      WHERE operation.organization_id=$1 AND operation.operation_kind='payment'
        AND operation.reconciliation_state IN ('pending','uncertain')`,
    [organizationId, invoiceId],
  );
  const cents = Number(result.rows[0]?.cents ?? 0);
  if (!Number.isSafeInteger(cents) || cents < 0) throw new Error("Pending provider Payment reservations exceed the safe exact-cent range.");
  return cents;
};
