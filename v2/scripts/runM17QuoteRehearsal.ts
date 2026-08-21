import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool, type PoolClient } from "pg";
import request from "supertest";
import { PassportSessionIdentitySource } from "../infrastructure/authentication/trustedHostPrincipalProvider.js";
import { PostgresPermissionAuthorityReader } from "../infrastructure/authorization/postgresPermissionAuthorityRead.js";
import { requireV2M0CloneDatabaseUrl } from "../infrastructure/persistence/cloneSafety.js";
import {
  assertV2M0PhysicalPostconditions,
  checkV2M0PhysicalPostconditions,
} from "../infrastructure/persistence/physicalPostconditions.js";
import {
  assertV2CommercialPhysicalPostconditions,
  checkV2CommercialPhysicalPostconditions,
} from "../infrastructure/sales/commercialPhysicalPostconditions.js";
import { PostgresQuoteTransactionRunner } from "../infrastructure/sales/postgresQuoteTransaction.js";
import { composeAuthenticatedQuoteRuntime } from "../infrastructure/sales/authenticatedQuoteRuntime.js";
import { loadV2RuntimeConfig } from "../src/config/runtimeConfig.js";
import { createV2HttpApp } from "../src/interfaces/http/app.js";
import { PermissionSetPrincipalIssuer } from "../src/authorization/permissionSets.js";
import {
  QuoteApplicationService,
  type CreateQuoteInput,
} from "../src/modules/sales/quoteApplication.js";
import { brandedId } from "../src/modules/shared/commercialValues.js";

