import "dotenv/config";
import { chromium, type Browser, type Page } from "playwright";
import { and, desc, eq, sql } from "drizzle-orm";

import { db } from "../server/db";
import { createLineItemFileRecord } from "../server/services/lineItemFileRecordService";
import { createOrderLineItem } from "../server/storage";
import {
  lineItemFiles,
  orderLineItems,
  orders,
  prepressSessions,
  productionJobs,
  quoteLineItems,
  users,
} from "../shared/schema";

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL || "https://www.printershero.com";
const EMAIL = process.env.PLAYWRIGHT_EMAIL || "qa.quote.validation+20260312@titanos.dev";
const PASSWORD = process.env.PLAYWRIGHT_PASSWORD || "TitanOS!Workflow2026";
const QUOTE_ID = process.env.WORKFLOW_VALIDATION_QUOTE_ID || "20e4c18a-2a60-42fc-8581-e0af914aadd7";
const ORDER_ID = process.env.WORKFLOW_VALIDATION_ORDER_ID || "";
const ORG_ID = "org_titan_001";

type ApiResult<T = any> = {
  ok: boolean;
  status: number;
  json: T;
};

type CheckResult = {
  id: string;
  pass: boolean;
  detail: string;
  data?: unknown;
};

type QuoteLineItem = {
  id: string;
  productName?: string | null;
  requiresDesign?: boolean | null;
  requiresPrepress?: boolean | null;
};

type OrderLineItemTruth = {
  id: string;
  quoteLineItemId: string | null;
  workflowState: string | null;
  status: string | null;
  requiresDesign: boolean | null;
  requiresPrepress: boolean | null;
  activeJobs: Array<{
    id: string;
    stationKey: string | null;
    stepKey: string | null;
    status: string | null;
  }>;
  sessions: Array<{
    id: string;
    status: string;
  }>;
  files: {
    original: number;
    final: number;
  };
};

const checks: CheckResult[] = [];

