/**
 * Apply Migration 0014: Standardize organization_id
 * 
 * Run: npx tsx apply-migration-0014.ts
 */

import { db } from './server/db';
import { sql } from 'drizzle-orm';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function applyMigration() {
  console.log('🔧 Applying Migration 0014: Standardize organization_id');
  console.log('='.repeat(80));

  try {
    // Read migration file
    const migrationPath = path.join(__dirname, 'server', 'db', 'migrations', '0014_standardize_organization_id.sql');
    const migrationSQL = fs.readFileSync(migrationPath, 'utf-8');

    console.log('\n📂 Migration file loaded:', migrationPath);
    console.log('\n🚀 Executing migration...\n');

    // Execute migration
    await db.execute(sql.raw(migrationSQL));

    console.log('✅ Migration 0014 applied successfully!');
    console.log('\n📊 Running verification queries...\n');

    // Verification queries
    const checks = [
      { table: 'jobs', query: sql`SELECT COUNT(*) as count FROM jobs WHERE organization_id IS NULL` },
      { table: 'job_files', query: sql`SELECT COUNT(*) as count FROM job_files WHERE organization_id IS NULL` },
      { table: 'job_notes', query: sql`SELECT COUNT(*) as count FROM job_notes WHERE organization_id IS NULL` },
      { table: 'job_status_log', query: sql`SELECT COUNT(*) as count FROM job_status_log WHERE organization_id IS NULL` },
    ];

    for (const check of checks) {
      const result = await db.execute(check.query);
      const count = result.rows[0]?.count || 0;
      
      if (count === 0) {
        console.log(`  ✅ ${check.table}: All records have organization_id (${count} nulls)`);
      } else {
        console.log(`  ⚠️  ${check.table}: ${count} records missing organization_id`);
      }
    }

    console.log('\n' + '='.repeat(80));
    console.log('✅ Migration 0014 complete');
    console.log('\n📋 Next steps:');
    console.log('   1. Update Drizzle schemas in shared/schema.ts');
    console.log('   2. Update repositories to use organization_id');
    console.log('   3. Test tenant isolation with audit script');
    console.log('   4. Run: npm run check (verify TypeScript)');
    console.log('   5. Run: npm run dev (test server startup)');

  } catch (error) {
    console.error('\n❌ Migration failed:', error);
    console.error('\n🔄 Rolling back...');
    // Rollback is automatic due to transaction in migration file
    process.exit(1);
  }

  process.exit(0);
}

applyMigration();
