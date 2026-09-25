// Local, synthetic, GET-only fixtures. No application server or database.
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const scenarios = {
  full: [[250, 0, 250]], first: [[500, 0, 250]], second: [[500, 250, 150]],
  final: [[500, 400, 100]], multi: [[500, 150, 250], [50, 0, 50]],
};
const server = await createServer({ configFile: false, envFile: false, root,
  plugins: [react(), { name: 'pickup-traveler-fixtures', configureServer(server) {
    server.middlewares.use(async (req, res, next) => {
      const url = new URL(req.url, 'http://localhost');
      if (url.pathname.startsWith('/api/')) {
        if (req.method !== 'GET') { res.statusCode = 405; res.end('Read-only fixture'); return; }
        const scenario = url.pathname.split('/').at(-2);
        const quantities = scenarios[scenario];
        if (!quantities) { res.statusCode = 404; res.end('Unknown fixture'); return; }
        // Use the actual shared snapshot builder and canonical quantity resolver.
        const { buildPickupTravelerProgressSnapshot } = await server.ssrLoadModule('/shared/pickupTravelerProgress.ts');
        const { resolveFulfillmentLineQuantity } = await server.ssrLoadModule('/shared/fulfillmentReadiness.ts');
        const canonical = quantities.map(([orderedQuantity, pickedUpQuantity], i) => ({ id: `line-${i}`,
          production: resolveFulfillmentLineQuantity({ orderedQuantity, pickedUpQuantity }) }));
        const lineQuantities = quantities.map(([, , quantity], i) => ({ orderLineItemId: `line-${i}`, quantity }));
        const progressSnapshot = buildPickupTravelerProgressSnapshot(canonical, lineQuantities, '2026-09-25T12:00:00Z');
        const data = { orderId: 'fixture-20538', orderNumber: '20538', customerName: 'Local fixture customer',
          jobLabel: 'Coroplast pickup', poNumber: 'FIXTURE', dueDate: null, priority: 'normal',
          pickupPrintContext: { fulfillmentMode: 'pickup', boxCount: scenario === 'multi' ? 3 : 1, lineQuantities, progressSnapshot },
          lineItems: progressSnapshot.lines.map((pickupProgress, i) => ({ orderLineItemId: `line-${i}`,
            description: i ? 'Wire stakes' : 'Coroplast', size: i ? '10.00 × 30.00' : '24.00 × 20.00',
            material: i ? 'Steel wire' : 'Coroplast - 4mm', quantity: lineQuantities[i].quantity, pickupProgress })) };
        res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ data })); return;
      }
      if (url.pathname.startsWith('/orders/')) {
        res.setHeader('Content-Type', 'text/html');
        res.end(await server.transformIndexHtml(req.url, '<html><head><title>Local Pickup Traveler fixture</title></head><body><div id="root"></div><script type="module" src="/e2e/local-pickup-traveler/fixture.tsx"></script></body></html>')); return;
      }
      next();
    });
  } }], resolve: { alias: { '@': path.join(root, 'client/src'), '@shared': path.join(root, 'shared') } },
  define: { 'import.meta.env.VITE_API_BASE_URL': JSON.stringify(''), 'import.meta.env.VITE_OBJECTS_BASE_URL': JSON.stringify('') },
  server: { host: '127.0.0.1', port: 4180, strictPort: true },
});
await server.listen();
console.log('Local mocked Travelers: http://127.0.0.1:4180/orders/fixture-20538/traveler?directPrintJobId=first');
