import { beforeEach, expect, jest, test } from '@jest/globals';
import { getTableName } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { OptionTreeV2 } from '@shared/optionTreeV2';

const dialect = new PgDialect();
const reads: Array<{ table: string; params: unknown[]; sql: string }> = [];
let rows: any[] = [];
let customer: any;
let portalUserId: string | null = 'portal-user';
const priceLineItem = jest.fn(async (_input: any) => ({ lineTotalCents: 10500 }));
const db: any = {
  select: () => {
    let table = '';
    const query: any = {
      from: (source: any) => { table = getTableName(source); return query; },
      innerJoin: () => query,
      where: (predicate: any) => {
        const compiled = dialect.sqlToQuery(predicate);
        reads.push({ table, params: compiled.params, sql: compiled.sql });
        return query;
      },
      orderBy: () => query,
      limit: (count: number) => count === 1 ? Promise.resolve(rows) : query,
      offset: async () => rows,
    };
    return query;
  },
  selectDistinct: () => {
    let table = '';
    const query: any = {
      from: (source: any) => { table = getTableName(source); return query; },
      innerJoin: () => query,
      where: (predicate: any) => {
        const compiled = dialect.sqlToQuery(predicate);
        reads.push({ table, params: compiled.params, sql: compiled.sql });
        return query;
      },
      orderBy: async () => [{ category: 'Signs' }],
    };
    return query;
  },
};
class PortalAccessError extends Error {
  constructor(public statusCode: number, message: string) { super(message); }
}
jest.unstable_mockModule('../db', () => ({ db }));
jest.unstable_mockModule('../services/pricing/PricingService', () => ({ priceLineItem }));
jest.unstable_mockModule('../services/portal.service', () => ({
  PortalAccessError,
  getPortalScope: () => ({ userId: portalUserId, organizationId: 'org-a', customerId: 'customer-a', customer }),
}));
const { mayShowStorefrontProduct, projectStorefrontOptions, listPortalStorefrontProducts, getPortalStorefrontProduct, previewPortalStorefrontPrice } = await import('../services/portalStorefront.service');

const tree: OptionTreeV2 = {
  schemaVersion: 2, rootNodeIds: ['root'],
  nodes: {
    root: { id: 'root', kind: 'group', label: 'Options' },
    sides: { id: 'sides', kind: 'question', label: 'Print Sides', input: { type: 'select', selectionKey: 'sides', required: true, defaultValue: 'single' }, choices: [
      { value: 'single', label: 'Single-Sided' }, { value: 'double', label: 'Double-Sided', priceDeltaCents: 500 },
    ] },
    grommets: { id: 'grommets', kind: 'question', label: 'Grommets', ui: { helpText: 'Choose a location.' }, input: { type: 'select', selectionKey: 'grommets', defaultValue: 'none' }, choices: [
      { value: 'none', label: 'None' }, { value: 'top', label: 'Top 2 Corners', priceDeltaCents: 50 },
    ], visibility: { rules: [{ type: 'equals', selectionKey: 'sides', value: 'double' }] } },
    internal: { id: 'internal', kind: 'computed', label: 'Material cost', pricingImpact: [{ mode: 'addFlat', amountCents: 12345 }] },
  },
  edges: [{ fromNodeId: 'root', toNodeId: 'sides' }, { fromNodeId: 'root', toNodeId: 'grommets' }, { fromNodeId: 'root', toNodeId: 'internal' }],
};

function product(overrides: Record<string, unknown> = {}) {
  return {
    id: 'product-a', name: 'Yard Sign', description: 'A printed sign', category: 'Signs', thumbnailUrls: ['https://example.com/sign.png'],
    measurementMode: 'dimensions_required', pricingProfileConfig: null, pbv2ActiveTreeVersionId: 'tree-a',
    isActive: true, storefrontVisible: true, activeTreeStatus: 'ACTIVE', treeJson: tree,
    ...overrides,
  };
}

beforeEach(() => {
  rows = [product()];
  reads.length = 0;
  customer = { pricingTier: 'default', productVisibilityMode: 'default' };
  portalUserId = 'portal-user';
  priceLineItem.mockClear();
});

test('catalog visibility is explicit, active, published, and excludes editor overrides', () => {
  expect(mayShowStorefrontProduct(product())).toBe(true);
  for (const patch of [
    { storefrontVisible: false }, { isActive: false }, { activeTreeStatus: 'DRAFT' },
    { pbv2ActiveTreeVersionId: null }, { pricingProfileConfig: { pbv2Override: { enabled: true, versionId: 'draft-tree' } } },
  ]) expect(mayShowStorefrontProduct(product(patch))).toBe(false);
});

test('customer-safe DTO omits PBV2 rules, price impacts, and internal nodes', () => {
  const initial = projectStorefrontOptions(tree);
  expect(initial.options.map((option) => option.label)).toEqual(['Print Sides']);
  expect(initial.effectiveSelections).toEqual({ option_1: 'single' });
  const expanded = projectStorefrontOptions(tree, { sides: 'double' });
  expect(expanded.options.map((option) => option.label)).toEqual(['Print Sides', 'Grommets']);
  expect(expanded.options[1].helpText).toBe('Choose a location.');
  expect(JSON.stringify(expanded.options)).not.toMatch(/priceDeltaCents|pricingImpact|Material cost|treeJson/);
});

