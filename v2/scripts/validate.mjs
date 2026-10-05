import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import manifest, { categories, before } from './test-classification.mjs';
import { root, inventory, isSuiteFilename } from './testInventory.mjs';

const require = createRequire(import.meta.url);
const cache = path.join(root, '.cache/v2-validation');
const preload = path.join(root, 'v2/scripts/validation-preload.cjs');
const separatelyGated = new Set(['v2/tests/architectureGuardrails.test.mjs']);
const nonExecutable = new Map([
  ['v2/tests/parity/harness.ts', 'safe-deterministic'],
  ['v2/tests/infrastructure/productionExclusiveMembership.request.sql', 'safe-deterministic'],
  ['v2/tests/infrastructure/productionRecoveryFixture.ts', 'safe-deterministic'],
  ['v2/tests/fixtures/p7-qa-artwork.pdf', 'manual'],
]);
export function cleanEnvironment(source = process.env, mode = 'deterministic') {
  // Allowlist, not a credential-name blacklist: new provider secrets stay out.
  const allowed = /^(PATH|PATHEXT|SYSTEMROOT|WINDIR|COMSPEC|TEMP|TMP|HOME|USERPROFILE|LOCALAPPDATA|APPDATA|PROGRAMFILES|PROGRAMFILES\(X86\)|NUMBER_OF_PROCESSORS|PROCESSOR_ARCHITECTURE|CI)$/i;
  const env = Object.fromEntries(Object.entries(source).filter(([key]) => allowed.test(key)));
  return { ...env, NODE_ENV: 'test', TZ: 'UTC', NO_COLOR: '1', V2_VALIDATION_MODE: mode, NODE_OPTIONS: `--require "${preload.replaceAll('\\', '/')}" --experimental-vm-modules`, TSX_DISABLE_CACHE: '1' };
}
export function checkCompleteness(actual, classified = manifest) {
  const paths = classified.map(entry => entry.path);
  const unknown = actual.filter(file => !paths.includes(file));
  const missing = paths.filter(file => !actual.includes(file));
  const duplicates = paths.filter((file, index) => paths.indexOf(file) !== index);
  const malformed = classified.filter(entry => !categories.includes(entry.category) || !['tsx', 'jest', 'node-test', 'psql', 'none'].includes(entry.runner) || !entry.reason?.trim()
    || (entry.runner === 'none' && nonExecutable.get(entry.path) !== entry.category)
    || (entry.runner === 'psql' && (!entry.path.endsWith('.sql') || entry.category !== 'qa-rehearsal'))
    || (entry.runner === 'node-test' && entry.category !== 'safe-deterministic')
    || (['manual', 'obsolete'].includes(entry.category) && (entry.runner !== 'none' || nonExecutable.get(entry.path) !== entry.category)));
  if (unknown.length || missing.length || duplicates.length || malformed.length) throw new Error(JSON.stringify({ unknown, missing, duplicates, malformed }, null, 2));
}
export function classify() {
  const tests = inventory();
  const ui = inventory(path.join(root, 'v2/ui/src')).filter(entry => isSuiteFilename(entry.path));
  checkCompleteness([...tests, ...ui].map(entry => entry.path));
  const inspected = new Map([...tests, ...ui].map(entry => [entry.path, entry]));
  for (const entry of manifest) {
    const inspection = inspected.get(entry.path);
    if (!['none', 'psql'].includes(entry.runner) && inspection.style !== entry.runner) throw new Error(`Execution style changed: ${entry.path}: manifest=${entry.runner}, inspected=${inspection.style}`);
    if (entry.category === 'safe-deterministic' && (inspection.unresolved?.length || inspection.transitive.some(file => file === 'server/db.ts' || inspection.risks?.some(risk => risk.external.some(specifier => specifier.startsWith('dotenv')))))) throw new Error(`Unsafe or unresolved deterministic runtime import closure: ${entry.path}`);
  }
  const totals = Object.fromEntries(categories.map(category => [category, manifest.filter(entry => entry.category === category).length]));
  return { before, current: { files: tests.length, testFilenameDenominator: tests.filter(entry => /\.(pure|test)\.tsx?$/.test(entry.path)).length, ui: ui.length, suites: manifest.filter(entry => entry.runner !== 'none').length, pure: tests.filter(entry => entry.path.endsWith('.pure.ts')).length }, totals, entries: manifest.map(entry => ({ ...entry, inspection: inspected.get(entry.path) })) };
}
export async function collectGates(gates, execute) {
  const results = [];
  for (const gate of gates) {
    try { results.push({ name: gate.name, ...await execute(gate) }); }
    catch (error) { results.push({ name: gate.name, status: 1, error: error.message }); }
  }
  return results;
}
export function checkJestCoverage(selected, report) {
  const normalize = file => path.resolve(root, file).replaceAll('\\', '/');
  const expected = selected.map(normalize).sort();
  const actual = report.testResults.map(result => normalize(result.name)).sort();
  if (JSON.stringify(expected) !== JSON.stringify(actual)) throw new Error(`Jest selected/executed paths differ: ${JSON.stringify({ missing: expected.filter(file => !actual.includes(file)), unexpected: actual.filter(file => !expected.includes(file)) })}`);
  if (report.numPendingTestSuites || report.numPendingTests) throw new Error('Jest reported skipped/pending required suites or assertions; coverage is incomplete.');
  return actual;
}
export function run(name, args, env, quiet = false, executable = process.execPath, { timeoutMs = 600000, printFailure = true } = {}) {
  return new Promise(resolve => {
    const started = Date.now();
    const child = spawn(executable, args, { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, detached: process.platform !== 'win32' });
    let output = '';
    let timedOut = false;
    let cleanup = Promise.resolve();
    for (const stream of [child.stdout, child.stderr]) stream.on('data', chunk => { output += chunk; if (!quiet) process.stdout.write(chunk); });
    child.on('error', error => { output += error.message; });
    const timer = setTimeout(() => {
      timedOut = true;
      if (!child.pid) return;
      if (process.platform === 'win32') {
        cleanup = new Promise(done => {
          const killer = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { env, stdio: 'ignore', windowsHide: true });
          killer.on('error', () => { child.kill(); done(); });
          killer.on('close', done);
        });
      } else {
        try { process.kill(-child.pid, 'SIGTERM'); } catch { child.kill(); }
        cleanup = new Promise(done => setTimeout(() => { try { process.kill(-child.pid, 'SIGKILL'); } catch {} done(); }, 500));
      }
    }, timeoutMs);
    child.on('close', async (status, signal) => {
      clearTimeout(timer);
      await cleanup;
      const result = { name, status: timedOut ? 1 : status ?? 1, signal, timedOut, durationMs: Date.now() - started };
      if (result.status !== 0) result.output = output;
      if (quiet && printFailure && result.status !== 0) console.error(`\n[FAIL] ${name}\n${output}`);
      resolve(result);
    });
  });
}
function guardedEnvironment(mode) {
  // Evaluate existing guards against ORIGINAL ambient env before sanitization.
  const { require: loadTs } = require('tsx/cjs/api');
  const { requireSafeTestDatabaseUrl } = loadTs(path.join(root, 'server/tests/helpers/safeTestDatabase.ts'), import.meta.url);
  const { requireV2M0CloneDatabaseUrl } = loadTs(path.join(root, 'v2/infrastructure/persistence/cloneSafety.ts'), import.meta.url);
  const url = requireSafeTestDatabaseUrl(process.env);
  requireV2M0CloneDatabaseUrl(process.env);
  return { ...cleanEnvironment(process.env, mode), TEST_DATABASE_URL: url, V2_M0_POSTGRES_INTEGRATION: '1' };
}
export function selectSuites(category, area, classified = manifest) {
  return classified.filter(entry => entry.category === category && entry.runner !== 'none' && !separatelyGated.has(entry.path) && (!area || entry.path.startsWith(area)));
}
export async function suites(category, env, area) {
  const selected = selectSuites(category, area);
  if (!selected.length) return { status: 1, selectedSuites: 0, error: `No executable suites classified as ${category}; no coverage was performed.` };
  const results = [];
  const jest = selected.filter(entry => entry.runner === 'jest');
  if (jest.length) {
    const jestReport = path.join(cache, `${category}-${area?.startsWith('v2/ui') ? 'ui' : 'core'}-jest.json`);
    fs.rmSync(jestReport, { force: true });
    const args = [require.resolve('jest/bin/jest'), '--config', 'v2/jest.config.cjs', '--runInBand', '--json', '--outputFile', jestReport, '--runTestsByPath', ...jest.map(entry => entry.path)];
    if (category === 'safe-db-guarded') args.push('--setupFiles', path.join(root, 'v2/scripts/guarded-jest-setup.cjs'));
    const result = await run(`${category}:jest (${jest.length} suites)`, args, env);
    try {
      result.executedPaths = checkJestCoverage(jest.map(entry => entry.path), JSON.parse(fs.readFileSync(jestReport, 'utf8')));
    } catch (error) {
      result.status = 1;
      result.coverageError = error.message;
      console.error(`[FAIL] ${result.name}: ${error.message}`);
    }
    results.push(result);
  }
  const queue = selected.filter(entry => entry.runner !== 'jest');
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(4, queue.length) }, async () => {
    while (next < queue.length) {
      const entry = queue[next++];
      let result;
      if (entry.runner === 'node-test') {
        result = await run(entry.path, ['--test', entry.path], env, true);
      } else if (entry.runner === 'psql') {
        // libpq only receives the approved URL, never an app URL or .pgpass.
        result = await run(entry.path, ['-X', '--no-password', '--set', 'ON_ERROR_STOP=1', '--file', entry.path], { ...env, PGDATABASE: env.TEST_DATABASE_URL, PGPASSFILE: path.join(cache, 'absent-pgpass') }, true, 'psql');
      } else {
        const guarded = category === 'safe-db-guarded' || category === 'qa-rehearsal';
        const args = [require.resolve('tsx/cli'), ...(guarded ? ['v2/scripts/guarded-test-entry.ts'] : []), entry.path];
        result = await run(entry.path, args, env, true);
      }
      results.push(result);
    }
  }));
  console.log(`${category}${area ? ` ${area}` : ''}: ${selected.length} classified suites; ${results.filter(result => result.status !== 0).length} failed runner invocations.`);
  for (const result of results.filter(result => result.status !== 0)) console.error(`[FAILURE] ${result.name}: exit ${result.status}`);
  return { status: results.some(result => result.status !== 0) ? 1 : 0, selectedSuites: selected.length, results };
}
export async function main(mode = process.argv[2] || 'validate') {
  fs.mkdirSync(cache, { recursive: true });
  if (mode === 'report') {
    const report = JSON.parse(fs.readFileSync(path.join(cache, 'validate-report.json'), 'utf8'));
    const jest = JSON.parse(fs.readFileSync(path.join(cache, 'safe-deterministic-core-jest.json'), 'utf8'));
    console.log(JSON.stringify({ classification: report.classification, gates: report.results.map(result => ({ name: result.name, status: result.status, selectedSuites: result.selectedSuites, error: result.error, failures: result.results?.filter(child => child.status !== 0).map(child => ({ name: child.name, status: child.status })) })), jest: { suites: jest.numTotalTestSuites, passedSuites: jest.numPassedTestSuites, failedSuites: jest.numFailedTestSuites, tests: jest.numTotalTests, passedTests: jest.numPassedTests, failedTests: jest.numFailedTests, pendingTests: jest.numPendingTests, failures: jest.testResults.filter(result => result.status !== 'passed').map(result => ({ path: path.relative(root, result.name).replaceAll('\\', '/'), tests: result.assertionResults.filter(test => test.status === 'failed').map(test => test.fullName) })) } }, null, 2));
    return report.results.some(result => result.status !== 0) ? 1 : 0;
  }
  let classification;
  let classificationError;
  try { classification = classify(); }
  catch (error) {
    classificationError = error.message;
    console.error(`Classification completeness/safety failed:\n${error.message}`);
    if (mode !== 'validate') return 1;
    classification = { before, current: null, totals: null, error: classificationError };
  }
  fs.writeFileSync(path.join(cache, 'classification.json'), JSON.stringify(classification, null, 2));
  console.log(JSON.stringify({ before, current: classification.current, totals: classification.totals }, null, 2));
  if (mode === 'classify') return 0;
  const deterministic = cleanEnvironment();
  const excluded = manifest.filter(entry => entry.category !== 'safe-deterministic');
  console.log(`Explicit non-canonical classifications: ${excluded.map(entry => `${entry.path} [${entry.category}; ${entry.runner}]`).join('\n')}`);
  let results;
  if (['db', 'qa', 'integration'].includes(mode)) {
    const category = { db: 'safe-db-guarded', qa: 'qa-rehearsal', integration: 'environment-integration' }[mode];
    try {
      if (mode === 'integration' && process.env.V2_TEST_INTEGRATION !== '1') throw new Error('V2_TEST_INTEGRATION=1 is required.');
      results = [await suites(category, mode === 'integration' ? deterministic : guardedEnvironment(mode))];
    } catch (error) {
      console.error(error.message);
      results = [{ name: `${mode}-guard`, status: 1, error: error.message, importedSuites: 0 }];
    }
  } else if (mode === 'test' || mode === 'ui') {
    results = [await suites('safe-deterministic', deterministic, mode === 'test' ? 'v2/tests/' : 'v2/ui/src/')];
  } else if (mode === 'validate') {
    const gates = [
      { name: 'classification', classification: true },
      { name: 'core-typecheck', args: [require.resolve('typescript/bin/tsc'), '-p', 'v2/tsconfig.json', '--tsBuildInfoFile', '.cache/v2-validation/core.tsbuildinfo'] },
      { name: 'ui-typecheck', args: [require.resolve('typescript/bin/tsc'), '-p', 'v2/ui/tsconfig.json', '--incremental', '--tsBuildInfoFile', '.cache/v2-validation/ui.tsbuildinfo'] },
      { name: 'import-boundaries', args: ['v2/scripts/check-import-boundaries.mjs'] },
      { name: 'sql-ownership', args: ['v2/scripts/check-sql-write-targets.mjs'] },
      { name: 'architecture-tests', args: ['--test', 'v2/tests/architectureGuardrails.test.mjs'] },
      { name: 'harness-tests', args: ['--test', 'v2/scripts/validationRunner.test.mjs'] },
      { name: 'deterministic-core', category: 'safe-deterministic', area: 'v2/tests/' },
      { name: 'deterministic-ui', category: 'safe-deterministic', area: 'v2/ui/src/' },
      { name: 'migration-journal', args: ['scripts/check-journal-monotonic.mjs'] },
      { name: 'migration-integrity', args: ['scripts/check-migration-history-integrity.mjs'] },
    ];
    results = await collectGates(gates, gate => {
      console.log(`\n[GATE] ${gate.name}`);
      if (gate.classification) return { status: classificationError ? 1 : 0, error: classificationError };
      if (gate.category && classificationError) return { status: 1, error: 'Execution blocked by classification safety/completeness failure; no suites imported.' };
      return gate.category ? suites(gate.category, deterministic, gate.area) : run(gate.name, gate.args, deterministic);
    });
  } else throw new Error(`Unknown validation mode: ${mode}`);
  const report = { mode, classification: { before, current: classification.current, totals: classification.totals }, results };
  fs.writeFileSync(path.join(cache, `${mode}-report.json`), JSON.stringify(report, null, 2));
  console.log(`\nV2 ${mode} results: ${results.map(result => `${result.name ?? mode}=${result.status}`).join(', ')}`);
  return results.some(result => result.status !== 0) ? 1 : 0;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().then(status => { process.exitCode = status; }).catch(error => { console.error(error.message); process.exitCode = 1; });
