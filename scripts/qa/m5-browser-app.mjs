// Run from the workspace root: node scripts/qa/m5-browser-app.mjs
import { execFileSync, spawn } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const cwd = fileURLToPath(new URL('../../', import.meta.url));
const runId = process.env.M5_RUN_ID ?? randomUUID();
if (!/^[\da-f]{8}-[\da-f]{4}-[1-8][\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i.test(runId)) throw new Error('M5_RUN_ID must be a UUID');
const sourceSha = execFileSync('git', ['rev-parse', '--verify', 'HEAD'], { cwd, encoding: 'utf8' }).trim();
if (!/^[\da-f]{40}$/.test(sourceSha)) throw new Error('Cannot identify M5 source revision');
console.log(`M5 public runId=${runId} sourceSha=${sourceSha}`);
const temp = mkdtempSync(path.join(os.tmpdir(), 'kilo', 'm5-browser-app-'));
const database = 'postgresql://postgres@127.0.0.1:55605/printershero_m5_browser_test';
const child = spawn(process.execPath, ['--max-old-space-size=8192', '--import', 'tsx', '--import', './scripts/qa/m5-browser-app.preload.mjs', './scripts/qa/m5-browser-app.server.mts'], {
  cwd, stdio: 'inherit',
  env: {
    M5_RUN_ID: runId, M5_SOURCE_SHA: sourceSha,
    SystemRoot: process.env.SystemRoot, ComSpec: process.env.ComSpec, PATH: `${path.dirname(process.execPath)};${process.env.SystemRoot}\\System32`,
    TMP: temp, TEMP: temp, HOME: temp, USERPROFILE: temp, APPDATA: temp, LOCALAPPDATA: temp, TSX_DISABLE_CACHE: '1',
    NODE_ENV: 'test', AUTH_PROVIDER: 'password', SESSION_SECRET: randomBytes(48).toString('hex'),
    DATABASE_URL: database, DIRECT_DATABASE_URL: database, MIGRATION_DATABASE_URL: database,
    DOTENV_CONFIG_PATH: 'NUL', DRIZZLE_AUTO_MIGRATE: '0', GOOGLE_CLOUD_DISABLE_GCE_CHECK: 'true',
    PRINTERSHERO_MANAGED_AI_PROVIDER: 'openai_compatible', PRINTERSHERO_MANAGED_AI_MODEL: 'synthetic-m5',
    PRINTERSHERO_MANAGED_AI_ENDPOINT: 'http://127.0.0.1:5165/__m5/model', PRINTERSHERO_MANAGED_AI_API_KEY: 'local-script-only',
  },
});
child.on('exit', code => process.exit(code ?? 1));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill());
