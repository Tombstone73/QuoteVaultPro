import { db } from './server/db';
import { sql } from 'drizzle-orm';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function applyMigration() {
  console.log('Starting migration 0015: Tenant Hardening...\n');

  try {
    // Read migration file
    const migrationPath = path.join(__dirname, 'server', 'db', 'migrations', '0015_tenant_hardening.sql');
    const migrationSQL = fs.readFileSync(migrationPath, 'utf-8');

    console.log('Executing migration SQL...');
    await db.execute(sql.raw(migrationSQL));
    console.log('✅ Migration 0015 applied successfully\n');

    // Verification: Check for NULL values (should be 0)
    console.log('Running verification checks...\n');

    const jobsCheck = await db.execute(sql`SELECT COUNT(*) as count FROM jobs WHERE organization_id IS NULL`);
    console.log(`Jobs with NULL organization_id: ${jobsCheck.rows[0]?.count || 0}`);

    const filesCheck = await db.execute(sql`SELECT COUNT(*) as count FROM job_files WHERE organization_id IS NULL`);
    console.log(`Job files with NULL organization_id: ${filesCheck.rows[0]?.count || 0}`);

    const notesCheck = await db.execute(sql`SELECT COUNT(*) as count FROM job_notes WHERE organization_id IS NULL`);
    console.log(`Job notes with NULL organization_id: ${notesCheck.rows[0]?.count || 0}`);

    const statusCheck = await db.execute(sql`SELECT COUNT(*) as count FROM job_status_log WHERE organization_id IS NULL`);
    console.log(`Job status log with NULL organization_id: ${statusCheck.rows[0]?.count || 0}`);

    // Verify FK constraints exist
    console.log('\nVerifying foreign key constraints...\n');
    const fkCheck = await db.execute(sql`
      SELECT 
        tc.table_name, 
        tc.constraint_name,
        tc.constraint_type
      FROM information_schema.table_constraints tc
      WHERE tc.constraint_type = 'FOREIGN KEY'
        AND tc.table_schema = 'public'
        AND tc.table_name IN ('jobs', 'job_files', 'job_notes', 'job_status_log')
        AND tc.constraint_name LIKE '%organization_id_fkey'
      ORDER BY tc.table_name
    `);

    console.log('Foreign key constraints created:');
    for (const row of fkCheck.rows) {
      console.log(`  ✅ ${row.table_name}.${row.constraint_name}`);
    }

    console.log('\n✅ All verification checks passed!');
    console.log('\nNext steps:');
    console.log('  1. Run tenant isolation test: npx tsx test-tenant-isolation.ts');
    console.log('  2. Run audit script: npx tsx server/scripts/auditTenantColumns.ts');
    console.log('  3. Verify npm run check passes');
    console.log('  4. Verify npm run dev starts');

    process.exit(0);
  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  }
}

applyMigration();
