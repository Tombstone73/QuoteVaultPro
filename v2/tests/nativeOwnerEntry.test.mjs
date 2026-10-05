import assert from 'node:assert/strict';
import { test } from 'node:test';
import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { EventEmitter } from 'node:events';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { runInNewContext } from 'node:vm';
import yaml from 'js-yaml';
import { cleanEnvironment } from '../scripts/validate.mjs';
import { nativeOwnerRegistry, parseNativeArguments, prepareNativeEnvironment, nativeSocketAllowed, installNativeNetworkPolicyForTests, validateNativeReceipt, validateNativeReceiptForTests, runNativeOwnerEntryForTests, runOwnedProcessForTests, writeNativeArtifactForTests, stopWindowsOwnedTreeForTests, verifyNativeHooksForTests } from '../scripts/native-owner-entry.mjs';

// Synthetic unit contracts only. They are not B/E case names or native proof.
const commit = 'a'.repeat(40);
const contract = (lane = 'team') => lane === 'production' ? nativeOwnerRegistry.production.coverageContract : ({ hookSha256: 'f'.repeat(64), summaryPidCase: 'synthetic-race', cases: [{ name: 'synthetic-race', expectedCounts: { retained: 1 } }, { name: 'synthetic-retry', expectedCounts: { receipts: 1 } }] });
const options = lane => ({ lane, expectedCommit: commit });
const environment = lane => ({ PATH: process.env.PATH, SYSTEMROOT: process.env.SYSTEMROOT, HOME: process.env.HOME, CI: 'true', GITHUB_ACTIONS: 'true', GITHUB_EVENT_NAME: 'push', GITHUB_REF: 'refs/heads/dev', GITHUB_SHA: commit, V2_NATIVE_OWNER_EVENT_AFTER: commit, GITHUB_RUN_ID: '12345', GITHUB_RUN_ATTEMPT: '1', V2_M0_POSTGRES_INTEGRATION: '1', TEST_DATABASE_URL: `postgresql://native_ci:dummyPostgres@127.0.0.1:5432/${nativeOwnerRegistry[lane].database}`, ...(lane === 'production' ? { V2_L0_LANE_F_NATIVE_APPROVED: '1', V2_L0_LANE_F_APPROVED_NAME: 'v2_native_b_ci_test' } : {}) });
// These receipts are synthetic validator inputs, never observed PostgreSQL evidence.
const receipt = lane => lane === 'production' ? {
  receiptVersion: 1, lane, gate: 'OPS12-native', runner: 'tsx', suite: 'production-exclusive-membership', status: 'pass', sourceCommit: commit, GITHUB_SHA: commit, sourceCommitAfter: commit, sourceCleanBefore: true, sourceCleanAfter: true, serverVersionNum: 160010, suiteHash: contract(lane).suiteHash, manifest: structuredClone(contract(lane).cases), passedCases: 28, failedCases: 0, skippedCases: 0, pendingCases: 0, runtimeCreationEnabled: false,
  cases: contract(lane).cases.map((value, index) => {
    const names = [`l0_production_test_${'b'.repeat(32)}`, ...(index === 21 ? [`l0_production_history_${'c'.repeat(32)}`] : [])];
    return { ...structuredClone(value), status: 'pass', measuredCounts: { ...value.expectedCounts }, cleanupCounts: { runs: 0, allocations: 0, activeMemberships: 0, operationReceipts: 0, outputEvents: 0, reworkCycles: 0 }, namespaceIdentifiers: names, namespaces: names.map(identifier => ({ identifier, removed: true })), executingBackendPids: value.kind === 'concurrency' ? [101,102] : [101], contenders: value.kind === 'concurrency' ? { backendPidA: 101, backendPidB: 102, distinct: true, blockedWaits: [{ backendPid: 102, waitEventType: 'Lock', waitEvent: 'transactionid' }] } : 'not_applicable' };
  }),
} : ({ lane, gate: nativeOwnerRegistry[lane].gate, runner: 'tsx', suite: nativeOwnerRegistry.team.suite, status: 'PASS', sourceCommit: commit, GITHUB_SHA: commit, githubSha: commit, sourceClean: true, caseCount: 2, passedCases: 2, failedCases: 0, skippedCases: 0, pendingCases: 0, caseResults: contract().cases.map(value => ({ name: value.name, status: 'pass', backendPids: [101,102], counts: { ...value.expectedCounts } })), serverVersionNum: 160010, namespace: `team_floor_test_12345_1_${'b'.repeat(24)}`, schemaRemoved: true });
const stdout = (lane, raw) => lane === 'team' ? `Human log is not proof\nACCESS05_NATIVE_RECEIPT ${JSON.stringify(raw)}\n` : JSON.stringify(raw);
const parseReceipt = (lane, raw) => validateNativeReceiptForTests(stdout(lane, raw), prepareNativeEnvironment(options(lane), environment(lane)), { commit, clean: true }, contract(lane));
const cache = fileURLToPath(new URL('../../.cache/v2-validation/', import.meta.url));

