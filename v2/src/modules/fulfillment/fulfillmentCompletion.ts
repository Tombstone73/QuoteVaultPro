import type { OrderLineId, OrganizationId } from "../shared/commercialValues.js";

/** Read-only, Fulfillment-owned answer for the final frozen Route step. */
export type FulfillmentCompletion = Readonly<{
  state: "incomplete" | "complete" | "blocked";
  orderedQuantity: number;
  completedQuantity: number;
  reason?: string;
}>;

export interface FulfillmentCompletionReadPort {
  readCompletion(organizationId: OrganizationId, orderLineId: OrderLineId): Promise<FulfillmentCompletion>;
}

export const fulfillmentCompletion = (input: Readonly<{ orderedQuantity: number; completedQuantity: number }>): FulfillmentCompletion => {
  if (input.orderedQuantity < 1) return { state: "blocked", orderedQuantity: input.orderedQuantity, completedQuantity: input.completedQuantity, reason: "Fulfillment has no positive ordered quantity." };
  return input.completedQuantity >= input.orderedQuantity
    ? { state: "complete", orderedQuantity: input.orderedQuantity, completedQuantity: input.completedQuantity }
    : { state: "incomplete", orderedQuantity: input.orderedQuantity, completedQuantity: input.completedQuantity, reason: "Fulfillment has remaining ordered quantity." };
};
