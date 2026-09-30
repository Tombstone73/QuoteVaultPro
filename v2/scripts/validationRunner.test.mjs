import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { cleanEnvironment, checkCompleteness, collectGates, selectSuites, checkJestCoverage, run } from './validate.mjs';
import { root, isSuiteFilename } from './testInventory.mjs';

const row = { path: 'v2/tests/example.pure.ts', category: 'safe-deterministic', runner: 'tsx', reason: 'Fixture with fake dependencies.' };
test('unknown tests, stale entries, duplicate rows and invalid classifications fail closed', () => {
  assert.doesNotThrow(() => checkCompleteness([row.path], [row]));
  assert.throws(() => checkCompleteness([row.path, 'v2/tests/new.pure.ts'], [row]), /unknown/);
  assert.throws(() => checkCompleteness([], [row]), /missing/);
  assert.throws(() => checkCompleteness([row.path], [row, row]), /duplicates/);
  assert.throws(() => checkCompleteness([row.path], [{ ...row, category: 'guess' }]), /malformed/);
  assert.throws(() => checkCompleteness([row.path], [{ ...row, runner: 'auto' }]), /malformed/);
  assert.throws(() => checkCompleteness([row.path], [{ ...row, runner: 'none' }]), /malformed/);
  assert.throws(() => checkCompleteness([row.path], [{ ...row, runner: 'psql' }]), /malformed/);
  assert.throws(() => checkCompleteness([row.path], [{ ...row, category: 'manual' }]), /malformed/);
});
test('only the exact separately gated architecture suite is excluded from node:test selection', () => {
  const entries = [
    { ...row, path: 'v2/tests/new.test.mjs', runner: 'node-test' },
    { ...row, path: 'v2/tests/architectureGuardrails.test.mjs', runner: 'node-test' },
  ];
  assert.deepEqual(selectSuites('safe-deterministic', 'v2/tests/', entries).map(entry => entry.path), ['v2/tests/new.test.mjs']);
});
test('a timed-out process cannot pass even if its termination handler exits zero', async () => {
  const result = await run('timeout fixture', ['-e', "process.on('SIGTERM',()=>process.exit(0));setInterval(()=>{},1000);"], cleanEnvironment(), false, process.execPath, { timeoutMs: 200 });
  assert.equal(result.timedOut, true);
  assert.equal(result.status, 1);
});
test('timeout cleanup also terminates an owned grandchild that ignores graceful termination', async () => {
  const source = `const c=require('node:child_process').spawn(process.execPath,['-e',"process.on('SIGTERM',()=>{});setInterval(()=>{},1000);"],{stdio:'ignore'});console.log('owned-child:'+c.pid);process.on('SIGTERM',()=>process.exit(0));setInterval(()=>{},1000);`;
  const result = await run('timeout tree fixture', ['-e', source], cleanEnvironment(), true, process.execPath, { timeoutMs: 500, printFailure: false });
  assert.equal(result.status, 1);
  const pid = Number(result.output.match(/owned-child:(\d+)/)?.[1]);
  assert.ok(pid, 'Fixture must start its grandchild before timeout.');
  await new Promise(resolve => setTimeout(resolve, 100));
  let terminated = false;
  try {
    process.kill(pid, 0);
    // A Linux zombie has terminated, even if the host has not reaped it yet.
    if (process.platform === 'linux') terminated = /\) Z /.test(fs.readFileSync(`/proc/${pid}/stat`, 'utf8'));
  } catch (error) { if (error.code === 'ESRCH' || error.code === 'ENOENT') terminated = true; else throw error; }
  assert.equal(terminated, true, 'Owned grandchild must not survive timeout cleanup.');
});
test('UI ESM/CommonJS/spec/pure test names enter completeness rather than disappearing', () => {
  for (const file of ['v2/ui/src/new.test.mjs', 'v2/ui/src/new.test.cjs', 'v2/ui/src/new.spec.ts', 'v2/ui/src/new.pure.ts']) {
    assert.equal(isSuiteFilename(file), true);
    assert.throws(() => checkCompleteness([row.path, file], [row]), /unknown/);
  }
});
test('Jest must execute every selected path and cannot silently filter spec tests or skip assertions', () => {
  const paths = ['v2/tests/a.test.ts', 'v2/tests/b.spec.ts'];
  const report = { testResults: paths.map(name => ({ name: path.resolve(root, name) })), numPendingTests: 0, numPendingTestSuites: 0 };
  assert.doesNotThrow(() => checkJestCoverage(paths, report));
  assert.throws(() => checkJestCoverage(paths, { ...report, testResults: report.testResults.slice(0, 1) }), /selected\/executed/);
  assert.throws(() => checkJestCoverage(paths, { ...report, numPendingTests: 1 }), /skipped\/pending/);
  const require = createRequire(import.meta.url);
  assert.match('/v2/tests/b.spec.ts', new RegExp(require('../jest.config.cjs').testRegex));
});
test('environment allowlist strips all credentials and ambient preloads without inventing a DB URL', () => {
  const env = cleanEnvironment({ PATH: 'tools', DATABASE_URL: 'prod', TEST_DATABASE_URL: 'test', SECRET_UNKNOWN_PROVIDER: 'secret', SUPABASE_URL: 'remote', PGHOST: 'prod', NODE_OPTIONS: '--require dotenv/config', NODE_ENV: 'production' });
  assert.equal(env.PATH, 'tools');
  for (const key of ['DATABASE_URL', 'TEST_DATABASE_URL', 'SECRET_UNKNOWN_PROVIDER', 'SUPABASE_URL', 'PGHOST']) assert.equal(env[key], undefined);
  assert.equal(env.NODE_ENV, 'test');
  assert.doesNotMatch(env.NODE_OPTIONS, /dotenv/);
});
test('independent gates run after both nonzero exits and thrown errors', async () => {
  const visited = [];
  const results = await collectGates([{ name: 'failed' }, { name: 'throws' }, { name: 'after' }], async gate => {
    visited.push(gate.name);
    if (gate.name === 'throws') throw new Error('fixture failure');
    return { status: gate.name === 'failed' ? 2 : 0 };
  });
  assert.deepEqual(visited, ['failed', 'throws', 'after']);
  assert.deepEqual(results.map(result => result.status), [2, 1, 0]);
});
test('isolated Jest config never loads root DB setup or migrations', () => {
  const require = createRequire(import.meta.url);
  const config = require('../jest.config.cjs');
  assert.deepEqual(config.setupFiles, []);
  assert.deepEqual(config.setupFilesAfterEnv, []);
  assert.equal(config.globalSetup, undefined);
  assert.match(config.cacheDirectory, /\.cache\/v2-validation/);
});
test('deterministic transport and dotenv guards reject before external I/O', () => {
  const result = spawnSync(process.execPath, ['-e', `const assert=require('node:assert/strict');assert.throws(()=>require('node:net').connect(443,'example.com'),/blocked external/);assert.throws(()=>require('node:https').get('https://example.com'),/blocked external/);assert.throws(()=>fetch('https://example.com'),/blocked external/);assert.throws(()=>require('dotenv/config'),/forbids dotenv/);`], { cwd: root, env: cleanEnvironment(), encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
});
test('DB entry refuses absence and unsafe URLs before importing target', () => {
  const require = createRequire(import.meta.url);
  for (const url of [undefined, 'postgresql://fixture:secret@localhost/production']) {
    const env = { ...cleanEnvironment(process.env, 'db'), V2_M0_POSTGRES_INTEGRATION: '1' };
    if (url) env.TEST_DATABASE_URL = url;
    const result = spawnSync(process.execPath, [require.resolve('tsx/cli'), 'v2/scripts/guarded-test-entry.ts', path.join(root, 'deliberately-nonexistent.ts')], { cwd: root, env, encoding: 'utf8' });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /dedicated TEST_DATABASE_URL|production, shared/);
    assert.doesNotMatch(result.stderr, /deliberately-nonexistent|fixture:secret/);
  }
});
