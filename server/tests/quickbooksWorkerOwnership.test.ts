import { jest } from '@jest/globals';
import fs from 'node:fs';
import path from 'node:path';

const ORIGINAL_ENV = { ...process.env };

async function importFresh<T>(modulePath: string): Promise<T> {
  jest.resetModules();
  return import(modulePath) as Promise<T>;
}

beforeEach(() => {
  process.env = { ...ORIGINAL_ENV };
  delete process.env.QUICKBOOKS_AUTOMATION_OWNER;
});

afterAll(() => {
  process.env = ORIGINAL_ENV;
});

describe('QuickBooks autonomous worker ownership', () => {
  test('defaults to the derived invoice/payment queue and never selects both workers', async () => {
    const ownership = await importFresh<typeof import('../workers/quickBooksWorkerOwnership')>(
      '../workers/quickBooksWorkerOwnership'
    );

    expect(ownership.getQuickBooksAutomationOwner()).toBe('queue');
    expect(ownership.isQuickBooksWorkerOwnedHere('QB_QUEUE')).toBe(true);
    expect(ownership.isQuickBooksWorkerOwnedHere('QB_SYNC')).toBe(false);
  });

  test('legacy_jobs is an explicit temporary migration selection, not a second active worker', async () => {
    process.env.QUICKBOOKS_AUTOMATION_OWNER = 'legacy_jobs';
    const ownership = await importFresh<typeof import('../workers/quickBooksWorkerOwnership')>(
      '../workers/quickBooksWorkerOwnership'
    );

    expect(ownership.getQuickBooksAutomationOwner()).toBe('legacy_jobs');
    expect(ownership.isQuickBooksWorkerOwnedHere('QB_SYNC')).toBe(true);
    expect(ownership.isQuickBooksWorkerOwnedHere('QB_QUEUE')).toBe(false);
  });

  test('invalid deployment configuration fails closed to the canonical queue owner', async () => {
    process.env.QUICKBOOKS_AUTOMATION_OWNER = 'both';
    const ownership = await importFresh<typeof import('../workers/quickBooksWorkerOwnership')>(
      '../workers/quickBooksWorkerOwnership'
    );

    expect(ownership.getQuickBooksAutomationOwner()).toBe('queue');
    expect(ownership.isQuickBooksWorkerOwnedHere('QB_QUEUE')).toBe(true);
    expect(ownership.isQuickBooksWorkerOwnedHere('QB_SYNC')).toBe(false);
  });

  test('startup and legacy jobs cannot silently create a second outbound worker', () => {
    const indexSource = fs.readFileSync(path.join(process.cwd(), 'server/index.ts'), 'utf8');
    const processorSource = fs.readFileSync(path.join(process.cwd(), 'server/workers/syncProcessor.ts'), 'utf8');
    const routesSource = fs.readFileSync(path.join(process.cwd(), 'server/routes/quickbooks.routes.ts'), 'utf8');

    expect(indexSource).toContain("isQuickBooksWorkerOwnedHere('QB_SYNC') && isWorkerEnabled('QB_SYNC', true)");
    expect(indexSource).toContain("isQuickBooksWorkerOwnedHere('QB_QUEUE') && isWorkerEnabled('QB_QUEUE', true)");
    expect(processorSource).toContain("eq(accountingSyncJobs.direction, 'pull')");
    expect(processorSource).toContain("isQuickBooksWorkerOwnedHere('QB_SYNC')");
    expect(routesSource).toContain("syncWorker.triggerJobProcessing()");
    expect(routesSource).toContain("Legacy QuickBooks bulk push is disabled because the derived invoice/payment queue is the active owner");
  });
});
