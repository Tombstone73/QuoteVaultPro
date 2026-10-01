import { z } from "zod";
import { V2ApplicationError } from "../../errors/applicationError.js";
import type { WorkspaceArtworkCleanupSummary, WorkspaceArtworkMaintenance } from "../artwork/workspaceArtwork.js";

/** Internal service scope, not a Staff principal or an HTTP operation context. */
export type WorkspaceMaintenanceContext = Readonly<{
  kind: "service";
  operation: "sales.workspace.maintenance";
  organizationId: string;
}>;

export interface SalesWorkspaceMaintenanceStore {
  /** Sales-owned workspaces establish the tenant scope, including terminal rows. */
  listOrganizationIds(input: Readonly<{ afterOrganizationId: string | null; limit: number }>): Promise<readonly string[]>;
  /** Commits the existing Sales expiry operation before returning. */
  expireDrafts(input: Readonly<{ organizationId: string; now: string; limit: number }>): Promise<readonly string[]>;
}

export type WorkspaceMaintenanceResult = Readonly<{
  organizationId: string;
  expiredWorkspaceIds: readonly string[];
  cleanup: WorkspaceArtworkCleanupSummary | null;
  reason: "completed" | "expiry_failed" | "cleanup_failed" | "cleanup_busy" | "cleanup_pending";
  errorCode?: string;
}>;

export function validateWorkspaceMaintenanceLimit(value: number, maximum = 100): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
    throw new V2ApplicationError("VALIDATION_ERROR", `Maintenance limit must be between 1 and ${maximum}.`);
  }
  return value;
}

export function validateWorkspaceMaintenanceOrganizationId(value: string): string {
  if (!z.string().uuid().safeParse(value).success) {
    throw new V2ApplicationError("VALIDATION_ERROR", "Invalid maintenance organization identity.");
  }
  return value;
}

const contextSchema = z.object({ kind: z.literal("service"), operation: z.literal("sales.workspace.maintenance"),
  organizationId: z.string().uuid() }).strict();

export class SalesWorkspaceMaintenanceService {
  constructor(private readonly store: SalesWorkspaceMaintenanceStore,
    private readonly artwork: WorkspaceArtworkMaintenance, private readonly now: () => Date = () => new Date()) {}

  async run(context: WorkspaceMaintenanceContext, input: Readonly<{ expiryLimit: number; cleanupLimit: number }>): Promise<WorkspaceMaintenanceResult> {
    if (!contextSchema.safeParse(context).success) {
      throw new V2ApplicationError("VALIDATION_ERROR", "Workspace maintenance requires an internal service scope.");
    }
    validateWorkspaceMaintenanceLimit(input.expiryLimit);
    validateWorkspaceMaintenanceLimit(input.cleanupLimit);
    const now = this.now();
    if (!(now instanceof Date) || !Number.isFinite(now.getTime())) {
      throw new V2ApplicationError("VALIDATION_ERROR", "Invalid workspace maintenance time.");
    }
    const organizationId = context.organizationId;
    let expiredWorkspaceIds: readonly string[];
    try {
      expiredWorkspaceIds = await this.store.expireDrafts({ organizationId, now: now.toISOString(), limit: input.expiryLimit });
    } catch (cause) {
      return { organizationId, expiredWorkspaceIds: [], cleanup: null, reason: "expiry_failed",
        errorCode: cause instanceof V2ApplicationError ? cause.code : "INTERNAL_ERROR" };
    }
    try {
      // A crash here is safe: terminal Sales rows and Artwork's durable claims
      // remain discoverable on a later sweep. No provider I/O holds Sales locks.
      const cleanup = await this.artwork.cleanup({ organizationId, limit: input.cleanupLimit });
      return { organizationId, expiredWorkspaceIds, cleanup,
        reason: cleanup.failed ? "cleanup_failed" : cleanup.busy ? "cleanup_busy" : cleanup.remaining ? "cleanup_pending" : "completed" };
    } catch (cause) {
      return { organizationId, expiredWorkspaceIds, cleanup: null, reason: "cleanup_failed",
        errorCode: cause instanceof V2ApplicationError ? cause.code : "INTERNAL_ERROR" };
    }
  }
}
