import "dotenv/config";
import { Client } from "pg";

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required.");
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  await client.query("BEGIN READ ONLY");
  try {
    const checks: Record<string, string> = {
      duplicatePoNumbers: `
        SELECT organization_id, po_number, COUNT(*)::int AS count
        FROM purchase_orders
        WHERE po_number IS NOT NULL AND btrim(po_number) <> ''
        GROUP BY organization_id, po_number
        HAVING COUNT(*) > 1
        ORDER BY count DESC, organization_id, po_number
        LIMIT 20
      `,
      poNumberingSettings: `
        SELECT name, COUNT(*)::int AS rows
        FROM global_variables
        WHERE name IN ('purchase_order_number_prefix', 'next_purchase_order_number', 'next_po_number')
        GROUP BY name
        ORDER BY name
      `,
      relatedOrderColumn: `
        SELECT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'purchase_orders' AND column_name = 'related_order_id'
        ) AS exists
      `,
      printerProfiles: `SELECT to_regclass('public.printer_profiles') IS NOT NULL AS exists`,
    };

    for (const [name, query] of Object.entries(checks)) {
      const result = await client.query(query);
      console.log(`[preflight] ${name}`, JSON.stringify(result.rows, null, 2));
    }
    await client.query("ROLLBACK");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error("[preflight] failed", error instanceof Error ? error.message : error);
  process.exit(1);
});
