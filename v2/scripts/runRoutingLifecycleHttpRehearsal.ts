import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import request from "supertest";
import { requireV2M0CloneDatabaseUrl } from "../infrastructure/persistence/cloneSafety.js";
import { composeAuthenticatedProofingRuntime } from "../infrastructure/proofing/authenticatedProofingRuntime.js";
import { composeAuthenticatedPrepressRuntime } from "../infrastructure/prepress/authenticatedPrepressRuntime.js";
import { composeAuthenticatedProductionRuntime } from "../infrastructure/production/authenticatedProductionRuntime.js";
import { composeAuthenticatedRoutingRuntime } from "../infrastructure/routing/authenticatedRoutingRuntime.js";
import { PostgresRoutingLifecycleTransactionRunner } from "../infrastructure/routing/postgresRoutingLifecycleTransaction.js";
import { createV2HttpApp } from "../src/interfaces/http/app.js";
import { loadV2RuntimeConfig } from "../src/config/runtimeConfig.js";
import { V2ApplicationError } from "../src/errors/applicationError.js";
import type { StaffPrincipal } from "../src/authorization/principals.js";
import { RoutingLifecycleApplicationService } from "../src/modules/routing/routingLifecycle.js";
import { brandedId } from "../src/modules/shared/commercialValues.js";

const cloneHost = "ep-soft-frost-aef6c2jb-pooler.c-2.us-east-2.aws.neon.tech";
const id = (label: string, suffix: string) => `routing-http-${label}-${suffix}`;
const requestId = (label: string) => `routing-http-${label}-${randomUUID()}`;

