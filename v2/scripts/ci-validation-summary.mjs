import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import manifest from './test-classification.mjs';

const reviewedSuites = new Set(manifest.filter(entry => entry.runner !== 'none').map(entry => entry.path));

export const expectedGates = Object.freeze([
  'classification', 'core-typecheck', 'ui-typecheck', 'import-boundaries',
  'sql-ownership', 'architecture-tests', 'harness-tests', 'deterministic-core',
  'deterministic-ui', 'migration-journal', 'migration-integrity',
]);

function suiteName(value, knownSuites) {
  if (typeof value !== 'string') return 'unknown-suite';
  const normalized = value.replaceAll('\\', '/');
  const marker = normalized.lastIndexOf('/v2/');
  const relative = marker >= 0 ? normalized.slice(marker + 1) : normalized;
  // Publish paths only, never arbitrary assertion messages, stdout or credentials.
  return /^v2\/(?:tests|ui\/src)\/[A-Za-z0-9_./-]+\.(?:[cm]?js|tsx?)$/.test(relative)
    && relative.length <= 180 && !relative.split('/').includes('..') && knownSuites.has(relative) ? relative : 'unknown-suite';
}

export function summarizeValidation(report, jest, knownSuites = reviewedSuites) {
  const results = report?.results;
  if (!Array.isArray(results) || results.length !== expectedGates.length
    || new Set(results.map(result => result?.name)).size !== expectedGates.length
    || results.some(result => !expectedGates.includes(result?.name))) {
    return { summary: 'incomplete-or-invalid-report', complete: false, failedGates: [], failedSuites: [] };
  }
  const failed = results.filter(result => result.status !== 0);
  const suites = failed.flatMap(result => Array.isArray(result.results)
    ? result.results.filter(child => child?.status !== 0).map(child => suiteName(child?.name, knownSuites)) : []);
  if (Array.isArray(jest?.testResults)) {
    suites.push(...jest.testResults.filter(result => result?.status !== 'passed').map(result => suiteName(result?.name, knownSuites)));
  }
  const failedSuites = [...new Set(suites)];
  const corePassed = results.find(result => result.name === 'deterministic-core').status === 0;
  const jestCaseFailure = Array.isArray(jest?.testResults) && jest.testResults.some(result => result?.status !== 'passed');
  const jestAggregateFailure = jest?.success === false || (typeof jest?.numFailedTestSuites === 'number' && jest.numFailedTestSuites > 0)
    || (typeof jest?.numFailedTests === 'number' && jest.numFailedTests > 0);
  if (results.some(result => result.status === 0 && Array.isArray(result.results)
    && result.results.some(child => child?.status !== 0)) || (corePassed && (jestCaseFailure || jestAggregateFailure))
    || (jestAggregateFailure && !jestCaseFailure)) {
    return { summary: 'report-status-inconsistent', complete: false, failedGates: failed.map(result => result.name), failedSuites };
  }
  const gateText = failed.length ? failed.map(result => result.name).join(',') : 'none';
  const suiteText = failedSuites.length ? failedSuites.slice(0, 4).join(',') : 'none';
  return {
    summary: `${expectedGates.length - failed.length}/${expectedGates.length} gates; failed=${gateText}; suites=${suiteText}${failedSuites.length > 4 ? `; plus=${failedSuites.length - 4}` : ''}`,
    complete: true, failedGates: failed.map(result => result.name), failedSuites,
  };
}

function readJson(filename) { try { return JSON.parse(fs.readFileSync(filename, 'utf8')); } catch { return undefined; } }

export function main() {
  const cache = path.resolve('.cache/v2-validation');
  const result = summarizeValidation(readJson(path.join(cache, 'validate-report.json')),
    readJson(path.join(cache, 'safe-deterministic-core-jest.json')));
  console.log(JSON.stringify(result));
  if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `summary=${result.summary}\n`);
  // Diagnostic only: it cannot change the preceding canonical command's exit status.
  return result;
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) main();
