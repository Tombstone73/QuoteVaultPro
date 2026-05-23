import { expect, test, type APIResponse, type Locator, type Page, type TestInfo } from "@playwright/test";
import fs from "fs/promises";

const BASE_URL = requireEnv("PLAYWRIGHT_BASE_URL");
const RUN_ID = `TEST WORKFLOW BROWSER RUN ${new Date().toISOString().replace(/[:.]/g, "-")}`;
const SAFE_RUN_ID = RUN_ID.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

type ApiResult<T = any> = {
  ok: boolean;
  status: number;
  json: T | null;
  text: string;
};

type WorkflowIssue = {
  step: string;
  severity: "blocking" | "non-blocking";
  url: string;
  message: string;
  visibleErrors: string[];
  screenshot?: string;
};

type WorkflowReport = {
  runId: string;
  baseUrl: string;
  passedSteps: string[];
  skippedSteps: string[];
  issues: WorkflowIssue[];
  consoleErrors: string[];
  networkFailures: string[];
  data: Record<string, unknown>;
};

type Pbv2PricingCandidate = {
  product: any;
  treeJson: any;
  selections: Record<string, unknown>;
  calculation: any;
};

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} must be set in .env.playwright`);
  return value;
}

test.describe.serial("A-Z shop workflow on deployed DEV", () => {
  test("quote to order to production to fulfillment to billing", async ({ page }, testInfo) => {
    test.setTimeout(300_000);

    const report: WorkflowReport = {
      runId: RUN_ID,
      baseUrl: BASE_URL,
      passedSteps: [],
      skippedSteps: [],
      issues: [],
      consoleErrors: [],
      networkFailures: [],
      data: {},
    };

    installBrowserMonitors(page, report);

    const step = async <T,>(
      name: string,
      severity: "blocking" | "non-blocking",
      fn: () => Promise<T>,
    ): Promise<T | null> => {
      console.log(`[A-Z] START ${name} @ ${page.url()}`);
      try {
        const result = await fn();
        report.passedSteps.push(name);
        console.log(`[A-Z] PASS ${name} @ ${page.url()}`);
        return result;
      } catch (error: any) {
        const visibleErrors = await collectVisibleErrors(page);
        const screenshot = await captureIssueScreenshot(page, testInfo, name);
        report.issues.push({
          step: name,
          severity,
          url: page.url(),
          message: error?.message || String(error),
          visibleErrors,
          screenshot,
        });
        console.log(`[A-Z] ${severity.toUpperCase()} ${name}: ${error?.message || error}`);
        return null;
      }
    };

    await step("guard target is deployed DEV", "blocking", async () => {
      const origin = new URL(BASE_URL).origin;
      expect(origin).toBe("https://dev.printershero.com");
      expect(origin).not.toBe("https://www.printershero.com");
      expect(origin).not.toContain("localhost");
    });

    const authenticated = await step("login/auth session is valid", "blocking", async () => {
      await page.goto("/dashboard", { waitUntil: "networkidle" });
      await expect(page).not.toHaveURL(/\/login/);
      const session = await apiJson(page, "/api/auth/session");
      expect(session.status).toBe(200);
      expect(session.json?.authenticated).toBe(true);
      return true;
    });

    if (!authenticated) {
      await writeReport(report, testInfo);
      throw new Error("A-Z workflow blocked before authentication completed.");
    }

    const customer = await step("create clearly labeled test customer", "blocking", async () => {
      const created = await apiJson(page, "/api/customers", {
        method: "POST",
        data: {
          companyName: RUN_ID,
          email: `${SAFE_RUN_ID}@example.test`,
          phone: "555-0100",
          customerType: "business",
          status: "active",
          billingStreet1: "123 Workflow Test Way",
          billingCity: "Raleigh",
          billingState: "NC",
          billingPostalCode: "27601",
          billingCountry: "US",
          shippingStreet1: "123 Workflow Test Way",
          shippingCity: "Raleigh",
          shippingState: "NC",
          shippingPostalCode: "27601",
          shippingCountry: "US",
          primaryContact: {
            firstName: "Workflow",
            lastName: "Browser",
            email: `contact-${SAFE_RUN_ID}@example.test`,
            phone: "555-0101",
            isPrimary: true,
          },
        },
      });
      expect(created.status, created.text).toBe(200);
      expect(created.json?.id).toBeTruthy();
      report.data.customerId = created.json.id;

      await page.goto(`/customers/${created.json.id}`, { waitUntil: "networkidle" });
      await expect(page).not.toHaveURL(/\/login/);
      await expect(page.getByText(RUN_ID, { exact: false }).first()).toBeVisible({ timeout: 20_000 });
      return created.json;
    });

    const pricingCandidate = await step("select active PBV2 product and calculate pricing", "blocking", async () => {
      const candidate = await findPricedPbv2Product(page, report);
      expect(candidate.calculation?.linePrice).toBeGreaterThan(0);
      report.data.productId = candidate.product.id;
      report.data.productName = candidate.product.name;
      report.data.linePrice = candidate.calculation.linePrice;
      report.data.optionSelections = candidate.selections;
      return candidate;
    });

    const quote = await step("create quote with PBV2-priced line item", "blocking", async () => {
      expect(customer?.id).toBeTruthy();
      expect(pricingCandidate?.product?.id).toBeTruthy();

      const linePrice = Number(pricingCandidate!.calculation.linePrice);
      const quoteResponse = await apiJson(page, "/api/quotes", {
        method: "POST",
        data: {
          hasCustomerId: true,
          hasLineItems: true,
          customerId: customer!.id,
          customerName: customer!.companyName ?? RUN_ID,
          source: "internal",
          label: RUN_ID,
          jobLabel: RUN_ID,
          description: RUN_ID,
          shippingMethod: "pickup",
          shippingMode: "single_shipment",
          billToName: "Workflow Browser",
          billToCompany: RUN_ID,
          billToAddress1: "123 Workflow Test Way",
          billToCity: "Raleigh",
          billToState: "NC",
          billToPostalCode: "27601",
          billToCountry: "US",
          billToPhone: "555-0100",
          billToEmail: `billing-${SAFE_RUN_ID}@example.test`,
          shipToName: "Workflow Browser",
          shipToCompany: RUN_ID,
          shipToAddress1: "123 Workflow Test Way",
          shipToCity: "Raleigh",
          shipToState: "NC",
          shipToPostalCode: "27601",
          shipToCountry: "US",
          shipToPhone: "555-0100",
          shipToEmail: `shipping-${SAFE_RUN_ID}@example.test`,
          priority: "normal",
          requestedDueDate: futureDate(10),
          lineItems: [
            {
              productId: pricingCandidate!.product.id,
              productName: pricingCandidate!.product.name,
              variantId: null,
              description: `${pricingCandidate!.product.name} - ${RUN_ID}`,
              productType: pricingCandidate!.product.productTypeId || "wide_roll",
              width: "24.00",
              height: "36.00",
              quantity: 2,
              unitPrice: (linePrice / 2).toFixed(2),
              linePrice: linePrice.toFixed(2),
              totalPrice: linePrice.toFixed(2),
              selectedOptions: [],
              optionSelectionsJson: {
                schemaVersion: 2,
                selected: pricingCandidate!.selections,
              },
              pbv2TreeVersionId: pricingCandidate!.calculation.pbv2TreeVersionId,
              pbv2SnapshotJson: pricingCandidate!.calculation.pbv2SnapshotJson,
            },
          ],
          subtotal: linePrice,
          taxRate: 0,
          taxAmount: 0,
          total: linePrice,
        },
      });

      expect(quoteResponse.status, quoteResponse.text).toBe(200);
      const createdQuote = quoteResponse.json?.data ?? quoteResponse.json;
      expect(createdQuote?.id).toBeTruthy();
      expect(createdQuote?.quoteNumber).toBeTruthy();
      report.data.quoteId = createdQuote.id;
      report.data.quoteNumber = createdQuote.quoteNumber;

      await page.goto(`/quotes/${createdQuote.id}`, { waitUntil: "networkidle" });
      await expect(page).not.toHaveURL(/\/login/);
      await expect(page.getByText(new RegExp(`Quote #${createdQuote.quoteNumber}`))).toBeVisible({ timeout: 20_000 });
      await expect(page.getByText(pricingCandidate!.product.name, { exact: false }).first()).toBeVisible({ timeout: 20_000 });
      return createdQuote;
    });

    await step("verify saved quote has no orphan temp/draft line item symptoms", "blocking", async () => {
      expect(quote?.id).toBeTruthy();
      const fetched = await apiJson(page, `/api/quotes/${quote!.id}`);
      expect(fetched.status, fetched.text).toBe(200);
      const lineItems = fetched.json?.lineItems ?? fetched.json?.data?.lineItems ?? [];
      expect(Array.isArray(lineItems)).toBe(true);
      expect(lineItems.length).toBeGreaterThan(0);
      expect(lineItems.some((item: any) => item?.isTemporary === true || item?.quoteId == null)).toBe(false);
      expect(Number(fetched.json?.totalPrice ?? fetched.json?.total ?? 0)).toBeGreaterThan(0);
    });

    const order = await step("convert quote to order through UI", "blocking", async () => {
      expect(quote?.id).toBeTruthy();
      await page.goto(`/quotes/${quote!.id}`, { waitUntil: "networkidle" });
      await expect(page.getByRole("button", { name: /^Convert to Order$/ })).toBeVisible({ timeout: 20_000 });
      await page.getByRole("button", { name: /^Convert to Order$/ }).click();

      const dialog = page.getByRole("dialog").filter({ has: page.getByText("Convert Quote to Order", { exact: true }) });
      await expect(dialog).toBeVisible({ timeout: 10_000 });
      const orderDueDate = futureDate(10);
      await fillDateInput(dialog, "dueDate", orderDueDate);
      await fillDateInput(dialog, "promisedDate", orderDueDate);
      report.data.orderDueDate = orderDueDate;

      const convertResponse = page.waitForResponse(
        (response) =>
          response.url().includes(`/api/quotes/${quote!.id}/convert-to-order`) &&
          response.request().method() === "POST",
        { timeout: 30_000 },
      );
      await dialog.getByRole("button", { name: /^Create Order$/ }).click();
      const response = await convertResponse;
      expect(response.ok(), `Convert returned HTTP ${response.status()}`).toBe(true);
      await page.waitForURL(/\/orders\/[^/?#]+/, { timeout: 30_000 });

      const body = await response.json();
      const createdOrder = body?.data?.order;
      expect(createdOrder?.id).toBeTruthy();
      expect(createdOrder?.orderNumber).toBeTruthy();
      report.data.orderId = createdOrder.id;
      report.data.orderNumber = createdOrder.orderNumber;
      return createdOrder;
    });

    await step("verify quote/order identity and source quote reference", "blocking", async () => {
      expect(quote?.id).toBeTruthy();
      expect(order?.id).toBeTruthy();
      const refreshedQuote = await apiJson(page, `/api/quotes/${quote!.id}`);
      const refreshedOrder = await apiJson(page, `/api/orders/${order!.id}`);
      expect(refreshedQuote.status, refreshedQuote.text).toBe(200);
      expect(refreshedOrder.status, refreshedOrder.text).toBe(200);

      const quoteNumber = String(refreshedQuote.json?.quoteNumber ?? "");
      const orderNumber = String(refreshedOrder.json?.orderNumber ?? "");
      expect(quoteNumber).toBeTruthy();
      expect(orderNumber).toBeTruthy();
      expect(refreshedQuote.json?.convertedToOrderId).toBe(order!.id);
      expect(refreshedOrder.json?.quoteId).toBe(quote!.id);
      expect(String(refreshedOrder.json?.sourceQuoteNumber ?? "")).toBe(quoteNumber);
      expect(orderNumber, "Order number should be a distinct order identifier, not the quote number").not.toBe(quoteNumber);
      report.data.orderSnapshotAfterConversion = pickOrderWorkflowSnapshot(refreshedOrder.json);
    });

    await step("dashboard/order list shows created order", "non-blocking", async () => {
      expect(order?.orderNumber).toBeTruthy();
      await page.goto("/orders", { waitUntil: "networkidle" });
      await expect(page).not.toHaveURL(/\/login/);
      await expect(page.getByText(String(order!.orderNumber), { exact: false }).first()).toBeVisible({ timeout: 20_000 });
    });

    await step("invoice cannot be created for invalid order", "blocking", async () => {
      const invalidInvoice = await apiJson(page, "/api/orders/not-a-real-order-id/invoices", {
        method: "POST",
        data: { terms: "due_on_receipt" },
      });
      expect(invalidInvoice.ok).toBe(false);
      expect(invalidInvoice.status).toBeGreaterThanOrEqual(400);
    });

    await step("transition order into production and auto-create production job", "blocking", async () => {
      expect(order?.id).toBeTruthy();
      const beforeTransition = await apiJson(page, `/api/orders/${order!.id}`);
      report.data.orderSnapshotBeforeProductionTransition = pickOrderWorkflowSnapshot(beforeTransition.json);
      const transition = await apiJson(page, `/api/orders/${order!.id}/transition`, {
        method: "POST",
        data: { toStatus: "in_production", reason: RUN_ID },
      });
      expect(transition.status, transition.text).toBe(200);

      const productionOrder = await apiJson(page, `/api/orders/${order!.id}`);
      expect(productionOrder.status, productionOrder.text).toBe(200);
      expect(productionOrder.json?.status).toBe("in_production");

      const jobs = await pollForProductionJobs(page, order!.id);
      expect(jobs.length, "Expected at least one production job linked to the order").toBeGreaterThan(0);
      expect(jobs.every((job: any) => job.orderId === order!.id || job.order?.id === order!.id)).toBe(true);
      report.data.productionJobIds = jobs.map((job: any) => job.id);
    });

    const productionJob = await step("move production job queued to in production to completed", "blocking", async () => {
      const job = await resolvePrintableProductionJob(page, order!.id, report);
      const completedProductionJob = await startAndCompleteProductionJob(page, job);

      const fulfillmentJob = await pollForOrderJob(
        page,
        order!.id,
        (entry) =>
          isFulfillmentJob(entry) &&
          getLineItemId(entry) === getLineItemId(completedProductionJob) &&
          String(entry.status || "").toLowerCase() !== "done",
        "fulfillment job after production completion",
      );
      await startAndCompleteProductionJob(page, fulfillmentJob);

      await page.goto(`/production/jobs/${completedProductionJob.id}`, { waitUntil: "networkidle" });
      await expect(page).not.toHaveURL(/\/login/);
      await expect(page.getByText(String(order!.orderNumber), { exact: false }).first()).toBeVisible({ timeout: 20_000 });
      return completedProductionJob;
    });

    await step("production ticket and order traveler render without crashing", "blocking", async () => {
      expect(productionJob?.id).toBeTruthy();
      await page.goto(`/production/jobs/${productionJob!.id}/ticket`, { waitUntil: "networkidle" });
      await expect(page.getByText(/Failed to load production job ticket/i)).toHaveCount(0);
      await expect(page.locator("#ticket-print-area")).toBeVisible({ timeout: 20_000 });

      await page.goto(`/orders/${order!.id}/traveler`, { waitUntil: "networkidle" });
      await expect(page.getByText(/Failed to load order traveler/i)).toHaveCount(0);
      await expect(page.locator("#ticket-print-area")).toBeVisible({ timeout: 20_000 });
    });

    await step("complete production state and verify fulfillment gate opens", "blocking", async () => {
      expect(order?.id).toBeTruthy();
      const beforeFulfillment = await apiJson(page, `/api/orders/${order!.id}`);
      report.data.orderSnapshotBeforeFulfillment = pickOrderWorkflowSnapshot(beforeFulfillment.json);

      const prematurePickup = await apiJson(page, `/api/fulfillment/pickup/${order!.id}`, { method: "POST" });
      if (prematurePickup.ok) {
        report.issues.push({
          step: "fulfillment pre-completion gate",
          severity: "non-blocking",
          url: page.url(),
          message: "Pickup draft could be created before order production_complete. Ready transition should still remain gated.",
          visibleErrors: [],
        });
        const ticketId = prematurePickup.json?.data?.id;
        if (ticketId) {
          const blockedReady = await apiJson(page, `/api/fulfillment/pickup/${ticketId}/ready`, {
            method: "POST",
            data: { stagingLocation: "Workflow Test" },
          });
          expect(blockedReady.ok, "Pickup ready should be blocked before production completion").toBe(false);
        }
      }

      const completeProduction = await apiJson(page, `/api/orders/${order!.id}/complete-production`, {
        method: "POST",
        data: { autoMarkRemainingDone: true },
      });
      expect(completeProduction.status, completeProduction.text).toBe(200);
      expect(completeProduction.json?.data?.state).toBe("production_complete");

      const pickup = await apiJson(page, `/api/fulfillment/pickup/${order!.id}`, { method: "POST" });
      expect(pickup.status, pickup.text).toBe(200);
      const ticketId = pickup.json?.data?.id;
      expect(ticketId).toBeTruthy();

      const ready = await apiJson(page, `/api/fulfillment/pickup/${ticketId}/ready`, {
        method: "POST",
        data: {
          stagingLocation: "Workflow Browser Test Shelf",
          pickupNotes: RUN_ID,
          contactName: "Workflow Browser",
        },
      });
      expect(ready.status, ready.text).toBe(200);
      expect(ready.json?.data?.ticket?.status).toBe("READY_FOR_PICKUP");

      report.data.pickupTicketId = ticketId;
    });

    const invoice = await step("billing readiness and invoice creation after production complete", "blocking", async () => {
      expect(order?.id).toBeTruthy();
      const visibility = await apiJson(page, `/api/orders/${order!.id}/design-billing-visibility`);
      expect(visibility.status, visibility.text).toBe(200);
      report.data.billingVisibility = visibility.json;

      const createdInvoice = await apiJson(page, `/api/orders/${order!.id}/invoices`, {
        method: "POST",
        data: { terms: "due_on_receipt" },
      });
      expect(createdInvoice.status, createdInvoice.text).toBe(200);
      expect(createdInvoice.json?.success).toBe(true);
      expect(createdInvoice.json?.data?.id).toBeTruthy();
      expect(createdInvoice.json?.data?.orderId).toBe(order!.id);
      report.data.invoiceId = createdInvoice.json.data.id;
      report.data.invoiceNumber = createdInvoice.json.data.invoiceNumber;
      return createdInvoice.json.data;
    });

    await step("invoice billing trigger succeeds or fails with actionable gate", "non-blocking", async () => {
      expect(invoice?.id).toBeTruthy();
      const bill = await apiJson(page, `/api/invoices/${invoice!.id}/bill`, { method: "POST" });
      if (!bill.ok) {
        throw new Error(`Billing trigger failed HTTP ${bill.status}: ${bill.text}`);
      }
      expect(bill.json?.success).toBe(true);
    });

    await step("dashboard/order list status badge reflects final state", "non-blocking", async () => {
      expect(order?.orderNumber).toBeTruthy();
      await page.goto("/orders", { waitUntil: "networkidle" });
      const orderNumber = String(order!.orderNumber);
      const orderRowText = page.getByText(orderNumber, { exact: false }).first();
      if (!(await orderRowText.isVisible().catch(() => false))) {
        const prodCompleteTab = page.getByRole("tab", { name: /Prod Complete/i });
        if (await prodCompleteTab.isVisible().catch(() => false)) {
          await prodCompleteTab.click();
        }
      }
      await expect(page.getByText(orderNumber, { exact: false }).first()).toBeVisible({ timeout: 20_000 });
      await page.goto("/dashboard", { waitUntil: "networkidle" });
      await expect(page).not.toHaveURL(/\/login/);
      await expect(page.getByText(/dashboard/i).first()).toBeVisible({ timeout: 20_000 });
    });

    await writeReport(report, testInfo);

    const blockingIssues = report.issues.filter((issue) => issue.severity === "blocking");
    expect(blockingIssues, blockingIssues.map(formatIssue).join("\n\n")).toHaveLength(0);
  });
});

