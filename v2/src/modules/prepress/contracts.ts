import type { PrincipalKind } from "../../authorization/principals.js";
import type { ArtworkAssignmentId, ArtworkFileId, OrderId, OrderLineId, OrganizationId, PrepressUnitId } from "../shared/commercialValues.js";
import type { ArtworkSide } from "../artwork/contracts.js";
import type { ProductionUnitRequirement } from "../shared/productionRequirements.js";

/** One independently prepared, explicitly selected production-Artwork usage. */
export type PrepressUnit = Readonly<{
  prepressUnitId: PrepressUnitId;
  organizationId: OrganizationId;
  orderId: OrderId;
  orderLineId: OrderLineId;
  artworkAssignmentId: ArtworkAssignmentId;
  artworkFileId: ArtworkFileId;
  side?: ArtworkSide;
  sourcePageIndex?: number;
  layerKey?: string;
  layerOrder?: number;
  createdAt: string;
  createdPrincipalKind: PrincipalKind;
  createdPrincipalSubject: string;
  createdStaffActorUserId?: string;
  startedAt?: string;
  startedPrincipalKind?: PrincipalKind;
  startedPrincipalSubject?: string;
  startedStaffActorUserId?: string;
  completedAt?: string;
  completedPrincipalKind?: PrincipalKind;
  completedPrincipalSubject?: string;
  completedStaffActorUserId?: string;
}>;

/** Deliberately derived: Prepress does not persist a second Routing/workflow status. */
export const prepressUnitState = (unit: PrepressUnit): "available" | "in_progress" | "completed" =>
  unit.completedAt ? "completed" : unit.startedAt ? "in_progress" : "available";

export type OpenPrepressUnitInput = Readonly<{ businessRequestId: string; artworkAssignmentId: ArtworkAssignmentId }>;
export type StartPrepressUnitInput = Readonly<{ businessRequestId: string; prepressUnitId: PrepressUnitId }>;
export type CompletePrepressUnitInput = Readonly<{ businessRequestId: string; prepressUnitId: PrepressUnitId }>;

/** Derived cross-owner read: no missing/aggregate state is persisted in Prepress. */
export type ProductionRequirementCoverage = Readonly<{
  requirement: ProductionUnitRequirement;
  artworkAssignmentIds: readonly ArtworkAssignmentId[];
  prepressUnits: readonly PrepressUnit[];
  productionArtworkCovered: boolean;
  prepressComplete: boolean;
}>;
export type OrderLinePrepressCoverage =
  | Readonly<{ state:"unconfigured"; requirements:readonly []; productionArtworkComplete:false; allRequiredPrepressUnitsComplete:false }>
  | Readonly<{ state:"configured"; requirements:readonly ProductionRequirementCoverage[]; productionArtworkComplete:boolean; allRequiredPrepressUnitsComplete:boolean }>;

/**
 * Bounded operational projection. Sales owns the order and line labels;
 * Routing contributes only its current coarse step; the coverage itself stays
 * derived from frozen requirements, Artwork, and Prepress evidence.
 */
export type PrepressQueueItem = Readonly<{
  orderId: OrderId;
  orderNumber: string;
  customerDisplayName: string;
  orderLineId: OrderLineId;
  lineDescription: string;
  quantity: number;
  requestedDueDate?: string;
  routingStepKind?: "proofing" | "prepress" | "production" | "fulfillment";
  coverage: OrderLinePrepressCoverage;
}>;
