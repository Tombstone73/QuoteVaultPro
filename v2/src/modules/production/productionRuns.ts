import type { ProductionStationKey } from "./contracts.js";

/**
 * Small, transport-independent authority for Production Run transitions and
 * quantities.  The persistence adapter supplies locked member snapshots; it
 * must never infer quantities from a UI selection.
 */
export type ProductionRunState = "draft" | "ready" | "active" | "held" | "completed" | "cancelled";
export type RunTransition = "ready" | "start" | "hold" | "resume" | "complete" | "cancel";
export type ProductionAttemptTerminalDisposition = "successful" | "released" | "cancelled";
export type PreparedArtwork = Readonly<{
  artworkAssignmentId: string;
  artworkFileId: string;
  /** Immutable assignment content identity plus the storage-object version. */
  identityFingerprint: string;
  objectVersion: string;
}>;
export type RunMemberSnapshot = Readonly<{
  productionWorkId: string;
  stationKey: ProductionStationKey;
  materialFingerprint: string | null;
  orderedQuantity: number;
  recordedGoodQuantity: number;
  reservedByOtherRuns: number;
  requestedQuantity: number;
}>;

export const availableForRun = (member: RunMemberSnapshot): number =>
  Math.max(0, member.orderedQuantity - member.recordedGoodQuantity - member.reservedByOtherRuns);

export const assertCompatibleRunMembers = (station: ProductionStationKey, members: readonly RunMemberSnapshot[]): void => {
  if (!members.length || members.length > 50) throw new Error("A Production Run must contain between one and fifty work items.");
  const ids = new Set<string>();
  let material: string | null | undefined;
  for (const member of members) {
    if (!member.productionWorkId || ids.has(member.productionWorkId)) throw new Error("A Production work item can appear only once in a Production Run.");
    ids.add(member.productionWorkId);
    if (member.stationKey !== station) throw new Error("Production Run members must share their frozen station destination.");
    if (!Number.isSafeInteger(member.requestedQuantity) || member.requestedQuantity <= 0) throw new Error("Run allocation quantities must be positive whole units.");
    if (member.requestedQuantity > availableForRun(member)) throw new Error("Run allocation exceeds the Production work available for a new run.");
    // A null fingerprint means there is no canonical material identity to
    // compare.  It is compatible only with other unknown-material work; the
    // operator cannot use runs to fabricate a material assignment.
    if (material === undefined) material = member.materialFingerprint;
    else if (material !== member.materialFingerprint) throw new Error("Production Run members must share canonical material evidence.");
  }
};

export const nextRunState = (current: ProductionRunState, transition: RunTransition, allAllocatedQuantityDisposed = false): ProductionRunState => {
  const map: Record<ProductionRunState, Partial<Record<RunTransition, ProductionRunState>>> = {
    draft: { ready: "ready", cancel: "cancelled" },
    ready: { start: "active", cancel: "cancelled" },
    active: { hold: "held", complete: "completed", cancel: "cancelled" },
    held: { resume: "active", cancel: "cancelled" },
    completed: {}, cancelled: {},
  };
  const next = map[current][transition];
  if (!next) throw new Error(`Production Run cannot ${transition} from ${current}.`);
  if (transition === "complete" && !allAllocatedQuantityDisposed) throw new Error("A Production Run cannot complete until every allocation has a final disposition.");
  return next;
};

export const remainingRunAllocation = (allocatedQuantity: number, goodQuantity: number, wasteQuantity: number): number => {
  if (![allocatedQuantity, goodQuantity, wasteQuantity].every(Number.isSafeInteger) || allocatedQuantity <= 0 || goodQuantity < 0 || wasteQuantity < 0) throw new Error("Run quantities must be non-negative whole units.");
  if (goodQuantity > allocatedQuantity) throw new Error("Run good output exceeds its allocation.");
  // Waste is evidence, not a substitute for an allocation or fulfillment.
  return allocatedQuantity - goodQuantity;
};

/** Reservations are only the unproduced part of an allocation. Waste remains
 * execution evidence; it never consumes a fulfillment or completion quantity. */
export const unusedRunReservationQuantity = (allocatedQuantity: number, goodQuantity: number, released: boolean): number =>
  released ? 0 : remainingRunAllocation(allocatedQuantity, goodQuantity, 0);

export const runAllocationIsResolved = (allocation: Readonly<{allocatedQuantity:number;goodQuantity:number;releasedAt?:string}>): boolean =>
  allocation.goodQuantity >= allocation.allocatedQuantity || allocation.releasedAt !== undefined;

export const canCompleteProductionRun = (allocations: readonly Readonly<{allocatedQuantity:number;goodQuantity:number;releasedAt?:string}>[]): boolean =>
  allocations.length > 0 && allocations.every(runAllocationIsResolved);

/**
 * The only terminal credit is recorded good output. A release/cancellation
 * closes its linked attempt to prevent it remaining active, but cannot turn
 * unused reservation or waste into completed Production.
 */
export const terminalDispositionForRunAllocation = (
  allocatedQuantity: number,
  goodQuantity: number,
  wasCancelled: boolean,
): ProductionAttemptTerminalDisposition => {
  if (!Number.isSafeInteger(allocatedQuantity) || !Number.isSafeInteger(goodQuantity) || allocatedQuantity <= 0 || goodQuantity < 0 || goodQuantity > allocatedQuantity) {
    throw new Error("Run allocation disposition requires valid Production quantities.");
  }
  return goodQuantity === allocatedQuantity ? "successful" : wasCancelled ? "cancelled" : "released";
};

/**
 * A Run is a preparation for exact artwork evidence, never a pointer that may
 * silently float to a newer file.  The persistence adapter obtains both sides
 * under its transaction locks; this pure comparison keeps the conflict shape
 * deterministic for every transport.
 */
export const preparedArtworkIsCurrent = (prepared: PreparedArtwork, current: PreparedArtwork): boolean =>
  prepared.artworkAssignmentId === current.artworkAssignmentId
  && prepared.artworkFileId === current.artworkFileId
  && prepared.identityFingerprint === current.identityFingerprint
  && prepared.objectVersion === current.objectVersion;

export const canRefreshRunPreparation = (state: ProductionRunState): boolean => state === "draft" || state === "ready";
