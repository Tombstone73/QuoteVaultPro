import type { Pool } from "pg";
import type { OrderTransaction } from "../../src/modules/sales/orderApplication.js";
import type { QuoteConversionPersistencePort } from "../../src/modules/sales/quoteApplication.js";
import {
  PostgresOrderTransaction,
  type OrderPersistenceTestHooks,
} from "./postgresOrderTransaction.js";
import {
  PostgresQuoteTransaction,
  type QuotePersistenceTestHooks,
} from "./postgresQuoteTransaction.js";
import { PostgresQuoteArtworkConversionPort } from "../artwork/postgresQuoteArtworkTransaction.js";

export type QuoteConversionTransaction = Readonly<{
  quote: QuoteConversionPersistencePort;
  order: OrderTransaction;
  artwork: PostgresQuoteArtworkConversionPort;
}>;
export interface QuoteConversionTransactionRunner {
  transaction<T>(action: (transaction: QuoteConversionTransaction) => Promise<T>): Promise<T>;
}
export type QuoteConversionPersistenceTestHooks = Readonly<{
  quote?: QuotePersistenceTestHooks;
  order?: OrderPersistenceTestHooks;
}>;

/** One PostgreSQL transaction deliberately spans Quote lineage, Order, Billing,
 * Routing, M0 attribution and Audit.  Modules still communicate only through
 * their transaction-scoped contracts; this never reaches into foreign tables. */
export class PostgresQuoteConversionTransactionRunner implements QuoteConversionTransactionRunner {
  constructor(private readonly pool: Pool, private readonly hooks?: QuoteConversionPersistenceTestHooks) {}
  async transaction<T>(action: (transaction: QuoteConversionTransaction) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await action({
        quote: new PostgresQuoteTransaction(client, this.hooks?.quote),
        order: new PostgresOrderTransaction(client, this.hooks?.order),
        artwork: new PostgresQuoteArtworkConversionPort(client),
      });
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}
