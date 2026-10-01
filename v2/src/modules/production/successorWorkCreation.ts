import type { OperationContext } from "../../application/operation.js";
import type { ArtworkAssignmentId, OrderId, OrderLineId, OrganizationId, PrepressUnitId, ProductionReworkCycleId, ProductionWorkId, ReplacementObligationId } from "../shared/commercialValues.js";

type CreationActor = Readonly<{ organizationId: OrganizationId; principalKind: OperationContext["principal"]["kind"]; principalSubject: string; staffActorUserId?: string }>;

/** Internal transaction contracts, called only after the requesting workflow's current authority and readiness checks. */
export type CompletedPrepressWorkCreationInput = CreationActor & Readonly<{ orderLineId: OrderLineId; artworkAssignmentIds: readonly ArtworkAssignmentId[] }>;
export type PrepressReworkWorkCreationInput = CreationActor & Readonly<{ artworkAssignmentId: ArtworkAssignmentId; prepressUnitId: PrepressUnitId; reworkCycleId: ProductionReworkCycleId }>;
/** Scoped immutable source projection read by the replacement workflow before creating its obligation. */
export type ReplacementProductionSource = Readonly<{ id: string; order_document_id: string; order_line_id: string; requirement_key: string; artwork_assignment_id: string; artwork_file_id: string; prepress_unit_id: string | null; side: "front" | "back" | null; source_page_index: number | null; layer_key: string | null; layer_order: number | null }>;
export type ReplacementWorkCreationInput = CreationActor & Readonly<{ orderId: OrderId; orderLineId: OrderLineId; replacementObligationId: ReplacementObligationId; replacementQuantity: number; sources: readonly ReplacementProductionSource[] }>;

/** Bounded existing cases, not a unified successor lifecycle or permission policy. */
export interface ProductionWorkCreation {
  createOrReadCompletedPrepressWork(input: CompletedPrepressWorkCreationInput): Promise<readonly ProductionWorkId[]>;
  createPrepressReworkWork(input: PrepressReworkWorkCreationInput): Promise<Readonly<{ productionWorkId: ProductionWorkId; destination: "flatbed" | "roll" }>>;
  createReplacementWork(input: ReplacementWorkCreationInput): Promise<readonly ProductionWorkId[]>;
}
