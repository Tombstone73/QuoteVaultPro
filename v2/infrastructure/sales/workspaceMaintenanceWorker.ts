import { resolveV2MutationWorkerStartup } from "../../src/deployment/mutationWorkerStartup.js";
import { V2ApplicationError } from "../../src/errors/applicationError.js";
import { validateWorkspaceMaintenanceLimit, validateWorkspaceMaintenanceOrganizationId,
  type SalesWorkspaceMaintenanceService, type SalesWorkspaceMaintenanceStore, type WorkspaceMaintenanceResult } from "../../src/modules/sales/workspaceMaintenance.js";

/** Counters describe owner results observed in this tick, not a global backlog
 * or operations whose owner call failed before returning its summary. */
export type WorkspaceMaintenanceTickSummary = Readonly<{
  reason: "completed" | "partial" | "mutation_workers_disabled" | "workspace_maintenance_disabled" | "busy" | "stopped" | "scan_failed";
  afterOrganizationId: string | null;
  organizationsScanned: number;
  organizationsProcessed: number;
  expired: number;
  inspected: number;
  deleted: number;
  retained: number;
  failed: number;
  busy: number;
  /** Selected tenants' backlog only; null when a count or tenant result is unavailable. */
  remaining: number | null;
  /** Observed subtotal, never a zero substitute for unknown remaining work. */
  knownRemaining: number;
  failedOrganizations: number;
  organizations: readonly WorkspaceMaintenanceResult[];
  errorCode?: string;
  observerFailed?: boolean;
}>;

export type WorkspaceMaintenanceWorkerOptions = Readonly<{
  store: Pick<SalesWorkspaceMaintenanceStore, "listOrganizationIds">;
  maintenance: Pick<SalesWorkspaceMaintenanceService, "run">;
  environment?: Readonly<Record<string, string | undefined>>;
  intervalMs?: number;
  tenantLimit?: number;
  expiryLimit?: number;
  cleanupLimit?: number;
  afterOrganizationId?: string | null;
  onResult?: (summary: WorkspaceMaintenanceTickSummary) => void;
}>;

export class WorkspaceMaintenanceWorker {
  private readonly intervalMs: number;
  private readonly tenantLimit: number;
  private readonly expiryLimit: number;
  private readonly cleanupLimit: number;
  private readonly disabledReason: "mutation_workers_disabled" | "workspace_maintenance_disabled" | null;
  private cursor: string | null;
  private timer?: NodeJS.Timeout;
  private active?: Promise<WorkspaceMaintenanceTickSummary>;
  private scheduling = false;
  private stopped = false;
  private result?: WorkspaceMaintenanceTickSummary;

  constructor(private readonly options: WorkspaceMaintenanceWorkerOptions) {
    this.intervalMs = options.intervalMs ?? 60_000;
    if (!Number.isSafeInteger(this.intervalMs) || this.intervalMs < 1_000 || this.intervalMs > 3_600_000) {
      throw new V2ApplicationError("VALIDATION_ERROR", "Maintenance interval must be between 1000 and 3600000 milliseconds.");
    }
    this.tenantLimit = validateWorkspaceMaintenanceLimit(options.tenantLimit ?? 4, 25);
    this.expiryLimit = validateWorkspaceMaintenanceLimit(options.expiryLimit ?? 25);
    this.cleanupLimit = validateWorkspaceMaintenanceLimit(options.cleanupLimit ?? 25);
    this.cursor = options.afterOrganizationId ?? null;
    if (this.cursor !== null) validateWorkspaceMaintenanceOrganizationId(this.cursor);
    const environment = options.environment ?? process.env;
    this.disabledReason = !resolveV2MutationWorkerStartup(environment).enabled ? "mutation_workers_disabled"
      : environment.V2_WORKSPACE_MAINTENANCE_ENABLED?.trim().toLowerCase() !== "true" ? "workspace_maintenance_disabled" : null;
  }

  get afterOrganizationId(): string | null { return this.cursor; }
  get lastResult(): WorkspaceMaintenanceTickSummary | undefined { return this.result; }

  /** Parent runtime decides whether to call this after review. No startup sweep. */
  start(): void {
    if (this.stopped || this.disabledReason || this.scheduling) return;
    this.scheduling = true;
    this.schedule();
  }

  private schedule(): void {
    if (!this.scheduling || this.stopped || this.active || this.timer) return;
    this.timer = setTimeout(() => { this.timer = undefined; void this.tick(); }, this.intervalMs);
    this.timer.unref();
  }

