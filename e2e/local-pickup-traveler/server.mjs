// Synthetic local workflow only: in-memory endpoints, no database or printer.
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const handoffs = [], events = [], jobs = [];
const scenarios = { full: [[250, 0, 250]], first: [[500, 0, 250]], second: [[500, 250, 150]], final: [[500, 400, 100]],
  none: [[500, 250, 150]], one: [[500, 250, 150]], two: [[500, 250, 150]], completed: [[500, 250, 150]], reversed: [[500, 250, 150]], multi: [[500, 150, 250], [50, 0, 50]] };
const server = await createServer({ configFile: false, envFile: false, root,
  plugins: [react(), { name: 'pickup-traveler-fixtures', configureServer(server) {
    server.middlewares.use(async (req, res, next) => {
      const url = new URL(req.url, 'http://localhost');
      if (url.pathname.startsWith('/api/')) {
        const helper = await server.ssrLoadModule('/shared/pickupTravelerProgress.ts');
        const { resolveFulfillmentLineQuantity } = await server.ssrLoadModule('/shared/fulfillmentReadiness.ts');
        const { terminalReversalQuantitiesByLine, netTerminalFulfillmentQuantity } = await server.ssrLoadModule('/shared/fulfillmentTerminalReversal.ts');
        const send = (data, status = 200) => { res.statusCode = status; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ success: status < 400, data })); };
        const production = () => resolveFulfillmentLineQuantity({ orderedQuantity: 500,
          pickedUpQuantity: netTerminalFulfillmentQuantity(handoffs.reduce((sum, h) => sum + h.items.reduce((n, i) => n + i.quantity, 0), 0), terminalReversalQuantitiesByLine(events, ['line-0']).pickup.get('line-0') ?? 0) });
        function documentFor(quantities, box = null, pickupStatus) {
          const canonical = quantities.map(([orderedQuantity, pickedUpQuantity], i) => ({ id: `line-${i}`, production: resolveFulfillmentLineQuantity({ orderedQuantity, pickedUpQuantity }) }));
          const lineQuantities = quantities.map(([, , quantity], i) => ({ orderLineItemId: `line-${i}`, quantity }));
          const progressSnapshot = helper.buildPickupTravelerProgressSnapshot(canonical, lineQuantities, '2026-09-25T12:00:00Z');
          return { orderId: 'fixture-20538', orderNumber: '20538', customerName: 'Local fixture customer', jobLabel: 'Coroplast pickup', poNumber: 'FIXTURE', contactName: 'Fixture contact',
            pickupStatus, pickupPrintContext: { fulfillmentMode: 'pickup', boxCount: 1, box, lineQuantities, progressSnapshot },
            lineItems: progressSnapshot.lines.map((pickupProgress, i) => ({ orderLineItemId: `line-${i}`, description: i ? 'Wire stakes' : 'Coroplast',
              size: i ? '10.00 × 30.00' : '24.00 × 20.00', material: i ? 'Steel wire' : 'Coroplast - 4mm', quantity: lineQuantities[i].quantity, pickupProgress })) };
        }
        const history = () => jobs.filter(j => !j.reprintOf).map(j => ({ id: j.id, createdAt: '2026-09-25T12:00:00Z', pickupHandoffId: j.handoffId ?? null,
          box: j.source.pickupPrintContext.box, lines: j.source.lineItems.map(l => ({ orderLineItemId: l.orderLineItemId, quantity: l.quantity, description: l.description })) }));
        if (req.method === 'GET' && url.pathname === '/api/direct-print/traveler-destinations') return send([{ id: 'fixture-printer', displayName: 'Fixture thermal printer', isDefault: true, available: true }]);
        if (req.method === 'GET' && url.pathname === '/api/fulfillment/orders/fixture-20538') {
          const p = production();
          return send({ orderId: 'fixture-20538', orderNumber: '20538', customerName: 'Local fixture customer', customer: { name: 'Local fixture customer' }, fulfillmentType: 'PICKUP',
            ...p, physicalLineCount: 1, itemsRemaining: '', productionJobs: [], shipments: [], events: [], permissions: { canReverseTerminalFulfillment: true },
            pickupTicket: { id: 'fixture-ticket', status: p.remainingQuantity ? 'DRAFT' : 'PICKED_UP' },
            lineItems: [{ id: 'line-0', productName: 'Coroplast', quantity: 500, production: p, artwork: [], optionSummary: [], finishing: { requirements: [] } }],
            pickupTravelers: history(), pickupHandoffs: handoffs.map(h => ({ ...h, ...helper.pickupReversalHistory(h.id, h.items, events) })) });
        }
        if (req.method === 'GET' && url.pathname.endsWith('/traveler')) {
          const id = url.pathname.split('/').at(-2);
          let job = id === 'latest' ? jobs.at(-1) : jobs.find(j => j.id === id);
          if (job) {
            const original = job.reprintOf ? jobs.find(j => j.id === job.reprintOf) : job;
            const h = handoffs.find(h => h.id === original?.handoffId);
            return send({ ...job.source, pickupStatus: h ? helper.pickupReversalHistory(h.id, h.items, events).status : undefined });
          }
          if (scenarios[id]) return send(documentFor(scenarios[id], id === 'one' ? { current: 1, total: 1 } : ['two', 'completed', 'multi'].includes(id) ? { current: 2, total: 3 } : null,
            id === 'completed' ? 'COMPLETED' : id === 'reversed' ? 'REVERSED' : undefined));
          return send(null, 404);
        }
        if (req.method === 'POST') {
          let raw = ''; for await (const chunk of req) raw += chunk; const body = JSON.parse(raw || '{}');
          if (url.pathname.endsWith('/direct-print/pickup-travelers')) {
            const previous = body.reprintJobId ? jobs.find(j => j.id === body.reprintJobId) : null;
            const p = production();
            const source = previous ? structuredClone(previous.source) : documentFor([[500, p.pickedUpQuantity, body.lineQuantities[0].quantity]], helper.pickupTravelerBoxSchema.parse(body));
            const job = { id: `job-${jobs.length + 1}`, source, ...(previous ? { reprintOf: previous.id } : {}) }; jobs.push(job);
            console.log(JSON.stringify({ action: previous ? 'reprint' : 'print', pickedUp: p.pickedUpQuantity, remaining: p.remainingQuantity }));
            return send({ id: job.id }, 202);
          }
          if (url.pathname.endsWith('/handoffs')) {
            const h = { id: `handoff-${handoffs.length + 1}`, handedOffAt: '2026-09-25T12:30:00Z', handedOffByName: 'Fixture staff', items: body.items.map(i => ({ ...i, productName: 'Coroplast' })) };
            for (const id of body.travelerJobIds ?? []) { const job = jobs.find(j => j.id === id); if (job) job.handoffId = h.id; }
            handoffs.push(h); return send({ terminal: production().remainingQuantity === 0 });
          }
          if (url.pathname.endsWith('/reverse')) {
            events.push({ id: `reversal-${events.length + 1}`, eventType: 'PICKUP_HANDOFF_REVERSED', createdAt: '2026-09-25T13:00:00Z', actorFirstName: 'Fixture', actorLastName: 'staff',
              payloadJson: { sourceId: url.pathname.split('/').at(-2), reason: body.reason, items: body.items } });
            return send({ ok: true });
          }
        }
        return send(null, 404);
      }
      if (url.pathname.startsWith('/orders/') || url.pathname.startsWith('/fulfillment/')) {
        res.setHeader('Content-Type', 'text/html');
        res.end(await server.transformIndexHtml(req.url, '<html><head><title>Local Pickup lifecycle fixture</title></head><body><div id="root"></div><script type="module" src="/e2e/local-pickup-traveler/fixture.tsx"></script></body></html>')); return;
      }
      next();
    });
  } }], resolve: { alias: { '@': path.join(root, 'client/src'), '@shared': path.join(root, 'shared') } },
  define: { 'import.meta.env.VITE_API_BASE_URL': JSON.stringify(''), 'import.meta.env.VITE_OBJECTS_BASE_URL': JSON.stringify('') },
  server: { host: '127.0.0.1', port: 4180, strictPort: true },
});
await server.listen();
console.log('Local mock workflow: http://127.0.0.1:4180/fulfillment/orders/fixture-20538');
