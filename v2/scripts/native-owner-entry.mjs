import fs from 'node:fs';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { createRequire, syncBuiltinESMExports } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import net from 'node:net';
import tls from 'node:tls';
import http from 'node:http';
import https from 'node:https';
import dgram from 'node:dgram';
import { createHash, randomUUID } from 'node:crypto';
import { cleanEnvironment } from './validate.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const entry = fileURLToPath(import.meta.url);
const require = createRequire(import.meta.url);
const countKeys = ['runs', 'allocations', 'activeMemberships', 'operationReceipts', 'outputEvents', 'reworkCycles'];
// Independently mapped Production28, not inferred from an emitted receipt.
const productionCases = [
  ['owner create/create: commit winner, conflicting membership and loser ledger rollback', 'concurrency', [1,1,1,1,0,0]],
  ['owner create/create: rollback winner permits reversed-order retry', 'concurrency', [1,2,2,1,0,0]],
  ['concurrent same M0 identity replays exactly one owner result', 'concurrency', [1,1,1,1,0,0]],
  ['concurrent same Run identity under distinct requests cannot duplicate members', 'concurrency', [1,1,1,2,0,0]],
  ['same request changed payload rejects without effects', 'admission', [1,1,1,1,0,0]],
  ['duplicate Work input rejects before creation', 'admission', [0,0,0,0,0,0]],
  ['raw duplicate same Run member is physically rejected', 'schema', [1,1,1,0,0,0]],
  ['raw conflicting Run membership is physically rejected', 'schema', [2,1,1,0,0,0]],
  ['empty-parent state/INSERT serialized draft->cancelled (database derivation, not reopen authorization)', 'concurrency', [1,1,0,0,0,0]],
  ['empty-parent state/INSERT serialized cancelled->ready (database derivation, not reopen authorization)', 'concurrency', [1,1,1,0,0,0]],
  ['allocation UPDATE versus parent state takes parent before member tuple', 'concurrency', [1,1,0,0,0,0]],
  ['parent state versus prior allocation UPDATE avoids opposing tuple cycle', 'concurrency', [1,1,0,0,0,0]],
  ['permitted opposing owner hold/cancel transitions serialize', 'concurrency', [1,1,0,0,0,0]],
  ['owner terminal release versus new owner creation serializes', 'concurrency', [2,2,1,2,0,0]],
  ['multi-member terminal release and reversed Work creation use the complete ordered set', 'concurrency', [2,4,2,2,0,0]],
  ['completed derivation includes unreleased fully produced members', 'schema', [1,1,0,0,0,0]],
  ['cancelled derivation includes unreleased fully produced members', 'schema', [1,1,0,0,0,0]],
  ['pre-start old/new Work updates serialize with ordered affected Work locks', 'concurrency', [1,1,1,0,0,0]],
  ['allocation Run identity updates are rejected, not silently transferred', 'admission', [2,1,1,0,0,0]],
  ['started allocation Work identity cannot be moved by raw UPDATE', 'admission', [1,1,1,0,0,0]],
  ['unsupported owner API reopen rejects without state mutation', 'admission', [1,0,0,0,0,0]],
  ['historical active overlap makes forward invariant fail without silent de-duplication', 'schema', [0,0,0,0,0,0,2]],
  ['pre-held Work lock releases on rollback before owner creation retry', 'concurrency', [1,1,1,1,0,0]],
  ['pre-held Run lock releases on rollback before owner transition retry', 'concurrency', [1,1,1,0,0,0]],
  ['pre-held Run then statement gate cycle produces rollback and safe owner retry', 'concurrency', [1,1,1,0,0,0]],
  ['pre-held Work then statement gate cycle rolls back without membership drift', 'concurrency', [1,1,1,0,0,0]],
  ['existing rework reservation guard under pre-held Work cycle rejects after rollback retry', 'concurrency', [1,1,1,0,0,0]],
  ['runtime creation remains default disabled after all native scenarios', 'admission', [0,0,0,0,0,0]],
].map(([name, kind, values]) => Object.freeze({ name, kind, expectedCounts: Object.freeze(Object.fromEntries([...countKeys, ...(values.length === 7 ? ['historicalAllocations'] : [])].map((key, index) => [key, values[index]]))) }));
const productionCoverage = Object.freeze({
  hookSha256: '487aee5cd0cd5d015f26390541f228310af78c086983f735600a92fe408f839d',
  suiteHash: '78a0d494bdd7b0c022e6981e73db1c67236061394c5fb09c513641e587b89199',
  summaryPidCase: productionCases[0].name,
  cases: Object.freeze(productionCases),
  // suiteHash covers only producer + proposal. The clean commit binds the runtime closure and lockfile.
  fileHashes: Object.freeze({
    'v2/tests/infrastructure/productionRunExclusive.native.ts': '487aee5cd0cd5d015f26390541f228310af78c086983f735600a92fe408f839d',
    'v2/tests/infrastructure/productionRecoveryFixture.ts': '26157cc67f7557d28baa1b6a5196c415eb736f10817c726736b752266902f3e3',
    'v2/tests/infrastructure/productionExclusiveMembership.request.sql': '585b16c36d2219b4b4f2bf7971fb61c23910340abce42ddbc4ac0b321182a882',
    'server/db/migrations_v2/0303_v2_production_exclusive_membership.sql': '585b16c36d2219b4b4f2bf7971fb61c23910340abce42ddbc4ac0b321182a882',
    'server/db/migrations_v2/0180_v2_foundation_persistence.sql': 'ea8f8cbde5c34f0680dae244d1e0a4d633727be23346265d4bdf98c63baf28c0',
    'server/db/migrations_v2/0279_v2_canonical_production_runs.sql': '951058d4aa98d3f941e8e9e96c6ec5847778db4b94f4bda42cb216f8ccc5fe45',
  }),
});
export const nativeOwnerRegistry = Object.freeze({
  production: Object.freeze({ suite: 'v2/tests/infrastructure/productionRunExclusive.native.ts', args: Object.freeze([]), gate: 'OPS12-native', coverageContract: productionCoverage, timeoutMs: 90000, database: 'v2_native_b_ci_test', files: Object.freeze(Object.keys(productionCoverage.fileHashes)), marker: 'OPS12-native' }),
  team: Object.freeze({ suite: 'v2/tests/infrastructure/teamStructuralFloor.test.ts', args: Object.freeze(['--native']), gate: 'ACCESS05-native', coverageContract: null, timeoutMs: 120000, database: 'v2_native_e_ci_test', files: Object.freeze(['v2/tests/infrastructure/teamStructuralFloor.test.ts']), marker: 'ACCESS05_NATIVE_RECEIPT ' }),
});
export class NativeOwnerEntryError extends Error {
  constructor(code) { super(code); this.code = code; }
}
const check = (flag, code) => { if (!flag) throw new NativeOwnerEntryError(code); };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const sha = value => typeof value === 'string' && /^[a-f0-9]{40}$/.test(value);
const pair = value => Array.isArray(value) && value.length === 2 && value.every(pid => Number.isSafeInteger(pid) && pid > 0 && pid <= 2147483647) && value[0] !== value[1];
const inside = (parent, file) => { const relative = path.relative(parent, file); return relative !== '' && !relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative); };