function installBrowserMonitors(page: Page, report: WorkflowReport) {
  page.on("console", (message) => {
    if (message.type() === "error") {
      report.consoleErrors.push(`${message.location().url || page.url()} :: ${message.text()}`);
    }
  });

  page.on("requestfailed", (request) => {
    report.networkFailures.push(`${request.method()} ${request.url()} :: ${request.failure()?.errorText || "request failed"}`);
  });

  page.on("response", (response) => {
    const url = response.url();
    if (url.includes("/api/") && response.status() >= 500) {
      report.networkFailures.push(`${response.status()} ${response.request().method()} ${url}`);
    }
  });
}

async function apiJson<T = any>(
  page: Page,
  path: string,
  options: { method?: string; data?: unknown } = {},
): Promise<ApiResult<T>> {
  const response: APIResponse = await page.request.fetch(path, {
    method: options.method ?? "GET",
    data: options.data,
    headers: options.data === undefined ? undefined : { "Content-Type": "application/json" },
  });
  const text = await response.text();
  let json: T | null = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { ok: response.ok(), status: response.status(), json, text };
}

async function apiMultipart<T = any>(
  page: Page,
  path: string,
  multipart: Record<string, string | { name: string; mimeType: string; buffer: Buffer }>,
): Promise<ApiResult<T>> {
  const response = await page.request.post(path, { multipart });
  const text = await response.text();
  let json: T | null = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { ok: response.ok(), status: response.status(), json, text };
}