function services(lane, overrides = {}) {
  const calls = [];
  const result = { code: 0, stdout: stdout(lane, receipt(lane)), diagnostics: { stdoutBytes: 100, stderrBytes: 0, timedOut: false, interrupted: false, outputLimited: false, spawnFailed: false, cleanupBoundedOut: false } };
  const dependencies = {
    readSource: () => { calls.push('source'); return { commit, clean: true }; },
    readCoverage: () => contract(lane),
    verifyHooks: () => { calls.push('hooks'); },
    githubOutputFile: () => { calls.push('output-path'); return null; },
    runChild: async (args, env, timeout) => { calls.push({ args, env, timeout }); return result; },
    saveArtifact: (_lane, artifact) => { calls.push({ artifact }); },
    appendOutputs: (_file, value) => { calls.push({ output: value }); },
    ...overrides,
  };
  return { calls, result, dependencies };
}

test('import is inert; Production28 is fixed and Team coverage cannot be guessed from old counts', async () => {
  const connect = net.Socket.prototype.connect, listen = net.Server.prototype.listen;
  await import('../scripts/native-owner-entry.mjs');
  assert.equal(net.Socket.prototype.connect, connect); assert.equal(net.Server.prototype.listen, listen);
  assert.deepEqual(Object.keys(nativeOwnerRegistry), ['production','team']);
  assert.deepEqual(nativeOwnerRegistry.production.args, []); assert.deepEqual(nativeOwnerRegistry.team.args, ['--native']);
  assert.equal(nativeOwnerRegistry.production.coverageContract.cases.length, 28); assert.equal(nativeOwnerRegistry.team.coverageContract, null);
  assert.deepEqual(nativeOwnerRegistry.production.coverageContract.cases.reduce((counts, value) => ({ ...counts, [value.kind]: (counts[value.kind] ?? 0) + 1 }), {}), { concurrency: 17, admission: 6, schema: 5 });
  assert.equal(Object.isFrozen(contract('production').cases[0].expectedCounts), true);
  assert.equal(nativeOwnerRegistry.production.minimumCases, undefined); assert.equal(nativeOwnerRegistry.team.minimumCases, undefined);
});
test('CLI closes lane/path/args/timeout and does not expose unit contract injection', () => {
  assert.deepEqual(parseNativeArguments(['--lane','team','--expected-commit',commit]), options('team'));
  for (const argv of [[], ['--lane','b','--expected-commit',commit], ['--suite','v2:test:db','--expected-commit',commit], ['--lane','team','--expected-commit',commit,'--contract','fake'], ['--lane','team','--expected-commit',commit,'--args','--guard-only'], ['--native-child','team','--expected-commit',commit]]) assert.throws(() => parseNativeArguments(argv));
});
test('local default off fails before guards, hook I/O or any child constructor', async () => {
  const env = environment('production'); delete env.V2_M0_POSTGRES_INTEGRATION;
  let called = 0;
  await assert.rejects(runNativeOwnerEntryForTests(options('production'), env, { loadGuards: () => { called++; }, runChild: () => { called++; } }), /NATIVE_OPT_IN_REQUIRED/);
  assert.equal(called, 0);
});
test('actual pending coverage rejects before child and public receipt acceptance', async () => {
  const mock = services('team'); delete mock.dependencies.readCoverage;
  await assert.rejects(runNativeOwnerEntryForTests(options('team'), environment('team'), mock.dependencies), /REVIEWED_OWNER_COVERAGE_PENDING/);
  assert.equal(mock.calls.some(value => value?.args || value?.output), false);
  assert.throws(() => validateNativeReceipt(stdout('team', receipt('team')), prepareNativeEnvironment(options('team'), environment('team')), { commit, clean: true }), /REVIEWED_OWNER_COVERAGE_PENDING/);
});
test('target/event/SHA/alternate environment restrictions remain closed', () => {
  for (const alter of [env => env.TEST_DATABASE_URL = 'postgresql://fixture:dummyPostgres@other.invalid/v2_native_b_ci_test', env => env.TEST_DATABASE_URL += '?token=not-allowed', env => env.DATABASE_URL = env.TEST_DATABASE_URL, env => env.PGHOST = '127.0.0.1', env => env.V2_L0_LANE_F_APPROVED_NAME = 'other_test', env => env.GITHUB_REF = 'refs/heads/MAIN', env => env.GITHUB_EVENT_NAME = 'pull_request', env => env.GITHUB_SHA = 'b'.repeat(40), env => env.GITHUB_RUN_ID = '../bad']) { const env=environment('production'); alter(env); assert.throws(() => prepareNativeEnvironment(options('production'), env)); }
  const manual={...environment('team'),GITHUB_EVENT_NAME:'workflow_dispatch'};
  assert.throws(() => prepareNativeEnvironment(options('team'),manual)); manual.V2_NATIVE_OWNER_MANUAL_OPT_IN='1';
  assert.equal(prepareNativeEnvironment(options('team'),manual).env.GITHUB_EVENT_NAME,'workflow_dispatch');
});
test('sanitization never aliases app URL or inherits provider/QA/session/node injection', () => {
  const env={...environment('team'),GITHUB_TOKEN:'secret-gh',SESSION_SECRET:'secret-session',REPLIT_TOKEN:'secret-replit',PRINTERSHERO_DEV_QA_PASSWORD:'secret-qa',GOOGLE_CLIENT_SECRET:'secret-provider',NODE_OPTIONS:'--require secret-bootstrap',NODE_PATH:'secret-path'};
  const before=structuredClone(env), child=prepareNativeEnvironment(options('team'),env).env;
  assert.deepEqual(env,before); assert.doesNotMatch(JSON.stringify(child),/secret-/);
  assert.equal(child.DATABASE_URL,undefined);
});
test('synthetic reviewed controller rechecks exact clean source and hook hash after execution', async () => {
  const mock=services('production');
  const value=await runNativeOwnerEntryForTests(options('production'),environment('production'),mock.dependencies);
  assert.equal(value.coverageAdjudicated,true);
  assert.equal(mock.calls.filter(value => value==='source').length,2);
  assert.equal(mock.calls.filter(value => value==='hooks').length,2);
  assert.equal(mock.calls.filter(value => value?.output).length,1);
  assert.equal(mock.calls.find(value => value?.args).timeout,90000);
});
test('postexecution dirty/revised source never publishes native success', async () => {
  for (const changed of [{commit,clean:false},{commit:'b'.repeat(40),clean:true}]) {
    let reads=0; const mock=services('team',{readSource:()=>++reads===1?{commit,clean:true}:changed});
    await assert.rejects(runNativeOwnerEntryForTests(options('team'),environment('team'),mock.dependencies),/POSTEXECUTION_EXACT_CLEAN_SOURCE_REQUIRED/);
    assert.equal(mock.calls.some(value=>value?.output),false);
    assert.ok(mock.calls.filter(value=>value?.artifact).every(value=>value.artifact.coverageAdjudicated===false));
  }
});
test('exact contract counters/named sets/per-case status/counts/PIDs reject omissions and additions', () => {
  for (const lane of ['production','team']) {
    assert.equal(parseReceipt(lane,receipt(lane)).cases,lane === 'production' ? 28 : 2);
    const cases = value => lane === 'production' ? value.cases : value.caseResults;
    for (const alter of [value=>value.passedCases=1,value=>delete value.failedCases,value=>value.skippedCases=1,value=>value.pendingCases=1,value=>cases(value).pop(),value=>cases(value).push({...cases(value)[0],name:'unreviewed-extra'}),value=>cases(value)[1].name=cases(value)[0].name,value=>cases(value)[0].status='skip',value=>{if(lane==='production')value.cases[0].measuredCounts.runs=0;else value.caseResults[0].counts.retained=0;},value=>{if(lane==='production')value.cases[0].executingBackendPids=[101,101];else value.caseResults[0].backendPids=[101,101];}]) {const raw=receipt(lane);alter(raw);assert.throws(()=>parseReceipt(lane,raw));}
  }
});
test('source/GH/lane/gate/suite/runner/version/cleanup/runtime contradictions fail closed', () => {
  for (const lane of ['production','team']) for (const alter of [value=>value.sourceCommit='b'.repeat(40),value=>value.GITHUB_SHA='b'.repeat(40),value=>value.lane='forged',value=>value.gate='forged',value=>value.runner='jest',value=>value.suite='another-suite',value=>{if(lane==='production')value.sourceCleanBefore=false;else value.sourceClean=false;},value=>value.serverVersionNum=150000,value=>{if(lane==='production')value.cases[0].namespaces[0].removed=false;else value.schemaRemoved=false;},value=>{if(lane==='production')value.cases[0].namespaceIdentifiers[0]='public';else value.namespace='public';}]) {const raw=receipt(lane);alter(raw);assert.throws(()=>parseReceipt(lane,raw));}
  const raw=receipt('production');raw.runtimeCreationEnabled=true;assert.throws(()=>parseReceipt('production',raw));
});
test('failed/interrupted/timed out child never appends green outputs or raw diagnostics', async () => {
  for (const alter of [value=>value.code=1,value=>value.diagnostics.interrupted=true,value=>value.diagnostics.cleanupBoundedOut=true,value=>value.diagnostics.treeCleanupFailed=true,value=>value.diagnostics.timedOut=true,value=>value.stdout='private SQL/URL/password']) {
    const mock=services('team');alter(mock.result);
    await assert.rejects(runNativeOwnerEntryForTests(options('team'),environment('team'),mock.dependencies));
    assert.equal(mock.calls.some(value=>value?.output),false);
    const artifacts=mock.calls.filter(value=>value?.artifact).map(value=>value.artifact);
    assert.ok(artifacts.every(value=>value.status==='error' && value.coverageAdjudicated===false));
    if(mock.result.diagnostics.treeCleanupFailed){assert.equal(artifacts[0].treeCleanupFailed,true);assert.equal(artifacts[0].rootFallbackIsNotFullTreeCleanup,true);assert.equal(artifacts[0].treeCleanupFailureCode,'OWNED_TREE_CLEANUP_FAILED');}
    assert.doesNotMatch(JSON.stringify(artifacts),/private SQL|password|postgresql:\/\//);
  }
});
test('no listener or HTTP/HTTPS/UDP/fetch can reach a real bind/connection via child policy', () => {
  let binds=0,connections=0;
  class Socket {connect(){connections++;return this;}}
  class Server {listen(){binds++;return this;}}
  const transports={net:{Socket,Server},tls:{connect(){connections++;}},http:{get(){},request(){}},https:{get(){},request(){}},dgram:{createSocket(){}},global:{fetch(){}}};
  const target=new URL(environment('team').TEST_DATABASE_URL);
  installNativeNetworkPolicyForTests(target,transports);
  assert.throws(()=>new Server().listen(3000),/FORBIDDEN/);
  assert.throws(()=>new Server().listen(0,'127.0.0.1'),/FORBIDDEN/);
  new Socket().connect({host:'127.0.0.1',port:5432});
  for (const call of [()=>new Socket().connect({host:'127.0.0.1',port:3000}),()=>transports.http.get(),()=>transports.https.request(),()=>transports.tls.connect({host:'provider.invalid',port:443}),()=>transports.dgram.createSocket(),()=>transports.global.fetch()])assert.throws(call,/FORBIDDEN/);
  assert.equal(binds,0);assert.equal(connections,1);assert.equal(nativeSocketAllowed({path:'/tmp/socket'},target),false);
});

function temporary(work) {
  const directory=fs.mkdtempSync(path.join(cache,'native-entry-unit-'));
  return Promise.resolve().then(()=>work(directory)).finally(()=>fs.rmSync(directory,{recursive:true,force:true}));
}
test('real artifact writer never follows/truncates a preexisting hardlinked temp entry',()=>temporary(directory=>{
  const nonce='11111111-1111-4111-8111-111111111111';
  const location=path.join(directory,'.cache/v2-validation/native-owner');fs.mkdirSync(location,{recursive:true});
  const protectedFile=path.join(directory,'protected.txt');fs.writeFileSync(protectedFile,'unchanged');
  const temporaryFile=path.join(location,`.team-${nonce}.tmp`);fs.linkSync(protectedFile,temporaryFile);
  assert.throws(()=>writeNativeArtifactForTests(directory,'team',{status:'error'},nonce),error=>['PREEXISTING_ARTIFACT_ENTRY_FORBIDDEN','EEXIST'].includes(error.code));
  assert.equal(fs.readFileSync(protectedFile,'utf8'),'unchanged');
  assert.equal(fs.readFileSync(temporaryFile,'utf8'),'unchanged');
}));
test('real artifact writer rejects dangling symlink/reparse entry without creating its target',async t=>temporary(directory=>{
  const nonce='22222222-2222-4222-8222-222222222222';
  const location=path.join(directory,'.cache/v2-validation/native-owner');fs.mkdirSync(location,{recursive:true});
  const target=path.join(directory,'must-not-be-created');const temporaryFile=path.join(location,`.team-${nonce}.tmp`);
  try{fs.symlinkSync(target,temporaryFile,'file');}catch(error){
    if(!['EPERM','ENOTSUP'].includes(error.code))throw error;
    if(process.platform!=='win32'){t.skip('Host cannot create symlinks; exclusive hardlink-entry test still runs.');return;}
    fs.symlinkSync(target,temporaryFile,'junction');t.diagnostic('Windows file-symlink privilege unavailable; exercised real dangling junction/reparse entry.');
  }
  assert.equal(fs.existsSync(temporaryFile),false);assert.equal(fs.lstatSync(temporaryFile).isSymbolicLink(),true);
  assert.throws(()=>writeNativeArtifactForTests(directory,'team',{status:'error'},nonce),error=>error.code==='PREEXISTING_ARTIFACT_ENTRY_FORBIDDEN');
  assert.equal(fs.existsSync(target),false);assert.equal(fs.lstatSync(temporaryFile).isSymbolicLink(),true);
}));
test('real artifact destination replacement does not modify another hardlink and leaves no temp',()=>temporary(directory=>{
  const location=path.join(directory,'.cache/v2-validation/native-owner');fs.mkdirSync(location,{recursive:true});
  const target=path.join(directory,'protected.txt');fs.writeFileSync(target,'keep');fs.linkSync(target,path.join(location,'team.json'));
  writeNativeArtifactForTests(directory,'team',{status:'error',coverageAdjudicated:false},'33333333-3333-4333-8333-333333333333');
  assert.equal(fs.readFileSync(target,'utf8'),'keep');assert.equal(JSON.parse(fs.readFileSync(path.join(location,'team.json'),'utf8')).coverageAdjudicated,false);
  assert.deepEqual(fs.readdirSync(location),['team.json']);
}));
test('normal CI output remains sanitized and explicitly adjudicated only for synthetic contract',()=>temporary(async directory=>{
  const commands=path.join(directory,'_runner_file_commands');fs.mkdirSync(commands);const output=path.join(commands,'set_output_44444444-4444-4444-8444-444444444444');fs.writeFileSync(output,'');
  const mock=services('team');delete mock.dependencies.githubOutputFile;delete mock.dependencies.appendOutputs;
  await runNativeOwnerEntryForTests(options('team'),{...environment('team'),RUNNER_TEMP:directory,GITHUB_OUTPUT:output},mock.dependencies);
  const body=fs.readFileSync(output,'utf8');assert.match(body,/coverageAdjudicated=true/);assert.doesNotMatch(body,/dummyPostgres|postgresql:\/\//);
}));

const processTreeCode = `const {spawn}=require('node:child_process');const child=spawn(process.execPath,['-e',"process.on('SIGTERM',()=>{});setInterval(()=>{},1000)"],{stdio:'inherit'});console.log(JSON.stringify({parent:process.pid,grandchild:child.pid}));process.on('SIGTERM',()=>{});setInterval(()=>{},1000);`;
function alive(pid){try{process.kill(pid,0);return true;}catch(error){if(error.code==='ESRCH')return false;throw error;}}
async function exerciseTree(signal) {
  const signals=new EventEmitter();let pids;
  const started=Date.now();
  const result=await runOwnedProcessForTests(['-e',processTreeCode],cleanEnvironment(process.env),signal?5000:2000,signals,output=>{
    if(!pids){const line=output.split(/\r?\n/).find(value=>value.startsWith('{') && value.endsWith('}'));if(line){pids=JSON.parse(line);if(signal)signals.emit(signal);}}
  });
  assert.ok(pids,'Owned inert process tree must start before cancellation');
  assert.equal(result.code,1);assert.ok(Date.now()-started<8000);
  assert.equal(alive(pids.parent),false);assert.equal(alive(pids.grandchild),false);
  assert.equal(signals.listenerCount('SIGTERM'),0);assert.equal(signals.listenerCount('SIGINT'),0);
  if(signal)assert.equal(result.diagnostics.interrupted,true);else assert.equal(result.diagnostics.timedOut,true);
}
test('actual owned child/grandchild are terminated on deadline; no native fixture or bind',()=>exerciseTree(null));
test('controller SIGTERM cleanup terminates actual owned descendants, not a mock kill',()=>exerciseTree('SIGTERM'));
test('controller SIGINT cleanup terminates actual owned descendants, not a mock kill',()=>exerciseTree('SIGINT'));

test('controlled taskkill spawn failures attempt root-only fallback and expose only fixed failure diagnostics',async()=>{
  for(const synchronous of [true,false]){
    let fallback=0;const child={pid:123456789,kill(signal){assert.equal(signal,'SIGKILL');fallback++;return true;}};
    const spawnKiller=()=>{
      if(synchronous)throw new Error('private stderr/url/password');
      const killer=new EventEmitter();killer.kill=()=>{};killer.unref=()=>{};
      queueMicrotask(()=>killer.emit('error',new Error('private stderr/url/password')));return killer;
    };
    const result=await stopWindowsOwnedTreeForTests(child,{},spawnKiller);
    assert.equal(fallback,1);assert.equal(result.treeCleanupFailed,true);assert.equal(result.rootFallbackAttempted,true);
    assert.equal(result.treeCleanupFailureCode,'WINDOWS_TREE_KILL_SPAWN_FAILED');
    assert.doesNotMatch(JSON.stringify(result),/private|password|123456789/);
  }
});
test('controlled taskkill nonzero/signaled close falls back exactly once; zero close does not imply root fallback',async()=>{
  for(const [code,signal,expected] of [[1,null,'WINDOWS_TREE_KILL_EXIT_FAILED'],[null,'SIGTERM','WINDOWS_TREE_KILL_SIGNALED'],[0,null,null]]){
    let fallback=0;const child={pid:123456789,kill(){fallback++;return true;}};
    const spawnKiller=()=>{const killer=new EventEmitter();killer.kill=()=>{};killer.unref=()=>{};queueMicrotask(()=>{killer.emit('close',code,signal);killer.emit('error',new Error('late private data'));});return killer;};
    const result=await stopWindowsOwnedTreeForTests(child,{},spawnKiller);
    assert.equal(fallback,expected?1:0);assert.equal(result.treeCleanupFailureCode,expected);
    assert.equal(result.treeCleanupFailed,Boolean(expected));assert.equal(result.rootFallbackAttempted,Boolean(expected));
    assert.doesNotMatch(JSON.stringify(result),/late private|123456789/);
  }
});

test('Production28 matches the reviewed producer manifest and all six file-read dependencies without importing native code', () => {
  verifyNativeHooksForTests();
  const source = fs.readFileSync(new URL('./infrastructure/productionRunExclusive.native.ts', import.meta.url), 'utf8');
  const manifest = source.match(/const caseManifest = (\[[\s\S]*?\]) as const;/)[1];
  const parsed = JSON.parse(manifest.replace(/\b(name|kind|expectedCounts|runs|allocations|activeMemberships|operationReceipts|outputEvents|reworkCycles|historicalAllocations):/g, '"$1":').replace(/,\s*\]$/, ']'));
  assert.deepEqual(parsed, contract('production').cases);
  assert.equal(contract('production').hookSha256.length, 64);
  assert.equal(contract('production').fileHashes['v2/tests/infrastructure/productionExclusiveMembership.request.sql'], contract('production').fileHashes['server/db/migrations_v2/0303_v2_production_exclusive_membership.sql']);
  console.log(JSON.stringify({ scope: 'static source hashes, not native execution', sourceHashes: contract('production').fileHashes, suiteHash: contract('production').suiteHash }));
});

test('each missing or changed native dependency fails the real hash preflight', () => temporary(directory => {
  const repository = fileURLToPath(new URL('../../', import.meta.url));
  for (const relative of nativeOwnerRegistry.production.files) {
    const destination = path.join(directory, relative);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, fs.readFileSync(path.join(repository, relative)));
  }
  verifyNativeHooksForTests(directory);
  for (const relative of nativeOwnerRegistry.production.files) {
    const file = path.join(directory, relative), bytes = fs.readFileSync(file);
    fs.appendFileSync(file, '\nchanged dependency');
    assert.throws(() => verifyNativeHooksForTests(directory), /NATIVE_HOOK_DEPENDENCY_HASH_MISMATCH/);
    fs.unlinkSync(file);
    assert.throws(() => verifyNativeHooksForTests(directory), /EXACT_NATIVE_HOOK_FILE_REQUIRED/);
    fs.writeFileSync(file, bytes);
  }
  verifyNativeHooksForTests(directory);
}));