async function main() {
  const browser = await chromium.launch({ channel: "msedge", headless: true });
  let page = await browser.newPage();

  try {
    const [user] = await db.select({ id: users.id }).from(users).where(eq(users.email, EMAIL)).limit(1);
    if (!user) {
      throw new Error(`Validation user not found: ${EMAIL}`);
    }

    await login(page);

    const quote = await record("phase2.quote-load", async () => {
      await page.goto(urlFor(`/quotes/${QUOTE_ID}`), { waitUntil: "networkidle" });
      await ensureNotRedirectedToLogin(page);

      const quoteApi = await api<any>(page, "GET", `/api/quotes/${QUOTE_ID}`);
      assertOk(quoteApi.ok, `Quote API returned HTTP ${quoteApi.status}`);

      const lineItems = Array.isArray(quoteApi.json?.lineItems) ? quoteApi.json.lineItems as QuoteLineItem[] : [];
      expect(lineItems.length === 3, `Expected 3 quote line items, found ${lineItems.length}`);

      const a = lineItems.find((item) => String(item.productName || "").endsWith(" A"));
      const b = lineItems.find((item) => String(item.productName || "").endsWith(" B"));
      const c = lineItems.find((item) => String(item.productName || "").endsWith(" C"));

      expect(!!a && !!b && !!c, "Expected quote line items A, B, and C");
      expect(a?.requiresDesign === true && a?.requiresPrepress === true, "Item A routing mismatch");
      expect(b?.requiresDesign === false && b?.requiresPrepress === true, "Item B routing mismatch");
      expect(c?.requiresDesign === false && c?.requiresPrepress === false, "Item C routing mismatch");

      await page.reload({ waitUntil: "networkidle" });
      await ensureNotRedirectedToLogin(page);

      return {
        id: QUOTE_ID,
        lineItems,
        bySuffix: {
          A: a!,
          B: b!,
          C: c!,
        },
      };
    });

    const duplicateQuoteId = quote ? await record("phase2.quote-duplicate", async () => {
      const duplicateApi = await api<any>(page, "POST", `/api/quotes/${QUOTE_ID}/duplicate`, { mode: "quote_only" });
      assertOk(duplicateApi.ok, `Duplicate API returned HTTP ${duplicateApi.status}`);

      const duplicateId = String(duplicateApi.json?.id || duplicateApi.json?.quote?.id || "").trim();
      expect(duplicateId.length > 0, "Duplicate response did not include a quote id");

      const duplicateDetail = await api<any>(page, "GET", `/api/quotes/${duplicateId}`);
      assertOk(duplicateDetail.ok, `Duplicate quote load returned HTTP ${duplicateDetail.status}`);

      const duplicateItems = Array.isArray(duplicateDetail.json?.lineItems) ? duplicateDetail.json.lineItems as QuoteLineItem[] : [];
      expect(duplicateItems.length === 3, `Expected duplicated quote to have 3 line items, found ${duplicateItems.length}`);

      const routingMatrix = duplicateItems.map((item) => ({
        productName: item.productName,
        requiresDesign: item.requiresDesign,
        requiresPrepress: item.requiresPrepress,
      }));

      expect(
        routingMatrix.some((item) => String(item.productName || "").endsWith(" A") && item.requiresDesign === true && item.requiresPrepress === true),
        "Duplicate quote lost routing truth for item A",
      );
      expect(
        routingMatrix.some((item) => String(item.productName || "").endsWith(" B") && item.requiresDesign === false && item.requiresPrepress === true),
        "Duplicate quote lost routing truth for item B",
      );
      expect(
        routingMatrix.some((item) => String(item.productName || "").endsWith(" C") && item.requiresDesign === false && item.requiresPrepress === false),
        "Duplicate quote lost routing truth for item C",
      );

      return duplicateId;
    }) : null;

    const convertedOrder = quote ? await record(ORDER_ID ? "phase3.order-load" : "phase3.quote-convert", async () => {
      let orderId = ORDER_ID.trim();

      if (!orderId) {
        const convertApi = await api<any>(page, "POST", `/api/quotes/${QUOTE_ID}/convert-to-order`, {});
        assertOk(convertApi.ok, `Convert API returned HTTP ${convertApi.status}`);
        orderId = String(convertApi.json?.data?.order?.id || "").trim();
      }

      expect(orderId.length > 0, ORDER_ID ? "Provided order id is empty" : "Convert response did not include an order id");

      page = await ensureUsablePage(browser, page);
      await page.goto(urlFor(`/orders/${orderId}`), { waitUntil: "networkidle" });
      await ensureNotRedirectedToLogin(page);
      await page.reload({ waitUntil: "networkidle" });
      await ensureNotRedirectedToLogin(page);

      const orderApi = await api<any>(page, "GET", `/api/orders/${orderId}`);
      assertOk(orderApi.ok, `Order API returned HTTP ${orderApi.status}`);

      const dbLineItems = await getOrderLineItemTruth(orderId);
      const byQuoteLineItemId = new Map(dbLineItems.map((item) => [item.quoteLineItemId, item]));

      const itemA = byQuoteLineItemId.get(quote.bySuffix.A.id) || null;
      const itemB = byQuoteLineItemId.get(quote.bySuffix.B.id) || null;
      const itemC = byQuoteLineItemId.get(quote.bySuffix.C.id) || null;

      expect(!!itemA && !!itemB && !!itemC, "Converted order is missing one or more source line items");
      expect(itemA?.workflowState === "needs_design", `Expected item A workflowState needs_design, found ${itemA?.workflowState}`);
      expect(itemB?.workflowState === "ready_for_prepress", `Expected item B workflowState ready_for_prepress, found ${itemB?.workflowState}`);
      expect(itemC?.workflowState === "ready_for_production", `Expected item C workflowState ready_for_production, found ${itemC?.workflowState}`);
      expect(itemA?.activeJobs.length === 1 && isDesignJob(itemA.activeJobs[0]), "Expected item A to have exactly one active Design owner");
      expect(itemB?.activeJobs.length === 1 && isPrepressJob(itemB.activeJobs[0]), "Expected item B to have exactly one active Prepress owner");
      expect(itemC?.activeJobs.length === 1 && !isDesignJob(itemC.activeJobs[0]) && !isPrepressJob(itemC.activeJobs[0]), "Expected item C to have exactly one active downstream production owner");

      return {
        orderId,
        itemA: itemA!,
        itemB: itemB!,
        itemC: itemC!,
      };
    }) : null;

    if (convertedOrder) {
      await record("phase5.initial-queue-truth", async () => {
        const designQueue = await api<any>(page, "GET", "/api/design/queue");
        const prepressQueue = await api<any>(page, "GET", "/api/prepress/queue");
        const productionBoard = await api<any>(page, "GET", `/api/production/jobs?station=${encodeURIComponent(convertedOrder.itemC.activeJobs[0].stationKey || "")}`);

        assertOk(designQueue.ok, `Design queue returned HTTP ${designQueue.status}`);
        assertOk(prepressQueue.ok, `Prepress queue returned HTTP ${prepressQueue.status}`);
        assertOk(productionBoard.ok, `Production board returned HTTP ${productionBoard.status}`);

        const designIds = new Set((designQueue.json?.data || []).map((item: any) => String(item.lineItemId)));
        const prepressIds = new Set((prepressQueue.json?.data || []).map((item: any) => String(item.lineItemId)));
        const productionIds = new Set((productionBoard.json?.data || []).map((job: any) => String(job.lineItemId || "")));

        expect(designIds.has(convertedOrder.itemA.id), "Item A missing from design queue");
        expect(!designIds.has(convertedOrder.itemB.id) && !designIds.has(convertedOrder.itemC.id), "Design queue contains wrong items");
        expect(prepressIds.has(convertedOrder.itemB.id), "Item B missing from prepress queue");
        expect(!prepressIds.has(convertedOrder.itemA.id) && !prepressIds.has(convertedOrder.itemC.id), "Prepress queue contains wrong items");
        expect(productionIds.has(convertedOrder.itemC.id), "Item C missing from downstream board");
      });

      await record("phase4.design-prepress-handoff", async () => {
        await expectWorkflowTransition(page, `/api/design/line-item/${convertedOrder.itemA.id}/start`, "POST", undefined, 200, "start design");
        let itemA = await getLineItemTruth(convertedOrder.itemA.id);
        expect(itemA.workflowState === "in_design", `Expected item A workflowState in_design, found ${itemA.workflowState}`);
        expect(itemA.activeJobs.length === 1 && isDesignJob(itemA.activeJobs[0]), "Expected item A to remain owned by Design after start");

        await expectWorkflowTransition(page, `/api/design/line-item/${convertedOrder.itemA.id}/return-to-needs-design`, "POST", undefined, 200, "return to needs design");
        itemA = await getLineItemTruth(convertedOrder.itemA.id);
        expect(itemA.workflowState === "needs_design", `Expected item A workflowState needs_design after return, found ${itemA.workflowState}`);
        expect(itemA.activeJobs.length === 1 && isDesignJob(itemA.activeJobs[0]), "Expected item A to remain owned by Design after return");

        await expectWorkflowTransition(page, `/api/design/line-item/${convertedOrder.itemA.id}/start`, "POST", undefined, 200, "restart design after return");
        itemA = await getLineItemTruth(convertedOrder.itemA.id);
        expect(itemA.workflowState === "in_design", `Expected item A workflowState in_design after restart, found ${itemA.workflowState}`);

        await expectWorkflowTransition(page, `/api/design/line-item/${convertedOrder.itemA.id}/send-to-prepress`, "POST", undefined, 200, "send to prepress");
        itemA = await getLineItemTruth(convertedOrder.itemA.id);
        expect(itemA.workflowState === "ready_for_prepress", `Expected item A workflowState ready_for_prepress, found ${itemA.workflowState}`);
        expect(itemA.activeJobs.length === 1 && isPrepressJob(itemA.activeJobs[0]), "Expected item A to be actively owned by Prepress after design handoff");

        const prepressQueue = await api<any>(page, "GET", "/api/prepress/queue");
        assertOk(prepressQueue.ok, `Prepress queue returned HTTP ${prepressQueue.status}`);
        const prepressIds = new Set((prepressQueue.json?.data || []).map((item: any) => String(item.lineItemId)));
        expect(prepressIds.has(convertedOrder.itemA.id) && prepressIds.has(convertedOrder.itemB.id), "Prepress queue did not reflect mixed-stage truth after A handoff");

        await createLineItemFileRecord({
          organizationId: ORG_ID,
          lineItemId: convertedOrder.itemA.id,
          role: "original",
          storagePath: `validation/${convertedOrder.itemA.id}/original.pdf`,
          storageKey: `validation/${convertedOrder.itemA.id}/original.pdf`,
          originalFilename: `workflow-validation-${convertedOrder.itemA.id}.pdf`,
          uploadedByUserId: user.id,
          mimeType: "application/pdf",
          sizeBytes: 128,
        });

        const startSession = await api<any>(page, "POST", "/api/prepress/session/start", { lineItemId: convertedOrder.itemA.id });
        assertOk(startSession.ok, `Start prepress session returned HTTP ${startSession.status}`);
        const sessionId = String(startSession.json?.data?.id || "").trim();
        expect(sessionId.length > 0, "Prepress session start did not return a session id");

        itemA = await getLineItemTruth(convertedOrder.itemA.id);
        expect(itemA.workflowState === "in_prepress", `Expected item A workflowState in_prepress, found ${itemA.workflowState}`);
        expect(itemA.activeJobs.length === 1 && isPrepressJob(itemA.activeJobs[0]), "Expected item A to remain prepress-owned during session");
        expect(itemA.sessions.some((session) => session.id === sessionId && session.status === "active"), "Expected active prepress session for item A");

        const completeSession = await api<any>(page, "POST", `/api/prepress/session/${sessionId}/complete`, {});
        assertOk(completeSession.ok, `Complete prepress session returned HTTP ${completeSession.status}`);

        itemA = await getLineItemTruth(convertedOrder.itemA.id);
        expect(itemA.files.final >= 1, "Expected final artwork file to exist after completing prepress session");

        const sendToPrint = await api<any>(page, "POST", `/api/prepress/line-item/${convertedOrder.itemA.id}/send-to-print`, {});
        assertOk(sendToPrint.ok, `Send to print returned HTTP ${sendToPrint.status}`);

        itemA = await getLineItemTruth(convertedOrder.itemA.id);
        expect(itemA.workflowState === "ready_for_production", `Expected item A workflowState ready_for_production, found ${itemA.workflowState}`);
        expect(itemA.activeJobs.length === 1 && !isPrepressJob(itemA.activeJobs[0]) && !isDesignJob(itemA.activeJobs[0]), "Expected item A to have exactly one active downstream owner after send-to-print");

        const history = await api<any>(page, "GET", `/api/prepress/line-item/${convertedOrder.itemA.id}/history`);
        assertOk(history.ok, `Prepress history returned HTTP ${history.status}`);
        const descriptions = Array.isArray(history.json?.data) ? history.json.data.map((entry: any) => String(entry.description || "")) : [];
        expect(descriptions.some((entry: string) => entry.toLowerCase().includes("workflow transitioned")), "Expected explicit workflow transition history entries");

        return { sessionId, downstreamStation: itemA.activeJobs[0].stationKey };
      });

      await record("phase5.post-handoff-queue-truth", async () => {
        const itemA = await getLineItemTruth(convertedOrder.itemA.id);
        const designQueue = await api<any>(page, "GET", "/api/design/queue");
        const prepressQueue = await api<any>(page, "GET", "/api/prepress/queue");
        const productionBoard = await api<any>(page, "GET", `/api/production/jobs?station=${encodeURIComponent(itemA.activeJobs[0].stationKey || "")}`);

        assertOk(designQueue.ok, `Design queue returned HTTP ${designQueue.status}`);
        assertOk(prepressQueue.ok, `Prepress queue returned HTTP ${prepressQueue.status}`);
        assertOk(productionBoard.ok, `Production board returned HTTP ${productionBoard.status}`);

        const designIds = new Set((designQueue.json?.data || []).map((item: any) => String(item.lineItemId)));
        const prepressIds = new Set((prepressQueue.json?.data || []).map((item: any) => String(item.lineItemId)));
        const productionIds = new Set((productionBoard.json?.data || []).map((job: any) => String(job.lineItemId || "")));

        expect(!designIds.has(convertedOrder.itemA.id), "Item A incorrectly remained in design queue after handoff");
        expect(prepressIds.has(convertedOrder.itemB.id) && !prepressIds.has(convertedOrder.itemA.id), "Prepress queue truth is incorrect after A handoff");
        expect(productionIds.has(convertedOrder.itemA.id), "Item A missing from downstream board after send-to-print");
      });

      await record("phase6.fail-closed-station-resolution", async () => {
        const jobId = convertedOrder.itemC.activeJobs[0]?.id;
        expect(!!jobId, "Item C has no active downstream job for fail-closed test");

        const before = await getLineItemTruth(convertedOrder.itemC.id);
        const override = await api<any>(page, "POST", `/api/production/jobs/${jobId}/routing`, {
          stationKey: "__missing_station__",
          stepKey: "print",
          reason: "validation_fail_closed",
        });

        expect(override.status === 409, `Expected fail-closed override to return 409, found ${override.status}`);

        const after = await getLineItemTruth(convertedOrder.itemC.id);
        expect(after.activeJobs.length === 1, `Expected item C to keep exactly one active job, found ${after.activeJobs.length}`);
        expect(after.activeJobs[0]?.id === before.activeJobs[0]?.id, "Fail-closed override changed the active owner unexpectedly");
      });

      await record("phase7.reroute-blocking", async () => {
        const [sourceQuoteLineItem] = await db
          .select({
            productId: quoteLineItems.productId,
            productName: quoteLineItems.productName,
            variantId: quoteLineItems.variantId,
            variantName: quoteLineItems.variantName,
            productType: quoteLineItems.productType,
            width: quoteLineItems.width,
            height: quoteLineItems.height,
            quantity: quoteLineItems.quantity,
          })
          .from(quoteLineItems)
          .where(eq(quoteLineItems.id, quote.bySuffix.B.id))
          .limit(1);

        expect(!!sourceQuoteLineItem, "Could not load source quote line item for safe reroute setup");

        const created = await createOrderLineItem({
          orderId: convertedOrder.orderId,
          productId: sourceQuoteLineItem!.productId,
          productVariantId: sourceQuoteLineItem!.variantId,
          productType: sourceQuoteLineItem!.productType,
          description: `${sourceQuoteLineItem!.productName} SAFE`,
          width: Number(sourceQuoteLineItem!.width || 24),
          height: Number(sourceQuoteLineItem!.height || 36),
          quantity: Number(sourceQuoteLineItem!.quantity || 1),
          unitPrice: 1,
          totalPrice: 1,
          selectedOptions: [],
          status: "new",
          workflowState: "ready_for_prepress",
          requiresDesign: false,
          requiresPrepress: true,
          materialUsages: [],
          requiresInventory: false,
        });

        const safeLineItemId = String(created.id || "").trim();
        expect(safeLineItemId.length > 0, "Safe line item creation did not return an id");

        const safeBefore = await getLineItemTruth(safeLineItemId);
        expect(safeBefore.activeJobs.length === 0, `Expected safe line item to have no active jobs, found ${safeBefore.activeJobs.length}`);
        expect(safeBefore.workflowState === "ready_for_prepress", `Expected safe line item to start ready_for_prepress, found ${safeBefore.workflowState}`);

        const safePatch = await api<any>(page, "PATCH", `/api/order-line-items/${safeLineItemId}`, {
          requiresDesign: true,
          requiresPrepress: true,
        });
        assertOk(safePatch.ok, `Safe routing edit returned HTTP ${safePatch.status}`);

        const safeAfter = await getLineItemTruth(safeLineItemId);
        expect(safeAfter.workflowState === "needs_design", `Expected safe line item workflowState needs_design after reroute, found ${safeAfter.workflowState}`);
        expect(safeAfter.activeJobs.length === 0, "Safe line item unexpectedly gained an active owner during reroute edit");

        const blockedPatch = await api<any>(page, "PATCH", `/api/order-line-items/${convertedOrder.itemC.id}`, {
          requiresDesign: false,
          requiresPrepress: true,
        });
        expect(blockedPatch.status === 409, `Expected active downstream reroute edit to return 409, found ${blockedPatch.status}`);
      });
    }

    console.log(JSON.stringify(buildSummary(duplicateQuoteId), null, 2));
  } finally {
    await page.close().catch(() => undefined);
    await browser.close().catch(() => undefined);
  }
}