// Public diagnostics are closed vocabularies, not error messages or pattern-matched codes.
const failureCodes = new Set([
  'INVALID_ARGUMENTS', 'DUPLICATE_ARGUMENT', 'CLOSED_LANE_AND_EXACT_COMMIT_REQUIRED',
  'NATIVE_OPT_IN_REQUIRED', 'REVIEWED_DEV_CI_EVENT_REQUIRED', 'EXPLICIT_MANUAL_NATIVE_OPT_IN_REQUIRED',
  'GITHUB_SHA_MISMATCH', 'DEV_PUSH_AFTER_SHA_MISMATCH', 'EXPECTED_COMMIT_ENV_MISMATCH',
  'ALTERNATE_DATABASE_ENVIRONMENT_FORBIDDEN', 'TEST_DATABASE_URL_REQUIRED', 'INVALID_TEST_DATABASE_URL',
  'ONLY_LITERAL_LOOPBACK_CI_POSTGRES_ALLOWED', 'INVALID_TEST_DATABASE_NAME', 'EXACT_LANE_DATABASE_REQUIRED',
  'EXACT_PRODUCTION_TARGET_APPROVAL_REQUIRED', 'CI_RUN_METADATA_REQUIRED', 'DATABASE_GUARD_RESULT_MISMATCH',
  'EXISTING_DATABASE_GUARD_REJECTED', 'SOURCE_PREFLIGHT_UNAVAILABLE', 'EXACT_CLEAN_SOURCE_REQUIRED',
  'REVIEWED_OWNER_COVERAGE_PENDING', 'INVALID_REVIEWED_CASE_CONTRACT', 'FIXED_OWNER_COUNT_CONTRACT_REQUIRED',
  'EXACT_NATIVE_HOOK_FILE_REQUIRED', 'NATIVE_HOOK_DEPENDENCY_HASH_MISMATCH',
  'NATIVE_HOOK_METADATA_OR_REVIEWED_HASH_MISMATCH', 'NATIVE_SUITE_HASH_MISMATCH',
  'NATIVE_PROVIDER_OR_NETWORK_IO_FORBIDDEN', 'EXACT_PRODUCTION_CONTRACT_REQUIRED',
  'PRODUCTION_RECEIPT_IDENTITY_MISMATCH', 'PRODUCTION_RECEIPT_SOURCE_MISMATCH',
  'PRODUCTION_VERSION_HASH_OR_RUNTIME_MISMATCH', 'EXACT_ORDERED_PRODUCTION_CASES_REQUIRED',
  'ACTUAL_PRODUCTION_CONTENDER_PIDS_REQUIRED', 'PRODUCTION_NAMESPACE_MISMATCH', 'FIXED_ORDERED_MANIFEST_MISMATCH',
  'FIXED_PRODUCTION_MEASUREMENTS_OR_CLEANUP_MISMATCH', 'PER_CASE_EXECUTING_PIDS_REQUIRED',
  'ACTUAL_PRODUCTION_CONTENDERS_AND_WAITS_REQUIRED', 'ACTUAL_LOCK_WAIT_REQUIRED',
  'NONCONTENTION_CASE_MUST_NOT_INVENT_CONTENDERS', 'EXACT_CASE_NAMESPACE_SET_REQUIRED',
  'ACTUAL_NAMESPACE_REMOVAL_REQUIRED', 'EXACT_PRODUCTION_NAMESPACE_UNION_REQUIRED',
  'CLOSED_RECEIPT_PROFILE_REQUIRED', 'TEAM_COVERAGE_NOT_APPROVED', 'NATIVE_OUTPUT_LIMIT',
  'EXACTLY_ONE_NATIVE_RECEIPT_REQUIRED', 'RECEIPT_LANE_GATE_OR_RUNNER_MISMATCH',
  'EXACT_PASSED_FAILED_SKIPPED_PENDING_COUNTS_REQUIRED', 'FAILED_SKIPPED_OR_PENDING_NATIVE_CASES',
  'OWNER_RECEIPT_EXACT_CLEAN_SOURCE_REQUIRED', 'EXACT_NAMED_CASE_RESULTS_REQUIRED', 'EXACT_REVIEWED_CASE_SET_REQUIRED',
  'PER_CASE_PASS_OWNER_PIDS_AND_COUNTS_REQUIRED', 'FIXED_PER_CASE_OWNER_COUNTS_MISMATCH',
  'TEAM_RECEIPT_IDENTITY_SOURCE_OR_CLEANUP_MISMATCH', 'ACTUAL_TEAM_NAMESPACE_REQUIRED', 'ACTUAL_POSTGRES16_OR_LATER_REQUIRED',
  'NORMAL_CI_OUTPUT_PATH_REQUIRED', 'SAFE_ARTIFACT_ID_REQUIRED', 'SAFE_ARTIFACT_DIRECTORY_REQUIRED',
  'PREEXISTING_ARTIFACT_ENTRY_FORBIDDEN', 'CURRENT_CASE_COVERAGE_NOT_ADJUDICATED',
  'OWNED_TREE_CLEANUP_FAILED_ROOT_FALLBACK_NOT_TREE_PROOF', 'NATIVE_CHILD_FAILED_OR_TIMED_OUT',
  'POSTEXECUTION_EXACT_CLEAN_SOURCE_REQUIRED', 'INTERNAL_CHILD_MARKER_REQUIRED', 'NATIVE_CHILD_DEADLINE',
  'NATIVE_ENTRY_FAILURE_DETAILS_SUPPRESSED',
]);
const failureStages = new Set(['unknown', 'arguments', 'environment', 'guards', 'source', 'coverage', 'hooks', 'output-path', 'child', 'post-source', 'post-hooks', 'receipt', 'artifact', 'outputs', 'failure-artifact', 'child-marker', 'network-policy', 'producer']);
const failureSignals = new Set(['SIGINT', 'SIGTERM', 'SIGKILL', 'SIGABRT', 'SIGSEGV', 'SIGBUS', 'SIGILL', 'SIGFPE', 'SIGHUP', 'SIGQUIT', 'SIGPIPE']);
const failureContexts = new WeakMap();
const sqlstates = new Set(['23505', '23503', '40P01', '55P03', '57014', '42P01', '42703']);
const setupPhases = ['module-load', 'setup', 'db-connect', 'fixture'];
const caseSevenSubsteps = ['raw-parent-insert', 'first-member-insert', 'duplicate-insert', 'duplicate-rejection', 'post-action-counts', 'cleanup-evidence'];
let producerProgress = null;
export function reportNativeProductionProgress(phase, ordinal = 0, error = null, substep = undefined) {
  if (!producerProgress) throw new NativeOwnerEntryError('NATIVE_ENTRY_FAILURE_DETAILS_SUPPRESSED');
  const progress = producerProgress;
  const previous = progress.substep;
  check((setupPhases.includes(phase) && phase !== 'module-load' && ordinal === 0 && progress.completed === 0 &&
      (phase === progress.phase || setupPhases.indexOf(phase) === setupPhases.indexOf(progress.phase) + 1)) ||
    (phase === 'scenario' && Number.isInteger(ordinal) && ordinal >= 1 && ordinal <= 28 && ordinal === progress.completed + 1 &&
      (progress.phase === 'fixture' || progress.phase === 'scenario')) ||
    (phase === 'passed' && ordinal === progress.ordinal && progress.phase === 'scenario'), 'NATIVE_ENTRY_FAILURE_DETAILS_SUPPRESSED');
  check(substep === undefined || (phase === 'scenario' && ordinal === 7 && progress.phase === 'scenario' &&
    ((previous === null && substep === caseSevenSubsteps[0]) ||
      (caseSevenSubsteps.indexOf(substep) === caseSevenSubsteps.indexOf(previous) + 1 && caseSevenSubsteps.includes(substep)))), 'NATIVE_ENTRY_FAILURE_DETAILS_SUPPRESSED');
  if (phase === 'passed') { progress.completed = ordinal; progress.sqlstate = null; progress.substep = null; }
  else {
    const keepRejectedSqlstate = phase === 'scenario' && ordinal === 7 && progress.phase === 'scenario' && progress.substep === 'duplicate-rejection' && substep === undefined;
    progress.substep = substep ?? (phase === 'scenario' && progress.phase === 'scenario' && progress.ordinal === ordinal ? previous : null);
    progress.phase = phase; progress.ordinal = ordinal;
    const code = error && Object.getOwnPropertyDescriptor(error, 'code')?.value;
    progress.sqlstate = sqlstates.has(code) ? code : keepRejectedSqlstate ? progress.sqlstate : null;
  }
}
function safeFailureCode(error) {
  try {
    const code = error instanceof NativeOwnerEntryError ? Object.getOwnPropertyDescriptor(error, 'code')?.value : null;
    if (failureCodes.has(code)) return code;
  } catch {}
  return 'NATIVE_ENTRY_FAILURE_DETAILS_SUPPRESSED';
}
function failureDiagnostic(error, context = {}) {
  const child = context.child;
  return {
    status: 'error', receiptValid: false, coverageAdjudicated: false, allNativeProofClaimed: false,
    code: safeFailureCode(error), stage: failureStages.has(context.stage) ? context.stage : 'unknown',
    requestedSha: sha(context.requestedSha) ? context.requestedSha : null,
    verifiedSourceSha: sha(context.verifiedSourceSha) ? context.verifiedSourceSha : null,
    childExit: Number.isInteger(child?.exitCode) && child.exitCode >= 0 && child.exitCode <= 255 ? child.exitCode : null,
    childSignal: failureSignals.has(child?.signal) ? child.signal : null,
    childTimedOut: typeof child?.timedOut === 'boolean' ? child.timedOut : null,
    childCode: failureCodes.has(child?.failureCode) && child.failureCode !== 'NATIVE_ENTRY_FAILURE_DETAILS_SUPPRESSED' ? child.failureCode : null,
    childPhase: [...setupPhases, 'scenario'].includes(child?.progress?.phase) ? child.progress.phase : null,
    childOrdinal: Number.isInteger(child?.progress?.ordinal) && child.progress.ordinal >= 0 && child.progress.ordinal <= 28 ? child.progress.ordinal : null,
    childCompleted: Number.isInteger(child?.progress?.completed) && child.progress.completed >= 0 && child.progress.completed <= 28 ? child.progress.completed : null,
    childSqlstate: sqlstates.has(child?.progress?.sqlstate) ? child.progress.sqlstate : null,
    childSubstep: child?.progress?.phase === 'scenario' && child.progress.ordinal === 7 && child.progress.completed === 6 && caseSevenSubsteps.includes(child.progress.substep) ? child.progress.substep : null,
  };
}
export function nativeFailureForTests(error) { return failureDiagnostic(error, failureContexts.get(error)); }
function childFailureProtocol(error, context) {
  const { status, receiptValid, coverageAdjudicated, allNativeProofClaimed, code, stage } = failureDiagnostic(error, context);
  return JSON.stringify({ format: 'NATIVE_OWNER_CHILD_FAILURE_V1', status, receiptValid, coverageAdjudicated, allNativeProofClaimed, code, stage, progress: context.progress ? { ...context.progress } : null });
}
function parseNativeChildFailure(text) {
  if (typeof text !== 'string' || Buffer.byteLength(text) > 4096) return null;
  try {
    const raw = JSON.parse(text);
    if (!raw || !same(Object.keys(raw).sort(), ['allNativeProofClaimed', 'code', 'coverageAdjudicated', 'format', 'progress', 'receiptValid', 'stage', 'status']) || raw.format !== 'NATIVE_OWNER_CHILD_FAILURE_V1' || raw.status !== 'error' || raw.receiptValid !== false || raw.coverageAdjudicated !== false || raw.allNativeProofClaimed !== false || !failureStages.has(raw.stage)) return null;
    if (raw.progress !== null && (raw.stage !== 'producer' || !raw.progress || !same(Object.keys(raw.progress).sort(), ['completed', 'ordinal', 'phase', 'sqlstate', 'substep']) || ![...setupPhases, 'scenario'].includes(raw.progress.phase) || !Number.isInteger(raw.progress.completed) || raw.progress.completed < 0 || raw.progress.completed > 28 || !Number.isInteger(raw.progress.ordinal) || (raw.progress.phase !== 'scenario' ? raw.progress.ordinal !== 0 || raw.progress.completed !== 0 : raw.progress.ordinal < 1 || raw.progress.ordinal > 28 || ![raw.progress.ordinal,raw.progress.ordinal-1].includes(raw.progress.completed)) || (raw.progress.sqlstate !== null && (!sqlstates.has(raw.progress.sqlstate) || ['module-load', 'setup'].includes(raw.progress.phase))) || (raw.progress.substep !== null && !(raw.progress.phase === 'scenario' && raw.progress.ordinal === 7 && raw.progress.completed === 6 && caseSevenSubsteps.includes(raw.progress.substep))))) return null;
    return failureCodes.has(raw.code) ? { code: raw.code === 'NATIVE_ENTRY_FAILURE_DETAILS_SUPPRESSED' ? null : raw.code, progress: raw.progress } : null;
  } catch { return null; }
}
export function parseNativeChildFailureCode(text) { return parseNativeChildFailure(text)?.code ?? null; }
export function parseNativeChildFailureForTests(text) { return parseNativeChildFailure(text); }