async function fillDateInput(dialog: Locator, id: string, value: string) {
  const byId = dialog.locator(`#${id}`);
  if ((await byId.count()) > 0) {
    await byId.first().fill(value);
    return;
  }

  const dateInputs = dialog.locator('input[type="date"]');
  const index = id === "promisedDate" ? 1 : 0;
  if ((await dateInputs.count()) > index) {
    await dateInputs.nth(index).fill(value);
    return;
  }

  throw new Error(`Convert quote dialog did not expose a ${id} date input`);
}

async function findPricedPbv2Product(page: Page, report: WorkflowReport): Promise<Pbv2PricingCandidate> {
  const productsResponse = await apiJson<any[]>(page, "/api/products?activeOnly=true");
  expect(productsResponse.status, productsResponse.text).toBe(200);
  const products = Array.isArray(productsResponse.json) ? productsResponse.json : [];
  expect(products.length).toBeGreaterThan(0);

  const attempts: string[] = [];
  for (const product of products) {
    if (!product?.id) continue;
    try {
      const treeResponse = await apiJson(page, `/api/products/${product.id}/pbv2/tree`);
      if (treeResponse.status !== 200) {
        attempts.push(`${product.name}: tree HTTP ${treeResponse.status}`);
        continue;
      }

      const treeJson = unwrapTreeJson(treeResponse.json);
      if (!treeJson?.nodes || Object.keys(treeJson.nodes).length === 0) {
        attempts.push(`${product.name}: missing PBV2 tree nodes`);
        continue;
      }

      const selections = buildPbv2SelectionsFromTree(treeJson);
      const calculation = await apiJson(page, "/api/quotes/calculate", {
        method: "POST",
        data: {
          productId: product.id,
          width: 24,
          height: 36,
          quantity: 2,
          optionSelectionsJson: selections,
          debugSource: "az-shop-workflow-dev",
        },
      });

      if (calculation.status === 200 && calculation.json?.success && Number(calculation.json.linePrice) > 0) {
        if (attempts.length > 0) report.data.pricingCandidateAttempts = attempts;
        return {
          product,
          treeJson,
          selections,
          calculation: calculation.json,
        };
      }

      attempts.push(`${product.name}: calculate HTTP ${calculation.status} ${calculation.text.slice(0, 180)}`);
    } catch (error: any) {
      attempts.push(`${product?.name || product?.id}: ${error?.message || String(error)}`);
    }
  }

  throw new Error(`No active PBV2 product could be priced. Attempts: ${attempts.join(" | ")}`);
}

