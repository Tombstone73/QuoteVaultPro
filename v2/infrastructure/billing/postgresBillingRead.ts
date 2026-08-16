import type { Pool } from "pg";
import type { BillingReadRunner } from "../../src/modules/billing/billingApplication.js";
import type { BillingReadPort } from "../../src/modules/billing/contracts.js";
import { PostgresBillingDraftInvoiceTransaction } from "./postgresBillingDraftInvoiceTransaction.js";

export class PostgresBillingReadRunner implements BillingReadRunner {
  constructor(private readonly pool: Pool) {}
  async read<T>(action: (port: BillingReadPort) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try { await client.query("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY"); const result = await action(new PostgresBillingDraftInvoiceTransaction(client)); await client.query("COMMIT"); return result; }
    catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
  }
}
