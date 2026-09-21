import "dotenv/config";
import { readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { Pool } from "pg";
import { assertM78iFixtureBootstrapEnvironment } from "../../server/lib/m78iFixtureBootstrapGuard";
import { DEV_QA_OPERATOR_BROWSER_EMAIL } from "../../server/lib/devQaProvisioningGuard";
import { M78I_FIXTURE, M78I_FIXTURE_PRODUCT_GENERAL, M78I_FIXTURE_PRODUCT_PRICING, assertFixtureReadiness, fixtureProductGeneralMatches, fixtureProductPricingMatches, fixtureProductRoutingMatches, manifestIsSecretFree, m78iFixtureBusinessRequestId, type FixtureManifest, type FixtureReadiness, type M78iFixtureMutation } from "../../v2/src/qa/m78iFixtureBootstrap";
import type { Capability } from "../../v2/src/authorization/capabilities";
import type { OperationContext } from "../../v2/src/application/operation";
import { ProductVersionLifecycleApplicationService } from "../../v2/src/modules/products/productVersionLifecycle";
import { ProductRoutingApplicationService } from "../../v2/src/modules/products/productRouting";
import { ProductPublicationApplicationService } from "../../v2/src/modules/products/productPublication";
import { OrderApplicationService } from "../../v2/src/modules/sales/orderApplication";
import { ArtworkApplicationService } from "../../v2/src/modules/artwork/artworkApplication";
import { PostgresProductVersionTransactionRunner, PostgresProductDraftGeneralReader, PostgresProductDraftPricingReader } from "../../v2/infrastructure/products/postgresProductVersionLifecycle";
import { PostgresProductDraftRoutingReader, PostgresProductRoutingTransactionRunner } from "../../v2/infrastructure/products/postgresProductRouting";
import { PostgresProductPublicationTransactionRunner } from "../../v2/infrastructure/products/postgresProductPublication";
import { canonicalProductPublishOperations } from "../../server/services/products/canonicalProductPublishOperations";
import { PostgresOrderTransactionRunner } from "../../v2/infrastructure/sales/postgresOrderTransaction";
import { PostgresOrderAutomaticLifecycle } from "../../v2/infrastructure/sales/postgresOrderAutomaticLifecycle";
import { PostgresArtworkTransactionRunner } from "../../v2/infrastructure/artwork/postgresArtworkTransaction";
import { ArtworkUploadService } from "../../v2/infrastructure/artwork/artworkUploadService";
import { SupabaseArtworkBinaryStorage } from "../../v2/infrastructure/artwork/artworkBinaryStorage";
import { PostgresArtworkStorageUploadLedger } from "../../v2/infrastructure/artwork/artworkStorageUploadLedger";
import { CanonicalCustomerCreationService } from "../../v2/infrastructure/customers/canonicalCustomerCreation";
import { PostgresCustomerWorkspaceReader } from "../../v2/infrastructure/compatibility/postgresCustomerWorkspaceRead";

type OperatorResult = Readonly<{ success: boolean; profile?: string; browser?: Readonly<{ profile?: string; capabilities?: readonly Capability[] }>; capabilities?: readonly Capability[]; message?: string }>;
type ProductRow = Readonly<{ id: string; active_version_id: string | null; is_active: boolean; requires_production_job: boolean; route_id: string | null; valid_route: boolean }>;
type CustomerRow = Readonly<{ id: string }>;
type OrderRow = Readonly<{ id: string; display_number: string; customer_id: string; product_id: string; line_id: string; commercial_state: string; archived_at: Date | null }>;
type InvoiceRow = Readonly<{ id: string; invoice_display_number: string | null }>;
type ArtworkRow = Readonly<{ file_id: string; assignment_id: string }>;

const command = process.argv[2];
const request = (mutation: M78iFixtureMutation) => m78iFixtureBusinessRequestId(mutation);
const fail = (message: string): never => { throw new Error(message); };
const ok = <T>(result: { ok: boolean; value?: T; error?: { code: string; publicMessage: string } }): T => {
  if (!result.ok) fail(`${result.error?.code ?? "FAILED"}: ${result.error?.publicMessage ?? "canonical operation failed"}`);
  return result.value as T;
};
const fixtureStage = async <T>(name: string, action: () => Promise<T>): Promise<T> => {
  try { return await action(); }
  catch (error) { fail(`M7.8I fixture stage ${name} failed: ${error instanceof Error ? error.message : "canonical operation failed"}`); }
};

const runOperator = async (args: readonly string[]): Promise<OperatorResult> => new Promise((resolve, reject) => {
  const npm = process.platform === "win32" ? "npm.cmd" : "npm";
  const child = spawn(npm, ["run", "qa:dev-operator", "--", ...args], { env: process.env, stdio: ["ignore", "pipe", "pipe"] });
  let stdout = "", stderr = "";
  child.stdout.on("data", (chunk) => { stdout += String(chunk); });
  child.stderr.on("data", (chunk) => { stderr += String(chunk); });
  child.on("error", reject);
  child.on("close", (code) => {
    const line = stdout.split(/\r?\n/u).map((value) => value.trim()).reverse().find((value) => value.startsWith("{"));
    let parsed: OperatorResult | undefined;
    try { parsed = line ? JSON.parse(line) as OperatorResult : undefined; } catch { /* report below */ }
    if (code !== 0 || !parsed?.success) return reject(new Error(parsed?.message ?? (stderr.trim() || "Guarded DEV-QA operator failed.")));
    resolve(parsed);
  });
});

const context = (userId: string, capabilities: readonly Capability[], operationId: string): OperationContext => ({
  organizationId: M78I_FIXTURE.organizationId,
  operationId,
  businessRequest: { id: operationId, payloadFingerprint: operationId },
  principal: { kind: "staff", organizationId: M78I_FIXTURE.organizationId, userId, authority: { membershipId: "m78i-fixture-bootstrap", capabilities } },
});

const capabilities = (operator: OperatorResult): readonly Capability[] => {
  const value = operator.capabilities ?? operator.browser?.capabilities;
  if (!value?.length) fail("Guarded DEV-QA operator did not return the browser capability set.");
  return value;
};

const withTemporaryProfile = async <T>(profile: "m78i_fixture_pricing" | "m78i_fixture_artwork", action: (capabilities: readonly Capability[]) => Promise<T>): Promise<T> => {
  const applied = await runOperator(["profile-apply", "--email", DEV_QA_OPERATOR_BROWSER_EMAIL, "--profile", profile]);
  try { return await action(capabilities(applied)); }
  finally {
    const restored = await runOperator(["profile-restore", "--email", DEV_QA_OPERATOR_BROWSER_EMAIL]);
    if (restored.profile !== "m78i") fail("Guarded DEV-QA operator did not restore normal m78i.");
    await runOperator(["verify"]);
  }
};

const fixtureRows = async (pool: Pool) => {
  const org = M78I_FIXTURE.organizationId;
  const [products, customers, orders] = await Promise.all([
    pool.query<ProductRow>(`SELECT p.id,p.pbv2_active_tree_version_id active_version_id,p.is_active,p.requires_production_job,
      rs.route_template_id route_id,COALESCE(jsonb_array_length(rs.steps_json),0)=4 AND rs.steps_json @> '[{"position":0,"kind":"proofing"},{"position":1,"kind":"prepress"},{"position":2,"kind":"production"},{"position":3,"kind":"fulfillment"}]'::jsonb valid_route
      FROM products p LEFT JOIN v2_product_version_routing_specs rs ON rs.organization_id=p.organization_id AND rs.product_id=p.id AND rs.product_version_id=p.pbv2_active_tree_version_id
      WHERE p.organization_id=$1 AND p.name=$2`, [org, M78I_FIXTURE.product]),
    pool.query<CustomerRow>("SELECT id FROM customers WHERE organization_id=$1 AND company_name=$2 AND is_active=true", [org, M78I_FIXTURE.customer]),
    pool.query<OrderRow>(`SELECT d.id,d.display_number,d.customer_id,l.product_id,l.id line_id,o.commercial_state,o.archived_at
      FROM v2_sales_documents d JOIN v2_sales_order_details o ON o.organization_id=d.organization_id AND o.document_id=d.id
      JOIN v2_sales_document_lines l ON l.organization_id=d.organization_id AND l.document_id=d.id
      WHERE d.organization_id=$1 AND d.document_kind='order' AND d.purchase_order_number=$2 ORDER BY d.created_at,d.id,l.position,l.id`, [org, M78I_FIXTURE.order]),
  ]);
  return { products: products.rows, customers: customers.rows, orders: orders.rows };
};

const currentState = async (pool: Pool) => {
  const rows = await fixtureRows(pool);
  const product = rows.products.length === 0 ? undefined : rows.products.length === 1 ? rows.products[0] : undefined;
  const customer = rows.customers.length === 0 ? undefined : rows.customers.length === 1 ? rows.customers[0] : undefined;
  const open = rows.orders.filter((row) => row.commercial_state === "open" && !row.archived_at);
  const order = open.length === 1 ? open[0] : undefined;
  const readiness: FixtureReadiness = {
    product: rows.products.length > 1 ? "ambiguous" : !product ? "missing" : product.is_active && product.requires_production_job && product.valid_route ? "valid" : "invalid",
    customer: rows.customers.length > 1 ? "ambiguous" : customer ? "valid" : "missing",
    order: open.length > 1 ? "ambiguous" : order ? "valid" : rows.orders.length ? "historical" : "missing",
    artwork: "missing",
  };
  let invoice: InvoiceRow | undefined, artwork: ArtworkRow | undefined;
  if (order) {
    const [invoices, artworkRows] = await Promise.all([
      pool.query<InvoiceRow>("SELECT id,invoice_display_number FROM v2_billing_invoices WHERE organization_id=$1 AND sales_order_document_id=$2 AND invoice_state='draft' AND replacement_obligation_id IS NULL", [M78I_FIXTURE.organizationId, order.id]),
      pool.query<ArtworkRow>(`SELECT f.id file_id,a.id assignment_id FROM v2_artwork_assignments a JOIN v2_artwork_files f ON f.organization_id=a.organization_id AND f.id=a.artwork_file_id
        WHERE a.organization_id=$1 AND a.order_document_id=$2 AND a.order_line_id=$3 AND f.display_filename=$4
          AND NOT EXISTS (SELECT 1 FROM v2_artwork_assignments successor WHERE successor.organization_id=a.organization_id AND successor.supersedes_artwork_assignment_id=a.id)`, [M78I_FIXTURE.organizationId, order.id, order.line_id, M78I_FIXTURE.artwork]),
    ]);
    if (invoices.rows.length > 1 || artworkRows.rows.length > 1) fail("Ambiguous fixture Invoice or Artwork assignment; refusing to choose a record.");
    invoice = invoices.rows[0]; artwork = artworkRows.rows[0];
    readiness.artwork = artwork ? "valid" : "missing";
  }
  return { ...rows, product, customer, order, invoice, artwork, readiness };
};

const browserUserId = async (pool: Pool): Promise<string> => {
  const result = await pool.query<{ id: string }>("SELECT id FROM users WHERE email=$1 AND account_type='INTERNAL_USER'", [DEV_QA_OPERATOR_BROWSER_EMAIL]);
  if (result.rows.length !== 1) fail("Dedicated QA browser identity was not uniquely available for canonical attribution.");
  return result.rows[0]!.id;
};

const standardRoute = async (pool: Pool): Promise<string> => {
  const result = await pool.query<{ id: string }>(`SELECT t.id FROM v2_route_templates t
    WHERE t.organization_id=$1 AND t.name='Standard Production' AND t.active=true
      AND (SELECT jsonb_agg(jsonb_build_object('position',s.position,'kind',s.step_kind) ORDER BY s.position) FROM v2_route_template_steps s WHERE s.organization_id=t.organization_id AND s.route_template_id=t.id)
        = '[{"position":0,"kind":"proofing"},{"position":1,"kind":"prepress"},{"position":2,"kind":"production"},{"position":3,"kind":"fulfillment"}]'::jsonb`, [M78I_FIXTURE.organizationId]);
  if (result.rows.length !== 1) fail("Exactly one active Standard Production route is required for the DEV-QA fixture.");
  return result.rows[0]!.id;
};

const productUpdatedAt = async (pool: Pool, productId: string): Promise<string> => {
  const result = await pool.query<{ updated_at: Date }>("SELECT updated_at FROM products WHERE organization_id=$1 AND id=$2", [M78I_FIXTURE.organizationId, productId]);
  if (result.rows.length !== 1) fail("Fixture Product was not available for publication.");
  return result.rows[0]!.updated_at.toISOString();
};

const ensureProduct = async (pool: Pool, userId: string): Promise<ProductRow> => {
  let state = await currentState(pool); assertFixtureReadiness(state.readiness);
  if (state.readiness.product === "valid") return state.product!;
  if (state.product?.is_active) fail("The marked active fixture Product is invalid. Refusing to revise an existing fixture without an explicit safe-revision decision.");
  // Validate the route before creating a Product so a missing environment
  // prerequisite cannot leave another partial fixture behind.
  const routeTemplateId = await fixtureStage("product.route.precondition", () => standardRoute(pool));
  return withTemporaryProfile("m78i_fixture_pricing", async (caps) => {
    const lifecycle = new ProductVersionLifecycleApplicationService(new PostgresProductVersionTransactionRunner(pool));
    const generalReader = new PostgresProductDraftGeneralReader(pool);
    const pricingReader = new PostgresProductDraftPricingReader(pool);
    const routingReader = new PostgresProductDraftRoutingReader(pool);
    const productId = state.product?.id ?? ok(await fixtureStage("product.create", () => lifecycle.createProductWithInitialDraft(
      context(userId, caps, request("product.create")), { displayName: M78I_FIXTURE.product, businessRequestId: request("product.create") },
    ))).productId;
    let general = await generalReader.read(M78I_FIXTURE.organizationId, productId);
    if (!general) fail("Fixture Product Draft General state is unavailable.");
    if (!fixtureProductGeneralMatches(general.general)) {
      general = ok(await fixtureStage("product.general.update", () => lifecycle.updateDraftGeneral(context(userId, caps, request("product.general.update")), {
        productId, draftVersionId: general!.draftVersionId, expectedDraftUpdatedAt: general!.draftUpdatedAt, businessRequestId: request("product.general.update"), general: M78I_FIXTURE_PRODUCT_GENERAL,
      })));
    }
    let pricing = await pricingReader.read(M78I_FIXTURE.organizationId, productId);
    if (!pricing) fail("Fixture Product Draft Pricing is unavailable.");
    if (!fixtureProductPricingMatches(pricing)) {
      pricing = ok(await fixtureStage("product.pricing.update", () => lifecycle.updateDraftPricing(context(userId, caps, request("product.pricing.update")), {
        productId, draftVersionId: pricing!.draftVersionId, expectedDraftUpdatedAt: pricing!.draftUpdatedAt, businessRequestId: request("product.pricing.update"), ...M78I_FIXTURE_PRODUCT_PRICING,
      })));
    }
    const routing = new ProductRoutingApplicationService(new PostgresProductRoutingTransactionRunner(pool));
    let routingState = await routingReader.read(M78I_FIXTURE.organizationId, productId);
    if (!routingState) fail("Fixture Product Draft Routing state is unavailable.");
    if (!fixtureProductRoutingMatches(routingState.routing, routeTemplateId)) {
      routingState = ok(await fixtureStage("product.routing.update", () => routing.updateDraftRouting(context(userId, caps, request("product.routing.update")), {
        productId, draftVersionId: routingState!.draftVersionId, expectedDraftUpdatedAt: routingState!.draftUpdatedAt, businessRequestId: request("product.routing.update"),
        routing: { kind: "route_required", routeTemplateId, routeTemplateName: "", steps: [] },
      })));
    }
    const publication = new ProductPublicationApplicationService(new PostgresProductPublicationTransactionRunner(pool), canonicalProductPublishOperations);
    await fixtureStage("product.publish", async () => ok(await publication.publish(context(userId, caps, request("product.publish")), {
      productId, draftVersionId: routingState!.draftVersionId, expectedProductUpdatedAt: await productUpdatedAt(pool, productId), expectedDraftUpdatedAt: routingState!.draftUpdatedAt, businessRequestId: request("product.publish"), activateProduct: true, confirmWarnings: true,
    })));
    state = await currentState(pool); assertFixtureReadiness(state.readiness);
    if (state.readiness.product !== "valid") fail("Fixture Product did not converge to production-required active Standard Production routing.");
    return state.product!;
  });
};

const ensureCustomer = async (pool: Pool, userId: string, caps: readonly Capability[]): Promise<CustomerRow> => {
  const state = await currentState(pool); assertFixtureReadiness(state.readiness);
  if (state.customer) return state.customer;
  const service = new CanonicalCustomerCreationService(new PostgresCustomerWorkspaceReader(pool));
  await fixtureStage("customer.create", () => service.create(context(userId, caps, request("customer.create")), { companyName: M78I_FIXTURE.customer, displayName: M78I_FIXTURE.customer, email: "m78i-fixture-customer@printershero.invalid" }));
  const after = await currentState(pool); assertFixtureReadiness(after.readiness);
  if (!after.customer) fail("Canonical Customer create did not converge the fixture.");
  return after.customer;
};

const ensureOrder = async (pool: Pool, userId: string, caps: readonly Capability[], product: ProductRow, customer: CustomerRow): Promise<OrderRow> => {
  const state = await currentState(pool); assertFixtureReadiness(state.readiness);
  if (state.order) {
    if (state.order.product_id !== product.id || state.order.customer_id !== customer.id) fail("Current fixture Order does not reference the canonical fixture Product and Customer.");
    return state.order;
  }
  const service = new OrderApplicationService(new PostgresOrderTransactionRunner(pool), undefined, new PostgresOrderAutomaticLifecycle(pool));
  ok(await fixtureStage("order.create", () => service.create(context(userId, caps, request("order.create")), {
    businessRequestId: request("order.create"), customerContact: { organizationId: M78I_FIXTURE.organizationId, customerId: customer.id }, purchaseOrderNumber: M78I_FIXTURE.order,
    terms: { commercialNotes: "Synthetic M7.8I DEV fixture only." },
    lines: [{ productId: product.id, quantity: 2, dimensions: { width: "12", height: "12", unit: "in" }, selections: {}, selling: { kind: "unit_override", unitCents: 875, reason: "Deterministic M7.8I fixture selling price." } }],
  })));
  const after = await currentState(pool); assertFixtureReadiness(after.readiness);
  if (!after.order || !after.invoice) fail("Canonical Order create did not produce an open Order and base draft Invoice.");
  return after.order;
};

const ensureArtwork = async (pool: Pool, userId: string, order: OrderRow): Promise<ArtworkRow> => {
  const state = await currentState(pool); assertFixtureReadiness(state.readiness);
  if (state.artwork) return state.artwork;
  return withTemporaryProfile("m78i_fixture_artwork", async (caps) => {
    const service = new ArtworkApplicationService(new PostgresArtworkTransactionRunner(pool));
    const upload = new ArtworkUploadService(service, new SupabaseArtworkBinaryStorage(), new PostgresArtworkStorageUploadLedger(pool));
    const bytes = await readFile("v2/tests/fixtures/p7-qa-artwork.pdf");
    ok(await fixtureStage("artwork.adopt", () => upload.upload(context(userId, caps, request("artwork.adopt")), { businessRequestId: request("artwork.adopt"), orderId: order.id, orderLineId: order.line_id, purpose: "customer_supplied", side: "front", filename: M78I_FIXTURE.artwork, contentType: "application/pdf", bytes })));
    const after = await currentState(pool); assertFixtureReadiness(after.readiness);
    if (!after.artwork) fail("Canonical Artwork upload did not create the fixture assignment.");
    return after.artwork;
  });
};

const manifest = (state: Awaited<ReturnType<typeof currentState>>): FixtureManifest => ({
  organizationId: M78I_FIXTURE.organizationId,
  ...(state.product?.active_version_id ? { product: { id: state.product.id, activeVersionId: state.product.active_version_id, productionUnit: "front", requiresProductionJob: state.product.requires_production_job } } : {}),
  ...(state.customer ? { customer: { id: state.customer.id } } : {}),
  ...(state.order ? { order: { id: state.order.id, orderNumber: state.order.display_number, lineId: state.order.line_id } } : {}),
  ...(state.invoice ? { invoice: { id: state.invoice.id, invoiceNumber: state.invoice.invoice_display_number } } : {}),
  ...(state.artwork ? { artwork: { id: state.artwork.file_id, assignmentId: state.artwork.assignment_id } } : {}),
  ...(state.product?.route_id ? { production: { routeId: state.product.route_id } } : {}),
});

async function main(): Promise<void> {
  if (command !== "status" && command !== "bootstrap") fail("Usage: qa:m78i-fixture <status|bootstrap>");
  assertM78iFixtureBootstrapEnvironment();
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 4, application_name: "m78i-fixture-bootstrap" });
  try {
    const verified = await runOperator(["verify"]);
    const activeProfile = verified.browser?.profile ?? verified.profile;
    let state = await currentState(pool); assertFixtureReadiness(state.readiness);
    if (command === "bootstrap") {
      if (activeProfile !== "m78i") fail("Fixture bootstrap requires the QA browser to start at normal m78i.");
      const normal = await runOperator(["verify"]), userId = await browserUserId(pool), normalCaps = capabilities(normal);
      const product = await ensureProduct(pool, userId);
      const customer = await ensureCustomer(pool, userId, normalCaps);
      const order = await ensureOrder(pool, userId, normalCaps, product, customer);
      await ensureArtwork(pool, userId, order);
      await runOperator(["verify"]);
      state = await currentState(pool); assertFixtureReadiness(state.readiness);
      if (state.readiness.product !== "valid" || state.readiness.customer !== "valid" || state.readiness.order !== "valid" || state.readiness.artwork !== "valid" || !state.invoice)
        fail("Fixture bootstrap did not converge to a production-capable Product, open Order, draft Invoice, and Artwork assignment.");
    }
    const value = manifest(state);
    if (!manifestIsSecretFree(value)) fail("Fixture manifest secret-content guard failed.");
    console.log(JSON.stringify({ success: true, command, readiness: state.readiness, qaBrowserProfile: activeProfile, temporaryCapabilitiesActive: activeProfile !== "m78i", proofingEligible: state.readiness.product === "valid" && state.readiness.order === "valid" && state.readiness.artwork === "valid", manifest: value }));
  } finally { await pool.end(); }
}

void main().catch((error: unknown) => { console.error(JSON.stringify({ success: false, message: error instanceof Error ? error.message : "M7.8I fixture bootstrap failed." })); process.exitCode = 1; });
