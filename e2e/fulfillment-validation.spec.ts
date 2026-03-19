import { expect, Page, test } from "@playwright/test";

type ApiResult<T> = {
  status: number;
  body: T | null;
};

type OrderListResponse = {
  items?: OrderSummary[];
  total?: number;
};

type OrderSummary = {
  id: string;
  orderNumber: string | number;
};

type OrderLineItem = {
  id: string;
  quantity?: number | string | null;
  status?: string | null;
};

type OrderDetails = {
  id: string;
  orderNumber: string | number;
  state?: string | null;
  status?: string | null;
  routingTarget?: string | null;
  shippingMethod?: string | null;
  fulfillmentStatus?: string | null;
  lineItems?: OrderLineItem[];
};

type ShipmentListItem = {
  id: string;
  status: string;
  updatedAt?: string;
};

type QueueResponse = {
  success?: boolean;
  data?: {
    rows?: FulfillmentQueueRow[];
    total?: number;
  };
};

type FulfillmentQueueRow = {
  orderId: string;
  orderNumber: string;
  fulfillmentType: "SHIP" | "PICKUP";
  status: string;
  itemsRemaining: string;
  readySince: string | null;
  shipTo: string;
  overdue: boolean;
};

type ShipmentCreateResponse = {
  success?: boolean;
  data?: {
    shipmentId: string;
  };
};

type ShipmentPatchResponse = {
  success?: boolean;
  data?: {
    id: string;
    status: string;
    items?: Array<{
      orderLineItemId: string;
      quantity: number;
    }>;
  };
};

type PickupTicket = {
  id: string;
  orderId: string;
  status: "DRAFT" | "READY_FOR_PICKUP" | "PICKED_UP";
};

type PickupCreateResponse = {
  success?: boolean;
  data?: PickupTicket;
  message?: string;
  code?: string;
};

type PickupReadyResponse = {
  success?: boolean;
  data?: {
    ticket: PickupTicket;
    notification?: {
      id: string;
      status: string;
      errorMessage?: string;
    };
  };
  message?: string;
  code?: string;
};

const SHIP_ORDER_NUMBER = process.env.PLAYWRIGHT_FULFILLMENT_SHIP_ORDER_NUMBER;
const PICKUP_ORDER_NUMBER = process.env.PLAYWRIGHT_FULFILLMENT_PICKUP_ORDER_NUMBER;

