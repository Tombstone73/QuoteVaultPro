import type { LineItemArtwork } from "@shared/schema";
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
  async attachSourceArtwork(input: CanonicalWriteInput & { origin?: SourceArtworkOrigin }) {
    return lineItemArtworkService.attachArtworkInTransaction(input.tx, {
      ...input,
      role: "customer_source",
      side: toArtworkSide(input.side),
      origin: input.origin ?? "staff_upload",
    });
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
