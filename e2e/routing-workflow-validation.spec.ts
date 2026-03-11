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
  prepressStage?: "pending_prepress" | "in_prepress" | "prepress_complete";
  sessionId: string | null;
  hasDownstreamActiveJob?: boolean;
  isActivelyOwnedByPrepress?: boolean;
  printType?: string | null;
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

type PrepressToProductionCandidate = PrepressQueueItem & {
  bootstrapComplete: boolean;
  bootstrapFromProduction?: {
    orderNumber: string;
    lineItemId: string;
    stationKey: string;
  } | null;
};

const PREPRESS_TO_PRODUCTION_ORDER_NUMBER = process.env.PLAYWRIGHT_PREPRESS_TO_PRODUCTION_ORDER_NUMBER;
const PRODUCTION_TO_PREPRESS_ORDER_NUMBER = process.env.PLAYWRIGHT_PRODUCTION_TO_PREPRESS_ORDER_NUMBER;

let routedCandidateForReturn: {
  orderNumber: string;
  lineItemId: string;
  stationKey: string;
} | null = null;

test.describe.serial("routing workflow validation", () => {
  test("Prepress → Production", async ({ page }) => {
    test.setTimeout(120_000);
    await ensureAuthenticated(page);

    const candidate = await findPrepressToProductionCandidate(page, PREPRESS_TO_PRODUCTION_ORDER_NUMBER);

    await test.step("Open prepress queue and send item to production", async () => {
      if (candidate.bootstrapFromProduction) {
        await sendLineItemToPrepressViaApi(page, candidate.bootstrapFromProduction.lineItemId);
        await pollForRoutingState(page, candidate.lineItemId, (snapshot) => {
          const item = snapshot.queueItems.find((queueItem) => queueItem.lineItemId === candidate.lineItemId);
          if (!item || item.isActivelyOwnedByPrepress !== true) return null;
          return item;
        });
      }

      await page.goto("/production/prepress", { waitUntil: "networkidle" });
      await expect(page).not.toHaveURL(/\/login/);

      await selectPrepressCandidateCard(page, candidate);

      await preparePrepressCandidate(page, candidate);

      const sendButton = page.getByRole("button", { name: /^Send to Production$/ });
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
    });

    const postSend = await pollForRoutingState(page, candidate.lineItemId, (snapshot) => {
      const queueMatches = snapshot.queueItems.filter((item) => item.lineItemId === candidate.lineItemId);
      const activeProductionMatches = snapshot.productionJobs.filter((job) => job.lineItemId === candidate.lineItemId);
      const downstreamMatches = activeProductionMatches.filter((job) => job.stationKey && job.stationKey !== "prepress");

      if (queueMatches.length !== 0) return null;
      if (activeProductionMatches.length !== 1) return null;
      if (downstreamMatches.length !== 1) return null;

      const downstream = downstreamMatches[0];
      if (downstream.stationKey !== "flatbed" && downstream.stationKey !== "roll") {
        return null;
      }

      return {
        queueMatches,
        activeProductionMatches,
        downstream,
      };
    });

    routedCandidateForReturn = {
      orderNumber: candidate.jobNumber,
      lineItemId: candidate.lineItemId,
      stationKey: String(postSend.downstream.stationKey),
    };

    await test.step("Confirm the item left prepress and appears on the downstream board", async () => {
      await page.goto("/production/prepress", { waitUntil: "networkidle" });
      await expect(prepressCandidateCardLocator(page, candidate)).toHaveCount(0);

      await page.goto(`/production/${postSend.downstream.stationKey}`, { waitUntil: "networkidle" });
      await expect(page).not.toHaveURL(/\/login/);
      await showAllProductionJobs(page);

      const row = productionRowByOrderNumber(page, candidate.jobNumber);
      await expect(row).toBeVisible();
      await row.click();

      await expect(page.getByText(new RegExp(`Order #${candidate.jobNumber}`))).toBeVisible();
    });
  });

  test("Production → Prepress", async ({ page }) => {
    test.setTimeout(120_000);
    await ensureAuthenticated(page);

    const candidate =
      routedCandidateForReturn ??
      (await findProductionToPrepressCandidate(page, PRODUCTION_TO_PREPRESS_ORDER_NUMBER));

    await test.step("Open the source production board and send the item back to prepress", async () => {
      await page.goto(`/production/${candidate.stationKey}`, { waitUntil: "networkidle" });
      await expect(page).not.toHaveURL(/\/login/);
      await showAllProductionJobs(page);

      const row = productionRowByOrderNumber(page, candidate.orderNumber);
      await expect(row).toBeVisible();
      await row.click();

      const launchButton = page.getByRole("button", { name: /^Send to Prepress$/ }).first();
      await expect(launchButton).toBeEnabled();
      await launchButton.click();

      const dialog = page.getByRole("alertdialog");
      await expect(dialog).toBeVisible();
      await dialog.getByPlaceholder(/Describe what needs to change/i).fill(
        `Playwright routing validation ${new Date().toISOString()}`
      );
      const sendResponsePromise = page.waitForResponse(
        (response) =>
          response.url().includes(`/api/production/line-item/${candidate.lineItemId}/send-to-prepress`) &&
          response.request().method() === "POST",
        { timeout: 20_000 }
      );
      await dialog.getByRole("button", { name: /^Send to Prepress$/ }).click();
      const sendResponse = await sendResponsePromise;
      expect(sendResponse.ok(), `Send to Prepress returned HTTP ${sendResponse.status()}`).toBe(true);
    });

    await pollForProductionToPrepressReturn(page, candidate);

    await test.step("Confirm the item left the old production board and reappeared in prepress", async () => {
      await page.goto(`/production/${candidate.stationKey}`, { waitUntil: "networkidle" });
      await showAllProductionJobs(page);
      await expect(productionRowByOrderNumber(page, candidate.orderNumber)).toHaveCount(0);

      await page.goto("/production/prepress", { waitUntil: "networkidle" });
      const card = page.locator("aside").getByText(candidate.orderNumber, { exact: true }).first();
      await expect(card).toBeVisible();
      await card.click();
      await expect(page.locator("main h2")).toContainText(candidate.orderNumber);
    });
  });
});

