import { afterEach, beforeEach, describe, expect, jest, test } from "@jest/globals";
import { V2ApplicationError } from "../../src/errors/applicationError.js";
import { SalesWorkspaceMaintenanceService, type SalesWorkspaceMaintenanceStore, type WorkspaceMaintenanceContext,
  type WorkspaceMaintenanceResult } from "../../src/modules/sales/workspaceMaintenance.js";
import { WorkspaceMaintenanceWorker, startWorkspaceMaintenanceWorker, type WorkspaceMaintenanceWorkerOptions } from "../../infrastructure/sales/workspaceMaintenanceWorker.js";

const organizations = ["10000000-0000-4000-8000-000000000001", "20000000-0000-4000-8000-000000000002", "30000000-0000-4000-8000-000000000003"];
const enabled = { V2_MUTATION_WORKERS_ENABLED: "true", V2_WORKSPACE_MAINTENANCE_ENABLED: "true" };
const cleanup = { inspected: 0, deleted: 0, retained: 0, failed: 0, busy: 0, remaining: 0 };
const context: WorkspaceMaintenanceContext = { kind: "service", operation: "sales.workspace.maintenance", organizationId: organizations[0]! };
const input = { expiryLimit: 2, cleanupLimit: 3 };
const result = (organizationId: string): WorkspaceMaintenanceResult => ({ organizationId, expiredWorkspaceIds: [], cleanup, reason: "completed" });

function fixture(overrides: Partial<WorkspaceMaintenanceWorkerOptions> = {}) {
  const listOrganizationIds = jest.fn<SalesWorkspaceMaintenanceStore["listOrganizationIds"]>(async ({ afterOrganizationId, limit }) =>
    organizations.filter((id) => id > (afterOrganizationId ?? "")).slice(0, limit));
  const run = jest.fn<SalesWorkspaceMaintenanceService["run"]>(async ({ organizationId }) => result(organizationId));
  const worker = new WorkspaceMaintenanceWorker({ store: { listOrganizationIds }, maintenance: { run }, environment: enabled, ...overrides });
  return { worker, listOrganizationIds, run };
}

beforeEach(() => { jest.useFakeTimers(); });
afterEach(() => { jest.useRealTimers(); });

