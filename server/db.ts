import "dotenv/config";
import { Pool, neonConfig } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import ws from "ws";
import * as schema from "@shared/schema";
import { sql } from "drizzle-orm";

// Configure Neon to use WebSocket in Node
neonConfig.webSocketConstructor = ws;

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error(
    "DATABASE_URL must be set (in your environment or .env file) before starting the server or running migrations."
  );
}

export const pool = new Pool({ connectionString });
export const db = drizzle({ client: pool, schema });

// Store schema probe results
let _pageCountStatusColumnExists: boolean | null = null;
let _quoteAttachmentPagesTableExists: boolean | null = null;

/**
 * Probe database identity and schema at startup
 * Logs DB connection info and checks if required columns exist
 */
export async function probeDatabaseSchema(): Promise<void> {
  try {
    // DB identity probe
    const identityResult = await db.execute(sql`
      SELECT 
        current_database() as db,
        current_user as user,
        inet_server_addr() as addr,
        inet_server_port() as port
    `);
    const identity = identityResult.rows[0] as { db: string; user: string; addr: string | null; port: number | null };

    const searchPathResult = await db.execute(sql`SHOW search_path`);
    const searchPath = (searchPathResult.rows[0] as { search_path: string }).search_path;

    console.log(`[DB] db=${identity.db}, user=${identity.user}, addr=${identity.addr || 'null'}, port=${identity.port || 'null'}, search_path=${searchPath}`);

    // Redact DATABASE_URL for logging (show host and db name, hide password)
    if (connectionString) {
      try {
        const url = new URL(connectionString);
        const dbName = url.pathname.replace(/^\//, '') || 'unknown';
        const host = url.hostname || 'unknown';
        console.log(`[DB] DATABASE_URL: postgresql://${url.username}@${host}/${dbName} (password redacted)`);
      } catch (urlError) {
        // If URL parsing fails, just log a safe message
        console.log(`[DB] DATABASE_URL: (unable to parse for logging)`);
      }
    } else {
      console.log(`[DB] DATABASE_URL: (not set)`);
    }

    // Schema probe: check if page_count_status column exists
    const columnCheckResult = await db.execute(sql`
      SELECT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'quote_attachments'
          AND column_name = 'page_count_status'
      ) as has_page_count_status
    `);
    const columnCheck = columnCheckResult.rows[0] as { has_page_count_status: boolean };
    _pageCountStatusColumnExists = columnCheck.has_page_count_status;
    
    console.log(`[DB] quote_attachments.page_count_status exists? ${_pageCountStatusColumnExists}`);

    if (!_pageCountStatusColumnExists) {
      console.warn(`[DB] Missing page_count_status column; PDF derived fields disabled until migrations/DB connection fixed.`);
    }

    // TitanOS Phase 1 migration check: verify state column exists
    const titanosCheckResult = await db.execute(sql`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'orders'
        AND column_name IN ('state', 'status_pill_value', 'payment_status', 'routing_target')
      ORDER BY column_name
    `);
    const titanosColumns = titanosCheckResult.rows.map((r: any) => r.column_name);
    const hasTitanOSMigration = titanosColumns.includes('state');
    
    console.log(`[DB] TitanOS columns found: ${titanosColumns.length > 0 ? titanosColumns.join(', ') : 'NONE'}`);
    
    if (!hasTitanOSMigration) {
      console.error(`[DB] ⚠️  CRITICAL: TitanOS migration (0012) NOT applied! Column 'orders.state' does not exist.`);
      console.error(`[DB] ⚠️  /api/orders will fail with 500 error until migration is applied.`);
      console.error(`[DB] ⚠️  Run: npm run db:push OR apply server/db/migrations/0012_order_state_architecture.sql manually`);
    } else {
      console.log(`[DB] ✓ TitanOS migration (0012) verified - all columns present`);
    }

    // Schema probe: check if quote_attachment_pages table exists (respects search_path)
    const tableCheckResult = await db.execute(sql`
      SELECT EXISTS (
        SELECT 1
        FROM information_schema.tables
        WHERE table_schema = current_schema()
          AND table_name = 'quote_attachment_pages'
      ) as has_table
    `);
    const tableCheck = tableCheckResult.rows[0] as { has_table: boolean };
    _quoteAttachmentPagesTableExists = tableCheck.has_table;
    
    console.log(`[DB] quote_attachment_pages table exists? ${_quoteAttachmentPagesTableExists}`);

    if (!_quoteAttachmentPagesTableExists) {
      console.warn(`[DB] Missing quote_attachment_pages table; page enrichment disabled until migrations/DB connection fixed.`);
    }
  } catch (error: any) {
    console.error(`[DB] Schema probe failed:`, error?.message || error);
    // Don't throw - allow server to start but mark column/table as missing
    _pageCountStatusColumnExists = false;
    _quoteAttachmentPagesTableExists = false;
  }
}

/**
 * Check if page_count_status column exists (from startup probe)
 * Returns null if probe hasn't run yet, true/false otherwise
 */
export function hasPageCountStatusColumn(): boolean | null {
  return _pageCountStatusColumnExists;
}

/**
 * Check if quote_attachment_pages table exists (from startup probe)
 * Returns null if probe hasn't run yet, true/false otherwise
 */
export function hasQuoteAttachmentPagesTable(): boolean | null {
  return _quoteAttachmentPagesTableExists;
}