test('Production approval, clean source and matching dependencies are mandatory before a native child constructor', async () => {
  for (const stage of ['approval', 'source', 'hash']) {
    const env = environment('production'), mock = services('production');
    if (stage === 'approval') delete env.V2_L0_LANE_F_NATIVE_APPROVED;
    if (stage === 'source') mock.dependencies.readSource = () => ({ commit, clean: false });
    if (stage === 'hash') mock.dependencies.verifyHooks = () => { throw new Error('NATIVE_HOOK_DEPENDENCY_HASH_MISMATCH'); };
    await assert.rejects(runNativeOwnerEntryForTests(options('production'), env, mock.dependencies));
    assert.equal(mock.calls.some(value => value?.args || value?.output), false);
  }
});

test('postexecution dependency drift cannot publish an adjudicated receipt', async () => {
  let checks = 0;
  const mock = services('production', { verifyHooks: () => { if (++checks === 2) throw new Error('changed dependency'); } });
  await assert.rejects(runNativeOwnerEntryForTests(options('production'), environment('production'), mock.dependencies));
  assert.equal(mock.calls.some(value => value?.output), false);
  assert.ok(mock.calls.filter(value => value?.artifact).every(value => value.artifact.receiptValid === false && value.artifact.coverageAdjudicated === false));
});