async function ensureUsablePage(browser: Browser, currentPage: Page): Promise<Page> {
  if (!browser.isConnected()) {
    throw new Error("Browser disconnected before validation could continue");
  }

  if (!currentPage.isClosed()) {
    return currentPage;
  }

  const replacementPage = await browser.newPage();
  await login(replacementPage);
  return replacementPage;
}

function buildSummary(duplicateQuoteId: string | null) {
  const failures = checks.filter((check) => !check.pass);
  return {
    baseUrl: BASE_URL,
    quoteId: QUOTE_ID,
    duplicateQuoteId,
    checks,
    totals: {
      passed: checks.filter((check) => check.pass).length,
      failed: failures.length,
    },
  };
}

async function record<T>(id: string, fn: () => Promise<T>): Promise<T | null> {
  try {
    const data = await fn();
    checks.push({ id, pass: true, detail: "ok", data });
    return data;
  } catch (error: any) {
    checks.push({ id, pass: false, detail: error?.message || String(error) });
    return null;
  }
}

async function login(page: Page) {
  await page.goto(urlFor("/login"), { waitUntil: "networkidle" });
  const loginResponse = await api<any>(page, "POST", "/api/auth/login", {
    email: EMAIL,
    password: PASSWORD,
  });
  assertOk(loginResponse.ok, `Login API returned HTTP ${loginResponse.status}`);

  const sessionResponse = await api<any>(page, "GET", "/api/auth/session");
  assertOk(sessionResponse.ok, `Auth session check returned HTTP ${sessionResponse.status}`);
  expect(sessionResponse.json?.authenticated === true, "Authenticated session was not established after login");

  await page.goto(urlFor("/dashboard"), { waitUntil: "networkidle" });
  await ensureNotRedirectedToLogin(page);
}

