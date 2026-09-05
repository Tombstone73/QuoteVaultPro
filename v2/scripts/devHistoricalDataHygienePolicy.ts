import { Pool, type PoolClient } from "pg";
import { requireV2DeploymentDatabaseUrl } from "../src/config/runtimeConfig.js";

export type HygieneDisposition = "KEEP AS HISTORY" | "ARCHIVE / HIDE FROM ACTIVE WORK" | "REVIEW";
export type HygieneCategory = "sales_document" | "product_version" | "prepress" | "payment" | "queue" | "artifact";

/** Labels and age are evidence for review, never authority to delete records. */
export function historicalDataDisposition(category: HygieneCategory, evidence: Readonly<Record<string, unknown>>): HygieneDisposition {
  if (category === "sales_document" || category === "payment") return "KEEP AS HISTORY";
  if (category === "product_version") return evidence.status === "DRAFT" || evidence.missing_product ? "REVIEW" : "KEEP AS HISTORY";
  if (category === "prepress") return evidence.production_requirement_state === "unconfigured" ? "ARCHIVE / HIDE FROM ACTIVE WORK" : "KEEP AS HISTORY";
  if (category === "queue") return ["sent", "succeeded", "completed", "delivered"].includes(String(evidence.state)) ? "KEEP AS HISTORY" : "REVIEW";
  return "REVIEW";
}

export function historicalDataScope(args: readonly string[]): string | null {
  if (args.length === 1 && args[0] === "--all-organizations") return null;
  if (args.length === 2 && args[0] === "--organization-id" && /^[a-zA-Z0-9_-]{1,200}$/.test(args[1])) return args[1];
  throw new Error("Provide exactly --organization-id <id> or --all-organizations; there is no implicit scope.");
}

/** One acquired connection, server-enforced read-only snapshot, rollback on every path. */
export async function readOnlyDevSnapshot<T>(
  environment: Readonly<Record<string, string | undefined>>,
  read: (client: PoolClient) => Promise<T>,
  createPool: (connectionString: string) => Pick<Pool, "connect" | "end"> = connectionString => new Pool({ connectionString, max: 1, connectionTimeoutMillis: 10000 }),
): Promise<Readonly<{ transaction: Readonly<{ read_only: string; isolation: string; snapshot_at: Date }>; data: T }>> {
  const connectionString = requireV2DeploymentDatabaseUrl(environment);
  const pool = createPool(connectionString);
  try {
    const client = await pool.connect();
    let transactionOpen = false;
    try {
      await client.query("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
      transactionOpen = true;
      await client.query("SET LOCAL statement_timeout = '20s'");
      await client.query("SET LOCAL lock_timeout = '3s'");
      const transaction = (await client.query<{ read_only: string; isolation: string; snapshot_at: Date }>("SELECT current_setting('transaction_read_only') read_only,current_setting('transaction_isolation') isolation,transaction_timestamp() snapshot_at")).rows[0];
      if (transaction.read_only !== "on" || transaction.isolation !== "repeatable read") throw new Error("Read-only snapshot transaction was not established.");
      const data = await read(client);
      await client.query("ROLLBACK");
      transactionOpen = false;
      return { transaction, data };
    } finally {
      if (transactionOpen) await client.query("ROLLBACK").catch(() => undefined);
      client.release();
    }
  } finally {
    await pool.end();
  }
}
