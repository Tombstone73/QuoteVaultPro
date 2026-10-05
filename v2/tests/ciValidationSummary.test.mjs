import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { format } from 'node:util';
import { expectedGates, summarizeValidation } from '../scripts/ci-validation-summary.mjs';
import paymentCaseMap from '../scripts/ci-payment-case-map.mjs';

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

const digest = value => createHash('sha256').update(value).digest('hex');
const paymentSource = fs.readFileSync(new URL('../tests/modules/paymentWorkspace.test.ts', import.meta.url));
const ts = createRequire(import.meta.url)('typescript');
const ast = ts.createSourceFile(paymentCaseMap.sourcePath, paymentSource.toString('utf8'), ts.ScriptTarget.ES2022, true);
const registrations = [];
function literal(node) {
  if (ts.isAsExpression(node) || ts.isParenthesizedExpression(node)) return literal(node.expression);
  if (ts.isStringLiteral(node)) return node.text;
  if (ts.isNumericLiteral(node)) return Number(node.text);
  if (ts.isPrefixUnaryExpression(node) && node.operator === ts.SyntaxKind.MinusToken) return -literal(node.operand);
  if (ts.isArrayLiteralExpression(node)) return node.elements.map(literal);
  if (ts.isObjectLiteralExpression(node)) return Object.fromEntries(node.properties.map(property => [property.name.text, literal(property.initializer)]));
  throw new Error('Unsupported static testcase data');
}
// Read registration syntax only; never execute the Payment test or its adapters here.
function readRegistrations(node, ancestors = []) {
  if (ts.isCallExpression(node) && node.expression.getText(ast) === 'describe') {
    readRegistrations(node.arguments[1].body, [...ancestors, literal(node.arguments[0])]);
    return;
  }
  if (ts.isCallExpression(node) && (node.expression.getText(ast) === 'test' || (ts.isCallExpression(node.expression)
    && node.expression.expression.getText(ast) === 'test.each'))) {
    const title = literal(node.arguments[0]);
    const entries = ts.isCallExpression(node.expression) ? literal(node.expression.arguments[0]) : [undefined];
    for (const entry of entries) {
      const name = entry === undefined ? title : format(title, ...(Array.isArray(entry) ? entry : [entry]));
      registrations.push({ fullName: [...ancestors, name].join(' '), line: ast.getLineAndCharacterOfPosition(node.getStart(ast)).line + 1 });
    }
    return;
  }
  ts.forEachChild(node, child => readRegistrations(child, ancestors));
}
readRegistrations(ast);
const paymentKnown = new Set([paymentCaseMap.sourcePath]);
function paymentEvidence(failed = false) {
  const value = report();
  Object.assign(value.results[7], { status: failed ? 1 : 0, results: [{ name: 'safe-deterministic:jest (100 suites)', status: failed ? 1 : 0, timedOut: false }] });
  const assertions = registrations.map((entry, index) => ({ fullName: entry.fullName, title: 'not published', ancestorTitles: [],
    status: failed && index === 61 ? 'failed' : 'passed', failureMessages: [], duration: 1, numPassingAsserts: 1 }));
  const jest = { success: !failed, numTotalTestSuites: 1, numPassedTestSuites: failed ? 0 : 1, numFailedTestSuites: failed ? 1 : 0,
    numPendingTestSuites: 0, numTotalTests: assertions.length, numPassedTests: assertions.length - (failed ? 1 : 0),
    numFailedTests: failed ? 1 : 0, numPendingTests: 0, testResults: [{ name: `/home/runner/work/repo/repo/${paymentCaseMap.sourcePath}`,
      status: failed ? 'failed' : 'passed', assertionResults: assertions, message: '', startTime: 1, endTime: 2 }] };
  return JSON.parse(JSON.stringify({ value, jest }));
}
const summarizePaymentEvidence = ({ value, jest }, sourceHash = paymentCaseMap.sourceHash) => summarizeValidation(value, jest, paymentKnown, sourceHash);

