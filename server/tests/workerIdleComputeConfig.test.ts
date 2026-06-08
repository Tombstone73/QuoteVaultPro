import fs from "fs";
import path from "path";
import { jest } from "@jest/globals";

const ORIGINAL_ENV = { ...process.env };

async function importFresh<T>(modulePath: string): Promise<T> {
  jest.resetModules();
  return import(modulePath) as Promise<T>;
}

beforeEach(() => {
  process.env = { ...ORIGINAL_ENV };
  process.env.NODE_ENV = "production";
  delete process.env.WORKERS_ENABLED;
  delete process.env.WORKER_THUMBNAILS_INTERVAL_MS;
  delete process.env.THUMBNAIL_WORKER_FALLBACK_INTERVAL_MS;
  delete process.env.WORKER_QB_SYNC_INTERVAL_MS;
  delete process.env.QUICKBOOKS_SYNC_INTERVAL_MS;
  delete process.env.QUICKBOOKS_SYNC_STABILITY_WINDOW_MS;
  delete process.env.QB_SYNC_SETTLE_WINDOW_MINUTES;
  delete process.env.UPLOAD_CLEANUP_WORKER_INTERVAL_MS;
});

afterAll(() => {
  process.env = ORIGINAL_ENV;
});

describe("idle compute worker defaults", () => {
  test("thumbnail fallback interval defaults to 6 hours in production", async () => {
    const worker = await importFresh<typeof import("../workers/thumbnailWorker")>("../workers/thumbnailWorker");

    expect(worker.getThumbnailFallbackIntervalMs()).toBe(6 * 60 * 60 * 1000);
  });

  test("QuickBooks sync interval defaults to 60 minutes in production", async () => {
    const worker = await importFresh<typeof import("../workers/syncProcessor")>("../workers/syncProcessor");

    expect(worker.getQuickBooksSyncIntervalMs()).toBe(60 * 60 * 1000);
    expect(worker.getQuickBooksSyncIntervalMs()).not.toBe(30 * 1000);
  });

  test("QuickBooks stability window blocks recently edited invoices", async () => {
    const queue = await importFresh<typeof import("../services/quickbooksSyncQueueWorker")>(
      "../services/quickbooksSyncQueueWorker"
    );

    const now = new Date("2026-06-08T12:00:00.000Z");
    const recent = new Date("2026-06-08T11:45:00.000Z");
    const stable = new Date("2026-06-08T11:29:59.000Z");

    expect(queue.getQuickBooksSyncStabilityWindowMs()).toBe(30 * 60 * 1000);
    expect(queue.isUpdatedBeforeQuickBooksStabilityCutoff(recent, now, 30 * 60 * 1000)).toBe(false);
    expect(queue.isUpdatedBeforeQuickBooksStabilityCutoff(stable, now, 30 * 60 * 1000)).toBe(true);
  });

  test("chunked upload cleanup interval defaults to 6 hours in production", async () => {
    const cleanup = await importFresh<typeof import("../services/chunkedUploads")>("../services/chunkedUploads");

    expect(cleanup.getUploadCleanupIntervalMs()).toBe(6 * 60 * 60 * 1000);
  });

  test("WORKERS_ENABLED=false disables workers through the common gate", async () => {
    process.env.WORKERS_ENABLED = "false";
    const gates = await importFresh<typeof import("../workers/workerGates")>("../workers/workerGates");

    expect(gates.isWorkerEnabled("THUMBNAILS", true)).toBe(false);
    expect(gates.isWorkerEnabled("ASSET_PREVIEW", true)).toBe(false);
    expect(gates.isWorkerEnabled("QB_SYNC", true)).toBe(false);
    expect(gates.isWorkerEnabled("QB_QUEUE", true)).toBe(false);
    expect(gates.isWorkerEnabled("UPLOAD_CLEANUP", true)).toBe(false);
  });

  test("manual QuickBooks sync route and settings button remain wired", () => {
    const routeSource = fs.readFileSync(path.join(process.cwd(), "server/routes/quickbooks.routes.ts"), "utf8");
    const settingsSource = fs.readFileSync(path.join(process.cwd(), "client/src/pages/settings/integrations.tsx"), "utf8");

    expect(routeSource).toContain("app.post('/api/integrations/quickbooks/flush'");
    expect(routeSource).toContain("ignoreStabilityWindow: force");
    expect(settingsSource).toContain("fetch('/api/integrations/quickbooks/flush'");
    expect(settingsSource).toContain("Sync now");
  });
});
