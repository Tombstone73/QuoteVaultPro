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

type ProductionBoardCandidate = {
  orderNumber: string;
  lineItemId: string;
  stationKey: "flatbed" | "roll";
};

type ExclusiveBoardState = {
  prepressVisible: boolean;
  flatbedVisible: boolean;
  rollVisible: boolean;
  sourceStationVisible?: boolean;
};

const PREPRESS_TO_PRODUCTION_ORDER_NUMBER = process.env.PLAYWRIGHT_PREPRESS_TO_PRODUCTION_ORDER_NUMBER;
const PRODUCTION_TO_PREPRESS_ORDER_NUMBER = process.env.PLAYWRIGHT_PRODUCTION_TO_PREPRESS_ORDER_NUMBER;

let revisitLoopCandidate: ProductionBoardCandidate | null = null;

test.describe.serial("routing lifecycle extended validation", () => {
  test("Prepress → Production → Complete", async ({ page }) => {
    test.setTimeout(120_000);
    await ensureAuthenticated(page);

    const candidate = await findPrepressToProductionCandidate(page, PREPRESS_TO_PRODUCTION_ORDER_NUMBER);

    if (candidate.bootstrapFromProduction) {
      await sendLineItemToPrepressViaApi(page, candidate.bootstrapFromProduction.lineItemId);
      await pollForRoutingState(page, candidate.lineItemId, (snapshot) => {
        const item = snapshot.queueItems.find((queueItem) => queueItem.lineItemId === candidate.lineItemId);
        if (!item || item.isActivelyOwnedByPrepress !== true) return null;
        return item;
      });
    }

    await page.goto("/production/prepress", { waitUntil: "networkidle" });
    await selectPrepressCandidateCard(page, candidate);
    await preparePrepressCandidate(page, candidate);

    const productionJob = await sendPrepressCandidateToProduction(page, candidate.lineItemId);

    await page.goto(`/production/${productionJob.stationKey}`, { waitUntil: "networkidle" });
    await showAllProductionJobs(page);
    await openProductionJob(page, productionJob.orderNumber, productionJob.lineItemId);

    await startProductionJobFromBoard(page, productionJob.id);
    await pollForBoardJob(page, productionJob.stationKey, productionJob.lineItemId, (job) =>
      job.status === "in_progress" ? job : null,
    );

    await completeProductionJobFromBoard(page, productionJob.id);

    await pollForNoBoardOwnership(page, productionJob.lineItemId);

    await page.goto(`/production/${productionJob.stationKey}`, { waitUntil: "networkidle" });
    await showAllProductionJobs(page);
    await expect(productionRowByOrderNumber(page, productionJob.orderNumber)).toHaveCount(0);
  });

  test("Station revisit loop", async ({ page }) => {
    test.setTimeout(120_000);
    await ensureAuthenticated(page);

    const candidate = await findProductionToPrepressCandidate(page, PRODUCTION_TO_PREPRESS_ORDER_NUMBER);

    await sendProductionCandidateToPrepress(page, candidate);
    await pollForProductionToPrepressReturn(page, candidate);

    const prepressCandidate = await getPrepressQueueCandidateByLineItem(page, candidate.lineItemId);

    await page.goto("/production/prepress", { waitUntil: "networkidle" });
    await selectPrepressCandidateCard(page, prepressCandidate);
    await preparePrepressCandidate(page, prepressCandidate);

    const revisitedJob = await sendPrepressCandidateToProduction(page, candidate.lineItemId);
    await assertExclusiveBoardVisibility(page, candidate.lineItemId, {
      prepressVisible: false,
      flatbedVisible: revisitedJob.stationKey === "flatbed",
      rollVisible: revisitedJob.stationKey === "roll",
    });

    revisitLoopCandidate = {
      orderNumber: revisitedJob.orderNumber,
      lineItemId: revisitedJob.lineItemId,
      stationKey: revisitedJob.stationKey,
    };
  });

  test("Board integrity", async ({ page }) => {
    test.setTimeout(120_000);
    await ensureAuthenticated(page);

    const candidate = revisitLoopCandidate ?? (await findProductionToPrepressCandidate(page, PRODUCTION_TO_PREPRESS_ORDER_NUMBER));

    await assertExclusiveBoardVisibility(page, candidate.lineItemId, {
      prepressVisible: false,
      flatbedVisible: candidate.stationKey === "flatbed",
      rollVisible: candidate.stationKey === "roll",
    });

    await sendProductionCandidateToPrepress(page, candidate);

    await pollForExclusiveBoardVisibility(page, candidate.lineItemId, {
      prepressVisible: true,
      flatbedVisible: false,
      rollVisible: false,
      sourceStationVisible: false,
    }, candidate.stationKey);
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

async function getBoardVisibleProductionJobs(page: Page, stationKey: "flatbed" | "roll") {
  const response = await fetchJson<ProductionJob[]>(
    page,
    `/api/production/jobs?station=${encodeURIComponent(stationKey)}`,
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
  preferredOrderNumber?: string,
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

async function findProductionToPrepressCandidate(page: Page, preferredOrderNumber?: string): Promise<ProductionBoardCandidate> {
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
        ? `Order ${preferredOrderNumber} is not currently eligible for extended routing validation.`
        : "No unique active flatbed/roll production item is currently available for extended routing validation.",
    );
  }

  return {
    orderNumber: String(candidate.orderNumber ?? candidate.order?.orderNumber),
    lineItemId: candidate.lineItemId,
    stationKey: candidate.stationKey,
  } as ProductionBoardCandidate;
}

async function getPrepressQueueCandidateByLineItem(page: Page, lineItemId: string): Promise<PrepressToProductionCandidate> {
  const snapshot = await getRoutingSnapshot(page);
  const item = snapshot.queueItems.find((queueItem) => queueItem.lineItemId === lineItemId);

  if (!item || item.isActivelyOwnedByPrepress !== true) {
    throw new Error(`Line item ${lineItemId} is not currently available in the prepress queue.`);
  }

  return {
    ...item,
    bootstrapComplete: item.prepressStage !== "prepress_complete",
    bootstrapFromProduction: null,
  };
}

async function sendPrepressCandidateToProduction(page: Page, lineItemId: string) {
  const sendResponsePromise = page.waitForResponse(
    (response) =>
      response.url().includes(`/api/prepress/line-item/${lineItemId}/send-to-print`) &&
      response.request().method() === "POST",
    { timeout: 20_000 },
  );

  await page.getByRole("button", { name: /^Send to Production$/ }).click();
  const sendResponse = await sendResponsePromise;
  expect(sendResponse.ok(), `Send to Production returned HTTP ${sendResponse.status()}`).toBe(true);

  return await pollForRoutingState(page, lineItemId, (snapshot) => {
    const queueMatches = snapshot.queueItems.filter((item) => item.lineItemId === lineItemId);
    const activeProductionMatches = snapshot.productionJobs.filter((job) => job.lineItemId === lineItemId);
    const downstreamMatches = activeProductionMatches.filter((job) => job.stationKey && job.stationKey !== "prepress");

    if (queueMatches.length !== 0) return null;
    if (activeProductionMatches.length !== 1) return null;
    if (downstreamMatches.length !== 1) return null;

    const downstream = downstreamMatches[0];
    if (downstream.stationKey !== "flatbed" && downstream.stationKey !== "roll") {
      return null;
    }

    return {
      id: downstream.id,
      orderNumber: String(downstream.orderNumber ?? downstream.order?.orderNumber ?? ""),
      lineItemId,
      stationKey: downstream.stationKey,
    } as { id: string; orderNumber: string; lineItemId: string; stationKey: "flatbed" | "roll" };
  });
}

async function sendProductionCandidateToPrepress(page: Page, candidate: ProductionBoardCandidate) {
  await page.goto(`/production/${candidate.stationKey}`, { waitUntil: "networkidle" });
  await showAllProductionJobs(page);
  await openProductionJob(page, candidate.orderNumber, candidate.lineItemId);

  const launchButton = page.getByRole("button", { name: /^Send to Prepress$/ }).first();
  await expect(launchButton).toBeEnabled();
  await launchButton.click();

  const dialog = page.getByRole("alertdialog");
  await expect(dialog).toBeVisible();
  await dialog.getByPlaceholder(/Describe what needs to change/i).fill(
    `Playwright extended routing validation ${new Date().toISOString()}`,
  );

  const sendResponsePromise = page.waitForResponse(
    (response) =>
      response.url().includes(`/api/production/line-item/${candidate.lineItemId}/send-to-prepress`) &&
      response.request().method() === "POST",
    { timeout: 20_000 },
  );
  await dialog.getByRole("button", { name: /^Send to Prepress$/ }).click();
  const sendResponse = await sendResponsePromise;
  expect(sendResponse.ok(), `Send to Prepress returned HTTP ${sendResponse.status()}`).toBe(true);
}

async function startProductionJobFromBoard(page: Page, jobId: string) {
  const responsePromise = page.waitForResponse(
    (response) =>
      response.url().includes(`/api/production/jobs/${jobId}/start`) && response.request().method() === "POST",
    { timeout: 20_000 },
  );
  await page.getByRole("button", { name: /^START$/ }).click();
  const response = await responsePromise;
  expect(response.ok(), `Start production returned HTTP ${response.status()}`).toBe(true);
}

async function completeProductionJobFromBoard(page: Page, jobId: string) {
  const responsePromise = page.waitForResponse(
    (response) =>
      response.url().includes(`/api/production/jobs/${jobId}/complete`) && response.request().method() === "POST",
    { timeout: 20_000 },
  );
  await page.getByRole("button", { name: /^COMPLETE$/ }).click();
  const response = await responsePromise;
  expect(response.ok(), `Complete production returned HTTP ${response.status()}`).toBe(true);
}

async function openProductionJob(page: Page, orderNumber: string, lineItemId: string) {
  const row = productionRowByOrderNumber(page, orderNumber);
  await expect(row).toBeVisible();
  await row.click();
  await expect(page.getByText(new RegExp(`Order #${orderNumber}`))).toBeVisible();

  const boardJobs = await getAllBoardVisibleProductionJobs(page);
  const matched = boardJobs.find((job) => job.lineItemId === lineItemId && String(job.orderNumber ?? job.order?.orderNumber ?? "") === orderNumber);
  if (!matched) {
    throw new Error(`Could not resolve production job detail for order ${orderNumber} line item ${lineItemId}.`);
  }
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

async function pollForRoutingState<T>(
  page: Page,
  lineItemId: string,
  matcher: (snapshot: RoutingSnapshot) => T | null,
  timeoutMs = 30_000,
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
    `Timed out waiting for routing state for line item ${lineItemId}. Last snapshot: ${JSON.stringify(lastSnapshot, null, 2)}`,
  );
}

async function pollForBoardJob<T>(
  page: Page,
  stationKey: "flatbed" | "roll",
  lineItemId: string,
  matcher: (job: ProductionJob) => T | null,
  timeoutMs = 30_000,
): Promise<T> {
  const startedAt = Date.now();
  let lastJobs: ProductionJob[] = [];

  while (Date.now() - startedAt < timeoutMs) {
    lastJobs = await getBoardVisibleProductionJobs(page, stationKey);
    const target = lastJobs.find((job) => job.lineItemId === lineItemId);
    if (target) {
      const match = matcher(target);
      if (match !== null) return match;
    }
    await page.waitForTimeout(750);
  }

  throw new Error(
    `Timed out waiting for board job ${lineItemId} on ${stationKey}. Last board snapshot: ${JSON.stringify(lastJobs, null, 2)}`,
  );
}

async function pollForNoBoardOwnership(page: Page, lineItemId: string, timeoutMs = 30_000) {
  const startedAt = Date.now();
  let lastState: ExclusiveBoardState | null = null;

  while (Date.now() - startedAt < timeoutMs) {
    lastState = await getExclusiveBoardState(page, lineItemId);
    if (!lastState.prepressVisible && !lastState.flatbedVisible && !lastState.rollVisible) {
      return;
    }
    await page.waitForTimeout(750);
  }

  throw new Error(`Timed out waiting for no board ownership for line item ${lineItemId}. Last state: ${JSON.stringify(lastState, null, 2)}`);
}

async function pollForProductionToPrepressReturn(
  page: Page,
  candidate: ProductionBoardCandidate,
  timeoutMs = 30_000,
) {
  const startedAt = Date.now();
  let lastQueueItems: PrepressQueueItem[] = [];
  let lastStationJobs: ProductionJob[] = [];

  while (Date.now() - startedAt < timeoutMs) {
    const [queueResponse, stationJobs] = await Promise.all([
      fetchJson<PrepressQueueItem[]>(page, "/api/prepress/queue"),
      getBoardVisibleProductionJobs(page, candidate.stationKey),
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
      `Last ${candidate.stationKey} board snapshot: ${JSON.stringify(lastStationJobs, null, 2)}`,
  );
}

async function assertExclusiveBoardVisibility(page: Page, lineItemId: string, expected: ExclusiveBoardState) {
  const state = await getExclusiveBoardState(page, lineItemId);
  expect(state.prepressVisible).toBe(expected.prepressVisible);
  expect(state.flatbedVisible).toBe(expected.flatbedVisible);
  expect(state.rollVisible).toBe(expected.rollVisible);
}

async function pollForExclusiveBoardVisibility(
  page: Page,
  lineItemId: string,
  expected: ExclusiveBoardState,
  sourceStation?: "flatbed" | "roll",
  timeoutMs = 30_000,
) {
  const startedAt = Date.now();
  let lastState: ExclusiveBoardState | null = null;

  while (Date.now() - startedAt < timeoutMs) {
    lastState = await getExclusiveBoardState(page, lineItemId, sourceStation);
    if (
      lastState.prepressVisible === expected.prepressVisible &&
      lastState.flatbedVisible === expected.flatbedVisible &&
      lastState.rollVisible === expected.rollVisible &&
      (expected.sourceStationVisible === undefined || lastState.sourceStationVisible === expected.sourceStationVisible)
    ) {
      return lastState;
    }
    await page.waitForTimeout(750);
  }

  throw new Error(
    `Timed out waiting for exclusive board visibility for line item ${lineItemId}. Last state: ${JSON.stringify(lastState, null, 2)}`,
  );
}

async function getExclusiveBoardState(
  page: Page,
  lineItemId: string,
  sourceStation?: "flatbed" | "roll",
): Promise<ExclusiveBoardState> {
  const [queueResponse, flatbedJobs, rollJobs] = await Promise.all([
    fetchJson<PrepressQueueItem[]>(page, "/api/prepress/queue"),
    getBoardVisibleProductionJobs(page, "flatbed"),
    getBoardVisibleProductionJobs(page, "roll"),
  ]);

  if (queueResponse.status !== 200) {
    throw new Error(`GET /api/prepress/queue failed with HTTP ${queueResponse.status}`);
  }

  const queueItems = queueResponse.body?.data ?? [];
  const state: ExclusiveBoardState = {
    prepressVisible: queueItems.some((item) => item.lineItemId === lineItemId),
    flatbedVisible: flatbedJobs.some((job) => job.lineItemId === lineItemId),
    rollVisible: rollJobs.some((job) => job.lineItemId === lineItemId),
  };

  if (sourceStation) {
    state.sourceStationVisible = sourceStation === "flatbed" ? state.flatbedVisible : state.rollVisible;
  }

  return state;
}

async function startSessionViaApi(page: Page, lineItemId: string) {
  const response = await fetchJson<{ id: string }>(page, "/api/prepress/session/start", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ lineItemId }),
  });

  if (response.status !== 200 || !response.body?.data?.id) {
    throw new Error(
      `POST /api/prepress/session/start failed for ${lineItemId} with HTTP ${response.status}: ${response.body?.error || response.body?.message || "Unknown error"}`,
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
      `POST /api/prepress/session/${sessionId}/complete failed with HTTP ${response.status}: ${response.body?.error || response.body?.message || "Unknown error"}`,
    );
  }
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
      `POST /api/production/line-item/${lineItemId}/send-to-prepress failed with HTTP ${response.status}: ${response.body?.error || response.body?.message || "Unknown error"}`,
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

async function pollForLineItemFiles<T>(
  page: Page,
  lineItemId: string,
  matcher: (files: Awaited<ReturnType<typeof getLineItemFiles>>) => T | null,
  timeoutMs = 30_000,
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
    `Timed out waiting for files for line item ${lineItemId}. Last files snapshot: ${JSON.stringify(lastFiles, null, 2)}`,
  );
}

async function selectPrepressCandidateCard(page: Page, candidate: Pick<PrepressQueueItem, "jobNumber" | "productName">) {
  const card = prepressCandidateCardLocator(page, candidate).first();
  await expect(card).toBeVisible();
  await card.click();
  await expect(page.locator("main h2")).toContainText(candidate.jobNumber);
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

function countBy(values: string[]) {
  const counts = new Map<string, number>();
  for (const value of values) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return counts;
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

  return matchingOrder.filter((item) => String(item.productName ?? "").trim() === productName).length === 1;
}