test('Team real coverage stays null and cannot inherit the Production contract or launch a child', async () => {
  assert.equal(nativeOwnerRegistry.team.coverageContract, null);
  const mock = services('team', { readCoverage: () => contract('production') });
  await assert.rejects(runNativeOwnerEntryForTests(options('team'), environment('team'), mock.dependencies), /TEAM_COVERAGE_NOT_APPROVED/);
  assert.equal(mock.calls.some(value => value?.args || value?.output), false);
  assert.throws(() => validateNativeReceiptForTests(stdout('team', receipt('team')), prepareNativeEnvironment(options('team'), environment('team')), { commit, clean: true }, contract('production')), /TEAM_COVERAGE_NOT_APPROVED/);
});

test('Production version, hash, explicit clean-before/after and exact after-SHA cannot be omitted or contradicted', () => {
  for (const alter of [
    value => delete value.receiptVersion, value => value.receiptVersion = 2,
    value => delete value.sourceCleanBefore, value => delete value.sourceCleanAfter,
    value => { value.sourceCleanBefore = false; value.sourceCleanAfter = false; },
    value => value.sourceCleanAfter = 'true', value => value.sourceCommitAfter = 'b'.repeat(40),
    value => delete value.sourceCommitAfter, value => value.suiteHash = 'f'.repeat(64),
    value => value.serverVersionNum = 160000.5, value => value.runtimeCreationEnabled = true,
    value => delete value.runtimeCreationEnabled,
  ]) { const raw = receipt('production'); alter(raw); assert.throws(() => parseReceipt('production', raw)); }
});