  tick(): Promise<WorkspaceMaintenanceTickSummary> {
    if (this.stopped || this.disabledReason || this.active) {
      return Promise.resolve(this.empty(this.stopped ? "stopped" : this.disabledReason ?? "busy"));
    }
    if (this.timer) { clearTimeout(this.timer); this.timer = undefined; }
    this.active = this.runTick().then((summary) => {
      try { this.options.onResult?.(summary); }
      catch { summary = { ...summary, observerFailed: true }; }
      this.result = summary;
      return summary;
    }).finally(() => { this.active = undefined; this.schedule(); });
    return this.active;
  }

  async stop(): Promise<void> {
    this.stopped = true;
    this.scheduling = false;
    if (this.timer) { clearTimeout(this.timer); this.timer = undefined; }
    // Let the current tenant's committed expiry and owner cleanup settle; never
    // release its locks/connections early or start another tenant during stop.
    await this.active;
  }

  private empty(reason: WorkspaceMaintenanceTickSummary["reason"]): WorkspaceMaintenanceTickSummary {
    return { reason, afterOrganizationId: this.cursor, organizationsScanned: 0, organizationsProcessed: 0,
      expired: 0, inspected: 0, deleted: 0, retained: 0, failed: 0, busy: 0, remaining: null, knownRemaining: 0,
      failedOrganizations: 0, organizations: [] };
  }

  private async runTick(): Promise<WorkspaceMaintenanceTickSummary> {
    const summary = { ...this.empty("completed"), remaining: 0 as number | null, organizations: [] as WorkspaceMaintenanceResult[] };
    let organizationIds: readonly string[];
    try {
      organizationIds = await this.options.store.listOrganizationIds({ afterOrganizationId: this.cursor, limit: this.tenantLimit });
      if (organizationIds.length > this.tenantLimit) throw new V2ApplicationError("VALIDATION_ERROR", "Maintenance tenant batch exceeded its limit.");
      let previous = this.cursor ?? "";
      for (const id of organizationIds) {
        validateWorkspaceMaintenanceOrganizationId(id);
        if (id <= previous) throw new V2ApplicationError("VALIDATION_ERROR", "Maintenance tenant cursor did not advance.");
        previous = id;
      }
    } catch (cause) {
      return { ...summary, reason: "scan_failed", remaining: null,
        errorCode: cause instanceof V2ApplicationError ? cause.code : "INTERNAL_ERROR" };
    }
    summary.organizationsScanned = organizationIds.length;
    if (!organizationIds.length) this.cursor = null;
    for (const organizationId of organizationIds) {
      if (this.stopped) break;
      // Even failed/ambiguous cleanup advances the cursor. An unhealthy first
      // tenant must not monopolize every tick; wrap happens after the final page.
      this.cursor = organizationId;
      let result: WorkspaceMaintenanceResult;
      try {
        result = await this.options.maintenance.run({ kind: "service", operation: "sales.workspace.maintenance", organizationId },
          { expiryLimit: this.expiryLimit, cleanupLimit: this.cleanupLimit });
      } catch (cause) {
        result = { organizationId, expiredWorkspaceIds: [], cleanup: null, reason: "expiry_failed",
          errorCode: cause instanceof V2ApplicationError ? cause.code : "INTERNAL_ERROR" };
      }
      summary.organizations.push(result);
      summary.organizationsProcessed += 1;
      summary.expired += result.expiredWorkspaceIds.length;
      if (result.reason === "expiry_failed" || result.reason === "cleanup_failed") summary.failedOrganizations += 1;
      if (result.cleanup) {
        for (const key of ["inspected", "deleted", "retained", "failed", "busy"] as const) summary[key] += result.cleanup[key];
        summary.knownRemaining += result.cleanup.remaining;
        if (summary.remaining !== null) summary.remaining += result.cleanup.remaining;
      } else summary.remaining = null;
    }
    if (this.stopped) summary.remaining = null;
    return { ...summary, reason: this.stopped ? "stopped"
      : summary.remaining === null || summary.organizations.some((result) => result.reason !== "completed") ? "partial" : "completed",
      afterOrganizationId: this.cursor, ...(summary.remaining === null ? { errorCode: "CLEANUP_COUNT_UNAVAILABLE" } : {}) };
  }
}

export function startWorkspaceMaintenanceWorker(options: WorkspaceMaintenanceWorkerOptions): WorkspaceMaintenanceWorker {
  const worker = new WorkspaceMaintenanceWorker(options);
  worker.start();
  return worker;
}
