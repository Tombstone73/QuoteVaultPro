import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { SUPPRESSED_DELIVERY_STATE } from "../src/modules/shared/deliveryStates.js";

assert.equal(SUPPRESSED_DELIVERY_STATE, "suppressed");

const proof = readFileSync("v2/infrastructure/communications/proofEmailDeliveryQueue.ts", "utf8");
assert.match(proof, /SUPPRESSED_DELIVERY_STATE/);
assert.match(proof, /provider call not attempted/u);
assert.match(proof, /f\.state='sent'/u, "Only a real sent state may mark portal invite/token delivery.");
assert.match(proof, /'suppressed'/u);

const portal = readFileSync("v2/infrastructure/organization/postgresTeamAccess.ts", "utf8");
const captureStart = portal.lastIndexOf("if(captureM77fQaSetupUrl){");
const captureEnd = portal.indexOf("\n    try { const origin=", captureStart);
const capture = portal.slice(captureStart, captureEnd);
assert.match(capture, /delivery_state=\$4/u);
assert.match(capture, /SUPPRESSED_DELIVERY_STATE/u);
assert.doesNotMatch(capture, /delivery_state='succeeded'/u);
assert.doesNotMatch(capture, /invite_sent_at|sent_at|provider_message_id/u);
assert.match(capture, /providerCall:"not_attempted"/u);
assert.match(capture, /environment:"dev_qa"/u);

const migration = readFileSync("server/db/migrations_v2/0274_v2_suppressed_delivery_evidence.sql", "utf8");
assert.match(migration, /v2_proof_delivery_jobs_state_check/u);
assert.match(migration, /v2_portal_invitation_delivery_attempts_delivery_state_check/u);
assert.match(migration, /'suppressed'/u);
console.log("M7.7F suppressed delivery semantics tests passed.");