test('Production manifest and measured cases are closed, unique and ordered with exact kinds', () => {
  for (const alter of [
    value => value.manifest.reverse(), value => value.cases.reverse(),
    value => value.manifest[1] = structuredClone(value.manifest[0]),
    value => value.cases[1] = structuredClone(value.cases[0]),
    value => value.manifest[0].kind = 'schema', value => value.cases[0].kind = 'admission',
    value => value.manifest[0].name = 'renamed', value => value.cases[0].name = 'renamed',
    value => value.manifest[0].expectedCounts.runs = 2,
    value => value.manifest[0].extra = true, value => delete value.cases[0].status,
  ]) { const raw = receipt('production'); alter(raw); assert.throws(() => parseReceipt('production', raw)); }
});

test('Production measurements require exact safe-integer keys and independently fixed counts including historical evidence', () => {
  for (const field of ['expectedCounts', 'measuredCounts', 'cleanupCounts']) {
    for (const invalid of [-1, 0.5, '1', null, Number.MAX_SAFE_INTEGER + 1]) {
      const raw = receipt('production'); raw.cases[0][field].runs = invalid;
      assert.throws(() => parseReceipt('production', raw));
    }
    for (const alter of [counts => delete counts.runs, counts => counts.extra = 0]) {
      const raw = receipt('production'); alter(raw.cases[0][field]); assert.throws(() => parseReceipt('production', raw));
    }
  }
  for (const alter of [
    value => value.cases[0].cleanupCounts.runs = 1,
    value => delete value.cases[21].measuredCounts.historicalAllocations,
    value => value.cases[21].measuredCounts.historicalAllocations = 0,
    value => value.cases[21].cleanupCounts.historicalAllocations = 0,
  ]) { const raw = receipt('production'); alter(raw); assert.throws(() => parseReceipt('production', raw)); }
});

