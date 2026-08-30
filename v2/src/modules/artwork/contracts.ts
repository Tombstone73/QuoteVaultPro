import type { ArtworkAssignmentId, ArtworkFileId, OrderId, OrderLineId, OrganizationId } from "../shared/commercialValues.js";

/** Opaque object identity: URLs and browser tokens are deliberately excluded. */
export type ArtworkObjectReference = Readonly<{
  storageProvider: string;
  objectKey: string;
  objectVersion?: string;
}>;

export type ArtworkObjectStorageAdapter = Readonly<{
  /** Storage resolution is infrastructure, never application authority. */
  resolve(reference: ArtworkObjectReference): Promise<unknown>;
}>;

export type ArtworkSource = "customer_upload" | "prepress_derived" | "imported";
export type ArtworkPurpose = "customer_supplied" | "production" | "proof" | "reference";
export type ArtworkSide = "front" | "back";

export type ArtworkFile = Readonly<{
  id: ArtworkFileId;
  organizationId: OrganizationId;
  objectReference: ArtworkObjectReference;
  originalFilename: string;
  displayFilename: string;
  contentType: string;
  byteSize: number;
  checksum?: Readonly<{ algorithm: "sha256"; value: string }>;
  source: ArtworkSource;
  pageCount?: number;
  detectedWidthMicrons?: number;
  detectedHeightMicrons?: number;
  derivedFromArtworkFileId?: ArtworkFileId;
  createdAt: string;
}>;

export type ArtworkAssignment = Readonly<{
  id: ArtworkAssignmentId;
  organizationId: OrganizationId;
  artworkFileId: ArtworkFileId;
  orderId: OrderId;
  orderLineId: OrderLineId;
  purpose: ArtworkPurpose;
  side?: ArtworkSide;
  /** Zero-based index of a physical source file page, where selected. */
  sourcePageIndex?: number;
  layerKey?: string;
  layerOrder?: number;
  /** The prior immutable Order assignment when this is a current replacement. */
  supersedesArtworkAssignmentId?: ArtworkAssignmentId;
  createdAt: string;
}>;

export type OrderLineArtworkProjection = Readonly<{
  assignment: ArtworkAssignment;
  file: ArtworkFile;
}>;

export type ArtworkUsageInput = Readonly<{
  orderId: OrderId;
  orderLineId: OrderLineId;
  purpose: ArtworkPurpose;
  side?: ArtworkSide;
  sourcePageIndex?: number;
  layerKey?: string;
  layerOrder?: number;
}>;

export type ArtworkFileInput = Readonly<{
  objectReference: ArtworkObjectReference;
  originalFilename: string;
  displayFilename?: string;
  contentType: string;
  byteSize: number;
  checksum?: Readonly<{ algorithm: "sha256"; value: string }>;
  source: ArtworkSource;
  pageCount?: number;
  detectedWidthMicrons?: number;
  detectedHeightMicrons?: number;
}>;

export type AdoptArtworkInput = ArtworkFileInput & Readonly<{
  businessRequestId: string;
  usage: ArtworkUsageInput;
}>;

/** A new current Order artwork choice that preserves the prior assignment. */
export type ReplaceArtworkInput = ArtworkFileInput & Readonly<{
  businessRequestId: string;
  supersedesArtworkAssignmentId: ArtworkAssignmentId;
  usage: ArtworkUsageInput;
}>;

export type AssignArtworkInput = Readonly<{
  businessRequestId: string;
  artworkFileId: ArtworkFileId;
  usage: ArtworkUsageInput;
}>;

export type DeriveArtworkInput = ArtworkFileInput & Readonly<{
  businessRequestId: string;
  derivedFromArtworkFileId: ArtworkFileId;
  usage: ArtworkUsageInput;
}>;

export type ArtworkMutationResult = Readonly<{
  artworkFile: ArtworkFile;
  assignment: ArtworkAssignment;
}>;

export const validateArtworkObjectReference = (reference: ArtworkObjectReference): ArtworkObjectReference => {
  if (!reference.storageProvider.trim() || !reference.objectKey.trim())
    throw new Error("Artwork storage provider and object key are required.");
  if (reference.objectVersion !== undefined && !reference.objectVersion.trim())
    throw new Error("Artwork object version cannot be blank.");
  return reference;
};

export const validateArtworkUsage = (usage: ArtworkUsageInput): ArtworkUsageInput => {
  if (!usage.orderId || !usage.orderLineId) throw new Error("Artwork usage requires a real OrderLine.");
  if (usage.sourcePageIndex !== undefined && (!Number.isInteger(usage.sourcePageIndex) || usage.sourcePageIndex < 0))
    throw new Error("Artwork source page index must be a non-negative integer.");
  if (usage.layerOrder !== undefined && (!Number.isInteger(usage.layerOrder) || usage.layerOrder < 0))
    throw new Error("Artwork layer order must be a non-negative integer.");
  if ((usage.layerKey === undefined) !== (usage.layerOrder === undefined))
    throw new Error("Artwork layer key and order must be supplied together.");
  if (usage.layerKey !== undefined && !usage.layerKey.trim()) throw new Error("Artwork layer key cannot be blank.");
  return usage;
};
