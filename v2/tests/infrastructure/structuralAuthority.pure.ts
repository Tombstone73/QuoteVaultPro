import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import type { StaffPrincipal } from "../../src/authorization/principals.js";
import { PostgresTeamAccess } from "../../infrastructure/organization/postgresTeamAccess.js";
import { assertAuthorityReplay, enterAuthorityMutation } from "../../infrastructure/authorization/postgresAuthorityMutation.js";
import { isUsableStaffPasswordHash, isUsableStaffLoginEmail } from "../../src/authorization/staffCredentialReadiness.js";
import bcrypt from "bcryptjs";
import { PGlite } from "@electric-sql/pglite";

const actor: StaffPrincipal={kind:"staff",organizationId:"org",userId:"staff",authority:{membershipId:"m",source:"permission_set",authorityRevision:"1",capabilities:["quote.view","invoice.issue"],teamAccessManagement:true,teamRoleDelegation:"administrator"}};
const hash=(value:unknown)=>createHash("sha256").update(JSON.stringify(value)).digest("hex");
function fixture(options:{status?:string;subject?:string;ready?:boolean;role?:string;detail?:unknown;legacy?:boolean;result?:unknown;noopRole?:boolean}={}) {
  const calls:string[]=[];
  const parameters:unknown[][]=[];
  const request={id:"request",organization_id:"org",operation:"team_access.probe.v1",business_request_id:"key",payload_fingerprint:hash(options.detail??{name:"intent"}),status:options.status??"in_progress",result_resource_type:"team_access",result_resource_id:"org",result_json:options.result??{saved:true},initiated_principal_kind:"staff",initiated_principal_subject:options.subject??"staff",staff_actor_user_id:options.subject??"staff",created_at:new Date(),updated_at:new Date(),completed_at:new Date()};
  const client={query:async(sql:string,values:unknown[]=[])=>{
    calls.push(sql);parameters.push(values); let rows:unknown[]=[];
    if(sql.startsWith("SELECT v2_staff_login_ready"))rows=[{ready:options.ready??true}];
    else if(sql.includes("SELECT s.authority_revision"))rows=[{authority_revision:2,status:"active",delete_state:"active",is_archived:false}];
    else if(sql.includes("SELECT m.user_id"))rows=[{user_id:"staff",is_active:true,role:options.role??"admin",is_platform_developer:false}];
    else if(sql.includes("SELECT ps.id"))rows=[{id:"set",name:"Read",active:true,revision:1,capability_id:"quote.view"}];
    else if(options.noopRole&&sql.startsWith("SELECT id FROM v2_permission_capabilities"))rows=[{id:"quote.view"}];
    else if(options.noopRole&&sql.startsWith("SELECT source_template_key,archived_at"))rows=[{source_template_key:null,archived_at:null}];
    else if(options.noopRole&&sql.startsWith("SELECT s.name,s.description,s.active"))rows=[{name:"Read",description:"Bound description",active:true,capability_id:"quote.view"}];
    else if(sql.startsWith("SELECT payload_fingerprint,status,result_json"))rows=options.legacy?[request]:[];
    else if(sql.startsWith("SELECT * FROM v2_operation_requests"))rows=options.status&&!options.legacy?[request]:[];
    else if(sql.includes("INSERT INTO v2_operation_requests"))rows=[{...request,payload_fingerprint:values[3]}];
    else if(sql.includes("UPDATE v2_operation_requests"))rows=[{...request,status:"succeeded"}];
    else if(!/^(BEGIN|COMMIT|ROLLBACK|SELECT v2_authority_entry|INSERT INTO v2_principal_attributions)/.test(sql))throw Error(`Unexpected query: ${sql}`);
    return{rows,rowCount:rows.length};
  },release(){calls.push("release");}};
  const team=new PostgresTeamAccess({connect:async()=>client} as never,{requireReady:async()=>{throw Error("Provider readiness must not run for replay");}} as never);
  return{client,team,calls,parameters,request};
}