function unwrapTreeJson(value: any): any {
  return (
    value?.treeJson ??
    value?.data?.active?.treeJson ??
    value?.data?.draft?.treeJson ??
    value?.data?.treeJson ??
    value?.data?.tree ??
    value?.data ??
    value
  );
}

function buildPbv2SelectionsFromTree(treeJson: any): Record<string, unknown> {
  const nodes = treeJson?.nodes && typeof treeJson.nodes === "object" ? treeJson.nodes : {};
  const knownSelectionKeys = new Set<string>();
  const inputNodes: any[] = [];
  for (const node of Object.values(nodes) as any[]) {
    const selectionKey = getSelectionKey(node);
    if (!selectionKey) continue;
    knownSelectionKeys.add(selectionKey);
    if (String(node?.type || "").toUpperCase() === "INPUT") inputNodes.push(node);
  }

  const selected: Record<string, unknown> = {};
  collectMatrixSelections(treeJson?.meta?.pricingMatrix ?? treeJson?.pricingMatrix, knownSelectionKeys, selected);

  const matrixDimensions = Array.isArray(treeJson?.meta?.pricingMatrix?.dimensions)
    ? treeJson.meta.pricingMatrix.dimensions
    : Array.isArray(treeJson?.pricingMatrix?.dimensions)
      ? treeJson.pricingMatrix.dimensions
      : [];

  for (const node of inputNodes) {
    const selectionKey = getSelectionKey(node);
    if (!selectionKey || Object.prototype.hasOwnProperty.call(selected, selectionKey)) continue;
    const isRequired = node?.input?.required === true || matrixDimensions.includes(selectionKey);
    const defaultValue = node?.input?.defaultValue ?? node?.defaultValue;
    if (defaultValue !== undefined && defaultValue !== null && defaultValue !== "") {
      selected[selectionKey] = defaultValue;
      continue;
    }
    const inputType = String(node?.input?.type ?? node?.input?.valueType ?? "").toLowerCase();
    if (inputType === "boolean" || inputType === "bool") {
      selected[selectionKey] = false;
      continue;
    }
    const choice = firstUsableChoice(node);
    if (choice !== undefined) {
      selected[selectionKey] = choice;
      continue;
    }
    if (isRequired && (inputType === "number" || inputType === "integer")) {
      selected[selectionKey] = 1;
    }
  }
  return selected;
}