test('registry pins the unchanged source and all 79 static cases at 43 registration lines', () => {
  assert.equal(digest(paymentSource), paymentCaseMap.sourceHash);
  assert.equal(registrations.length, 79);
  assert.equal(new Set(registrations.map(entry => entry.line)).size, 43);
  assert.deepEqual(registrations.map(entry => ({ hash: digest(entry.fullName), line: entry.line })), paymentCaseMap.cases);
  assert.equal(new Set(paymentCaseMap.cases.map(entry => entry.hash)).size, 79);
  assert.ok(paymentCaseMap.cases.every(entry => /^[a-f0-9]{64}$/.test(entry.hash) && Number.isSafeInteger(entry.line) && entry.line > 0));
  assert.deepEqual(Object.keys(paymentCaseMap).sort(), ['cases', 'sourceHash', 'sourcePath']);
  assert.ok(paymentCaseMap.cases.every(entry => Object.keys(entry).sort().join(',') === 'hash,line'));
});
test('real-shaped passing Payment JSON reports complete counts without publishing titles', () => {
  const result = summarizePaymentEvidence(paymentEvidence());
  assert.equal(result.complete, true);
  assert.equal(result.payment.state, 'case-results');
  assert.deepEqual(result.payment.counts, { registered: 79, executed: 79, passed: 79, failed: 0, pending: 0, invalid: 0 });
  assert.deepEqual(result.payment.child, { status: 0, timedOut: false });
  assert.deepEqual(result.payment.failedCases, []);
  assert.match(result.summary, /^11\/11 gates.*r\/e\/p\/f\/k=79\/79\/79\/0\/0; child=0\/false$/);
  assert.ok(registrations.every(entry => !JSON.stringify(result).includes(entry.fullName)));
});
test('failed known case publishes only its pinned hash and registration line and retains canonical failure', () => {
  const evidence = paymentEvidence(true);
  evidence.jest.testResults[0].assertionResults[61].failureMessages = ['password=never-publish ::error::marker'];
  const result = summarizePaymentEvidence(evidence);
  assert.match(result.summary, /^10\/11 gates; failed=deterministic-core/);
  assert.deepEqual(result.payment.counts, { registered: 79, executed: 79, passed: 78, failed: 1, pending: 0, invalid: 0 });
  assert.deepEqual(result.payment.failedCases, [paymentCaseMap.cases[61]]);
  assert.match(result.summary, /case=c72994f5d7bcf54add00343f1e9d59c7f86d7286a8c107a7aa5010db4a83d644@775$/);
  assert.doesNotMatch(JSON.stringify(result), /password|never-publish|::error::|Refund binding persists/);
});
test('unknown fullName is denied without emitting its digest or arbitrary failure context', () => {
  const evidence = paymentEvidence(true), unknown = 'private-company password=hidden\nsummary=passed';
  evidence.jest.testResults[0].assertionResults[61].fullName = unknown;
  const result = summarizePaymentEvidence(evidence);
  assert.equal(result.complete, false);
  assert.equal(result.payment.state, 'case-results-inconsistent');
  assert.equal(result.payment.unregistered, 1);
  assert.deepEqual(result.payment.failedCases, []);
  assert.match(result.summary, /^report-status-inconsistent/);
  assert.ok(!JSON.stringify(result).includes(digest(unknown)));
  assert.doesNotMatch(JSON.stringify(result), /private-company|password|hidden|\nsummary/);
});
test('stale or unreadable source hash denies every case ID without hashing unknown payload for publication', () => {
  for (const sourceHash of ['0'.repeat(64), '', 'secret-like-nonhash']) {
    const evidence = paymentEvidence(true);
    evidence.jest.testResults[0].assertionResults[61].fullName = 'private-unregistered-title';
    const result = summarizePaymentEvidence(evidence, sourceHash);
    assert.equal(result.payment.caseMap, 'case-map-stale');
    assert.equal(result.payment.expected, null);
    assert.equal(result.complete, false);
    assert.equal(result.payment.counts.registered, null);
    assert.equal(result.payment.unregistered, 0);
    assert.deepEqual(result.payment.failedCases, []);
    assert.match(result.summary, /^report-status-inconsistent.*case-map-stale.*r\/e\/p\/f\/k=unknown\//);
    assert.doesNotMatch(JSON.stringify(result), /private-unregistered|secret-like|c72994f5/);
  }
});
test('empty and missing assertion results mark suite load failure and never assert a Payment pass', () => {
  for (const assertions of [[], undefined, 'secret-array']) {
    const evidence = paymentEvidence(true), suite = evidence.jest.testResults[0];
    suite.assertionResults = assertions;
    Object.assign(evidence.jest, { numTotalTests: 0, numPassedTests: 0, numFailedTests: 0 });
    const result = summarizePaymentEvidence(evidence);
    assert.equal(result.payment.state, 'suite-load-failure');
    assert.equal(result.payment.suiteStatus, 'failed');
    assert.match(result.summary, /^10\/11 gates.*suite-load-failure/);
    assert.deepEqual(result.payment.failedCases, []);
    assert.equal(result.payment.counts?.passed ?? null, Array.isArray(assertions) ? 0 : null);
    assert.doesNotMatch(JSON.stringify(result), /secret-array/);
  }
});
test('an empty passed suite or invalid load-failure aggregate cannot claim complete evidence', () => {
  for (const change of [
    evidence => { evidence.jest.testResults[0].status = 'passed'; },
    evidence => { evidence.jest.numTotalTests = 'secret-invalid-count'; },
    evidence => { evidence.value.results[7].results[0].status = 0; },
  ]) {
    const evidence = paymentEvidence(true); evidence.jest.testResults[0].assertionResults = [];
    change(evidence);
    const result = summarizePaymentEvidence(evidence);
    assert.equal(result.payment.state, 'suite-load-failure');
    assert.equal(result.complete, false);
    assert.match(result.summary, /^report-status-inconsistent/);
    assert.doesNotMatch(JSON.stringify(result), /secret-invalid-count/);
  }
});
test('suite-load coordinates are restricted to five fixed source files and in-range integers', () => {
  const evidence = paymentEvidence(true), suite = evidence.jest.testResults[0];
  suite.assertionResults = [];
  Object.assign(evidence.jest, { numTotalTests: 0, numPassedTests: 0, numFailedTests: 0 });
  suite.message = 'private-company password=hidden\n'
    + '    at evaluateActualSource (C:\\private-root\\v2\\tests\\modules\\paymentWorkspace.test.ts:126:20)\n'
    + '    at x (/home/runner/repo/v2/infrastructure/billing/stripePaymentInitiation.ts:130:5)\n'
    + '    at x (https://private.example/v2/tests/modules/paymentWorkspace.test.ts:126:20)\n'
    + '    at x (/root/v2/tests/modules/unregistered.test.ts:1:1)\n'
    + '    at x (/root/../v2/tests/modules/paymentWorkspace.test.ts:127:20)\n'
    + '    at x (/root/v2/tests/modules/paymentWorkspace.test.ts:999999:1)\n'
    + '    at x (/root/v2/tests/modules/paymentWorkspace.test.ts:1:99999)';
  const result = summarizePaymentEvidence(evidence);
  assert.deepEqual(result.payment.locations, [
    { file: paymentCaseMap.sourcePath, line: 126, column: 20 },
    { file: 'v2/infrastructure/billing/stripePaymentInitiation.ts', line: 130, column: 5 },
  ]);
  assert.match(result.summary, /loc=v2\/tests\/modules\/paymentWorkspace.test.ts:126:20$/);
  assert.doesNotMatch(JSON.stringify(result), /private-root|private-company|password|private\.example|unregistered\.test|999999|99999|https:/);
});
test('invalid assertion status, duplicate registration and partial execution cannot produce a complete receipt', () => {
  for (const change of [
    suite => { suite.assertionResults[0].status = 'password=unknown-status'; },
    suite => { suite.assertionResults[0].fullName = suite.assertionResults[1].fullName; },
    suite => { suite.assertionResults.pop(); },
    suite => { suite.assertionResults[0].status = 'pending'; },
  ]) {
    const evidence = paymentEvidence(); change(evidence.jest.testResults[0]);
    const result = summarizePaymentEvidence(evidence);
    assert.equal(result.complete, false);
    assert.equal(result.payment.state, 'case-results-inconsistent');
    assert.match(result.summary, /^report-status-inconsistent/);
    assert.doesNotMatch(JSON.stringify(result), /password=unknown-status/);
  }
});
test('child status and timeout remain typed and explicit, including unknown and timed-out results', () => {
  const evidence = paymentEvidence(true);
  Object.assign(evidence.value.results[7].results[0], { status: 1, timedOut: true });
  let result = summarizePaymentEvidence(evidence);
  assert.deepEqual(result.payment.child, { status: 1, timedOut: true });
  assert.match(result.summary, /child=1\/true/);
  for (const status of [-1, 1.5, Number.MAX_SAFE_INTEGER + 1, 'secret-status']) {
    Object.assign(evidence.value.results[7].results[0], { status, timedOut: 'secret-timeout' });
    result = summarizePaymentEvidence(evidence);
    assert.deepEqual(result.payment.child, { status: null, timedOut: null });
    assert.match(result.summary, /child=unknown\/unknown/);
    assert.doesNotMatch(JSON.stringify(result), /secret-status|secret-timeout/);
  }
});
test('missing, duplicate or timed-out passing Jest child metadata cannot yield complete evidence', () => {
  for (const change of [
    evidence => { evidence.value.results[7].results = []; },
    evidence => { evidence.value.results[7].results.push(structuredClone(evidence.value.results[7].results[0])); },
    evidence => { evidence.value.results[7].results[0].timedOut = true; },
  ]) {
    const evidence = paymentEvidence(); change(evidence);
    const result = summarizePaymentEvidence(evidence);
    assert.equal(result.complete, false);
    assert.match(result.summary, /^report-status-inconsistent/);
  }
});
test('Payment diagnostics preserve independent gate and aggregate contradictions', () => {
  const evidence = paymentEvidence(true);
  evidence.value.results[7].status = 0;
  evidence.value.results[2].status = 1;
  let result = summarizePaymentEvidence(evidence);
  assert.equal(result.complete, false);
  assert.match(result.summary, /^report-status-inconsistent/);
  assert.deepEqual(result.failedGates, ['ui-typecheck']);
  evidence.value.results[7].status = 1;
  evidence.value.results[7].results[0].status = 0;
  result = summarizePaymentEvidence(evidence);
  assert.equal(result.complete, false);
  assert.match(result.summary, /^report-status-inconsistent/);
});
test('invalid aggregate counts and inconsistent singleton totals are not reported as complete', () => {
  for (const invalid of [-1, 0.5, Number.MAX_SAFE_INTEGER + 1, 'secret-count', 0]) {
    const evidence = paymentEvidence(true); evidence.jest.numTotalTests = invalid;
    const result = summarizePaymentEvidence(evidence);
    assert.equal(result.complete, false);
    assert.match(result.summary, /^report-status-inconsistent/);
    assert.doesNotMatch(JSON.stringify(result), /secret-count/);
  }
});
test('suite aggregate totals and statuses must match observed suites', () => {
  for (const change of [
    jest => { jest.numTotalTestSuites = 0; jest.numPassedTestSuites = 0; },
    jest => { jest.numTotalTestSuites = 2; },
    jest => { jest.numPassedTestSuites = 0; },
    jest => { jest.numFailedTestSuites = 1; },
    jest => { jest.numPendingTestSuites = 1; },
  ]) {
    const evidence = paymentEvidence(); change(evidence.jest);
    const result = summarizePaymentEvidence(evidence);
    assert.equal(result.complete, false);
    assert.match(result.summary, /^report-status-inconsistent/);
  }
});
test('multi-suite test counts reconcile all observed assertions, not just Payment', () => {
  const evidence = paymentEvidence();
  evidence.jest.testResults.push({ name: 'v2/tests/modules/a.test.ts', status: 'passed',
    assertionResults: [{ fullName: 'not published', status: 'passed' }] });
  Object.assign(evidence.jest, { numTotalTestSuites: 2, numPassedTestSuites: 2, numTotalTests: 80, numPassedTests: 80 });
  assert.equal(summarizePaymentEvidence(evidence).complete, true);
  for (const change of [
    jest => { jest.numTotalTests = 0; jest.numPassedTests = 0; },
    jest => { jest.numTotalTests = 79; jest.numPassedTests = 79; },
    jest => { jest.numTotalTests = 81; jest.numPassedTests = 81; },
    jest => { jest.numPendingTests = 1; },
  ]) {
    const modified = structuredClone(evidence); change(modified.jest);
    const result = summarizePaymentEvidence(modified);
    assert.equal(result.complete, false);
    assert.match(result.summary, /^report-status-inconsistent/);
  }
});
test('missing foreign assertions still require aggregate lower bounds for observed Payment cases', () => {
  const evidence = paymentEvidence();
  evidence.jest.testResults.push({ name: 'v2/tests/modules/a.test.ts', status: 'passed' });
  Object.assign(evidence.jest, { numTotalTestSuites: 2, numPassedTestSuites: 2 });
  assert.equal(summarizePaymentEvidence(evidence).complete, true);
  evidence.jest.numTotalTests = 0;
  evidence.jest.numPassedTests = 0;
  assert.equal(summarizePaymentEvidence(evidence).complete, false);
});
test('an unknown foreign assertion status cannot produce complete aggregate evidence', () => {
  const evidence = paymentEvidence();
  evidence.jest.testResults.push({ name: 'v2/tests/modules/a.test.ts', status: 'passed',
    assertionResults: [{ fullName: 'not published', status: 'private-invalid-status' }] });
  Object.assign(evidence.jest, { numTotalTestSuites: 2, numPassedTestSuites: 2, numTotalTests: 80, numPassedTests: 79 });
  const result = summarizePaymentEvidence(evidence);
  assert.equal(result.complete, false);
  assert.match(result.summary, /^report-status-inconsistent/);
  assert.doesNotMatch(JSON.stringify(result), /private-invalid-status/);
});
test('passed foreign suites cannot conceal pending, failed or empty assertion evidence', () => {
  for (const status of ['pending', 'failed', undefined]) {
    const evidence = paymentEvidence();
    evidence.jest.testResults.push({ name: 'v2/tests/modules/a.test.ts', status: 'passed',
      assertionResults: status ? [{ fullName: 'not published', status }] : [] });
    Object.assign(evidence.jest, { numTotalTestSuites: 2, numPassedTestSuites: 2,
      numTotalTests: status ? 80 : 79, numPassedTests: 79, numPendingTests: status === 'pending' ? 1 : 0 });
    if (status === 'failed') delete evidence.jest.numFailedTests;
    const result = summarizePaymentEvidence(evidence);
    assert.equal(result.complete, false);
    assert.match(result.summary, /^report-status-inconsistent/);
  }
});
test('stale mapping cannot certify an arbitrary passed assertion as registered', () => {
  const evidence = paymentEvidence();
  evidence.jest.testResults[0].assertionResults = [{ fullName: 'private-unregistered-title', status: 'passed' }];
  Object.assign(evidence.jest, { numTotalTests: 1, numPassedTests: 1 });
  const result = summarizePaymentEvidence(evidence, '0'.repeat(64));
  assert.equal(result.complete, false);
  assert.equal(result.payment.counts.registered, null);
  assert.deepEqual(result.payment.failedCases, []);
  assert.match(result.summary, /^report-status-inconsistent.*r\/e\/p\/f\/k=unknown\/1\/1\/0\/0/);
  assert.doesNotMatch(JSON.stringify(result), /private-unregistered-title/);
});
test('duplicate suites and unregistered suite paths cannot publish case identities', () => {
  const evidence = paymentEvidence(true);
  evidence.jest.testResults.push(structuredClone(evidence.jest.testResults[0]));
  let result = summarizePaymentEvidence(evidence);
  assert.equal(result.payment.state, 'duplicate-suite-results');
  assert.equal(result.complete, false);
  assert.deepEqual(result.payment.failedCases, []);
  evidence.jest.testResults = [{ ...evidence.jest.testResults[0], name: 'private-root/v2/tests/modules/unregistered.test.ts' }];
  result = summarizePaymentEvidence(evidence);
  assert.equal(result.payment, undefined);
  assert.deepEqual(result.failedSuites, ['unknown-suite']);
});
test('incomplete gate metadata stays incomplete when Payment diagnostic evidence is present', () => {
  const evidence = paymentEvidence(true);
  evidence.value.results = 'private-report';
  const result = summarizePaymentEvidence(evidence);
  assert.equal(result.complete, false);
  assert.match(result.summary, /^incomplete-or-invalid-report/);
  assert.doesNotMatch(JSON.stringify(result), /private-report/);
});
test('compact summary limits case display but retains all structured known failures', () => {
  const evidence = paymentEvidence(true);
  evidence.jest.testResults[0].assertionResults[62].status = 'failed';
  Object.assign(evidence.jest, { numPassedTests: 77, numFailedTests: 2 });
  const result = summarizePaymentEvidence(evidence);
  assert.equal(result.payment.failedCases.length, 2);
  assert.match(result.summary, /case-plus=1$/);
  assert.ok(result.summary.length <= 256);
});
