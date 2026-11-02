import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { migrationConflicts } from './check-inbound-dev-migrations.mjs';

const existing={idx:239,when:1793318400000,tag:'0240_proof_early_production_release',hash:'proofing'};
test('rejects the actual release pattern: different migrations occupying the same journal identity',()=>{
  const incoming={...existing,tag:'0240_inbound_email_processing_jobs',hash:'intake'};
  assert.deepEqual(migrationConflicts([existing],[incoming]),[{dev:existing,feature:incoming}]);
});
test('allows unchanged history and a strictly later independent append',()=>{
  assert.deepEqual(migrationConflicts([existing],[existing,{idx:240,when:1793404800000,tag:'0241_next',hash:'next'}]),[]);
});
test('detects changed SQL even when a journal entry is otherwise identical',()=>{
  assert.equal(migrationConflicts([existing],[{...existing,hash:'edited'}]).length,1);
});
test('detects retimestamping and position changes for an existing migration tag',()=>{
  assert.equal(migrationConflicts([existing],[{...existing,idx:240,when:1793404800000}]).length,1);
});
test('rejects an independent migration inserted behind the DEV frontier',()=>{
  assert.equal(migrationConflicts([existing],[{idx:238,when:1793232000000,tag:'0239_unshipped',hash:'new'}]).length,1);
});
test('release reconciliation preserves the four original intake SQL contents',()=>{
  for (const [tag,expected] of [
    ['0243_inbound_email_processing_jobs','3d717c4fa0e361c9f231eef9da8ff66bc930a98ce37c0c9e3a4c892bc66d4022'],
    ['0244_inbound_versioned_fingerprint_width','57d3632d25ef287c272d114012fc1953da9f3a50a4d65dbe9335696a99678c80'],
    ['0245_inbound_email_import_recovery','35638ac6fa9a54ba026a90cbf5c948db4e89a930e9ebb16fc245659fb8f778b9'],
    ['0246_inbound_gmail_acknowledgements','e3323c9cf840a30a8e75c2de3f1e14d38ca7415e506f96390830f3c51cc9e3b9'],
  ]) {
    const source=readFileSync(new URL(`../../server/db/migrations_v2/${tag}.sql`,import.meta.url),'utf8').replaceAll('\r\n','\n');
    assert.equal(createHash('sha256').update(source).digest('hex'),expected,tag);
  }
});
