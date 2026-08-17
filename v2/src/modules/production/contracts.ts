import type { PrincipalKind } from "../../authorization/principals.js";
import type { ArtworkSide } from "../artwork/contracts.js";
import type { ArtworkAssignmentId, ArtworkFileId, OrderId, OrderLineId, OrganizationId, PrepressUnitId, ProductionAttemptId, ProductionWorkId } from "../shared/commercialValues.js";
import type { ProductionUnitRequirement } from "../shared/productionRequirements.js";

/** Stable execution destinations. Equipment identity is deliberately deferred. */
export type ProductionStationKey = "flatbed" | "roll";
export type ProductionAttemptKind = "initial" | "reprint" | "correction";

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

export type ProductionWorkProjection = Readonly<{
  work: ProductionWork; attempts: readonly ProductionAttempt[]; completedGoodQuantity: number; unitQuantitySatisfied: boolean;
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