test('Production concurrency requires one consistent ordered distinct PID pair and real B Lock waits', () => {
  for (const alter of [
    value => value.cases[0].executingBackendPids = [0,102],
    value => value.cases[0].executingBackendPids = [101,2147483648],
    value => value.cases[1].executingBackendPids = [102,101],
    value => value.cases[1].contenders.backendPidB = 103,
    value => value.cases[0].contenders.distinct = false,
    value => value.cases[0].contenders = 'not_applicable',
    value => delete value.cases[0].contenders.blockedWaits,
    value => value.cases[0].contenders.blockedWaits = [],
    value => value.cases[0].contenders.blockedWaits[0].backendPid = 101,
    value => value.cases[0].contenders.blockedWaits[0].waitEventType = 'IO',
    value => delete value.cases[0].contenders.blockedWaits[0].waitEvent,
    value => value.cases[0].contenders.blockedWaits[0].waitEvent = 12,
    value => value.cases[4].executingBackendPids = [999],
    value => value.cases[4].executingBackendPids = [101,101],
    value => value.cases[4].contenders = structuredClone(value.cases[0].contenders),
  ]) { const raw = receipt('production'); alter(raw); assert.throws(() => parseReceipt('production', raw)); }
  const raw = receipt('production');
  raw.cases[0].contenders.blockedWaits[0].waitEvent = null;
  raw.cases[4].executingBackendPids = [102]; raw.cases[6].executingBackendPids = [101,102];
  assert.equal(parseReceipt('production', raw).cases, 28);
});

