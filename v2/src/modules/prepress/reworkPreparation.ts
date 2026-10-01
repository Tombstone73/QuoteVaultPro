import type { PrepressUnit } from "./contracts.js";

export type CreateReworkPreparationRequest = Readonly<{
  organizationId: string; orderId: string; orderLineId: string;
  reworkCycleId: string; predecessorProductionWorkId: string;
  artworkAssignmentId: string; artworkFileId: string;
  side?: "front" | "back"; sourcePageIndex?: number; layerKey?: string; layerOrder?: number;
  principalKind: PrepressUnit["createdPrincipalKind"]; principalSubject: string; staffActorUserId?: string;
}>;
export interface ReworkPreparation {
  createReworkPreparation(request: CreateReworkPreparationRequest): Promise<{ prepressUnitId: string }>;
}
