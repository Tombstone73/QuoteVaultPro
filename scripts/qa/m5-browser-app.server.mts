const isolation = Reflect.get(globalThis, Symbol.for('ph.qa.m5.isolation')) as
  { runId: string; sourceSha: string; active(): boolean } | undefined;
if (!isolation?.active() || !isolation.runId || !isolation.sourceSha) throw new Error('M5 guarded launcher required before application imports');

const { default: express } = await import('express');
const { default: path } = await import('node:path');
const { build } = await import('vite');
const { default: react } = await import('@vitejs/plugin-react');
const { registerRoutes } = await import('../../server/routes');
const { pool } = await import('../../server/db');

const app = express();
const out = path.join(process.env.TEMP!, 'client-build');
await build({ configFile: false, root: path.resolve('client'), envDir: process.env.TEMP, cacheDir: path.join(process.env.TEMP!, 'vite-cache'),
  plugins: [react()], resolve: { alias: { '@': path.resolve('client/src'), '@shared': path.resolve('shared'), '@assets': path.resolve('attached_assets') } },
  build: { outDir: out, minify: false, reportCompressedSize: false }, logLevel: 'warn' });
app.use((req, res, next) => {
  if (req.headers.host !== '127.0.0.1:5165' || (req.headers.origin && req.headers.origin !== 'http://127.0.0.1:5165')) return res.sendStatus(403);
  res.setHeader('Content-Security-Policy', "default-src 'self'; connect-src 'self'; img-src 'self' data: blob:; font-src 'self' data:; style-src 'self' 'unsafe-inline'; worker-src 'self' blob:; frame-src 'self'; object-src 'none'; form-action 'self'");
  res.setHeader('X-DNS-Prefetch-Control', 'off');
  next();
});
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.get('/__m5/isolation', async (_req, res) => {
  try {
    if (!isolation.active()) throw new Error();
    const { rows: [row] } = await pool.query('select current_database() as database, inet_server_addr()::text as host, inet_server_port() as port');
    if (row.database !== 'printershero_m5_browser_test' || !['127.0.0.1/32', '127.0.0.1'].includes(row.host) || row.port !== 55605) throw new Error();
    res.setHeader('Cache-Control', 'no-store');
    res.json({ database: row.database, provider: 'scripted', runId: isolation.runId, sourceSha: isolation.sourceSha });
  } catch { res.status(503).json({ error: 'Isolated fixture unavailable' }); }
});
// registerRoutes sets up the real password/session, tenant and business routes. Do not import the workers/migrations entrypoint.
const server = await registerRoutes(app);
app.use('/api', (_req, res) => res.sendStatus(404));
app.use(express.static(out));
app.get('*', (_req, res) => res.sendFile(path.join(out, 'index.html')));
server.listen(5165, '127.0.0.1', () => console.log('M5 PH listening on http://127.0.0.1:5165'));
