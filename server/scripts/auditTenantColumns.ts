/**
 * Audit Script: Tenant Column Standardization
 * 
 * Inventories all tables to identify:
 * - Tables with organization_id (standard)
 * - Tables with org_id (legacy)
 * - Tables with neither (need parent join analysis)
 * 
 * Run: npx tsx server/scripts/auditTenantColumns.ts
 */

import { db } from '../db';
import { sql } from 'drizzle-orm';

interface TableColumn {
  table_name: string;
  column_name: string;
  data_type: string;
  is_nullable: string;
}

interface ForeignKey {
  table_name: string;
  column_name: string;
  foreign_table_name: string;
  foreign_column_name: string;
}

async function auditTenantColumns() {
  console.log('='.repeat(80));
  console.log('TENANT COLUMN AUDIT REPORT');
  console.log('='.repeat(80));
  console.log();

  // Query all tables and their org-related columns
  const orgColumnsQuery = sql<TableColumn>`
    SELECT 
      table_name,
      column_name,
      data_type,
      is_nullable
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND (
        column_name = 'organization_id' 
        OR column_name = 'org_id'
        OR column_name = 'organizationId'
      )
    ORDER BY table_name, column_name
  `;

  const orgColumns = await db.execute(orgColumnsQuery);

  // Query all tables
  const allTablesQuery = sql<{ table_name: string }>`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_type = 'BASE TABLE'
      AND table_name NOT LIKE 'pg_%'
      AND table_name NOT LIKE 'sql_%'
    ORDER BY table_name
  `;

  const allTables = await db.execute(allTablesQuery);

  // Query foreign keys
  const fkQuery = sql<ForeignKey>`
    SELECT
      tc.table_name,
      kcu.column_name,
      ccu.table_name AS foreign_table_name,
      ccu.column_name AS foreign_column_name
    FROM information_schema.table_constraints AS tc
    JOIN information_schema.key_column_usage AS kcu
      ON tc.constraint_name = kcu.constraint_name
      AND tc.table_schema = kcu.table_schema
    JOIN information_schema.constraint_column_usage AS ccu
      ON ccu.constraint_name = tc.constraint_name
      AND ccu.table_schema = tc.table_schema
    WHERE tc.constraint_type = 'FOREIGN KEY'
      AND tc.table_schema = 'public'
    ORDER BY tc.table_name
  `;

  const foreignKeys = await db.execute(fkQuery);

  // Organize by category
  const tablesWithOrgId = new Set<string>();
  const tablesWithOrganizationId = new Set<string>();
  const tablesWithBoth = new Set<string>();

  for (const row of orgColumns.rows) {
    const tableName = row.table_name as string;
    if (row.column_name === 'organization_id') {
      tablesWithOrganizationId.add(tableName);
    } else if (row.column_name === 'org_id' || row.column_name === 'organizationId') {
      tablesWithOrgId.add(tableName);
    }
  }

  // Find tables with both
  for (const table of Array.from(tablesWithOrgId)) {
    if (tablesWithOrganizationId.has(table)) {
      tablesWithBoth.add(table);
      tablesWithOrgId.delete(table);
    }
  }

  // Find tables with neither
  const tablesWithNeither = new Set<string>();
  for (const row of allTables.rows) {
    const tableName = row.table_name as string;
    if (
      !tablesWithOrganizationId.has(tableName) &&
      !tablesWithOrgId.has(tableName) &&
      !tablesWithBoth.has(tableName)
    ) {
      tablesWithNeither.add(tableName);
    }
  }

  // Print results
  console.log('📊 CATEGORY 1: Tables with organization_id (STANDARD)');
  console.log('-'.repeat(80));
  if (tablesWithOrganizationId.size === 0) {
    console.log('  (none)');
  } else {
    for (const table of Array.from(tablesWithOrganizationId).sort()) {
      const details = orgColumns.rows.find(
        r => r.table_name === table && r.column_name === 'organization_id'
      );
      console.log(`  ✅ ${table} (${details?.data_type}, nullable: ${details?.is_nullable})`);
    }
  }
  console.log();

  console.log('📊 CATEGORY 2: Tables with org_id/organizationId (LEGACY)');
  console.log('-'.repeat(80));
  if (tablesWithOrgId.size === 0) {
    console.log('  (none)');
  } else {
    for (const table of Array.from(tablesWithOrgId).sort()) {
      const details = orgColumns.rows.find(
        r => r.table_name === table && (r.column_name === 'org_id' || r.column_name === 'organizationId')
      );
      console.log(`  ⚠️  ${table} (${details?.column_name}: ${details?.data_type}, nullable: ${details?.is_nullable})`);
    }
  }
  console.log();

  console.log('📊 CATEGORY 3: Tables with BOTH (IN TRANSITION)');
  console.log('-'.repeat(80));
  if (tablesWithBoth.size === 0) {
    console.log('  (none)');
  } else {
    for (const table of Array.from(tablesWithBoth).sort()) {
      console.log(`  🔄 ${table}`);
    }
  }
  console.log();

  console.log('📊 CATEGORY 4: Tables with NEITHER org column');
  console.log('-'.repeat(80));
  if (tablesWithNeither.size === 0) {
    console.log('  (none)');
  } else {
    for (const table of Array.from(tablesWithNeither).sort()) {
      // Check if this table has FK to a tenant-owned table
      const fks = foreignKeys.rows.filter(fk => fk.table_name === table);
      const parentInfo = fks
        .filter(fk => 
          tablesWithOrganizationId.has(fk.foreign_table_name as string) ||
          tablesWithOrgId.has(fk.foreign_table_name as string) ||
          tablesWithBoth.has(fk.foreign_table_name as string)
        )
        .map(fk => `${fk.foreign_table_name}(${fk.column_name})`)
        .join(', ');

      if (parentInfo) {
        console.log(`  👶 ${table} — child of: ${parentInfo}`);
      } else {
        console.log(`  ❓ ${table} — no clear parent FK`);
      }
    }
  }
  console.log();

  // Summary statistics
  console.log('='.repeat(80));
  console.log('SUMMARY');
  console.log('='.repeat(80));
  console.log(`✅ Standard (organization_id):     ${tablesWithOrganizationId.size} tables`);
  console.log(`⚠️  Legacy (org_id/organizationId): ${tablesWithOrgId.size} tables`);
  console.log(`🔄 In transition (both columns):   ${tablesWithBoth.size} tables`);
  console.log(`👶 Child tables (no org column):   ${tablesWithNeither.size} tables`);
  console.log(`📋 Total tables:                   ${allTables.rows.length} tables`);
  console.log();

  // Action items
  console.log('='.repeat(80));
  console.log('ACTION ITEMS');
  console.log('='.repeat(80));
  
  if (tablesWithOrgId.size > 0) {
    console.log(`\n1️⃣  MIGRATE ${tablesWithOrgId.size} legacy tables:`);
    console.log('   - Add organization_id column');
    console.log('   - Backfill from org_id');
    console.log('   - Update code to use organization_id');
    console.log('   Tables:', Array.from(tablesWithOrgId).sort().join(', '));
  }

  if (tablesWithBoth.size > 0) {
    console.log(`\n2️⃣  COMPLETE ${tablesWithBoth.size} in-transition tables:`);
    console.log('   - Ensure code uses organization_id');
    console.log('   - Plan to remove org_id later');
    console.log('   Tables:', Array.from(tablesWithBoth).sort().join(', '));
  }

  const childTablesNeedingReview = Array.from(tablesWithNeither)
    .filter(table => {
      const fks = foreignKeys.rows.filter(fk => fk.table_name === table);
      return fks.length === 0 || !fks.some(fk =>
        tablesWithOrganizationId.has(fk.foreign_table_name as string) ||
        tablesWithOrgId.has(fk.foreign_table_name as string) ||
        tablesWithBoth.has(fk.foreign_table_name as string)
      );
    });

  if (childTablesNeedingReview.length > 0) {
    console.log(`\n3️⃣  REVIEW ${childTablesNeedingReview.length} tables without clear parent:`);
    console.log('   - Determine if tenant-owned or global');
    console.log('   - Add organization_id if tenant-owned');
    console.log('   Tables:', childTablesNeedingReview.sort().join(', '));
  }

  console.log('\n');
  process.exit(0);
}

// Run audit
auditTenantColumns().catch(error => {
  console.error('Audit failed:', error);
  process.exit(1);
});
