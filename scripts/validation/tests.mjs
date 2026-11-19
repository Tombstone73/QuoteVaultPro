import { spawnSync } from 'node:child_process';
import { devNull } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expandLanes, laneNames, lanes } from './lanes.mjs';
import { legacyPostgres } from './legacy-postgres.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const args = process.argv.slice(2);
const discoveryUrl = 'postgresql://validation:validation@127.0.0.1:1/validation_test';
const env = {
  ...process.env,
  NODE_OPTIONS: '--max-old-space-size=8192 --experimental-vm-modules',
  // Let modules that initialize a driver on import load, without handing
  // ordinary test suites an application or integration database URL.
  DATABASE_URL: discoveryUrl,
  DIRECT_DATABASE_URL: discoveryUrl,
  MIGRATION_DATABASE_URL: discoveryUrl,
  TEST_DATABASE_URL: '',
  DOTENV_CONFIG_PATH: devNull,
};

function jest(config, roots, paths, discovery) {
  const result = spawnSync(process.execPath, [
    'node_modules/jest/bin/jest.js', '--config', config,
    '--runInBand', '--cacheDirectory', 'node_modules/.cache/jest-validation',
    ...(discovery ? ['--listTests', '--json'] : []),
    ...(paths.length ? ['--runTestsByPath', ...paths] : []),
    '--roots', ...roots,
  ], { cwd: root, env, stdio: discovery ? ['ignore', 'pipe', 'inherit'] : 'inherit', encoding: 'utf8' });
  if (result.error) throw result.error;
  if (!discovery) return result.status ?? 1;
  if (result.status !== 0) throw new Error(`${config} discovery failed (exit ${result.status}).`);
  return JSON.parse(result.stdout).map((file) => path.relative(root, file).replaceAll('\\', '/')).sort();
}

function verifyDiscovery(config, expected, found) {
  if (JSON.stringify(found) !== JSON.stringify([...expected].sort())) {
    throw new Error(`${config} discovery differs from the manifest. Expected ${expected.join(', ')}; found ${found.join(', ')}.`);
  }
}

if (args[0] === 'postgres') {
  const configs = {
    'schema-push': 'jest.local-postgres.config.js',
    migrations: 'jest.inbound-postgres.config.js',
    legacy: 'jest.config.js',
  };
  if (args.length !== 2 || !Object.hasOwn(configs, args[1])) {
    console.error('Usage: npm run validate:postgres -- <schema-push|migrations|legacy> (discovery only)');
    process.exit(2);
  }
  env.TEST_DATABASE_URL = discoveryUrl; // Satisfies local config parsing. Jest runs no setup on --listTests.
  const config = configs[args[1]];
  const paths = args[1] === 'legacy' ? legacyPostgres : [];
  const files = jest(config, ['server', 'shared'], paths, true);
  if (paths.length) verifyDiscovery(config, paths, files);
  if (!files.length) throw new Error('No PostgreSQL suites discovered.');
  console.log(files.join('\n'));
  console.log(`${files.length} PostgreSQL suites in ${args[1]} discovery; no database connection or test execution.`);
} else {
  const list = args.includes('--list');
  const selected = expandLanes(args.filter((arg) => arg !== '--list'));
  if (!selected.length || selected.some((name) => !Object.hasOwn(lanes, name))) {
    console.error(`Usage: npm run validate:tests -- <${laneNames.join('|')}|all> [...] [--list]`);
    process.exit(2);
  }
  const paths = [...new Set(selected.flatMap((name) => lanes[name].tests))];
  const knownDatabaseSuites = new Set([
    ...legacyPostgres,
    'server/tests/quoteRoutingAndConversion.contract.test.ts',
  ]);
  const databasePaths = paths.filter((file) => knownDatabaseSuites.has(file) || /\.postgres\./.test(file));
  if (databasePaths.length) throw new Error(`Database suites belong in PostgreSQL validation: ${databasePaths.join(', ')}`);
  const ordinaryClient = paths.filter((file) => file.startsWith('client/') && !/\.esm\.test\.tsx?$/.test(file));
  const esmClient = paths.filter((file) => file.startsWith('client/') && /\.esm\.test\.tsx?$/.test(file));
  const server = paths.filter((file) => !file.startsWith('client/'));
  for (const [config, roots, expected] of [
    ['jest.config.js', ['server', 'shared'], server],
    ['client/jest.config.js', ['client'], ordinaryClient],
    ['client/jest.esm.config.js', ['client'], esmClient],
  ]) {
    if (!expected.length) continue;
    const found = jest(config, roots, expected, true);
    verifyDiscovery(config, expected, found);
    if (list) console.log(found.join('\n'));
    else if (jest(config, roots, expected, false) !== 0) process.exitCode = 1;
  }
  if (list) console.log(`${paths.length} focused suites discovered; no test execution.`);
}
