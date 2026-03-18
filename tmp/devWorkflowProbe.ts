import "dotenv/config";
import { sql } from "drizzle-orm";
import { db } from "../server/db";

async function main() {
  const [mode = "all"] = process.argv.slice(2);

  if (mode === "columns" || mode === "all") {
    const columns = await db.execute(sql.raw(`
      select column_name
      from information_schema.columns
      where table_name = 'quote_line_items'
        and column_name in ('requires_design', 'requires_prepress')
      order by column_name
    `));
    console.log("[columns]");
    console.log(JSON.stringify(columns.rows, null, 2));
  }

  if (mode === "ledger" || mode === "all") {
    const ledger = await db.execute(sql.raw(`
      select id, hash, created_at
      from public.__drizzle_migrations_v2
      order by id desc
      limit 5
    `));
    console.log("[ledger]");
    console.log(JSON.stringify(ledger.rows, null, 2));
  }

  if (mode === "users" || mode === "all") {
    const users = await db.execute(sql.raw(`
      select
        u.id,
        u.email,
        u.role,
        u.is_admin as "isAdmin",
        uo.organization_id as "organizationId"
      from users u
      left join user_organizations uo on uo.user_id = u.id
      order by u.created_at desc nulls last
      limit 20
    `));
    console.log("[users]");
    console.log(JSON.stringify(users.rows, null, 2));
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});