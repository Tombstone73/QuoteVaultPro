/**
 * Test-only authenticated browser composition for M1.7.5B.
 *
 * This script is intentionally outside the V2 production composition root. It
 * requires an explicit clone gate, creates only ephemeral fixture identities,
 * and exposes fixed fixture aliases rather than accepting browser authority
 * claims. The V2 app still receives identity through Passport's session and
 * reissues its Principal from PostgreSQL permission sets for every request.
 */
import { randomBytes, randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import session from "express-session";
import passport from "passport";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool, type PoolClient } from "pg";
import { PassportSessionIdentitySource } from "../infrastructure/authentication/trustedHostPrincipalProvider.js";
import { requireV2BrowserCloneDatabaseUrl } from "../infrastructure/persistence/cloneSafety.js";
import { assertV2M0PhysicalPostconditions, checkV2M0PhysicalPostconditions } from "../infrastructure/persistence/physicalPostconditions.js";
import { assertV2CommercialPhysicalPostconditions, checkV2CommercialPhysicalPostconditions } from "../infrastructure/sales/commercialPhysicalPostconditions.js";
import { composeAuthenticatedQuoteRuntime } from "../infrastructure/sales/authenticatedQuoteRuntime.js";
import { composeAuthenticatedOrderRuntime } from "../infrastructure/sales/authenticatedOrderRuntime.js";
import { composeAuthenticatedBillingRuntime } from "../infrastructure/billing/authenticatedBillingRuntime.js";
import { composeAuthenticatedArtworkRuntime } from "../infrastructure/artwork/authenticatedArtworkRuntime.js";
import { composeAuthenticatedProofingRuntime } from "../infrastructure/proofing/authenticatedProofingRuntime.js";
import { composeAuthenticatedPrepressRuntime } from "../infrastructure/prepress/authenticatedPrepressRuntime.js";
import { ArtworkApplicationService } from "../src/modules/artwork/artworkApplication.js";
import { PostgresArtworkTransactionRunner } from "../infrastructure/artwork/postgresArtworkTransaction.js";
import { OrderApplicationService } from "../src/modules/sales/orderApplication.js";
import { PostgresOrderTransactionRunner } from "../infrastructure/sales/postgresOrderTransaction.js";
import { loadV2RuntimeConfig } from "../src/config/runtimeConfig.js";
import { createV2HttpApp } from "../src/interfaces/http/app.js";

type BrowserFixture = Readonly<{
  organizationA: string; organizationB: string;
  staffA: string; limitedA: string; staffB: string;
  customerA: string; contactA: string; customerB: string; contactB: string;
  dimensionalProductA: string; quantityProductA: string; productB: string;
  serviceProductA: string;
  salesSetA: string;
}>;
type PublicBrowserFixture = Omit<BrowserFixture, "staffA" | "limitedA" | "staffB" | "salesSetA">;
const migrationsFolder = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../server/db/migrations_v2");
const browserTestEnabled = () => process.env.V2_M175B_BROWSER_TEST === "1";
const assert = (value: unknown, message: string): asserts value => { if (!value) throw new Error(message); };

const tree = (measurementMode: "dimensions_required" | "quantity_only", choice = "legacy") => ({
  schemaVersion: 2,
  rootNodeIds: ["finish"],
  nodes: { finish: { id: "finish", kind: "question", label: "Finish", input: { type: "select", selectionKey: "finish", defaultValue: choice, required: true }, choices: [{ value: choice, label: choice }, { value: `${choice}-alternate`, label: `${choice} alternate` }] } },
  meta: { pricingV2: { base: measurementMode === "dimensions_required" ? { perSqftCents: 100 } : { perPieceCents: 250 } }, productionUnitSpecification: { schemaVersion: 1, rules: measurementMode === "dimensions_required" ? [{ key: "front", side: "front" }, { key: "back", side: "back" }] : [{ key: "front", side: "front" }] } },
});

