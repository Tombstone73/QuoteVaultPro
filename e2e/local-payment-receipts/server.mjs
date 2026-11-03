import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export async function startFixture(port = 4195) {
  const server = await createServer({ configFile: false, root, envFile: false, plugins: [react(), {
    name: 'local-payment-receipts', configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (req.url === '/' || req.url?.startsWith('/transactions') || req.url?.startsWith('/payments')) {
          res.setHeader('Content-Type', 'text/html');
          res.end(await server.transformIndexHtml(req.url, '<html><head><title>Synthetic customer workspace</title></head><body><div id="root"></div><script type="module" src="/e2e/local-payment-receipts/fixture.tsx"></script></body></html>'));
          return;
        }
        next();
      });
    },
  }], resolve: { alias: { '@': path.join(root, 'client/src'), '@shared': path.join(root, 'shared'), '@assets': path.join(root, 'attached_assets') } },
  define: { 'import.meta.env.VITE_API_BASE_URL': JSON.stringify(''), 'import.meta.env.VITE_OBJECTS_BASE_URL': JSON.stringify('') },
  server: { host: '127.0.0.1', port, strictPort: true },
  });
  await server.listen();
  return server;
}
if (process.argv[1] === fileURLToPath(import.meta.url)) await startFixture();
