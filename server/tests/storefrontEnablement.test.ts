import { beforeEach, expect, jest, test } from '@jest/globals';
import { PgDialect } from 'drizzle-orm/pg-core';

const dialect = new PgDialect();
const predicates: Array<{ sql: string; params: unknown[] }> = [];
const activeRows = [
  { id: 'a', storefrontVisible: false, activeTreeStatus: 'ACTIVE', pricingProfileConfig: null },
  { id: 'b', storefrontVisible: true, activeTreeStatus: null, pricingProfileConfig: null },
  { id: 'c', storefrontVisible: false, activeTreeStatus: 'DRAFT', pricingProfileConfig: { pbv2Override: { enabled: true } } },
];
let rows = activeRows.map((row) => ({ ...row }));
let audit: any;
let locked = false;

const db: any = {
  select: () => {
    const query: any = {
      from: () => query,
      leftJoin: () => query,
      where: (predicate: any) => {
        predicates.push(dialect.sqlToQuery(predicate));
        return query;
      },
      for: () => { locked = true; return query; },
      then: (resolve: any, reject: any) => Promise.resolve(rows).then(resolve, reject),
    };
    return query;
  },
  update: () => ({ set: (values: any) => ({ where: (predicate: any) => {
    expect(values).toEqual({ storefrontVisible: true });
    predicates.push(dialect.sqlToQuery(predicate));
    return { returning: async () => {
      const changed = rows.filter((row) => !row.storefrontVisible).map((row) => ({ id: row.id }));
      rows = rows.map((row) => ({ ...row, storefrontVisible: true }));
      return changed;
    } };
  } }) }),
  insert: () => ({ values: async (value: any) => { audit = value; } }),
  transaction: async (callback: any) => callback(db),
};

jest.unstable_mockModule('../db', () => ({ db }));
const { previewStorefrontEnablement, enableAllActiveStorefrontProducts, withNewProductStorefrontDefault } = await import('../services/products/storefrontEnablement');

beforeEach(() => {
  rows = activeRows.map((row) => ({ ...row }));
  predicates.length = 0;
  audit = null;
  locked = false;
});

test('preview is tenant scoped and counts active pricing readiness separately from visibility', async () => {
  expect(await previewStorefrontEnablement('org-a')).toEqual({ totalActive: 3, alreadyEnabled: 1, needingEnablement: 2, withoutPublishedPricing: 2, usingPricingOverrides: 1 });
  expect(predicates[0].params).toContain('org-a');
  expect(predicates[0].sql).toContain('is_active');
  expect(predicates[0].sql).toContain('organization_id');
  expect(audit).toBeNull();
});

test('new active products default visible while explicit hide and inactive state are preserved', () => {
  expect(withNewProductStorefrontDefault({ isActive: true }, false).storefrontVisible).toBe(true);
  expect(withNewProductStorefrontDefault({ isActive: false }, false).storefrontVisible).toBe(false);
  expect(withNewProductStorefrontDefault({ isActive: true, storefrontVisible: false }, true).storefrontVisible).toBe(false);
});

test('confirmed apply locks active rows, updates visibility only, audits, and is idempotent', async () => {
  const first = await enableAllActiveStorefrontProducts('org-a', 'owner-a');
  expect(first).toMatchObject({ updated: 2, skipped: 1, withoutPublishedPricing: 2, usingPricingOverrides: 1 });
  expect(locked).toBe(true);
  expect(predicates[1].sql).toContain('is_active');
  expect(predicates[1].sql).toContain('storefront_visible');
  expect(predicates[1].params).toContain('org-a');
  expect(audit).toMatchObject({ organizationId: 'org-a', userId: 'owner-a', actionType: 'UPDATE', newValues: first });
  const second = await enableAllActiveStorefrontProducts('org-a', 'owner-a');
  expect(second).toMatchObject({ updated: 0, skipped: 3 });
});

test('an inconsistent update fails before writing an audit success record', async () => {
  const originalUpdate = db.update;
  db.update = () => ({ set: () => ({ where: () => ({ returning: async () => [] }) }) });
  try {
    await expect(enableAllActiveStorefrontProducts('org-a', 'owner-a')).rejects.toThrow('changed during update');
    expect(audit).toBeNull();
  } finally {
    db.update = originalUpdate;
  }
});