export function parseNativeArguments(argv, internal = false) {
  const result = {};
  const allowed = internal ? ['--native-child', '--expected-commit'] : ['--lane', '--expected-commit'];
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index], value = argv[index + 1];
    check(allowed.includes(key) && typeof value === 'string' && !value.startsWith('--'), 'INVALID_ARGUMENTS');
    const name = key === '--expected-commit' ? 'expectedCommit' : 'lane';
    check(result[name] === undefined, 'DUPLICATE_ARGUMENT'); result[name] = value;
  }
  check(Object.keys(result).length === 2 && Object.hasOwn(nativeOwnerRegistry, result.lane) && sha(result.expectedCommit), 'CLOSED_LANE_AND_EXACT_COMMIT_REQUIRED');
  return result;
}

export function prepareNativeEnvironment(options, source) {
  check(options && Object.keys(options).every(key => ['lane', 'expectedCommit'].includes(key)) && Object.hasOwn(nativeOwnerRegistry, options.lane) && sha(options.expectedCommit), 'CLOSED_LANE_AND_EXACT_COMMIT_REQUIRED');
  const profile = nativeOwnerRegistry[options.lane];
  check(source.V2_M0_POSTGRES_INTEGRATION === '1', 'NATIVE_OPT_IN_REQUIRED');
  check(source.GITHUB_ACTIONS === 'true' && source.GITHUB_REF === 'refs/heads/dev' && ['push', 'workflow_dispatch'].includes(source.GITHUB_EVENT_NAME), 'REVIEWED_DEV_CI_EVENT_REQUIRED');
  check(source.GITHUB_EVENT_NAME !== 'workflow_dispatch' || source.V2_NATIVE_OWNER_MANUAL_OPT_IN === '1', 'EXPLICIT_MANUAL_NATIVE_OPT_IN_REQUIRED');
  check(source.GITHUB_SHA === options.expectedCommit, 'GITHUB_SHA_MISMATCH');
  check(source.GITHUB_EVENT_NAME !== 'push' || source.V2_NATIVE_OWNER_EVENT_AFTER === options.expectedCommit, 'DEV_PUSH_AFTER_SHA_MISMATCH');
  check(source.V2_L0_NATIVE_EXPECTED_COMMIT === undefined || source.V2_L0_NATIVE_EXPECTED_COMMIT === options.expectedCommit, 'EXPECTED_COMMIT_ENV_MISMATCH');
  const alternate = Object.entries(source).some(([key, value]) => value?.trim() && (['DATABASE_URL', 'MIGRATION_DATABASE_URL', 'DIRECT_DATABASE_URL', 'V2_DATABASE_URL'].includes(key) || /^PG(?:_|[A-Z])/i.test(key) || /(?:CONNECTION_STRING|DB_URL|DB_URI)/i.test(key)) && key !== 'TEST_DATABASE_URL');
  check(!alternate, 'ALTERNATE_DATABASE_ENVIRONMENT_FORBIDDEN');
  check(typeof source.TEST_DATABASE_URL === 'string' && source.TEST_DATABASE_URL.trim(), 'TEST_DATABASE_URL_REQUIRED');
  let target;
  try { target = new URL(source.TEST_DATABASE_URL.trim()); } catch { throw new NativeOwnerEntryError('INVALID_TEST_DATABASE_URL'); }
  check(['postgres:', 'postgresql:'].includes(target.protocol) && target.hostname === '127.0.0.1' && (target.port || '5432') === '5432' && !target.hash && !target.search, 'ONLY_LITERAL_LOOPBACK_CI_POSTGRES_ALLOWED');
  let database;
  try { database = decodeURIComponent(target.pathname.slice(1)); } catch { throw new NativeOwnerEntryError('INVALID_TEST_DATABASE_NAME'); }
  check(database === profile.database, 'EXACT_LANE_DATABASE_REQUIRED');
  if (options.lane === 'production') check(source.V2_L0_LANE_F_NATIVE_APPROVED === '1' && source.V2_L0_LANE_F_APPROVED_NAME === profile.database, 'EXACT_PRODUCTION_TARGET_APPROVAL_REQUIRED');
  const env = { ...cleanEnvironment(source, 'qa'), TEST_DATABASE_URL: target.toString(), V2_M0_POSTGRES_INTEGRATION: '1', GITHUB_SHA: options.expectedCommit, V2_L0_NATIVE_EXPECTED_COMMIT: options.expectedCommit, NODE_TLS_REJECT_UNAUTHORIZED: '1' };
  if (options.lane === 'production') Object.assign(env, { V2_L0_LANE_F_NATIVE_APPROVED: '1', V2_L0_LANE_F_APPROVED_NAME: profile.database });
  for (const key of ['GITHUB_RUN_ID', 'GITHUB_RUN_ATTEMPT']) {
    check(typeof source[key] === 'string' && /^[1-9][0-9]{0,17}$/.test(source[key]), 'CI_RUN_METADATA_REQUIRED'); env[key] = source[key];
  }
  // The child repeats this preflight; these are nonsecret CI gates, not tokens.
  Object.assign(env, { GITHUB_ACTIONS: 'true', GITHUB_REF: 'refs/heads/dev', GITHUB_EVENT_NAME: source.GITHUB_EVENT_NAME, ...(source.GITHUB_EVENT_NAME === 'push' ? { V2_NATIVE_OWNER_EVENT_AFTER: source.V2_NATIVE_OWNER_EVENT_AFTER } : { V2_NATIVE_OWNER_MANUAL_OPT_IN: '1' }) });
  return { profile, env, target, expectedCommit: options.expectedCommit, lane: options.lane };
}

