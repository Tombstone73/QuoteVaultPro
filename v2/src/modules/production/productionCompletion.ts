import type { OrderLineId, OrganizationId } from "../shared/commercialValues.js";

/** Read-only, Production-owned answer used by Routing; it never mutates work. */
export type ProductionCompletion = Readonly<{
  state: "not_started" | "in_progress" | "complete" | "blocked";
  requiredUnitCount: number;
  completedUnitCount: number;
  reason?: string;
}>;

export interface ProductionCompletionReadPort {
  readCompletion(organizationId: OrganizationId, orderLineId: OrderLineId): Promise<ProductionCompletion>;
}

export const productionCompletion = (input: Readonly<{ requiredUnitCount: number; openedUnitCount: number; completedUnitCount: number }>): ProductionCompletion => {
  if (input.requiredUnitCount < 1) return { state: "blocked", requiredUnitCount: 0, completedUnitCount: 0, reason: "Production has no frozen required units." };
  if (input.completedUnitCount >= input.requiredUnitCount) return { state: "complete", requiredUnitCount: input.requiredUnitCount, completedUnitCount: input.completedUnitCount };
  if (input.openedUnitCount < 1) return { state: "not_started", requiredUnitCount: input.requiredUnitCount, completedUnitCount: input.completedUnitCount, reason: "Production work has not started for every required unit." };
  return { state: "in_progress", requiredUnitCount: input.requiredUnitCount, completedUnitCount: input.completedUnitCount, reason: "Production has incomplete required units." };
};