// ---------------------------------------------------------------------------
// Invariant regressions
// Run independently of the happy-path serial block so they can be executed
// in isolation without requiring a full end-to-end session.
// ---------------------------------------------------------------------------

test.describe("invariant: one active production_job per line item", () => {
  test("at most one non-terminal production_job exists per line item after send-to-print", async ({ page }) => {
    test.setTimeout(60_000);
    await ensureAuthenticated(page);

    // Find any line item that is currently owned by a downstream production station.
    const snapshot = await getRoutingSnapshot(page);
    const candidates = snapshot.productionJobs.filter(
      (job) =>
        !!job.lineItemId &&
        job.status !== "done" &&
        job.status !== "void" &&
        job.stationKey !== "prepress",
    );

    test.skip(candidates.length === 0, "No active downstream production jobs found to validate invariant");

    const grouped = groupProductionJobsByLineItem(candidates);
    for (const [lineItemId, jobs] of grouped.entries()) {
      const nonTerminal = jobs.filter((j) => j.status !== "done" && j.status !== "void");
      expect(
        nonTerminal.length,
        `Line item ${lineItemId} has ${nonTerminal.length} non-terminal production jobs — expected exactly 1. Jobs: ${JSON.stringify(nonTerminal)}`,
      ).toBeLessThanOrEqual(1);
    }
  });
});

test.describe("invariant: double send-to-print is rejected", () => {
  test("sending to print a line item already in downstream production returns an error", async ({ page }) => {
    test.setTimeout(60_000);
    await ensureAuthenticated(page);

    const snapshot = await getRoutingSnapshot(page);
    // Find a prepress queue item that already has a downstream active job.
    const candidate = snapshot.queueItems.find((item) => item.hasDownstreamActiveJob === true);

    test.skip(!candidate, "No prepress item with existing downstream job found");

    // Attempt to send to print — should be rejected by the server.
    const response = await fetchJson(page, `/api/prepress/line-item/${candidate!.lineItemId}/send-to-print`, {
      method: "POST",
    });

    expect(
      response.status,
      `Expected 4xx when sending an already-in-production item to print but got HTTP ${response.status}`,
    ).toBeGreaterThanOrEqual(400);
    expect(response.status).toBeLessThan(500);
  });
});