function loadActualGuards() {
  const { require: loadTs } = require('tsx/cjs/api');
  return {
    safe: loadTs(path.join(root, 'server/tests/helpers/safeTestDatabase.ts'), import.meta.url).requireSafeTestDatabaseUrl,
    clone: loadTs(path.join(root, 'v2/infrastructure/persistence/cloneSafety.ts'), import.meta.url).requireV2M0CloneDatabaseUrl,
  };
}
function guardPrepared(prepared, guards) {
  try { check(guards.safe(prepared.env) === prepared.env.TEST_DATABASE_URL && guards.clone(prepared.env) === prepared.env.TEST_DATABASE_URL, 'DATABASE_GUARD_RESULT_MISMATCH'); }
  catch (error) { if (error instanceof NativeOwnerEntryError) throw error; throw new NativeOwnerEntryError('EXISTING_DATABASE_GUARD_REJECTED'); }
}
function readSource(env) {
  try {
    const settings = { cwd: root, env, encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] };
    return { commit: execFileSync('git', ['rev-parse', 'HEAD'], settings).trim(), clean: !execFileSync('git', ['status', '--porcelain', '--untracked-files=normal'], settings).trim() };
  } catch { throw new NativeOwnerEntryError('SOURCE_PREFLIGHT_UNAVAILABLE'); }
}
function requireCoverageContract(contract) {
  check(contract && /^[a-f0-9]{64}$/.test(contract.hookSha256 ?? '') && Array.isArray(contract.cases) && contract.cases.length > 0 && contract.cases.length <= 256, 'REVIEWED_OWNER_COVERAGE_PENDING');
  const names = contract.cases.map(value => value.name);
  check((contract === productionCoverage || names.every(value => typeof value === 'string' && /^[a-z][a-z0-9-]{0,63}$/.test(value))) && new Set(names).size === names.length && names.includes(contract.summaryPidCase), 'INVALID_REVIEWED_CASE_CONTRACT');
  check(contract.cases.every(value => value.expectedCounts && Object.keys(value.expectedCounts).length > 0 && Object.entries(value.expectedCounts).every(([key, count]) => /^[a-z][a-zA-Z0-9]{0,63}$/.test(key) && Number.isSafeInteger(count) && count >= 0)), 'FIXED_OWNER_COUNT_CONTRACT_REQUIRED');
  return contract;
}
function verifyHooks(profile, contract, repositoryRoot = root) {
  check(contract === productionCoverage && profile === nativeOwnerRegistry.production && same(profile.files, Object.keys(contract.fileHashes)), 'REVIEWED_OWNER_COVERAGE_PENDING');
  const contents = new Map();
  for (const relative of profile.files) {
    const file = path.join(repositoryRoot, relative);
    check(fs.existsSync(file) && fs.lstatSync(file).isFile() && !fs.lstatSync(file).isSymbolicLink() && inside(repositoryRoot, fs.realpathSync(file)), 'EXACT_NATIVE_HOOK_FILE_REQUIRED');
    const bytes = fs.readFileSync(file);
    check(createHash('sha256').update(bytes).digest('hex') === contract.fileHashes[relative], 'NATIVE_HOOK_DEPENDENCY_HASH_MISMATCH');
    contents.set(relative, bytes);
  }
  check(contents.get(profile.suite).toString().includes(profile.marker) && contract.fileHashes[profile.suite] === contract.hookSha256, 'NATIVE_HOOK_METADATA_OR_REVIEWED_HASH_MISMATCH');
  check(createHash('sha256').update(contents.get(profile.suite)).update(contents.get('v2/tests/infrastructure/productionExclusiveMembership.request.sql')).digest('hex') === contract.suiteHash, 'NATIVE_SUITE_HASH_MISMATCH');
}
export function verifyNativeHooksForTests(repositoryRoot = root) { verifyHooks(nativeOwnerRegistry.production, productionCoverage, repositoryRoot); }