const migrationsFolder = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../server/db/migrations_v2",
);
const assert = (value: unknown, message: string): asserts value => {
  if (!value) throw new Error(message);
};
const ctx = (
  principal: Awaited<ReturnType<PermissionSetPrincipalIssuer["issue"]>>,
  org: string,
  request: string,
) => ({
  principal,
  organizationId: org,
  operationId: `m17:${request}`,
  businessRequest: {
    id: request,
    payloadFingerprint: "operation-computes-canonical-fingerprint",
  },
});
async function fixture(client: PoolClient) {
  const x = randomUUID();
  const org = `m17-org-${x}`,
    other = `m17-other-${x}`,
    user = `m17-user-${x}`,
    limited = `m17-limited-${x}`,
    set = `m17-set-${x}`,
    limitedSet = `m17-limited-set-${x}`,
    customer = `m17-customer-${x}`,
    contact = `m17-contact-${x}`,
    badContact = `m17-bad-contact-${x}`,
    product = `m17-product-${x}`,
    foreignProduct = `m17-product-b-${x}`,
    tree = `m17-tree-${x}`;
  await client.query("BEGIN");
  try {
    await client.query(
      "INSERT INTO organizations(id,name,slug) VALUES($1,'M17',$2),($3,'M17 Other',$4)",
      [org, `m17-${x}`, other, `m17-other-${x}`],
    );
    await client.query(
      "INSERT INTO users(id,email,role) VALUES($1,$2,'owner'),($3,$4,'member')",
      [user, `${user}@test`, limited, `${limited}@test`],
    );
    await client.query(
      "INSERT INTO user_organizations(user_id,organization_id,role,is_active) VALUES($1,$3,'owner',true),($2,$3,'member',true)",
      [user, limited, org],
    );
    await client.query(
      "INSERT INTO v2_permission_organization_state(organization_id) VALUES($1)",
      [org],
    );
    await client.query(
      "INSERT INTO v2_permission_sets(id,organization_id,name,normalized_name,principal_kind) VALUES($1,$3,'Sales','sales','staff'),($2,$3,'Limited','limited','staff')",
      [set, limitedSet, org],
    );
    for (const cap of [
      "quote.view",
      "quote.create",
      "quote.edit",
      "quote.send",
      "quote.overridePrice",
    ])
      await client.query(
        "INSERT INTO v2_permission_set_capabilities(organization_id,permission_set_id,capability_id) VALUES($1,$2,$3)",
        [org, set, cap],
      );
    await client.query(
      "INSERT INTO v2_permission_set_capabilities(organization_id,permission_set_id,capability_id) VALUES($1,$2,'quote.create')",
      [org, limitedSet],
    );
    await client.query(
      "INSERT INTO v2_staff_permission_set_assignments(organization_id,user_id,permission_set_id) VALUES($1,$2,$3),($1,$4,$5)",
      [org, user, set, limited, limitedSet],
    );
    await client.query(
      "INSERT INTO customers(id,organization_id,company_name,display_name,is_active,status) VALUES($1,$2,'Customer','Customer',true,'active')",
      [customer, org],
    );
    await client.query(
      "INSERT INTO customer_contacts(id,organization_id,first_name,last_name,status) VALUES($1,$2,'Good','Contact','active'),($3,$2,'Bad','Contact','active')",
      [contact, org, badContact],
    );
    await client.query(
      "INSERT INTO customer_contact_links(organization_id,customer_id,contact_id,status) VALUES($1,$2,$3,'active')",
      [org, customer, contact],
    );
    const json = {
      schemaVersion: 2,
      rootNodeIds: ["finish"],
      nodes: {
        finish: {
          id: "finish",
          kind: "question",
          label: "Finish",
          input: {
            type: "select",
            selectionKey: "finish",
            defaultValue: "standard",
          },
          choices: [{ value: "standard", label: "Standard" }],
        },
      },
      meta: {
        fixedDimensions: { widthIn: 24, heightIn: 18, unit: "in" },
        pricingV2: { base: { perSqftCents: 100 } },
      },
    };
    await client.query(
      "INSERT INTO products(id,organization_id,name,description,is_active,measurement_mode) VALUES($1,$2,'Product','Product',true,'dimensions_required'),($3,$4,'Foreign','Foreign',true,'dimensions_required')",
      [product, org, foreignProduct, other],
    );
    await client.query(
      "INSERT INTO pbv2_tree_versions(id,organization_id,product_id,status,schema_version,tree_json,published_at) VALUES($1,$2,$3,'ACTIVE',2,$4::jsonb,now())",
      [tree, org, product, JSON.stringify(json)],
    );
    await client.query(
      "UPDATE products SET pbv2_active_tree_version_id=$1 WHERE id=$2 AND organization_id=$3",
      [tree, product, org],
    );
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  }
  return {
    org,
    other,
    user,
    limited,
    customer,
    contact,
    badContact,
    product,
    foreignProduct,
    set,
  };
}
async function main() {
  const url = requireV2M0CloneDatabaseUrl();
  const pool = new Pool({ connectionString: url, max: 4 });
  let client: PoolClient | undefined;
  try {
    await migrate(drizzle({ client: pool }), {
      migrationsFolder,
      migrationsTable: "__drizzle_migrations_v2",
      migrationsSchema: "public",
    });
    client = await pool.connect();
    assertV2M0PhysicalPostconditions(
      await checkV2M0PhysicalPostconditions(client),
    );
    assertV2CommercialPhysicalPostconditions(
      await checkV2CommercialPhysicalPostconditions(client),
    );
    const f = await fixture(client);
    const issuer = new PermissionSetPrincipalIssuer(
      new PostgresPermissionAuthorityReader(client),
    );
    const staff = await issuer.issue(
      {
        subjectId: f.user,
        authenticatedAt: new Date(),
        authenticationMethod: "session",
      },
      { organizationId: f.org },
    );
    const noOverride = await issuer.issue(
      {
        subjectId: f.limited,
        authenticatedAt: new Date(),
        authenticationMethod: "session",
      },
      { organizationId: f.org },
    );
    const service = new QuoteApplicationService(
      new PostgresQuoteTransactionRunner(pool),
    );
    const input: CreateQuoteInput = {
      businessRequestId: "m17-create",
      customerContact: {
        organizationId: brandedId<"OrganizationId">(f.org),
        customerId: brandedId<"CustomerId">(f.customer),
        contactId: brandedId<"ContactId">(f.contact),
      },
      purchaseOrderNumber: "PO-1",
      lines: [
        {
          productId: f.product,
          quantity: 2,
          selling: {
            kind: "total_override",
            totalCents: 500,
            reason: "approved",
          },
        },
      ],
    };
    const created = await service.create(
      ctx(staff, f.org, input.businessRequestId),
      input,
    );
    assert(
      created.ok,
      `Create failed: ${created.ok ? "" : `${created.error.code}: ${created.error.message}`}`,
    );
    if (!created.ok) return;
    const rolledBack = await new QuoteApplicationService(
      new PostgresQuoteTransactionRunner(pool, {
        afterDocument: async () => {
          throw new Error("forced quote rollback");
        },
      }),
    ).create(ctx(staff, f.org, "m17-rollback"), {
      ...input,
      businessRequestId: "m17-rollback",
    });
    assert(
      !rolledBack.ok && rolledBack.error.code === "INTERNAL_ERROR",
      "Forced Quote rollback did not fail safely.",
    );
    const rollbackRows = await client.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM v2_operation_requests WHERE organization_id=$1 AND business_request_id='m17-rollback'",
      [f.org],
    );
    assert(
      rollbackRows.rows[0]?.count === "0",
      "A failed Quote operation left an operation request behind.",
    );
    const quoteId = created.value.quote.quote.quoteId;
    assert(
      created.value.quote.quote.lines[0]?.pricingResult.calculatedLineAmount
        .cents === 600,
      "Pricing was not calculated through V2 Pricing.",
    );
    assert(
      created.value.quote.quote.lines[0]?.sellingLineAmount.cents === 500,
      "Selling decision was not persisted separately.",
    );
    const replay = await service.create(
      ctx(staff, f.org, input.businessRequestId),
      input,
    );
    assert(
      replay.ok && replay.value.quote.quote.quoteId === quoteId,
      "Same request did not replay same Quote.",
    );
    const bad = await service.create(ctx(staff, f.org, "m17-bad"), {
      ...input,
      businessRequestId: "m17-bad",
      customerContact: {
        ...input.customerContact,
        contactId: brandedId<"ContactId">(f.badContact),
      },
    });
    assert(
      !bad.ok && bad.error.code === "NOT_FOUND",
      "Invalid customer/contact reference was accepted.",
    );
    const foreignReference = await service.create(
      ctx(staff, f.org, "m17-foreign-reference"),
      {
        ...input,
        businessRequestId: "m17-foreign-reference",
        customerContact: {
          ...input.customerContact,
          organizationId: brandedId<"OrganizationId">(f.other),
        },
      },
    );
    assert(
      !foreignReference.ok && foreignReference.error.code === "WRONG_TENANT",
      "Cross-tenant customer reference was accepted.",
    );
    const foreignProduct = await service.create(
      ctx(staff, f.org, "m17-foreign-product"),
      {
        ...input,
        businessRequestId: "m17-foreign-product",
        lines: [{ productId: f.foreignProduct, quantity: 1 }],
      },
    );
    assert(
      !foreignProduct.ok && foreignProduct.error.code === "NOT_FOUND",
      "Foreign Product was accepted for Quote pricing.",
    );
    const denied = await service.create(ctx(noOverride, f.org, "m17-denied"), {
      ...input,
      businessRequestId: "m17-denied",
    });
    assert(
      !denied.ok && denied.error.code === "FORBIDDEN",
      "Override bypassed final permission sets.",
    );
    const updated = await service.update(ctx(staff, f.org, "m17-update"), {
      businessRequestId: "m17-update",
      quoteId,
      expectedRevision: "1",
      patch: { purchaseOrderNumber: "PO-2" },
    });
    assert(
      updated.ok && updated.value.quote.revision === "2",
      `Update/revision failed: ${updated.ok ? updated.value.quote.revision : `${updated.error.code}: ${updated.error.message}`}`,
    );
    const stale = await service.update(ctx(staff, f.org, "m17-stale"), {
      businessRequestId: "m17-stale",
      quoteId,
      expectedRevision: "1",
      patch: { purchaseOrderNumber: "PO-stale" },
    });
    assert(
      !stale.ok && stale.error.code === "STALE_STATE",
      "Stale update overwrote Quote.",
    );
    const sent = await service.send(ctx(staff, f.org, "m17-send"), {
      businessRequestId: "m17-send",
      quoteId,
      expectedRevision: "2",
    });
    assert(sent.ok && sent.value.checkpointId, "Send checkpoint failed.");
    const checkpoint = sent.ok ? sent.value.checkpointId! : "";
    const afterSend = await service.update(
      ctx(staff, f.org, "m17-after-send"),
      {
        businessRequestId: "m17-after-send",
        quoteId,
        expectedRevision: "3",
        patch: { purchaseOrderNumber: "PO-3" },
      },
    );
    assert(afterSend.ok, "Post-send edit failed.");
    const checkpointPayload = await client.query<{ payload: unknown }>(
      "SELECT payload FROM v2_sales_quote_checkpoints WHERE organization_id=$1 AND id=$2",
      [f.org, checkpoint],
    );
    assert(
      JSON.stringify(checkpointPayload.rows[0]?.payload).includes("PO-2"),
      "Current edit rewrote sent checkpoint.",
    );
    const [first, second] = await Promise.all([
      service.create(ctx(staff, f.org, "m17-concurrent"), {
        ...input,
        businessRequestId: "m17-concurrent",
      }),
      service.create(ctx(staff, f.org, "m17-concurrent"), {
        ...input,
        businessRequestId: "m17-concurrent",
      }),
    ]);
    assert(
      first.ok &&
        second.ok &&
        first.value.quote.quote.quoteId === second.value.quote.quote.quoteId,
      "Concurrent same request duplicated Quote.",
    );
    const [a, b] = await Promise.all([
      service.create(ctx(staff, f.org, "m17-number-a"), {
        ...input,
        businessRequestId: "m17-number-a",
      }),
      service.create(ctx(staff, f.org, "m17-number-b"), {
        ...input,
        businessRequestId: "m17-number-b",
      }),
    ]);
    assert(
      a.ok && b.ok && a.value.quote.number.core !== b.value.quote.number.core,
      "Concurrent Quote numbers collided.",
    );
    const audit = await client.query(
      "SELECT 1 FROM v2_audit_events WHERE organization_id=$1 AND resource_id=$2",
      [f.org, quoteId],
    );
    assert(audit.rowCount >= 2, "Semantic Audit was missing.");
    const trustedSession: { v2CsrfToken?: string } = {};
    const trustedHostMiddleware = (req: any, _res: any, next: () => void) => {
      // Test host state is server-side and fixed. Request headers cannot select
      // a subject, organization, capability, or staff actor.
      req.isAuthenticated = () => true;
      req.user = { id: f.user };
      req.sessionID = "m17-trusted-session";
      req.session = trustedSession;
      next();
    };
    const runtime = composeAuthenticatedQuoteRuntime({
      pool,
      trustedHostIdentity: new PassportSessionIdentitySource(),
      trustedHostMiddleware,
    });
    const app = createV2HttpApp(
      loadV2RuntimeConfig({ NODE_ENV: "test", V2_SERVICE_NAME: "m17-runtime" }),
      { log: () => undefined },
      undefined,
      runtime,
    );
    const routeInput = {
      businessRequestId: "m17-http-create",
      customerContact: {
        organizationId: f.org,
        customerId: f.customer,
        contactId: f.contact,
      },
      lines: [{ productId: f.product, quantity: 1 }],
      // This forged body identity must never be consulted.
      principal: { kind: "staff", userId: f.limited, organizationId: f.other },
    };
    const bootstrap = await request(app)
      .get(`/v2/organizations/${f.org}/ui-bootstrap`)
      .expect(200);
    const csrf = bootstrap.body.data.csrfToken as string;
    assert(csrf && bootstrap.body.data.capabilities.quoteOverridePrice === true, "UI bootstrap did not issue scoped CSRF/capability projection.");
    await request(app)
      .post(`/v2/organizations/${f.org}/quotes`)
      .send(routeInput)
      .expect(403);
    await request(app)
      .post(`/v2/organizations/${f.org}/quotes`)
      .set("x-v2-csrf-token", "invalid")
      .send({ ...routeInput, businessRequestId: "m17-http-invalid-csrf" })
      .expect(403);
    const httpCreate = await request(app)
      .post(`/v2/organizations/${f.org}/quotes`)
      .set("x-v2-csrf-token", csrf)
      .send(routeInput);
    assert(
      httpCreate.status === 200,
      `Authenticated Quote HTTP create failed: ${JSON.stringify(httpCreate.body)}`,
    );
    const httpQuoteId = httpCreate.body.data.quote.quote.quoteId as string;
    assert(httpQuoteId, "Authenticated Quote route did not create a Quote.");
    const httpReplay = await request(app)
      .post(`/v2/organizations/${f.org}/quotes`)
      .set("x-v2-csrf-token", csrf)
      .send(routeInput)
      .expect(200);
    assert(
      httpReplay.body.data.quote.quote.quoteId === httpQuoteId,
      "Authenticated Quote route lost M0 replay semantics.",
    );
    const otherSession: { v2CsrfToken?: string } = {};
    const otherSessionRuntime = composeAuthenticatedQuoteRuntime({
      pool,
      trustedHostIdentity: new PassportSessionIdentitySource(),
      trustedHostMiddleware: (req: any, _res, next) => {
        req.isAuthenticated = () => true;
        req.user = { id: f.user };
        req.sessionID = "m17-other-session";
        req.session = otherSession;
        next();
      },
    });
    const otherSessionApp = createV2HttpApp(
      loadV2RuntimeConfig({ NODE_ENV: "test" }),
      { log: () => undefined },
      undefined,
      otherSessionRuntime,
    );
    await request(otherSessionApp)
      .post(`/v2/organizations/${f.org}/quotes`)
      .set("x-v2-csrf-token", csrf)
      .send({ ...routeInput, businessRequestId: "m17-http-cross-session-csrf" })
      .expect(403);
    await request(app)
      .get(`/v2/organizations/${f.org}/quotes/${httpQuoteId}`)
      .set("x-forged-user", f.limited)
      .expect(200);
    await request(app)
      .get(`/v2/organizations/${f.other}/quotes/${httpQuoteId}`)
      .set("x-forged-organization", f.other)
      .expect(404);
    const httpAudit = await client.query<{ principal_subject: string }>(
      "SELECT principal_subject FROM v2_audit_events WHERE organization_id=$1 AND resource_id=$2 AND event_type='quote_created' ORDER BY created_at DESC LIMIT 1",
      [f.org, httpQuoteId],
    );
    assert(
      httpAudit.rows[0]?.principal_subject === f.user,
      "HTTP Quote Audit did not record the authenticated Staff actor.",
    );
    const unauthenticated = createV2HttpApp(
      loadV2RuntimeConfig({ NODE_ENV: "test" }),
      { log: () => undefined },
      undefined,
      composeAuthenticatedQuoteRuntime({
        pool,
        trustedHostIdentity: new PassportSessionIdentitySource(),
        trustedHostMiddleware: (_req, _res, next) => next(),
      }),
    );
    await request(unauthenticated)
      .post(`/v2/organizations/${f.org}/quotes`)
      .set("x-v2-csrf-token", csrf)
      .send(routeInput)
      .expect(403);
    await client.query(
      "DELETE FROM v2_permission_set_capabilities WHERE organization_id=$1 AND permission_set_id=$2 AND capability_id='quote.create'",
      [f.org, f.set],
    );
    await request(app)
      .post(`/v2/organizations/${f.org}/quotes`)
      .set("x-v2-csrf-token", csrf)
      .send({ ...routeInput, businessRequestId: "m17-http-capability-removed" })
      .expect(403);
    console.log("[m1.7] Quote application PostgreSQL rehearsal passed.");
  } finally {
    client?.release();
    await pool.end();
  }
}
main().catch((e: unknown) => {
  console.error(
    `[m1.7] rehearsal failed: ${e instanceof Error ? e.message : "unknown failure"}`,
  );
  process.exitCode = 1;
});