test.describe("invariant: Send to Production button gating", () => {
  test("Send to Production button is disabled when prepressStage is not prepress_complete", async ({ page }) => {
    test.setTimeout(60_000);
    await ensureAuthenticated(page);

    const snapshot = await getRoutingSnapshot(page);
    // Find a prepress-owned item that is NOT yet prepress_complete.
    const candidate = snapshot.queueItems.find(
      (item) =>
        item.isActivelyOwnedByPrepress === true &&
        item.prepressStage !== "prepress_complete",
    );

    test.skip(!candidate, "No in-progress prepress item available to verify button gating");

    await page.goto("/production/prepress", { waitUntil: "networkidle" });
    await expect(page).not.toHaveURL(/\/login/);

    // Select the card.
    const card = page.locator("aside div.cursor-pointer").filter({
      has: page.getByText(candidate!.jobNumber, { exact: true }),
    }).first();
    await expect(card).toBeVisible();
    await card.click();

    // "Send to Production" must be disabled since the item has not reached prepress_complete.
    const sendButton = page.getByRole("button", { name: /^Send to Production$/ });
    await expect(sendButton).toBeDisabled();
  });

  test("Complete button is disabled when prepressStage is not in_prepress", async ({ page }) => {
    test.setTimeout(60_000);
    await ensureAuthenticated(page);

    const snapshot = await getRoutingSnapshot(page);
    // Find a prepress-owned item that is NOT yet in_prepress (i.e. pending or complete).
    const candidate = snapshot.queueItems.find(
      (item) =>
        item.isActivelyOwnedByPrepress === true &&
        item.prepressStage !== "in_prepress",
    );

    test.skip(!candidate, "No prepress item in non-in_prepress stage available");

    await page.goto("/production/prepress", { waitUntil: "networkidle" });
    await expect(page).not.toHaveURL(/\/login/);

    const card = page.locator("aside div.cursor-pointer").filter({
      has: page.getByText(candidate!.jobNumber, { exact: true }),
    }).first();
    await expect(card).toBeVisible();
    await card.click();

    // "Mark Prepress Complete" must be disabled when not actively in-session.
    const completeButton = page.getByRole("button", { name: /Mark Prepress Complete/i });
    await expect(completeButton).toBeDisabled();
  });
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

async function getLineItemFiles(page: Page, lineItemId: string) {
  const response = await fetchJson<{
    originals: Array<unknown>;
    finals: Array<unknown>;
    references: Array<unknown>;
  }>(page, `/api/prepress/line-item/${lineItemId}/files`);

  if (response.status !== 200) {
    throw new Error(`GET /api/prepress/line-item/${lineItemId}/files failed with HTTP ${response.status}`);
  }

  return response.body?.data ?? { originals: [], finals: [], references: [] };
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

async function getBoardVisibleProductionJobs(page: Page, stationKey: "flatbed" | "roll") {
  const response = await fetchJson<ProductionJob[]>(
    page,
    `/api/production/jobs?station=${encodeURIComponent(stationKey)}`
  );

  if (response.status !== 200) {
    throw new Error(`GET /api/production/jobs?station=${stationKey} failed with HTTP ${response.status}`);
  }

  return response.body?.data ?? [];
}

async function getAllBoardVisibleProductionJobs(page: Page) {
  const [flatbedJobs, rollJobs] = await Promise.all([
    getBoardVisibleProductionJobs(page, "flatbed"),
    getBoardVisibleProductionJobs(page, "roll"),
  ]);

  return [...flatbedJobs, ...rollJobs];
}

async function findPrepressToProductionCandidate(
  page: Page,
  preferredOrderNumber?: string
): Promise<PrepressToProductionCandidate> {
  const snapshot = await getRoutingSnapshot(page);
  const activeJobsByLineItemId = groupProductionJobsByLineItem(snapshot.productionJobs);

  const preparableCandidates = snapshot.queueItems.filter((item) => {
    if (preferredOrderNumber && item.jobNumber !== preferredOrderNumber) return false;
    const activeJobs = activeJobsByLineItemId.get(item.lineItemId) ?? [];
    return (
      !item.hasDownstreamActiveJob &&
      item.isActivelyOwnedByPrepress === true &&
      isPrepressOwnedJobList(activeJobs) &&
      isSelectablePrepressItem(item, snapshot.queueItems) &&
      item.status !== "new" &&
      item.prepressStage !== "prepress_complete"
    );
  });

  const preparableCandidate = preparableCandidates[0];
  if (preparableCandidate) {
    return { ...preparableCandidate, bootstrapComplete: true, bootstrapFromProduction: null };
  }

  const readyCandidates = snapshot.queueItems.filter((item) => {
    if (preferredOrderNumber && item.jobNumber !== preferredOrderNumber) return false;
    const activeJobs = activeJobsByLineItemId.get(item.lineItemId) ?? [];
    return (
      item.prepressStage === "prepress_complete" &&
      (item.fileCounts?.finals ?? 0) > 0 &&
      !item.hasDownstreamActiveJob &&
      item.isActivelyOwnedByPrepress === true &&
      isPrepressOwnedJobList(activeJobs) &&
      isSelectablePrepressItem(item, snapshot.queueItems)
    );
  });

  const readyCandidate = readyCandidates[0];
  if (readyCandidate) {
    return { ...readyCandidate, bootstrapComplete: false, bootstrapFromProduction: null };
  }

  const bootstrapCandidates = snapshot.queueItems.filter((item) => {
    if (preferredOrderNumber && item.jobNumber !== preferredOrderNumber) return false;
    const activeJobs = activeJobsByLineItemId.get(item.lineItemId) ?? [];
    return (
      item.status === "pending_prepress" &&
      !item.hasDownstreamActiveJob &&
      item.isActivelyOwnedByPrepress === true &&
      !item.sessionId &&
      isPrepressOwnedJobList(activeJobs) &&
      isSelectablePrepressItem(item, snapshot.queueItems)
    );
  });

  const bootstrapCandidate = bootstrapCandidates[0];
  if (bootstrapCandidate) {
    return { ...bootstrapCandidate, bootstrapComplete: true, bootstrapFromProduction: null };
  }

  const productionFallback = await findProductionToPrepressCandidate(page, preferredOrderNumber);
  return {
    jobNumber: productionFallback.orderNumber,
    lineItemId: productionFallback.lineItemId,
    status: "pending_prepress",
    prepressStage: "pending_prepress",
    sessionId: null,
    hasDownstreamActiveJob: false,
    isActivelyOwnedByPrepress: true,
    printType: productionFallback.stationKey,
    fileCounts: { originals: 0, finals: 0 },
    bootstrapComplete: true,
    bootstrapFromProduction: productionFallback,
  };
}

async function findProductionToPrepressCandidate(page: Page, preferredOrderNumber?: string) {
  const productionJobs = await getAllBoardVisibleProductionJobs(page);
  const orderNumbers = productionJobs
    .map((job) => String(job.orderNumber ?? job.order?.orderNumber ?? ""))
    .filter(Boolean);
  const orderCounts = countBy(orderNumbers);

  const candidates = productionJobs.filter((job) => {
    const orderNumber = String(job.orderNumber ?? job.order?.orderNumber ?? "");
    if (!orderNumber) return false;
    if (preferredOrderNumber && orderNumber !== preferredOrderNumber) return false;
    if (!job.lineItemId) return false;
    if (job.status === "done") return false;
    if (job.stationKey !== "flatbed" && job.stationKey !== "roll") return false;
    return orderCounts.get(orderNumber) === 1;
  });

  const candidate = candidates[0];
  if (!candidate?.lineItemId || !candidate.stationKey) {
    throw new Error(
      preferredOrderNumber
        ? `Order ${preferredOrderNumber} is not currently eligible for Production → Prepress validation.`
        : "No unique active flatbed/roll production item is currently available for Production → Prepress validation."
    );
  }

  return {
    orderNumber: String(candidate.orderNumber ?? candidate.order?.orderNumber),
    lineItemId: candidate.lineItemId,
    stationKey: candidate.stationKey,
  };
}

async function pollForRoutingState<T>(
  page: Page,
  lineItemId: string,
  matcher: (snapshot: RoutingSnapshot) => T | null,
  timeoutMs = 30_000
): Promise<T> {
  const startedAt = Date.now();
  let lastSnapshot: RoutingSnapshot | null = null;

  while (Date.now() - startedAt < timeoutMs) {
    lastSnapshot = await getRoutingSnapshot(page);
    const match = matcher(lastSnapshot);
    if (match !== null) {
      return match;
    }
    await page.waitForTimeout(750);
  }

  throw new Error(
    `Timed out waiting for routing state for line item ${lineItemId}. Last snapshot: ${JSON.stringify(lastSnapshot, null, 2)}`
  );
}

async function selectPrepressCard(page: Page, orderNumber: string) {
  const card = page.locator("aside").getByText(orderNumber, { exact: true }).first();
  await expect(card).toBeVisible();
  await card.click();
  await expect(page.locator("main h2")).toContainText(orderNumber);
}

async function selectPrepressCandidateCard(page: Page, candidate: PrepressToProductionCandidate) {
  const card = prepressCandidateCardLocator(page, candidate).first();
  await expect(card).toBeVisible();
  await card.click();
  await expect(page.locator("main h2")).toContainText(candidate.jobNumber);
}

async function preparePrepressCandidate(page: Page, candidate: PrepressToProductionCandidate) {
  if ((candidate.fileCounts?.finals ?? 0) === 0) {
    await uploadFinalFile(page, candidate.lineItemId);
  }

  if (!candidate.bootstrapComplete) {
    await page.reload({ waitUntil: "networkidle" });
    await selectPrepressCandidateCard(page, candidate);
    return;
  }

  if (candidate.sessionId) {
    await completeSessionViaApi(page, candidate.sessionId);
  } else {
    const sessionId = await startSessionViaApi(page, candidate.lineItemId);
    await completeSessionViaApi(page, sessionId);
  }

  await pollForRoutingState(page, candidate.lineItemId, (snapshot) => {
    const refreshed = snapshot.queueItems.find((item) => item.lineItemId === candidate.lineItemId);
    if (!refreshed) return null;
    if (refreshed.prepressStage !== "prepress_complete") return null;
    if (refreshed.status !== "prepress_complete") return null;
    return refreshed;
  });

  await page.reload({ waitUntil: "networkidle" });
  await selectPrepressCandidateCard(page, candidate);
}

function prepressCandidateCardLocator(page: Page, candidate: Pick<PrepressQueueItem, "jobNumber" | "productName">) {
  const baseCards = page.locator("aside div.cursor-pointer");
  const withOrderNumber = baseCards.filter({ has: page.getByText(candidate.jobNumber, { exact: true }) });
  return candidate.productName
    ? withOrderNumber.filter({ has: page.getByText(candidate.productName, { exact: true }) })
    : withOrderNumber;
}

async function sendLineItemToPrepressViaApi(page: Page, lineItemId: string) {
  const response = await fetchJson(page, `/api/production/line-item/${lineItemId}/send-to-prepress`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      note: `Playwright prepress bootstrap ${new Date().toISOString()}`,
      noPrintsCompletedYet: true,
    }),
  });

  if (response.status !== 200) {
    throw new Error(
      `POST /api/production/line-item/${lineItemId}/send-to-prepress failed with HTTP ${response.status}: ${response.body?.error || response.body?.message || "Unknown error"}`
    );
  }
}