export function nativeSocketAllowed(options, target) {
  return Boolean(options && !options.path && options.host === '127.0.0.1' && String(options.port) === '5432' && target.hostname === '127.0.0.1' && (target.port || '5432') === '5432');
}
function installNetworkPolicy(target, transports) {
  const deny = () => { throw new NativeOwnerEntryError('NATIVE_PROVIDER_OR_NETWORK_IO_FORBIDDEN'); };
  transports.net.Server.prototype.listen = deny;
  const original = transports.net.Socket.prototype.connect;
  transports.net.Socket.prototype.connect = function (...args) {
    const values = Array.isArray(args[0]) ? args[0] : args;
    const options = typeof values[0] === 'object' ? values[0] : { port: values[0], host: typeof values[1] === 'string' ? values[1] : undefined };
    check(nativeSocketAllowed(options, target), 'NATIVE_PROVIDER_OR_NETWORK_IO_FORBIDDEN');
    return original.apply(this, args);
  };
  const secure = transports.tls.connect;
  transports.tls.connect = function (...args) {
    const options = typeof args[0] === 'object' ? args[0] : { port: args[0], host: args[1] };
    check(nativeSocketAllowed(options, target), 'NATIVE_PROVIDER_OR_NETWORK_IO_FORBIDDEN');
    return secure.apply(this, args);
  };
  for (const transport of [transports.http, transports.https]) for (const method of ['get', 'request']) transport[method] = deny;
  transports.dgram.createSocket = deny; transports.global.fetch = deny;
}
export function installNativeNetworkPolicyForTests(target, transports) { installNetworkPolicy(target, transports); }

function validateProductionReceipt(raw, prepared, source, contract) {
  check(contract === productionCoverage, 'EXACT_PRODUCTION_CONTRACT_REQUIRED');
  check(raw.receiptVersion === 1 && raw.status === 'pass' && raw.suite === 'production-exclusive-membership', 'PRODUCTION_RECEIPT_IDENTITY_MISMATCH');
  check(raw.sourceCommit === prepared.expectedCommit && raw.GITHUB_SHA === prepared.expectedCommit && raw.sourceCommitAfter === prepared.expectedCommit && raw.sourceCleanBefore === true && raw.sourceCleanAfter === true, 'PRODUCTION_RECEIPT_SOURCE_MISMATCH');
  check(Number.isSafeInteger(raw.serverVersionNum) && raw.serverVersionNum >= 160000 && raw.suiteHash === contract.suiteHash && raw.runtimeCreationEnabled === false, 'PRODUCTION_VERSION_HASH_OR_RUNTIME_MISMATCH');
  check(Array.isArray(raw.manifest) && raw.manifest.length === 28 && Array.isArray(raw.cases) && raw.cases.length === 28, 'EXACT_ORDERED_PRODUCTION_CASES_REQUIRED');
  const countsMatch = (actual, expected) => actual && !Array.isArray(actual) && same(Object.keys(actual).sort(), Object.keys(expected).sort()) && Object.entries(expected).every(([key, value]) => Number.isSafeInteger(actual[key]) && actual[key] >= 0 && actual[key] === value);
  const zero = Object.fromEntries(countKeys.map(key => [key, 0]));
  const first = raw.cases[0];
  const pids = first.executingBackendPids;
  check(pair(pids), 'ACTUAL_PRODUCTION_CONTENDER_PIDS_REQUIRED');
  const primary = first.namespaceIdentifiers?.[0];
  check(typeof primary === 'string' && /^l0_production_test_[a-f0-9]{32}$/.test(primary), 'PRODUCTION_NAMESPACE_MISMATCH');
  const identifiers = new Set();
  const caseDetails = contract.cases.map((expected, index) => {
    const manifest = raw.manifest[index], actual = raw.cases[index];
    check(manifest && same(Object.keys(manifest).sort(), ['expectedCounts','kind','name']) && manifest.name === expected.name && manifest.kind === expected.kind && countsMatch(manifest.expectedCounts, expected.expectedCounts), 'FIXED_ORDERED_MANIFEST_MISMATCH');
    check(actual && actual.name === expected.name && actual.kind === expected.kind && actual.status === 'pass' && countsMatch(actual.expectedCounts, expected.expectedCounts) && countsMatch(actual.measuredCounts, expected.expectedCounts) && countsMatch(actual.cleanupCounts, zero), 'FIXED_PRODUCTION_MEASUREMENTS_OR_CLEANUP_MISMATCH');
    check(Array.isArray(actual.executingBackendPids) && actual.executingBackendPids.length >= 1 && actual.executingBackendPids.length <= 2 && new Set(actual.executingBackendPids).size === actual.executingBackendPids.length && actual.executingBackendPids.every(pid => pids.includes(pid)), 'PER_CASE_EXECUTING_PIDS_REQUIRED');
    let contenders;
    if (expected.kind === 'concurrency') {
      const observed = actual.contenders;
      check(observed && observed.distinct === true && same(actual.executingBackendPids, pids) && same([observed.backendPidA, observed.backendPidB], pids) && Array.isArray(observed.blockedWaits) && observed.blockedWaits.length > 0, 'ACTUAL_PRODUCTION_CONTENDERS_AND_WAITS_REQUIRED');
      check(observed.blockedWaits.every(wait => wait && wait.backendPid === pids[1] && wait.waitEventType === 'Lock' && (typeof wait.waitEvent === 'string' || wait.waitEvent === null)), 'ACTUAL_LOCK_WAIT_REQUIRED');
      contenders = { backendPidA: observed.backendPidA, backendPidB: observed.backendPidB, distinct: observed.distinct, blockedWaits: observed.blockedWaits.map(wait => ({ backendPid: wait.backendPid, waitEventType: wait.waitEventType, waitEvent: wait.waitEvent })) };
    } else {
      check(actual.contenders === 'not_applicable', 'NONCONTENTION_CASE_MUST_NOT_INVENT_CONTENDERS');
      contenders = actual.contenders;
    }
    const names = actual.namespaceIdentifiers;
    check(Array.isArray(names) && names.length === (index === 21 ? 2 : 1) && names.every(name => typeof name === 'string') && names[0] === primary && new Set(names).size === names.length && (index !== 21 || /^l0_production_history_[a-f0-9]{32}$/.test(names[1])), 'EXACT_CASE_NAMESPACE_SET_REQUIRED');
    check(Array.isArray(actual.namespaces) && same(actual.namespaces.map(value => value?.identifier), names) && actual.namespaces.every(value => value.removed === true), 'ACTUAL_NAMESPACE_REMOVAL_REQUIRED');
    names.forEach(name => identifiers.add(name));
    return { name: actual.name, kind: actual.kind, status: actual.status, expectedCounts: { ...actual.expectedCounts }, measuredCounts: { ...actual.measuredCounts }, cleanupCounts: { ...actual.cleanupCounts }, namespaceIdentifiers: [...names], namespaces: actual.namespaces.map(value => ({ identifier: value.identifier, removed: value.removed })), executingBackendPids: [...actual.executingBackendPids], contenders };
  });
  check(identifiers.size === 2, 'EXACT_PRODUCTION_NAMESPACE_UNION_REQUIRED');
  return { format: 'OWNER_NATIVE_RECEIPT_V1', receiptVersion: raw.receiptVersion, status: raw.status, receiptValid: true, coverageAdjudicated: true, lane: raw.lane, gate: raw.gate, suite: raw.suite, runner: raw.runner, sha: source.commit, sourceCommit: raw.sourceCommit, GITHUB_SHA: raw.GITHUB_SHA, sourceCommitAfter: raw.sourceCommitAfter, sourceClean: source.clean, sourceCleanBefore: raw.sourceCleanBefore, sourceCleanAfter: raw.sourceCleanAfter, serverVersionNum: raw.serverVersionNum, suiteHash: raw.suiteHash, cases: raw.passedCases, passedCases: raw.passedCases, failedCases: raw.failedCases, skippedCases: raw.skippedCases, pendingCases: raw.pendingCases, pidCase: caseDetails[0].name, backendPidA: pids[0], backendPidB: pids[1], namespace: primary, namespaceNameEmitted: true, namespaceRemoved: caseDetails.every(value => value.namespaces.every(namespace => namespace.removed)), caseDetails, runtimeCreationEnabled: raw.runtimeCreationEnabled, selectedLaneProof: 'production', allNativeProofClaimed: false };
}

