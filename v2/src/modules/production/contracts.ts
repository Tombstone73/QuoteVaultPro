import type { PrincipalKind } from "../../authorization/principals.js";
import type { ArtworkSide } from "../artwork/contracts.js";
import type { ArtworkAssignmentId, ArtworkFileId, CustomerId, OrderId, OrderLineId, OrganizationId, PrepressUnitId, ProductId, ProductionAttemptId, ProductionWorkId } from "../shared/commercialValues.js";
import type { ProductionUnitRequirement } from "../shared/productionRequirements.js";

/** Stable execution destinations. Equipment identity is deliberately deferred. */
export type ProductionStationKey = "flatbed" | "roll";
export type ProductionAttemptKind = "initial" | "reprint" | "correction";
/** Append-only operator evidence.  Control state is derived from this stream. */
export type ProductionWorkEventKind = "hold" | "resume" | "note" | "rework_requested";
export type ProductionWorkState = "ready" | "active" | "held" | "rework_requested" | "complete";
export type ProductionWorkEvent = Readonly<{
  productionWorkEventId: string; organizationId: OrganizationId; productionWorkId: ProductionWorkId;
  sequence: number; kind: ProductionWorkEventKind; category?: string; note?: string;
  reason?: string; productionAttemptId?: ProductionAttemptId;
  recordedGoodQuantity?: number; recordedWasteQuantity?: number; createdAt: string;
  createdPrincipalKind: PrincipalKind; createdPrincipalSubject: string; createdStaffActorUserId?: string;
}>;

/** One durable work identity for one frozen requirement and exact production-Art evidence. */
export type ProductionWork = Readonly<{
  productionWorkId: ProductionWorkId; organizationId: OrganizationId; orderId: OrderId; orderLineId: OrderLineId;
  requirement: ProductionUnitRequirement; artworkAssignmentId: ArtworkAssignmentId; artworkFileId: ArtworkFileId;
  prepressUnitId?: PrepressUnitId; orderedQuantity: number;
  createdAt: string; createdPrincipalKind: PrincipalKind; createdPrincipalSubject: string; createdStaffActorUserId?: string;
}>;

/** Immutable after completion. Output is accumulated only while the attempt is active. */
export type ProductionAttempt = Readonly<{
  productionAttemptId: ProductionAttemptId; organizationId: OrganizationId; productionWorkId: ProductionWorkId; sequence: number;
  kind: ProductionAttemptKind; stationKey: ProductionStationKey; goodQuantity: number; wasteQuantity: number;
  startedAt: string; startedPrincipalKind: PrincipalKind; startedPrincipalSubject: string; startedStaffActorUserId?: string;
  completedAt?: string; completedPrincipalKind?: PrincipalKind; completedPrincipalSubject?: string; completedStaffActorUserId?: string;
}>;

/**
 * Read-only commercial context for an operator. Product text is the frozen
 * Order-line description, not a lookup of the Product's current editable
 * definition. Customer text is a tenant-scoped presentation projection from
 * the owning Order and may be unavailable for legacy rows.
 */
export type ProductionOperatorContext = Readonly<{
  orderNumber?: string;
  product?: Readonly<{ productId: ProductId; displayName: string }>;
  customer?: Readonly<{ customerId: CustomerId; displayName: string }>;
}>;

export type ProductionWorkProjection = Readonly<{
  work: ProductionWork; attempts: readonly ProductionAttempt[]; completedGoodQuantity: number;
  recordedGoodQuantity: number; remainingGoodQuantity: number; activeAttempt?: ProductionAttempt;
  unitQuantitySatisfied: boolean; state: ProductionWorkState; exceptionEvents: readonly ProductionWorkEvent[];
  operatorContext?: ProductionOperatorContext;
}>;
/**
 * Bounded station projection. Attempted work derives its station from the
 * durable attempt; an untouched eligible work appears as Next up in either
 * station until its first attempt selects one. No pre-assigned station state
 * or Kanban column is persisted.
 */
export type ProductionStationQueueItem = ProductionWorkProjection;
export type OpenProductionWorkInput = Readonly<{ businessRequestId: string; artworkAssignmentId: ArtworkAssignmentId }>;
export type StartProductionAttemptInput = Readonly<{ businessRequestId: string; productionWorkId: ProductionWorkId; stationKey: ProductionStationKey; kind: ProductionAttemptKind }>;
export type RecordProductionOutputInput = Readonly<{ businessRequestId: string; productionAttemptId: ProductionAttemptId; goodQuantityDelta: number; wasteQuantityDelta?: number }>;
export type CompleteProductionAttemptInput = Readonly<{ businessRequestId: string; productionAttemptId: ProductionAttemptId }>;
export type HoldProductionWorkInput = Readonly<{ businessRequestId: string; productionWorkId: ProductionWorkId; category: string; note?: string }>;
export type ResumeProductionWorkInput = Readonly<{ businessRequestId: string; productionWorkId: ProductionWorkId; note?: string }>;
export type NoteProductionWorkInput = Readonly<{ businessRequestId: string; productionWorkId: ProductionWorkId; note: string }>;
/** This is deliberately a blocked request, not a route transition or a new handoff. */
export type RequestProductionReworkInput = Readonly<{ businessRequestId: string; productionWorkId: ProductionWorkId; reason: string; category?: string; note?: string }>;
