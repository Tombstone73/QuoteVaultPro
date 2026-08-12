import { and, eq } from "drizzle-orm";

import { orders } from "@shared/schema";
import { db } from "../db";
import { ReturnToPrepressError, returnProductionJobsToPrepressInTransaction } from "./productionReturnToPrepressService";
import { findActiveJobForLineItem } from "./productionOwnership";

/**
 * The safe Prepress recovery boundary.  It intentionally owns only the
 * established Production -> Prepress return path; artwork, destination, and
 * material-override editors retain their existing specialized services.
 */
export class CanonicalPrepressOperations {
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