function validateReceipt(stdout, prepared, source, contract) {
  check(prepared && Object.hasOwn(nativeOwnerRegistry, prepared.lane) && prepared.profile === nativeOwnerRegistry[prepared.lane] && sha(prepared.expectedCommit), 'CLOSED_RECEIPT_PROFILE_REQUIRED');
  check(source.clean === true && source.commit === prepared.expectedCommit, 'EXACT_CLEAN_SOURCE_REQUIRED');
  requireCoverageContract(contract);
  check(prepared.lane !== 'team' || contract !== productionCoverage, 'TEAM_COVERAGE_NOT_APPROVED');
  check(typeof stdout === 'string' && Buffer.byteLength(stdout) <= 1024 * 1024, 'NATIVE_OUTPUT_LIMIT');
  const lines = stdout.split(/\r?\n/);
  const parse = value => { try { return JSON.parse(value); } catch { return null; } };
  const candidates = prepared.lane === 'team' ? lines.filter(line => line.startsWith('ACCESS05_NATIVE_RECEIPT ')).map(line => parse(line.slice('ACCESS05_NATIVE_RECEIPT '.length))) : lines.map(line => parse(line.trim())).filter(value => value?.gate === 'OPS12-native');
  check(candidates.length === 1 && candidates[0], 'EXACTLY_ONE_NATIVE_RECEIPT_REQUIRED');
  const raw = candidates[0];
  check(raw.lane === prepared.lane && raw.gate === prepared.profile.gate && raw.runner === 'tsx', 'RECEIPT_LANE_GATE_OR_RUNNER_MISMATCH');
  check(raw.passedCases === contract.cases.length && raw.failedCases === 0 && raw.skippedCases === 0 && raw.pendingCases === 0, 'EXACT_PASSED_FAILED_SKIPPED_PENDING_COUNTS_REQUIRED');
  for (const key of ['failed', 'skipped', 'pending', 'failedTests', 'skippedTests', 'pendingTests']) if (raw[key] !== undefined) check(raw[key] === 0, 'FAILED_SKIPPED_OR_PENDING_NATIVE_CASES');
  if (prepared.lane === 'production') return validateProductionReceipt(raw, prepared, source, contract);
  check(raw.sourceCommit === prepared.expectedCommit && raw.GITHUB_SHA === prepared.expectedCommit && raw.sourceClean === true, 'OWNER_RECEIPT_EXACT_CLEAN_SOURCE_REQUIRED');
  check(Array.isArray(raw.caseResults) && raw.caseResults.length === contract.cases.length, 'EXACT_NAMED_CASE_RESULTS_REQUIRED');
  const names = raw.caseResults.map(value => value.name);
  check(new Set(names).size === names.length && same([...names].sort(), contract.cases.map(value => value.name).sort()), 'EXACT_REVIEWED_CASE_SET_REQUIRED');
  const caseDetails = contract.cases.map(expected => {
    const actual = raw.caseResults.find(value => value.name === expected.name);
    check(actual.status === 'pass' && pair(actual.backendPids) && actual.counts && same(Object.keys(actual.counts).sort(), Object.keys(expected.expectedCounts).sort()), 'PER_CASE_PASS_OWNER_PIDS_AND_COUNTS_REQUIRED');
    check(Object.entries(expected.expectedCounts).every(([key, count]) => actual.counts[key] === count), 'FIXED_PER_CASE_OWNER_COUNTS_MISMATCH');
    return { name: actual.name, status: actual.status, backendPids: [...actual.backendPids], counts: { ...actual.counts } };
  });
  const summary = caseDetails.find(value => value.name === contract.summaryPidCase);
  let version, namespace;
  check(raw.status === 'PASS' && raw.suite === prepared.profile.suite && raw.githubSha === prepared.expectedCommit && raw.schemaRemoved === true && raw.caseCount === raw.passedCases, 'TEAM_RECEIPT_IDENTITY_SOURCE_OR_CLEANUP_MISMATCH');
  check(/^team_floor_test_[a-z0-9_]{1,18}_[a-f0-9]{24}$/.test(raw.namespace ?? ''), 'ACTUAL_TEAM_NAMESPACE_REQUIRED');
  version = raw.serverVersionNum; namespace = raw.namespace;
  check(Number.isSafeInteger(version) && version >= 160000, 'ACTUAL_POSTGRES16_OR_LATER_REQUIRED');
  return { format: 'OWNER_NATIVE_RECEIPT_V1', status: 'pass', receiptValid: true, coverageAdjudicated: true, lane: prepared.lane, gate: prepared.profile.gate, suite: prepared.profile.suite, sha: source.commit, sourceClean: true, serverVersionNum: version, cases: raw.passedCases, passedCases: raw.passedCases, failedCases: 0, skippedCases: 0, pendingCases: 0, pidCase: summary.name, backendPidA: summary.backendPids[0], backendPidB: summary.backendPids[1], namespace, namespaceNameEmitted: true, namespaceRemoved: true, caseDetails, runtimeCreationEnabled: null, allNativeProofClaimed: false };
}
export function validateNativeReceipt(stdout, prepared, source) { return validateReceipt(stdout, prepared, source, prepared.profile.coverageContract); }
export function validateNativeReceiptForTests(stdout, prepared, source, contract) { return validateReceipt(stdout, prepared, source, contract); }

function stopWindowsOwnedTree(child, env, spawnKiller = spawn) {
  return new Promise(resolve => {
    let complete = false, bound, killer;
    const ended = failureCode => {
      if (complete) return; complete = true; clearTimeout(bound);
      const diagnostics = { treeCleanupFailed: Boolean(failureCode), treeCleanupFailureCode: failureCode ?? null, rootFallbackAttempted: Boolean(failureCode), rootFallbackFailed: false };
      if (failureCode) {
        // Root-only fallback cannot establish descendant-tree cleanup.
        try { diagnostics.rootFallbackFailed = child.kill('SIGKILL') === false; } catch { diagnostics.rootFallbackFailed = true; }
      }
      resolve(diagnostics);
    };
    try { killer = spawnKiller('taskkill', ['/PID', String(child.pid), '/T', '/F'], { env, stdio: 'ignore', windowsHide: true }); }
    catch { ended('WINDOWS_TREE_KILL_SPAWN_FAILED'); return; }
    bound = setTimeout(() => {
      try { killer.kill(); } catch {} killer.unref(); ended('WINDOWS_TREE_KILL_TIMEOUT');
    }, 1500);
    killer.on('error', () => ended('WINDOWS_TREE_KILL_SPAWN_FAILED'));
    killer.on('close', (code, signal) => ended(signal ? 'WINDOWS_TREE_KILL_SIGNALED' : code === 0 ? null : 'WINDOWS_TREE_KILL_EXIT_FAILED'));
  });
}
export function stopWindowsOwnedTreeForTests(child, env, spawnKiller) { return stopWindowsOwnedTree(child, env, spawnKiller); }

