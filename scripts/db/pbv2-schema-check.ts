import { Client } from "pg";

function redactDatabaseUrl(url: string) {
  try {
    const parsed = new URL(url);
    const dbName = parsed.pathname.replace(/^\//, "") || "<db>";
    return `${parsed.protocol}//${parsed.username ? "<user>@" : ""}${parsed.hostname}/${dbName}`;
  } catch {
    return "<invalid DATABASE_URL>";
  }
}

type CheckResult = { ok: true } | { ok: false; message: string };

function pass(): CheckResult {
  return { ok: true };
}

function fail(message: string): CheckResult {
  return { ok: false, message };
}

async function checkOne(
  name: string,
  fn: () => Promise<CheckResult>
): Promise<{ failed: boolean }> {
  try {
    const res = await fn();
    if (res.ok) {
      console.log(`PASS: ${name}`);
      return { failed: false };
    }
    console.log(`FAIL: ${name} - ${res.message}`);
    return { failed: true };
  } catch (e: any) {
    console.log(`FAIL: ${name} - ${(e?.message || e) as string}`);
    return { failed: true };
  }
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.log("SKIP: DATABASE_URL not set");
    process.exit(0);
  }

  console.log(`[pbv2-db-check] DATABASE_URL: ${redactDatabaseUrl(databaseUrl)}`);

  const client = new Client({ connectionString: databaseUrl });
  await client.connect();

  let failed = false;

  const must = async (name: string, fn: () => Promise<CheckResult>) => {
    const res = await checkOne(name, fn);
    failed = failed || res.failed;
  };

  const warn = async (name: string, fn: () => Promise<CheckResult>) => {
    try {
      const res = await fn();
      if (res.ok) {
        console.log(`PASS: ${name}`);
      } else {
        console.log(`WARN: ${name} - ${res.message}`);
      }
    } catch (e: any) {
      console.log(`WARN: ${name} - ${(e?.message || e) as string}`);
    }
  };

  await must("pbv2_tree_versions table exists", async () => {
    const r = await client.query(
      `SELECT 1
       FROM information_schema.tables
       WHERE table_schema = 'public'
         AND table_name = 'pbv2_tree_versions'
       LIMIT 1`
    );
    return r.rowCount === 1 ? pass() : fail("missing public.pbv2_tree_versions");
  });

  await must("pbv2_tree_version_status enum exists", async () => {
    const r = await client.query(
      `SELECT 1
       FROM pg_type t
       JOIN pg_namespace n ON n.oid = t.typnamespace
       WHERE n.nspname = 'public'
         AND t.typname = 'pbv2_tree_version_status'
       LIMIT 1`
    );
    return r.rowCount === 1 ? pass() : fail("missing public type pbv2_tree_version_status");
  });

  await must("pbv2_tree_versions.status uses pbv2_tree_version_status", async () => {
    const r = await client.query(
      `SELECT udt_name
       FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = 'pbv2_tree_versions'
         AND column_name = 'status'
       LIMIT 1`
    );

    if (r.rowCount !== 1) return fail("missing pbv2_tree_versions.status column");
    const udtName = String(r.rows[0]?.udt_name ?? "");
    return udtName === "pbv2_tree_version_status"
      ? pass()
      : fail(`expected udt_name=pbv2_tree_version_status, got ${udtName || "<empty>"}`);
  });

  await must("products.pbv2_active_tree_version_id column exists", async () => {
    const r = await client.query(
      `SELECT 1
       FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = 'products'
         AND column_name = 'pbv2_active_tree_version_id'
       LIMIT 1`
    );
    return r.rowCount === 1 ? pass() : fail("missing products.pbv2_active_tree_version_id");
  });

  await must("FK products.pbv2_active_tree_version_id -> pbv2_tree_versions(id) exists", async () => {
    const r = await client.query(
      `SELECT 1
       FROM pg_constraint c
       JOIN pg_class rel ON rel.oid = c.conrelid
       JOIN pg_namespace n ON n.oid = rel.relnamespace
       JOIN pg_class ref ON ref.oid = c.confrelid
       WHERE c.contype = 'f'
         AND n.nspname = 'public'
         AND rel.relname = 'products'
         AND ref.relname = 'pbv2_tree_versions'
         AND c.conname = 'products_pbv2_active_tree_version_id_fkey'
       LIMIT 1`
    );

    return r.rowCount === 1
      ? pass()
      : fail("missing FK constraint products_pbv2_active_tree_version_id_fkey");
  });

  await warn("index pbv2_tree_versions_org_product_status_idx exists", async () => {
    const r = await client.query(
      `SELECT 1
       FROM pg_indexes
       WHERE schemaname = 'public'
         AND tablename = 'pbv2_tree_versions'
         AND indexname = 'pbv2_tree_versions_org_product_status_idx'
       LIMIT 1`
    );
    return r.rowCount === 1 ? pass() : fail("missing index pbv2_tree_versions_org_product_status_idx");
  });

  await warn("__drizzle_migrations contains 0022_pbv2_tree_versions", async () => {
    try {
      const r = await client.query(
        `SELECT id, COUNT(*)::int as count
         FROM __drizzle_migrations
         WHERE id = '0022_pbv2_tree_versions'
         GROUP BY id`
      );

      if (r.rowCount === 0) return fail("migration id not present");
      const count = Number(r.rows[0]?.count ?? 0);
      if (count > 1) return fail(`duplicate rows found (${count})`);
      return pass();
    } catch (e: any) {
      return fail(`unable to query __drizzle_migrations (${e?.message || e})`);
    }
  });

  await client.end();

  if (failed) {
    console.log("[pbv2-db-check] FAIL");
    process.exit(1);
  }

  console.log("[pbv2-db-check] OK");
  process.exit(0);
}

main().catch((e) => {
  console.error("[pbv2-db-check] Fatal:", e);
  process.exit(1);
});