test('Production namespace records require exact matching common and case-22 historical lists with removal evidence', () => {
  for (const alter of [
    value => value.cases[1].namespaceIdentifiers[0] = `l0_production_test_${'d'.repeat(32)}`,
    value => value.cases[0].namespaceIdentifiers.push(value.cases[0].namespaceIdentifiers[0]),
    value => value.cases[0].namespaces = [],
    value => value.cases[0].namespaces[0].identifier = 'public',
    value => delete value.cases[0].namespaces[0].removed,
    value => value.cases[0].namespaces[0].removed = false,
    value => value.cases[0].namespaces[0].removed = 'true',
    value => value.cases[21].namespaceIdentifiers.reverse(),
    value => value.cases[21].namespaceIdentifiers.pop(),
    value => value.cases[21].namespaceIdentifiers[1] = value.cases[21].namespaceIdentifiers[0],
    value => { value.cases[21].namespaceIdentifiers[1] = [value.cases[21].namespaceIdentifiers[1]]; value.cases[21].namespaces[1].identifier = value.cases[21].namespaceIdentifiers[1]; },
    value => value.cases[21].namespaces[1].removed = false,
    value => value.cases[22].namespaceIdentifiers.push(value.cases[21].namespaceIdentifiers[1]),
  ]) { const raw = receipt('production'); alter(raw); assert.throws(() => parseReceipt('production', raw)); }
});

test('Production normalization copies validated measurements and observations, not expected constants or raw extra fields', () => {
  const raw = receipt('production');
  raw.cases[0].measuredCounts = Object.fromEntries(Object.entries(raw.cases[0].measuredCounts).reverse());
  raw.cases[0].contenders.blockedWaits[0].waitEvent = null;
  raw.privateDebug = 'private URL/password'; raw.cases[0].privateDebug = raw.privateDebug;
  const result = parseReceipt('production', raw);
  assert.deepEqual(Object.keys(result.caseDetails[0].measuredCounts), Object.keys(raw.cases[0].measuredCounts));
  assert.deepEqual(result.caseDetails.map(value => value.measuredCounts), raw.cases.map(value => value.measuredCounts));
  assert.deepEqual(result.caseDetails[0].contenders, raw.cases[0].contenders);
  assert.equal(result.caseDetails[0].contenders.blockedWaits[0].waitEvent, null);
  assert.equal(result.caseDetails[4].contenders, 'not_applicable');
  assert.deepEqual(result.caseDetails[4].executingBackendPids, [101]);
  assert.equal(result.allNativeProofClaimed, false); assert.equal(result.selectedLaneProof, 'production');
  assert.equal(result.namespaceRemoved, true);
  assert.doesNotMatch(JSON.stringify(result), /private URL|password|blockingGraph/);
  raw.cases[0].measuredCounts.runs = 2;
  assert.equal(result.caseDetails[0].measuredCounts.runs, 1);
});

test('Production workflow is DEV-only, exact-event-bound and manual-default-off after canonical success', () => {
  const workflow = yaml.load(fs.readFileSync(new URL('../../.github/workflows/v2-validation.yml', import.meta.url), 'utf8'));
  assert.deepEqual(workflow.on.workflow_dispatch.inputs.production_native, { description: 'Run reviewed Production28 proof on the exact DEV commit in disposable PostgreSQL', type: 'boolean', default: false });
  const job = workflow.jobs['production-native'];
  assert.equal(job.needs, 'deterministic'); assert.deepEqual(job.permissions, { contents: 'read' });
  const expression = job.if.replace(/\s+/g, ' ').trim();
  assert.equal(expression, "needs.deterministic.result == 'success' && github.ref == 'refs/heads/dev' && ((github.event_name == 'push' && github.event.after == github.sha && github.event.deleted == false) || (github.event_name == 'workflow_dispatch' && inputs.production_native == true))");
  const allowed = (event, ref, optIn, after = commit, result = 'success', deleted = false) => runInNewContext(expression, { needs: { deterministic: { result } }, github: { event_name: event, ref, sha: commit, event: { after, deleted } }, inputs: { production_native: optIn } }, { timeout: 100 });
  assert.equal(allowed('push', 'refs/heads/dev', false), true);
  assert.equal(allowed('workflow_dispatch', 'refs/heads/dev', true), true);
  for (const event of ['pull_request', 'schedule', 'release', 'workflow_run']) assert.equal(allowed(event, 'refs/heads/dev', true), false);
  for (const ref of ['refs/heads/main', 'refs/heads/MAIN', 'refs/heads/prod', 'refs/tags/dev']) assert.equal(allowed('push', ref, true), false);
  assert.equal(allowed('workflow_dispatch', 'refs/heads/dev', false), false);
  assert.equal(allowed('push', 'refs/heads/dev', true, 'b'.repeat(40)), false);
  assert.equal(allowed('push', 'refs/heads/dev', true, commit, 'failure'), false);
  assert.equal(allowed('push', 'refs/heads/dev', true, commit, 'success', true), false);
  for (const alter of [env => delete env.V2_NATIVE_OWNER_EVENT_AFTER, env => env.V2_NATIVE_OWNER_EVENT_AFTER = 'b'.repeat(40)]) {
    const env = environment('production'); alter(env); assert.throws(() => prepareNativeEnvironment(options('production'), env), /DEV_PUSH_AFTER_SHA_MISMATCH/);
  }
});

