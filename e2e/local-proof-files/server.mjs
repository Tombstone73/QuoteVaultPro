import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Local UI fixture only. Snapshot/bytes come from the isolated PostgreSQL test;
// HTTP behavior here is mocked and does not connect to any operational database.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const snapshot = JSON.parse(await readFile(path.join(root, 'node_modules/.cache/proof-browser-data.json'), 'utf8'));
let missing = false;
const server = await createServer({ configFile: false, root, envFile: false, plugins: [react(), {
  name: 'isolated-proof-file-viewer', configureServer(vite) {
    vite.middlewares.use(async (req, res, next) => {
      const url = new URL(req.url, 'http://127.0.0.1');
      const json = (data, status = 200) => { res.statusCode = status; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(data)); };
      if (url.pathname.startsWith('/__fixture/')) { missing = url.pathname.endsWith('/missing'); return json({ missing }); }
      if (url.pathname.startsWith('/api/')) {
        if (url.pathname === '/api/auth/session') return json({ authenticated: true, user: { id: 'synthetic-staff', role: 'admin', email: 'staff@example.test' } });
        if (url.pathname === '/api/proofing/queue') return json({ success: true, data: snapshot.queue });
        if (url.pathname.endsWith('/eligible-artwork')) return json({ success: true, data: { sources: [], eligibleCount: 0, artworkSummary: { artworkCount: 0, totalQuantity: 1 }, disabledReason: 'Synthetic viewer fixture' } });
        if (url.pathname.startsWith('/api/proofing/line-item/')) return json({ success: true, data: snapshot.detail });
        if (/\/api\/proofing\/versions\/[^/]+\/file$/.test(url.pathname)) {
          const versionId = url.pathname.split('/')[4];
          const version = snapshot.detail.proofVersionHistory.find(v => v.id === versionId);
          return json({ success: true, data: { ...snapshot.file, id: version.proofFileId, available: !missing, error: missing ? 'The proof file could not be read from storage. Retry file access; existing versions are preserved.' : null, authenticatedUrl: `${url.pathname}/content` } });
        }
        if (url.pathname.endsWith('/file/content')) {
          if (missing) return json({ error: 'Proof file unavailable' }, 409);
          res.setHeader('Content-Type', 'application/pdf'); return res.end(Buffer.from(snapshot.pdf, 'base64'));
        }
        if (url.pathname === `/api/artwork/file-records/${snapshot.file.fileRecordId}/content`) {
          if (missing) return json({ error: 'Proof file unavailable' }, 409);
          res.setHeader('Content-Type', 'application/pdf'); return res.end(Buffer.from(snapshot.pdf, 'base64'));
        }
        // Deliberately exclude proof-role attachments, matching the canonical artwork route.
        if (url.pathname.endsWith('/files')) return json({ success: true, data: [], assets: [] });
        if (url.pathname.startsWith('/api/orders/')) return json(snapshot.order);
        return json({ success: true, data: [] });
      }
      if (url.pathname === '/' || url.pathname.startsWith('/production/')) {
        res.setHeader('Content-Type', 'text/html');
        return res.end(await vite.transformIndexHtml(req.url, '<html><head><title>Synthetic proof file validation</title></head><body><div id="root"></div><script type="module" src="/e2e/local-proof-files/fixture.tsx"></script></body></html>'));
      }
      next();
    });
  },
}], resolve: { alias: { '@': path.join(root, 'client/src'), '@shared': path.join(root, 'shared'), '@assets': path.join(root, 'attached_assets') } },
define: { 'import.meta.env.VITE_API_BASE_URL': JSON.stringify(''), 'import.meta.env.VITE_OBJECTS_BASE_URL': JSON.stringify('') },
server: { host: '127.0.0.1', port: 4198, strictPort: true } });
await server.listen();
console.log(`Synthetic proof viewer: http://127.0.0.1:4198/production/proofing?lineItemId=${snapshot.detail.lineItemId}`);