function getSelectionKey(node: any): string | null {
  const key = node?.input?.selectionKey ?? node?.selectionKey ?? node?.key;
  return typeof key === "string" && key.trim() ? key.trim() : null;
}

function firstUsableChoice(node: any): unknown {
  const choices = Array.isArray(node?.choices)
    ? node.choices
    : Array.isArray(node?.input?.choices)
      ? node.input.choices
      : [];
  const preferred = choices.find((choice: any) => {
    const value = choice?.value ?? choice?.id ?? choice?.key;
    return value !== undefined && value !== null && value !== "" && value !== "__none__";
  }) ?? choices[0];
  return preferred ? preferred.value ?? preferred.id ?? preferred.key : undefined;
}

function collectMatrixSelections(value: any, knownSelectionKeys: Set<string>, selected: Record<string, unknown>) {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const entry of value) collectMatrixSelections(entry, knownSelectionKeys, selected);
    return;
  }

  if (typeof value.selectionKey === "string" && knownSelectionKeys.has(value.selectionKey) && "value" in value) {
    selected[value.selectionKey] = value.value;
  }
  if (typeof value.optionGroup === "string" && knownSelectionKeys.has(value.optionGroup) && "value" in value) {
    selected[value.optionGroup] = value.value;
  }

  for (const [key, child] of Object.entries(value)) {
    if (knownSelectionKeys.has(key) && isPrimitive(child)) {
      selected[key] = child;
      continue;
    }
    if (key === "rows" && Array.isArray(child) && child.length > 0) {
      collectMatrixSelections(child[0], knownSelectionKeys, selected);
      continue;
    }
    collectMatrixSelections(child, knownSelectionKeys, selected);
  }
}

