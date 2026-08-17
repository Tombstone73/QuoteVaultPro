import type { Pool } from "pg";
import type { ProviderRefundReconciliationStore } from "../../src/modules/billing/providerRefundReconciliation.js";

/** PostgreSQL is authoritative for whether a provider refund still needs reconciliation. */
export class PostgresProviderRefundReconciliationStore implements ProviderRefundReconciliationStore {
  constructor(private readonly pool: Pool) {}
  async unresolved(input: Readonly<{ organizationId: string; providerOperationId: string }>): Promise<Readonly<{ invoiceId: string; paymentId: string }> | null> {
    const result=await this.pool.query<{invoice_id:string;payment_id:string}>("SELECT invoice_id,payment_id FROM v2_billing_provider_financial_operations WHERE organization_id=$1 AND id=$2 AND operation_kind='refund' AND reconciliation_state='uncertain'",[input.organizationId,input.providerOperationId]);
    return result.rows[0]?{invoiceId:result.rows[0].invoice_id,paymentId:result.rows[0].payment_id}:null;
  }
  async markFailed(input: Readonly<{ organizationId: string; providerOperationId: string }>): Promise<void> {
    await this.pool.query("UPDATE v2_billing_provider_financial_operations SET reconciliation_state='failed',updated_at=now() WHERE organization_id=$1 AND id=$2 AND operation_kind='refund' AND reconciliation_state='uncertain'",[input.organizationId,input.providerOperationId]);
  }
}