async function main(){
  let cases=0;
  const credential=await bcrypt.hash("disposable-unit-test-only",4);
  assert.ok(isUsableStaffPasswordHash(credential));assert.ok(await bcrypt.compare("disposable-unit-test-only",credential));
  for(const value of [null,"", "not-a-hash", credential.slice(0,-1)+"B",credential.replace("$04$","$03$"),credential+"\n",credential+"\r\n",credential+" "," "+credential])assert.equal(isUsableStaffPasswordHash(value),false);
  assert.equal(await bcrypt.compare("disposable-unit-test-only",credential+"\n"),false);
  cases++;
  const f=fixture(); let seen:StaffPrincipal|undefined;
  const result=await (f.team as any).mutate(actor,"org","probe",{name:"intent"},{businessRequestId:"key",expectedAuthorityRevision:"2"},async(_client:unknown,fresh:StaffPrincipal)=>{seen=fresh;return{changed:false,result:"new"};});
  assert.equal(result,"new");assert.deepEqual(seen?.authority.capabilities,["quote.view"]);assert.equal(seen?.authority.authorityRevision,"2");
  assert.equal(f.calls[0],"BEGIN");assert.match(f.calls[1],/^SELECT v2_authority_entry/);assert.match(f.calls[2],/^SELECT v2_staff_login_ready/);cases++;
  for(const status of ["succeeded","in_progress","permanent_failure"]){
    const replay=fixture({status});let invoked=false;
    const action=()=> (replay.team as any).mutate(actor,"org","probe",{name:"intent"},{businessRequestId:"key",expectedAuthorityRevision:"1"},async()=>{invoked=true;return{changed:false};});
    if(status==="succeeded")assert.deepEqual(await action(),{saved:true});else await assert.rejects(action,/successful receipt/);
    assert.equal(invoked,false);assert.equal(replay.calls.some(sql=>sql.startsWith("INSERT")),false);cases++;
  }
  for(const options of [{subject:"other",status:"succeeded"},{ready:false,status:"succeeded"},{role:"member",status:"succeeded"}]){
    const denied=fixture(options);
    await assert.rejects(()=> (denied.team as any).mutate(actor,"org","probe",{name:"intent"},{businessRequestId:"key",expectedAuthorityRevision:"2"},async()=>{throw Error("callback must not run");}));
    assert.ok(denied.calls.includes("ROLLBACK"));cases++;
  }
  const stale=fixture();await assert.rejects(()=> (stale.team as any).mutate(actor,"org","probe",{name:"intent"},{businessRequestId:"key",expectedAuthorityRevision:"1"},async()=>{throw Error("callback must not run");}),/changed elsewhere/);cases++;
  const invitation=fixture({status:"succeeded",detail:{email:"staff@example.invalid",role:"member"}});
  assert.deepEqual(await invitation.team.createInvitation(actor,"org",{email:"staff@example.invalid"},{businessRequestId:"key",expectedAuthorityRevision:"1"}),{saved:true});cases++;
  const context={businessRequestId:"key",expectedAuthorityRevision:"1"};
  const legacyRole={permissionSetId:"set",name:"Read",capabilities:["quote.view"],active:true};
  const roleInput={name:"Read",capabilities:["quote.view"] as const,active:true};
  const unchanged=(f:ReturnType<typeof fixture>)=>assert.equal(f.calls.some(sql=>/^(INSERT|UPDATE|DELETE)/.test(sql)),false,"replay must not rewrite receipt, role, audit, or revision");
  // Both historical descriptions produce indistinguishable v1 evidence. Neither
  // an omitted nor an explicitly empty retry proves the original body was empty.
  for(const originalDescription of [undefined,"Original meaningful"]){
    const original={...roleInput,description:originalDescription};
    const persisted={permissionSetId:"set",name:original.name,capabilities:original.capabilities,active:original.active};
    assert.equal(hash(persisted),hash(legacyRole));
    for(const description of [undefined,"","Original meaningful"]){
      const oldRole=fixture({legacy:true,status:"succeeded",detail:persisted,result:{permissionSetId:"set"}});const prior=JSON.stringify(oldRole.request);
      await assert.rejects(()=>oldRole.team.updateCustomSet(actor,"org","set",{...roleInput,description},context),{code:"CONFLICT",message:/required original fields were not bound/});
      unchanged(oldRole);assert.equal(JSON.stringify(oldRole.request),prior);cases++;
    }
  }
  for(const change of [{description:"Meaningful new description"},{name:"Changed name"}]){
    const conflict=fixture({legacy:true,status:"succeeded",detail:legacyRole,result:{permissionSetId:"set"}});
    await assert.rejects(()=>conflict.team.updateCustomSet(actor,"org","set",{...roleInput,...change},context),/cannot verify this intent/);unchanged(conflict);cases++;
  }
  for(const options of [{status:"in_progress"},{status:"permanent_failure"},{status:"retryable_failure"},{status:"succeeded",subject:"other"},{status:"succeeded",ready:false}]){
    const denied=fixture({legacy:true,detail:legacyRole,...options});await assert.rejects(()=>denied.team.updateCustomSet(actor,"org","set",roleInput,context));unchanged(denied);cases++;
  }
  const modernDetail={permissionSetId:"set",name:"Read",description:"Bound description",capabilities:["quote.view"],active:true};
  const modern=fixture({status:"succeeded",detail:modernDetail,result:{permissionSetId:"set"}});
  await modern.team.updateCustomSet(actor,"org","set",{...roleInput,description:"Bound description"},context);unchanged(modern);
  assert.ok(modern.parameters.some(values=>values[1]==="team_access.permission_set_updated.v2"));cases++;
  const modernConflict=fixture({status:"succeeded",detail:modernDetail});await assert.rejects(()=>modernConflict.team.updateCustomSet(actor,"org","set",{...roleInput,description:"Different"},context),/different payload/);unchanged(modernConflict);cases++;
  const noOp=fixture({noopRole:true});await noOp.team.updateCustomSet(actor,"org","set",{...roleInput,description:"Bound description"},{...context,expectedAuthorityRevision:"2"});
  assert.equal(noOp.calls.some(sql=>/^(SELECT v2_authority_changed|UPDATE v2_permission_|INSERT INTO v2_permission_audit_events)/.test(sql)),false);assert.ok(noOp.calls.some(sql=>sql.includes("UPDATE v2_operation_requests")));cases++;
  const portalInput={customerId:"customer",contactId:"contact",permissionSetId:"portal-set"};
  const portalResult={portalAccessId:"access",status:"pending" as const,deliveryState:"succeeded" as const};
  const oldPortal=fixture({legacy:true,status:"succeeded",detail:portalInput,result:portalResult});
  assert.deepEqual(await oldPortal.team.bootstrapPortalAccess(actor,"org",portalInput,context),portalResult);unchanged(oldPortal);cases++;
  const changedPortal=fixture({legacy:true,status:"succeeded",detail:portalInput,result:portalResult});await assert.rejects(()=>changedPortal.team.bootstrapPortalAccess(actor,"org",{...portalInput,customerId:"other"},context),/cannot verify this intent/);unchanged(changedPortal);cases++;
  const capturedPortal=fixture({legacy:true,status:"succeeded",detail:portalInput,result:{...portalResult,deliveryState:"suppressed"}});await assert.rejects(()=>capturedPortal.team.bootstrapPortalAccess(actor,"org",portalInput,context),/cannot verify this intent/);unchanged(capturedPortal);cases++;
  const newPortal=fixture({status:"succeeded",detail:{...portalInput,captureM77fQaSetupUrl:false},result:portalResult});assert.deepEqual(await newPortal.team.bootstrapPortalAccess(actor,"org",portalInput,context),portalResult);unchanged(newPortal);assert.ok(newPortal.parameters.some(values=>values[1]==="team_access.portal_access_bootstrapped.v2"));cases++;
  for(const originalDescription of [undefined,"Original meaningful"]){
    const original={name:"Read",description:originalDescription,capabilities:["quote.view"] as const};
    const oldCreate=fixture({legacy:true,status:"succeeded",detail:{permissionSetId:"original",name:original.name,capabilities:original.capabilities},result:{permissionSetId:"original"}});
    await assert.rejects(()=>oldCreate.team.createCustomSet(actor,"org",{name:"Read",capabilities:["quote.view"]},context),{code:"CONFLICT",message:/required original fields were not bound/});unchanged(oldCreate);cases++;
    const oldClone=fixture({legacy:true,status:"succeeded",detail:{permissionSetId:"original",sourcePermissionSetId:"source",name:original.name},result:{permissionSetId:"original"}});
    await assert.rejects(()=>oldClone.team.cloneStaffSet(actor,"org","source",{name:"Read",description:""},context),{code:"CONFLICT",message:/required original fields were not bound/});unchanged(oldClone);cases++;
  }
  for(const description of [undefined,"Bound description"]){
    const newCreate=fixture({status:"succeeded",detail:{name:"Read",description:description??null,principalKind:"staff",capabilities:["quote.view"]},result:{permissionSetId:"original"}});
    const newClone=fixture({status:"succeeded",detail:{sourcePermissionSetId:"source",name:"Read",description:description??null},result:{permissionSetId:"original"}});
    for(let retry=0;retry<2;retry++){
      assert.deepEqual(await newCreate.team.createCustomSet(actor,"org",{name:"Read",description,capabilities:["quote.view"]},context),{permissionSetId:"original"});
      assert.deepEqual(await newClone.team.cloneStaffSet(actor,"org","source",{name:"Read",description},context),{permissionSetId:"original"});
    }
    assert.ok(newCreate.parameters.some(values=>values[1]==="team_access.permission_set_created.v2"));
    assert.ok(newClone.parameters.some(values=>values[1]==="team_access.permission_set_cloned.v2"));
    await assert.rejects(()=>newCreate.team.createCustomSet(actor,"org",{name:"Read",description:"Changed",capabilities:["quote.view"]},context),/different payload/);
    await assert.rejects(()=>newClone.team.cloneStaffSet(actor,"org","source",{name:"Read",description:"Changed"},context),/different payload/);
    unchanged(newCreate);unchanged(newClone);cases+=2;
  }
  const entries:unknown[][]=[];await enterAuthorityMutation({query:async(...args:unknown[])=>{entries.push(args);return{rows:[]};}} as never,["z","a","z"]);
  assert.deepEqual(entries[0][1],[["a","z"],false]);cases++;
  assert.throws(()=>assertAuthorityReplay({principalKind:"service",principalSubject:"staff",staffActorUserId:"staff",status:"succeeded"} as never,actor),/another actor/);cases++;
  const sql=readFileSync("server/db/migrations_v2/0305_v2_usable_structural_authority.sql","utf8");
  const floor=sql.slice(sql.indexOf("CREATE OR REPLACE FUNCTION v2_assert_permission_admin_floor"),sql.indexOf("DROP TRIGGER"));
  assert.doesNotMatch(floor,/FOR UPDATE|pg_advisory_xact_lock/);
  assert.match(sql,/TG_OP='TRUNCATE'/);assert.match(sql,/v2_staff_authority_enrollments/);assert.match(sql,/txid_current\(\)::text/);assert.match(sql,/pg_locks/);cases++;
  const bootstrap=sql.slice(sql.indexOf("CREATE OR REPLACE FUNCTION v2_bootstrap_permission_organization("),sql.indexOf("CREATE OR REPLACE FUNCTION v2_bootstrap_permission_membership("));
  assert.match(bootstrap,/INSERT INTO v2_organization_authority_enrollments[\s\S]*IF NOT FOUND THEN[\s\S]*RETURN;[\s\S]*INSERT INTO v2_permission_organization_state/);
  assert.match(bootstrap,/'proof.respond','payment.view','payment.record'/);assert.match(sql,/Existing organization authority initialization cannot be reset/);cases++;
  const fact=sql.slice(sql.indexOf("CREATE FUNCTION v2_authority_fact_changed"),sql.indexOf("-- Deferred checks only read"));
  assert.doesNotMatch(fact,/current_setting\('v2.authority_entry'/);assert.match(fact,/FROM user_organizations WHERE user_id=ANY\(user_ids\)/);assert.match(fact,/FROM customer_portal_access WHERE user_id=ANY\(user_ids\)/);cases++;
  // Scalar SELECT parity only: no migration/function DDL is applied, no native connection.
  const embedded=new PGlite();try{
    const emailSelect=sql.match(/CREATE FUNCTION v2_staff_login_email_ready[^]*?AS \$\$([^]*?)\$\$;/)![1].replace(/\bemail\b/g,"$1::text");
    const whitespace=["\t","\n","\v","\f","\r"," ","\u00a0","\u1680",...Array.from({length:11},(_,i)=>String.fromCharCode(0x2000+i)),"\u2028","\u2029","\u202f","\u205f","\u3000","\ufeff"];
    const emails=[null,"","staff@example.invalid","STAFF@example.invalid","no-new-format-policy","\u0085","x".repeat(320),"x".repeat(321),"x".repeat(318)+"\u{1f600}","x".repeat(319)+"\u{1f600}",...whitespace.flatMap(value=>[value,value+"staff@example.invalid","staff@example.invalid"+value])];
    for(const email of emails){const result=await embedded.query(emailSelect,[email]);assert.equal(Object.values(result.rows[0]!)[0],isUsableStaffLoginEmail(email),`SQL/JS email parity ${JSON.stringify(email)}`);cases++;}
    const pattern=sql.match(/i.password_hash ~ '([^']+)'/)![1];
    for(const value of [null,"",credential,...["a","b","y"].map(minor=>credential.replace(/^\$2[a-z]/,`$2${minor}`)),credential+"\n",credential+"\r",credential+" ","\t"+credential,credential.slice(0,-1)+"B"]){const result=await embedded.query<{ready:boolean}>("SELECT COALESCE(length($1::text)=60 AND $1::text ~ $2,false) ready",[value,pattern]);assert.equal(result.rows[0].ready,isUsableStaffPasswordHash(value));cases++;}
  } finally {await embedded.close();}
  const team=readFileSync("v2/infrastructure/organization/postgresTeamAccess.ts","utf8");
  assert.doesNotMatch(team,/HAVING count\(DISTINCT c.capability_id\)=2/);assert.match(team,/action\(client,actor\)/);cases++;
  console.log(`ACCESS05 focused contracts: ${cases} cases passed (mock/source and embedded scalar SELECT parity only; no migration application or native concurrency claim).`);
}
main().catch(error=>{console.error(error);process.exitCode=1;});
