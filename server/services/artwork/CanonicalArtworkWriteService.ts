import type { LineItemArtwork } from "@shared/schema";
import { lineItemArtwork, orderLineItems, orders, orderAuditLog } from "@shared/schema";
import { and, eq } from "drizzle-orm";
import { lockWorkflowLines } from "../workflowMutationLock";
import { lineItemArtworkService } from "./LineItemArtworkService";

type CompatibilitySide = "front" | "back" | "both" | "na" | null | undefined;

function toArtworkSide(side: CompatibilitySide): LineItemArtwork["side"] {
  if (side === "front" || side === "back" || side === "both") return side;
  return "unknown";
}

type CanonicalWriteInput = {
  tx: any;
  organizationId: string;
  orderId: string;
  lineItemId: string;
  fileRecordId: string;
  side?: CompatibilitySide;
  allocationQuantity?: number | null;
  allocationGroupId?: string | null;
  actorUserId?: string | null;
};

type SourceArtworkOrigin = Extract<LineItemArtwork["origin"], "customer_upload" | "staff_upload" | "legacy_backfill">;

/**
 * The single write boundary for newly migrated artwork flows. Compatibility
 * projections are created by the caller in the same transaction after this
 * relationship has been accepted.
 */
export class CanonicalArtworkWriteService {
  async attachSourceArtwork(input: CanonicalWriteInput & { origin?: SourceArtworkOrigin; replacesArtworkId?: string | null; proofingEdit?: boolean }) {
    let prior: LineItemArtwork | undefined;
    if (input.replacesArtworkId || input.proofingEdit) {
      await lockWorkflowLines(input.tx, input.organizationId, [input.lineItemId]);
      const [context] = await input.tx.select({ line: orderLineItems, order: orders }).from(orderLineItems)
        .innerJoin(orders, eq(orders.id, orderLineItems.orderId)).where(and(eq(orders.organizationId, input.organizationId), eq(orderLineItems.id, input.lineItemId)));
      if (!context || context.order.id !== input.orderId || !["needs_design", "in_design", "ready_for_prepress", "in_prepress", "awaiting_proof_approval"].includes(context.line.workflowState)
        || context.order.closedAt || ["canceled", "cancelled", "closed"].includes(context.order.status)) {
        throw Object.assign(new Error("Source artwork revisions require active Design, Prepress or Proofing work. Use the production return/rework workflow for released work."), { statusCode: 409 });
      }
      if (input.replacesArtworkId) {
        [prior] = await input.tx.select().from(lineItemArtwork).where(and(eq(lineItemArtwork.organizationId, input.organizationId), eq(lineItemArtwork.id, input.replacesArtworkId), eq(lineItemArtwork.lineItemId, input.lineItemId)));
        if (!prior || prior.role !== "customer_source" || prior.status !== "current" || prior.fileRecordId === input.fileRecordId) {
          throw Object.assign(new Error("The selected source artwork is no longer current. Refresh artwork before uploading its replacement."), { statusCode: 409 });
        }
      }
    }
    const created = await lineItemArtworkService.attachArtworkInTransaction(input.tx, {
      ...input,
      role: "customer_source",
      side: toArtworkSide(input.side),
      origin: input.origin ?? "staff_upload",
      allocationQuantity: input.allocationQuantity ?? prior?.allocationQuantity ?? null,
      allocationGroupId: input.allocationGroupId ?? prior?.allocationGroupId ?? null,
      parentArtworkId: prior?.id ?? null,
      supersedesArtworkId: prior?.id ?? null,
    });
    let proofRevision: unknown = null;
    if (prior || input.proofingEdit) {
      if (!input.actorUserId) throw Object.assign(new Error("Authenticated staff identity required for a Proofing artwork revision."), { statusCode: 403 });
      const { retireProofAuthorityForUpstream } = await import("../proofingService");
      proofRevision = await retireProofAuthorityForUpstream(input.tx, { organizationId: input.organizationId, orderId: input.orderId,
        lineItemId: input.lineItemId, actorUserId: input.actorUserId, destination: "design", reason: prior ? "Source artwork revised in Proofing" : "Source artwork added in Proofing" });
    }
    if (prior) {
      await lineItemArtworkService.supersedeArtworkInTransaction(input.tx, { organizationId: input.organizationId, artworkId: prior.id, replacementArtworkId: created.id, actorUserId: input.actorUserId });
      await input.tx.insert(orderAuditLog).values({ orderId: input.orderId, orderLineItemId: input.lineItemId, userId: input.actorUserId,
        actionType: "source_artwork_revised", metadata: { priorArtworkId: prior.id, replacementArtworkId: created.id, priorFileRecordId: prior.fileRecordId, fileRecordId: created.fileRecordId, proofRevision } });
    }
    if (input.proofingEdit && !prior) await input.tx.insert(orderAuditLog).values({ orderId: input.orderId, orderLineItemId: input.lineItemId, userId: input.actorUserId,
      actionType: "source_artwork_added", metadata: { artworkId: created.id, fileRecordId: created.fileRecordId, proofRevision } });
    return created;
  }

  async promoteArtworkForProduction(input: CanonicalWriteInput & { parentArtworkId?: string | null }) {
    return lineItemArtworkService.attachArtworkInTransaction(input.tx, {
      ...input,
      role: "production",
      side: toArtworkSide(input.side),
      origin: "promoted_existing",
      parentArtworkId: input.parentArtworkId ?? null,
    });
  }

  async createModifiedArtwork(input: CanonicalWriteInput & { parentArtworkId: string; supersedesArtworkId?: string | null }) {
    return lineItemArtworkService.createModifiedArtworkVersionInTransaction(input.tx, {
      ...input,
      parentArtworkId: input.parentArtworkId,
      supersedesArtworkId: input.supersedesArtworkId ?? null,
      side: toArtworkSide(input.side),
    });
  }

  async supersedeArtwork(input: {
    tx: any;
    organizationId: string;
    artworkId: string;
    replacementArtworkId: string;
    actorUserId?: string | null;
  }) {
    return lineItemArtworkService.supersedeArtworkInTransaction(input.tx, input);
  }
}

export const canonicalArtworkWriteService = new CanonicalArtworkWriteService();
