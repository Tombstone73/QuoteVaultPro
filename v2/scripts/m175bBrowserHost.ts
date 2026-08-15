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
import { loadV2RuntimeConfig } from "../src/config/runtimeConfig.js";
import { createV2HttpApp } from "../src/interfaces/http/app.js";

type BrowserFixture = Readonly<{
  organizationA: string; organizationB: string;
  staffA: string; limitedA: string; staffB: string;
  customerA: string; contactA: string; customerB: string; contactB: string;
  dimensionalProductA: string; quantityProductA: string; productB: string;
  salesSetA: string;
}>;
type PublicBrowserFixture = Omit<BrowserFixture, "staffA" | "limitedA" | "staffB" | "salesSetA">;
const migrationsFolder = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../server/db/migrations_v2");
const browserTestEnabled = () => process.env.V2_M175B_BROWSER_TEST === "1";
const assert = (value: unknown, message: string): asserts value => { if (!value) throw new Error(message); };

const tree = (measurementMode: "dimensions_required" | "quantity_only", choice = "legacy") => ({
  schemaVersion: 2,
  rootNodeIds: ["finish"],
  nodes: { finish: { id: "finish", kind: "question", label: "Finish", input: { type: "select", selectionKey: "finish", defaultValue: choice, required: true }, choices: [{ value: choice, label: choice }] } },
  meta: { pricingV2: { base: measurementMode === "dimensions_required" ? { perSqftCents: 100 } : { perPieceCents: 250 } } },
});

