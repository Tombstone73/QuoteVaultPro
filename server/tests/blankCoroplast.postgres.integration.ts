import { afterAll, beforeAll, expect, jest, test } from '@jest/globals';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from '@shared/schema';
import { makeCoroplastGoldenTree } from '../services/pricing/tests/fixtures/pbv2GoldenPricing.fixtures';
import { requireSafeTestDatabaseUrl } from './helpers/safeTestDatabase';

// setupLocalPostgres has already checked the dedicated loopback TEST_DATABASE_URL
// before assigning it to DATABASE_URL for the application's canonical services.
const url = requireSafeTestDatabaseUrl({ TEST_DATABASE_URL: process.env.TEST_DATABASE_URL });
const pool = new Pool({ connectionString: url });
const db = drizzle({ client: pool, schema });
jest.unstable_mockModule('../db', () => ({ db, pool, hasPageCountStatusColumn: () => true,
  hasQuoteAttachmentPagesTable: () => true, probeDatabaseSchema: async () => {} }));

const organizationId = randomUUID();
const otherOrganizationId = randomUUID();
const userId = randomUUID();
const productId = randomUUID();
const treeId = randomUUID();
let operation: typeof import('../services/products/canonicalBlankCoroplastOperations').canonicalBlankCoroplastOperations;
const pricing = { unit: 'per_square_foot' as const, rateCents: 200, minimumChargeCents: 2500 };

beforeAll(async () => {
  const identity = await pool.query("select current_database() as name, host(inet_server_addr()) as host, to_regclass('public.pbv2_tree_versions')::text as versions");
  expect(identity.rows[0]).toEqual({ name: new URL(url).pathname.slice(1), host: '127.0.0.1', versions: 'pbv2_tree_versions' });
  operation = (await import('../services/products/canonicalBlankCoroplastOperations')).canonicalBlankCoroplastOperations;
  await pool.query("insert into organizations (id, name, slug) values ($1, 'Blank Coroplast QA', $2)", [organizationId, `blank-coroplast-test-${organizationId}`]);
  await pool.query('insert into users (id) values ($1)', [userId]);
  await pool.query(`insert into products (id, organization_id, name, description, is_active, storefront_visible, portal_orderable, updated_at)
    values ($1, $2, '4mm Coroplast Synthetic', 'Disposable pricing fixture', true, true, true, $3)`, [productId, organizationId, new Date()]);
  const treeJson = makeCoroplastGoldenTree();
  (treeJson.nodes.rate as { input: Record<string, unknown> }).input.valueType = 'ENUM';
  await pool.query(`insert into pbv2_tree_versions (id, organization_id, product_id, status, schema_version, tree_json)
    values ($1, $2, $3, 'ACTIVE', 2, $4::jsonb)`, [treeId, organizationId, productId, JSON.stringify(treeJson)]);
  await pool.query('update products set pbv2_active_tree_version_id = $1 where id = $2', [treeId, productId]);
});

afterAll(async () => {
  try { await pool.query('delete from organizations where id = $1', [organizationId]);
    await pool.query('delete from users where id = $1', [userId]); }
  finally { await pool.end(); }
});

test('tenant-scoped proposal, stale protection, canonical save and persisted readback', async () => {
  await expect(operation.propose({ organizationId: otherOrganizationId, productId, pricing })).rejects.toMatchObject({ code: 'PRODUCT_UNAVAILABLE' });
  const proposal = await operation.propose({ organizationId, productId, pricing });
  expect(proposal.before).toBeNull();
  expect(proposal.examples[0].totalCents).toBe(2500);
  await expect(operation.execute({ organizationId, productId, actorUserId: userId, pricing,
    expectedFingerprint: '0'.repeat(64), operationId: randomUUID() })).rejects.toMatchObject({ code: 'PRODUCT_STALE' });
  const operationId = randomUUID();
  const attempts = await Promise.allSettled([1, 2].map(() => operation.execute({ organizationId, productId,
    actorUserId: userId, pricing, expectedFingerprint: proposal.fingerprint, operationId })));
  expect(attempts.filter((attempt) => attempt.status === 'fulfilled')).toHaveLength(1);
  expect(attempts.filter((attempt) => attempt.status === 'rejected')).toHaveLength(1);
  const saved = (attempts.find((attempt) => attempt.status === 'fulfilled') as PromiseFulfilledResult<Awaited<ReturnType<typeof operation.execute>>>).value;
  expect(saved.resultingActiveTreeVersionId).not.toBe(treeId);
  const readback = await pool.query(`select p.pbv2_active_tree_version_id as active_id, v.tree_json as tree,
    (select count(*)::int from audit_logs where organization_id = $1 and entity_id = $2) as audit_count
    from products p join pbv2_tree_versions v on v.id = p.pbv2_active_tree_version_id where p.id = $2`, [organizationId, productId]);
  expect(readback.rows[0].active_id).toBe(saved.resultingActiveTreeVersionId);
  expect(readback.rows[0].tree.meta.blankCoroplastPricing).toMatchObject(pricing);
  expect(readback.rows[0].audit_count).toBe(1);
  const versions = await pool.query(`select status, count(*)::int as n from pbv2_tree_versions
    where organization_id = $1 and product_id = $2 group by status`, [organizationId, productId]);
  expect(Object.fromEntries(versions.rows.map((row) => [row.status, row.n]))).toEqual({ ACTIVE: 1, DEPRECATED: 1 });
  await expect(operation.execute({ organizationId, productId, actorUserId: userId, pricing,
    expectedFingerprint: proposal.fingerprint, operationId: randomUUID() })).rejects.toMatchObject({ code: 'PRODUCT_STALE' });
});
