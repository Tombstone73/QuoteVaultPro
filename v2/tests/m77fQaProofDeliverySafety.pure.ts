import assert from "node:assert/strict";
import { M77F_QA_ORGANIZATION_ID, shouldCaptureM77fQaPortalSetup, shouldSuppressM77fQaProofDelivery } from "../infrastructure/communications/m77fQaProofDeliverySafety.js";
import { PostgresProofEmailDeliveryQueue } from "../infrastructure/communications/proofEmailDeliveryQueue.js";

const deployedDev = {
  NODE_ENV: "production",
  APP_ENV: "development",
  RAILWAY_PROJECT_NAME: "PrintersHero-DEV",
  RAILWAY_ENVIRONMENT_NAME: "Development",
  DATABASE_URL: "postgres://safe@ep-wandering-band-aebq1qcx-pooler.c-2.us-east-2.aws.neon.tech/neondb",
};

assert.equal(shouldSuppressM77fQaProofDelivery(M77F_QA_ORGANIZATION_ID, deployedDev), true);
assert.equal(shouldCaptureM77fQaPortalSetup(M77F_QA_ORGANIZATION_ID, deployedDev), true);
assert.equal(shouldSuppressM77fQaProofDelivery("ordinary-dev-org", deployedDev), false);
assert.equal(shouldCaptureM77fQaPortalSetup("ordinary-dev-org", deployedDev), false);
assert.equal(shouldSuppressM77fQaProofDelivery(M77F_QA_ORGANIZATION_ID, {...deployedDev, APP_ENV:"production"}), false);
assert.equal(shouldCaptureM77fQaPortalSetup(M77F_QA_ORGANIZATION_ID, {...deployedDev, RAILWAY_PROJECT_NAME:"PrintersHero-PRODUCTION"}), false);
assert.equal(shouldSuppressM77fQaProofDelivery(M77F_QA_ORGANIZATION_ID, {...deployedDev, DATABASE_URL:"postgres://safe@prod.example/neondb"}), false);

const original=Object.fromEntries(Object.keys(deployedDev).map((key)=>[key,process.env[key]]));
const calls: Array<Readonly<{sql:string;parameters:readonly unknown[]}>>=[];
let emailCalls=0;
const pool={query:async(sql:string,parameters:readonly unknown[]=[])=>{calls.push({sql,parameters});return {rows:[]};}};
const email={requireReady:async()=>{emailCalls+=1;throw new Error("email integration must not be used for M7 QA suppression");}};
Object.assign(process.env,deployedDev);
try {
  const queue=new PostgresProofEmailDeliveryQueue(pool as never,email as never);
  const state=await queue.process({id:"job-1",organizationId:M77F_QA_ORGANIZATION_ID,proofVersionId:"version-1",recipient:"qa@example.invalid",portalAccessId:"access-1",attemptCount:1},"worker-1",5);
  assert.equal(state,"sent");
  assert.equal(emailCalls,0);
  assert.equal(calls.length,2);
  assert.equal(calls[0]?.parameters.at(-1),false);
  assert.match(calls[0]?.sql??"",/\$8::boolean AND f\.state='sent'/);
  assert.match(String(calls[1]?.parameters[2]),/providerCall/);
} finally {
  for(const [key,value] of Object.entries(original)) { if(value===undefined) delete process.env[key]; else process.env[key]=value; }
}
console.log("M7.7F QA proof delivery guard tests passed.");