function isPrimitive(value: unknown): boolean {
  return value === null || ["string", "number", "boolean"].includes(typeof value);
}

async function pollForProductionJobs(page: Page, orderId: string): Promise<any[]> {
  await expect
    .poll(
      async () => {
        const jobsResponse = await apiJson(page, "/api/production/jobs");
        const rows = extractRows(jobsResponse.json);
        return rows.filter((job: any) => job.orderId === orderId || job.order?.id === orderId).length;
      },
      { timeout: 45_000, intervals: [1_000, 2_000, 5_000] },
    )
    .toBeGreaterThan(0);

  const jobsResponse = await apiJson(page, "/api/production/jobs");
  return extractRows(jobsResponse.json).filter((job: any) => job.orderId === orderId || job.order?.id === orderId);
}

async function pollForOrderJob(
  page: Page,
  orderId: string,
  matcher: (job: any) => boolean,
  label: string,
  timeoutMs = 45_000,
): Promise<any> {
  const startedAt = Date.now();
  let lastJobs: any[] = [];

  while (Date.now() - startedAt < timeoutMs) {
    lastJobs = await pollForProductionJobs(page, orderId);
    const match = lastJobs.find(matcher);
    if (match) return match;
    await page.waitForTimeout(1_000);
  }

  throw new Error(
    `Timed out waiting for ${label}. Last jobs: ${JSON.stringify(lastJobs.map(summarizeProductionJob), null, 2)}`,
  );
}

