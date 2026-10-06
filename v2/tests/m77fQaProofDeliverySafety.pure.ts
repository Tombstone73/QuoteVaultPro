import assert from "node:assert/strict";
import { isM77fQaDevTarget, M77F_QA_ORGANIZATION_ID, shouldCaptureM77fQaPortalSetup, shouldSuppressM77fQaProofDelivery } from "../infrastructure/communications/m77fQaProofDeliverySafety.js";
import { PostgresProofEmailDeliveryQueue } from "../infrastructure/communications/proofEmailDeliveryQueue.js";

const deployedDev = {
  NODE_ENV: "production",
  APP_ENV: "development",
  RAILWAY_PROJECT_NAME: "PrintersHero-DEV",
  RAILWAY_ENVIRONMENT_NAME: "Development",
  DATABASE_URL: "postgres://safe@ep-soft-frost-aef6c2jb-pooler.c-2.us-east-2.aws.neon.tech/neondb",
};

assert.equal(shouldSuppressM77fQaProofDelivery(M77F_QA_ORGANIZATION_ID, deployedDev), true);
assert.equal(isM77fQaDevTarget(M77F_QA_ORGANIZATION_ID, deployedDev), true);
assert.equal(shouldCaptureM77fQaPortalSetup(M77F_QA_ORGANIZATION_ID, deployedDev), true);
assert.equal(shouldSuppressM77fQaProofDelivery("ordinary-dev-org", deployedDev), false);
assert.equal(shouldCaptureM77fQaPortalSetup("ordinary-dev-org", deployedDev), false);
assert.equal(shouldSuppressM77fQaProofDelivery(M77F_QA_ORGANIZATION_ID, {...deployedDev, APP_ENV:"production"}), false);
assert.equal(shouldCaptureM77fQaPortalSetup(M77F_QA_ORGANIZATION_ID, {...deployedDev, RAILWAY_PROJECT_NAME:"PrintersHero-PRODUCTION"}), false);
assert.equal(shouldSuppressM77fQaProofDelivery(M77F_QA_ORGANIZATION_ID, {...deployedDev, DATABASE_URL:"postgres://safe@prod.example/neondb"}), false);
assert.equal(isM77fQaDevTarget(M77F_QA_ORGANIZATION_ID, {...deployedDev, DATABASE_URL:undefined}), false);

const original=Object.fromEntries(Object.keys(deployedDev).map((key)=>[key,process.env[key]]));
const calls: Array<Readonly<{sql:string;parameters:readonly unknown[]}>>=[];
const protocol:string[]=[];
let phase:"idle"|"connected"|"begun"|"entered"|"finished"|"committed"|"rolled_back"|"released"="idle";
let emailCalls=0;
const client={
  query:async(sql:string,parameters:readonly unknown[]=[])=>{
    if(sql==="BEGIN"){
      assert.equal(phase,"connected");assert.deepEqual(parameters,[]);phase="begun";protocol.push("BEGIN");
    }else if(sql==="SELECT v2_authority_entry($1::varchar[],false)"){
      assert.equal(phase,"begun");assert.deepEqual(parameters,[[M77F_QA_ORGANIZATION_ID]]);phase="entered";protocol.push("Auth entry");
    }else if(/^WITH finished AS \(UPDATE v2_proof_delivery_jobs SET state=\$3::varchar,.*\) SELECT count\(\*\) FROM finished$/u.test(sql)){
      assert.equal(phase,"entered","Protected completion writes require entry on this client");
      assert.equal(parameters.length,8);assert.equal(parameters[0],M77F_QA_ORGANIZATION_ID);assert.equal(parameters[1],"job-1");assert.equal(parameters[4],null);assert.equal(parameters[6],"worker-1");
      assert.match(sql,/access_mark AS \(UPDATE customer_portal_access/u);assert.match(sql,/token_mark AS \(UPDATE customer_portal_invite_tokens/u);
      calls.push({sql,parameters});phase="finished";protocol.push("finish writes");
    }else if(sql==="COMMIT"){
      assert.equal(phase,"finished");assert.deepEqual(parameters,[]);phase="committed";protocol.push("COMMIT");
    }else if(sql==="ROLLBACK"){
      assert.ok(["begun","entered","finished"].includes(phase));assert.deepEqual(parameters,[]);phase="rolled_back";protocol.push("ROLLBACK");
    }else assert.fail(`Unexpected transactional query: ${sql}`);
    return {rows:[]};
  },
  release:()=>{assert.ok(phase==="committed"||phase==="rolled_back");phase="released";protocol.push("release");},
};
const pool={
  connect:async()=>{assert.equal(phase,"idle");phase="connected";protocol.push("connect");return client;},
  query:async(sql:string,parameters:readonly unknown[]=[])=>{
    assert.equal(phase,"released","The suppression audit follows transaction completion");
    assert.equal(sql,"INSERT INTO v2_audit_events(organization_id,operation,event_type,resource_type,resource_id,principal_kind,principal_subject,changes) VALUES($1,'proof.delivery.worker.v1','proof_notification_delivery_suppressed','proof_version',$2,'service','proof-email-worker',$3::jsonb)");
    assert.equal(parameters[0],M77F_QA_ORGANIZATION_ID);assert.equal(parameters[1],"version-1");
    calls.push({sql,parameters});protocol.push("suppression audit");return {rows:[]};
  },
};
const email={requireReady:async()=>{emailCalls+=1;throw new Error("email integration must not be used for M7 QA suppression");}};
Object.assign(process.env,deployedDev);
try {
  const queue=new PostgresProofEmailDeliveryQueue(pool as never,email as never);
  const state=await queue.process({id:"job-1",organizationId:M77F_QA_ORGANIZATION_ID,proofVersionId:"version-1",recipient:"qa@example.invalid",portalAccessId:"access-1",attemptCount:1},"worker-1",5);
  assert.equal(state,"suppressed");
  assert.equal(emailCalls,0);
  assert.deepEqual(protocol,["connect","BEGIN","Auth entry","finish writes","COMMIT","release","suppression audit"]);
  assert.equal(calls.length,2);
  assert.equal(calls[0]?.parameters.at(-1),false);
  assert.equal(calls[0]?.parameters[2],"suppressed");
  assert.match(calls[0]?.sql??"",/SET state=\$3::varchar/);
  assert.match(calls[0]?.sql??"",/\$3::varchar IN \('sent','failed','ambiguous','suppressed'\)/);
  assert.match(calls[0]?.sql??"",/\$8::boolean AND f\.state='sent'/);
  assert.match(String(calls[1]?.parameters[2]),/providerCall/);
  assert.match(String(calls[1]?.parameters[2]),/dev_qa/);
} finally {
  for(const [key,value] of Object.entries(original)) { if(value===undefined) delete process.env[key]; else process.env[key]=value; }
}
console.log("M7.7F QA proof delivery guard tests passed.");