/** Creates only clone-local records and returns opaque identifiers for browser assertions. */
const createFixture = async (client: PoolClient): Promise<BrowserFixture> => {
  const id = randomUUID();
  const f = {
    organizationA: `m175b-org-a-${id}`, organizationB: `m175b-org-b-${id}`,
    staffA: `m175b-staff-a-${id}`, limitedA: `m175b-limited-a-${id}`, staffB: `m175b-staff-b-${id}`,
    customerA: `m175b-customer-a-${id}`, contactA: `m175b-contact-a-${id}`,
    customerB: `m175b-customer-b-${id}`, contactB: `m175b-contact-b-${id}`,
    dimensionalProductA: `m175b-dim-a-${id}`, quantityProductA: `m175b-qty-a-${id}`, productB: `m175b-product-b-${id}`, serviceProductA: `m175b-service-a-${id}`,
    salesSetA: `m175b-sales-a-${id}`,
  } as const;
  const limitedSet = `m175b-limited-${id}`, salesSetB = `m175b-sales-b-${id}`;
  const dimTree = `m175b-tree-dim-${id}`, quantityTree = `m175b-tree-qty-${id}`, productBTree = `m175b-tree-b-${id}`, serviceTree = `m175b-tree-service-${id}`;
  const routeTemplate = `m175b-route-${id}`, printedType = `m175b-printed-${id}`, serviceType = `m175b-service-type-${id}`;
  await client.query("BEGIN");
  try {
    await client.query("INSERT INTO organizations(id,name,slug) VALUES($1,'M175B A',$2),($3,'M175B B',$4)", [f.organizationA, `m175b-a-${id}`, f.organizationB, `m175b-b-${id}`]);
    await client.query("INSERT INTO users(id,email,role) VALUES($1,$2,'owner'),($3,$4,'member'),($5,$6,'owner')", [f.staffA, `${f.staffA}@test.invalid`, f.limitedA, `${f.limitedA}@test.invalid`, f.staffB, `${f.staffB}@test.invalid`]);
    await client.query("INSERT INTO user_organizations(user_id,organization_id,role,is_active) VALUES($1,$2,'owner',true),($3,$2,'member',true),($4,$5,'owner',true)", [f.staffA, f.organizationA, f.limitedA, f.staffB, f.organizationB]);
    await client.query("INSERT INTO v2_permission_organization_state(organization_id) VALUES($1),($2)", [f.organizationA, f.organizationB]);
    await client.query("INSERT INTO v2_permission_sets(id,organization_id,name,normalized_name,principal_kind) VALUES($1,$2,'Sales','sales','staff'),($3,$2,'Limited','limited','staff'),($4,$5,'Sales','sales','staff')", [f.salesSetA, f.organizationA, limitedSet, salesSetB, f.organizationB]);
    for (const [org, set] of [[f.organizationA, f.salesSetA], [f.organizationB, salesSetB]] as const)
      for (const capability of ["quote.view", "quote.create", "quote.edit", "quote.send", "quote.convert", "quote.overridePrice", "order.view", "order.edit", "order.overridePrice", "invoice.view", "artwork.view", "artwork.adopt", "artwork.assign", "proof.view", "proof.prepare", "proof.issue", "proof.respond", "prepress.view", "prepress.work", "prepress.complete"])
        await client.query("INSERT INTO v2_permission_set_capabilities(organization_id,permission_set_id,capability_id) VALUES($1,$2,$3)", [org, set, capability]);
    for (const capability of ["quote.view", "quote.create", "quote.edit", "quote.send", "order.view", "order.edit", "invoice.view", "artwork.view", "proof.view"])
      await client.query("INSERT INTO v2_permission_set_capabilities(organization_id,permission_set_id,capability_id) VALUES($1,$2,$3)", [f.organizationA, limitedSet, capability]);
    await client.query("INSERT INTO v2_staff_permission_set_assignments(organization_id,user_id,permission_set_id) VALUES($1,$2,$3),($1,$4,$5),($6,$7,$8)", [f.organizationA, f.staffA, f.salesSetA, f.limitedA, limitedSet, f.organizationB, f.staffB, salesSetB]);
    await client.query("INSERT INTO customers(id,organization_id,company_name,display_name,is_active,status) VALUES($1,$2,'Browser A','Browser A',true,'active'),($3,$4,'Browser B','Browser B',true,'active')", [f.customerA, f.organizationA, f.customerB, f.organizationB]);
    await client.query("INSERT INTO customer_contacts(id,organization_id,first_name,last_name,status) VALUES($1,$2,'A','Contact','active'),($3,$4,'B','Contact','active')", [f.contactA, f.organizationA, f.contactB, f.organizationB]);
    await client.query("INSERT INTO customer_contact_links(organization_id,customer_id,contact_id,status) VALUES($1,$2,$3,'active'),($4,$5,$6,'active')", [f.organizationA, f.customerA, f.contactA, f.organizationB, f.customerB, f.contactB]);
    await client.query("INSERT INTO v2_route_templates(id,organization_id,name,normalized_name,definition_fingerprint) VALUES($1,$2,'Browser printed','browser-printed','sha256:m175b')", [routeTemplate, f.organizationA]);
    for (const [position, kind] of ["proofing", "prepress", "production", "fulfillment"].entries()) await client.query("INSERT INTO v2_route_template_steps(id,organization_id,route_template_id,position,step_kind) VALUES($1,$2,$3,$4,$5)", [randomUUID(), f.organizationA, routeTemplate, position, kind]);
    await client.query("INSERT INTO product_types(id,organization_id,name,routing_mode,default_route_template_id) VALUES($1,$2,'Browser Printed','route_required',$3),($4,$2,'Browser Service','no_route',NULL)", [printedType, f.organizationA, routeTemplate, serviceType]);
    await client.query("INSERT INTO products(id,organization_id,name,description,is_active,measurement_mode,product_type_id) VALUES($1,$2,'Browser dimensional','Fixture',true,'dimensions_required',$3),($4,$2,'Browser quantity-only','Fixture',true,'quantity_only',$5),($6,$2,'Browser Service','Fixture',true,'quantity_only',$5),($7,$8,'Browser B product','Fixture',true,'dimensions_required',NULL)", [f.dimensionalProductA, f.organizationA, printedType, f.quantityProductA, serviceType, f.serviceProductA, f.productB, f.organizationB]);
    await client.query("INSERT INTO pbv2_tree_versions(id,organization_id,product_id,status,schema_version,tree_json,published_at) VALUES($1,$2,$3,'ACTIVE',2,$4::jsonb,now()),($5,$2,$6,'ACTIVE',2,$7::jsonb,now()),($8,$2,$9,'ACTIVE',2,$10::jsonb,now()),($11,$12,$13,'ACTIVE',2,$14::jsonb,now())", [dimTree, f.organizationA, f.dimensionalProductA, JSON.stringify(tree("dimensions_required")), quantityTree, f.quantityProductA, JSON.stringify(tree("quantity_only", "basic")), serviceTree, f.serviceProductA, JSON.stringify(tree("quantity_only", "service")), productBTree, f.organizationB, f.productB, JSON.stringify(tree("dimensions_required", "standard"))]);
    await client.query("UPDATE products SET pbv2_active_tree_version_id=CASE id WHEN $1 THEN $2 WHEN $3 THEN $4 WHEN $5 THEN $6 WHEN $7 THEN $8 END WHERE (organization_id=$9 AND id IN($1,$3,$5)) OR (organization_id=$10 AND id=$7)", [f.dimensionalProductA, dimTree, f.quantityProductA, quantityTree, f.serviceProductA, serviceTree, f.productB, productBTree, f.organizationA, f.organizationB]);
    await client.query("COMMIT");
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  return f;
};

const main = async () => {
  if (!browserTestEnabled()) throw new Error("M1.7.5B browser host is test-only; V2_M175B_BROWSER_TEST must equal 1.");
  const url = requireV2BrowserCloneDatabaseUrl();
  const pool = new Pool({ connectionString: url, max: 5 });
  const client = await pool.connect();
  let fixture: BrowserFixture | undefined;
  try {
    await migrate(drizzle({ client: pool }), { migrationsFolder, migrationsTable: "__drizzle_migrations_v2", migrationsSchema: "public" });
    assertV2M0PhysicalPostconditions(await checkV2M0PhysicalPostconditions(client));
    assertV2CommercialPhysicalPostconditions(await checkV2CommercialPhysicalPostconditions(client));
    fixture = await createFixture(client);
    const app = express();
    const passportInstance = new passport.Passport();
    passportInstance.serializeUser((user, done) => {
      const id = (user as { id?: unknown }).id;
      done(typeof id === "string" ? null : new Error("Fixture user identity is invalid."), id);
    });
    passportInstance.deserializeUser((id: string, done) => done(null, { id }));
    app.use(session({ name: "v2_m175b_session", secret: randomBytes(32).toString("base64url"), resave: false, saveUninitialized: false, cookie: { httpOnly: true, sameSite: "lax", secure: false } }));
    app.use(passportInstance.initialize()); app.use(passportInstance.session()); app.use(express.json({ limit: "32kb" }));
    const aliases: Record<string, string> = { "staff-a": fixture.staffA, "limited-a": fixture.limitedA, "staff-b": fixture.staffB };
    app.post("/_v2-browser-test/session", (request, response, next) => {
      const actor = typeof request.body?.actor === "string" ? request.body.actor : "";
      const userId = aliases[actor];
      if (!userId) return response.status(400).json({ ok: false, error: "fixed actor alias required" });
      request.session.regenerate((regenerateError) => {
        if (regenerateError) return next(regenerateError);
        request.login({ id: userId }, (loginError) => loginError ? next(loginError) : response.status(204).end());
      });
    });
    app.post("/_v2-browser-test/logout", (request, response, next) => request.logout((error) => error ? next(error) : request.session.destroy(() => response.status(204).end())));
    const fixtureAdmin = (request: express.Request, response: express.Response, next: express.NextFunction) => {
      const user = request.user as { id?: unknown } | undefined;
      if (request.isAuthenticated() !== true || user?.id !== fixture!.staffA)
        return response.status(403).json({ ok: false, error: "fixture administrator required" });
      next();
    };
    app.get("/_v2-browser-test/fixture", (_request, response) => {
      const { staffA: _staffA, limitedA: _limitedA, staffB: _staffB, salesSetA: _salesSetA, ...publicFixture } = fixture!;
      response.json({ ok: true, data: publicFixture satisfies PublicBrowserFixture });
    });
    app.post("/_v2-browser-test/remove-override", fixtureAdmin, async (_request, response, next) => {
      try { await pool.query("DELETE FROM v2_permission_set_capabilities WHERE organization_id=$1 AND permission_set_id=$2 AND capability_id='quote.overridePrice'", [fixture!.organizationA, fixture!.salesSetA]); response.status(204).end(); } catch (error) { next(error); }
    });
    app.post("/_v2-browser-test/product-definition-change", fixtureAdmin, async (_request, response, next) => {
      try {
        const changedTree = `m175b-tree-changed-${randomUUID()}`;
        await pool.query("BEGIN");
        await pool.query("UPDATE pbv2_tree_versions SET status='DEPRECATED' WHERE organization_id=$1 AND product_id=$2 AND status='ACTIVE'", [fixture!.organizationA, fixture!.dimensionalProductA]);
        await pool.query("INSERT INTO pbv2_tree_versions(id,organization_id,product_id,status,schema_version,tree_json,published_at) VALUES($1,$2,$3,'ACTIVE',2,$4::jsonb,now())", [changedTree, fixture!.organizationA, fixture!.dimensionalProductA, JSON.stringify(tree("dimensions_required", "standard"))]);
        await pool.query("UPDATE products SET pbv2_active_tree_version_id=$1 WHERE organization_id=$2 AND id=$3", [changedTree, fixture!.organizationA, fixture!.dimensionalProductA]);
        await pool.query("COMMIT"); response.status(204).end();
      } catch (error) { await pool.query("ROLLBACK").catch(() => undefined); next(error); }
    });
    /** Test-only, staff-A-gated authoritative PostgreSQL verification for a browser-created Quote. */
    app.get("/_v2-browser-test/readback/:quoteId", fixtureAdmin, async (request, response, next) => {
      try {
        const quoteId = request.params.quoteId;
        const organizationId = fixture!.organizationA;
        const [document, lines, checkpoints, audit, operations] = await Promise.all([
          pool.query("SELECT id,organization_id,business_number,display_number,customer_id,contact_id,purchase_order_number,requested_due_date,terms_json,commercial_notes,revision FROM v2_sales_documents WHERE organization_id=$1 AND id=$2 AND document_kind='quote'", [organizationId, quoteId]),
          pool.query("SELECT id,product_id,quantity,calculated_unit_cents,calculated_line_cents,selling_unit_cents,selling_line_cents,resolved_configuration,pricing_result,selling_price_decision FROM v2_sales_document_lines WHERE organization_id=$1 AND document_id=$2 ORDER BY position", [organizationId, quoteId]),
          pool.query("SELECT checkpoint_kind,principal_subject,staff_actor_user_id,operation_request_id FROM v2_sales_quote_checkpoints WHERE organization_id=$1 AND quote_document_id=$2 ORDER BY checkpoint_sequence", [organizationId, quoteId]),
          pool.query("SELECT event_type,principal_subject,staff_actor_user_id,operation_request_id,changes FROM v2_audit_events WHERE organization_id=$1 AND resource_type='quote' AND resource_id=$2 ORDER BY created_at", [organizationId, quoteId]),
          pool.query("SELECT id,operation,business_request_id,status,result_resource_type,result_resource_id FROM v2_operation_requests WHERE organization_id=$1 AND result_resource_type='quote' AND result_resource_id=$2 ORDER BY created_at", [organizationId, quoteId]),
        ]);
        if (!document.rows[0]) return response.status(404).json({ ok: false });
        // Do not expose actor identifiers to the browser—not even from this
        // test-only readback. Return only server-verified attribution facts.
        const attributedCheckpoints = checkpoints.rows.map((row) => ({ checkpoint_kind: row.checkpoint_kind, staffActorVerified: row.staff_actor_user_id === fixture!.staffA, operation_request_id: row.operation_request_id }));
        const attributedAudit = audit.rows.map((row) => ({ event_type: row.event_type, staffActorVerified: row.staff_actor_user_id === fixture!.staffA, operation_request_id: row.operation_request_id, changes: row.changes }));
        response.json({ ok: true, data: { document: document.rows[0], lines: lines.rows, checkpoints: attributedCheckpoints, audit: attributedAudit, operations: operations.rows } });
      } catch (error) { next(error); }
    });
    /** Test-only authoritative readback for an Order created through Quote conversion. */
    app.get("/_v2-browser-test/order-readback/:orderId", fixtureAdmin, async (request, response, next) => {
      try {
        const orderId = request.params.orderId, organizationId = fixture!.organizationA;
        const [document, lines, invoice, routes, conversion, audit] = await Promise.all([
          pool.query("SELECT id,organization_id,display_number,customer_id,contact_id,purchase_order_number,requested_due_date,commercial_notes,revision FROM v2_sales_documents WHERE organization_id=$1 AND id=$2 AND document_kind='order'", [organizationId, orderId]),
          pool.query("SELECT id,product_id,quantity,calculated_line_cents,selling_line_cents,resolved_configuration,pricing_result,selling_price_decision FROM v2_sales_document_lines WHERE organization_id=$1 AND document_id=$2 ORDER BY position", [organizationId, orderId]),
          pool.query("SELECT id,invoice_state,total_cents,source_sales_state_token FROM v2_billing_invoices WHERE organization_id=$1 AND sales_order_document_id=$2", [organizationId, orderId]),
          pool.query("SELECT r.order_line_id,r.route_state,array_agg(s.step_kind ORDER BY s.position) AS steps FROM v2_route_instances r JOIN v2_route_instance_steps s ON s.organization_id=r.organization_id AND s.route_instance_id=r.id WHERE r.organization_id=$1 AND r.order_document_id=$2 GROUP BY r.order_line_id,r.route_state", [organizationId, orderId]),
          pool.query("SELECT quote_document_id,source_checkpoint_id,conversion_checkpoint_id FROM v2_sales_quote_conversions WHERE organization_id=$1 AND order_document_id=$2", [organizationId, orderId]),
          pool.query("SELECT event_type,staff_actor_user_id FROM v2_audit_events WHERE organization_id=$1 AND resource_id=$2 ORDER BY created_at", [organizationId, orderId]),
        ]);
        if (!document.rows[0]) return response.status(404).json({ ok: false });
        response.json({ ok: true, data: { document: document.rows[0], lines: lines.rows, invoice: invoice.rows[0] ?? null, routes: routes.rows, conversion: conversion.rows[0] ?? null, audit: audit.rows.map((row) => ({ event_type: row.event_type, staffActorVerified: row.staff_actor_user_id === fixture!.staffA })) } });
      } catch (error) { next(error); }
    });
    const trustedHostIdentity = new PassportSessionIdentitySource(), trustedHostMiddleware = (_request: express.Request, _response: express.Response, next: express.NextFunction) => next();
    const runtime = composeAuthenticatedQuoteRuntime({ pool, trustedHostIdentity, trustedHostMiddleware });
    const orderRuntime = composeAuthenticatedOrderRuntime({ pool, trustedHostIdentity, trustedHostMiddleware, service: new OrderApplicationService(new PostgresOrderTransactionRunner(pool)) });
    const billingRuntime = composeAuthenticatedBillingRuntime({ pool, trustedHostIdentity, trustedHostMiddleware });
    const artworkService = new ArtworkApplicationService(new PostgresArtworkTransactionRunner(pool));
    const artworkRuntime = composeAuthenticatedArtworkRuntime({ pool, trustedHostIdentity, trustedHostMiddleware, service: artworkService });
    const proofingRuntime = composeAuthenticatedProofingRuntime({ pool, trustedHostIdentity, trustedHostMiddleware });
    const prepressRuntime = composeAuthenticatedPrepressRuntime({ pool, trustedHostIdentity, trustedHostMiddleware });
    /**
     * Test-only seed that exercises the real Artwork application service. The
     * production UI deliberately has no browser upload/adoption adapter yet;
     * this endpoint proves the real read/assignment path without creating a
     * parallel browser authority or direct SQL fixture write.
     */
    app.post("/_v2-browser-test/seed-artwork", fixtureAdmin, async (request, response, next) => {
      try {
        const orderId = typeof request.body?.orderId === "string" ? request.body.orderId : "";
        const orderLineId = typeof request.body?.orderLineId === "string" ? request.body.orderLineId : "";
        if (!orderId || !orderLineId) return response.status(400).json({ ok: false, error: "orderId and orderLineId are required" });
        const businessRequestId = `m205-browser-adopt-${randomUUID()}`;
        const purpose = request.body?.purpose === "production" ? "production" : "customer_supplied";
        const side = request.body?.side === "back" ? "back" : "front";
        const principal = await artworkRuntime.dependencies.principals.principal(request, fixture!.organizationA);
        const result = await artworkService.adopt({ principal, organizationId: fixture!.organizationA, operationId: "m205-browser-seed", businessRequest: { id: businessRequestId, payloadFingerprint: "fixture-artwork-adoption" } }, {
          businessRequestId,
          objectReference: { storageProvider: "browser-fixture", objectKey: `artwork/${randomUUID()}/customer-art.pdf` },
          originalFilename: "customer-art.pdf", displayFilename: "customer-art.pdf", contentType: "application/pdf", byteSize: 24576,
          source: "customer_upload", pageCount: 2, detectedWidthMicrons: 609600, detectedHeightMicrons: 457200,
          usage: { orderId, orderLineId, purpose, side, ...(purpose === "customer_supplied" ? { sourcePageIndex: 0, layerKey: "white", layerOrder: 0 } : {}) },
        });
        if (!result.ok) return response.status(400).json({ ok: false, error: { code: result.error.code, message: result.error.publicMessage } });
        return response.status(200).json({ ok: true, data: result.value });
      } catch (error) { next(error); }
    });
    app.get("/_v2-browser-test/artwork-readback/:orderId", fixtureAdmin, async (request, response, next) => {
      try {
        const organizationId = fixture!.organizationA, orderId = request.params.orderId;
        const [assignments, audit, operations] = await Promise.all([
          pool.query("SELECT a.id,a.artwork_file_id,a.order_line_id,a.purpose,a.side,a.source_page_index,a.layer_key,a.layer_order,f.original_filename,f.derived_from_artwork_file_id FROM v2_artwork_assignments a JOIN v2_artwork_files f ON f.organization_id=a.organization_id AND f.id=a.artwork_file_id WHERE a.organization_id=$1 AND a.order_document_id=$2 ORDER BY a.created_at,a.id", [organizationId, orderId]),
          pool.query("SELECT event_type,staff_actor_user_id,resource_id FROM v2_audit_events WHERE organization_id=$1 AND resource_type='artwork_file' AND resource_id IN (SELECT artwork_file_id FROM v2_artwork_assignments WHERE organization_id=$1 AND order_document_id=$2) ORDER BY created_at", [organizationId, orderId]),
          pool.query("SELECT operation,business_request_id,status,result_resource_id FROM v2_operation_requests WHERE organization_id=$1 AND result_resource_type='artwork_file' AND result_resource_id IN (SELECT artwork_file_id FROM v2_artwork_assignments WHERE organization_id=$1 AND order_document_id=$2) ORDER BY created_at", [organizationId, orderId]),
        ]);
        response.json({ ok: true, data: { assignments: assignments.rows, audit: audit.rows.map((row) => ({ ...row, staffActorVerified: row.staff_actor_user_id === fixture!.staffA })), operations: operations.rows } });
      } catch (error) { next(error); }
    });
    /** Fixture setup only: it establishes the routed Prepress context that a
     * later Routing-owned transition will create. Prepress writes still go
     * exclusively through the authenticated V2 HTTP/application service. */
    app.post("/_v2-browser-test/enter-prepress", fixtureAdmin, async (request, response, next) => {
      try {
        const orderId = typeof request.body?.orderId === "string" ? request.body.orderId : "";
        const orderLineId = typeof request.body?.orderLineId === "string" ? request.body.orderLineId : "";
        const step = await pool.query<{ id: string }>("SELECT s.id FROM v2_route_instances r JOIN v2_route_instance_steps s ON s.organization_id=r.organization_id AND s.route_instance_id=r.id WHERE r.organization_id=$1 AND r.order_document_id=$2 AND r.order_line_id=$3 AND s.step_kind='prepress'", [fixture!.organizationA, orderId, orderLineId]);
        if (!step.rows[0]) return response.status(404).json({ ok: false, error: "fixture Prepress route step not found" });
        await pool.query("UPDATE v2_route_instances SET route_state='active',current_step_id=$4 WHERE organization_id=$1 AND order_document_id=$2 AND order_line_id=$3", [fixture!.organizationA, orderId, orderLineId, step.rows[0].id]);
        return response.status(204).end();
      } catch (error) { next(error); }
    });
    /** Test-only PostgreSQL readback validates that standard Proofing HTTP writes stayed atomic and attributable. */
    app.get("/_v2-browser-test/proof-readback/:proofWorkId", fixtureAdmin, async (request, response, next) => {
      try {
        const organizationId = fixture!.organizationA, proofWorkId = request.params.proofWorkId;
        const [work, versions, responses, audit, operations] = await Promise.all([
          pool.query("SELECT id,order_document_id,order_line_id FROM v2_proof_works WHERE organization_id=$1 AND id=$2", [organizationId, proofWorkId]),
          pool.query("SELECT id,sequence,issued_at FROM v2_proof_versions WHERE organization_id=$1 AND proof_work_id=$2 ORDER BY sequence", [organizationId, proofWorkId]),
          pool.query("SELECT r.proof_version_id,r.outcome,r.comment,r.response_origin,r.responder_staff_actor_user_id AS staff_actor_user_id FROM v2_proof_responses r JOIN v2_proof_versions v ON v.organization_id=r.organization_id AND v.id=r.proof_version_id WHERE r.organization_id=$1 AND v.proof_work_id=$2 ORDER BY r.responded_at", [organizationId, proofWorkId]),
          pool.query("SELECT event_type,resource_id,staff_actor_user_id FROM v2_audit_events WHERE organization_id=$1 AND resource_type IN ('proof_work','proof_version','proof_response') AND resource_id IN (SELECT id FROM v2_proof_works WHERE organization_id=$1 AND id=$2 UNION SELECT id FROM v2_proof_versions WHERE organization_id=$1 AND proof_work_id=$2 UNION SELECT r.id FROM v2_proof_responses r JOIN v2_proof_versions v ON v.organization_id=r.organization_id AND v.id=r.proof_version_id WHERE r.organization_id=$1 AND v.proof_work_id=$2) ORDER BY created_at", [organizationId, proofWorkId]),
          pool.query("SELECT operation,business_request_id,status,result_resource_id FROM v2_operation_requests WHERE organization_id=$1 AND result_resource_type IN ('proof_work','proof_version','proof_response') AND result_resource_id IN (SELECT id FROM v2_proof_works WHERE organization_id=$1 AND id=$2 UNION SELECT id FROM v2_proof_versions WHERE organization_id=$1 AND proof_work_id=$2 UNION SELECT r.id FROM v2_proof_responses r JOIN v2_proof_versions v ON v.organization_id=r.organization_id AND v.id=r.proof_version_id WHERE r.organization_id=$1 AND v.proof_work_id=$2) ORDER BY created_at", [organizationId, proofWorkId]),
        ]);
        response.json({ ok: true, data: { work: work.rows[0] ?? null, versions: versions.rows, responses: responses.rows.map((row) => ({ ...row, staffActorVerified: row.staff_actor_user_id === fixture!.staffA })), audit: audit.rows.map((row) => ({ ...row, staffActorVerified: row.staff_actor_user_id === fixture!.staffA })), operations: operations.rows } });
      } catch (error) { next(error); }
    });
    app.use(express.static(path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../dist-v2-ui"), { index: "index.html" }));
    app.use(createV2HttpApp(loadV2RuntimeConfig({ NODE_ENV: "test", V2_PORT: process.env.V2_M175B_PORT ?? "4174" }), { log: () => undefined }, undefined, runtime, orderRuntime, billingRuntime, artworkRuntime, proofingRuntime, prepressRuntime));
    const port = Number(process.env.V2_M175B_PORT ?? "4174");
    const server = app.listen(port, "127.0.0.1", () => console.log(`[m175b] ready on ${port}`));
    const close = async () => { server.close(); if (fixture) { await pool.query("DELETE FROM organizations WHERE id=ANY($1::text[])", [[fixture.organizationA, fixture.organizationB]]); await pool.query("DELETE FROM users WHERE id=ANY($1::text[])", [[fixture.staffA, fixture.limitedA, fixture.staffB]]); } client.release(); await pool.end(); };
    process.once("SIGTERM", () => { void close().finally(() => process.exit(0)); });
    process.once("SIGINT", () => { void close().finally(() => process.exit(0)); });
  } catch (error) { client.release(); await pool.end(); throw error; }
};
void main();
