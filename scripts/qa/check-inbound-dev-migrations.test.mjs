import { test } from 'node:test';
import assert from 'node:assert/strict';
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
