import { and, eq } from "drizzle-orm";

import { orders, userOrganizations } from "@shared/schema";
import { hasAdminOrOwnerOperationalRole } from "@shared/roleAccess";
import { db } from "../db";
import { ReturnToPrepressError, returnProductionJobsToPrepressInTransaction } from "./productionReturnToPrepressService";
import { findActiveJobForLineItem, isPrepressOwnershipJob } from "./productionOwnership";
import { lockWorkflowLines } from "./workflowMutationLock";

/**
 * The safe Prepress recovery boundary.  It intentionally owns only the
 * established Production -> Prepress return path; artwork, destination, and
 * material-override editors retain their existing specialized services.
 */
export class CanonicalPrepressOperations {
  /** Order checkbox entry point: shares the return engine and save transaction. */
  async requestUnstartedLineInTransaction(tx: any, input: {
    organizationId: string; actorUserId: string; lineItemId: string; expectedOwnerJobId: string;
  }) {
    const [membership] = await tx.select({ role: userOrganizations.role }).from(userOrganizations).where(and(eq(userOrganizations.organizationId, input.organizationId), eq(userOrganizations.userId, input.actorUserId))).limit(1);
    if (!hasAdminOrOwnerOperationalRole(membership?.role)) throw new ReturnToPrepressError("The existing Order line editing permission is required to request Prepress.", 403, "RETURN_TO_PREPRESS_FORBIDDEN");
    await lockWorkflowLines(tx, input.organizationId, [input.lineItemId]);
    const owner = await findActiveJobForLineItem(tx, input);
    if (!owner || owner.id !== input.expectedOwnerJobId) throw new ReturnToPrepressError("Production ownership changed. Refresh before requesting Prepress.", 409, "RETURN_TO_PREPRESS_OWNER_CHANGED");
    const station = owner.stationKey === "wide_roll" ? "roll" : owner.stationKey;
    if (isPrepressOwnershipJob(owner) || (station !== "flatbed" && station !== "roll")) throw new ReturnToPrepressError("Open the current production station to resolve this item.", 409, "RETURN_TO_PREPRESS_WRONG_STATION");
    const [result] = await returnProductionJobsToPrepressInTransaction(tx, {
      ...input, station, jobIds: [owner.id], requireUnstarted: true,
      reason: "Prepress requested from the Order line to prepare separate production-ready artwork. Existing source uploads are retained.",
    });
    const returnedOwner = await findActiveJobForLineItem(tx, input);
    if (returnedOwner?.id !== result.prepressJobId) throw new ReturnToPrepressError("Prepress ownership could not be confirmed.", 409, "RETURN_TO_PREPRESS_RESTORE_FAILED");
    return { ...result, toState: "in_prepress" as const, activeOwnerJobId: result.prepressJobId, activeOwnerStationKey: returnedOwner.stationKey, activeOwnerStepKey: returnedOwner.stepKey };
  }

  async returnProductionJobs(input: {
    organizationId: string;
    actorUserId: string;
    station: "flatbed" | "roll";
    jobIds: string[];
    reason: string;
  }) {
    return db.transaction((tx) => returnProductionJobsToPrepressInTransaction(tx, input));
  }

  async returnLineItemFromProduction(input: {
    organizationId: string;
    actorUserId: string;
    lineItemId: string;
    reason: string;
  }) {
    const job = await db.transaction(async (tx) => {
      const active = await findActiveJobForLineItem(tx, { organizationId: input.organizationId, lineItemId: input.lineItemId });
      if (!active) return null;
      const [ownedOrder] = await tx.select({ id: orders.id }).from(orders).where(and(
        eq(orders.id, active.orderId),
        eq(orders.organizationId, input.organizationId),
      )).limit(1);
      return ownedOrder ? active : null;
    });
    if (!job) throw new ReturnToPrepressError("No tenant-owned production job is available for this line item.", 404, "RETURN_TO_PREPRESS_JOB_NOT_FOUND");
    const station = String(job.stationKey || "").toLowerCase() === "wide_roll" ? "roll" : String(job.stationKey || "").toLowerCase();
    if (station !== "flatbed" && station !== "roll") {
      throw new ReturnToPrepressError("This line item is not currently owned by a returnable production station.", 409, "RETURN_TO_PREPRESS_WRONG_STATION");
    }
    const [result] = await this.returnProductionJobs({ ...input, station, jobIds: [job.id] });
    return result;
  }
}

export const canonicalPrepressOperations = new CanonicalPrepressOperations();

export function renderCanonicalPrepressOperationMigrationMarkdown() {
  return `# Shared canonical Prepress operations\n\n| Operation | Existing state owner | Shared use | Deferred |\n|---|---|---|---|\n| \`prepress.return_from_production.v1\` | \`productionReturnToPrepressService\` plus line-item workflow service | Production board and confirmed Assistant edit-return adapter | Files, artwork resolution, destination and material override editing remain specialized UI services |\n\nThe operation locks tenant-owned jobs, blocks active combined runs and printing/terminal recovery, restores a Prepress owner/session, and writes the existing audit history.\n`;
}