test('Production service job has only disposable credentials, closed command and success-only adjudicated artifact upload', () => {
  const workflow = yaml.load(fs.readFileSync(new URL('../../.github/workflows/v2-validation.yml', import.meta.url), 'utf8'));
  const job = workflow.jobs['production-native'];
  assert.equal(job['timeout-minutes'], 10);
  assert.equal(job.services.postgres.image, 'postgres:16');
  assert.deepEqual(job.services.postgres.env, { POSTGRES_DB: 'v2_native_b_ci_test', POSTGRES_USER: 'native_ci', POSTGRES_PASSWORD: 'ephemeral-native-ci-only' });
  assert.deepEqual(job.services.postgres.ports, ['5432:5432']);
  assert.match(job.services.postgres.options, /pg_isready -U native_ci -d v2_native_b_ci_test/);
  assert.deepEqual(Object.keys(job.env).sort(), ['TEST_DATABASE_URL','V2_L0_LANE_F_APPROVED_NAME','V2_L0_LANE_F_NATIVE_APPROVED','V2_L0_NATIVE_EXPECTED_COMMIT','V2_M0_POSTGRES_INTEGRATION','V2_NATIVE_OWNER_EVENT_AFTER','V2_NATIVE_OWNER_MANUAL_OPT_IN']);
  assert.equal(new URL(job.env.TEST_DATABASE_URL).hostname, '127.0.0.1');
  assert.equal(new URL(job.env.TEST_DATABASE_URL).pathname, '/v2_native_b_ci_test');
  assert.equal(job.env.V2_L0_NATIVE_EXPECTED_COMMIT, '${{ github.sha }}');
  assert.equal(job.env.V2_NATIVE_OWNER_EVENT_AFTER, '${{ github.event.after }}');
  assert.equal(job.env.V2_NATIVE_OWNER_MANUAL_OPT_IN, "${{ github.event_name == 'workflow_dispatch' && inputs.production_native == true && '1' || '0' }}");
  assert.deepEqual(job.steps[0], { uses: 'actions/checkout@v4', with: { ref: '${{ github.sha }}', 'persist-credentials': false } });
  assert.deepEqual(job.steps[1], { uses: 'actions/setup-node@v4', with: { 'node-version': '20', cache: 'npm' } });
  assert.deepEqual(job.steps.filter(step => step.run).map(step => step.run), ['npm ci --include=dev --include=optional', 'node v2/scripts/native-owner-entry.mjs --lane production --expected-commit "$GITHUB_SHA"']);
  assert.equal(job.steps.length, 5);
  const upload = job.steps[4];
  assert.equal(upload.if, "success() && steps.production_proof.outputs.receiptValid == 'true' && steps.production_proof.outputs.coverageAdjudicated == 'true'");
  assert.equal(upload.with.path, '.cache/v2-validation/native-owner/production.json');
  assert.equal(upload.with['if-no-files-found'], 'error');
  assert.doesNotMatch(JSON.stringify(job), /secrets\.|--lane team|DATABASE_URL["']?:[^/]*\$|v2:test:db|v2:test:qa|migrations:apply/);
});

test('existing canonical diagnostics and guarded QA workflow jobs are preserved exactly', () => {
  const current = yaml.load(fs.readFileSync(new URL('../../.github/workflows/v2-validation.yml', import.meta.url), 'utf8'));
  const original = yaml.load(execFileSync('git', ['show', 'HEAD:.github/workflows/v2-validation.yml'], { cwd: fileURLToPath(new URL('../../', import.meta.url)), encoding: 'utf8', timeout: 5000 }));
  assert.deepEqual(current.jobs.deterministic, original.jobs.deterministic);
  assert.deepEqual(current.jobs['guarded-qa'], original.jobs['guarded-qa']);
  assert.deepEqual(current.on.pull_request, original.on.pull_request); assert.deepEqual(current.on.push, original.on.push);
  assert.deepEqual(current.on.workflow_dispatch.inputs.guarded_qa, original.on.workflow_dispatch.inputs.guarded_qa);
  assert.deepEqual(current.permissions, original.permissions);
  assert.deepEqual(Object.keys(current.jobs), ['deterministic', 'production-native', 'guarded-qa']);
});

test('implementation evidence reports only the three leased source hashes', () => {
  const repository = fileURLToPath(new URL('../../', import.meta.url));
  const sourceHashes = Object.fromEntries(['v2/scripts/native-owner-entry.mjs', 'v2/tests/nativeOwnerEntry.test.mjs', '.github/workflows/v2-validation.yml'].map(relative => [relative, createHash('sha256').update(fs.readFileSync(path.join(repository, relative))).digest('hex')]));
  console.log(JSON.stringify({ scope: 'implementation source identity, not native proof', sourceHashes }));
});