describe("workspace maintenance worker", () => {
  test("missing or malformed flags do no reads, mutations, or timer scheduling", async () => {
    for (const environment of [{}, { V2_WORKSPACE_MAINTENANCE_ENABLED: "true" },
      { ...enabled, V2_MUTATION_WORKERS_ENABLED: "1" }, { ...enabled, V2_MUTATION_WORKERS_ENABLED: "false" },
      { V2_MUTATION_WORKERS_ENABLED: "true" }, { ...enabled, V2_WORKSPACE_MAINTENANCE_ENABLED: "false" },
      { ...enabled, V2_WORKSPACE_MAINTENANCE_ENABLED: "yes" }]) {
      const { worker, listOrganizationIds, run } = fixture({ environment });
      worker.start();
      const tick = await worker.tick();
      expect(["mutation_workers_disabled", "workspace_maintenance_disabled"]).toContain(tick.reason);
      expect(tick.organizationsProcessed).toBe(0);
      expect(tick.remaining).toBeNull();
      expect(tick.knownRemaining).toBe(0);
      expect(listOrganizationIds).not.toHaveBeenCalled();
      expect(run).not.toHaveBeenCalled();
      expect(jest.getTimerCount()).toBe(0);
      await worker.stop();
    }
  });

  test("invalid bounds and NaN fail closed even when workers are disabled", () => {
    for (const key of ["tenantLimit", "expiryLimit", "cleanupLimit", "intervalMs"] as const) {
      for (const value of [NaN, Infinity, -Infinity, 0, -1, 1.5]) {
        expect(() => fixture({ environment: {}, [key]: value })).toThrow(V2ApplicationError);
      }
    }
    expect(() => fixture({ tenantLimit: 26 })).toThrow(V2ApplicationError);
    expect(() => fixture({ expiryLimit: 101 })).toThrow(V2ApplicationError);
    expect(() => fixture({ cleanupLimit: 101 })).toThrow(V2ApplicationError);
    expect(() => fixture({ intervalMs: 999 })).toThrow(V2ApplicationError);
    expect(() => fixture({ intervalMs: 3_600_001 })).toThrow(V2ApplicationError);
    expect(() => fixture({ afterOrganizationId: "not-a-tenant" })).toThrow(V2ApplicationError);
    expect(jest.getTimerCount()).toBe(0);
  });

  test("round-robin cursor advances through permanently ambiguous and failed tenants, then resumes", async () => {
    const { worker, listOrganizationIds, run } = fixture({ tenantLimit: 1, expiryLimit: 2, cleanupLimit: 3 });
    run.mockImplementation(async (scope) => scope.organizationId === organizations[0]
      ? { ...result(scope.organizationId), reason: "cleanup_pending", cleanup: { ...cleanup, inspected: 1, deleted: 1, remaining: 1 } }
      : scope.organizationId === organizations[1] ? Promise.reject(new Error("database unavailable")) : result(scope.organizationId));
    const first = await worker.tick();
    expect(first.remaining).toBe(1);
    expect(first.deleted).toBe(1);
    expect(first.afterOrganizationId).toBe(organizations[0]);
    const second = await worker.tick();
    expect(second.reason).toBe("partial");
    expect(second.remaining).toBeNull();
    expect(second.knownRemaining).toBe(0);
    expect(second.failedOrganizations).toBe(1);
    expect(second.organizations[0]!.errorCode).toBe("INTERNAL_ERROR");
    expect(second.afterOrganizationId).toBe(organizations[1]);
    expect((await worker.tick()).afterOrganizationId).toBe(organizations[2]);
    expect((await worker.tick()).afterOrganizationId).toBeNull();
    expect((await worker.tick()).afterOrganizationId).toBe(organizations[0]);
    expect(run.mock.calls.map(([scope]) => scope.organizationId)).toEqual([...organizations, organizations[0]]);
    for (const [scope, bounds] of run.mock.calls) {
      expect(scope).toEqual({ kind: "service", operation: "sales.workspace.maintenance", organizationId: scope.organizationId });
      expect(bounds).toEqual(input);
      expect("principal" in scope).toBe(false);
    }
    const resumed = fixture({ tenantLimit: 1, afterOrganizationId: organizations[0] });
    expect((await resumed.worker.tick()).afterOrganizationId).toBe(organizations[1]);
    expect(listOrganizationIds.mock.calls[0]![0]).toEqual({ afterOrganizationId: null, limit: 1 });
    await worker.stop(); await resumed.worker.stop();
  });

  test("two ticks share no work and stop waits for the active tenant, skipping the next tenant", async () => {
    let finish!: (value: WorkspaceMaintenanceResult) => void;
    const pending = new Promise<WorkspaceMaintenanceResult>((resolve) => { finish = resolve; });
    const { worker, run } = fixture({ tenantLimit: 2 });
    run.mockImplementation(() => pending);
    const first = worker.tick();
    await Promise.resolve();
    expect(run).toHaveBeenCalledTimes(1);
    const overlap = await worker.tick();
    expect(overlap.reason).toBe("busy");
    expect(overlap.remaining).toBeNull();
    let stopped = false;
    const stopping = worker.stop().then(() => { stopped = true; });
    await Promise.resolve();
    expect(stopped).toBe(false);
    finish({ ...result(organizations[0]!), expiredWorkspaceIds: ["saved-workspace"], cleanup: { ...cleanup, inspected: 1, deleted: 1 } });
    const summary = await first;
    await stopping;
    expect(summary.reason).toBe("stopped");
    expect(summary.organizationsScanned).toBe(2);
    expect(summary.organizationsProcessed).toBe(1);
    expect(summary.expired).toBe(1);
    expect(summary.deleted).toBe(1);
    expect(summary.remaining).toBeNull();
    expect(summary.knownRemaining).toBe(0);
    expect(run).toHaveBeenCalledTimes(1);
    expect(stopped).toBe(true);
    worker.start();
    expect((await worker.tick()).reason).toBe("stopped");
    expect(jest.getTimerCount()).toBe(0);
  });

  test("scheduler delays the first sweep and schedules only after completion, with no overlapping timers", async () => {
    let finish!: (value: WorkspaceMaintenanceResult) => void;
    const run = jest.fn<SalesWorkspaceMaintenanceService["run"]>(() => new Promise((resolve) => { finish = resolve; }));
    const listOrganizationIds = jest.fn<SalesWorkspaceMaintenanceStore["listOrganizationIds"]>(async () => [organizations[0]!]);
    const worker = startWorkspaceMaintenanceWorker({ maintenance: { run }, store: { listOrganizationIds }, environment: enabled, intervalMs: 1_000, tenantLimit: 1 });
    worker.start();
    expect(jest.getTimerCount()).toBe(1);
    expect(run).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(1_000);
    expect(run).toHaveBeenCalledTimes(1);
    expect(jest.getTimerCount()).toBe(0);
    await jest.advanceTimersByTimeAsync(10_000);
    expect(run).toHaveBeenCalledTimes(1);
    expect((await worker.tick()).reason).toBe("busy");
    finish(result(organizations[0]!));
    await jest.advanceTimersByTimeAsync(0);
    expect(jest.getTimerCount()).toBe(1);
    expect(worker.lastResult?.reason).toBe("completed");
    await worker.stop();
    await jest.advanceTimersByTimeAsync(10_000);
    expect(run).toHaveBeenCalledTimes(1);
    expect(jest.getTimerCount()).toBe(0);
  });

  test("malformed, duplicate, out-of-order, or over-limit projections fail before tenant work", async () => {
    for (const ids of [["not-a-tenant"], [organizations[0]!, organizations[0]!], [organizations[1]!, organizations[0]!], organizations]) {
      const listOrganizationIds = jest.fn<SalesWorkspaceMaintenanceStore["listOrganizationIds"]>(async () => ids);
      const { worker, run } = fixture({ tenantLimit: 2, store: { listOrganizationIds } });
      const failed = await worker.tick();
      expect(failed.reason).toBe("scan_failed");
      expect(failed.remaining).toBeNull();
      expect(failed.knownRemaining).toBe(0);
      expect(worker.afterOrganizationId).toBeNull();
      expect(run).not.toHaveBeenCalled();
      await worker.stop();
    }
  });

  test("scan failure leaves cursor intact and observer failure does not suppress outcomes", async () => {
    const { worker, listOrganizationIds } = fixture({ afterOrganizationId: organizations[0], onResult: () => { throw new Error("observer"); } });
    listOrganizationIds.mockRejectedValueOnce(new Error("offline"));
    const failed = await worker.tick();
    expect(failed.reason).toBe("scan_failed");
    expect(failed.errorCode).toBe("INTERNAL_ERROR");
    expect(failed.remaining).toBeNull();
    expect(failed.observerFailed).toBe(true);
    expect(worker.afterOrganizationId).toBe(organizations[0]);
    const done = await worker.tick();
    expect(done.organizationsProcessed).toBe(2);
    expect(done.observerFailed).toBe(true);
    expect(worker.lastResult).toEqual(done);
    await worker.stop();
  });

  test("actual maintenance service cleanup exceptions leave mixed-tenant backlog unknown while preserving known counts and fair continuation", async () => {
    const store = { listOrganizationIds: jest.fn<SalesWorkspaceMaintenanceStore["listOrganizationIds"]>(async ({ afterOrganizationId, limit }) =>
      organizations.filter((id) => id > (afterOrganizationId ?? "")).slice(0, limit)),
      expireDrafts: jest.fn<SalesWorkspaceMaintenanceStore["expireDrafts"]>(async ({ organizationId }) => [organizationId]) };
    const owner = { cleanup: jest.fn(async ({ organizationId }: { organizationId: string; limit: number }) => {
      if (organizationId === organizations[0]) throw new Error("Owner cleanup unavailable; do not fabricate a zero count");
      return { ...cleanup, inspected: 2, deleted: 1, remaining: 7 };
    }) };
    const maintenance = new SalesWorkspaceMaintenanceService(store, owner);
    const worker = new WorkspaceMaintenanceWorker({ store, maintenance, environment: enabled, tenantLimit: 2 });
    const mixed = await worker.tick();
    expect(mixed.reason).toBe("partial"); expect(mixed.remaining).toBeNull(); expect(mixed.knownRemaining).toBe(7);
    expect(mixed.errorCode).toBe("CLEANUP_COUNT_UNAVAILABLE"); expect(mixed.failedOrganizations).toBe(1);
    expect(mixed.expired).toBe(2); expect(mixed.inspected).toBe(2); expect(mixed.deleted).toBe(1);
    expect(mixed.organizations[0]!.reason).toBe("cleanup_failed"); expect(mixed.organizations[0]!.cleanup).toBeNull();
    expect(mixed.organizations[0]!.errorCode).toBe("INTERNAL_ERROR");
    expect(mixed.afterOrganizationId).toBe(organizations[1]);
    const continuation = await worker.tick();
    expect(continuation.organizations.map((row) => row.organizationId)).toEqual([organizations[2]]);
    expect(continuation.remaining).toBe(7); expect(continuation.knownRemaining).toBe(7);
    expect(owner.cleanup.mock.calls.map(([scope]) => scope.organizationId)).toEqual(organizations);
    await worker.stop();
  });
});

