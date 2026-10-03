import assert from 'node:assert/strict';
import test from 'node:test';
import { expectedGates, summarizeValidation } from '../scripts/ci-validation-summary.mjs';

const report = () => ({ results: expectedGates.map(name => ({ name, status: 0 })) });
const known = new Set(['v2/tests/modules/example.pure.ts', 'v2/ui/src/example.test.tsx', 'v2/tests/modules/a.test.ts', ...Array.from({ length: 8 }, (_, i) => `v2/tests/modules/case${i}.pure.ts`)]);

test('publishes all eleven passing gates without changing validation', () => {
  assert.deepEqual(summarizeValidation(report()), {
    summary: '11/11 gates; failed=none; suites=none', complete: true, failedGates: [], failedSuites: [],
  });
});
test('retains failed gates and exact failed runner paths', () => {
  const value = report();
  Object.assign(value.results[7], { status: 1, results: [{ name: 'v2/tests/modules/example.pure.ts', status: 1 }, { name: 'v2/tests/modules/other.pure.ts', status: 0 }] });
  Object.assign(value.results[8], { status: null, results: [{ name: 'v2/ui/src/example.test.tsx', status: null }] });
  const result = summarizeValidation(value, undefined, known);
  assert.deepEqual(result.failedGates, ['deterministic-core', 'deterministic-ui']);
  assert.deepEqual(result.failedSuites, ['v2/tests/modules/example.pure.ts', 'v2/ui/src/example.test.tsx']);
  assert.match(result.summary, /^9\/11 gates/);
});
test('missing, duplicate and unknown gate sets are not reported as passing', () => {
  for (const value of [undefined, {}, { results: [] }, { results: report().results.slice(1) },
    { results: [...report().results.slice(1), report().results[1]] },
    { results: [...report().results.slice(1), { name: 'untrusted-gate', status: 0 }] }]) {
    assert.equal(summarizeValidation(value).summary, 'incomplete-or-invalid-report');
  }
});
test('Jest filenames are normalized, deduplicated and passed suites excluded', () => {
  const value = report(); value.results[7].status = 1;
  const result = summarizeValidation(value, { testResults: [
    { name: '/home/runner/work/repo/repo/v2/tests/modules/a.test.ts', status: 'failed' },
    { name: 'C:\\repo\\v2\\tests\\modules\\a.test.ts', status: 'failed' },
    { name: 'v2/tests/modules/b.test.ts', status: 'passed' },
  ] }, known);
  assert.deepEqual(result.failedSuites, ['v2/tests/modules/a.test.ts']);
});
test('a passing gate cannot hide failing nested or Jest evidence', () => {
  const value = report(); value.results[7].results = [{ name: 'v2/tests/modules/a.pure.ts', status: 1 }];
  assert.equal(summarizeValidation(value).summary, 'report-status-inconsistent');
  assert.equal(summarizeValidation(report(), { testResults: [{ name: 'v2/tests/modules/a.test.ts', status: 'failed' }] }).summary, 'report-status-inconsistent');
});
test('unrelated gate failure does not hide contradictory core Jest results', () => {
  const value = report(); value.results[2].status = 1;
  const result = summarizeValidation(value, { testResults: [{ name: 'v2/tests/modules/a.test.ts', status: 'failed' }] }, known);
  assert.equal(result.summary, 'report-status-inconsistent');
  assert.equal(result.complete, false);
  assert.deepEqual(result.failedGates, ['ui-typecheck']);
});
test('aggregate Jest failure without case evidence cannot yield an all-pass receipt', () => {
  for (const value of [report(), { results: report().results.map(result => result.name === 'deterministic-core' ? { ...result, status: 1 } : result) }]) {
    const result = summarizeValidation(value, { success: false, numFailedTestSuites: 1, numFailedTests: 1, testResults: [] });
    assert.equal(result.summary, 'report-status-inconsistent');
    assert.equal(result.complete, false);
  }
});
test('arbitrary failure text, secret-like strings and output injection are redacted', () => {
  const value = report();
  Object.assign(value.results[7], { status: 1, results: [
    { name: 'password=hidden\nsummary=passed', status: 1 },
    { name: 'v2/tests/../outside.test.ts', status: 1 },
    { name: '::error::text', status: 1 },
    { name: 'v2/tests/modules/unregistered-credential-marker.test.ts', status: 1 },
  ] });
  const result = summarizeValidation(value);
  assert.deepEqual(result.failedSuites, ['unknown-suite']);
  assert.doesNotMatch(result.summary, /hidden|password|credential-marker|\n|::error::/);
});
test('display limits retain the full structured failed-suite list', () => {
  const value = report();
  Object.assign(value.results[7], { status: 1, results: Array.from({ length: 8 }, (_, i) => ({ name: `v2/tests/modules/case${i}.pure.ts`, status: 1 })) });
  const result = summarizeValidation(value, undefined, known);
  assert.equal(result.failedSuites.length, 8);
  assert.match(result.summary, /plus=4$/);
});
