import "dotenv/config";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "../shared/schema";
import { previewHistoricalCloseJobProductionRepair, applyHistoricalCloseJobProductionRepair } from "../server/services/historicalCloseJobProductionRepairService";

async function main() {
  const organizationId = process.env.ORGANIZATION_ID?.trim();
  const orderId = process.env.ORDER_ID?.trim();
  const databaseUrl = process.env.DATABASE_URL?.trim();
  const apply = process.argv.includes("--apply");
  if (!organizationId || !orderId) throw new Error("ORGANIZATION_ID and ORDER_ID (UUID) are required. Public order numbers are not accepted.");
  if (!databaseUrl) throw new Error("DATABASE_URL is required for the historical production repair CLI.");

  // Railway shell repairs must use the native pg transport. Do not import
  // server/db here: its serverless WebSocket client has previously returned a
  // different read view from the MAIN runtime's native pg connection.
  // Preview and apply deliberately share this exact database handle.
  const pool = new Pool({ connectionString: databaseUrl });
  const repairDb = drizzle({ client: pool, schema });
  try {
    const result = apply
      ? await applyHistoricalCloseJobProductionRepair(repairDb, { organizationId, orderId })
      : await previewHistoricalCloseJobProductionRepair(repairDb, { organizationId, orderId });
    console.log(JSON.stringify({ mode: apply ? "apply" : "preview", result }, null, 2));
  } finally {
    await pool.end();
  }
}

main().catch((error) => { console.error("[historical-close-job-production-repair]", error); process.exit(1); });
