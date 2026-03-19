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
  customerName?: string;
  productName?: string;
  media?: string | null;
  status: string;
  workflowState: "ready_for_prepress" | "in_prepress";
  hasCompletedSession?: boolean;
  sessionId: string | null;
  sessionStartedAt?: string | null;
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

type ValidationCandidate = PrepressQueueItem & {
  stationKey: string;
};

test.describe.serial("prepress page DEV validation", () => {
  let candidate: ValidationCandidate | null = null;
  let autoRefreshCandidate: ValidationCandidate | null = null;

  test("validate live prepress page workflow", async ({ page }) => {
    test.setTimeout(240_000);
    await ensureAuthenticated(page);
    candidate = null;

    await test.step("Queue auto-refresh picks up new prepress work without reload", async () => {
      const recyclableCandidate = await findPrepressCompleteCandidate(page);
      expect(recyclableCandidate).not.toBeNull();

      await page.goto("/production/prepress", { waitUntil: "networkidle" });
      await expect(page).not.toHaveURL(/\/login/);
      await expect(page.locator("main h2")).toContainText("Select a line item");

      const beforeQueue = await getPrepressQueue(page);
      const beforeExists = beforeQueue.some((item) => item.lineItemId === recyclableCandidate!.lineItemId);
      expect(beforeExists).toBe(true);

      await sendLineItemToProductionViaApi(page, recyclableCandidate!.lineItemId);
      await pollForPrepressQueueAbsence(page, recyclableCandidate!.lineItemId);

      const downstreamJob = await pollForProductionLineItem(page, recyclableCandidate!.lineItemId);

      await sendLineItemToPrepressViaApi(page, recyclableCandidate!.lineItemId);

      const autoRefreshedItem = await pollForPrepressQueueItem(page, recyclableCandidate!.lineItemId, {
        timeoutMs: 25_000,
        requireOwnedByPrepress: true,
      });

      autoRefreshCandidate = {
        ...autoRefreshedItem,
        stationKey: String(downstreamJob.stationKey),
      };

      await expect(prepressCandidateCardLocator(page, autoRefreshCandidate)).toBeVisible({ timeout: 20_000 });

      const refreshResponsePromise = page.waitForResponse(
        (response) => response.url().includes("/api/prepress/queue") && response.request().method() === "GET",
        { timeout: 20_000 },
      );
      await page.locator("aside button").first().click();
      const refreshResponse = await refreshResponsePromise;
      expect(refreshResponse.ok(), `Manual refresh returned HTTP ${refreshResponse.status()}`).toBe(true);
      await expect(prepressCandidateCardLocator(page, autoRefreshCandidate)).toBeVisible();
    });

    await test.step("Start Prepress creates or returns one active session and timer survives reload", async () => {
      candidate = await findPendingPrepressCandidate(page);
      const startButton = page.getByRole("button", { name: /^Start Prepress$/ });

      if (candidate) {
        await selectPrepressCandidateCard(page, candidate);
        await expect(startButton).toBeEnabled();

        const startResponsePromise = page.waitForResponse(
          (response) => response.url().includes("/api/prepress/session/start") && response.request().method() === "POST",
          { timeout: 20_000 },
        );
        await startButton.click();
        const startResponse = await startResponsePromise;
        expect(startResponse.ok(), `Start Prepress returned HTTP ${startResponse.status()}`).toBe(true);

        const startedItem = await pollForPrepressQueueItem(page, candidate.lineItemId, {
          timeoutMs: 20_000,
          matcher: (item) => item.workflowState === "in_prepress" && !!item.sessionId && !!item.sessionStartedAt,
        });

        candidate = {
          ...startedItem,
          stationKey: candidate.stationKey,
        };
      } else {
        candidate = await findActivePrepressCandidate(page);
        expect(candidate).not.toBeNull();
        await selectPrepressCandidateCard(page, candidate!);
        await expect(startButton).toBeDisabled();
      }

      await expect(page.locator("main h2")).toContainText(candidate!.jobNumber);
      await expect(page.getByText(/^Timer:/)).toBeVisible();
      await expect(page.locator("main header").getByText("In Prepress", { exact: true })).toBeVisible();

      const idempotentStartA = await startSessionViaApi(page, candidate!.lineItemId);
      const idempotentStartB = await startSessionViaApi(page, candidate!.lineItemId);
      expect(idempotentStartA).toBe(candidate!.sessionId);
      expect(idempotentStartB).toBe(candidate!.sessionId);

      await page.reload({ waitUntil: "networkidle" });
      await selectPrepressCandidateCard(page, candidate!);
      await expect(page.getByText(/^Timer:/)).toBeVisible();
      await expect(page.getByText(/ago$/)).toBeVisible();

      await page.waitForTimeout(16_000);
      await expect(page.locator("main h2")).toContainText(candidate!.jobNumber);
      await expect(page.getByPlaceholder("Search Job #, Customer, Product...")).toHaveValue("");
    });

    await test.step("Search stays correct while refresh runs", async () => {
      expect(candidate).not.toBeNull();
      const searchInput = page.getByPlaceholder("Search Job #, Customer, Product...");

      await searchInput.fill(candidate!.jobNumber);
      await expect(prepressCandidateCardLocator(page, candidate!)).toBeVisible();
      await expect(page.locator("main h2")).toContainText(candidate!.jobNumber);

      const productFragment = String(candidate!.productName || "").trim().slice(0, 12);
      if (productFragment.length >= 3) {
        await searchInput.fill(productFragment);
        await expect(prepressCandidateCardLocator(page, candidate!)).toBeVisible();
      }

      const customerFragment = String(candidate!.customerName || "").trim().slice(0, 12);
      if (customerFragment.length >= 3) {
        await searchInput.fill(customerFragment);
        await expect(prepressCandidateCardLocator(page, candidate!)).toBeVisible();
      }

      const mediaFragment = String(candidate!.media || "").trim().slice(0, 12);
      if (mediaFragment.length >= 3) {
        await searchInput.fill(mediaFragment);
        await expect(prepressCandidateCardLocator(page, candidate!)).toBeVisible();
      }

      await searchInput.fill(candidate!.jobNumber);
      await page.waitForTimeout(16_000);
      await expect(searchInput).toHaveValue(candidate!.jobNumber);
      await expect(prepressCandidateCardLocator(page, candidate!)).toBeVisible();

      await searchInput.fill("");
      await expect(prepressCandidateCardLocator(page, candidate!)).toBeVisible();
    });

    await test.step("Mark Prepress Complete closes the active session and keeps detail state stable", async () => {
      expect(candidate).not.toBeNull();
      await selectPrepressCandidateCard(page, candidate!);

      if ((candidate!.fileCounts?.finals ?? 0) === 0) {
        await uploadFinalFile(page, candidate!.lineItemId);
      }

      const completeButton = page.getByRole("button", { name: /Mark Prepress Complete/i });
      await expect(completeButton).toBeEnabled();

      const completeResponsePromise = page.waitForResponse(
        (response) => response.url().includes(`/api/prepress/session/${candidate!.sessionId}/complete`) && response.request().method() === "POST",
        { timeout: 20_000 },
      );
      await completeButton.click();
      const completeResponse = await completeResponsePromise;
      expect(completeResponse.ok(), `Mark Prepress Complete returned HTTP ${completeResponse.status()}`).toBe(true);

      const completedItem = await pollForPrepressQueueItem(page, candidate!.lineItemId, {
        timeoutMs: 20_000,
        matcher: (item) => item.workflowState === "in_prepress" && item.hasCompletedSession === true && item.sessionId === null,
      });

      candidate = {
        ...completedItem,
        stationKey: candidate!.stationKey,
      };

      await expect(prepressCandidateCardLocator(page, candidate!)).toBeVisible();
      await expect(page.locator("main h2")).toContainText(candidate!.jobNumber);
      await expect(page.locator("main header").getByText("In Prepress", { exact: true })).toBeVisible();
      await expect(page.getByText("Session complete", { exact: true })).toBeVisible();
      await expect(page.getByRole("button", { name: /^Send to Production$/ })).toBeEnabled();
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

async function getPrepressQueue(page: Page): Promise<PrepressQueueItem[]> {
  const response = await fetchJson<PrepressQueueItem[]>(page, "/api/prepress/queue");
  if (response.status !== 200) {
    throw new Error(`GET /api/prepress/queue failed with HTTP ${response.status}`);
  }
  return response.body?.data ?? [];
}

async function getProductionJobs(page: Page, station?: string): Promise<ProductionJob[]> {
  const suffix = station ? `?station=${encodeURIComponent(station)}` : "";
  const response = await fetchJson<ProductionJob[]>(page, `/api/production/jobs${suffix}`);
  if (response.status !== 200) {
    throw new Error(`GET /api/production/jobs${suffix} failed with HTTP ${response.status}`);
  }
  return response.body?.data ?? [];
}

async function findPrepressCompleteCandidate(page: Page): Promise<ValidationCandidate | null> {
  const queueItems = await getPrepressQueue(page);
  const candidate = queueItems.find((item) => {
    return (
      item.workflowState === "in_prepress" &&
      item.hasCompletedSession === true &&
      item.isActivelyOwnedByPrepress === true &&
      !item.hasDownstreamActiveJob &&
      (item.fileCounts?.finals ?? 0) > 0
    );
  });

  if (!candidate) {
    return null;
  }

  return {
    ...candidate,
    stationKey: "prepress",
  };
}

async function sendLineItemToProductionViaApi(page: Page, lineItemId: string) {
  const response = await fetchJson(page, `/api/prepress/line-item/${lineItemId}/send-to-print`, {
    method: "POST",
  });

  if (response.status !== 200) {
    throw new Error(
      `POST /api/prepress/line-item/${lineItemId}/send-to-print failed with HTTP ${response.status}: ${response.body?.error || response.body?.message || "Unknown error"}`,
    );
  }
}

async function pollForPrepressQueueAbsence(page: Page, lineItemId: string, timeoutMs = 30_000) {
  const startedAt = Date.now();
  let lastQueue: PrepressQueueItem[] = [];

  while (Date.now() - startedAt < timeoutMs) {
    lastQueue = await getPrepressQueue(page);
    if (!lastQueue.some((item) => item.lineItemId === lineItemId)) {
      return;
    }
    await page.waitForTimeout(750);
  }

  throw new Error(
    `Timed out waiting for prepress queue item ${lineItemId} to leave the queue. Last queue snapshot: ${JSON.stringify(lastQueue, null, 2)}`,
  );
}

async function pollForProductionLineItem(page: Page, lineItemId: string, timeoutMs = 30_000): Promise<ProductionJob> {
  const startedAt = Date.now();
  let lastJobs: ProductionJob[] = [];

  while (Date.now() - startedAt < timeoutMs) {
    lastJobs = await getProductionJobs(page);
    const job = lastJobs.find((entry) => entry.lineItemId === lineItemId && entry.stationKey && entry.stationKey !== "prepress");
    if (job) {
      return job;
    }
    await page.waitForTimeout(750);
  }

  throw new Error(
    `Timed out waiting for production job for line item ${lineItemId}. Last production snapshot: ${JSON.stringify(lastJobs, null, 2)}`,
  );
}

async function findProductionToPrepressCandidate(page: Page) {
  const productionJobs = [
    ...(await getProductionJobs(page, "flatbed")),
    ...(await getProductionJobs(page, "roll")),
  ];

  const orderCounts = countBy(
    productionJobs
      .map((job) => String(job.orderNumber ?? job.order?.orderNumber ?? ""))
      .filter(Boolean),
  );

  const candidate = productionJobs.find((job) => {
    const orderNumber = String(job.orderNumber ?? job.order?.orderNumber ?? "");
    if (!orderNumber) return false;
    if (!job.lineItemId) return false;
    if (job.status === "done" || job.status === "void") return false;
    if (job.stationKey !== "flatbed" && job.stationKey !== "roll") return false;
    return orderCounts.get(orderNumber) === 1;
  });

  if (!candidate?.lineItemId || !candidate.stationKey) {
    throw new Error("No unique active flatbed/roll production item is currently available for focused prepress validation.");
  }

  return {
    orderNumber: String(candidate.orderNumber ?? candidate.order?.orderNumber),
    lineItemId: candidate.lineItemId,
    stationKey: candidate.stationKey,
  };
}

async function findPendingPrepressCandidate(page: Page): Promise<ValidationCandidate | null> {
  const queueItems = await getPrepressQueue(page);
  const pendingCandidate = queueItems.find((item) => {
    return (
      item.workflowState === "ready_for_prepress" &&
      item.sessionId === null &&
      item.isActivelyOwnedByPrepress === true &&
      !item.hasDownstreamActiveJob
    );
  });

  if (!pendingCandidate) {
    return null;
  }

  return {
    ...pendingCandidate,
    stationKey: "prepress",
  };
}

async function findActivePrepressCandidate(page: Page): Promise<ValidationCandidate | null> {
  const queueItems = await getPrepressQueue(page);
  const activeCandidate = queueItems.find((item) => {
    return (
      item.workflowState === "in_prepress" &&
      item.sessionId !== null &&
      !!item.sessionStartedAt &&
      item.isActivelyOwnedByPrepress === true &&
      !item.hasDownstreamActiveJob
    );
  });

  if (!activeCandidate) {
    return null;
  }

  return {
    ...activeCandidate,
    stationKey: "prepress",
  };
}

async function sendLineItemToPrepressViaApi(page: Page, lineItemId: string) {
  const response = await fetchJson(page, `/api/production/line-item/${lineItemId}/send-to-prepress`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      note: `Playwright prepress page validation ${new Date().toISOString()}`,
      noPrintsCompletedYet: true,
    }),
  });

  if (response.status !== 200) {
    throw new Error(
      `POST /api/production/line-item/${lineItemId}/send-to-prepress failed with HTTP ${response.status}: ${response.body?.error || response.body?.message || "Unknown error"}`,
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
      `POST /api/prepress/session/start failed for ${lineItemId} with HTTP ${response.status}: ${response.body?.error || response.body?.message || "Unknown error"}`,
    );
  }

  return response.body.data.id;
}

async function pollForPrepressQueueItem(
  page: Page,
  lineItemId: string,
  options?: {
    timeoutMs?: number;
    requireOwnedByPrepress?: boolean;
    matcher?: (item: PrepressQueueItem) => boolean;
  },
) {
  const timeoutMs = options?.timeoutMs ?? 30_000;
  const startedAt = Date.now();
  let lastQueue: PrepressQueueItem[] = [];

  while (Date.now() - startedAt < timeoutMs) {
    lastQueue = await getPrepressQueue(page);
    const item = lastQueue.find((entry) => entry.lineItemId === lineItemId) ?? null;
    if (item) {
      const ownedOk = !options?.requireOwnedByPrepress || item.isActivelyOwnedByPrepress === true;
      const matched = options?.matcher ? options.matcher(item) : true;
      if (ownedOk && matched) {
        return item;
      }
    }
    await page.waitForTimeout(750);
  }

  throw new Error(
    `Timed out waiting for prepress queue item ${lineItemId}. Last queue snapshot: ${JSON.stringify(lastQueue, null, 2)}`,
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

async function uploadFinalFile(page: Page, lineItemId: string) {
  const fileInput = page.locator('input[type="file"]').first();
  await fileInput.setInputFiles({
    name: "playwright-prepress-final.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n"),
  });

  await pollForLineItemFiles(page, lineItemId, (files) => ((files.finals?.length ?? 0) > 0 ? files : null));
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

function countBy(values: string[]) {
  const counts = new Map<string, number>();
  for (const value of values) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return counts;
}