async function ensureNotRedirectedToLogin(page: Page) {
  const current = page.url();
  expect(!/\/login(?:$|[?#])/.test(current), `Unexpected redirect to login: ${current}`);
}

async function api<T>(page: Page, method: string, path: string, body?: unknown): Promise<ApiResult<T>> {
  const result = await page.evaluate(async ({ method, path, body }) => {
    const response = await fetch(path, {
      method,
      credentials: "include",
      headers: body === undefined ? {} : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

    let json: any = null;
    try {
      json = await response.json();
    } catch {
      json = null;
    }

    return {
      ok: response.ok,
      status: response.status,
      json,
    };
  }, { method, path, body });

  return result as ApiResult<T>;
}

async function expectWorkflowTransition(page: Page, path: string, method: string, body: unknown, expectedStatus: number, label: string) {
  const response = await api<any>(page, method, path, body);
  expect(response.status === expectedStatus, `Failed to ${label}: HTTP ${response.status}`);
}

async function getOrderLineItemTruth(orderId: string): Promise<OrderLineItemTruth[]> {
  const rows = await db
    .select({
      id: orderLineItems.id,
      quoteLineItemId: orderLineItems.quoteLineItemId,
      workflowState: orderLineItems.workflowState,
      status: orderLineItems.status,
      requiresDesign: orderLineItems.requiresDesign,
      requiresPrepress: orderLineItems.requiresPrepress,
    })
    .from(orderLineItems)
    .innerJoin(orders, eq(orderLineItems.orderId, orders.id))
    .where(and(eq(orders.organizationId, ORG_ID), eq(orders.id, orderId)));

  return Promise.all(rows.map((row) => getLineItemTruth(row.id)));
}

async function getLineItemTruth(lineItemId: string): Promise<OrderLineItemTruth> {
  const [row] = await db
    .select({
      id: orderLineItems.id,
      quoteLineItemId: orderLineItems.quoteLineItemId,
      workflowState: orderLineItems.workflowState,
      status: orderLineItems.status,
      requiresDesign: orderLineItems.requiresDesign,
      requiresPrepress: orderLineItems.requiresPrepress,
    })
    .from(orderLineItems)
    .innerJoin(orders, eq(orderLineItems.orderId, orders.id))
    .where(and(eq(orderLineItems.id, lineItemId), eq(orders.organizationId, ORG_ID)))
    .limit(1);

  expect(!!row, `Line item not found: ${lineItemId}`);

  const activeJobs = await db
    .select({
      id: productionJobs.id,
      stationKey: productionJobs.stationKey,
      stepKey: productionJobs.stepKey,
      status: productionJobs.status,
    })
    .from(productionJobs)
    .where(and(
      eq(productionJobs.organizationId, ORG_ID),
      eq(productionJobs.lineItemId, lineItemId),
      sql`${productionJobs.status} not in ('done', 'void', 'canceled', 'cancelled')`,
    ))
    .orderBy(desc(productionJobs.updatedAt));

  const sessions = await db
    .select({
      id: prepressSessions.id,
      status: prepressSessions.status,
    })
    .from(prepressSessions)
    .where(and(eq(prepressSessions.organizationId, ORG_ID), eq(prepressSessions.lineItemId, lineItemId)))
    .orderBy(desc(prepressSessions.updatedAt));

  const fileCounts = await db
    .select({
      role: lineItemFiles.role,
      count: sql<number>`count(*)::int`,
    })
    .from(lineItemFiles)
    .where(and(eq(lineItemFiles.organizationId, ORG_ID), eq(lineItemFiles.lineItemId, lineItemId), eq(lineItemFiles.status, "active")))
    .groupBy(lineItemFiles.role);

  const files = {
    original: fileCounts.find((row) => row.role === "original")?.count ?? 0,
    final: fileCounts.find((row) => row.role === "final")?.count ?? 0,
  };

  return {
    id: row!.id,
    quoteLineItemId: row!.quoteLineItemId,
    workflowState: row!.workflowState,
    status: row!.status,
    requiresDesign: row!.requiresDesign,
    requiresPrepress: row!.requiresPrepress,
    activeJobs,
    sessions,
    files,
  };
}

function isDesignJob(job: { stationKey: string | null; stepKey: string | null } | undefined) {
  if (!job) return false;
  return normalize(job.stationKey) === "design" || normalize(job.stepKey) === "design";
}

function isPrepressJob(job: { stationKey: string | null; stepKey: string | null } | undefined) {
  if (!job) return false;
  return normalize(job.stationKey) === "prepress" || normalize(job.stepKey) === "prepress";
}

function normalize(value: string | null | undefined) {
  return String(value || "").trim().toLowerCase();
}

function urlFor(path: string) {
  return new URL(path, BASE_URL).toString();
}

function assertOk(condition: boolean, message: string) {
  expect(condition, message);
}

function expect(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});