import { readFileSync } from 'node:fs';

const read = (path: string) => readFileSync(path, 'utf8');

test('one tenant-scoped Order row contributes one badge count through the shared Open bucket', () => {
  const summary = read('server/services/operationalSummary.ts');
  const repository = read('server/storage/orders.repo.ts');
  const bucket = read('server/services/orderListBuckets.ts');
  const countQuery = summary.slice(summary.indexOf('openOrdersResult,'), summary.indexOf('.from(inboundOrderRecords)'));
  expect(countQuery).toContain('count(*)::int');
  expect(countQuery).toContain('.from(orders)');
  expect(countQuery).toContain('eq(orders.organizationId, organizationId)');
  expect(countQuery).toContain('canonicalOpenOrderBucketPredicate(organizationId)');
  expect(countQuery).not.toContain('.join(');
  expect(summary).toContain('orders: count(openOrdersResult)');
  expect(repository).toContain('if (opts.state === "open")');
  expect(repository).toContain('canonicalOpenOrderBucketPredicate(organizationId)');
  expect(bucket).toContain("eq(orders.state, CANONICAL_OPEN_ORDER_STATE)");
  expect(bucket).toContain("lower(trim(coalesce(${orders.statusPillValue}, ''))) <> 'complete'");
  expect(bucket).toContain('lower(${orderStatusPills.key}) = ${COMPLETE_ORDER_STATUS_PILL_KEY}');
  const route = read('server/routes/operationalSummary.routes.ts');
  expect(route).toContain('isAuthenticated, tenantContext');
  expect(route).toContain('computeOperationalSummary(organizationId)');
});

test('Orders uses the existing badge and refreshes after create, cancel, and status transition', () => {
  const nav = read('client/src/lib/titanNavigation.ts');
  const sidebar = read('client/src/components/layout/TitanSidebarNav.tsx');
  const hooks = read('client/src/hooks/useOrders.ts');
  expect(nav).toContain('id: "orders", name: "Orders", icon: ShoppingCart, path: ROUTES.orders.list, badge: true');
  expect(sidebar).toContain('orders: safeSummary.orders ?? 0');
  const ordersPage = read('client/src/pages/orders.tsx');
  expect(ordersPage).toContain('queryKey: ["/api/operational-summary"]');
  expect(ordersPage).toContain('apiFetch("/api/operational-summary"');
  expect(ordersPage).toContain('{canonicalOpenCount}');
  expect(sidebar).toContain('variant={badgeCount > 0 ? "default" : "secondary"}');
  expect(sidebar).toContain('queryKey: ["/api/operational-summary"]');
  for (const start of ['export function useCreateOrder()', 'export function useCancelOrder(', 'export function useTransitionOrderStatus(']) {
    const section = hooks.slice(hooks.indexOf(start), hooks.indexOf('\nexport function ', hooks.indexOf(start) + 1));
    expect(section).toContain('invalidateQueries({ queryKey: ["/api/operational-summary"] })');
  }
});

test('Open tab count is independent from temporary list filters and pagination', () => {
  const ordersPage = read('client/src/pages/orders.tsx');
  const queryStart = ordersPage.indexOf('const canonicalOpenCountQuery = useQuery(');
  const queryEnd = ordersPage.indexOf('// Pagination + performance controls', queryStart);
  const countQuery = ordersPage.slice(queryStart, queryEnd);
  expect(countQuery).toContain('queryKey: ["/api/operational-summary"]');
  for (const temporaryListInput of ['debouncedSearch', 'priorityFilter', 'page', 'pageSize', 'sortKey', 'sortDirection']) {
    expect(countQuery).not.toContain(temporaryListInput);
  }
  const openTab = ordersPage.slice(ordersPage.indexOf('<TabsTrigger value="open">'), ordersPage.indexOf('<TabsTrigger value="production_complete">'));
  expect(openTab).toContain('{canonicalOpenCount}');
  expect(openTab).not.toContain('filteredOrders.length');
});
