import type { Pool } from "pg";
import type { ProviderPaymentReconciliationStore } from "../../src/modules/billing/providerPaymentReconciliation.js";

/** PostgreSQL is the source of truth for whether a provider payment still needs reconciliation. */
export class PostgresProviderPaymentReconciliationStore implements ProviderPaymentReconciliationStore {
  constructor(private readonly pool: Pool) {}

  async unresolved(input: Readonly<{ organizationId: string; providerOperationId: string }>): Promise<Readonly<{ invoiceId: string }> | null> {
    const result = await this.pool.query<{ invoice_id: string }>("SELECT invoice_id FROM v2_billing_provider_financial_operations WHERE organization_id=$1 AND id=$2 AND operation_kind='payment' AND reconciliation_state='uncertain'", [input.organizationId, input.providerOperationId]);
    return result.rows[0] ? { invoiceId: result.rows[0].invoice_id } : null;
  }

  async markFailed(input: Readonly<{ organizationId: string; providerOperationId: string }>): Promise<void> {
    await this.pool.query("UPDATE v2_billing_provider_financial_operations SET reconciliation_state='failed',updated_at=now() WHERE organization_id=$1 AND id=$2 AND operation_kind='payment' AND reconciliation_state='uncertain'", [input.organizationId, input.providerOperationId]);
  }
}