test('catalog thumbnails accept only safe same-origin objects or HTTPS URLs', async () => {
  rows = [product({ thumbnailUrls: ['/objects/uploads/sign.png'] })];
  expect((await listPortalStorefrontProducts({ query: {} } as any)).items[0].imageUrl).toBe('/objects/uploads/sign.png');
  rows = [product({ thumbnailUrls: ['/objects/../api/admin', 'javascript:alert(1)'] })];
  expect((await listPortalStorefrontProducts({ query: {} } as any)).items[0].imageUrl).toBeNull();
});

test('catalog and detail reads are organization-scoped and return only projected fields', async () => {
  const catalog = await listPortalStorefrontProducts({ query: {} } as any);
  expect(catalog.items).toEqual([{ id: 'product-a', name: 'Yard Sign', description: 'A printed sign', category: 'Signs', imageUrl: 'https://example.com/sign.png' }]);
  expect(catalog).toMatchObject({ categories: ['Signs'], hasMore: false, page: 0 });
  expect(reads[0].params).toContain('org-a');
  expect(reads[0].sql).toContain('storefront_visible');
  expect(reads[1].params).toContain('org-a');
  const detail = await getPortalStorefrontProduct({} as any, 'product-a');
  expect(detail?.defaults.selections).toEqual({ option_1: 'single' });
  expect(detail).not.toHaveProperty('treeJson');
  expect(reads[2].params).toContain('org-a');
  expect(reads[2].params).toContain('product-a');
});

test('portal scope is required before catalog reads', async () => {
  portalUserId = null;
  await expect(listPortalStorefrontProducts({ query: {} } as any)).rejects.toMatchObject({ statusCode: 403 });
  expect(reads).toHaveLength(0);
});

test('catalog search and category are tenant-scoped before page limits', async () => {
  rows = Array.from({ length: 101 }, (_, index) => product({ id: `product-${index}` }));
  const result = await listPortalStorefrontProducts({ query: { search: 'yard', category: 'Signs', page: '2' } } as any);
  expect(result.items).toHaveLength(100);
  expect(result.hasMore).toBe(true);
  expect(result.page).toBe(2);
  expect(reads[0].params).toEqual(expect.arrayContaining(['org-a', '%yard%', 'Signs']));
  expect(reads[1].params).toContain('org-a');
});

test('linked-only customers require the matching customer/product relation', async () => {
  customer.productVisibilityMode = 'linked-only';
  await listPortalStorefrontProducts({ query: {} } as any);
  expect(reads.some((read) => read.params.includes('customer-a'))).toBe(true);
  expect(reads.every((read) => read.params.includes('org-a') || read.params.includes('customer-a'))).toBe(true);
});

test('price preview delegates to the same server priceLineItem input as Quote/Order, without writes', async () => {
  const result = await previewPortalStorefrontPrice({ body: { quantity: 100, widthIn: 24, heightIn: 18, selections: { option_1: 'double', option_2: 'top' } } } as any, 'product-a');
  expect(priceLineItem).toHaveBeenCalledWith({ organizationId: 'org-a', productId: 'product-a', quantity: 100, widthIn: 24, heightIn: 18, pbv2ExplicitSelections: { sides: 'double', grommets: 'top' }, pbv2TreeVersionIdOverride: 'tree-a' });
  expect(result?.totalCents).toBe(10500);
  expect(result?.unitPriceCents).toBe(105);
  expect(result).not.toHaveProperty('pbv2SnapshotJson');
});

test('hidden stale child selections are stripped before canonical pricing', async () => {
  await previewPortalStorefrontPrice({ body: { quantity: 1, widthIn: 24, heightIn: 18, selections: { option_1: 'single', option_2: 'top' } } } as any, 'product-a');
  expect(priceLineItem).toHaveBeenCalledWith(expect.objectContaining({ pbv2ExplicitSelections: { sides: 'single' } }));
});

test('newly revealed required options are returned without calculating a premature price', async () => {
  const conditionalTree = structuredClone(tree);
  const grommets = conditionalTree.nodes.grommets;
  if (!grommets || !grommets.input) throw new Error('Missing test option');
  grommets.input.required = true;
  delete grommets.input.defaultValue;
  rows = [product({ treeJson: conditionalTree })];

  const incomplete = await previewPortalStorefrontPrice({ body: { quantity: 100, widthIn: 24, heightIn: 18, selections: { option_1: 'double' } } } as any, 'product-a');
  expect(incomplete).toMatchObject({ priceAvailable: false, unitPriceCents: null, totalCents: null });
  expect(incomplete?.options.map((option) => option.label)).toEqual(['Print Sides', 'Grommets']);
  expect(priceLineItem).not.toHaveBeenCalled();

  const complete = await previewPortalStorefrontPrice({ body: { quantity: 100, widthIn: 24, heightIn: 18, selections: { option_1: 'double', option_2: 'top' } } } as any, 'product-a');
  expect(complete?.priceAvailable).toBe(true);
  expect(priceLineItem).toHaveBeenCalledTimes(1);
});

test('customer modifiers fail closed until canonical Quote/Order PBV2 pricing supports them', async () => {
  customer.defaultDiscountPercent = '10';
  await expect(previewPortalStorefrontPrice({ body: { quantity: 1 } } as any, 'product-a')).rejects.toMatchObject({ statusCode: 422 });
  expect(priceLineItem).not.toHaveBeenCalled();
});