async function startSessionViaApi(page: Page, lineItemId: string) {
  const response = await fetchJson<{ id: string }>(page, "/api/prepress/session/start", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ lineItemId }),
  });

  if (response.status !== 200 || !response.body?.data?.id) {
    throw new Error(
      `POST /api/prepress/session/start failed for ${lineItemId} with HTTP ${response.status}: ${response.body?.error || response.body?.message || "Unknown error"}`
    );
  }

  return response.body.data.id;
}

async function completeSessionViaApi(page: Page, sessionId: string) {
  const response = await fetchJson(page, `/api/prepress/session/${sessionId}/complete`, {
    method: "POST",
  });

  if (response.status !== 200) {
    throw new Error(
      `POST /api/prepress/session/${sessionId}/complete failed with HTTP ${response.status}: ${response.body?.error || response.body?.message || "Unknown error"}`
    );
  }
}

async function uploadFinalFile(page: Page, lineItemId: string) {
  const fileInput = page.locator('input[type="file"]').first();
  await fileInput.setInputFiles({
    name: "playwright-routing-final.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n"),
  });

  await pollForLineItemFiles(page, lineItemId, (files) => {
    if ((files.finals?.length ?? 0) === 0) return null;
    return files;
  });
}

async function showAllProductionJobs(page: Page) {
  const allTab = page.getByRole("tab", { name: /^All$/ });
  await expect(allTab).toBeVisible();
  if ((await allTab.getAttribute("data-state")) !== "active") {
    await allTab.click();
  }
}