function runOwnedProcess(args, env, timeoutMs, signals = process, onOutput = null) {
  return new Promise(resolve => {
    const child = spawn(process.execPath, args, { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, detached: process.platform !== 'win32' });
    let stdout = '', stderrProtocol = '', stdoutBytes = 0, stderrBytes = 0, timedOut = false, limited = false, spawnFailed = false, interrupted = false, cleanupBoundedOut = false;
    let childExit = null, childSignal = null;
    let settled = false, closed = false, exitCode = 1, cleanup, cleanupCap, drainCap;
    const treeDiagnostics = { treeCleanupFailed: false, treeCleanupFailureCode: null, rootFallbackAttempted: false, rootFallbackFailed: false };
    const finish = () => {
      if (settled) return; settled = true;
      clearTimeout(timer); clearTimeout(cleanupCap); clearTimeout(drainCap);
      signals.removeListener('SIGINT', interrupt); signals.removeListener('SIGTERM', interrupt);
      child.stdout?.destroy(); child.stderr?.destroy(); if (!closed) child.unref();
       const protocol = parseNativeChildFailure(stderrProtocol);
       resolve({ code: timedOut || interrupted || limited || spawnFailed || cleanupBoundedOut || treeDiagnostics.treeCleanupFailed ? 1 : exitCode, stdout, diagnostics: { stdoutBytes, stderrBytes, timedOut, interrupted, outputLimited: limited, spawnFailed, cleanupBoundedOut, ...treeDiagnostics, exitCode: childExit, signal: childSignal, failureCode: protocol?.code ?? null, progress: protocol?.progress ?? null } });
    };
    const stop = () => {
      if (cleanup) return;
      clearTimeout(timer);
      // Owned-tree cleanup, not a wait for arbitrary descendants to close pipes.
      cleanupCap = setTimeout(() => { cleanupBoundedOut = true; try { child.kill('SIGKILL'); } catch {} finish(); }, 2500);
      cleanup = Promise.resolve().then(async () => {
        if (!child.pid) return;
        if (process.platform === 'win32') {
          Object.assign(treeDiagnostics, await stopWindowsOwnedTree(child, env));
        } else {
          try { process.kill(-child.pid, 'SIGTERM'); } catch { try { child.kill('SIGTERM'); } catch {} }
          await new Promise(done => setTimeout(done, 100));
          try { process.kill(-child.pid, 'SIGKILL'); } catch { try { child.kill('SIGKILL'); } catch {} }
        }
      }).catch(() => { cleanupBoundedOut = true; }).then(() => {
        if (settled) return;
        if (closed) finish();
        else drainCap = setTimeout(() => { cleanupBoundedOut = true; finish(); }, 500);
      });
    };
    const interrupt = () => { interrupted = true; stop(); };
    const timer = setTimeout(() => { timedOut = true; stop(); }, timeoutMs);
    signals.on('SIGINT', interrupt); signals.on('SIGTERM', interrupt);
    child.stdout.on('data', chunk => { stdoutBytes += chunk.length; if (stdoutBytes <= 1024 * 1024) { stdout += chunk; onOutput?.(stdout); } else { limited = true; stop(); } });
    child.stderr.on('data', chunk => { stderrBytes += chunk.length; stderrProtocol = stderrBytes <= 4096 ? stderrProtocol + chunk : ''; if (stderrBytes > 1024 * 1024) { limited = true; stop(); } });
    child.on('error', () => { spawnFailed = true; stop(); });
    child.on('close', (code, signal) => { closed = true; exitCode = code ?? 1; childExit = Number.isInteger(code) && code >= 0 && code <= 255 ? code : null; childSignal = failureSignals.has(signal) ? signal : null; if (!cleanup) finish(); });
  });
}
function runChild(args, env, timeoutMs) { return runOwnedProcess(args, env, timeoutMs); }
export function runOwnedProcessForTests(args, env, timeoutMs, signals, onOutput) { return runOwnedProcess(args, env, timeoutMs, signals, onOutput); }
function githubOutputFile(source) {
  if (!source.GITHUB_OUTPUT) return null;
  check(source.GITHUB_ACTIONS === 'true' && path.isAbsolute(source.RUNNER_TEMP ?? '') && path.isAbsolute(source.GITHUB_OUTPUT), 'NORMAL_CI_OUTPUT_PATH_REQUIRED');
  const temp = fs.realpathSync(source.RUNNER_TEMP), file = source.GITHUB_OUTPUT;
  check(fs.lstatSync(file).isFile() && !fs.lstatSync(file).isSymbolicLink() && path.dirname(fs.realpathSync(file)) === path.join(temp, '_runner_file_commands') && /^set_output_[a-f0-9-]{36}$/i.test(path.basename(file)), 'NORMAL_CI_OUTPUT_PATH_REQUIRED');
  return file;
}
function writeArtifact(repositoryRoot, lane, result, nonce = randomUUID()) {
  check(Object.hasOwn(nativeOwnerRegistry, lane) && /^[a-f0-9-]{36}$/i.test(nonce), 'SAFE_ARTIFACT_ID_REQUIRED');
  const directory = path.join(repositoryRoot, '.cache/v2-validation/native-owner');
  for (const relative of ['.cache', '.cache/v2-validation', '.cache/v2-validation/native-owner']) {
    const folder = path.join(repositoryRoot, relative);
    try { fs.mkdirSync(folder); } catch (error) { check(error.code === 'EEXIST', 'SAFE_ARTIFACT_DIRECTORY_REQUIRED'); }
    check(fs.lstatSync(folder).isDirectory() && !fs.lstatSync(folder).isSymbolicLink() && inside(repositoryRoot, fs.realpathSync(folder)), 'SAFE_ARTIFACT_DIRECTORY_REQUIRED');
  }
  const file = path.join(directory, `${lane}.json`), temporary = path.join(directory, `.${lane}-${nonce}.tmp`);
  try { fs.lstatSync(temporary); throw new NativeOwnerEntryError('PREEXISTING_ARTIFACT_ENTRY_FORBIDDEN'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  // lstat catches dangling reparse entries; wx atomically rejects file reuse.
  const descriptor = fs.openSync(temporary, 'wx', 0o600);
  try {
    try { fs.writeFileSync(descriptor, `${JSON.stringify(result, null, 2)}\n`); fs.fsyncSync(descriptor); } finally { fs.closeSync(descriptor); }
    fs.renameSync(temporary, file);
  } finally { try { fs.unlinkSync(temporary); } catch (error) { if (error.code !== 'ENOENT') throw error; } }
}
function saveArtifact(lane, result) { writeArtifact(root, lane, result); }
export function writeNativeArtifactForTests(repositoryRoot, lane, result, nonce) { writeArtifact(repositoryRoot, lane, result, nonce); }
function appendOutputs(file, receipt) {
  if (!file) return;
  check(receipt.receiptValid === true && receipt.coverageAdjudicated === true, 'CURRENT_CASE_COVERAGE_NOT_ADJUDICATED');
  const publicName = 'OWNER_NATIVE_RECEIPT_V1 ' + JSON.stringify({ lane: receipt.lane, gate: receipt.gate, sha: receipt.sha, cases: receipt.cases, pidCase: receipt.pidCase, pidA: receipt.backendPidA, pidB: receipt.backendPidB, server: receipt.serverVersionNum, removed: receipt.namespaceRemoved, namespace: receipt.namespace });
  const fields = { lane: receipt.lane, sha: receipt.sha, pidA: receipt.backendPidA, pidB: receipt.backendPidB, pids: JSON.stringify([receipt.backendPidA, receipt.backendPidB]), cases: receipt.cases, namespace: receipt.namespace, namespaceNameEmitted: receipt.namespaceNameEmitted, serverVersionNum: receipt.serverVersionNum, receiptValid: receipt.receiptValid, coverageAdjudicated: receipt.coverageAdjudicated, publicName };
  fs.appendFileSync(file, Object.entries(fields).map(([key, value]) => `${key}=${value}`).join('\n') + '\n');
}
const dependencies = { loadGuards: loadActualGuards, readSource, readCoverage: profile => profile.coverageContract, verifyHooks, runChild, githubOutputFile, saveArtifact, appendOutputs };
async function executeController(options, sourceEnv, services, context) {
  context.stage = 'environment';
  const prepared = prepareNativeEnvironment(options, sourceEnv);
  context.stage = 'guards';
  guardPrepared(prepared, services.loadGuards());
  context.stage = 'source';
  const source = services.readSource(prepared.env);
  check(source.commit === prepared.expectedCommit && source.clean === true, 'EXACT_CLEAN_SOURCE_REQUIRED');
  context.verifiedSourceSha = source.commit;
  context.stage = 'coverage';
  const coverage = requireCoverageContract(services.readCoverage(prepared.profile));
  check(prepared.lane !== 'production' || coverage === productionCoverage, 'EXACT_PRODUCTION_CONTRACT_REQUIRED');
  check(prepared.lane !== 'team' || coverage !== productionCoverage, 'TEAM_COVERAGE_NOT_APPROVED');
  context.stage = 'hooks'; services.verifyHooks(prepared.profile, coverage);
  context.stage = 'output-path';
  const outputFile = services.githubOutputFile(sourceEnv);
  const env = { ...prepared.env, V2_NATIVE_OWNER_CHILD: '1' };
  let result, cleanupFailureCode;
  try {
    context.stage = 'child';
    const child = await services.runChild(['--import', 'tsx', entry, '--native-child', prepared.lane, '--expected-commit', prepared.expectedCommit], env, prepared.profile.timeoutMs);
    context.child = child.diagnostics;
    if (child.diagnostics.treeCleanupFailed) {
      cleanupFailureCode = ['WINDOWS_TREE_KILL_SPAWN_FAILED', 'WINDOWS_TREE_KILL_SIGNALED', 'WINDOWS_TREE_KILL_EXIT_FAILED', 'WINDOWS_TREE_KILL_TIMEOUT'].includes(child.diagnostics.treeCleanupFailureCode) ? child.diagnostics.treeCleanupFailureCode : 'OWNED_TREE_CLEANUP_FAILED';
      throw new NativeOwnerEntryError('OWNED_TREE_CLEANUP_FAILED_ROOT_FALLBACK_NOT_TREE_PROOF');
    }
    check(child.code === 0 && !child.diagnostics.timedOut && !child.diagnostics.interrupted && !child.diagnostics.outputLimited && !child.diagnostics.spawnFailed && !child.diagnostics.cleanupBoundedOut && !child.diagnostics.treeCleanupFailed, 'NATIVE_CHILD_FAILED_OR_TIMED_OUT');
    context.stage = 'post-source';
    const after = services.readSource(prepared.env);
    check(after.clean === true && after.commit === source.commit && after.commit === prepared.expectedCommit, 'POSTEXECUTION_EXACT_CLEAN_SOURCE_REQUIRED');
    context.stage = 'post-hooks'; services.verifyHooks(prepared.profile, coverage);
    context.stage = 'receipt';
    result = { ...validateReceipt(child.stdout, prepared, after, coverage), diagnostics: child.diagnostics };
    context.stage = 'artifact';
    services.saveArtifact(prepared.lane, result);
    context.stage = 'outputs';
    services.appendOutputs(outputFile, result);
    return result;
  } catch (error) {
    const failure = failureDiagnostic(error, context);
    try { services.saveArtifact(prepared.lane, { ...failure, lane: prepared.lane, sha: source.commit, ...(cleanupFailureCode ? { treeCleanupFailed: true, treeCleanupFailureCode: cleanupFailureCode, rootFallbackIsNotFullTreeCleanup: true } : {}) }); }
    catch (artifactError) { context.stage = 'failure-artifact'; throw artifactError; }
    throw error;
  }
}
async function runController(options, sourceEnv, services) {
  const context = { requestedSha: options?.expectedCommit };
  try { return await executeController(options, sourceEnv, services, context); }
  catch (error) {
    const safe = new NativeOwnerEntryError(safeFailureCode(error));
    failureContexts.set(safe, context); throw safe;
  }
}
export function runNativeOwnerEntry(options, sourceEnv = process.env) { return runController(options, sourceEnv, dependencies); }
// Explicit module-level DI for unit tests only. CLI has no test/bypass switch.
export function runNativeOwnerEntryForTests(options, sourceEnv, overrides) { return runController(options, sourceEnv, { ...dependencies, ...overrides }); }

async function executeInternalChild(options, context) {
  context.stage = 'child-marker';
  check(process.env.V2_NATIVE_OWNER_CHILD === '1', 'INTERNAL_CHILD_MARKER_REQUIRED');
  context.stage = 'environment';
  const prepared = prepareNativeEnvironment(options, process.env);
  context.stage = 'guards';
  guardPrepared(prepared, loadActualGuards());
  context.stage = 'source';
  const source = readSource(prepared.env);
  check(source.clean === true && source.commit === prepared.expectedCommit, 'EXACT_CLEAN_SOURCE_REQUIRED');
  context.verifiedSourceSha = source.commit; context.stage = 'coverage';
  const coverage = requireCoverageContract(prepared.profile.coverageContract);
  context.stage = 'hooks'; verifyHooks(prepared.profile, coverage);
  context.stage = 'network-policy';
  installNetworkPolicy(prepared.target, { net, tls, http, https, dgram, global: globalThis }); syncBuiltinESMExports();
  process.argv = [process.execPath, path.join(root, prepared.profile.suite), ...prepared.profile.args];
  if (prepared.lane === 'production') {
    context.progress = { phase: 'module-load', ordinal: 0, completed: 0, sqlstate: null, substep: null };
    producerProgress = context.progress;
  }
  const deadline = setTimeout(() => { console.error(childFailureProtocol(new NativeOwnerEntryError('NATIVE_CHILD_DEADLINE'), context)); process.exit(1); }, prepared.profile.timeoutMs);
  deadline.unref();
  try {
    context.stage = 'producer';
    await import(pathToFileURL(process.argv[1]).href);
    context.progress = null;
    context.stage = 'post-source';
    const after = readSource(prepared.env);
    check(after.clean === true && after.commit === source.commit, 'POSTEXECUTION_EXACT_CLEAN_SOURCE_REQUIRED');
    context.stage = 'post-hooks'; verifyHooks(prepared.profile, coverage);
  } finally { producerProgress = null; clearTimeout(deadline); }
}
async function executeCli(argv, sourceEnv, services, write, writeError) {
  const internal = argv[0] === '--native-child';
  const context = { stage: 'arguments' };
  try {
    const options = parseNativeArguments(argv, internal); context.requestedSha = options.expectedCommit;
    if (internal) { await services.internalChild(options, context); return 0; }
    const result = await runController(options, sourceEnv, services);
    write(JSON.stringify(result)); return 0;
  } catch (error) {
    const failureContext = failureContexts.get(error) ?? context;
    if (internal) writeError(childFailureProtocol(error, failureContext));
    else {
      const json = JSON.stringify(failureDiagnostic(error, failureContext));
      writeError(json);
      if (sourceEnv.GITHUB_ACTIONS === 'true') writeError(`::error title=Native Owner Failure::${json}`);
    }
    return 1;
  }
}
export function main(argv = process.argv.slice(2)) { return executeCli(argv, process.env, { ...dependencies, internalChild: executeInternalChild }, value => console.log(value), value => console.error(value)); }
export function runNativeOwnerCliForTests(argv, sourceEnv, overrides, write, writeError) { return executeCli(argv, sourceEnv, { ...dependencies, internalChild: executeInternalChild, ...overrides }, write, writeError); }
if (process.argv[1] && path.resolve(process.argv[1]) === entry) main().then(code => { process.exitCode = code; });
