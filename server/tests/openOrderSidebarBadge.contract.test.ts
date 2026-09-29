import { readFileSync } from 'node:fs';

const read = (path: string) => readFileSync(path, 'utf8');

test('one tenant-scoped Order row contributes one badge count through the shared summary', () => {
  const summary = read('server/services/operationalSummary.ts');
  const countQuery = summary.slice(summary.indexOf('openOrdersResult,'), summary.indexOf('.from(inboundOrderRecords)'));
  expect(countQuery).toContain('count(*)::int');
  expect(countQuery).toContain('.from(orders)');
  expect(countQuery).toContain('eq(orders.organizationId, organizationId)');
  expect(countQuery).toContain('inArray(orders.status, [...OPEN_ORDER_BADGE_STATUSES])');
  expect(countQuery).not.toContain('.join(');
  expect(summary).toContain('orders: count(openOrdersResult)');
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
  expect(sidebar).toContain('variant={badgeCount > 0 ? "default" : "secondary"}');
  expect(sidebar).toContain('queryKey: ["/api/operational-summary"]');
  for (const start of ['export function useCreateOrder()', 'export function useCancelOrder(', 'export function useTransitionOrderStatus(']) {
    const section = hooks.slice(hooks.indexOf(start), hooks.indexOf('\nexport function ', hooks.indexOf(start) + 1));
    expect(section).toContain('invalidateQueries({ queryKey: ["/api/operational-summary"] })');
  }
});
