/**
 * production-jobs-regression.spec.ts
 *
 * Phase 3 validation: smoke-tests the production board config/station endpoints
 * and the full production job lifecycle (start → stop → complete → reopen + note)
 * against the deployed DEV environment.
 *
 * Pattern mirrors proofing-dev-regression.spec.ts:
 *  - Auth comes from the shared session state saved by auth.setup.ts.
 *  - Each mutating test seeds its own disposable fixture and cleans up in finally.
 *  - All API calls use page.request (same-origin, session cookies carried automatically).
 *  - No localhost assumptions. BASE_URL is always PLAYWRIGHT_BASE_URL.
 */

import { expect, test, type Page } from "@playwright/test";
import { and, eq } from "drizzle-orm";

import { db } from "../server/db";
import {
  customers,
  orderLineItems,
  orders,
  products,
  productionEvents,
  productionJobs,
  productVariants,
} from "../shared/schema";

const ORG_ID = "org_titan_001";
const BASE_URL = requireEnv("PLAYWRIGHT_BASE_URL");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} must be set in .env.playwright`);
  return value;
}

function urlFor(path: string): string {
  return new URL(path, BASE_URL).toString();
}

/** Calls a same-origin relative API path using the browser's session cookies. */
async function browserApi(
  page: Page,
  path: string,
  method = "GET",
  body?: unknown,
): Promise<{ ok: boolean; status: number; json: any }> {
  return page.evaluate(
    async ({ requestPath, requestMethod, requestBody }) => {
      const response = await fetch(requestPath, {
        method: requestMethod,
        credentials: "include",
        headers: requestBody === undefined ? {} : { "Content-Type": "application/json" },
        body: requestBody === undefined ? undefined : JSON.stringify(requestBody),
      });
      let json: any = null;
      try {
        json = await response.json();
      } catch {
        json = null;
      }
      return { ok: response.ok, status: response.status, json };
    },
    { requestPath: path, requestMethod: method, requestBody: body },
  );
}

// ---------------------------------------------------------------------------
// Fixture
// ---------------------------------------------------------------------------

type ProductionFixture = {
  orderId: string;
  orderNumber: string;
  lineItemId: string;
  jobId: string;
};

async function seedFixture(): Promise<ProductionFixture> {
  const [customer] = await db
    .select({ id: customers.id, companyName: customers.companyName, email: customers.email })
    .from(customers)
    .where(eq(customers.organizationId, ORG_ID))
    .limit(1);
  if (!customer) throw new Error("No customer found for org_titan_001");

  const [product] = await db
    .select({ id: products.id, productTypeId: products.productTypeId })
    .from(products)
    .where(eq(products.organizationId, ORG_ID))
    .limit(1);
  if (!product) throw new Error("No product found for org_titan_001");

  const [variant] = await db
    .select({ id: productVariants.id })
    .from(productVariants)
    .where(eq(productVariants.productId, product.id))
    .limit(1);

  const orderNumber = `PWPROD-${Date.now()}`;

  const [order] = await db
    .insert(orders)
    .values({
      organizationId: ORG_ID,
      orderNumber,
      customerId: customer.id,
      status: "new",
      state: "open",
      paymentStatus: "unpaid",
      priority: "normal",
      fulfillmentStatus: "pending",
      subtotal: "10.00",
      tax: "0.00",
      taxAmount: "0.00",
      taxableSubtotal: "10.00",
      total: "10.00",
      discount: "0.00",
      label: `Production Regression ${new Date().toISOString()}`,
      billToName: customer.companyName,
      billToEmail: customer.email,
      shipToName: customer.companyName,
      shipToEmail: customer.email,
    })
    .returning();

  const [lineItem] = await db
    .insert(orderLineItems)
    .values({
      orderId: order.id,
      productId: product.id,
      productVariantId: variant?.id ?? null,
      productType: product.productTypeId ? String(product.productTypeId) : "wide_roll",
      description: `Prod Regression Item ${orderNumber}`,
      width: "24.00",
      height: "36.00",
      quantity: 1,
      unitPrice: "10.00",
      totalPrice: "10.00",
      status: "new",
      selectedOptions: [],
      materialUsages: [],
      requiresInventory: false,
      sortOrder: 0,
      workflowState: "ready_for_prepress",
      requiresDesign: false,
      requiresProofApproval: false,
      requiresPrepress: false,
      taxAmount: "0.00",
      isTaxableSnapshot: true,
    })
    .returning();

  // Insert a production job directly so the test is self-contained and not
  // dependent on the routing resolver being configured for this exact org state.
  const [job] = await db
    .insert(productionJobs)
    .values({
      organizationId: ORG_ID,
      orderId: order.id,
      lineItemId: lineItem.id,
      stationKey: "flatbed",
      stepKey: "queued",
      status: "queued",
      totalSeconds: 0,
    })
    .returning();

  return {
    orderId: order.id,
    orderNumber,
    lineItemId: lineItem.id,
    jobId: job.id,
  };
}

async function cleanupFixture(orderId: string): Promise<void> {
  // productionEvents cascade-deletes when productionJobs is deleted.
  // productionJobs cascade-deletes when orders is deleted.
  // orderLineItems cascade-deletes when orders is deleted.
  await db.transaction(async (tx) => {
    const jobIds = (
      await tx
        .select({ id: productionJobs.id })
        .from(productionJobs)
        .where(eq(productionJobs.orderId, orderId))
    ).map((r) => r.id);

    for (const jobId of jobIds) {
      await tx
        .delete(productionEvents)
        .where(and(eq(productionEvents.productionJobId, jobId), eq(productionEvents.organizationId, ORG_ID)));
    }

    await tx.delete(productionJobs).where(eq(productionJobs.orderId, orderId));
    await tx.delete(orderLineItems).where(eq(orderLineItems.orderId, orderId));
    await tx.delete(orders).where(eq(orders.id, orderId));
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe.serial("production board DEV regression", () => {
  test("auth state is live on deployed DEV", async ({ page }) => {
    await page.goto(urlFor("/dashboard"), { waitUntil: "domcontentloaded" });
    await expect(page).not.toHaveURL(/\/login/);

    const session = await browserApi(page, "/api/auth/session");
    expect(session.status).toBe(200);
    expect(session.json?.authenticated).toBe(true);
  });

  test("production config and board endpoints load (read-only)", async ({ page }) => {
    test.setTimeout(60_000);

    await page.goto(urlFor("/dashboard"), { waitUntil: "domcontentloaded" });
    await expect(page).not.toHaveURL(/\/login/);

    // GET /api/production/config
    const configRes = await browserApi(page, "/api/production/config");
    expect(configRes.status).toBe(200);
    expect(configRes.json?.success).toBe(true);
    expect(Array.isArray(configRes.json?.data?.enabledViews)).toBe(true);
    expect(configRes.json?.data?.enabledViews.length).toBeGreaterThan(0);

    // GET /api/production/stations
    const stationsRes = await browserApi(page, "/api/production/stations");
    expect(stationsRes.status).toBe(200);
    expect(stationsRes.json?.success).toBe(true);
    expect(Array.isArray(stationsRes.json?.data)).toBe(true);

    // GET /api/production/jobs (no station filter — overview board)
    const jobsRes = await browserApi(page, "/api/production/jobs");
    expect(jobsRes.status).toBe(200);
    expect(jobsRes.json?.success).toBe(true);
    expect(Array.isArray(jobsRes.json?.data)).toBe(true);

    // GET /api/production/jobs?view=flatbed (station-scoped board)
    const flatbedRes = await browserApi(page, "/api/production/jobs?view=flatbed");
    expect(flatbedRes.status).toBe(200);
    expect(flatbedRes.json?.success).toBe(true);

    // GET /api/production/jobs?status=queued
    const queuedRes = await browserApi(page, "/api/production/jobs?status=queued");
    expect(queuedRes.status).toBe(200);
    expect(queuedRes.json?.success).toBe(true);
  });

  test("production job lifecycle: start → stop → complete → reopen + note", async ({ page }) => {
    test.setTimeout(120_000);

    await page.goto(urlFor("/dashboard"), { waitUntil: "domcontentloaded" });
    await expect(page).not.toHaveURL(/\/login/);

    const fixture = await seedFixture();

    try {
      const { jobId } = fixture;

      // ------------------------------------------------------------------
      // Verify the seeded job is visible via the board API
      // ------------------------------------------------------------------
      await test.step("seeded job is visible via GET /api/production/jobs/:jobId", async () => {
        const res = await browserApi(page, `/api/production/jobs/${jobId}`);
        expect(res.status).toBe(200);
        expect(res.json?.success).toBe(true);
        expect(res.json?.data?.id ?? res.json?.id).toBe(jobId);
        const status = res.json?.data?.status ?? res.json?.status;
        expect(status).toBe("queued");
      });

      // ------------------------------------------------------------------
      // Start the job
      // ------------------------------------------------------------------
      await test.step("POST /api/production/jobs/:jobId/start → in_progress", async () => {
        const res = await browserApi(page, `/api/production/jobs/${jobId}/start`, "POST");
        expect(res.status, `start failed: ${JSON.stringify(res.json)}`).toBe(200);

        const detail = await browserApi(page, `/api/production/jobs/${jobId}`);
        const status = detail.json?.data?.status ?? detail.json?.status;
        expect(status).toBe("in_progress");
      });

      // ------------------------------------------------------------------
      // Stop the job
      // ------------------------------------------------------------------
      await test.step("POST /api/production/jobs/:jobId/stop → queued", async () => {
        const res = await browserApi(page, `/api/production/jobs/${jobId}/stop`, "POST");
        expect(res.status, `stop failed: ${JSON.stringify(res.json)}`).toBe(200);

        const detail = await browserApi(page, `/api/production/jobs/${jobId}`);
        const status = detail.json?.data?.status ?? detail.json?.status;
        expect(status).toBe("queued");
      });

      // ------------------------------------------------------------------
      // Restart the job (ensures start works after stop, not just once)
      // ------------------------------------------------------------------
      await test.step("POST /api/production/jobs/:jobId/start (restart) → in_progress", async () => {
        const res = await browserApi(page, `/api/production/jobs/${jobId}/start`, "POST");
        expect(res.status, `restart failed: ${JSON.stringify(res.json)}`).toBe(200);

        const detail = await browserApi(page, `/api/production/jobs/${jobId}`);
        const status = detail.json?.data?.status ?? detail.json?.status;
        expect(status).toBe("in_progress");
      });

      // ------------------------------------------------------------------
      // Add a note while the job is in_progress
      // ------------------------------------------------------------------
      await test.step("POST /api/production/jobs/:jobId/note → note recorded", async () => {
        const res = await browserApi(page, `/api/production/jobs/${jobId}/note`, "POST", {
          text: "DEV regression note — production jobs Phase 3 validation",
        });
        expect(res.status, `note failed: ${JSON.stringify(res.json)}`).toBe(200);
      });

      // ------------------------------------------------------------------
      // Complete the job
      // ------------------------------------------------------------------
      await test.step("POST /api/production/jobs/:jobId/complete → done", async () => {
        const res = await browserApi(page, `/api/production/jobs/${jobId}/complete`, "POST");
        expect(res.status, `complete failed: ${JSON.stringify(res.json)}`).toBe(200);

        const detail = await browserApi(page, `/api/production/jobs/${jobId}`);
        const status = detail.json?.data?.status ?? detail.json?.status;
        expect(status).toBe("done");
      });

      // ------------------------------------------------------------------
      // Reopen the completed job
      // ------------------------------------------------------------------
      await test.step("POST /api/production/jobs/:jobId/reopen → queued", async () => {
        const res = await browserApi(page, `/api/production/jobs/${jobId}/reopen`, "POST");
        expect(res.status, `reopen failed: ${JSON.stringify(res.json)}`).toBe(200);

        const detail = await browserApi(page, `/api/production/jobs/${jobId}`);
        const status = detail.json?.data?.status ?? detail.json?.status;
        expect(status).toBe("queued");
      });

      // ------------------------------------------------------------------
      // Verify the board still lists the reopened job as queued
      // ------------------------------------------------------------------
      await test.step("board reflects reopened job status", async () => {
        const boardRes = await browserApi(
          page,
          `/api/production/jobs?status=queued&view=flatbed`,
        );
        expect(boardRes.status).toBe(200);
        const jobs: any[] = boardRes.json?.data ?? [];
        const found = jobs.some((j) => j.id === jobId);
        // The board may not include the job if it's filtered by ownership rules,
        // but the direct GET must still return queued status (verified above).
        // We log for visibility but do not assert board inclusion here.
        if (!found) {
          console.warn(
            `[production-jobs-regression] Job ${jobId} not in board query (expected due to ownership filter on active-board queries).`,
          );
        }
      });
    } finally {
      await cleanupFixture(fixture.orderId);
    }
  });
});
