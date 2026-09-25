import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const job = (id, station, optional = false) => ({
  id, kind: 'production_job', lineItemId: `line-${id}`, view: station, stationKey: station, stepKey: 'print',
  status: 'queued', startedAt: null, completedAt: null, totalSeconds: 0,
  timer: { isRunning: false, runningSince: null, currentSeconds: 0 }, reprintCount: 0,
  jobDescription: `Active ${id}`, qty: 1, artwork: [], notes: [], productionFiles: [], productionAlerts: [],
  assignedPrinterName: optional ? null : 'Fixture printer',
  order: { id: `order-${id}`, customerId: optional ? null : 'customer', customerName: optional ? null : 'Fixture customer',
    orderNumber: id, dueDate: null, priority: 'normal', lineItems: { count: 1, totalQuantity: 1,
      primary: { id: `line-${id}`, description: `Active ${id}`, quantity: 1, materialName: null, productType: null }, items: [] } },
  createdAt: '2026-09-24T00:00:00Z', updatedAt: '2026-09-24T00:00:00Z',
});
export const jobs = [job('F100', 'flatbed', true), job('F101', 'flatbed'), job('R100', 'roll')];
export const run = {
  kind: 'production_run', id: 'run-1', displayNumber: 'RUN-100', orderId: null, orderNumber: null, customerId: null, customerName: null,
  stationKey: 'flatbed', status: 'queued', runStatus: 'ready_for_production', lifecycleState: 'ready', productionFileStrategy: 'rip_managed',
  nextAction: 'Assign machine and start run', startedAt: null, memberCount: 1, totalAllocatedQuantity: 1, files: [], fileCount: 0,
  members: [{ id: 'member', productionJobId: 'member-job', orderLineItemId: 'member-line', orderId: 'member-order',
    orderNumber: 'F102', customerName: null, description: 'Grouped sign', allocatedQuantity: 1, orderedQuantity: 1,
    completedQuantity: 0, successfulQuantity: 0, damagedQuantity: 0, remainingQuantity: 1, outcomeStatus: 'pending', outcomeSegments: [] }],
};
export async function startFixture(port = 4179) {
  const server = await createServer({ configFile: false, root, envFile: false, plugins: [react(), {
    name: 'local-station-api-fixtures', configureServer(server) { server.middlewares.use(async (req, res, next) => {
      const url = new URL(req.url, 'http://localhost'); const pathname = url.pathname;
      if (pathname.startsWith('/api/')) {
        if (req.method !== 'GET') { res.statusCode = 405; res.end('Read-only test fixture'); return; }
        let body = { success: true, data: [] };
        if (pathname === '/api/auth/session') body = { authenticated: true, user: { id: 'fixture-user', role: 'admin' } };
        else if (pathname === '/api/me/orgs') body = { success: true, data: { orgs: [{ id: 'fixture', name: 'Fixture', role: 'admin' }], lastActiveOrgId: 'fixture' } };
        else if (pathname === '/api/organization/preferences') body = {};
        else if (pathname === '/api/inbound-orders/email-settings') body = { success: true, data: {} };
        else if (pathname === '/api/production/config') body.data = { enabledViews: ['flatbed', 'roll'], defaultView: 'flatbed' };
        else if (pathname === '/api/operational-summary') body.data = { flatbed: 3, roll: 1, invoices: {} };
        else if (pathname === '/api/production/jobs') {
          const station = url.searchParams.get('view') || url.searchParams.get('station');
          const search = (url.searchParams.get('search') || '').toLowerCase();
          body.data = jobs.filter(j => j.stationKey === station && JSON.stringify(j).toLowerCase().includes(search));
          body.stationIssues = search === 'diagnostic' ? [{ jobId: 'bad-job', reason: 'Conflicting active production owners' }] : [];
        } else if (/^\/api\/production\/runs\/[^/]+\/files$/.test(pathname)) body.data = { files: [], activeCount: 0, replacementRequired: false };
        else if (pathname === '/api/production/runs') body.data = url.searchParams.get('station') === 'flatbed' ? [run] : [];
        else if (pathname.startsWith('/api/production/jobs/') && !pathname.endsWith('recently-completed')) body.data = jobs.find(j => pathname.endsWith(j.id)) ?? job('member-job', 'flatbed');
        res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(body)); return;
      }
      if (pathname === '/' || pathname.startsWith('/production/')) {
        res.setHeader('Content-Type', 'text/html');
        res.end(await server.transformIndexHtml(req.url, '<html><head><title>Local station fixture</title></head><body><div id="root"></div><script type="module" src="/e2e/local-production-station/fixture.tsx"></script></body></html>')); return;
      }
      next();
    }); },
  }], resolve: { alias: { '@': path.join(root, 'client/src'), '@shared': path.join(root, 'shared'), '@assets': path.join(root, 'attached_assets') } },
  define: { 'import.meta.env.VITE_API_BASE_URL': JSON.stringify(''), 'import.meta.env.VITE_OBJECTS_BASE_URL': JSON.stringify('') },
  server: { host: '127.0.0.1', port, strictPort: true },
  });
  await server.listen(); return server;
}
if (process.argv[1] === fileURLToPath(import.meta.url)) { await startFixture(); console.log('Local mocked station fixture: http://127.0.0.1:4179/production/flatbed'); }
