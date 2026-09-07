import type { PrincipalKind } from "../../authorization/principals.js";
import type { ArtworkAssignmentId, ArtworkFileId, OrderId, OrderLineId, OrganizationId, PrepressUnitId, ProductionWorkId } from "../shared/commercialValues.js";
import type { ArtworkSide } from "../artwork/contracts.js";
import type { OperationalQueuePageRequest } from "../shared/operationalQueue.js";
import type { ProductionUnitRequirement } from "../shared/productionRequirements.js";

/** Read-only queue grouping; absent/all preserves every supported routed line. */
export type PrepressQueueRequirementState = "configured" | "unconfigured" | "all";
export type PrepressQueuePageRequest = OperationalQueuePageRequest & Readonly<{
  requirementState?: PrepressQueueRequirementState;
}>;

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
/** One atomic handoff: all required completed Prepress evidence becomes
 * canonical Production work while the frozen Route advances to Production. */
export type SendPrepressToProductionInput = Readonly<{ businessRequestId: string; prepressUnitId: PrepressUnitId }>;
export type PrepressProductionHandoff = Readonly<{
  unit: PrepressUnit;
  destination: "flatbed" | "roll";
  productionWorkIds: readonly ProductionWorkId[];
}>;

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

/** A compact artwork reference for an operational queue.  Binary delivery and
 * signed URLs remain Artwork-owned; Prepress only identifies the canonical
 * assignment a worker should inspect. */
export type PrepressArtworkReference = Readonly<{
  artworkAssignmentId: ArtworkAssignmentId;
  artworkFileId: ArtworkFileId;
  filename: string;
  contentType: string;
  purpose: "customer_supplied" | "production";
  side?: ArtworkSide;
  sourcePageIndex?: number;
  detectedWidthMicrons?: number;
  detectedHeightMicrons?: number;
}>;

/** Server-owned readiness reasons.  They intentionally describe missing
 * evidence and configuration rather than inventing a second Prepress state. */
export type PrepressReadinessBlocker =
  | "production_requirements_unconfigured"
  | "production_artwork_missing"
  | "prepress_units_incomplete"
  | "proof_approval_required"
  | "production_route_missing"
  | "production_destination_unconfigured";

export type PrepressOperationalContext = Readonly<{
  /** Frozen commercial dimensions; artwork metadata never rewrites these. */
  expectedDimensions?: Readonly<{ width: string; height: string; unit: "in" | "ft" | "mm" }>;
  /** Immutable material snapshots, not a live Product lookup. */
  materials: readonly string[];
  sourceArtwork: readonly PrepressArtworkReference[];
  productionArtwork: readonly PrepressArtworkReference[];
  proof: Readonly<{ required: boolean; state: "not_required" | "pending" | "approved" | "revision_requested" }>;
  /** A mapped station is an explicit routing fact, never inferred from a name. */
  productionDestination?: "flatbed" | "roll";
  readiness: Readonly<{ ready: boolean; blockers: readonly PrepressReadinessBlocker[] }>;
}>;

/**
 * Bounded operational projection. Sales owns the order and line labels;
 * Routing contributes only its current coarse step; the coverage itself stays
 * derived from frozen requirements, Artwork, and Prepress evidence.
 */
export type PrepressQueueItem = Readonly<{
  orderId: OrderId;
  orderNumber: string;
  /** Sales-owned projection. It is optional for legacy Orders without a
   * canonical Customer record, rather than inventing a Customer identity. */
  customerId?: string;
  customerDisplayName: string;
  orderLineId: OrderLineId;
  lineDescription: string;
  quantity: number;
  requestedDueDate?: string;
  routingStepKind?: "proofing" | "prepress" | "production" | "fulfillment";
  coverage: OrderLinePrepressCoverage;
  operational: PrepressOperationalContext;
}>;