describe("internal Sales maintenance operation", () => {
  test("uses only the service scope, valid bounds and clock before persistence or Artwork", async () => {
    const expireDrafts = jest.fn<SalesWorkspaceMaintenanceStore["expireDrafts"]>(async () => []);
    const artwork = { cleanup: jest.fn(async () => cleanup) };
    const store = { expireDrafts, listOrganizationIds: async () => [] };
    const service = new SalesWorkspaceMaintenanceService(store, artwork);
    for (const scope of [{ ...context, kind: "staff" }, { ...context, principal: { kind: "staff", userId: "fixed-user" } },
      { ...context, organizationId: "invalid" }, { ...context, operation: "sales.create" }]) {
      await expect(service.run(scope as never, input)).rejects.toThrow(V2ApplicationError);
    }
    for (const key of ["expiryLimit", "cleanupLimit"] as const) for (const value of [NaN, Infinity, 0, 101]) {
      await expect(service.run(context, { ...input, [key]: value })).rejects.toThrow(V2ApplicationError);
    }
    await expect(new SalesWorkspaceMaintenanceService(store, artwork, () => new Date(NaN)).run(context, input)).rejects.toThrow(V2ApplicationError);
    expect(expireDrafts).not.toHaveBeenCalled();
    expect(artwork.cleanup).not.toHaveBeenCalled();
  });

  test("expiry is committed before owner cleanup and provider failures preserve the returned expiry IDs", async () => {
    const events: string[] = [];
    const expireDrafts = jest.fn<SalesWorkspaceMaintenanceStore["expireDrafts"]>(async () => { events.push("expiry_commit"); return ["last-save"]; });
    const artwork = { cleanup: jest.fn(async (scope: { organizationId: string; limit: number }) => {
      expect(scope).toEqual({ organizationId: context.organizationId, limit: 3 });
      expect(events).toEqual(["expiry_commit"]);
      events.push("owner_cleanup");
      throw new Error("provider contains private diagnostics");
    }) };
    const now = new Date("2026-09-30T00:00:00.000Z");
    const service = new SalesWorkspaceMaintenanceService({ expireDrafts, listOrganizationIds: async () => [] }, artwork, () => now);
    expect(await service.run(context, input)).toEqual({ organizationId: context.organizationId, expiredWorkspaceIds: ["last-save"], cleanup: null,
      reason: "cleanup_failed", errorCode: "INTERNAL_ERROR" });
    expect(expireDrafts).toHaveBeenCalledWith({ organizationId: context.organizationId, now: now.toISOString(), limit: 2 });
    expect(events).toEqual(["expiry_commit", "owner_cleanup"]);
  });

  test("reports failure/busy/recheck counters without claiming successful deletion settled the claim", async () => {
    const store = { expireDrafts: async () => [], listOrganizationIds: async () => [] };
    for (const [counters, reason] of [[{ ...cleanup, failed: 1, remaining: 1 }, "cleanup_failed"],
      [{ ...cleanup, busy: 1, remaining: 1 }, "cleanup_busy"], [{ ...cleanup, deleted: 1, remaining: 1 }, "cleanup_pending"],
      [cleanup, "completed"]] as const) {
      const service = new SalesWorkspaceMaintenanceService(store, { cleanup: async () => counters });
      const completed = await service.run(context, input);
      expect(completed.reason).toBe(reason);
      expect(completed.cleanup).toEqual(counters);
    }
  });

  test("expiry failure skips cleanup, exposes a safe owner code, and remains retryable", async () => {
    const expireDrafts = jest.fn<SalesWorkspaceMaintenanceStore["expireDrafts"]>();
    expireDrafts.mockRejectedValueOnce(new V2ApplicationError("CONFLICT", "lock conflict"));
    expireDrafts.mockResolvedValue([]);
    const artwork = { cleanup: jest.fn(async () => cleanup) };
    const service = new SalesWorkspaceMaintenanceService({ expireDrafts, listOrganizationIds: async () => [] }, artwork);
    expect(await service.run(context, input)).toEqual({ organizationId: context.organizationId, expiredWorkspaceIds: [], cleanup: null, reason: "expiry_failed", errorCode: "CONFLICT" });
    expect(artwork.cleanup).not.toHaveBeenCalled();
    expect((await service.run(context, input)).reason).toBe("completed");
    expect(artwork.cleanup).toHaveBeenCalledTimes(1);
  });
});