async function resolvePrintableProductionJob(page: Page, orderId: string, report: WorkflowReport): Promise<any> {
  let targetLineItemId: string | null = null;

  for (let attempt = 0; attempt < 6; attempt += 1) {
    const jobs = await pollForProductionJobs(page, orderId);
    const activeJobs = jobs.filter((job: any) => {
      if (String(job.status || "").toLowerCase() === "done") return false;
      return !targetLineItemId || getLineItemId(job) === targetLineItemId;
    });

    const printableJob = activeJobs.find((job: any) => !isPrepressJob(job) && !isDesignJob(job) && !isFulfillmentJob(job));
    if (printableJob) return printableJob;

    const prepressJob = activeJobs.find(isPrepressJob);
    if (prepressJob) {
      targetLineItemId = getLineItemId(prepressJob);
      await advancePrepressToProduction(page, prepressJob, report);
      continue;
    }

    const designJob = activeJobs.find(isDesignJob);
    if (designJob) {
      targetLineItemId = getLineItemId(designJob);
      await advanceDesignToNextWorkflowState(page, designJob, report);
      continue;
    }

    if (activeJobs.some(isFulfillmentJob)) {
      throw new Error(
        `Line item reached fulfillment without a printable production station. Active jobs: ${JSON.stringify(activeJobs.map(summarizeProductionJob), null, 2)}`,
      );
    }

    await page.waitForTimeout(1_000);
  }

  const orderSnapshot = await apiJson(page, `/api/orders/${orderId}`);
  const finalJobs = await pollForProductionJobs(page, orderId);
  throw new Error(
    `Could not resolve a printable production job after design/prepress handoffs. Jobs: ${JSON.stringify(finalJobs.map(summarizeProductionJob), null, 2)} Order: ${JSON.stringify(summarizeOrderLineItems(orderSnapshot.json), null, 2)}`,
  );
}

async function advancePrepressToProduction(page: Page, job: any, report: WorkflowReport) {
  const lineItemId = getLineItemId(job);
  if (!lineItemId) throw new Error(`Prepress job ${job.id} is missing lineItemId`);

  const startSession = await apiJson(page, "/api/prepress/session/start", {
    method: "POST",
    data: { lineItemId },
  });
  expect(startSession.status, startSession.text).toBe(200);
  const sessionId = startSession.json?.data?.id;
  expect(sessionId, "Prepress session start did not return a session id").toBeTruthy();

  await ensureFinalPrepressFile(page, lineItemId, sessionId);

  const completeSession = await apiJson(page, `/api/prepress/session/${sessionId}/complete`, { method: "POST" });
  expect(completeSession.status, completeSession.text).toBe(200);

  const sendToPrint = await apiJson(page, `/api/prepress/line-item/${lineItemId}/send-to-print`, { method: "POST" });
  expect(sendToPrint.status, sendToPrint.text).toBe(200);
  report.data.prepressHandoff = {
    lineItemId,
    sessionId,
    productionJobId: sendToPrint.json?.productionJobId ?? sendToPrint.json?.data?.productionJobId,
  };
}

async function advanceDesignToNextWorkflowState(page: Page, job: any, report: WorkflowReport) {
  const lineItemId = getLineItemId(job);
  if (!lineItemId) throw new Error(`Design job ${job.id} is missing lineItemId`);

  const startDesign = await apiJson(page, `/api/design/line-item/${lineItemId}/start`, {
    method: "POST",
    data: { note: RUN_ID },
  });
  if (startDesign.status !== 200 && startDesign.status !== 409) {
    throw new Error(`POST /api/design/line-item/${lineItemId}/start failed HTTP ${startDesign.status}: ${startDesign.text}`);
  }

  const completeDesign = await apiJson(page, `/api/design/line-item/${lineItemId}/complete`, {
    method: "POST",
    data: { note: RUN_ID },
  });
  expect(completeDesign.status, completeDesign.text).toBe(200);
  report.data.designHandoff = completeDesign.json?.data ?? completeDesign.json;

  const nextState = String(completeDesign.json?.data?.toState ?? "").toLowerCase();
  if (nextState === "awaiting_proof_approval") {
    throw new Error("Design completed into awaiting_proof_approval; proof approval must be completed before production can continue.");
  }
}

async function ensureFinalPrepressFile(page: Page, lineItemId: string, sessionId: string) {
  const existing = await getLineItemFiles(page, lineItemId);
  if ((existing.finals?.length ?? 0) > 0) return;

  const upload = await apiMultipart(page, "/api/prepress/files/upload", {
    lineItemId,
    role: "final",
    tag: "workflow-browser-test",
    sessionId,
    file: {
      name: "workflow-browser-final.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from("%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n"),
    },
  });
  expect(upload.status, upload.text).toBe(200);

  await expect
    .poll(
      async () => {
        const files = await getLineItemFiles(page, lineItemId);
        return files.finals?.length ?? 0;
      },
      { timeout: 30_000, intervals: [750, 1_500, 3_000] },
    )
    .toBeGreaterThan(0);
}

async function getLineItemFiles(page: Page, lineItemId: string): Promise<{ finals: any[]; originals: any[]; references: any[] }> {
  const response = await apiJson(page, `/api/prepress/line-item/${lineItemId}/files`);
  expect(response.status, response.text).toBe(200);
  return response.json?.data ?? { finals: [], originals: [], references: [] };
}

