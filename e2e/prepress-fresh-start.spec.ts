import { expect, Page, test } from "@playwright/test";
import { Client } from "pg";

type ApiEnvelope<T> = {
  success?: boolean;
  data?: T;
  error?: string;
  message?: string;
};

type PrepressQueueItem = {
  jobNumber: string;
  lineItemId: string;
  customerName?: string;
  productName?: string;
  status: string;
  prepressStage?: "pending_prepress" | "in_prepress" | "prepress_complete";
  sessionId: string | null;
  sessionStartedAt?: string | null;
  isActivelyOwnedByPrepress?: boolean;
  hasDownstreamActiveJob?: boolean;
};

type PendingFixtureRow = {
  line_item_id: string;
  order_number: string;
  status: string;
};

const ORG_ID = "org_titan_001";

test.describe.serial("prepress fresh start validation", () => {
  test("pending_prepress UI start path transitions cleanly to in_prepress", async ({ page }) => {
    test.setTimeout(180_000);
    await ensureAuthenticated(page);

    const pendingFixture = await provisionPendingPrepressFixture(page);

    await page.goto("/production/prepress", { waitUntil: "networkidle" });
    await expect(page).not.toHaveURL(/\/login/);

    await selectPrepressCard(page, pendingFixture);

    const startButton = page.getByRole("button", { name: /^Start Prepress$/ });
    await expect(startButton).toBeEnabled();
    await expect(page.locator("main h2")).toContainText(pendingFixture.jobNumber);

    const startResponsePromise = page.waitForResponse(
      (response) => response.url().includes("/api/prepress/session/start") && response.request().method() === "POST",
      { timeout: 20_000 },
    );

    await startButton.click();
    const startResponse = await startResponsePromise;
    expect(startResponse.ok(), `Start Prepress returned HTTP ${startResponse.status()}`).toBe(true);

    const startedItem = await pollForPrepressQueueItem(page, pendingFixture.lineItemId, {
      matcher: (item) =>
        item.prepressStage === "in_prepress" &&
        item.isActivelyOwnedByPrepress === true &&
        !!item.sessionId &&
        !!item.sessionStartedAt,
    });

    await expect(page.locator("main h2")).toContainText(startedItem.jobNumber);
    await expect(page.locator("main header").getByText("In Prepress", { exact: true })).toBeVisible();
    await expect(page.getByText(/^Timer:/)).toBeVisible();
    await expect(startButton).toBeDisabled();

    const activeSessionCountAfterStart = await getActiveSessionCount(startedItem.lineItemId);
    expect(activeSessionCountAfterStart).toBe(1);

    await page.reload({ waitUntil: "networkidle" });
    await selectPrepressCard(page, startedItem);
    await expect(page.locator("main h2")).toContainText(startedItem.jobNumber);
    await expect(page.locator("main header").getByText("In Prepress", { exact: true })).toBeVisible();
    await expect(page.getByText(/^Timer:/)).toBeVisible();
    await expect(page.getByText(/ago$/)).toBeVisible();
    await expect(startButton).toBeDisabled();

    const idempotentStartResponse = await postJson<{ id: string }>(page, "/api/prepress/session/start", {
      lineItemId: startedItem.lineItemId,
    });
    expect(idempotentStartResponse.status).toBe(200);
    expect(idempotentStartResponse.body?.data?.id).toBe(startedItem.sessionId);

    const activeSessionCountAfterRepeat = await getActiveSessionCount(startedItem.lineItemId);
    expect(activeSessionCountAfterRepeat).toBe(1);

    await page.waitForTimeout(16_000);
    await expect(page.locator("main h2")).toContainText(startedItem.jobNumber);
    await expect(page.locator("main header").getByText("In Prepress", { exact: true })).toBeVisible();
    await expect(page.getByText(/^Timer:/)).toBeVisible();
  });
});

async function ensureAuthenticated(page: Page) {
  await page.goto("/dashboard", { waitUntil: "networkidle" });
  await expect(page).not.toHaveURL(/\/login/);
}

