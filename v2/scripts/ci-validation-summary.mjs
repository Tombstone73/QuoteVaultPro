import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import manifest from './test-classification.mjs';
import paymentCaseMap from './ci-payment-case-map.mjs';

const reviewedSuites = new Set(manifest.filter(entry => entry.runner !== 'none').map(entry => entry.path));
const paymentCases = new Map(paymentCaseMap.cases.map(entry => [entry.hash, entry.line]));
const coordinateSources = [paymentCaseMap.sourcePath,
  'v2/infrastructure/billing/postgresBillingPaymentsTransaction.ts',
  'v2/infrastructure/billing/stripePaymentInitiation.ts',
  'v2/infrastructure/billing/postgresBillingDraftInvoiceTransaction.ts',
  'v2/tests/infrastructure/billingDraftInvoiceOptionalJson.pure.ts'];
const workspace = new URL('../../', import.meta.url);
const hash = value => createHash('sha256').update(value).digest('hex');
function paymentSourceHash() {
  try { return hash(fs.readFileSync(new URL(paymentCaseMap.sourcePath, workspace))); }
  catch { return undefined; }
}

function paymentLocations(messages) {
  const locations = new Map();
  for (const file of coordinateSources) {
    let lines;
    try { lines = fs.readFileSync(new URL(file, workspace), 'utf8').split(/\r?\n/); }
    catch { continue; }
    const escaped = file.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(`(?:^|[/( ])${escaped}:([1-9]\\d{0,5}):([1-9]\\d{0,5})(?=[),\\s]|$)`, 'g');
    for (const message of messages) {
      if (typeof message !== 'string') continue;
      for (const frame of message.split('\n')) {
        if (!frame.trimStart().startsWith('at ') || frame.length > 2000
          || /\b(?!file:)[a-z][a-z0-9+.-]*:\/\//i.test(frame) || /(?:^|[\\/])\.\.(?:[\\/]|$)/.test(frame)) continue;
        for (const match of frame.replaceAll('\\', '/').matchAll(pattern)) {
          const line = Number(match[1]), column = Number(match[2]);
          if (line <= lines.length && column <= lines[line - 1].length + 1) locations.set(`${file}:${line}:${column}`, { file, line, column });
        }
      }
    }
  }
  return [...locations.values()].slice(0, 4);
}

export function summarizePayment(report, jest, knownSuites = reviewedSuites, sourceHash) {
  if (!knownSuites.has(paymentCaseMap.sourcePath) || !Array.isArray(jest?.testResults)) return undefined;
  const suites = jest.testResults.filter(suite => suiteName(suite?.name, knownSuites) === paymentCaseMap.sourcePath);
  if (!suites.length) return undefined;
  const pinned = (sourceHash ?? paymentSourceHash()) === paymentCaseMap.sourceHash;
  const children = Array.isArray(report?.results) ? report.results.find(gate => gate?.name === 'deterministic-core')?.results : undefined;
  const matches = Array.isArray(children) ? children.filter(child => typeof child?.name === 'string'
    && /^safe-deterministic:jest \([1-9]\d* suites\)$/.test(child.name)) : [];
  const child = matches.length === 1 ? matches[0] : undefined;
  const safeStatus = value => Number.isSafeInteger(value) && value >= 0 ? value : null;
  const aggregatesValid = ['numTotalTests', 'numPassedTests', 'numFailedTests', 'numPendingTests', 'numTotalTestSuites', 'numPassedTestSuites', 'numFailedTestSuites', 'numPendingTestSuites']
    .every(key => jest[key] === undefined || safeStatus(jest[key]) !== null);
  const observed = { numTotalTests: 0, numPassedTests: 0, numFailedTests: 0, numPendingTests: 0,
    numTotalTestSuites: jest.testResults.length, numPassedTestSuites: 0, numFailedTestSuites: 0, numPendingTestSuites: 0 };
  let statusesValid = true;
  const allAssertionsPresent = jest.testResults.every(suite => Array.isArray(suite?.assertionResults));
  for (const suite of jest.testResults) {
    if (suite?.status === 'passed') observed.numPassedTestSuites++;
    else if (suite?.status === 'failed') observed.numFailedTestSuites++;
    else if (['pending', 'skipped'].includes(suite?.status)) observed.numPendingTestSuites++;
    else statusesValid = false;
    if (suite?.status === 'passed' && Array.isArray(suite.assertionResults)
      && (suite.assertionResults.length === 0 || suite.assertionResults.some(assertion => assertion?.status !== 'passed'))) statusesValid = false;
    for (const assertion of Array.isArray(suite?.assertionResults) ? suite.assertionResults : []) {
      observed.numTotalTests++;
      if (assertion?.status === 'passed') observed.numPassedTests++;
      else if (assertion?.status === 'failed') observed.numFailedTests++;
      else if (['pending', 'skipped', 'todo', 'disabled'].includes(assertion?.status)) observed.numPendingTests++;
      else statusesValid = false;
    }
  }
  // Missing assertion arrays permit lower bounds only; present arrays must reconcile exactly.
  const aggregatesConsistent = aggregatesValid && statusesValid && Object.entries(observed).every(([key, count]) =>
    jest[key] === undefined || ((key.endsWith('Suites') || allAssertionsPresent) ? jest[key] === count : jest[key] >= count));
  const diagnostic = {
    state: suites.length === 1 ? 'case-results' : 'duplicate-suite-results',
    caseMap: pinned ? 'current' : 'case-map-stale', expected: pinned ? paymentCases.size : null,
    suiteStatus: suites.length === 1 && ['passed', 'failed', 'pending', 'skipped'].includes(suites[0].status) ? suites[0].status : 'unknown',
    child: { status: safeStatus(child?.status), timedOut: typeof child?.timedOut === 'boolean' ? child.timedOut : null },
    counts: null, unregistered: 0, duplicates: 0, failedCases: [], locations: [],
    consistent: pinned && suites.length === 1 && matches.length === 1 && safeStatus(child?.status) !== null
      && typeof child?.timedOut === 'boolean' && aggregatesConsistent
      && !(child.status === 0 && (suites[0].status !== 'passed' || child.timedOut)),
  };
  if (suites.length !== 1) return diagnostic;
  const suite = suites[0], assertions = suite.assertionResults;
  if (!Array.isArray(assertions) || assertions.length === 0) {
    diagnostic.state = 'suite-load-failure';
    diagnostic.consistent &&= diagnostic.suiteStatus === 'failed';
    if (Array.isArray(assertions)) diagnostic.counts = { registered: pinned ? 0 : null, executed: 0, passed: 0, failed: 0, pending: 0, invalid: 0 };
    diagnostic.locations = paymentLocations([suite.message, suite.failureMessage]);
    return diagnostic;
  }
  const counts = { registered: pinned ? assertions.length : null, executed: 0, passed: 0, failed: 0, pending: 0, invalid: 0 };
  const seen = new Set(), failedCases = new Map();
  for (const assertion of assertions) {
    const status = assertion?.status;
    if (status === 'passed' || status === 'failed') { counts[status]++; counts.executed++; }
    else if (['pending', 'skipped', 'todo', 'disabled'].includes(status)) counts.pending++;
    else counts.invalid++;
    if (!pinned) continue;
    // Never publish the digest of arbitrary report text: only registered hashes leave this function.
    const id = typeof assertion?.fullName === 'string' && assertion.fullName.length <= 1024 ? hash(assertion.fullName) : undefined;
    if (!paymentCases.has(id)) { diagnostic.unregistered++; continue; }
    if (seen.has(id)) diagnostic.duplicates++;
    seen.add(id);
    if (status === 'failed') failedCases.set(id, { hash: id, line: paymentCases.get(id) });
  }
  diagnostic.counts = counts;
  diagnostic.failedCases = [...failedCases.values()];
  const suiteConsistent = diagnostic.suiteStatus === 'passed' ? counts.failed === 0 && counts.pending === 0
    : diagnostic.suiteStatus === 'failed' && counts.failed > 0;
  if ((pinned && counts.registered !== paymentCases.size) || counts.invalid || counts.pending || !suiteConsistent
    || diagnostic.unregistered || diagnostic.duplicates) {
    diagnostic.state = 'case-results-inconsistent';
    diagnostic.consistent = false;
  }
  return diagnostic;
}

function appendPayment(result, payment) {
  if (!payment) return result;
  const counts = payment.counts;
  const first = payment.failedCases[0];
  const text = `; pay=${payment.state}${payment.caseMap === 'current' ? '' : ',case-map-stale'}`
    + `; r/e/p/f/k=${counts ? [counts.registered, counts.executed, counts.passed, counts.failed, counts.pending].map(value => value ?? 'unknown').join('/') : 'unknown'}`
    + `; child=${payment.child.status ?? 'unknown'}/${payment.child.timedOut ?? 'unknown'}`
    + (first ? `; case=${first.hash}@${first.line}${payment.failedCases.length > 1 ? `; case-plus=${payment.failedCases.length - 1}` : ''}` : '')
    + (payment.locations[0] ? `; loc=${payment.locations[0].file}:${payment.locations[0].line}:${payment.locations[0].column}` : '');
  return { ...result, complete: result.complete && payment.consistent,
    summary: (result.complete && !payment.consistent ? 'report-status-inconsistent' : result.summary) + text, payment };
}

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

export function summarizeValidation(report, jest, knownSuites = reviewedSuites, sourceHash) {
  const finish = result => appendPayment(result, summarizePayment(report, jest, knownSuites, sourceHash));
  const results = report?.results;
  if (!Array.isArray(results) || results.length !== expectedGates.length
    || new Set(results.map(result => result?.name)).size !== expectedGates.length
    || results.some(result => !expectedGates.includes(result?.name))) {
    return finish({ summary: 'incomplete-or-invalid-report', complete: false, failedGates: [], failedSuites: [] });
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
    return finish({ summary: 'report-status-inconsistent', complete: false, failedGates: failed.map(result => result.name), failedSuites });
  }
  const gateText = failed.length ? failed.map(result => result.name).join(',') : 'none';
  const suiteText = failedSuites.length ? failedSuites.slice(0, 4).join(',') : 'none';
  return finish({
    summary: `${expectedGates.length - failed.length}/${expectedGates.length} gates; failed=${gateText}; suites=${suiteText}${failedSuites.length > 4 ? `; plus=${failedSuites.length - 4}` : ''}`,
    complete: true, failedGates: failed.map(result => result.name), failedSuites,
  });
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