async function main(): Promise<void> {
  const url = requireV2M0CloneDatabaseUrl();
  const target = new URL(url);
  assert.equal(target.hostname, cloneHost, "Routing rehearsal refuses a database other than the authorized MAIN-derived DEV clone.");
  assert.equal(target.pathname.replace(/^\//u, ""), "neondb", "Routing rehearsal refuses a database other than neondb.");
  const pool = new Pool({ connectionString: url, max: 8, application_name: "routing-lifecycle-http-rehearsal" });
  try {
    const migration = await pool.query<{ present: boolean }>("SELECT EXISTS(SELECT 1 FROM v2_permission_capabilities WHERE id='route.advance') present");
    assert.equal(migration.rows[0]?.present, true, "Migration 0220 must be applied before the Routing HTTP rehearsal.");
    const suffix = randomUUID();
    const org = id("org", suffix), user = id("user", suffix), customer = id("customer", suffix), type = id("type", suffix), product = id("product", suffix);
    const order = id("order", suffix), line = id("line", suffix), template = id("template", suffix), route = id("route", suffix);
    const proofStep = id("proof-step", suffix), prepressStep = id("prepress-step", suffix), productionStep = id("production-step", suffix);
    const file = id("file", suffix), assignment = id("assignment", suffix);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("INSERT INTO organizations(id,name,slug) VALUES($1,'Routing lifecycle',$2)", [org, `routing-lifecycle-${suffix}`]);
      await client.query("INSERT INTO users(id,email,role) VALUES($1,$2,'owner')", [user, `${user}@example.invalid`]);
      await client.query("INSERT INTO customers(id,organization_id,company_name,display_name,is_active,status) VALUES($1,$2,'Routing lifecycle','Routing lifecycle',true,'active')", [customer, org]);
      await client.query("INSERT INTO v2_route_templates(id,organization_id,name,normalized_name,definition_fingerprint) VALUES($1,$2,'Routing lifecycle',$3,'sha256:routing-lifecycle')", [template, org, `routing-lifecycle-${suffix}`]);
      await client.query("INSERT INTO product_types(id,organization_id,name,routing_mode,default_route_template_id) VALUES($1,$2,'Routing lifecycle','route_required',$3)", [type, org, template]);
      await client.query("INSERT INTO products(id,organization_id,name,description,is_active,measurement_mode,product_type_id) VALUES($1,$2,'Routing lifecycle','Routing lifecycle',true,'quantity_only',$3)", [product, org, type]);
      await client.query("INSERT INTO v2_sales_documents(id,organization_id,document_kind,business_number,display_number,customer_id,currency,terms_json) VALUES($1,$2,'order',1,$3,$4,'USD','{}'::jsonb)", [order, org, `ORD-${suffix}`, customer]);
      await client.query("INSERT INTO v2_sales_order_details(document_id,organization_id) VALUES($1,$2)", [order, org]);
      await client.query("INSERT INTO v2_sales_document_lines(id,organization_id,document_id,position,product_id,description,quantity,currency,calculated_unit_cents,calculated_line_cents,selling_unit_cents,selling_line_cents,pricing_result_id,pricing_evidence_fingerprint,resolved_configuration,pricing_result,selling_price_decision,production_requirement_state,production_requirement_fingerprint,production_requirement_count) VALUES($1,$2,$3,0,$4,'Routing lifecycle',2,'USD',100,200,100,200,'routing-http',$5,'{}'::jsonb,'{}'::jsonb,'{}'::jsonb,'configured',$6,1)", [line, org, order, product, `sha256:${"b".repeat(64)}`, `sha256:${"c".repeat(64)}`]);
      await client.query("INSERT INTO v2_sales_line_production_requirements(organization_id,document_id,order_line_id,requirement_key,side) VALUES($1,$2,$3,'front','front')", [org, order, line]);
      await client.query("INSERT INTO v2_artwork_files(id,organization_id,storage_provider,object_key,original_filename,display_filename,content_type,byte_size,source_kind) VALUES($1,$2,'clone',$3,'routing.pdf','routing.pdf','application/pdf',1,'customer_upload')", [file, org, `routing/${suffix}`]);
      await client.query("INSERT INTO v2_artwork_assignments(id,organization_id,artwork_file_id,order_document_id,order_line_id,purpose,side,identity_fingerprint) VALUES($1,$2,$3,$4,$5,'production','front',$6)", [assignment, org, file, order, line, `sha256:${"a".repeat(64)}`]);
      await client.query("INSERT INTO v2_route_instances(id,organization_id,order_document_id,order_line_id,source_template_id,source_template_revision,source_template_fingerprint,route_state,current_step_id) VALUES($1,$2,$3,$4,$5,1,'sha256:routing-lifecycle','pending',$6)", [route, org, order, line, template, proofStep]);
      await client.query("INSERT INTO v2_route_instance_steps(id,organization_id,route_instance_id,position,step_kind) VALUES($1,$2,$3,0,'proofing'),($4,$2,$3,1,'prepress'),($5,$2,$3,2,'production')", [proofStep, org, route, prepressStep, productionStep]);
      await client.query("COMMIT");
    } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }

    const principal: StaffPrincipal = { kind: "staff", organizationId: org, userId: user, authority: { membershipId: `routing-http-membership-${suffix}`, capabilities: ["route.view", "route.advance", "proof.view", "proof.prepare", "proof.issue", "proof.respond", "prepress.view", "prepress.work", "prepress.complete", "production.view", "production.work", "production.complete"] } };
    const trustedHostMiddleware = (request_: any, _response: any, next: () => void) => { request_.isAuthenticated = () => true; request_.user = { id: user }; request_.sessionID = `routing-http-session-${suffix}`; request_.session = { v2CsrfToken: `routing-http-csrf-${suffix}`, v2SessionScope: `routing-http-scope-${suffix}` }; next(); };
    const trustedHostIdentity = { authenticatedIdentity: async () => null };
    const principals = { principal: async (_request: unknown, organizationId: string) => { if (organizationId !== org) throw new V2ApplicationError("WRONG_TENANT", "Authenticated authority is unavailable for this organization."); return principal; } };
    const proofing = composeAuthenticatedProofingRuntime({ pool, trustedHostIdentity, trustedHostMiddleware });
    const prepress = composeAuthenticatedPrepressRuntime({ pool, trustedHostIdentity, trustedHostMiddleware });
    const production = composeAuthenticatedProductionRuntime({ pool, trustedHostIdentity, trustedHostMiddleware });
    const routing = composeAuthenticatedRoutingRuntime({ pool, trustedHostIdentity, trustedHostMiddleware });
    const app = createV2HttpApp(loadV2RuntimeConfig({ NODE_ENV: "test", V2_SERVICE_NAME: "routing-lifecycle-http" }), { log: () => undefined }, undefined, undefined, undefined, undefined, undefined, { ...proofing, dependencies: { ...proofing.dependencies, principals } }, { ...prepress, dependencies: { ...prepress.dependencies, principals } }, { ...production, dependencies: { ...production.dependencies, principals } }, undefined, { ...routing, dependencies: { ...routing.dependencies, principals } });
    const csrf = { "x-v2-csrf-token": `routing-http-csrf-${suffix}` };
    const base = `/v2/organizations/${encodeURIComponent(org)}`;
    const advance = (businessRequestId: string, expectedRevision: string) => request(app).post(`${base}/routing/instances/${encodeURIComponent(route)}/complete-current`).set(csrf).send({ businessRequestId, expectedRevision });
    await request(app).post(`${base}/routing/instances/${encodeURIComponent(route)}/complete-current`).send({ businessRequestId: requestId("missing-csrf"), expectedRevision: "1" }).expect(403);
    await advance(requestId("proof-blocked"), "1").expect(409);

    const proofWork = await request(app).post(`${base}/proofing/works`).set(csrf).send({ businessRequestId: requestId("proof-start"), orderId: order, orderLineId: line }).expect(200);
    const proofWorkId = proofWork.body.data.work.proofWorkId as string;
    const version = await request(app).post(`${base}/proofing/works/${encodeURIComponent(proofWorkId)}/versions`).set(csrf).send({ businessRequestId: requestId("proof-version"), artworkAssignmentIds: [assignment] }).expect(200);
    const proofVersionId = version.body.data.version.proofVersionId as string;
    await request(app).post(`${base}/proofing/versions/${encodeURIComponent(proofVersionId)}/issue`).set(csrf).send({ businessRequestId: requestId("proof-issue") }).expect(200);
    await request(app).post(`${base}/proofing/versions/${encodeURIComponent(proofVersionId)}/respond`).set(csrf).send({ businessRequestId: requestId("proof-approved"), outcome: "approved", recordedCustomerId: customer }).expect(200);
    const proofAdvanceId = requestId("proof-advance");
    const proofAdvance = await advance(proofAdvanceId, "1").expect(200);
    assert.equal(proofAdvance.body.data.routeInstance.currentStepId, prepressStep, "Proof completion did not activate the frozen Prepress step.");
    await advance(proofAdvanceId, "1").expect(200);
    await advance(requestId("prepress-blocked"), "2").expect(409);

    const opened = await request(app).post(`${base}/prepress/units`).set(csrf).send({ businessRequestId: requestId("prepress-open"), artworkAssignmentId: assignment }).expect(200);
    const prepressUnitId = opened.body.data.unit.prepressUnitId as string;
    await request(app).post(`${base}/prepress/units/${encodeURIComponent(prepressUnitId)}/start`).set(csrf).send({ businessRequestId: requestId("prepress-start") }).expect(200);
    await request(app).post(`${base}/prepress/units/${encodeURIComponent(prepressUnitId)}/complete`).set(csrf).send({ businessRequestId: requestId("prepress-complete") }).expect(200);
    const rollbackRequest = requestId("rollback");
    const rollback = await new RoutingLifecycleApplicationService(new PostgresRoutingLifecycleTransactionRunner(pool, { afterAdvance: () => { throw new Error("injected routing rollback"); } })).completeCurrentStep({ organizationId: org, operationId: "routing-http:rollback", businessRequest: { id: rollbackRequest, payloadFingerprint: "derived" }, principal }, { businessRequestId: rollbackRequest, routeInstanceId: brandedId<"RouteInstanceId">(route), expectedRevision: "2" });
    assert(!rollback.ok, "Injected failure must reject the Routing transition.");
    const rollbackState = await pool.query<{ revision: string; current_step_id: string }>("SELECT revision,current_step_id FROM v2_route_instances WHERE organization_id=$1 AND id=$2", [org, route]);
    assert.deepEqual(rollbackState.rows[0], { revision: "2", current_step_id: prepressStep }, "Routing rollback left a partially advanced route.");
    const rollbackRequestRows = await pool.query<{ count: string }>("SELECT count(*)::text FROM v2_operation_requests WHERE organization_id=$1 AND operation='routing.step.complete.v1' AND business_request_id=$2", [org, rollbackRequest]);
    assert.equal(rollbackRequestRows.rows[0]?.count, "0", "Routing rollback left an idempotency residue.");
    const races = await Promise.all([advance(requestId("prepress-race-a"), "2"), advance(requestId("prepress-race-b"), "2")]);
    assert.deepEqual(races.map((response) => response.status).sort(), [200, 409], "Concurrent Route advancement must produce one winner and one stale loser.");
    const current = await pool.query<{ route_state: string; current_step_id: string; revision: string }>("SELECT route_state,current_step_id,revision FROM v2_route_instances WHERE organization_id=$1 AND id=$2", [org, route]);
    assert.deepEqual(current.rows[0], { route_state: "active", current_step_id: productionStep, revision: "3" }, "Routing did not reach exactly the frozen Production step.");
    const productionWork = await request(app).post(`${base}/production/works`).set(csrf).send({ businessRequestId: requestId("production-open"), artworkAssignmentId: assignment }).expect(200);
    const productionWorkId = productionWork.body.data.work.productionWorkId as string;
    const attempt = await request(app).post(`${base}/production/works/${encodeURIComponent(productionWorkId)}/attempts`).set(csrf).send({ businessRequestId: requestId("production-start"), stationKey: "flatbed", kind: "initial" }).expect(200);
    assert.equal(attempt.body.data.attempt.kind, "initial", "Canonical Production first-start behavior changed after Route advancement.");
    const frozenBefore = await pool.query("SELECT position,step_kind FROM v2_route_instance_steps WHERE organization_id=$1 AND route_instance_id=$2 ORDER BY position", [org, route]);
    await pool.query("UPDATE v2_route_templates SET definition_fingerprint='sha256:changed',revision=revision+1 WHERE organization_id=$1 AND id=$2", [org, template]);
    const frozenAfter = await pool.query("SELECT position,step_kind FROM v2_route_instance_steps WHERE organization_id=$1 AND route_instance_id=$2 ORDER BY position", [org, route]);
    assert.deepEqual(frozenAfter.rows, frozenBefore.rows, "A later Route Template change reinterpreted the Order's frozen Route.");
    await request(app).post(`/v2/organizations/not-${encodeURIComponent(org)}/routing/instances/${encodeURIComponent(route)}/complete-current`).set(csrf).send({ businessRequestId: requestId("wrong-tenant"), expectedRevision: "3" }).expect(404);
    console.log(JSON.stringify({ organizationId: org, route, proofing: "approved → advanced", prepress: "completed → advanced", productionWork: productionWorkId, firstAttempt: attempt.body.data.attempt.productionAttemptId, concurrency: "one transition / one stale conflict", frozenRoute: "preserved" }, null, 2));
    console.log("[routing] Authenticated frozen-route lifecycle clone rehearsal passed.");
  } finally { await pool.end(); }
}

void main().catch((cause: unknown) => { console.error(`[routing] ${cause instanceof Error ? cause.stack ?? cause.message : String(cause)}`); process.exitCode = 1; });