test.describe("fulfillment validation", () => {
  test("ship order flow", async ({ page }) => {
    test.setTimeout(180_000);
    await ensureAuthenticated(page);

    const candidate = await findFulfillmentCandidate(page, "ship", SHIP_ORDER_NUMBER);

    await test.step("Verify the order is not queue-visible before production complete", async () => {
      const queueRows = await getFulfillmentQueue(page, {
        type: "ship",
        status: "all",
        showArchived: false,
        search: "",
      });
      expect(queueRows.find((row) => row.orderId === candidate.id)).toBeFalsy();

      await openFulfillmentQueueSearch(page);
      await expect(queueRowByOrderNumber(page, String(candidate.orderNumber))).toHaveCount(0);
    });

    await test.step("Complete production and confirm the order enters the fulfillment queue", async () => {
      await completeProduction(page, candidate.id);

      const completedOrder = await pollForOrder(page, candidate.id, (order) => {
        if (order.state !== "production_complete") return null;
        if (order.routingTarget !== "fulfillment") return null;
        return order;
      });

      expect(completedOrder.shippingMethod).not.toBe("pickup");

      const queueRow = await pollForQueueRow(page, {
        orderId: candidate.id,
        type: "ship",
        status: "all",
        showArchived: false,
        search: "",
      });

      expect(queueRow.fulfillmentType).toBe("SHIP");

      await openFulfillmentQueueSearch(page);
      await expect(queueRowByOrderNumber(page, String(candidate.orderNumber))).toBeVisible();
    });

    let shipmentId = "";

    await test.step("Open shipment detail, allocate all line items, and mark shipped", async () => {
      const queueRowButton = page.getByRole("button", { name: `#${String(candidate.orderNumber)}` }).first();
      await expect(queueRowButton).toBeVisible();
      await queueRowButton.click();

      await page.waitForURL(/\/fulfillment\/shipments\/[^/?]+/, { timeout: 20_000 });
      shipmentId = extractShipmentIdFromUrl(page.url());

      const liveOrder = await getOrder(page, candidate.id);
      const shipmentItems = buildShipmentItems(liveOrder);
      expect(shipmentItems.length).toBeGreaterThan(0);

      const patchResponse = await fetchJson<ShipmentPatchResponse>(page, `/api/fulfillment/shipments/${shipmentId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ shipmentItems }),
      });

      expect(patchResponse.status).toBe(200);
      expect(patchResponse.body?.data?.status).toBe("DRAFT");

      await page.reload({ waitUntil: "networkidle" });

      const markShippedButton = page.getByRole("button", { name: /MARK AS SHIPPED/i });
      await expect(markShippedButton).toBeEnabled();

      const markShippedResponsePromise = page.waitForResponse(
        (response) =>
          response.url().includes(`/api/fulfillment/shipments/${shipmentId}/mark-shipped`) &&
          response.request().method() === "POST",
        { timeout: 20_000 },
      );

      await markShippedButton.click();

      const markShippedResponse = await markShippedResponsePromise;
      expect(markShippedResponse.ok(), `Mark shipped returned HTTP ${markShippedResponse.status()}`).toBe(true);

      await expect(page.getByText(/^SHIPPED$/).first()).toBeVisible({ timeout: 20_000 });
    });

    await test.step("Verify shipment sync removes the order from active queue and archives it as shipped", async () => {
      const shippedOrder = await pollForOrder(page, candidate.id, (order) =>
        order.fulfillmentStatus === "shipped" ? order : null,
      );

      expect(shippedOrder.state).toBe("production_complete");

      const activeRows = await getFulfillmentQueue(page, {
        type: "ship",
        status: "all",
        showArchived: false,
        search: "",
      });
      expect(activeRows.find((row) => row.orderId === candidate.id)).toBeFalsy();

      const archivedRow = await pollForQueueRow(page, {
        orderId: candidate.id,
        type: "ship",
        status: "all",
        showArchived: true,
        search: "",
      });

      expect(archivedRow.status).toBe("SHIPPED");

      await openFulfillmentQueueSearch(page, true);
      await expect(queueRowByOrderNumber(page, String(candidate.orderNumber))).toBeVisible();
      await expect(page.getByText(/^SHIPPED$/).first()).toBeVisible();
    });
  });

  test("pickup order flow", async ({ page }) => {
    test.setTimeout(180_000);
    await ensureAuthenticated(page);

    const candidate = await findFulfillmentCandidate(page, "pickup", PICKUP_ORDER_NUMBER);

    await test.step("Create a draft pickup ticket and verify pickup-ready is blocked before production complete", async () => {
      const preQueueRows = await getFulfillmentQueue(page, {
        type: "pickup",
        status: "all",
        showArchived: false,
        search: "",
      });
      expect(preQueueRows.find((row) => row.orderId === candidate.id)).toBeFalsy();

      const createResponse = await fetchJson<PickupCreateResponse>(page, `/api/fulfillment/pickup/${candidate.id}`, {
        method: "POST",
      });

      expect(createResponse.status).toBe(200);
      expect(createResponse.body?.data?.status).toBe("DRAFT");

      const blockedReady = await fetchJson<PickupReadyResponse>(page, `/api/fulfillment/pickup/${createResponse.body?.data?.id}/ready`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          stagingLocation: "Front Desk",
          pickupNotes: "Playwright validation precheck",
        }),
      });

      expect(blockedReady.status).toBe(400);
      expect(blockedReady.body?.code).toBe("PRODUCTION_NOT_COMPLETE");
    });

    let ticketId = "";

    await test.step("Complete production and mark the pickup ticket ready", async () => {
      await completeProduction(page, candidate.id);

      const completedOrder = await pollForOrder(page, candidate.id, (order) => {
        if (order.state !== "production_complete") return null;
        if (order.routingTarget !== "invoicing") return null;
        return order;
      });

      expect(completedOrder.shippingMethod).toBe("pickup");

      const queueRow = await pollForQueueRow(page, {
        orderId: candidate.id,
        type: "pickup",
        status: "all",
        showArchived: false,
        search: "",
      });

      expect(queueRow.fulfillmentType).toBe("PICKUP");

      await openFulfillmentQueueSearch(page);
      await expect(queueRowByOrderNumber(page, String(candidate.orderNumber))).toBeVisible();

      const createResponse = await fetchJson<PickupCreateResponse>(page, `/api/fulfillment/pickup/${candidate.id}`, {
        method: "POST",
      });
      expect(createResponse.status).toBe(200);

      ticketId = String(createResponse.body?.data?.id || "");
      expect(ticketId).toBeTruthy();

      const readyResponse = await fetchJson<PickupReadyResponse>(page, `/api/fulfillment/pickup/${ticketId}/ready`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          stagingLocation: "Front Desk",
          pickupNotes: "Playwright fulfillment validation",
          contactName: "Playwright Pickup",
        }),
      });

      expect(readyResponse.status).toBe(200);
      expect(readyResponse.body?.data?.ticket.status).toBe("READY_FOR_PICKUP");

      const packedOrder = await pollForOrder(page, candidate.id, (order) =>
        order.fulfillmentStatus === "packed" ? order : null,
      );

      expect(packedOrder.routingTarget).toBe("invoicing");

      const readyQueueRow = await pollForQueueRow(page, {
        orderId: candidate.id,
        type: "pickup",
        status: "all",
        showArchived: false,
        search: "",
      });

      expect(readyQueueRow.status).toBe("READY_FOR_PICKUP");
    });

    await test.step("Mark the order picked up and verify archive behavior", async () => {
      const pickedUpResponse = await fetchJson<{ success?: boolean; data?: PickupTicket }>(page, `/api/fulfillment/pickup/${ticketId}/picked-up`, {
        method: "POST",
      });

      expect(pickedUpResponse.status).toBe(200);
      expect(pickedUpResponse.body?.data?.status).toBe("PICKED_UP");

      const deliveredOrder = await pollForOrder(page, candidate.id, (order) =>
        order.fulfillmentStatus === "delivered" ? order : null,
      );

      expect(deliveredOrder.state).toBe("production_complete");

      const activeRows = await getFulfillmentQueue(page, {
        type: "pickup",
        status: "all",
        showArchived: false,
        search: "",
      });
      expect(activeRows.find((row) => row.orderId === candidate.id)).toBeFalsy();

      const archivedRow = await pollForQueueRow(page, {
        orderId: candidate.id,
        type: "pickup",
        status: "all",
        showArchived: true,
        search: "",
      });

      expect(archivedRow.status).toBe("PICKED_UP");

      await openFulfillmentQueueSearch(page, true);
      await expect(queueRowByOrderNumber(page, String(candidate.orderNumber))).toBeVisible();
      await expect(page.getByText(/^PICKED_UP$/).first()).toBeVisible();
    });
  });
});

async function ensureAuthenticated(page: Page) {
  await page.goto("/dashboard", { waitUntil: "networkidle" });
  await expect(page).not.toHaveURL(/\/login/);
}

async function fetchJson<T>(
  page: Page,
  path: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string },
): Promise<ApiResult<T>> {
  return page.evaluate(async ({ requestPath, requestInit }) => {
    const response = await fetch(requestPath, {
      credentials: "include",
      method: requestInit?.method,
      headers: requestInit?.headers,
      body: requestInit?.body,
    });

    let body: unknown = null;
    try {
      body = await response.json();
    } catch {
      body = null;
    }

    return {
      status: response.status,
      body,
    };
  }, { requestPath: path, requestInit: init }) as Promise<ApiResult<T>>;
}

async function findFulfillmentCandidate(
  page: Page,
  kind: "ship" | "pickup",
  preferredOrderNumber?: string,
): Promise<OrderDetails> {
  for (let pageNumber = 1; pageNumber <= 5; pageNumber += 1) {
    const listResponse = await fetchJson<OrderListResponse>(page, `/api/orders?page=${pageNumber}&pageSize=200&sortDir=desc`);
    if (listResponse.status !== 200) {
      throw new Error(`GET /api/orders failed with HTTP ${listResponse.status}`);
    }

    const items = listResponse.body?.items ?? [];
    if (items.length === 0) break;

    const prioritized = preferredOrderNumber
      ? [
          ...items.filter((item) => String(item.orderNumber) === preferredOrderNumber),
          ...items.filter((item) => String(item.orderNumber) !== preferredOrderNumber),
        ]
      : items;

    for (const item of prioritized) {
      const order = await getOrder(page, item.id);
      if (kind === "ship") {
        if (order.state !== "open") continue;
        if (order.shippingMethod === "pickup") continue;
        if (buildShipmentItems(order).length === 0) continue;

        const shipments = await getOrderShipments(page, order.id);
        if (shipments.length > 0) continue;

        return order;
      }

      if (order.state !== "open") continue;
      if (order.shippingMethod !== "pickup") continue;
      if ((order.lineItems ?? []).length === 0) continue;
      return order;
    }
  }

  throw new Error(
    preferredOrderNumber
      ? `No ${kind} fulfillment candidate found for order #${preferredOrderNumber}.`
      : `No open ${kind} fulfillment candidate was found in the recent order set.`,
  );
}

async function getOrder(page: Page, orderId: string): Promise<OrderDetails> {
  const response = await fetchJson<OrderDetails>(page, `/api/orders/${orderId}`);
  if (response.status !== 200 || !response.body) {
    throw new Error(`GET /api/orders/${orderId} failed with HTTP ${response.status}`);
  }
  return response.body;
}

async function getOrderShipments(page: Page, orderId: string): Promise<ShipmentListItem[]> {
  const response = await fetchJson<{ success?: boolean; data?: ShipmentListItem[] }>(page, `/api/orders/${orderId}/shipments`);
  if (response.status !== 200) {
    throw new Error(`GET /api/orders/${orderId}/shipments failed with HTTP ${response.status}`);
  }
  return response.body?.data ?? [];
}

async function completeProduction(page: Page, orderId: string) {
  const response = await fetchJson<{ success?: boolean; code?: string; message?: string }>(page, `/api/orders/${orderId}/complete-production`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ autoMarkRemainingDone: true }),
  });

  if (response.status !== 200) {
    throw new Error(`POST /api/orders/${orderId}/complete-production failed with HTTP ${response.status} (${response.body?.code || response.body?.message || "unknown error"})`);
  }
}

async function getFulfillmentQueue(
  page: Page,
  filters: {
    type: "all" | "ship" | "pickup";
    status: string;
    showArchived: boolean;
    search: string;
  },
): Promise<FulfillmentQueueRow[]> {
  const params = new URLSearchParams();
  params.set("type", filters.type);
  params.set("status", filters.status);
  params.set("overdueOnly", "false");
  params.set("showArchived", String(filters.showArchived));
  params.set("search", filters.search);
  params.set("page", "1");
  params.set("pageSize", "200");

  const response = await fetchJson<QueueResponse>(page, `/api/fulfillment/queue?${params.toString()}`);
  if (response.status !== 200) {
    throw new Error(`GET /api/fulfillment/queue failed with HTTP ${response.status}`);
  }

  return response.body?.data?.rows ?? [];
}

async function pollForOrder(
  page: Page,
  orderId: string,
  predicate: (order: OrderDetails) => OrderDetails | null,
  timeoutMs = 60_000,
): Promise<OrderDetails> {
  const deadline = Date.now() + timeoutMs;
  let lastOrder: OrderDetails | null = null;

  while (Date.now() < deadline) {
    const order = await getOrder(page, orderId);
    lastOrder = order;
    const matched = predicate(order);
    if (matched) return matched;
    await page.waitForTimeout(2_000);
  }

  throw new Error(`Timed out waiting for order ${orderId}. Last snapshot: ${JSON.stringify(lastOrder)}`);
}

async function pollForQueueRow(
  page: Page,
  filters: {
    orderId: string;
    type: "all" | "ship" | "pickup";
    status: string;
    showArchived: boolean;
    search: string;
  },
  timeoutMs = 60_000,
): Promise<FulfillmentQueueRow> {
  const deadline = Date.now() + timeoutMs;
  let lastRows: FulfillmentQueueRow[] = [];

  while (Date.now() < deadline) {
    const rows = await getFulfillmentQueue(page, filters);
    lastRows = rows;
    const match = rows.find((row) => row.orderId === filters.orderId);
    if (match) return match;
    await page.waitForTimeout(2_000);
  }

  throw new Error(`Timed out waiting for fulfillment queue row ${filters.orderId}. Last rows: ${JSON.stringify(lastRows)}`);
}

function buildShipmentItems(order: OrderDetails) {
  return (order.lineItems ?? [])
    .filter((item) => item.status !== "canceled")
    .map((item) => ({
      orderId: order.id,
      orderLineItemId: item.id,
      quantity: Number(item.quantity || 0),
    }))
    .filter((item) => Number.isFinite(item.quantity) && item.quantity > 0);
}

async function openFulfillmentQueueSearch(page: Page, showArchived = false) {
  await page.goto("/fulfillment", { waitUntil: "networkidle" });

  const searchInput = page.getByPlaceholder("Search orders, customers, or tracking numbers...");
  await expect(searchInput).toBeVisible();
  await searchInput.fill("");

  const archivedToggle = page.locator("label").filter({ hasText: "Show Archived" }).locator("input[type='checkbox']");
  if (showArchived) {
    await archivedToggle.check();
  } else {
    await archivedToggle.uncheck();
  }

  await page.waitForTimeout(1_000);
}

function queueRowByOrderNumber(page: Page, orderNumber: string) {
  return page.locator("tbody tr").filter({
    has: page.getByRole("button", { name: `#${orderNumber}` }),
  }).first();
}

function extractShipmentIdFromUrl(url: string) {
  const match = url.match(/\/fulfillment\/shipments\/([^/?#]+)/);
  if (!match) {
    throw new Error(`Could not extract shipment id from URL: ${url}`);
  }
  return match[1];
}