/** Creates only clone-local records and returns opaque identifiers for browser assertions. */
const createFixture = async (client: PoolClient): Promise<BrowserFixture> => {
  const id = randomUUID();
  const f = {
    organizationA: `m175b-org-a-${id}`, organizationB: `m175b-org-b-${id}`,
    staffA: `m175b-staff-a-${id}`, limitedA: `m175b-limited-a-${id}`, staffB: `m175b-staff-b-${id}`,
    customerA: `m175b-customer-a-${id}`, contactA: `m175b-contact-a-${id}`,
    customerB: `m175b-customer-b-${id}`, contactB: `m175b-contact-b-${id}`,
    dimensionalProductA: `m175b-dim-a-${id}`, quantityProductA: `m175b-qty-a-${id}`, productB: `m175b-product-b-${id}`,
    salesSetA: `m175b-sales-a-${id}`,
  } as const;
  const limitedSet = `m175b-limited-${id}`, salesSetB = `m175b-sales-b-${id}`;
  const dimTree = `m175b-tree-dim-${id}`, quantityTree = `m175b-tree-qty-${id}`, productBTree = `m175b-tree-b-${id}`;
  await client.query("BEGIN");
  try {
    await client.query("INSERT INTO organizations(id,name,slug) VALUES($1,'M175B A',$2),($3,'M175B B',$4)", [f.organizationA, `m175b-a-${id}`, f.organizationB, `m175b-b-${id}`]);
    await client.query("INSERT INTO users(id,email,role) VALUES($1,$2,'owner'),($3,$4,'member'),($5,$6,'owner')", [f.staffA, `${f.staffA}@test.invalid`, f.limitedA, `${f.limitedA}@test.invalid`, f.staffB, `${f.staffB}@test.invalid`]);
    await client.query("INSERT INTO user_organizations(user_id,organization_id,role,is_active) VALUES($1,$2,'owner',true),($3,$2,'member',true),($4,$5,'owner',true)", [f.staffA, f.organizationA, f.limitedA, f.staffB, f.organizationB]);
    await client.query("INSERT INTO v2_permission_organization_state(organization_id) VALUES($1),($2)", [f.organizationA, f.organizationB]);
    await client.query("INSERT INTO v2_permission_sets(id,organization_id,name,normalized_name,principal_kind) VALUES($1,$2,'Sales','sales','staff'),($3,$2,'Limited','limited','staff'),($4,$5,'Sales','sales','staff')", [f.salesSetA, f.organizationA, limitedSet, salesSetB, f.organizationB]);
    for (const [org, set] of [[f.organizationA, f.salesSetA], [f.organizationB, salesSetB]] as const)
      for (const capability of ["quote.view", "quote.create", "quote.edit", "quote.send", "quote.overridePrice"])
        await client.query("INSERT INTO v2_permission_set_capabilities(organization_id,permission_set_id,capability_id) VALUES($1,$2,$3)", [org, set, capability]);
    for (const capability of ["quote.view", "quote.create", "quote.edit", "quote.send"])
      await client.query("INSERT INTO v2_permission_set_capabilities(organization_id,permission_set_id,capability_id) VALUES($1,$2,$3)", [f.organizationA, limitedSet, capability]);
    await client.query("INSERT INTO v2_staff_permission_set_assignments(organization_id,user_id,permission_set_id) VALUES($1,$2,$3),($1,$4,$5),($6,$7,$8)", [f.organizationA, f.staffA, f.salesSetA, f.limitedA, limitedSet, f.organizationB, f.staffB, salesSetB]);
    await client.query("INSERT INTO customers(id,organization_id,company_name,display_name,is_active,status) VALUES($1,$2,'Browser A','Browser A',true,'active'),($3,$4,'Browser B','Browser B',true,'active')", [f.customerA, f.organizationA, f.customerB, f.organizationB]);
    await client.query("INSERT INTO customer_contacts(id,organization_id,first_name,last_name,status) VALUES($1,$2,'A','Contact','active'),($3,$4,'B','Contact','active')", [f.contactA, f.organizationA, f.contactB, f.organizationB]);
    await client.query("INSERT INTO customer_contact_links(organization_id,customer_id,contact_id,status) VALUES($1,$2,$3,'active'),($4,$5,$6,'active')", [f.organizationA, f.customerA, f.contactA, f.organizationB, f.customerB, f.contactB]);
    await client.query("INSERT INTO products(id,organization_id,name,description,is_active,measurement_mode) VALUES($1,$2,'Browser dimensional','Fixture',true,'dimensions_required'),($3,$2,'Browser quantity-only','Fixture',true,'quantity_only'),($4,$5,'Browser B product','Fixture',true,'dimensions_required')", [f.dimensionalProductA, f.organizationA, f.quantityProductA, f.productB, f.organizationB]);
    await client.query("INSERT INTO pbv2_tree_versions(id,organization_id,product_id,status,schema_version,tree_json,published_at) VALUES($1,$2,$3,'ACTIVE',2,$4::jsonb,now()),($5,$2,$6,'ACTIVE',2,$7::jsonb,now()),($8,$9,$10,'ACTIVE',2,$11::jsonb,now())", [dimTree, f.organizationA, f.dimensionalProductA, JSON.stringify(tree("dimensions_required")), quantityTree, f.quantityProductA, JSON.stringify(tree("quantity_only", "basic")), productBTree, f.organizationB, f.productB, JSON.stringify(tree("dimensions_required", "standard"))]);
    await client.query("UPDATE products SET pbv2_active_tree_version_id=CASE id WHEN $1 THEN $2 WHEN $3 THEN $4 WHEN $5 THEN $6 END WHERE (organization_id=$7 AND id IN($1,$3)) OR (organization_id=$8 AND id=$5)", [f.dimensionalProductA, dimTree, f.quantityProductA, quantityTree, f.productB, productBTree, f.organizationA, f.organizationB]);
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
    const runtime = composeAuthenticatedQuoteRuntime({ pool, trustedHostIdentity: new PassportSessionIdentitySource(), trustedHostMiddleware: (_request, _response, next) => next() });
    app.use(express.static(path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../dist-v2-ui"), { index: "index.html" }));
    app.use(createV2HttpApp(loadV2RuntimeConfig({ NODE_ENV: "test", V2_PORT: process.env.V2_M175B_PORT ?? "4174" }), { log: () => undefined }, undefined, runtime));
    const port = Number(process.env.V2_M175B_PORT ?? "4174");
    const server = app.listen(port, "127.0.0.1", () => console.log(`[m175b] ready on ${port}`));
    const close = async () => { server.close(); if (fixture) { await pool.query("DELETE FROM organizations WHERE id=ANY($1::text[])", [[fixture.organizationA, fixture.organizationB]]); await pool.query("DELETE FROM users WHERE id=ANY($1::text[])", [[fixture.staffA, fixture.limitedA, fixture.staffB]]); } client.release(); await pool.end(); };
    process.once("SIGTERM", () => { void close().finally(() => process.exit(0)); });
    process.once("SIGINT", () => { void close().finally(() => process.exit(0)); });
  } catch (error) { client.release(); await pool.end(); throw error; }
};
void main();
