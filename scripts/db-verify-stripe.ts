import "dotenv/config";

import { Client } from 'pg';

function requireDatabaseUrl(): string {
  const url = (process.env.DATABASE_URL || '').trim();
  if (!url) {
    console.error('[db:verify:stripe] DATABASE_URL is missing. Ensure .env contains DATABASE_URL or set it in the shell.');
    process.exit(1);
  }
  return url;
}

async function tableExists(client: Client, tableName: string): Promise<boolean> {
  const res = await client.query(
    `SELECT 1
     FROM information_schema.tables
     WHERE table_schema = 'public'
       AND table_name = $1
     LIMIT 1`,
    [tableName]
  );
  return res.rowCount > 0;
}

async function columnExists(client: Client, tableName: string, columnName: string): Promise<boolean> {
  const res = await client.query(
    `SELECT 1
     FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = $1
       AND column_name = $2
     LIMIT 1`,
    [tableName, columnName]
  );
  return res.rowCount > 0;
}

async function getDrizzleMigrationsTableRef(client: Client): Promise<string | null> {
  const res = await client.query(
    `SELECT table_schema
     FROM information_schema.tables
     WHERE table_name = '__drizzle_migrations'
     ORDER BY CASE WHEN table_schema = 'public' THEN 0 ELSE 1 END, table_schema
     LIMIT 1`
  );

  const schema = res.rows?.[0]?.table_schema as string | undefined;
  if (!schema) return null;
  // Safe quoting: schema name comes from information_schema.
  return `"${schema.replace(/"/g, '""')}"."__drizzle_migrations"`;
}

async function getMaxDrizzleMigrationId(client: Client, tableRef: string): Promise<number | null> {
  // Works whether id is text or numeric.
  const res = await client.query(
    `SELECT MAX(CASE
        WHEN id::text ~ '^[0-9]+$' THEN (id::text)::int
        ELSE NULL
      END) AS max_id
     FROM ${tableRef}`
  );

  const v = res.rows?.[0]?.max_id;
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

async function main() {
  const databaseUrl = requireDatabaseUrl();

  const client = new Client({ connectionString: databaseUrl });
  await client.connect();

  try {
    const problems: string[] = [];

    const hasWebhookEvents = await tableExists(client, 'payment_webhook_events');
    if (!hasWebhookEvents) problems.push('Missing table: payment_webhook_events');

    const hasPayments = await tableExists(client, 'payments');
    if (!hasPayments) problems.push('Missing table: payments');

    if (hasPayments) {
      const cols = [
        'organization_id',
        'provider',
        'stripe_payment_intent_id',
      ];
      for (const c of cols) {
        const ok = await columnExists(client, 'payments', c);
        if (!ok) problems.push(`Missing column: payments.${c}`);
      }
    }

    // user-provided invariant: DB has applied migrations through id >= 27
    let maxId: number | null = null;
    try {
      const tableRef = await getDrizzleMigrationsTableRef(client);
      if (!tableRef) {
        problems.push('Missing table: __drizzle_migrations');
      } else {
        maxId = await getMaxDrizzleMigrationId(client, tableRef);
      }
    } catch (e: any) {
      problems.push(`Unable to read __drizzle_migrations (${e?.message || e})`);
    }

    if (maxId == null) problems.push('Unable to determine max __drizzle_migrations.id');
    else if (maxId < 27) problems.push(`__drizzle_migrations max id is ${maxId}, expected >= 27`);

    if (problems.length) {
      console.error('[db:verify:stripe] FAILED');
      for (const p of problems) console.error(`- ${p}`);
      process.exit(1);
    }

    console.log('[db:verify:stripe] OK');
    console.log('- payment_webhook_events exists');
    console.log('- payments has required Stripe columns');
    console.log(`- __drizzle_migrations max id >= 27 (${maxId})`);
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error('[db:verify:stripe] Fatal:', err?.message || err);
  process.exit(1);
});