async function pollForProductionToPrepressReturn(
  page: Page,
  candidate: { lineItemId: string; stationKey: string },
  timeoutMs = 30_000
) {
  const startedAt = Date.now();
  let lastQueueItems: PrepressQueueItem[] = [];
  let lastStationJobs: ProductionJob[] = [];

  while (Date.now() - startedAt < timeoutMs) {
    const [queueResponse, stationJobs] = await Promise.all([
      fetchJson<PrepressQueueItem[]>(page, "/api/prepress/queue"),
      getBoardVisibleProductionJobs(page, candidate.stationKey as "flatbed" | "roll"),
    ]);

    if (queueResponse.status !== 200) {
      throw new Error(`GET /api/prepress/queue failed with HTTP ${queueResponse.status}`);
    }

    lastQueueItems = queueResponse.body?.data ?? [];
    lastStationJobs = stationJobs;

    const queueItem = lastQueueItems.find((item) => item.lineItemId === candidate.lineItemId);
    const stillVisibleOnSourceBoard = lastStationJobs.some((job) => job.lineItemId === candidate.lineItemId);

    if (queueItem && queueItem.isActivelyOwnedByPrepress === true && !stillVisibleOnSourceBoard) {
      return queueItem;
    }

    await page.waitForTimeout(750);
  }

  throw new Error(
    `Timed out waiting for Production → Prepress return for line item ${candidate.lineItemId}. ` +
      `Last queue snapshot: ${JSON.stringify(lastQueueItems, null, 2)}. ` +
      `Last ${candidate.stationKey} board snapshot: ${JSON.stringify(lastStationJobs, null, 2)}`
  );
}

