import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import request from "supertest";
import { requireV2M0CloneDatabaseUrl } from "../infrastructure/persistence/cloneSafety.js";
import { composeAuthenticatedQuoteRuntime } from "../infrastructure/sales/authenticatedQuoteRuntime.js";
import { composeAuthenticatedProductionRuntime } from "../infrastructure/production/authenticatedProductionRuntime.js";
import { createV2HttpApp } from "../src/interfaces/http/app.js";
import { loadV2RuntimeConfig } from "../src/config/runtimeConfig.js";
import { V2ApplicationError } from "../src/errors/applicationError.js";
import type { StaffPrincipal } from "../src/authorization/principals.js";

const cloneHost = "ep-soft-frost-aef6c2jb-pooler.c-2.us-east-2.aws.neon.tech";
const requestId = (label: string) => `p7-runtime-http-${label}-${randomUUID()}`;

type Fixture = Readonly<{
  organizationId: string;
  userId: string;
  productId: string;
  activeVersionUpdatedAt: string;
  productionWorkId: string;
  productionAttemptId: string;
  materialId: string;
  requirementId: string;
}>;

const main = async () => {
  const url = requireV2M0CloneDatabaseUrl();
  const target = new URL(url);
  assert.equal(
    target.hostname,
    cloneHost,
    "P7 runtime HTTP rehearsal refuses a database other than the authorized MAIN-derived DEV clone.",
  );
  assert.equal(
    target.pathname.replace(/^\//u, ""),
    "neondb",
    "P7 runtime HTTP rehearsal refuses a database other than neondb.",
  );

  const pool = new Pool({
    connectionString: url,
    max: 6,
    application_name: "p7-runtime-http-rehearsal",
  });
  try {
    const fixture = (
      await pool.query<{
        organization_id: string;
        user_id: string;
        product_id: string;
        active_updated_at: Date;
        production_work_id: string;
        production_attempt_id: string;
        material_id: string;
        requirement_id: string;
      }>(
        `
      SELECT w.organization_id, w.created_staff_actor_user_id user_id, l.product_id, v.updated_at active_updated_at,
        w.id production_work_id, a.id production_attempt_id, r.material_id, r.id requirement_id
      FROM v2_production_works w
      JOIN v2_production_attempts a ON a.organization_id=w.organization_id AND a.production_work_id=w.id AND a.completed_at IS NULL
      JOIN v2_order_line_material_requirements r ON r.organization_id=w.organization_id AND r.order_line_id=w.order_line_id
      JOIN v2_sales_document_lines l ON l.organization_id=w.organization_id AND l.id=w.order_line_id
      JOIN pbv2_tree_versions v ON v.organization_id=l.organization_id AND v.product_id=l.product_id AND v.status='ACTIVE'
      WHERE w.organization_id LIKE 'p7d-%'
      ORDER BY a.started_at DESC NULLS LAST, a.id DESC
      LIMIT 1`,
        [],
      )
    ).rows[0];
    assert.ok(
      fixture,
      "P7 runtime HTTP rehearsal needs the guarded P7D fixture. Run v2:p7d:inventory first.",
    );
    const f: Fixture = {
      organizationId: fixture.organization_id,
      userId: fixture.user_id,
      productId: fixture.product_id,
      activeVersionUpdatedAt: fixture.active_updated_at.toISOString(),
      productionWorkId: fixture.production_work_id,
      productionAttemptId: fixture.production_attempt_id,
      materialId: fixture.material_id,
      requirementId: fixture.requirement_id,
    };

    // This is controlled clone-fixture setup only. It supplies sufficient stock
    // and the canonical Active pointer for the HTTP commands; every subsequent
    // operational mutation uses the composed V2 routes.
    await pool.query(
      "UPDATE products SET pbv2_active_tree_version_id=(SELECT id FROM pbv2_tree_versions WHERE organization_id=$1 AND product_id=$2 AND status='ACTIVE' ORDER BY updated_at DESC,id DESC LIMIT 1) WHERE organization_id=$1 AND id=$2",
      [f.organizationId, f.productId],
    );
    await pool.query(
      "UPDATE materials SET stock_quantity=500 WHERE organization_id=$1 AND id=$2",
      [f.organizationId, f.materialId],
    );

    const principal: StaffPrincipal = {
      kind: "staff",
      organizationId: f.organizationId,
      userId: f.userId,
      authority: {
        membershipId: `p7-runtime-http-${f.organizationId}`,
        capabilities: [
          "product.view",
          "product.edit",
          "production.view",
          "production.work",
          "production.complete",
        ] as any,
      },
    };
    const trustedHostMiddleware = (req: any, _res: any, next: () => void) => {
      req.isAuthenticated = () => true;
      req.user = { id: f.userId };
      req.sessionID = "p7-runtime-http-session";
      req.session = {
        v2CsrfToken: "p7-runtime-http-csrf",
        v2SessionScope: "p7-runtime-http-scope",
      };
      next();
    };
    const trustedHostIdentity = { authenticatedIdentity: async () => null };
    const quoteRuntime = composeAuthenticatedQuoteRuntime({
      pool,
      trustedHostIdentity,
      trustedHostMiddleware,
    });
    const productionRuntime = composeAuthenticatedProductionRuntime({
      pool,
      trustedHostIdentity,
      trustedHostMiddleware,
    });
    const principals = {
      principal: async (_request: unknown, organizationId: string) => {
        if (organizationId !== f.organizationId)
          throw new V2ApplicationError(
            "WRONG_TENANT",
            "Authenticated authority is unavailable for this organization.",
          );
        return principal;
      },
    };
    const app = createV2HttpApp(
      loadV2RuntimeConfig({
        NODE_ENV: "test",
        V2_SERVICE_NAME: "p7-runtime-http",
      }),
      { log: () => undefined },
      undefined,
      {
        ...quoteRuntime,
        productDependencies: {
          ...quoteRuntime.productDependencies,
          principals,
        },
      },
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      {
        ...productionRuntime,
        dependencies: { ...productionRuntime.dependencies, principals },
      },
    );
    const csrf = { "x-v2-csrf-token": "p7-runtime-http-csrf" };
    const productBase = `/v2/organizations/${encodeURIComponent(f.organizationId)}/products/${encodeURIComponent(f.productId)}`;
    const productionBase = `/v2/organizations/${encodeURIComponent(f.organizationId)}/production/works/${encodeURIComponent(f.productionWorkId)}`;

    await request(app)
      .post(`${productionBase}/reservations`)
      .send({ businessRequestId: requestId("missing-csrf") })
      .expect(403);
    const draft = await request(app)
      .post(`${productBase}/drafts`)
      .set(csrf)
      .send({
        businessRequestId: requestId("create-draft"),
        expectedActiveVersionUpdatedAt: f.activeVersionUpdatedAt,
      })
      .expect((response) => {
        if (response.status !== 200)
          throw new Error(`Draft creation HTTP failure: ${response.status} ${JSON.stringify(response.body)}`);
      });
    assert.equal(
      draft.body.ok,
      true,
      "Draft creation did not serialize through the authenticated Product route.",
    );
    const recipe = await request(app)
      .get(`${productBase}/draft/recipe`)
      .expect(200);
    assert.equal(
      recipe.body.ok,
      true,
      "Draft recipe read did not serialize through the authenticated Product route.",
    );
    assert.ok(
      recipe.body.data.components.length > 0,
      "Draft creation did not preserve the recipe component copy.",
    );
    const save = await request(app)
      .patch(`${productBase}/draft/recipe`)
      .set(csrf)
      .send({
        businessRequestId: requestId("save-recipe"),
        draftVersionId: recipe.body.data.productVersionId,
        expectedDraftUpdatedAt: recipe.body.data.draftUpdatedAt,
        components: recipe.body.data.components,
      })
      .expect(200);
    assert.equal(
      save.body.ok,
      true,
      "Draft recipe save did not use the canonical P7 recipe command.",
    );

    const before = await request(app)
      .get(`${productionBase}/materials`)
      .expect((response) => {
        if (response.status !== 200)
          throw new Error(`Material projection HTTP failure: ${response.status} ${JSON.stringify(response.body)}`);
      });
    assert.ok(
      before.body.data.usage.comparison.some(
        (row: { requirementId?: string }) =>
          row.requirementId === f.requirementId,
      ),
      "Expected frozen material requirement is absent from the HTTP projection.",
    );
    const reservationId = requestId("reserve");
    await request(app)
      .post(`${productionBase}/reservations`)
      .set(csrf)
      .send({ businessRequestId: reservationId })
      .expect(200);
    await request(app)
      .post(`${productionBase}/reservations`)
      .set(csrf)
      .send({ businessRequestId: reservationId })
      .expect(200);
    const consumed = await request(app)
      .post(
        `${productionBase}/attempts/${encodeURIComponent(f.productionAttemptId)}/materials`,
      )
      .set(csrf)
      .send({
        businessRequestId: requestId("consume"),
        materialId: f.materialId,
        requirementId: f.requirementId,
        quantity: "1",
        unit: "each",
        kind: "consumed",
      })
      .expect(200);
    const consumptionId = consumed.body.data.consumptionId as string;
    const reconciliationId = requestId("reconcile");
    await request(app)
      .post(
        `${productionBase}/reconciliation/${encodeURIComponent(consumptionId)}`,
      )
      .set(csrf)
      .send({ businessRequestId: reconciliationId })
      .expect(200);
    await request(app)
      .post(
        `${productionBase}/reconciliation/${encodeURIComponent(consumptionId)}`,
      )
      .set(csrf)
      .send({ businessRequestId: reconciliationId })
      .expect(200);
    const waste = await request(app)
      .post(
        `${productionBase}/attempts/${encodeURIComponent(f.productionAttemptId)}/materials`,
      )
      .set(csrf)
      .send({
        businessRequestId: requestId("waste"),
        materialId: f.materialId,
        requirementId: f.requirementId,
        quantity: "1",
        unit: "each",
        kind: "waste",
      })
      .expect(200);
    await request(app)
      .post(
        `${productionBase}/reconciliation/${encodeURIComponent(waste.body.data.consumptionId)}`,
      )
      .set(csrf)
      .send({ businessRequestId: requestId("reconcile-waste") })
      .expect(200);
    const correction = await request(app)
      .post(
        `${productionBase}/attempts/${encodeURIComponent(f.productionAttemptId)}/materials`,
      )
      .set(csrf)
      .send({
        businessRequestId: requestId("correction"),
        materialId: f.materialId,
        requirementId: f.requirementId,
        quantity: "1",
        unit: "each",
        kind: "correction",
        correctsConsumptionId: waste.body.data.consumptionId,
      })
      .expect(200);
    await request(app)
      .post(
        `${productionBase}/reconciliation/${encodeURIComponent(correction.body.data.consumptionId)}`,
      )
      .set(csrf)
      .send({ businessRequestId: requestId("reconcile-correction") })
      .expect(200);
    const after = await request(app)
      .get(`${productionBase}/materials`)
      .expect(200);
    assert.ok(
      after.body.data.inventory.facts.every(
        (row: { status: string }) => row.status === "applied",
      ),
      "A successful HTTP reconciliation remained unapplied.",
    );
    await request(app)
      .get(
        `/v2/organizations/not-${encodeURIComponent(f.organizationId)}/production/works/${encodeURIComponent(f.productionWorkId)}/materials`,
      )
      .expect(404);

    const movementCount = await pool.query<{ count: string }>(
      "SELECT count(*)::text FROM v2_inventory_movements WHERE organization_id=$1 AND consumption_id=ANY($2::varchar[])",
      [
        f.organizationId,
        [
          consumptionId,
          waste.body.data.consumptionId,
          correction.body.data.consumptionId,
        ],
      ],
    );
    assert.equal(
      movementCount.rows[0]!.count,
      "3",
      "HTTP replay created duplicate inventory movement effects.",
    );
    console.log(
      JSON.stringify(
        {
          productDraft: recipe.body.data.productVersionId,
          productionWork: f.productionWorkId,
          consumption: consumptionId,
          materialCommands: [
            "reserve",
            "consume",
            "waste",
            "correction",
            "reconcile",
          ],
          replay: "duplicate-safe",
          tenant: "rejected",
        },
        null,
        2,
      ),
    );
    console.log(
      "[p7-runtime-http] Authenticated P7 HTTP composition clone rehearsal passed.",
    );
  } finally {
    await pool.end();
  }
};

void main().catch((cause: unknown) => {
  console.error(
    `[p7-runtime-http] ${cause instanceof Error ? (cause.stack ?? cause.message) : String(cause)}`,
  );
  process.exitCode = 1;
});
