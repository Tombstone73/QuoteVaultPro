import type {
  ArtworkFileId,
  OrganizationId,
  QuoteAcceptedArtworkSnapshotId,
  QuoteArtworkAssignmentId,
  QuoteCheckpointId,
  QuoteId,
  SalesLineId,
} from "../shared/commercialValues.js";
import type { ArtworkFile, ArtworkPurpose, ArtworkSide } from "./contracts.js";

/**
 * A mutable Quote-line use of an Artwork-owned binary.  This is deliberately
 * separate from Order artwork: Quote is source evidence while an Order owns
 * the downstream editable assignment after conversion.
 */
export type QuoteArtworkAssignment = Readonly<{
  id: QuoteArtworkAssignmentId;
  organizationId: OrganizationId;
  quoteId: QuoteId;
  quoteLineId: SalesLineId;
  artworkFileId: ArtworkFileId;
  purpose: ArtworkPurpose;
  side?: ArtworkSide;
  sourcePageIndex?: number;
  layerKey?: string;
  layerOrder?: number;
  createdAt: string;
}>;

export type QuoteLineArtworkProjection = Readonly<{
  assignment: QuoteArtworkAssignment;
  file: ArtworkFile;
}>;

/** Immutable normalized evidence captured with the one quote_accepted checkpoint. */
export type QuoteAcceptedArtworkSnapshot = Readonly<{
  id: QuoteAcceptedArtworkSnapshotId;
  organizationId: OrganizationId;
  quoteId: QuoteId;
  acceptanceCheckpointId: QuoteCheckpointId;
  quoteLineId: SalesLineId;
  quoteArtworkAssignmentId: QuoteArtworkAssignmentId;
  artworkFileId: ArtworkFileId;
  purpose: ArtworkPurpose;
  side?: ArtworkSide;
  sourcePageIndex?: number;
  layerKey?: string;
  layerOrder?: number;
  evidenceFingerprint: string;
  createdAt: string;
}>;

export type QuoteArtworkUsageInput = Readonly<{
  quoteId: QuoteId;
  quoteLineId: SalesLineId;
  purpose: ArtworkPurpose;
  side?: ArtworkSide;
  sourcePageIndex?: number;
  layerKey?: string;
  layerOrder?: number;
}>;

export const validateQuoteArtworkUsage = (
  usage: QuoteArtworkUsageInput,
): QuoteArtworkUsageInput => {
  if (!usage.quoteId || !usage.quoteLineId)
    throw new Error("Quote artwork usage requires a real QuoteLine.");
  if (
    usage.sourcePageIndex !== undefined &&
    (!Number.isInteger(usage.sourcePageIndex) || usage.sourcePageIndex < 0)
  )
    throw new Error("Artwork source page index must be a non-negative integer.");
  if (
    usage.layerOrder !== undefined &&
    (!Number.isInteger(usage.layerOrder) || usage.layerOrder < 0)
  )
    throw new Error("Artwork layer order must be a non-negative integer.");
  if ((usage.layerKey === undefined) !== (usage.layerOrder === undefined))
    throw new Error("Artwork layer key and order must be supplied together.");
  if (usage.layerKey !== undefined && !usage.layerKey.trim())
    throw new Error("Artwork layer key cannot be blank.");
  return usage;
};