async function pollForLineItemFiles<T>(
  page: Page,
  lineItemId: string,
  matcher: (files: Awaited<ReturnType<typeof getLineItemFiles>>) => T | null,
  timeoutMs = 30_000
): Promise<T> {
  const startedAt = Date.now();
  let lastFiles: Awaited<ReturnType<typeof getLineItemFiles>> | null = null;

  while (Date.now() - startedAt < timeoutMs) {
    lastFiles = await getLineItemFiles(page, lineItemId);
    const match = matcher(lastFiles);
    if (match !== null) {
      return match;
    }
    await page.waitForTimeout(750);
  }

  throw new Error(
    `Timed out waiting for files for line item ${lineItemId}. Last files snapshot: ${JSON.stringify(lastFiles, null, 2)}`
  );
}

function productionRowByOrderNumber(page: Page, orderNumber: string) {
  return page.locator("tbody tr").filter({
    has: page.getByText(orderNumber, { exact: true }),
  }).first();
}

function countBy(values: string[]) {
  const counts = new Map<string, number>();
  for (const value of values) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return counts;
}

function groupProductionJobsByLineItem(jobs: ProductionJob[]) {
  const grouped = new Map<string, ProductionJob[]>();
  for (const job of jobs) {
    if (!job.lineItemId) continue;
    const existing = grouped.get(job.lineItemId) ?? [];
    existing.push(job);
    grouped.set(job.lineItemId, existing);
  }
  return grouped;
}

function isPrepressOwnedJobList(jobs: ProductionJob[]) {
  return jobs.length === 1 && (jobs[0].stationKey === "prepress" || jobs[0].stepKey === "prepress");
}

function isSelectablePrepressItem(candidate: PrepressQueueItem, allItems: PrepressQueueItem[]) {
  const matchingOrder = allItems.filter((item) => item.jobNumber === candidate.jobNumber);
  if (matchingOrder.length === 1) {
    return true;
  }

  const productName = String(candidate.productName ?? "").trim();
  if (!productName) {
    return false;
  }

  return (
    matchingOrder.filter((item) => String(item.productName ?? "").trim() === productName).length === 1
  );
}