async function startAndCompleteProductionJob(page: Page, job: any): Promise<any> {
  expect(job?.id).toBeTruthy();
  let current = job;

  if (String(current.status || "").toLowerCase() === "queued") {
    const start = await apiJson(page, `/api/production/jobs/${current.id}/start`, { method: "POST" });
    expect(start.status, start.text).toBe(200);
    current = { ...current, ...(start.json?.data ?? {}) };
    expect(String(current.status || "").toLowerCase()).toBe("in_progress");
  }

  if (String(current.status || "").toLowerCase() !== "done") {
    const complete = await apiJson(page, `/api/production/jobs/${current.id}/complete`, {
      method: "POST",
      data: {},
    });
    expect(complete.status, complete.text).toBe(200);
    current = { ...current, ...(complete.json?.data ?? {}) };
    expect(String(current.status || "").toLowerCase()).toBe("done");
  }

  return current;
}

function getLineItemId(job: any): string | null {
  const value = job?.lineItemId ?? job?.orderLineItemId ?? job?.lineItem?.id;
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizedStationKey(job: any): string {
  return String(job?.stationKey ?? job?.station?.key ?? "").trim().toLowerCase();
}

function normalizedStepKey(job: any): string {
  return String(job?.stepKey ?? job?.step?.key ?? "").trim().toLowerCase();
}

function isPrepressJob(job: any): boolean {
  return normalizedStationKey(job) === "prepress" || normalizedStepKey(job) === "prepress";
}

function isDesignJob(job: any): boolean {
  return normalizedStationKey(job) === "design" || normalizedStepKey(job) === "design";
}

function isFulfillmentJob(job: any): boolean {
  return normalizedStationKey(job) === "fulfillment" || normalizedStepKey(job) === "fulfillment";
}

function summarizeProductionJob(job: any) {
  return {
    id: job?.id,
    lineItemId: getLineItemId(job),
    stationKey: normalizedStationKey(job),
    stepKey: normalizedStepKey(job),
    status: job?.status,
    orderId: job?.orderId ?? job?.order?.id,
  };
}

function summarizeOrderLineItems(orderJson: any) {
  const lineItems = orderJson?.lineItems ?? orderJson?.data?.lineItems ?? [];
  return Array.isArray(lineItems)
    ? lineItems.map((item: any) => ({
        id: item?.id,
        status: item?.status,
        workflowState: item?.workflowState,
        requiresDesign: item?.requiresDesign,
        requiresProofApproval: item?.requiresProofApproval,
        requiresPrepress: item?.requiresPrepress,
      }))
    : [];
}

function pickOrderWorkflowSnapshot(orderJson: any) {
  const order = orderJson?.data ?? orderJson ?? {};
  return {
    id: order.id,
    orderNumber: order.orderNumber,
    state: order.state,
    status: order.status,
    billToName: order.billToName ?? null,
    billToCompany: order.billToCompany ?? null,
    shippingMethod: order.shippingMethod ?? null,
    shippingMode: order.shippingMode ?? null,
    quoteId: order.quoteId ?? null,
    sourceQuoteNumber: order.sourceQuoteNumber ?? null,
    lineItems: summarizeOrderLineItems(order),
  };
}

function extractRows(value: any): any[] {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.data)) return value.data;
  if (Array.isArray(value?.data?.rows)) return value.data.rows;
  if (Array.isArray(value?.items)) return value.items;
  return [];
}

async function collectVisibleErrors(page: Page): Promise<string[]> {
  const texts: string[] = [];
  const candidates = [
    page.getByRole("alert"),
    page.locator("[data-sonner-toast]"),
    page.locator(".text-destructive"),
  ];

  for (const locator of candidates) {
    const count = Math.min(await locator.count().catch(() => 0), 5);
    for (let i = 0; i < count; i += 1) {
      const text = (await locator.nth(i).innerText().catch(() => "")).trim();
      if (text) texts.push(text.replace(/\s+/g, " "));
    }
  }
  return Array.from(new Set(texts)).slice(0, 10);
}

async function captureIssueScreenshot(page: Page, testInfo: TestInfo, name: string): Promise<string | undefined> {
  try {
    const fileName = `${name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}.png`;
    const path = testInfo.outputPath(fileName);
    await page.screenshot({ path, fullPage: true });
    return path;
  } catch {
    return undefined;
  }
}

async function writeReport(report: WorkflowReport, testInfo: TestInfo) {
  const reportPath = testInfo.outputPath("az-shop-workflow-report.json");
  await fs.writeFile(reportPath, JSON.stringify(report, null, 2), "utf8");
  await testInfo.attach("az-shop-workflow-report", {
    path: reportPath,
    contentType: "application/json",
  });
}

function formatIssue(issue: WorkflowIssue): string {
  return `[${issue.severity}] ${issue.step}\nURL: ${issue.url}\n${issue.message}\nVisible errors: ${issue.visibleErrors.join(" | ") || "none"}`;
}

function futureDate(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}
