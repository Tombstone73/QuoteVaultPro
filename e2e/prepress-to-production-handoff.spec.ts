import { expect, Page, test } from "@playwright/test";

type ApiEnvelope<T> = {
  success?: boolean;
  data?: T;
  error?: string;
  message?: string;
};

type PrepressQueueItem = {
  jobNumber: string;
  lineItemId: string;
  productName?: string;
  status: string;
  workflowState: "ready_for_prepress" | "in_prepress";
  hasCompletedSession?: boolean;
  sessionId: string | null;
  hasDownstreamActiveJob?: boolean;
  isActivelyOwnedByPrepress?: boolean;
  fileCounts?: {
    originals: number;
    finals: number;
  };
};

type ProductionJob = {
  id: string;
  lineItemId?: string | null;
  stationKey?: string | null;
  stepKey?: string | null;
  status: string;
  orderNumber?: string | null;
  order?: {
    orderNumber?: string | null;
  };
};

type RoutingSnapshot = {
  queueItems: PrepressQueueItem[];
  productionJobs: ProductionJob[];
};

const PREPRESS_TO_PRODUCTION_ORDER_NUMBER = process.env.PLAYWRIGHT_PREPRESS_TO_PRODUCTION_ORDER_NUMBER;

test("prepress → production handoff smoke", async ({ page }) => {
  if (!PREPRESS_TO_PRODUCTION_ORDER_NUMBER) {
    test.skip(
      true,
      "PLAYWRIGHT_PREPRESS_TO_PRODUCTION_ORDER_NUMBER not set — set this to a DEV order number already ready for Send to Production"
    );
    return;
  }

  test.setTimeout(120_000);

  await ensureAuthenticated(page);

  const candidate = await getReadyCandidate(page, PREPRESS_TO_PRODUCTION_ORDER_NUMBER);

  await page.goto("/production/prepress", { waitUntil: "networkidle" });
  await expect(page).not.toHaveURL(/\/login/);

  const card = prepressCandidateCardLocator(page, candidate).first();
  await expect(card).toBeVisible();
  await card.click();
  await expect(page.locator("main h2")).toContainText(candidate.jobNumber);

  const sendButton = page.getByRole("button", { name: /^Send to Production$/ });
  await expect(sendButton).toBeVisible();
  await expect(sendButton).toBeEnabled();

  const sendResponsePromise = page.waitForResponse(
    (response) =>
      response.url().includes(`/api/prepress/line-item/${candidate.lineItemId}/send-to-print`) &&
      response.request().method() === "POST",
    { timeout: 20_000 }
  );

  await sendButton.click();

  const sendResponse = await sendResponsePromise;
  expect(sendResponse.ok(), `Send to Production returned HTTP ${sendResponse.status()}`).toBe(true);

  const routed = await pollForPostSendState(page, candidate.lineItemId);

  await page.goto("/production/prepress", { waitUntil: "networkidle" });
  await expect(prepressCandidateCardLocator(page, candidate)).toHaveCount(0);

  await page.goto(`/production/${routed.stationKey}`, { waitUntil: "networkidle" });
  await expect(page).not.toHaveURL(/\/login/);
  await showAllProductionJobs(page);

  const row = productionRowByOrderNumber(page, candidate.jobNumber);
  await expect(row).toBeVisible();

  await page.reload({ waitUntil: "networkidle" });
  await showAllProductionJobs(page);
  await expect(productionRowByOrderNumber(page, candidate.jobNumber)).toBeVisible();
});

async function ensureAuthenticated(page: Page) {
  await page.goto("/dashboard", { waitUntil: "networkidle" });
  await expect(page).not.toHaveURL(/\/login/);
}

async function fetchJson<T>(
  page: Page,
  path: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string }
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