async function provisionPendingPrepressFixture(page: Page): Promise<PrepressQueueItem> {
  const candidates = await getPendingFixtureCandidates();
  expect(candidates.length).toBeGreaterThan(0);

  for (const candidate of candidates) {
    const intakeResponse = await fetchJson(page, `/api/production/intake/from-line-item/${candidate.line_item_id}`, {
      method: "POST",
    });

    if (intakeResponse.status !== 200) {
      continue;
    }

    try {
      const queueItem = await pollForPrepressQueueItem(page, candidate.line_item_id, {
        matcher: (item) =>
          item.prepressStage === "pending_prepress" &&
          item.isActivelyOwnedByPrepress === true &&
          !item.sessionId &&
          !item.hasDownstreamActiveJob,
        timeoutMs: 20_000,
      });
      return queueItem;
    } catch {
      // Try the next candidate.
    }
  }

  throw new Error("Failed to provision a real pending_prepress fixture with no active session.");
}

async function getPendingFixtureCandidates(): Promise<PendingFixtureRow[]> {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  try {
    const result = await client.query<PendingFixtureRow>(`
      select oli.id as line_item_id,
             o.order_number,
             oli.status
      from order_line_items oli
      join orders o on o.id = oli.order_id
      left join production_jobs pj
        on pj.line_item_id = oli.id
       and pj.organization_id = o.organization_id
       and pj.status not in ('done', 'void')
      left join prepress_sessions ps
        on ps.line_item_id = oli.id
       and ps.organization_id = o.organization_id
       and ps.status = 'active'
      where o.organization_id = $1
        and coalesce(oli.requires_prepress, false) = true
        and coalesce(o.status, '') not in ('completed', 'canceled')
        and coalesce(o.state, '') not in ('closed', 'canceled', 'production_complete')
        and coalesce(oli.status, '') in ('new', '')
        and pj.id is null
        and ps.id is null
      order by o.order_number desc, oli.created_at desc
      limit 25
    `, [ORG_ID]);

    return result.rows;
  } finally {
    await client.end();
  }
}

async function getActiveSessionCount(lineItemId: string): Promise<number> {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  try {
    const result = await client.query<{ count: string }>(`
      select count(*)::int as count
      from prepress_sessions
      where organization_id = $1
        and line_item_id = $2
        and status = 'active'
    `, [ORG_ID, lineItemId]);

    return Number(result.rows[0]?.count ?? 0);
  } finally {
    await client.end();
  }
}

async function selectPrepressCard(page: Page, item: Pick<PrepressQueueItem, "jobNumber" | "productName">) {
  const card = prepressCardLocator(page, item).first();
  await expect(card).toBeVisible({ timeout: 20_000 });
  await card.click();
  await expect(page.locator("main h2")).toContainText(item.jobNumber);
}

function prepressCardLocator(page: Page, item: Pick<PrepressQueueItem, "jobNumber" | "productName">) {
  const baseCards = page.locator("aside div.cursor-pointer");
  const withOrderNumber = baseCards.filter({ has: page.getByText(item.jobNumber, { exact: true }) });
  return item.productName
    ? withOrderNumber.filter({ has: page.getByText(item.productName, { exact: true }) })
    : withOrderNumber;
}

async function fetchJson<T>(
  page: Page,
  path: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string },
): Promise<{ status: number; body: ApiEnvelope<T> | null }> {
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
  }, { requestPath: path, requestInit: init }) as Promise<{ status: number; body: ApiEnvelope<T> | null }>;
}

async function postJson<T>(page: Page, path: string, payload: unknown) {
  return fetchJson<T>(page, path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

async function getPrepressQueue(page: Page): Promise<PrepressQueueItem[]> {
  const response = await fetchJson<PrepressQueueItem[]>(page, "/api/prepress/queue");
  if (response.status !== 200) {
    throw new Error(`GET /api/prepress/queue failed with HTTP ${response.status}`);
  }
  return response.body?.data ?? [];
}

async function pollForPrepressQueueItem(
  page: Page,
  lineItemId: string,
  options?: {
    timeoutMs?: number;
    matcher?: (item: PrepressQueueItem) => boolean;
  },
): Promise<PrepressQueueItem> {
  const timeoutMs = options?.timeoutMs ?? 30_000;
  const startedAt = Date.now();
  let lastQueue: PrepressQueueItem[] = [];

  while (Date.now() - startedAt < timeoutMs) {
    lastQueue = await getPrepressQueue(page);
    const item = lastQueue.find((entry) => entry.lineItemId === lineItemId) ?? null;
    if (item && (!options?.matcher || options.matcher(item))) {
      return item;
    }
    await page.waitForTimeout(750);
  }

  throw new Error(
    `Timed out waiting for prepress queue item ${lineItemId}. Last queue snapshot: ${JSON.stringify(lastQueue, null, 2)}`,
  );
}