async function getRoutingSnapshot(page: Page): Promise<RoutingSnapshot> {
  const [queueResponse, jobsResponse] = await Promise.all([
    fetchJson<PrepressQueueItem[]>(page, "/api/prepress/queue"),
    fetchJson<ProductionJob[]>(page, "/api/production/jobs"),
  ]);

  if (queueResponse.status !== 200) {
    throw new Error(`GET /api/prepress/queue failed with HTTP ${queueResponse.status}`);
  }

  if (jobsResponse.status !== 200) {
    throw new Error(`GET /api/production/jobs failed with HTTP ${jobsResponse.status}`);
  }

  return {
    queueItems: queueResponse.body?.data ?? [],
    productionJobs: jobsResponse.body?.data ?? [],
  };
}

async function getReadyCandidate(page: Page, orderNumber: string): Promise<PrepressQueueItem> {
  const snapshot = await getRoutingSnapshot(page);
  const candidate = snapshot.queueItems.find((item) => item.jobNumber === orderNumber);

  if (!candidate) {
    throw new Error(
      `Order ${orderNumber} is not currently visible in the prepress queue. Use a DEV order already present in Prepress and ready for send.`
    );
  }

  if (candidate.isActivelyOwnedByPrepress !== true) {
    throw new Error(`Order ${orderNumber} is not actively owned by prepress yet.`);
  }

  if (candidate.workflowState !== "in_prepress" || candidate.hasCompletedSession !== true) {
    throw new Error(
      `Order ${orderNumber} is not ready for send. Expected workflowState=in_prepress with hasCompletedSession=true but found workflowState=${candidate.workflowState ?? "unknown"}, hasCompletedSession=${String(candidate.hasCompletedSession)}.`
    );
  }

  if ((candidate.fileCounts?.finals ?? 0) <= 0) {
    throw new Error(`Order ${orderNumber} has no visible final files, so Send to Production is not safely testable.`);
  }

  if (candidate.hasDownstreamActiveJob) {
    throw new Error(`Order ${orderNumber} already has an active downstream production job.`);
  }

  return candidate;
}

async function pollForPostSendState(page: Page, lineItemId: string, timeoutMs = 30_000) {
  const startedAt = Date.now();
  let lastSnapshot: RoutingSnapshot | null = null;

  while (Date.now() - startedAt < timeoutMs) {
    lastSnapshot = await getRoutingSnapshot(page);

    const queueMatches = lastSnapshot.queueItems.filter((item) => item.lineItemId === lineItemId);
    const activeProductionMatches = lastSnapshot.productionJobs.filter(
      (job) => job.lineItemId === lineItemId && job.status !== "done" && job.status !== "void"
    );
    const downstreamMatches = activeProductionMatches.filter(
      (job) => job.stationKey && job.stationKey !== "prepress"
    );

    if (queueMatches.length === 0 && activeProductionMatches.length === 1 && downstreamMatches.length === 1) {
      const downstream = downstreamMatches[0];
      const stationKey = String(downstream.stationKey ?? "");
      if (stationKey === "flatbed" || stationKey === "roll") {
        return { stationKey };
      }
    }

    await page.waitForTimeout(750);
  }

  throw new Error(
    `Timed out waiting for downstream routing. Last routing snapshot: ${JSON.stringify(lastSnapshot, null, 2)}`
  );
}

function prepressCandidateCardLocator(page: Page, candidate: Pick<PrepressQueueItem, "jobNumber" | "productName">) {
  const baseCards = page.locator("aside div.cursor-pointer");
  const withOrderNumber = baseCards.filter({ has: page.getByText(candidate.jobNumber, { exact: true }) });
  return candidate.productName
    ? withOrderNumber.filter({ has: page.getByText(candidate.productName, { exact: true }) })
    : withOrderNumber;
}

async function showAllProductionJobs(page: Page) {
  const allTab = page.getByRole("tab", { name: /^All$/ });
  await expect(allTab).toBeVisible();
  if ((await allTab.getAttribute("data-state")) !== "active") {
    await allTab.click();
  }
}

function productionRowByOrderNumber(page: Page, orderNumber: string) {
  return page.locator("tbody tr").filter({
    has: page.getByText(orderNumber, { exact: true }),
  }).first();
}
